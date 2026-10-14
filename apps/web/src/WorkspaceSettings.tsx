import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Activity, Building2, Check, Clock3, Copy, LoaderCircle, Save, ShieldCheck, UserPlus, Users, X } from 'lucide-react';

type Role = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';
type Organization = { id: string; name: string; slug: string; role: Role };
type Member = { id: string; role: Role; createdAt: string; user: { id: string; name: string | null; email: string } };
type Invitation = { id: string; email: string; role: 'MEMBER' | 'VIEWER'; expiresAt: string; createdAt: string };
type AuditEvent = { id: string; action: string; entityType: string | null; entityId: string | null; metadata: unknown; createdAt: string; actor: { name: string | null; email: string } | null };
type CompanyProfile = {
  legalName: string; logoUrl: string; addressLine1: string; addressLine2: string; city: string;
  state: string; postalCode: string; country: string; phone: string; businessEmail: string;
  website: string; gstin: string; pan: string; invoicePrefix: string; nextInvoiceNumber: number;
  currency: string; defaultTaxRate: number; paymentTerms: string; bankAccountName: string;
  bankName: string; bankAccountNumber: string; bankIfsc: string; upiId: string;
};
const emptyProfile: CompanyProfile = {
  legalName: '', logoUrl: '', addressLine1: '', addressLine2: '', city: '', state: '', postalCode: '',
  country: 'India', phone: '', businessEmail: '', website: '', gstin: '', pan: '', invoicePrefix: 'INV',
  nextInvoiceNumber: 1, currency: 'INR', defaultTaxRate: 0, paymentTerms: 'Payment due within 15 days',
  bankAccountName: '', bankName: '', bankAccountNumber: '', bankIfsc: '', upiId: '',
};

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
  const [profile, setProfile] = useState<CompanyProfile>(emptyProfile);
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
      const [memberResponse, eventResponse, invitationResponse, profileResponse] = await Promise.all([
        fetch('/api/organizations/' + organization.id + '/members', { credentials: 'include' }),
        fetch('/api/organizations/' + organization.id + '/audit-events', { credentials: 'include' }),
        fetch('/api/organizations/' + organization.id + '/invitations', { credentials: 'include' }),
        fetch('/api/organizations/' + organization.id + '/profile', { credentials: 'include' }),
      ]);
      const memberBody = await memberResponse.json() as { members?: Member[]; error?: string };
      const eventBody = await eventResponse.json() as { events?: AuditEvent[]; error?: string };
      const invitationBody = await invitationResponse.json() as { invitations?: Invitation[]; error?: string };
      const profileBody = await profileResponse.json() as { profile?: Partial<CompanyProfile> & { defaultTaxRateBps?: number }; error?: string };
      if (!memberResponse.ok) throw new Error(memberBody.error ?? 'Unable to load members');
      if (!eventResponse.ok) throw new Error(eventBody.error ?? 'Unable to load audit history');
      if (!profileResponse.ok) throw new Error(profileBody.error ?? 'Unable to load company profile');
      if (!invitationResponse.ok && invitationResponse.status !== 403) throw new Error(invitationBody.error ?? 'Unable to load invitations');
      setMembers(memberBody.members ?? []);
      setEvents(eventBody.events ?? []);
      setInvitations(invitationBody.invitations ?? []);
      if (profileBody.profile) {
        const loaded = profileBody.profile;
        setProfile({ ...emptyProfile, ...loaded, defaultTaxRate: (loaded.defaultTaxRateBps ?? 0) / 100 });
      }
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

  async function saveCompanyProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(''); setNotice('');
    try {
      const { defaultTaxRate, ...rest } = profile;
      const response = await fetch('/api/organizations/' + organization.id + '/profile', {
        method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...rest, defaultTaxRate }),
      });
      const body = await response.json() as { profile?: Partial<CompanyProfile> & { defaultTaxRateBps?: number }; error?: string };
      if (!response.ok) throw new Error(body.error ?? 'Unable to save company profile');
      if (body.profile) setProfile({ ...emptyProfile, ...body.profile, defaultTaxRate: (body.profile.defaultTaxRateBps ?? 0) / 100 });
      setNotice('Company profile and invoice settings saved.');
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to save company profile'); }
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
    <section className="settings-card company-profile-card">
      <div className="settings-card-heading"><span className="settings-icon blue"><Building2 size={19} /></span><div><h2>Company profile & invoicing</h2><p>Business identity, tax details, invoice numbering, and payment instructions.</p></div></div>
      {!canManageMembers && <p className="settings-helper">Only workspace owners and admins can edit company billing settings.</p>}
      <form className="settings-profile-form company-settings-form" onSubmit={(event) => void saveCompanyProfile(event)}>
        <div className="company-settings-section"><h3>Business details</h3><p>These details can be reused on invoices and other customer-facing documents.</p></div>
        <div className="company-settings-grid">
          <label>Legal / registered company name<input maxLength={160} value={profile.legalName} onChange={e => setProfile({...profile,legalName:e.target.value})} disabled={!canManageMembers} placeholder="Registered business name" /></label>
          <label>Logo URL<input type="url" maxLength={2048} value={profile.logoUrl} onChange={e => setProfile({...profile,logoUrl:e.target.value})} disabled={!canManageMembers} placeholder="https://example.com/logo.png" /><small>Use a publicly accessible HTTPS image URL.</small></label>
          <label>Business email<input type="email" maxLength={254} value={profile.businessEmail} onChange={e => setProfile({...profile,businessEmail:e.target.value})} disabled={!canManageMembers} placeholder="billing@company.com" /></label>
          <label>Phone<input type="tel" maxLength={30} value={profile.phone} onChange={e => setProfile({...profile,phone:e.target.value})} disabled={!canManageMembers} placeholder="+91 98765 43210" /></label>
          <label>Website<input type="url" maxLength={255} value={profile.website} onChange={e => setProfile({...profile,website:e.target.value})} disabled={!canManageMembers} placeholder="https://company.com" /></label>
          <label>GSTIN<input maxLength={15} value={profile.gstin} onChange={e => setProfile({...profile,gstin:e.target.value.toUpperCase()})} disabled={!canManageMembers} placeholder="15-character GSTIN" /></label>
          <label>PAN<input maxLength={10} value={profile.pan} onChange={e => setProfile({...profile,pan:e.target.value.toUpperCase()})} disabled={!canManageMembers} placeholder="ABCDE1234F" /></label>
        </div>
        <div className="company-settings-section"><h3>Registered address</h3></div>
        <div className="company-settings-grid">
          <label className="company-settings-wide">Address line 1<input maxLength={160} value={profile.addressLine1} onChange={e => setProfile({...profile,addressLine1:e.target.value})} disabled={!canManageMembers} /></label>
          <label className="company-settings-wide">Address line 2<input maxLength={160} value={profile.addressLine2} onChange={e => setProfile({...profile,addressLine2:e.target.value})} disabled={!canManageMembers} /></label>
          <label>City<input maxLength={100} value={profile.city} onChange={e => setProfile({...profile,city:e.target.value})} disabled={!canManageMembers} /></label>
          <label>State / Province<input maxLength={100} value={profile.state} onChange={e => setProfile({...profile,state:e.target.value})} disabled={!canManageMembers} /></label>
          <label>Postal code<input maxLength={20} value={profile.postalCode} onChange={e => setProfile({...profile,postalCode:e.target.value})} disabled={!canManageMembers} /></label>
          <label>Country<input maxLength={100} value={profile.country} onChange={e => setProfile({...profile,country:e.target.value})} disabled={!canManageMembers} /></label>
        </div>
        <div className="company-settings-section"><h3>Invoice defaults</h3><p>Use these values as defaults when creating new invoices. Existing invoices will not be changed.</p></div>
        <div className="company-settings-grid">
          <label>Invoice prefix<input required maxLength={12} value={profile.invoicePrefix} onChange={e => setProfile({...profile,invoicePrefix:e.target.value.toUpperCase()})} disabled={!canManageMembers} placeholder="INV" /></label>
          <label>Next invoice number<input required type="number" min="1" step="1" value={profile.nextInvoiceNumber} onChange={e => setProfile({...profile,nextInvoiceNumber:Number(e.target.value)})} disabled={!canManageMembers} /></label>
          <label>Currency<select value={profile.currency} onChange={e => setProfile({...profile,currency:e.target.value})} disabled={!canManageMembers}><option value="INR">INR — Indian Rupee (₹)</option><option value="USD">USD — US Dollar ($)</option><option value="GBP">GBP — British Pound (£)</option><option value="EUR">EUR — Euro (€)</option><option value="CAD">CAD — Canadian Dollar</option><option value="AUD">AUD — Australian Dollar</option><option value="AED">AED — UAE Dirham</option></select></label>
          <label>Default tax rate (%)<input type="number" min="0" max="100" step="0.01" value={profile.defaultTaxRate} onChange={e => setProfile({...profile,defaultTaxRate:Number(e.target.value)})} disabled={!canManageMembers} /></label>
          <label className="company-settings-wide">Payment terms<textarea rows={2} maxLength={500} value={profile.paymentTerms} onChange={e => setProfile({...profile,paymentTerms:e.target.value})} disabled={!canManageMembers} placeholder="e.g. Payment due within 15 days" /></label>
        </div>
        <div className="company-settings-section"><h3>Payment details</h3><p>These details can be displayed on invoices to help customers pay you.</p></div>
        <div className="company-settings-grid">
          <label>Account holder name<input maxLength={120} value={profile.bankAccountName} onChange={e => setProfile({...profile,bankAccountName:e.target.value})} disabled={!canManageMembers} /></label>
          <label>Bank name<input maxLength={120} value={profile.bankName} onChange={e => setProfile({...profile,bankName:e.target.value})} disabled={!canManageMembers} /></label>
          <label>Account number<input maxLength={34} value={profile.bankAccountNumber} onChange={e => setProfile({...profile,bankAccountNumber:e.target.value})} disabled={!canManageMembers} /></label>
          <label>IFSC<input maxLength={11} value={profile.bankIfsc} onChange={e => setProfile({...profile,bankIfsc:e.target.value.toUpperCase()})} disabled={!canManageMembers} placeholder="e.g. HDFC0001234" /></label>
          <label>UPI ID<input maxLength={100} value={profile.upiId} onChange={e => setProfile({...profile,upiId:e.target.value})} disabled={!canManageMembers} placeholder="company@bank" /></label>
        </div>
        {canManageMembers && <div className="settings-form-foot company-settings-actions"><span>Saved securely for this workspace. Invoice generation will use these defaults in a follow-up step.</span><button type="submit" disabled={saving}>{saving ? <><LoaderCircle size={15} /> Saving…</> : <><Save size={15} /> Save company settings</>}</button></div>}
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
