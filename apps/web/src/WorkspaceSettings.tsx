import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Activity, Building2, Check, Clock3, Copy, LoaderCircle, Save, ShieldCheck, UserPlus, Users, X } from 'lucide-react';

type Role = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';
type Organization = { id: string; name: string; slug: string; role: Role };
type Member = { id: string; role: Role; createdAt: string; user: { id: string; name: string | null; email: string } };
type Invitation = { id: string; email: string; role: 'MEMBER' | 'VIEWER'; expiresAt: string; createdAt: string };
type AuditEvent = { id: string; action: string; entityType: string | null; entityId: string | null; metadata: unknown; createdAt: string; actor: { name: string | null; email: string } | null };
type Props = { organization: Organization; onOrganizationUpdated: (organization: Organization) => void };

const roleLabel: Record<Role, string> = { OWNER: 'Owner', ADMIN: 'Admin', MEMBER: 'Member', VIEWER: 'Viewer' };
const actionLabel: Record<string, string> = {
  'organization.created': 'Workspace created',
  'organization.updated': 'Workspace settings updated',
  'organization.member_added': 'Member added',
  'organization.member_role_changed': 'Member role changed',
  'organization.invitation_created': 'Workspace invitation created',
  'organization.invitation_accepted': 'Workspace invitation accepted',
  'organization.invitation_revoked': 'Workspace invitation revoked',
  'employee.created': 'Employee added',
  'employee.updated': 'Employee updated',
  'employee.status_changed': 'Employee status changed',
  'department.created': 'Department created',
  'department.updated': 'Department updated',
};

export default function WorkspaceSettings({ organization, onOrganizationUpdated }: Props) {
  const canManageMembers = organization.role === 'OWNER' || organization.role === 'ADMIN';
  const isOwner = organization.role === 'OWNER';
  const [name, setName] = useState(organization.name);
  const [members, setMembers] = useState<Member[]>([]);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [createdInvitationUrl, setCreatedInvitationUrl] = useState('');
  const [email, setEmail] = useState('');
  const [newRole, setNewRole] = useState<'MEMBER' | 'VIEWER'>('MEMBER');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [memberResponse, eventResponse, invitationResponse] = await Promise.all([
        fetch('/api/organizations/' + organization.id + '/members', { credentials: 'include' }),
        fetch('/api/organizations/' + organization.id + '/audit-events', { credentials: 'include' }),
        fetch('/api/organizations/' + organization.id + '/invitations', { credentials: 'include' }),
      ]);
      const memberBody = await memberResponse.json() as { members?: Member[]; error?: string };
      const eventBody = await eventResponse.json() as { events?: AuditEvent[]; error?: string };
      const invitationBody = await invitationResponse.json() as { invitations?: Invitation[]; error?: string };
      if (!memberResponse.ok) throw new Error(memberBody.error ?? 'Unable to load members');
      if (!eventResponse.ok) throw new Error(eventBody.error ?? 'Unable to load audit history');
      if (!invitationResponse.ok && invitationResponse.status !== 403) throw new Error(invitationBody.error ?? 'Unable to load invitations');
      setMembers(memberBody.members ?? []);
      setEvents(eventBody.events ?? []);
      setInvitations(invitationBody.invitations ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load workspace settings');
    } finally { setLoading(false); }
  }, [organization.id]);

  useEffect(() => { void load(); }, [load]);

  async function send(path: string, method: 'POST' | 'PATCH', payload: unknown) {
    const response = await fetch('/api/organizations/' + organization.id + path, {
      method, credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    const body = await response.json() as { error?: string; organization?: Organization; member?: Member; invitation?: Invitation & { invitationUrl: string } };
    if (!response.ok) throw new Error(body.error ?? 'Request failed');
    return body;
  }

  async function saveOrganization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(''); setNotice('');
    try {
      const body = await send('', 'PATCH', { name: name.trim() });
      if (body.organization) onOrganizationUpdated({ ...organization, ...body.organization });
      setNotice('Workspace settings saved.');
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to save workspace'); }
    finally { setSaving(false); }
  }

  async function addMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(''); setNotice('');
    try {
      const result = await send('/members', 'POST', { email: email.trim(), role: newRole });
      setEmail('');
      if (result.invitation?.invitationUrl) { setCreatedInvitationUrl(result.invitation.invitationUrl); setNotice('Invitation created. Copy the link and share it with your colleague.'); }
      else { setCreatedInvitationUrl(''); setNotice('Member added to the workspace.'); }
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to add member'); }
    finally { setSaving(false); }
  }

  async function revokeInvitation(invitation: Invitation) {
    setError(''); setNotice('');
    try {
      const response = await fetch('/api/organizations/' + organization.id + '/invitations/' + invitation.id, { method: 'DELETE', credentials: 'include' });
      if (!response.ok) { const body = await response.json() as { error?: string }; throw new Error(body.error ?? 'Unable to revoke invitation'); }
      setNotice('Invitation revoked.'); await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to revoke invitation'); }
  }

  async function copyInvitationLink() {
    try { await navigator.clipboard.writeText(createdInvitationUrl); setNotice('Invitation link copied. Share it with the invitee.'); }
    catch { setError('Unable to copy automatically. Select and copy the invitation link manually.'); }
  }

  async function updateRole(member: Member, role: Role) {
    setError(''); setNotice('');
    try {
      await send('/members/' + member.id + '/role', 'PATCH', { role });
      setNotice('Member role updated.'); await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to update role'); }
  }

  return <div className="settings-workspace">
    <header className="settings-heading"><div><span className="settings-eyebrow">WORKSPACE ADMINISTRATION</span><h1>Workspace settings</h1><p>Manage your organization, people, and security activity.</p></div><button className="settings-refresh" onClick={() => void load()} disabled={loading}><Activity size={15} /> Refresh</button></header>
    {error && <div className="settings-message error" role="alert">{error}</div>}
    {notice && <div className="settings-message success" role="status"><Check size={15} />{notice}</div>}
    <section className="settings-card">
      <div className="settings-card-heading"><span className="settings-icon blue"><Building2 size={19} /></span><div><h2>Organization profile</h2><p>Workspace identity and business details.</p></div></div>
      <form className="settings-profile-form" onSubmit={(event) => void saveOrganization(event)}>
        <label>Organization name<input required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} disabled={!isOwner} /></label>
        <label>Workspace slug<input value={organization.slug} readOnly /><small>Used as a stable workspace identifier.</small></label>
        <div className="settings-form-foot"><span>{isOwner ? 'Only the owner can change the organization name.' : 'Only the owner can change organization details.'}</span>{isOwner && <button type="submit" disabled={saving || !name.trim() || name.trim() === organization.name}><Save size={15} />{saving ? 'Saving…' : 'Save changes'}</button>}</div>
      </form>
    </section>
    <section className="settings-card">
      <div className="settings-card-heading"><span className="settings-icon violet"><Users size={19} /></span><div><h2>Members & access</h2><p>{members.length} workspace {members.length === 1 ? 'member' : 'members'} · Manage who can access this organization.</p></div></div>
      {canManageMembers && <form className="settings-invite-form" onSubmit={(event) => void addMember(event)}><label>Email to invite or add<input type="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="colleague@company.com" /></label><label>Role<select value={newRole} onChange={(event) => setNewRole(event.target.value as 'MEMBER' | 'VIEWER')}><option value="MEMBER">Member</option><option value="VIEWER">Viewer</option></select></label><button type="submit" disabled={saving || !email.trim()}><UserPlus size={15} /> Invite / add</button></form>}
      {createdInvitationUrl && <div className="settings-invitation-created"><div><strong>Share invitation link</strong><span>This link expires in 7 days and can only be used once by the invited email address.</span></div><input aria-label="Invitation link" readOnly value={createdInvitationUrl} onFocus={(event) => event.currentTarget.select()} /><button type="button" onClick={() => void copyInvitationLink()}><Copy size={14} /> Copy link</button></div>}
      {canManageMembers && invitations.length > 0 && <div className="settings-pending-invitations"><h3>Pending invitations <span>{invitations.length}</span></h3>{invitations.map((invitation) => <article key={invitation.id}><div><strong>{invitation.email}</strong><span>{roleLabel[invitation.role]} · Expires {new Date(invitation.expiresAt).toLocaleDateString()}</span></div><button type="button" aria-label={'Revoke invitation for ' + invitation.email} onClick={() => void revokeInvitation(invitation)}><X size={14} /> Revoke</button></article>)}</div>}
      {!canManageMembers && <p className="settings-helper">Only workspace owners and admins can add members. Only workspace owners and admins can manage invitations.</p>}
      {loading ? <div className="settings-loading"><LoaderCircle size={18} /> Loading members…</div> : <div className="settings-member-list">{members.map((member) => <article className="settings-member" key={member.id}><span className="settings-member-avatar">{(member.user.name || member.user.email).slice(0, 1).toUpperCase()}</span><div className="settings-member-info"><strong>{member.user.name || member.user.email}</strong><span>{member.user.email}</span></div><span className={'settings-role role-' + member.role.toLowerCase()}>{roleLabel[member.role]}</span>{isOwner && member.role !== 'OWNER' && <select aria-label={'Role for ' + member.user.email} value={member.role} onChange={(event) => void updateRole(member, event.target.value as Role)}><option value="ADMIN">Admin</option><option value="MEMBER">Member</option><option value="VIEWER">Viewer</option></select>}</article>)}</div>}
      {isOwner && <p className="settings-helper"><ShieldCheck size={14} /> Owners can change member roles. Ownership transfer and removing members are not available yet.</p>}
    </section>
    <section className="settings-card">
      <div className="settings-card-heading"><span className="settings-icon amber"><Clock3 size={19} /></span><div><h2>Audit history</h2><p>Recent security and workspace changes, newest first.</p></div></div>
      {loading ? <div className="settings-loading"><LoaderCircle size={18} /> Loading activity…</div> : events.length === 0 ? <p className="settings-empty">No workspace activity has been recorded yet.</p> : <div className="settings-audit-list">{events.map((item) => <article className="settings-audit-item" key={item.id}><span className="settings-audit-dot" /><div><strong>{actionLabel[item.action] ?? item.action.replace(/[._]/g, ' ')}</strong><p>{item.actor?.name || item.actor?.email || 'System'}{item.entityType ? ' · ' + item.entityType : ''}</p></div><time>{new Date(item.createdAt).toLocaleString()}</time></article>)}</div>}
    </section>
  </div>;
}
