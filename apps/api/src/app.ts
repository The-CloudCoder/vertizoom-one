import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { prisma } from '@vertizoom/database';
import { MembershipRole } from '@prisma/client';

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
    if (!name || !email || typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH || password.length > 128 || !organizationName) {
      return response.status(400).json({ error: 'Provide a valid name, email, organization name, and password of at least 12 characters.' });
    }
    try {
      const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
      if (existing) return response.status(409).json({ error: 'An account with this email already exists' });
      const passwordHash = await hashPassword(password);
      const slug = `${slugify(organizationName)}-${randomBytes(3).toString('hex')}`;
      const token = randomBytes(32).toString('base64url');
      const result = await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({ data: { name, email, passwordHash } });
        const organization = await tx.organization.create({ data: { name: organizationName, slug } });
        await tx.organizationMember.create({ data: { organizationId: organization.id, userId: user.id, role: MembershipRole.OWNER } });
        await tx.auditEvent.create({ data: { organizationId: organization.id, actorUserId: user.id, action: 'organization.created', entityType: 'Organization', entityId: organization.id } });
        await tx.session.create({ data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + SESSION_TTL_MS) } });
        return { user, organization };
      });
      setSessionCookie(response, token);
      return response.status(201).json({ user: publicUser(result.user), organizations: [{ id: result.organization.id, name: result.organization.name, slug: result.organization.slug, role: MembershipRole.OWNER }] });
    } catch (error) {
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

  app.post('/api/organizations/:organizationId/members', requireAuth, requireOrganizationRole(MembershipRole.OWNER, MembershipRole.ADMIN), async (request, response) => {
    const email = normalizeEmail(request.body?.email);
    const role = request.body?.role;
    if (!email || ![MembershipRole.MEMBER, MembershipRole.VIEWER].includes(role)) return response.status(400).json({ error: 'Provide a valid email and role MEMBER or VIEWER' });
    try {
      const user = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true, name: true } });
      if (!user) return response.status(404).json({ error: 'User account not found. Invitations by email are not supported yet.' });
      const membership = await prisma.organizationMember.create({ data: { organizationId: request.params.organizationId, userId: user.id, role } });
      await prisma.auditEvent.create({ data: { organizationId: request.params.organizationId, actorUserId: request.auth!.userId, action: 'organization.member_added', entityType: 'OrganizationMember', entityId: membership.id, metadata: { role } } });
      return response.status(201).json({ member: { id: membership.id, role: membership.role, createdAt: membership.createdAt, user } });
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') return response.status(409).json({ error: 'User is already a member of this organization' });
      logger.error({ err: error }, 'Adding organization member failed');
      return response.status(500).json({ error: 'Unable to add organization member' });
    }
  });

  app.get('/api/organizations/:organizationId/members', requireAuth, requireOrganizationRole(), async (request, response) => {
    const members = await prisma.organizationMember.findMany({ where: { organizationId: request.params.organizationId }, include: { user: { select: { id: true, name: true, email: true } } }, orderBy: { createdAt: 'asc' } });
    return response.status(200).json({ members: members.map(({ id, role, createdAt, user }) => ({ id, role, createdAt, user })) });
  });

  app.patch('/api/organizations/:organizationId/members/:memberId/role', requireAuth, requireOrganizationRole(MembershipRole.OWNER), async (request, response) => {
    const role = request.body?.role;
    if (![MembershipRole.ADMIN, MembershipRole.MEMBER, MembershipRole.VIEWER].includes(role)) return response.status(400).json({ error: 'Role must be ADMIN, MEMBER, or VIEWER. Ownership transfer is not supported yet.' });
    try {
      const target = await prisma.organizationMember.findFirst({ where: { id: request.params.memberId, organizationId: request.params.organizationId } });
      if (!target || target.role === MembershipRole.OWNER) return response.status(404).json({ error: 'Organization member not found' });
      const updated = await prisma.organizationMember.update({ where: { id: target.id }, data: { role } });
      await prisma.auditEvent.create({ data: { organizationId: request.params.organizationId, actorUserId: request.auth!.userId, action: 'organization.member_role_changed', entityType: 'OrganizationMember', entityId: updated.id, metadata: { role } } });
      return response.status(200).json({ member: { id: updated.id, userId: updated.userId, role: updated.role } });
    } catch (error) { logger.error({ err: error }, 'Role update failed'); return response.status(500).json({ error: 'Unable to update member role' }); }
  });

  app.use((_request, response) => response.status(404).json({ error: 'Not found' }));
  return app;
}
