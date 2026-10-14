import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import pino from 'pino';
import { pinoHttp } from 'pino-http';
import { prisma } from '@vertizoom/database';
import { MembershipRole, Prisma } from '@prisma/client';

const scrypt = promisify(scryptCallback);
const SESSION_COOKIE = 'vz_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_TTL_SECONDS = SESSION_TTL_MS / 1000;
const PASSWORD_MIN_LENGTH = 12;
const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

type AuthContext = { userId: string; sessionId: string; email: string; name: string | null };
declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
      organizationMembership?: { id: string; organizationId: string; userId: string; role: MembershipRole };
    }
  }
}
const authAttemptBuckets = new Map<string, { count: number; resetAt: number }>();

function hashToken(token: string) { return createHash('sha256').update(token).digest('hex'); }
async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derivedKey = (await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })) as Buffer;
  return `scrypt$${salt.toString('hex')}$${derivedKey.toString('hex')}`;
}
async function verifyPassword(password: string, encoded: string) {
  const [algorithm, saltHex, keyHex] = encoded.split('$');
  if (algorithm !== 'scrypt' || !saltHex || !keyHex) return false;
  try {
    const expected = Buffer.from(keyHex, 'hex');
    const actual = (await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })) as Buffer;
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch { return false; }
}
function cookieOptions(maxAgeSeconds: number) {
  const secure = process.env.NODE_ENV === 'production';
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure ? '; Secure' : ''}`;
}
function setSessionCookie(response: Response, token: string) {
  const secure = process.env.NODE_ENV === 'production';
  response.setHeader('Set-Cookie', `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${secure ? '; Secure' : ''}`);
}
function clearSessionCookie(response: Response) { response.setHeader('Set-Cookie', cookieOptions(0)); }
function readCookie(request: Request, name: string) {
  const header = request.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator >= 0 && part.slice(0, separator).trim() === name) return decodeURIComponent(part.slice(separator + 1).trim());
  }
  return undefined;
}
function authRateLimit(request: Request, response: Response, next: NextFunction) {
  if (process.env.NODE_ENV === 'test') return next();
  const key = `${request.ip ?? 'unknown'}:${request.path}`;
  const now = Date.now();
  const current = authAttemptBuckets.get(key);
  if (!current || current.resetAt <= now) {
    if (authAttemptBuckets.size > 5000) for (const [bucket, value] of authAttemptBuckets) if (value.resetAt <= now) authAttemptBuckets.delete(bucket);
    authAttemptBuckets.set(key, { count: 1, resetAt: now + 15 * 60 * 1000 });
    return next();
  }
  if (current.count >= 10) {
    response.setHeader('Retry-After', String(Math.ceil((current.resetAt - now) / 1000)));
    return response.status(429).json({ error: 'Too many attempts. Please try again later.' });
  }
  current.count += 1;
  return next();
}
function requireSameOrigin(request: Request, response: Response, next: NextFunction) {
  const origin = request.get('origin');
  const expected = process.env.WEB_ORIGIN ?? 'http://localhost:5173';
  if (origin !== expected) return response.status(403).json({ error: 'Request origin is not allowed' });
  return next();
}
async function requireAuth(request: Request, response: Response, next: NextFunction) {
  try {
    const token = readCookie(request, SESSION_COOKIE);
    if (!token || token.length > 256) return response.status(401).json({ error: 'Authentication required' });
    const session = await prisma.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
    if (!session || session.revokedAt || session.expiresAt <= new Date() || session.user.disabledAt) {
      if (session && !session.revokedAt) await prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
      clearSessionCookie(response);
      return response.status(401).json({ error: 'Authentication required' });
    }
    request.auth = { userId: session.user.id, sessionId: session.id, email: session.user.email, name: session.user.name };
    if (!session.lastSeenAt || Date.now() - session.lastSeenAt.getTime() > 5 * 60 * 1000) {
      await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
    }
    return next();
  } catch (error) {
    logger.error({ err: error }, 'Authentication middleware failed');
    return response.status(500).json({ error: 'Unable to authenticate request' });
  }
}
function requireOrganizationRole(...allowedRoles: MembershipRole[]) {
  return async (request: Request, response: Response, next: NextFunction) => {
    try {
      const organizationId = request.params.organizationId;
      if (!organizationId || !request.auth) return response.status(401).json({ error: 'Authentication required' });
      const membership = await prisma.organizationMember.findUnique({ where: { organizationId_userId: { organizationId, userId: request.auth.userId } } });
      if (!membership) return response.status(404).json({ error: 'Organization not found' });
      request.organizationMembership = membership;
      if (allowedRoles.length && !allowedRoles.includes(membership.role)) return response.status(403).json({ error: 'Insufficient organization permissions' });
      return next();
    } catch (error) {
      logger.error({ err: error }, 'Organization authorization failed');
      return response.status(500).json({ error: 'Unable to authorize request' });
    }
  };
}
function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}
function cleanName(value: unknown, maxLength = 80): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  return name.length > 0 && name.length <= maxLength ? name : null;
}
function slugify(value: string) {
  return value.normalize('NFKD').toLowerCase().replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'workspace';
}
function publicUser(user: { id: string; name: string | null; email: string }) { return { id: user.id, name: user.name, email: user.email }; }
async function getOrganizations(userId: string) {
  const memberships = await prisma.organizationMember.findMany({ where: { userId }, include: { organization: true }, orderBy: { createdAt: 'asc' } });
  return memberships.map(({ organization, role }) => ({ id: organization.id, name: organization.name, slug: organization.slug, role }));
}
async function createSession(userId: string) {
  const token = randomBytes(32).toString('base64url');
  const session = await prisma.session.create({ data: { userId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + SESSION_TTL_MS) } });
  return { token, session };
}

export function createApp() {
  const app = express();
  const webOrigin = process.env.WEB_ORIGIN ?? 'http://localhost:5173';
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: webOrigin, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(pinoHttp({ logger }));
  app.use('/api', (request, response, next) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return requireSameOrigin(request, response, next);
    return next();
  });

  app.get('/api/health', (_request, response) => response.status(200).json({ status: 'ok', service: 'vertizoom-one-api', timestamp: new Date().toISOString() }));
  app.get('/api/ready', async (_request, response) => {
    try { await prisma.$queryRaw`SELECT 1`; return response.status(200).json({ status: 'ready', database: 'connected' }); }
    catch (error) { logger.error({ err: error }, 'Readiness check failed'); return response.status(503).json({ status: 'not_ready' }); }
  });

  app.post('/api/auth/signup', authRateLimit, async (request, response) => {
    const name = cleanName(request.body?.name);
    const email = normalizeEmail(request.body?.email);
    const password = request.body?.password;
    const organizationName = cleanName(request.body?.organizationName, 100);
    const invitationToken = typeof request.body?.invitationToken === 'string' ? request.body.invitationToken : '';
    if (!name || !email || typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH || password.length > 128 || (!organizationName && !invitationToken)) {
      return response.status(400).json({ error: 'Provide a valid name, email, and password of at least 12 characters. Organization name is required unless you are accepting an invitation.' });
    }
    try {
      const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
      if (existing) return response.status(409).json({ error: 'An account with this email already exists. Sign in to accept the invitation.' });
      let invitation: { id: string; organizationId: string; email: string; role: MembershipRole; expiresAt: Date; acceptedAt: Date | null; revokedAt: Date | null } | null = null;
      if (invitationToken) {
        invitation = await prisma.organizationInvitation.findUnique({ where: { tokenHash: hashToken(invitationToken) }, select: { id: true, organizationId: true, email: true, role: true, expiresAt: true, acceptedAt: true, revokedAt: true } });
        if (!invitation || invitation.email !== email || invitation.expiresAt <= new Date() || invitation.acceptedAt || invitation.revokedAt) {
          return response.status(400).json({ error: 'This invitation is invalid, expired, or was sent to a different email address.' });
        }
      }
      const passwordHash = await hashPassword(password);
      const slug = organizationName ? `${slugify(organizationName)}-${randomBytes(3).toString('hex')}` : '';
      const sessionToken = randomBytes(32).toString('base64url');
      const result = await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({ data: { name, email, passwordHash } });
        let organization: { id: string; name: string; slug: string };
        let role: MembershipRole;
        if (invitation) {
          const claimed = await tx.organizationInvitation.updateMany({ where: { id: invitation.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, data: { acceptedAt: new Date() } });
          if (claimed.count !== 1) throw new Error('INVITATION_UNAVAILABLE');
          const membership = await tx.organizationMember.create({ data: { organizationId: invitation.organizationId, userId: user.id, role: invitation.role } });
          organization = await tx.organization.findUniqueOrThrow({ where: { id: invitation.organizationId }, select: { id: true, name: true, slug: true } });
          role = membership.role;
          await tx.auditEvent.create({ data: { organizationId: organization.id, actorUserId: user.id, action: 'organization.invitation_accepted', entityType: 'OrganizationInvitation', entityId: invitation.id, metadata: { role } } });
        } else {
          organization = await tx.organization.create({ data: { name: organizationName!, slug } });
          await tx.organizationMember.create({ data: { organizationId: organization.id, userId: user.id, role: MembershipRole.OWNER } });
          role = MembershipRole.OWNER;
          await tx.auditEvent.create({ data: { organizationId: organization.id, actorUserId: user.id, action: 'organization.created', entityType: 'Organization', entityId: organization.id } });
        }
        await tx.session.create({ data: { userId: user.id, tokenHash: hashToken(sessionToken), expiresAt: new Date(Date.now() + SESSION_TTL_MS) } });
        return { user, organization, role };
      });
      setSessionCookie(response, sessionToken);
      return response.status(201).json({ user: publicUser(result.user), organizations: [{ id: result.organization.id, name: result.organization.name, slug: result.organization.slug, role: result.role }] });
    } catch (error) {
      if (error instanceof Error && error.message === 'INVITATION_UNAVAILABLE') return response.status(409).json({ error: 'This invitation has already been used or is no longer available.' });
      logger.error({ err: error }, 'Signup failed');
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') return response.status(409).json({ error: 'An account or organization with these details already exists' });
      return response.status(500).json({ error: 'Unable to create account' });
    }
  });

  app.post('/api/auth/login', authRateLimit, async (request, response) => {
    const email = normalizeEmail(request.body?.email);
    const password = request.body?.password;
    if (!email || typeof password !== 'string' || password.length > 128) return response.status(400).json({ error: 'Enter a valid email and password' });
    try {
      const user = await prisma.user.findUnique({ where: { email } });
      const valid = !!user?.passwordHash && !user.disabledAt && await verifyPassword(password, user.passwordHash);
      if (!user || !valid) return response.status(401).json({ error: 'Email or password is incorrect' });
      const { token } = await createSession(user.id);
      setSessionCookie(response, token);
      return response.status(200).json({ user: publicUser(user), organizations: await getOrganizations(user.id) });
    } catch (error) { logger.error({ err: error }, 'Login failed'); return response.status(500).json({ error: 'Unable to sign in' }); }
  });

  app.post('/api/auth/logout', requireAuth, async (request, response) => {
    try {
      await prisma.session.update({ where: { id: request.auth!.sessionId }, data: { revokedAt: new Date() } });
      clearSessionCookie(response);
      return response.status(204).end();
    } catch (error) { logger.error({ err: error }, 'Logout failed'); return response.status(500).json({ error: 'Unable to sign out' }); }
  });

  app.get('/api/auth/me', requireAuth, async (request, response) => {
    try { return response.status(200).json({ user: { id: request.auth!.userId, name: request.auth!.name, email: request.auth!.email }, organizations: await getOrganizations(request.auth!.userId) }); }
    catch (error) { logger.error({ err: error }, 'Unable to load current user'); return response.status(500).json({ error: 'Unable to load account' }); }
  });

  app.get('/api/organizations', requireAuth, async (request, response) => response.status(200).json({ organizations: await getOrganizations(request.auth!.userId) }));
  app.post('/api/organizations', requireAuth, async (request, response) => {
    const name = cleanName(request.body?.name, 100);
    if (!name) return response.status(400).json({ error: 'Organization name is required (maximum 100 characters)' });
    try {
      const slug = `${slugify(name)}-${randomBytes(3).toString('hex')}`;
      const organization = await prisma.$transaction(async (tx) => {
        const created = await tx.organization.create({ data: { name, slug } });
        await tx.organizationMember.create({ data: { organizationId: created.id, userId: request.auth!.userId, role: MembershipRole.OWNER } });
        await tx.auditEvent.create({ data: { organizationId: created.id, actorUserId: request.auth!.userId, action: 'organization.created', entityType: 'Organization', entityId: created.id } });
        return created;
      });
      return response.status(201).json({ organization: { id: organization.id, name: organization.name, slug: organization.slug, role: MembershipRole.OWNER } });
    } catch (error) { logger.error({ err: error }, 'Organization creation failed'); return response.status(500).json({ error: 'Unable to create organization' }); }
  });


  app.patch('/api/organizations/:organizationId', requireAuth, requireOrganizationRole(MembershipRole.OWNER), async (request, response) => {
    const organizationId = request.params.organizationId!;
    const name = cleanName(request.body?.name, 100);
    if (!name) return response.status(400).json({ error: 'Organization name is required (maximum 100 characters)' });
    try {
      const organization = await prisma.organization.update({ where: { id: organizationId }, data: { name } });
      await prisma.auditEvent.create({ data: { organizationId, actorUserId: request.auth!.userId, action: 'organization.updated', entityType: 'Organization', entityId: organization.id, metadata: { name } } });
      return response.status(200).json({ organization: { id: organization.id, name: organization.name, slug: organization.slug } });
    } catch (error) {
      logger.error({ err: error }, 'Organization update failed');
      return response.status(500).json({ error: 'Unable to update organization' });
    }
  });


  // Company profile and invoice defaults are organization-scoped.
  app.get('/api/organizations/:organizationId/profile', requireAuth, requireOrganizationRole(), async (request, response) => {
    try {
      const organization = await prisma.organization.findUnique({
        where: { id: request.params.organizationId! },
        select: {
          id: true, name: true, slug: true, legalName: true, logoUrl: true,
          addressLine1: true, addressLine2: true, city: true, state: true,
          postalCode: true, country: true, phone: true, businessEmail: true,
          website: true, gstin: true, pan: true, invoicePrefix: true,
          nextInvoiceNumber: true, currency: true, defaultTaxRateBps: true,
          paymentTerms: true, bankAccountName: true, bankName: true,
          bankAccountNumber: true, bankIfsc: true, upiId: true,
        },
      });
      if (!organization) return response.status(404).json({ error: 'Organization not found' });
      return response.status(200).json({ profile: organization });
    } catch (error) {
      logger.error({ err: error }, 'Company profile retrieval failed');
      return response.status(500).json({ error: 'Unable to load company profile' });
    }
  });

  app.patch('/api/organizations/:organizationId/profile', requireAuth, requireOrganizationRole(MembershipRole.OWNER, MembershipRole.ADMIN), async (request, response) => {
    const body = request.body ?? {};
    const optionalText = (key: string, max: number): string | null | undefined => {
      if (!(key in body)) return undefined;
      if (body[key] == null || body[key] === '') return null;
      if (typeof body[key] !== 'string') return undefined;
      const value = body[key].trim();
      return value.length <= max ? (value || null) : undefined;
    };
    const fields = {
      legalName: optionalText('legalName', 160), logoUrl: optionalText('logoUrl', 2048),
      addressLine1: optionalText('addressLine1', 160), addressLine2: optionalText('addressLine2', 160),
      city: optionalText('city', 100), state: optionalText('state', 100),
      postalCode: optionalText('postalCode', 20), country: optionalText('country', 100),
      phone: optionalText('phone', 30), website: optionalText('website', 255),
      gstin: optionalText('gstin', 15), pan: optionalText('pan', 10),
      paymentTerms: optionalText('paymentTerms', 500), bankAccountName: optionalText('bankAccountName', 120),
      bankName: optionalText('bankName', 120), bankAccountNumber: optionalText('bankAccountNumber', 34),
      bankIfsc: optionalText('bankIfsc', 11), upiId: optionalText('upiId', 100),
    };
    for (const [key, value] of Object.entries(fields)) {
      const max = ({ legalName: 160, logoUrl: 2048, addressLine1: 160, addressLine2: 160, city: 100, state: 100, postalCode: 20, country: 100, phone: 30, website: 255, gstin: 15, pan: 10, paymentTerms: 500, bankAccountName: 120, bankName: 120, bankAccountNumber: 34, bankIfsc: 11, upiId: 100 } as Record<string, number>)[key];
      if (key in body && value === undefined) return response.status(400).json({ error: key + ' must be a text value no longer than ' + max + ' characters' });
    }
    const businessEmail = optionalText('businessEmail', 254);
    if ('businessEmail' in body && (businessEmail === undefined || (businessEmail && !normalizeEmail(businessEmail)))) return response.status(400).json({ error: 'Enter a valid business email address' });
    const logoUrl = fields.logoUrl;
    const website = fields.website;
    for (const [label, value] of [['Logo URL', logoUrl], ['Website', website]] as const) {
      if (value) {
        try { const url = new URL(value); if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error(); }
        catch { return response.status(400).json({ error: label + ' must be a valid HTTP or HTTPS URL' }); }
      }
    }
    const invoicePrefix = body.invoicePrefix == null ? undefined : typeof body.invoicePrefix === 'string' ? body.invoicePrefix.trim().toUpperCase() : '';
    const nextInvoiceNumber = body.nextInvoiceNumber == null ? undefined : Number(body.nextInvoiceNumber);
    const currency = body.currency == null ? undefined : typeof body.currency === 'string' ? body.currency.trim().toUpperCase() : '';
    const taxValue = body.defaultTaxRate == null ? undefined : Number(body.defaultTaxRate);
    if (invoicePrefix !== undefined && !/^[A-Z0-9-]{1,12}$/.test(invoicePrefix)) return response.status(400).json({ error: 'Invoice prefix must be 1–12 letters, numbers, or hyphens' });
    if (nextInvoiceNumber !== undefined && (!Number.isSafeInteger(nextInvoiceNumber) || nextInvoiceNumber < 1 || nextInvoiceNumber > 2147483647)) return response.status(400).json({ error: 'Next invoice number must be a positive whole number' });
    if (currency !== undefined && !/^[A-Z]{3}$/.test(currency)) return response.status(400).json({ error: 'Currency must be a 3-letter currency code' });
    if (taxValue !== undefined && (!Number.isFinite(taxValue) || taxValue < 0 || taxValue > 100 || Math.round(taxValue * 100) !== taxValue * 100)) return response.status(400).json({ error: 'Default tax rate must be between 0 and 100 with up to 2 decimal places' });
    if (fields.gstin && !/^[0-9A-Z]{15}$/.test(fields.gstin.toUpperCase())) return response.status(400).json({ error: 'GSTIN must contain 15 letters or numbers' });
    if (fields.pan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(fields.pan.toUpperCase())) return response.status(400).json({ error: 'PAN format is invalid' });
    if (fields.bankIfsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(fields.bankIfsc.toUpperCase())) return response.status(400).json({ error: 'IFSC format is invalid' });
    try {
      const data: Prisma.OrganizationUpdateInput = {};
      for (const [key, value] of Object.entries(fields)) if (value !== undefined) data[key] = ['gstin', 'pan', 'bankIfsc'].includes(key) && value ? value.toUpperCase() : value;
      if (businessEmail !== undefined) data.businessEmail = businessEmail ? normalizeEmail(businessEmail) : null;
      if (invoicePrefix !== undefined) data.invoicePrefix = invoicePrefix;
      if (nextInvoiceNumber !== undefined) data.nextInvoiceNumber = nextInvoiceNumber;
      if (currency !== undefined) data.currency = currency;
      if (taxValue !== undefined) data.defaultTaxRateBps = Math.round(taxValue * 100);
      const profile = await prisma.organization.update({
        where: { id: request.params.organizationId! }, data,
        select: {
          id: true, name: true, slug: true, legalName: true, logoUrl: true,
          addressLine1: true, addressLine2: true, city: true, state: true,
          postalCode: true, country: true, phone: true, businessEmail: true,
          website: true, gstin: true, pan: true, invoicePrefix: true,
          nextInvoiceNumber: true, currency: true, defaultTaxRateBps: true,
          paymentTerms: true, bankAccountName: true, bankName: true,
          bankAccountNumber: true, bankIfsc: true, upiId: true,
        },
      });
      await prisma.auditEvent.create({ data: { organizationId: profile.id, actorUserId: request.auth!.userId, action: 'organization.company_profile_updated', entityType: 'Organization', entityId: profile.id } });
      return response.status(200).json({ profile });
    } catch (error) {
      logger.error({ err: error }, 'Company profile update failed');
      return response.status(500).json({ error: 'Unable to save company profile' });
    }
  });

  app.get('/api/organizations/:organizationId/audit-events', requireAuth, requireOrganizationRole(), async (request, response) => {
    const organizationId = request.params.organizationId!;
    try {
      const events = await prisma.auditEvent.findMany({
        where: { organizationId },
        include: { actor: { select: { name: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
      return response.status(200).json({ events: events.map(({ id, action, entityType, entityId, metadata, createdAt, actor }) => ({ id, action, entityType, entityId, metadata, createdAt, actor })) });
    } catch (error) {
      logger.error({ err: error }, 'Audit history retrieval failed');
      return response.status(500).json({ error: 'Unable to load audit history' });
    }
  });

  app.post('/api/organizations/:organizationId/members', requireAuth, requireOrganizationRole(MembershipRole.OWNER, MembershipRole.ADMIN), async (request, response) => {
    const organizationId = request.params.organizationId!;
    const email = normalizeEmail(request.body?.email);
    const role = request.body?.role;
    if (!email || ![MembershipRole.MEMBER, MembershipRole.VIEWER].includes(role)) return response.status(400).json({ error: 'Provide a valid email and role MEMBER or VIEWER' });
    try {
      const user = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true, name: true } });
      if (user) {
        const membership = await prisma.organizationMember.create({ data: { organizationId, userId: user.id, role } });
        await prisma.auditEvent.create({ data: { organizationId, actorUserId: request.auth!.userId, action: 'organization.member_added', entityType: 'OrganizationMember', entityId: membership.id, metadata: { role } } });
        return response.status(201).json({ member: { id: membership.id, role: membership.role, createdAt: membership.createdAt, user } });
      }
      const pending = await prisma.organizationInvitation.findFirst({ where: { organizationId, email, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } });
      if (pending) return response.status(409).json({ error: 'An active invitation already exists for this email.' });
      const token = randomBytes(32).toString('base64url');
      const invitation = await prisma.organizationInvitation.create({ data: { organizationId, inviterUserId: request.auth!.userId, email, role, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) } });
      await prisma.auditEvent.create({ data: { organizationId, actorUserId: request.auth!.userId, action: 'organization.invitation_created', entityType: 'OrganizationInvitation', entityId: invitation.id, metadata: { email, role, expiresAt: invitation.expiresAt.toISOString() } } });
      const invitationUrl = `${webOrigin}/?invite=${encodeURIComponent(token)}`;
      return response.status(201).json({ invitation: { id: invitation.id, email: invitation.email, role: invitation.role, expiresAt: invitation.expiresAt, createdAt: invitation.createdAt, invitationUrl } });
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') return response.status(409).json({ error: 'User is already a member of this organization.' });
      logger.error({ err: error }, 'Adding organization member failed');
      return response.status(500).json({ error: 'Unable to add organization member' });
    }
  });

  app.get('/api/organizations/:organizationId/members', requireAuth, requireOrganizationRole(), async (request, response) => {
    const organizationId = request.params.organizationId!;
    const members = await prisma.organizationMember.findMany({ where: { organizationId }, include: { user: { select: { id: true, name: true, email: true } } }, orderBy: { createdAt: 'asc' } });
    return response.status(200).json({ members: members.map(({ id, role, createdAt, user }) => ({ id, role, createdAt, user })) });
  });

  app.get('/api/organizations/:organizationId/invitations', requireAuth, requireOrganizationRole(MembershipRole.OWNER, MembershipRole.ADMIN), async (request, response) => {
    const invitations = await prisma.organizationInvitation.findMany({
      where: { organizationId: request.params.organizationId!, acceptedAt: null, revokedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true, email: true, role: true, expiresAt: true, createdAt: true },
    });
    return response.status(200).json({ invitations });
  });

  app.delete('/api/organizations/:organizationId/invitations/:invitationId', requireAuth, requireOrganizationRole(MembershipRole.OWNER, MembershipRole.ADMIN), async (request, response) => {
    const organizationId = request.params.organizationId!;
    const invitation = await prisma.organizationInvitation.findFirst({ where: { id: request.params.invitationId!, organizationId, acceptedAt: null, revokedAt: null } });
    if (!invitation) return response.status(404).json({ error: 'Pending invitation not found' });
    await prisma.organizationInvitation.update({ where: { id: invitation.id }, data: { revokedAt: new Date() } });
    await prisma.auditEvent.create({ data: { organizationId, actorUserId: request.auth!.userId, action: 'organization.invitation_revoked', entityType: 'OrganizationInvitation', entityId: invitation.id, metadata: { email: invitation.email } } });
    return response.status(204).end();
  });

  app.post('/api/auth/accept-invitation', requireAuth, async (request, response) => {
    const token = request.body?.token;
    if (typeof token !== 'string' || token.length > 256) return response.status(400).json({ error: 'A valid invitation token is required.' });
    try {
      const invitation = await prisma.organizationInvitation.findUnique({ where: { tokenHash: hashToken(token) } });
      if (!invitation || invitation.email !== request.auth!.email || invitation.expiresAt <= new Date() || invitation.acceptedAt || invitation.revokedAt) {
        return response.status(400).json({ error: 'This invitation is invalid, expired, already used, or belongs to another email address.' });
      }
      await prisma.$transaction(async (tx) => {
        const claimed = await tx.organizationInvitation.updateMany({ where: { id: invitation.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, data: { acceptedAt: new Date() } });
        if (claimed.count !== 1) throw new Error('INVITATION_UNAVAILABLE');
        await tx.organizationMember.create({ data: { organizationId: invitation.organizationId, userId: request.auth!.userId, role: invitation.role } });
        await tx.auditEvent.create({ data: { organizationId: invitation.organizationId, actorUserId: request.auth!.userId, action: 'organization.invitation_accepted', entityType: 'OrganizationInvitation', entityId: invitation.id, metadata: { role: invitation.role } } });
      });
      return response.status(200).json({ organizations: await getOrganizations(request.auth!.userId) });
    } catch (error) {
      if (error instanceof Error && error.message === 'INVITATION_UNAVAILABLE') return response.status(409).json({ error: 'This invitation has already been used or is no longer available.' });
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') return response.status(409).json({ error: 'You are already a member of this workspace.' });
      logger.error({ err: error }, 'Accepting invitation failed');
      return response.status(500).json({ error: 'Unable to accept invitation' });
    }
  });

  app.patch('/api/organizations/:organizationId/members/:memberId/role', requireAuth, requireOrganizationRole(MembershipRole.OWNER), async (request, response) => {
    const organizationId = request.params.organizationId!;
    const memberId = request.params.memberId!;
    const role = request.body?.role;
    if (![MembershipRole.ADMIN, MembershipRole.MEMBER, MembershipRole.VIEWER].includes(role)) return response.status(400).json({ error: 'Role must be ADMIN, MEMBER, or VIEWER. Ownership transfer is not supported yet.' });
    try {
      const target = await prisma.organizationMember.findFirst({ where: { id: memberId, organizationId } });
      if (!target || target.role === MembershipRole.OWNER) return response.status(404).json({ error: 'Organization member not found' });
      const updated = await prisma.organizationMember.update({ where: { id: target.id }, data: { role } });
      await prisma.auditEvent.create({ data: { organizationId, actorUserId: request.auth!.userId, action: 'organization.member_role_changed', entityType: 'OrganizationMember', entityId: updated.id, metadata: { role } } });
      return response.status(200).json({ member: { id: updated.id, userId: updated.userId, role: updated.role } });
    } catch (error) { logger.error({ err: error }, 'Role update failed'); return response.status(500).json({ error: 'Unable to update member role' }); }
  });


  // Core ERP: organization-scoped departments and employee directory.
  app.get('/api/organizations/:organizationId/departments', requireAuth, requireOrganizationRole(), async (request, response) => {
    const organizationId = request.params.organizationId!;
    try {
      const departments = await prisma.department.findMany({
        where: { organizationId },
        include: { _count: { select: { employees: true } } },
        orderBy: { name: 'asc' },
      });
      return response.status(200).json({ departments: departments.map(({ id, name, description, createdAt, _count }) => ({ id, name, description, createdAt, employeeCount: _count.employees })) });
    } catch (error) {
      logger.error({ err: error }, 'Unable to list departments');
      return response.status(500).json({ error: 'Unable to load departments' });
    }
  });

  app.post('/api/organizations/:organizationId/departments', requireAuth, requireOrganizationRole(MembershipRole.OWNER, MembershipRole.ADMIN), async (request, response) => {
    const organizationId = request.params.organizationId!;
    const name = cleanName(request.body?.name, 80);
    const description = typeof request.body?.description === 'string' ? request.body.description.trim().slice(0, 300) || null : null;
    if (!name) return response.status(400).json({ error: 'Department name is required (maximum 80 characters)' });
    try {
      const department = await prisma.department.create({ data: { organizationId, name, description } });
      await prisma.auditEvent.create({ data: { organizationId, actorUserId: request.auth!.userId, action: 'department.created', entityType: 'Department', entityId: department.id } });
      return response.status(201).json({ department: { id: department.id, name: department.name, description: department.description, createdAt: department.createdAt, employeeCount: 0 } });
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') return response.status(409).json({ error: 'A department with this name already exists' });
      logger.error({ err: error }, 'Department creation failed');
      return response.status(500).json({ error: 'Unable to create department' });
    }
  });


  app.patch('/api/organizations/:organizationId/departments/:departmentId', requireAuth, requireOrganizationRole(MembershipRole.OWNER, MembershipRole.ADMIN), async (request, response) => {
    const organizationId = request.params.organizationId!;
    const departmentId = request.params.departmentId!;
    const name = cleanName(request.body?.name, 80);
    const description = typeof request.body?.description === 'string' ? request.body.description.trim().slice(0, 300) || null : null;
    if (!name) return response.status(400).json({ error: 'Department name is required (maximum 80 characters)' });
    try {
      const existing = await prisma.department.findFirst({ where: { id: departmentId, organizationId }, select: { id: true } });
      if (!existing) return response.status(404).json({ error: 'Department not found' });
      const department = await prisma.department.update({ where: { id: existing.id }, data: { name, description }, include: { _count: { select: { employees: true } } } });
      await prisma.auditEvent.create({ data: { organizationId, actorUserId: request.auth!.userId, action: 'department.updated', entityType: 'Department', entityId: department.id } });
      return response.status(200).json({ department: { id: department.id, name: department.name, description: department.description, createdAt: department.createdAt, employeeCount: department._count.employees } });
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') return response.status(409).json({ error: 'A department with this name already exists' });
      logger.error({ err: error }, 'Department update failed');
      return response.status(500).json({ error: 'Unable to update department' });
    }
  });

  app.get('/api/organizations/:organizationId/employees', requireAuth, requireOrganizationRole(), async (request, response) => {
    const organizationId = request.params.organizationId!;
    try {
      const employees = await prisma.employee.findMany({
        where: { organizationId },
        include: { department: { select: { id: true, name: true } } },
        orderBy: [{ createdAt: 'desc' }],
      });
      return response.status(200).json({ employees });
    } catch (error) {
      logger.error({ err: error }, 'Unable to list employees');
      return response.status(500).json({ error: 'Unable to load employees' });
    }
  });

  app.post('/api/organizations/:organizationId/employees', requireAuth, requireOrganizationRole(MembershipRole.OWNER, MembershipRole.ADMIN), async (request, response) => {
    const organizationId = request.params.organizationId!;
    const employeeCode = cleanName(request.body?.employeeCode, 32);
    const firstName = cleanName(request.body?.firstName, 80);
    const lastName = cleanName(request.body?.lastName, 80);
    const workEmail = request.body?.workEmail == null || request.body.workEmail === '' ? null : normalizeEmail(request.body.workEmail);
    const jobTitle = request.body?.jobTitle == null || request.body.jobTitle === '' ? null : cleanName(request.body.jobTitle, 100);
    const departmentId = request.body?.departmentId == null || request.body.departmentId === '' ? null : request.body.departmentId;
    const startDateValue = request.body?.startDate;
    const startDate = typeof startDateValue === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(startDateValue) ? new Date(`${startDateValue}T00:00:00.000Z`) : null;
    if (!employeeCode || !firstName || !lastName || (request.body?.workEmail && !workEmail) || (request.body?.jobTitle && !jobTitle) || (startDateValue && !startDate)) {
      return response.status(400).json({ error: 'Provide an employee code, first name, last name, and valid optional fields' });
    }
    try {
      if (departmentId) {
        const department = await prisma.department.findFirst({ where: { id: departmentId, organizationId }, select: { id: true } });
        if (!department) return response.status(400).json({ error: 'Department does not belong to this organization' });
      }
      const employee = await prisma.employee.create({
        data: { organizationId, employeeCode, firstName, lastName, workEmail, jobTitle, departmentId, startDate },
        include: { department: { select: { id: true, name: true } } },
      });
      await prisma.auditEvent.create({ data: { organizationId, actorUserId: request.auth!.userId, action: 'employee.created', entityType: 'Employee', entityId: employee.id } });
      return response.status(201).json({ employee });
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') return response.status(409).json({ error: 'Employee code or work email already exists in this organization' });
      logger.error({ err: error }, 'Employee creation failed');
      return response.status(500).json({ error: 'Unable to create employee' });
    }
  });


  app.patch('/api/organizations/:organizationId/employees/:employeeId', requireAuth, requireOrganizationRole(MembershipRole.OWNER, MembershipRole.ADMIN), async (request, response) => {
    const organizationId = request.params.organizationId!;
    const employeeId = request.params.employeeId!;
    const employeeCode = cleanName(request.body?.employeeCode, 32);
    const firstName = cleanName(request.body?.firstName, 80);
    const lastName = cleanName(request.body?.lastName, 80);
    const workEmail = request.body?.workEmail == null || request.body.workEmail === '' ? null : normalizeEmail(request.body.workEmail);
    const jobTitle = request.body?.jobTitle == null || request.body?.jobTitle === '' ? null : cleanName(request.body.jobTitle, 100);
    const departmentId = request.body?.departmentId == null || request.body?.departmentId === '' ? null : request.body.departmentId;
    const startDateValue = request.body?.startDate;
    const startDate = startDateValue == null || startDateValue === '' ? null : typeof startDateValue === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(startDateValue) ? new Date(startDateValue + 'T00:00:00.000Z') : undefined;
    if (!employeeCode || !firstName || !lastName || (request.body?.workEmail && !workEmail) || (request.body?.jobTitle && !jobTitle) || startDate === undefined) return response.status(400).json({ error: 'Provide an employee code, first name, last name, and valid optional fields' });
    try {
      const existing = await prisma.employee.findFirst({ where: { id: employeeId, organizationId }, select: { id: true } });
      if (!existing) return response.status(404).json({ error: 'Employee not found' });
      if (departmentId) {
        const department = await prisma.department.findFirst({ where: { id: departmentId, organizationId }, select: { id: true } });
        if (!department) return response.status(400).json({ error: 'Department does not belong to this organization' });
      }
      const employee = await prisma.employee.update({ where: { id: existing.id }, data: { employeeCode, firstName, lastName, workEmail, jobTitle, departmentId, startDate }, include: { department: { select: { id: true, name: true } } } });
      await prisma.auditEvent.create({ data: { organizationId, actorUserId: request.auth!.userId, action: 'employee.updated', entityType: 'Employee', entityId: employee.id } });
      return response.status(200).json({ employee });
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') return response.status(409).json({ error: 'Employee code or work email already exists in this organization' });
      logger.error({ err: error }, 'Employee update failed');
      return response.status(500).json({ error: 'Unable to update employee' });
    }
  });

  app.patch('/api/organizations/:organizationId/employees/:employeeId/status', requireAuth, requireOrganizationRole(MembershipRole.OWNER, MembershipRole.ADMIN), async (request, response) => {
    const organizationId = request.params.organizationId!;
    const employeeId = request.params.employeeId!;
    const status = request.body?.status;
    if (!['ACTIVE', 'ON_LEAVE', 'INACTIVE'].includes(status)) return response.status(400).json({ error: 'Status must be ACTIVE, ON_LEAVE, or INACTIVE' });
    try {
      const employee = await prisma.employee.findFirst({ where: { id: employeeId, organizationId }, select: { id: true } });
      if (!employee) return response.status(404).json({ error: 'Employee not found' });
      const updated = await prisma.employee.update({ where: { id: employee.id }, data: { status }, include: { department: { select: { id: true, name: true } } } });
      await prisma.auditEvent.create({ data: { organizationId, actorUserId: request.auth!.userId, action: 'employee.status_changed', entityType: 'Employee', entityId: updated.id, metadata: { status } } });
      return response.status(200).json({ employee: updated });
    } catch (error) {
      logger.error({ err: error }, 'Employee status update failed');
      return response.status(500).json({ error: 'Unable to update employee status' });
    }
  });


  // CRM: every record and relationship is scoped to the authorized organization.
  const crmWriters = [MembershipRole.OWNER, MembershipRole.ADMIN, MembershipRole.MEMBER];
  app.get('/api/organizations/:organizationId/crm/customers', requireAuth, requireOrganizationRole(), async (req, res) => {
    const organizationId=req.params.organizationId!;
    const search=typeof req.query.search==='string'?req.query.search.trim().slice(0,100):'';
    try {
      const records=await prisma.crmCustomer.findMany({where:{organizationId,...(search?{OR:[{name:{contains:search,mode:'insensitive'}},{email:{contains:search,mode:'insensitive'}},{industry:{contains:search,mode:'insensitive'}}]}:{})},include:{_count:{select:{contacts:true,leads:true}}},orderBy:{updatedAt:'desc'},take:200});
      return res.json({customers:records.map(({_count,...c})=>({...c,contactCount:_count.contacts,leadCount:_count.leads}))});
    } catch(error){logger.error({err:error},'CRM customers failed');return res.status(500).json({error:'Unable to load customers'});}
  });
  app.post('/api/organizations/:organizationId/crm/customers', requireAuth, requireOrganizationRole(...crmWriters), async (req,res)=>{
    const organizationId=req.params.organizationId!, name=cleanName(req.body?.name,120);
    const email=req.body?.email==null||req.body.email===''?null:normalizeEmail(req.body.email);
    const phone=req.body?.phone==null||req.body.phone===''?null:cleanName(req.body.phone,40);
    const website=req.body?.website==null||req.body.website===''?null:cleanName(req.body.website,200);
    const industry=req.body?.industry==null||req.body.industry===''?null:cleanName(req.body.industry,100);
    const notes=typeof req.body?.notes==='string'?req.body.notes.trim().slice(0,2000)||null:null;
    const status=req.body?.status??'PROSPECT';
    if(!name||(req.body?.email&&!email)||(req.body?.phone&&!phone)||(req.body?.website&&!website)||(req.body?.industry&&!industry)||!['PROSPECT','ACTIVE','INACTIVE'].includes(status))return res.status(400).json({error:'Provide a customer name and valid optional fields/status'});
    if(website&&!/^https?:\/\//i.test(website))return res.status(400).json({error:'Website must start with http:// or https://'});
    try{const customer=await prisma.crmCustomer.create({data:{organizationId,name,email,phone,website,industry,notes,status}});
      await prisma.auditEvent.create({data:{organizationId,actorUserId:req.auth!.userId,action:'crm.customer_created',entityType:'CrmCustomer',entityId:customer.id}});
      return res.status(201).json({customer:{...customer,contactCount:0,leadCount:0}});
    }catch(error){logger.error({err:error},'CRM customer create failed');return res.status(500).json({error:'Unable to create customer'});}
  });
  app.patch('/api/organizations/:organizationId/crm/customers/:customerId', requireAuth, requireOrganizationRole(...crmWriters), async (req,res)=>{
    const organizationId=req.params.organizationId!,customerId=req.params.customerId!,name=cleanName(req.body?.name,120);
    const email=req.body?.email==null||req.body.email===''?null:normalizeEmail(req.body.email),phone=req.body?.phone==null||req.body.phone===''?null:cleanName(req.body.phone,40);
    const website=req.body?.website==null||req.body.website===''?null:cleanName(req.body.website,200),industry=req.body?.industry==null||req.body.industry===''?null:cleanName(req.body.industry,100);
    const notes=typeof req.body?.notes==='string'?req.body.notes.trim().slice(0,2000)||null:null,status=req.body?.status;
    if(!name||(req.body?.email&&!email)||(req.body?.phone&&!phone)||(req.body?.website&&!website)||(req.body?.industry&&!industry)||!['PROSPECT','ACTIVE','INACTIVE'].includes(status))return res.status(400).json({error:'Provide a customer name and valid optional fields/status'});
    if(website&&!/^https?:\/\//i.test(website))return res.status(400).json({error:'Website must start with http:// or https://'});
    try{if(!await prisma.crmCustomer.findFirst({where:{id:customerId,organizationId},select:{id:true}}))return res.status(404).json({error:'Customer not found'});
      const c=await prisma.crmCustomer.update({where:{id:customerId},data:{name,email,phone,website,industry,notes,status},include:{_count:{select:{contacts:true,leads:true}}}});
      await prisma.auditEvent.create({data:{organizationId,actorUserId:req.auth!.userId,action:'crm.customer_updated',entityType:'CrmCustomer',entityId:c.id}});
      const {_count,...customer}=c;return res.json({customer:{...customer,contactCount:_count.contacts,leadCount:_count.leads}});
    }catch(error){logger.error({err:error},'CRM customer update failed');return res.status(500).json({error:'Unable to update customer'});}
  });
  app.get('/api/organizations/:organizationId/crm/contacts',requireAuth,requireOrganizationRole(),async(req,res)=>{
    try{return res.json({contacts:await prisma.crmContact.findMany({where:{organizationId:req.params.organizationId!},include:{customer:{select:{id:true,name:true}}},orderBy:[{lastName:'asc'},{firstName:'asc'}],take:300})});}
    catch(error){logger.error({err:error},'CRM contacts failed');return res.status(500).json({error:'Unable to load contacts'});}
  });
  app.post('/api/organizations/:organizationId/crm/contacts',requireAuth,requireOrganizationRole(...crmWriters),async(req,res)=>{
    const organizationId=req.params.organizationId!,customerId=typeof req.body?.customerId==='string'?req.body.customerId:'';
    const firstName=cleanName(req.body?.firstName,80),lastName=cleanName(req.body?.lastName,80);
    const email=req.body?.email==null||req.body.email===''?null:normalizeEmail(req.body.email),phone=req.body?.phone==null||req.body.phone===''?null:cleanName(req.body.phone,40);
    const jobTitle=req.body?.jobTitle==null||req.body.jobTitle===''?null:cleanName(req.body.jobTitle,100),notes=typeof req.body?.notes==='string'?req.body.notes.trim().slice(0,1500)||null:null;
    if(!customerId||!firstName||!lastName||(req.body?.email&&!email)||(req.body?.phone&&!phone)||(req.body?.jobTitle&&!jobTitle))return res.status(400).json({error:'Provide a customer, first name, last name, and valid optional fields'});
    try{if(!await prisma.crmCustomer.findFirst({where:{id:customerId,organizationId},select:{id:true}}))return res.status(400).json({error:'Customer does not belong to this organization'});
      const contact=await prisma.crmContact.create({data:{organizationId,customerId,firstName,lastName,email,phone,jobTitle,notes},include:{customer:{select:{id:true,name:true}}}});
      await prisma.auditEvent.create({data:{organizationId,actorUserId:req.auth!.userId,action:'crm.contact_created',entityType:'CrmContact',entityId:contact.id}});return res.status(201).json({contact});
    }catch(error){logger.error({err:error},'CRM contact create failed');return res.status(500).json({error:'Unable to create contact'});}
  });
  app.patch('/api/organizations/:organizationId/crm/contacts/:contactId',requireAuth,requireOrganizationRole(...crmWriters),async(req,res)=>{
    const organizationId=req.params.organizationId!,contactId=req.params.contactId!,customerId=typeof req.body?.customerId==='string'?req.body.customerId:'';
    const firstName=cleanName(req.body?.firstName,80),lastName=cleanName(req.body?.lastName,80);
    const email=req.body?.email==null||req.body.email===''?null:normalizeEmail(req.body.email),phone=req.body?.phone==null||req.body.phone===''?null:cleanName(req.body.phone,40);
    const jobTitle=req.body?.jobTitle==null||req.body.jobTitle===''?null:cleanName(req.body.jobTitle,100),notes=typeof req.body?.notes==='string'?req.body.notes.trim().slice(0,1500)||null:null;
    if(!customerId||!firstName||!lastName||(req.body?.email&&!email)||(req.body?.phone&&!phone)||(req.body?.jobTitle&&!jobTitle))return res.status(400).json({error:'Provide a customer, first name, last name, and valid optional fields'});
    try{
      const [existing,customer]=await Promise.all([prisma.crmContact.findFirst({where:{id:contactId,organizationId},select:{id:true}}),prisma.crmCustomer.findFirst({where:{id:customerId,organizationId},select:{id:true}})]);
      if(!existing)return res.status(404).json({error:'Contact not found'});if(!customer)return res.status(400).json({error:'Customer does not belong to this organization'});
      const contact=await prisma.crmContact.update({where:{id:contactId},data:{customerId,firstName,lastName,email,phone,jobTitle,notes},include:{customer:{select:{id:true,name:true}}}});
      await prisma.auditEvent.create({data:{organizationId,actorUserId:req.auth!.userId,action:'crm.contact_updated',entityType:'CrmContact',entityId:contact.id}});return res.json({contact});
    }catch(error){logger.error({err:error},'CRM contact update failed');return res.status(500).json({error:'Unable to update contact'});}
  });
  app.get('/api/organizations/:organizationId/crm/leads',requireAuth,requireOrganizationRole(),async(req,res)=>{
    try{return res.json({leads:await prisma.crmLead.findMany({where:{organizationId:req.params.organizationId!},include:{customer:{select:{id:true,name:true}},contact:{select:{id:true,firstName:true,lastName:true,email:true}}},orderBy:{updatedAt:'desc'},take:300})});}
    catch(error){logger.error({err:error},'CRM leads failed');return res.status(500).json({error:'Unable to load sales pipeline'});}
  });
  app.post('/api/organizations/:organizationId/crm/leads',requireAuth,requireOrganizationRole(...crmWriters),async(req,res)=>{
    const organizationId=req.params.organizationId!,title=cleanName(req.body?.title,140);
    const customerId=typeof req.body?.customerId==='string'&&req.body.customerId?req.body.customerId:null,contactId=typeof req.body?.contactId==='string'&&req.body.contactId?req.body.contactId:null;
    const value=req.body?.estimatedValue==null||req.body.estimatedValue===''?0:Number(req.body.estimatedValue),stage=req.body?.stage??'NEW';
    const source=req.body?.source==null||req.body.source===''?null:cleanName(req.body.source,80),notes=typeof req.body?.notes==='string'?req.body.notes.trim().slice(0,2000)||null:null;
    const close=req.body?.expectedCloseDate?typeof req.body.expectedCloseDate==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(req.body.expectedCloseDate)?new Date(req.body.expectedCloseDate+'T00:00:00.000Z'):undefined:null;
    if(!title||!Number.isFinite(value)||value<0||value>21000000||!['NEW','QUALIFIED','PROPOSAL','NEGOTIATION','WON','LOST'].includes(stage)||(req.body?.source&&!source)||close===undefined)return res.status(400).json({error:'Provide a lead title and valid value, stage, source, and close date'});
    try{
      if(customerId&&!await prisma.crmCustomer.findFirst({where:{id:customerId,organizationId},select:{id:true}}))return res.status(400).json({error:'Customer does not belong to this organization'});
      if(contactId&&!await prisma.crmContact.findFirst({where:{id:contactId,organizationId,...(customerId?{customerId}:{})},select:{id:true}}))return res.status(400).json({error:'Contact does not belong to this organization or selected customer'});
      const lead=await prisma.crmLead.create({data:{organizationId,title,customerId,contactId,estimatedValueCents:Math.round(value*100),stage,source,notes,expectedCloseDate:close},include:{customer:{select:{id:true,name:true}},contact:{select:{id:true,firstName:true,lastName:true,email:true}}}});
      await prisma.auditEvent.create({data:{organizationId,actorUserId:req.auth!.userId,action:'crm.lead_created',entityType:'CrmLead',entityId:lead.id}});return res.status(201).json({lead});
    }catch(error){logger.error({err:error},'CRM lead create failed');return res.status(500).json({error:'Unable to create lead'});}
  });
  app.patch('/api/organizations/:organizationId/crm/leads/:leadId',requireAuth,requireOrganizationRole(...crmWriters),async(req,res)=>{
    const organizationId=req.params.organizationId!,leadId=req.params.leadId!,title=cleanName(req.body?.title,140);
    const customerId=typeof req.body?.customerId==='string'&&req.body.customerId?req.body.customerId:null,contactId=typeof req.body?.contactId==='string'&&req.body.contactId?req.body.contactId:null;
    const value=req.body?.estimatedValue==null||req.body.estimatedValue===''?0:Number(req.body.estimatedValue),stage=req.body?.stage;
    const source=req.body?.source==null||req.body.source===''?null:cleanName(req.body.source,80),notes=typeof req.body?.notes==='string'?req.body.notes.trim().slice(0,2000)||null:null;
    const close=req.body?.expectedCloseDate?typeof req.body.expectedCloseDate==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(req.body.expectedCloseDate)?new Date(req.body.expectedCloseDate+'T00:00:00.000Z'):undefined:null;
    if(!title||!Number.isFinite(value)||value<0||value>21000000||!['NEW','QUALIFIED','PROPOSAL','NEGOTIATION','WON','LOST'].includes(stage)||(req.body?.source&&!source)||close===undefined)return res.status(400).json({error:'Provide a lead title and valid value, stage, source, and close date'});
    try{
      if(!await prisma.crmLead.findFirst({where:{id:leadId,organizationId},select:{id:true}}))return res.status(404).json({error:'Lead not found'});
      if(customerId&&!await prisma.crmCustomer.findFirst({where:{id:customerId,organizationId},select:{id:true}}))return res.status(400).json({error:'Customer does not belong to this organization'});
      if(contactId&&!await prisma.crmContact.findFirst({where:{id:contactId,organizationId,...(customerId?{customerId}:{})},select:{id:true}}))return res.status(400).json({error:'Contact does not belong to this organization or selected customer'});
      const lead=await prisma.crmLead.update({where:{id:leadId},data:{title,customerId,contactId,estimatedValueCents:Math.round(value*100),stage,source,notes,expectedCloseDate:close},include:{customer:{select:{id:true,name:true}},contact:{select:{id:true,firstName:true,lastName:true,email:true}}}});
      await prisma.auditEvent.create({data:{organizationId,actorUserId:req.auth!.userId,action:'crm.lead_updated',entityType:'CrmLead',entityId:lead.id,metadata:{stage}}});return res.json({lead});
    }catch(error){logger.error({err:error},'CRM lead update failed');return res.status(500).json({error:'Unable to update lead'});}
  });



  // ERP starter: organization-scoped invoices and expenses.
  const erpWriters = [MembershipRole.OWNER, MembershipRole.ADMIN, MembershipRole.MEMBER];
  const invoiceStatuses = ['DRAFT', 'SENT', 'PAID', 'OVERDUE', 'CANCELLED'];
  const expenseStatuses = ['PENDING', 'APPROVED', 'PAID'];
  app.get('/api/organizations/:organizationId/erp/invoices', requireAuth, requireOrganizationRole(), async (req, res) => {
    try {
      const invoices = await prisma.erpInvoice.findMany({ where: { organizationId: req.params.organizationId! }, orderBy: { updatedAt: 'desc' }, take: 300 });
      return res.json({ invoices });
    } catch (error) { logger.error({ err: error }, 'ERP invoices failed'); return res.status(500).json({ error: 'Unable to load invoices' }); }
  });
  app.post('/api/organizations/:organizationId/erp/invoices', requireAuth, requireOrganizationRole(...erpWriters), async (req, res) => {
    const organizationId = req.params.organizationId!;
    const invoiceNumber = cleanName(req.body?.invoiceNumber, 50);
    const customerName = cleanName(req.body?.customerName, 120);
    const amount = Number(req.body?.amount);
    const status = req.body?.status ?? 'DRAFT';
    const dueDate = req.body?.dueDate ? (typeof req.body.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.body.dueDate) ? new Date(req.body.dueDate + 'T00:00:00.000Z') : undefined) : null;
    const notes = typeof req.body?.notes === 'string' ? req.body.notes.trim().slice(0, 2000) || null : null;
    if (!invoiceNumber || !customerName || !Number.isFinite(amount) || amount <= 0 || amount > 21000000 || !invoiceStatuses.includes(status) || dueDate === undefined) return res.status(400).json({ error: 'Provide an invoice number, customer, valid positive amount, status, and due date' });
    try {
      const invoice = await prisma.erpInvoice.create({ data: { organizationId, invoiceNumber, customerName, amountCents: Math.round(amount * 100), status, dueDate, notes } });
      await prisma.auditEvent.create({ data: { organizationId, actorUserId: req.auth!.userId, action: 'erp.invoice_created', entityType: 'ErpInvoice', entityId: invoice.id } });
      return res.status(201).json({ invoice });
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') return res.status(409).json({ error: 'That invoice number already exists in this workspace' });
      logger.error({ err: error }, 'ERP invoice create failed'); return res.status(500).json({ error: 'Unable to create invoice' });
    }
  });
  app.patch('/api/organizations/:organizationId/erp/invoices/:invoiceId/status', requireAuth, requireOrganizationRole(...erpWriters), async (req, res) => {
    const organizationId = req.params.organizationId!, invoiceId = req.params.invoiceId!, status = req.body?.status;
    if (!invoiceStatuses.includes(status)) return res.status(400).json({ error: 'Provide a valid invoice status' });
    try {
      const existing = await prisma.erpInvoice.findFirst({ where: { id: invoiceId, organizationId }, select: { id: true } });
      if (!existing) return res.status(404).json({ error: 'Invoice not found' });
      const invoice = await prisma.erpInvoice.update({ where: { id: invoiceId }, data: { status } });
      await prisma.auditEvent.create({ data: { organizationId, actorUserId: req.auth!.userId, action: 'erp.invoice_status_changed', entityType: 'ErpInvoice', entityId: invoice.id, metadata: { status } } });
      return res.json({ invoice });
    } catch (error) { logger.error({ err: error }, 'ERP invoice status update failed'); return res.status(500).json({ error: 'Unable to update invoice status' }); }
  });
  app.get('/api/organizations/:organizationId/erp/expenses', requireAuth, requireOrganizationRole(), async (req, res) => {
    try {
      const expenses = await prisma.erpExpense.findMany({ where: { organizationId: req.params.organizationId! }, orderBy: { incurredAt: 'desc' }, take: 300 });
      return res.json({ expenses });
    } catch (error) { logger.error({ err: error }, 'ERP expenses failed'); return res.status(500).json({ error: 'Unable to load expenses' }); }
  });
  app.post('/api/organizations/:organizationId/erp/expenses', requireAuth, requireOrganizationRole(...erpWriters), async (req, res) => {
    const organizationId = req.params.organizationId!;
    const title = cleanName(req.body?.title, 140), category = cleanName(req.body?.category, 80);
    const vendor = req.body?.vendor == null || req.body.vendor === '' ? null : cleanName(req.body.vendor, 120);
    const amount = Number(req.body?.amount), status = req.body?.status ?? 'PENDING';
    const incurredAt = req.body?.incurredAt ? (typeof req.body.incurredAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.body.incurredAt) ? new Date(req.body.incurredAt + 'T00:00:00.000Z') : undefined) : new Date();
    const notes = typeof req.body?.notes === 'string' ? req.body.notes.trim().slice(0, 2000) || null : null;
    if (!title || !category || (req.body?.vendor && !vendor) || !Number.isFinite(amount) || amount <= 0 || amount > 21000000 || !expenseStatuses.includes(status) || incurredAt === undefined) return res.status(400).json({ error: 'Provide an expense title, category, valid amount, status, and date' });
    try {
      const expense = await prisma.erpExpense.create({ data: { organizationId, title, category, vendor, amountCents: Math.round(amount * 100), status, incurredAt, notes } });
      await prisma.auditEvent.create({ data: { organizationId, actorUserId: req.auth!.userId, action: 'erp.expense_created', entityType: 'ErpExpense', entityId: expense.id } });
      return res.status(201).json({ expense });
    } catch (error) { logger.error({ err: error }, 'ERP expense create failed'); return res.status(500).json({ error: 'Unable to create expense' }); }
  });
  app.patch('/api/organizations/:organizationId/erp/expenses/:expenseId/status', requireAuth, requireOrganizationRole(...erpWriters), async (req, res) => {
    const organizationId = req.params.organizationId!, expenseId = req.params.expenseId!, status = req.body?.status;
    if (!expenseStatuses.includes(status)) return res.status(400).json({ error: 'Provide a valid expense status' });
    try {
      const existing = await prisma.erpExpense.findFirst({ where: { id: expenseId, organizationId }, select: { id: true } });
      if (!existing) return res.status(404).json({ error: 'Expense not found' });
      const expense = await prisma.erpExpense.update({ where: { id: expenseId }, data: { status } });
      await prisma.auditEvent.create({ data: { organizationId, actorUserId: req.auth!.userId, action: 'erp.expense_status_changed', entityType: 'ErpExpense', entityId: expense.id, metadata: { status } } });
      return res.json({ expense });
    } catch (error) { logger.error({ err: error }, 'ERP expense status update failed'); return res.status(500).json({ error: 'Unable to update expense status' }); }
  });

  app.use((_request, response) => response.status(404).json({ error: 'Not found' }));
  return app;
}
