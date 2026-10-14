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

test('core ERP employee and department access is scoped to the organization', async () => {
  const ownerA: Client = {};
  const ownerB: Client = {};
  await request('/api/auth/login', { method: 'POST', body: json({ email: 'owner@example.com', password: 'correct horse battery staple' }) }, ownerA);
  await request('/api/auth/login', { method: 'POST', body: json({ email: 'owner-b@example.com', password: 'another correct horse battery staple' }) }, ownerB);
  const orgA = (await (await request('/api/organizations', {}, ownerA)).json() as { organizations: Array<{ id: string }> }).organizations[0]!;
  const orgB = (await (await request('/api/organizations', {}, ownerB)).json() as { organizations: Array<{ id: string }> }).organizations[0]!;
  const departmentAResponse = await request(`/api/organizations/${orgA.id}/departments`, { method: 'POST', body: json({ name: 'Engineering' }) }, ownerA);
  assert.equal(departmentAResponse.status, 201);
  const departmentA = ((await departmentAResponse.json()) as { department: { id: string } }).department;
  const departmentBResponse = await request(`/api/organizations/${orgB.id}/departments`, { method: 'POST', body: json({ name: 'Operations' }) }, ownerB);
  assert.equal(departmentBResponse.status, 201);
  const departmentB = ((await departmentBResponse.json()) as { department: { id: string } }).department;
  const wrongTenantDepartment = await request(`/api/organizations/${orgA.id}/employees`, { method: 'POST', body: json({ employeeCode: 'VZ-001', firstName: 'Test', lastName: 'Person', departmentId: departmentB.id }) }, ownerA);
  assert.equal(wrongTenantDepartment.status, 400);
  const employeeResponse = await request(`/api/organizations/${orgA.id}/employees`, { method: 'POST', body: json({ employeeCode: 'VZ-001', firstName: 'Taylor', lastName: 'Jordan', workEmail: 'taylor@example.com', jobTitle: 'Engineer', departmentId: departmentA.id, startDate: '2026-10-01' }) }, ownerA);
  assert.equal(employeeResponse.status, 201);
  const employee = ((await employeeResponse.json()) as { employee: { id: string; department: { name: string }; status: string } }).employee;
  assert.equal(employee.department.name, 'Engineering');
  assert.equal(employee.status, 'ACTIVE');
  assert.equal((await request(`/api/organizations/${orgB.id}/employees`, {}, ownerA)).status, 404);
  assert.equal((await request(`/api/organizations/${orgA.id}/departments`, { method: 'POST', body: json({ name: 'Restricted team' }) }, ownerB)).status, 403);
  const changed = await request(`/api/organizations/${orgA.id}/employees/${employee.id}/status`, { method: 'PATCH', body: json({ status: 'ON_LEAVE' }) }, ownerA);
  assert.equal(changed.status, 200);
  assert.equal(((await changed.json()) as { employee: { status: string } }).employee.status, 'ON_LEAVE');
});


test('workspace invitations can be created and accepted by a new account', async () => {
  const owner: Client = {};
  const login = await request('/api/auth/login', { method: 'POST', body: json({ email: 'owner@example.com', password: 'correct horse battery staple' }) }, owner);
  assert.equal(login.status, 200);
  const orgs = (await (await request('/api/organizations', {}, owner)).json() as { organizations: Array<{ id: string }> }).organizations;
  const organization = orgs[0]!;
  const inviteResponse = await request(`/api/organizations/${organization.id}/members`, {
    method: 'POST',
    body: json({ email: 'new-invite@example.com', role: 'VIEWER' }),
  }, owner);
  assert.equal(inviteResponse.status, 201);
  const inviteBody = await inviteResponse.json() as { invitation: { invitationUrl: string; email: string; role: string; expiresAt: string } };
  assert.equal(inviteBody.invitation.email, 'new-invite@example.com');
  assert.equal(inviteBody.invitation.role, 'VIEWER');
  assert.ok(new Date(inviteBody.invitation.expiresAt).getTime() > Date.now());
  const token = new URL(inviteBody.invitation.invitationUrl).searchParams.get('invite');
  assert.ok(token);
  const signup = await request('/api/auth/signup', {
    method: 'POST',
    body: json({ name: 'Invited Person', email: 'new-invite@example.com', password: 'a sufficiently long password', invitationToken: token }),
  });
  assert.equal(signup.status, 201);
  const body = await signup.json() as { organizations: Array<{ id: string; role: string }> };
  assert.ok(body.organizations.some((item) => item.id === organization.id && item.role === 'VIEWER'));
  const invitation = await prisma.organizationInvitation.findUnique({ where: { tokenHash: (await import('node:crypto')).createHash('sha256').update(token!).digest('hex') } });
  assert.ok(invitation?.acceptedAt);
  const duplicateAcceptance = await request('/api/auth/signup', {
    method: 'POST',
    body: json({ name: 'Another Person', email: 'another-invite@example.com', password: 'a sufficiently long password', invitationToken: token }),
  });
  assert.equal(duplicateAcceptance.status, 400);
});


test('CRM customer, contact, and lead records are organization-scoped', async () => {
  const ownerA: Client = {}, ownerB: Client = {};
  await request('/api/auth/login', { method: 'POST', body: json({ email: 'owner@example.com', password: 'correct horse battery staple' }) }, ownerA);
  await request('/api/auth/login', { method: 'POST', body: json({ email: 'owner-b@example.com', password: 'another correct horse battery staple' }) }, ownerB);
  const orgA=(await (await request('/api/organizations',{},ownerA)).json() as {organizations:Array<{id:string}>}).organizations[0]!;
  const orgB=(await (await request('/api/organizations',{},ownerB)).json() as {organizations:Array<{id:string}>}).organizations[0]!;
  const cRes=await request(`/api/organizations/${orgA.id}/crm/customers`,{method:'POST',body:json({name:'Northwind CRM Test',email:'sales@northwind.test',status:'PROSPECT'})},ownerA);
  assert.equal(cRes.status,201);
  const customer=((await cRes.json()) as {customer:{id:string;status:string}}).customer;assert.equal(customer.status,'PROSPECT');
  const pRes=await request(`/api/organizations/${orgA.id}/crm/contacts`,{method:'POST',body:json({customerId:customer.id,firstName:'Casey',lastName:'Contact',email:'casey@northwind.test'})},ownerA);
  assert.equal(pRes.status,201);const contact=((await pRes.json()) as {contact:{id:string;customer:{id:string}}}).contact;assert.equal(contact.customer.id,customer.id);
  const lRes=await request(`/api/organizations/${orgA.id}/crm/leads`,{method:'POST',body:json({title:'Northwind renewal',customerId:customer.id,contactId:contact.id,estimatedValue:12500,stage:'QUALIFIED'})},ownerA);
  assert.equal(lRes.status,201);const lead=((await lRes.json()) as {lead:{id:string;estimatedValueCents:number;stage:string}}).lead;assert.equal(lead.estimatedValueCents,1250000);assert.equal(lead.stage,'QUALIFIED');
  assert.equal((await request(`/api/organizations/${orgB.id}/crm/customers`,{},ownerA)).status,404);
  const otherRes=await request(`/api/organizations/${orgB.id}/crm/customers`,{method:'POST',body:json({name:'Other Org CRM Customer'})},ownerB);assert.equal(otherRes.status,201);
  const foreignCustomer=((await otherRes.json()) as {customer:{id:string}}).customer;
  const cross=await request(`/api/organizations/${orgA.id}/crm/leads`,{method:'POST',body:json({title:'Foreign lead',customerId:foreignCustomer.id})},ownerA);assert.equal(cross.status,400);
});
