import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Building2, Users, UserPlus, Plus, RefreshCw, Search, BriefcaseBusiness, CalendarDays, Pencil } from 'lucide-react';

type Department = { id: string; name: string; description: string | null; createdAt: string; employeeCount: number };
type Employee = { id: string; employeeCode: string; firstName: string; lastName: string; workEmail: string | null; jobTitle: string | null; status: 'ACTIVE' | 'ON_LEAVE' | 'INACTIVE'; startDate: string | null; departmentId: string | null; department: { id: string; name: string } | null };
type Props = { organizationId: string; role: string };
const statusLabel: Record<Employee['status'], string> = { ACTIVE: 'Active', ON_LEAVE: 'On leave', INACTIVE: 'Inactive' };

export default function HRWorkspace({ organizationId, role }: Props) {
  const canManage = role === 'OWNER' || role === 'ADMIN';
  const [tab, setTab] = useState<'employees' | 'departments'>('employees');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [employeeForm, setEmployeeForm] = useState(false);
  const [departmentForm, setDepartmentForm] = useState(false);
  const [editingEmployeeId, setEditingEmployeeId] = useState<string | null>(null);
  const [editingDepartmentId, setEditingDepartmentId] = useState<string | null>(null);
  const [employeeCode, setEmployeeCode] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [workEmail, setWorkEmail] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [departmentName, setDepartmentName] = useState('');
  const [departmentDescription, setDepartmentDescription] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [employeeResponse, departmentResponse] = await Promise.all([
        fetch(`/api/organizations/${organizationId}/employees`, { credentials: 'include' }),
        fetch(`/api/organizations/${organizationId}/departments`, { credentials: 'include' }),
      ]);
      const employeeBody = await employeeResponse.json();
      const departmentBody = await departmentResponse.json();
      if (!employeeResponse.ok) throw new Error(employeeBody.error ?? 'Unable to load employees');
      if (!departmentResponse.ok) throw new Error(departmentBody.error ?? 'Unable to load departments');
      setEmployees(employeeBody.employees as Employee[]);
      setDepartments(departmentBody.departments as Department[]);
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to load people data'); }
    finally { setLoading(false); }
  }, [organizationId]);
  useEffect(() => { void load(); }, [load]);

  async function post(path: string, payload: unknown, method: 'POST' | 'PATCH' = 'POST') {
    const response = await fetch(`/api/organizations/${organizationId}/${path}`, {
      method, credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? 'Unable to save changes');
    return body;
  }
  async function addEmployee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(''); setNotice('');
    try {
      const payload = { employeeCode, firstName, lastName, workEmail: workEmail || (editingEmployeeId ? null : undefined), jobTitle: jobTitle || (editingEmployeeId ? null : undefined), departmentId: departmentId || (editingEmployeeId ? null : undefined), startDate: startDate || (editingEmployeeId ? null : undefined) };
      await post(editingEmployeeId ? 'employees/' + editingEmployeeId : 'employees', payload, editingEmployeeId ? 'PATCH' : 'POST');
      setEmployeeForm(false); setEditingEmployeeId(null); setEmployeeCode(''); setFirstName(''); setLastName(''); setWorkEmail(''); setJobTitle(''); setDepartmentId(''); setStartDate('');
      setNotice(editingEmployeeId ? 'Employee details updated.' : 'Employee added to your organization.'); await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to add employee'); }
    finally { setSaving(false); }
  }
  async function addDepartment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(''); setNotice('');
    try {
      await post(editingDepartmentId ? 'departments/' + editingDepartmentId : 'departments', { name: departmentName, description: departmentDescription || (editingDepartmentId ? null : undefined) }, editingDepartmentId ? 'PATCH' : 'POST');
      setDepartmentForm(false); setEditingDepartmentId(null); setDepartmentName(''); setDepartmentDescription('');
      setNotice(editingDepartmentId ? 'Department details updated.' : 'Department created.'); await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to create department'); }
    finally { setSaving(false); }
  }

  function editEmployee(employee: Employee) {
    setError(''); setNotice(''); setEditingEmployeeId(employee.id);
    setEmployeeCode(employee.employeeCode); setFirstName(employee.firstName); setLastName(employee.lastName);
    setWorkEmail(employee.workEmail ?? ''); setJobTitle(employee.jobTitle ?? '');
    setDepartmentId(employee.departmentId ?? ''); setStartDate(employee.startDate ? employee.startDate.slice(0, 10) : '');
    setEmployeeForm(true);
  }
  function editDepartment(department: Department) {
    setError(''); setNotice(''); setEditingDepartmentId(department.id);
    setDepartmentName(department.name); setDepartmentDescription(department.description ?? '');
    setDepartmentForm(true);
  }
  function openAddForm() {
    setError(''); setNotice('');
    if (tab === 'employees') {
      setEditingEmployeeId(null); setEmployeeCode(''); setFirstName(''); setLastName(''); setWorkEmail(''); setJobTitle(''); setDepartmentId(''); setStartDate(''); setEmployeeForm(true);
    } else {
      setEditingDepartmentId(null); setDepartmentName(''); setDepartmentDescription(''); setDepartmentForm(true);
    }
  }

  async function changeStatus(employee: Employee, status: Employee['status']) {
    setError(''); setNotice('');
    try {
      const response = await fetch(`/api/organizations/${organizationId}/employees/${employee.id}/status`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Unable to update employee');
      setEmployees((current) => current.map((item) => item.id === employee.id ? body.employee as Employee : item));
      setNotice(`${employee.firstName} ${employee.lastName}'s status updated.`);
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to update employee'); }
  }

  const filtered = employees.filter((employee) => `${employee.firstName} ${employee.lastName} ${employee.employeeCode} ${employee.workEmail ?? ''} ${employee.jobTitle ?? ''} ${employee.department?.name ?? ''}`.toLowerCase().includes(search.toLowerCase()));
  const activeCount = employees.filter((employee) => employee.status === 'ACTIVE').length;
  const onLeaveCount = employees.filter((employee) => employee.status === 'ON_LEAVE').length;

  return <section className="hr-workspace">
    <div className="hr-heading"><div><div className="eyebrow"><span className="eyebrow-dot" /> PEOPLE OPERATIONS</div><h1>HR &amp; People</h1><p>Manage your employee directory and organize your teams.</p></div><button className="hr-refresh" onClick={() => void load()} disabled={loading}><RefreshCw size={15} /> Refresh</button></div>
    <div className="hr-stat-grid">
      <article><span className="hr-stat-icon blue"><Users size={18} /></span><div><small>Total employees</small><strong>{employees.length}</strong><span>Across your organization</span></div></article>
      <article><span className="hr-stat-icon green"><UserPlus size={18} /></span><div><small>Active employees</small><strong>{activeCount}</strong><span>Currently active</span></div></article>
      <article><span className="hr-stat-icon amber"><CalendarDays size={18} /></span><div><small>On leave</small><strong>{onLeaveCount}</strong><span>Temporarily away</span></div></article>
      <article><span className="hr-stat-icon violet"><Building2 size={18} /></span><div><small>Departments</small><strong>{departments.length}</strong><span>Teams and functions</span></div></article>
    </div>
    {error && <div className="auth-error hr-alert" role="alert">{error}</div>}
    {notice && <div className="hr-success" role="status">{notice}</div>}
    <div className="hr-tabs"><div className="hr-tab-list"><button className={tab === 'employees' ? 'selected' : ''} onClick={() => setTab('employees')}>Employee directory <span>{employees.length}</span></button><button className={tab === 'departments' ? 'selected' : ''} onClick={() => setTab('departments')}>Departments <span>{departments.length}</span></button></div><div className="hr-actions">{tab === 'employees' && <label className="hr-search"><Search size={15} /><input aria-label="Search employees" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search people..." /></label>}{canManage && <button className="hr-primary" onClick={openAddForm}><Plus size={16} />{tab === 'employees' ? 'Add employee' : 'Add department'}</button>}</div></div>
    {employeeForm && <form className="hr-form-card" onSubmit={(e) => void addEmployee(e)}><div className="hr-form-title"><div><h3>{editingEmployeeId ? 'Edit employee' : 'Add employee'}</h3><p>{editingEmployeeId ? 'Update this employee’s details.' : 'Add a person to this organization’s directory.'}</p></div><button type="button" onClick={() => { setEmployeeForm(false); setEditingEmployeeId(null); }}>Cancel</button></div><div className="hr-form-grid">
      <label>Employee ID *<input required maxLength={32} value={employeeCode} onChange={(e) => setEmployeeCode(e.target.value)} placeholder="e.g. VZ-001" /></label>
      <label>First name *<input required maxLength={80} value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="First name" /></label>
      <label>Last name *<input required maxLength={80} value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Last name" /></label>
      <label>Work email<input type="email" maxLength={254} value={workEmail} onChange={(e) => setWorkEmail(e.target.value)} placeholder="name@company.com" /></label>
      <label>Job title<input maxLength={100} value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder="e.g. Operations Manager" /></label>
      <label>Department<select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}><option value="">No department</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
      <label>Start date<input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></label>
    </div><div className="hr-form-footer"><span>Fields marked * are required.</span><button className="hr-primary" type="submit" disabled={saving}>{saving ? 'Saving…' : editingEmployeeId ? 'Save changes' : 'Save employee'}</button></div></form>}
    {departmentForm && <form className="hr-form-card" onSubmit={(e) => void addDepartment(e)}><div className="hr-form-title"><div><h3>{editingDepartmentId ? 'Edit department' : 'Create department'}</h3><p>Group employees by function or team.</p></div><button type="button" onClick={() => { setDepartmentForm(false); setEditingDepartmentId(null); }}>Cancel</button></div><div className="hr-form-grid"><label>Department name *<input required maxLength={80} value={departmentName} onChange={(e) => setDepartmentName(e.target.value)} placeholder="e.g. Engineering" /></label><label>Description<input maxLength={300} value={departmentDescription} onChange={(e) => setDepartmentDescription(e.target.value)} placeholder="What this team does" /></label></div><div className="hr-form-footer"><span>Department names must be unique within this organization.</span><button className="hr-primary" type="submit" disabled={saving}>{saving ? 'Saving…' : editingDepartmentId ? 'Save changes' : 'Create department'}</button></div></form>}
    {tab === 'employees' ? <div className="hr-table-card"><div className="hr-table-heading"><div><h2>All employees</h2><p>People and employment status in your workspace.</p></div><span>{filtered.length} records</span></div>{loading ? <div className="hr-empty">Loading people data…</div> : filtered.length === 0 ? <div className="hr-empty"><span className="hr-empty-icon"><Users size={23} /></span><strong>{search ? 'No matching employees' : 'Your employee directory is ready'}</strong><p>{search ? 'Try another name, employee ID, or department.' : canManage ? 'Add your first employee to begin building your team directory.' : 'No employees have been added to this organization yet.'}</p>{!search && canManage && <button className="hr-primary" onClick={() => setEmployeeForm(true)}><Plus size={15} /> Add first employee</button>}</div> : <div className="hr-table-scroll"><table className="hr-table"><thead><tr><th>Employee</th><th>Employee ID</th><th>Department</th><th>Start date</th><th>Status</th>{canManage && <><th>Edit</th><th>Update status</th></>}</tr></thead><tbody>{filtered.map((employee) => <tr key={employee.id}><td><div className="hr-person"><span>{`${employee.firstName[0] ?? ''}${employee.lastName[0] ?? ''}`.toUpperCase()}</span><div><strong>{employee.firstName} {employee.lastName}</strong><small>{employee.jobTitle || employee.workEmail || 'Team member'}</small></div></div></td><td><code>{employee.employeeCode}</code></td><td>{employee.department?.name ?? '—'}</td><td>{employee.startDate ? new Date(employee.startDate).toLocaleDateString() : '—'}</td><td><span className={`hr-status ${employee.status.toLowerCase().replace('_', '-')}`}>{statusLabel[employee.status]}</span></td>{canManage && <><td><button type="button" className="hr-edit-button" onClick={() => editEmployee(employee)} aria-label={`Edit ${employee.firstName} ${employee.lastName}`}><Pencil size={13} /> Edit</button></td><td><select className="hr-status-select" aria-label={`Update status for ${employee.firstName} ${employee.lastName}`} value={employee.status} onChange={(e) => void changeStatus(employee, e.target.value as Employee['status'])}><option value="ACTIVE">Active</option><option value="ON_LEAVE">On leave</option><option value="INACTIVE">Inactive</option></select></td></>}</tr>)}</tbody></table></div>}</div> : <div className="hr-table-card"><div className="hr-table-heading"><div><h2>Departments</h2><p>Manage the teams that make up your organization.</p></div><span>{departments.length} departments</span></div>{loading ? <div className="hr-empty">Loading departments…</div> : departments.length === 0 ? <div className="hr-empty"><span className="hr-empty-icon"><Building2 size={23} /></span><strong>No departments yet</strong><p>{canManage ? 'Create a department to start organizing your people.' : 'An organization administrator can create departments.'}</p>{canManage && <button className="hr-primary" onClick={() => setDepartmentForm(true)}><Plus size={15} /> Create department</button>}</div> : <div className="hr-department-grid">{departments.map((department) => <article key={department.id} className="hr-department-card"><span><BriefcaseBusiness size={18} /></span><div><strong>{department.name}</strong><p>{department.description || 'No description provided'}</p><small>{department.employeeCount} {department.employeeCount === 1 ? 'employee' : 'employees'}</small></div>{canManage && <button type="button" className="hr-edit-icon" onClick={() => editDepartment(department)} aria-label={`Edit ${department.name}`} title="Edit department"><Pencil size={14} /></button>}</article>)}</div>}</div>}
    <p className="hr-permission-note">Signed in as <strong>{role}</strong>. {canManage ? 'You can manage employees and departments for this organization.' : 'You have read-only access to people records.'}</p>
  </section>;
}
