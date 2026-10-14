import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from './app.js';
import { prisma } from '@vertizoom/database';

const testUrl = process.env.DATABASE_URL ?? '';
if (!testUrl.includes('vertizoom_one_test')) throw new Error('Auth tests require a dedicated database URL containing vertizoom_one_test. See .env.test.example.');

const app = createApp();
let server: ReturnType<typeof app.listen> | undefined;
let baseUrl = '';
const origin = process.env.WEB_ORIGIN ?? 'http://localhost:5173';
type Client = { cookie?: string };
async function request(path: string, options: RequestInit = {}, client: Client = {}) {
  const headers = new Headers(options.headers);
  headers.set('Origin', origin);
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (client.cookie) headers.set('Cookie', client.cookie);
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers, redirect: 'manual' });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) client.cookie = setCookie.split(';', 1)[0];
  return response;
}
const json = (value: unknown) => JSON.stringify(value);
before(async () => {
  await prisma.auditEvent.deleteMany();
  await prisma.session.deleteMany();
  await prisma.organizationMember.deleteMany();
  await prisma.organization.deleteMany();
  await prisma.user.deleteMany();
  const testServer = app.listen(0);
  server = testServer;
  const address = testServer.address();
  if (!address || typeof address === 'string') throw new Error('Unable to start test server');
  baseUrl = `http://127.0.0.1:${address.port}`;
});
after(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await prisma.auditEvent.deleteMany();
  await prisma.session.deleteMany();
  await prisma.organizationMember.deleteMany();
  await prisma.organization.deleteMany();
  await prisma.user.deleteMany();
  await prisma.$disconnect();
});
test('signup creates a normalized user, owner organization, password hash, and session cookie', async () => {
  const client: Client = {};
  const response = await request('/api/auth/signup', { method: 'POST', body: json({ name: 'Owner One', email: 'OWNER@example.com', password: 'correct horse battery staple', organizationName: 'Alpha Workspace' }) }, client);
  assert.equal(response.status, 201);
  assert.match(client.cookie ?? '', /^vz_session=/);
  assert.match(response.headers.get('set-cookie') ?? '', /HttpOnly/);
  assert.match(response.headers.get('set-cookie') ?? '', /SameSite=Lax/);
  const body = await response.json() as { user: { email: string }; organizations: Array<{ role: string }> };
  assert.equal(body.user.email, 'owner@example.com');
  assert.equal(body.organizations[0]?.role, 'OWNER');
  const user = await prisma.user.findUnique({ where: { email: 'owner@example.com' } });
  assert.ok(user);
  assert.ok(user.passwordHash);
  assert.notEqual(user.passwordHash, 'correct horse battery staple');
  assert.match(user.passwordHash, /^scrypt\$/);
  assert.equal(await prisma.session.count({ where: { userId: user.id, revokedAt: null } }), 1);
});
test('rejects weak passwords and duplicate email addresses', async () => {
  const weak = await request('/api/auth/signup', { method: 'POST', body: json({ name: 'Bad Password', email: 'weak@example.com', password: 'short', organizationName: 'Weak Org' }) });
  assert.equal(weak.status, 400);
  const duplicate = await request('/api/auth/signup', { method: 'POST', body: json({ name: 'Duplicate', email: 'OWNER@example.com', password: 'correct horse battery staple', organizationName: 'Other Org' }) });
  assert.equal(duplicate.status, 409);
});
test('login, current-user, and logout manage sessions', async () => {
  const client: Client = {};
  const login = await request('/api/auth/login', { method: 'POST', body: json({ email: 'owner@example.com', password: 'correct horse battery staple' }) }, client);
  assert.equal(login.status, 200);
  assert.ok(client.cookie);
  assert.equal((await request('/api/auth/me', {}, client)).status, 200);
  assert.equal((await request('/api/auth/logout', { method: 'POST' }, client)).status, 204);
  assert.equal((await request('/api/auth/me', {}, client)).status, 401);
});
test('organization membership is isolated by tenant and protected by roles', async () => {
  const ownerA: Client = {};
  const ownerB: Client = {};
  await request('/api/auth/login', { method: 'POST', body: json({ email: 'owner@example.com', password: 'correct horse battery staple' }) }, ownerA);
  const signupB = await request('/api/auth/signup', { method: 'POST', body: json({ name: 'Owner Two', email: 'owner-b@example.com', password: 'another correct horse battery staple', organizationName: 'Beta Workspace' }) }, ownerB);
  assert.equal(signupB.status, 201);
  const orgA = (await (await request('/api/organizations', {}, ownerA)).json() as { organizations: Array<{ id: string }> }).organizations[0];
  const orgB = (await (await request('/api/organizations', {}, ownerB)).json() as { organizations: Array<{ id: string }> }).organizations[0];
  assert.ok(orgA && orgB);
  assert.equal((await request(`/api/organizations/${orgB.id}/members`, {}, ownerA)).status, 404);
  const add = await request(`/api/organizations/${orgA.id}/members`, { method: 'POST', body: json({ email: 'owner-b@example.com', role: 'VIEWER' }) }, ownerA);
  assert.equal(add.status, 201);
  const memberId = ((await add.json()) as { member: { id: string } }).member.id;
  assert.equal((await request(`/api/organizations/${orgA.id}/members/${memberId}/role`, { method: 'PATCH', body: json({ role: 'ADMIN' }) }, ownerB)).status, 403);
  const members = (await (await request(`/api/organizations/${orgA.id}/members`, {}, ownerA)).json() as { members: Array<{ user: { email: string }; role: string }> }).members;
  assert.ok(members.some((member) => member.user.email === 'owner-b@example.com' && member.role === 'VIEWER'));
  const memberLogin: Client = {};
  await request('/api/auth/login', { method: 'POST', body: json({ email: 'owner-b@example.com', password: 'another correct horse battery staple' }) }, memberLogin);
  assert.equal((await request(`/api/organizations/${orgA.id}/members/${memberId}/role`, { method: 'PATCH', body: json({ role: 'ADMIN' }) }, memberLogin)).status, 403);
});
test('rejects untrusted origins for mutating requests', async () => {
  const response = await fetch(`${baseUrl}/api/organizations`, { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: json({ name: 'Untrusted Org' }) });
  assert.equal(response.status, 403);
});
