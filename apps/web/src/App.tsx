import { useEffect, useState } from 'react';
import HRWorkspace from './HRWorkspace';
import WorkspaceSettings from './WorkspaceSettings';
import {
  Activity, ArrowDownRight, ArrowUpRight, Bell, Bot, BriefcaseBusiness,
  CalendarDays, ChartNoAxesCombined, ChevronDown, CircleHelp, Command,
  CreditCard, LayoutDashboard, Menu, Search, Settings2, ShieldCheck,
  Users, X, Zap, LogOut
} from 'lucide-react';

const modules = [
  { name: 'ERP', description: 'Operations & finance', icon: BriefcaseBusiness, tone: 'blue' },
  { name: 'CRM', description: 'Customers & pipeline', icon: Users, tone: 'violet' },
  { name: 'HR', description: 'People & payroll', icon: ShieldCheck, tone: 'green' },
  { name: 'AI', description: 'Your business copilot', icon: Bot, tone: 'amber' },
  { name: 'Insights', description: 'Reports & analytics', icon: ChartNoAxesCombined, tone: 'cyan' },
];

const metrics = [
  { label: 'Total revenue', value: '₹24.8L', change: '+12.8%', up: true, detail: 'vs. last month', color: 'blue' },
  { label: 'Active customers', value: '1,284', change: '+8.2%', up: true, detail: 'vs. last month', color: 'violet' },
  { label: 'Team members', value: '48', change: '+3', up: true, detail: 'this month', color: 'green' },
  { label: 'Open tasks', value: '26', change: '4 overdue', up: false, detail: 'need attention', color: 'amber' },
];

const activities = [
  { title: 'New customer added', detail: 'Acme Technologies · CRM', time: '10 min ago', color: 'violet' },
  { title: 'Invoice paid', detail: 'INV-2026-084 · ERP', time: '35 min ago', color: 'green' },
  { title: 'New team member invited', detail: 'Priya S. · HR', time: '1 hour ago', color: 'blue' },
  { title: 'Monthly report is ready', detail: 'Business overview · Insights', time: '2 hours ago', color: 'amber' },
];

type AppProps = { user: { id: string; name: string | null; email: string }; organization: { id: string; name: string; slug: string; role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER' } | null; onLogout: () => void; onOrganizationUpdated: (organization: { id: string; name: string; slug: string; role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER' }) => void; };

function App({ user, organization, onLogout, onOrganizationUpdated }: AppProps) {
  const displayName = user.name?.trim().split(/\s+/)[0] || 'there';
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeNav, setActiveNav] = useState('Overview');
  const [apiStatus, setApiStatus] = useState<'checking' | 'online' | 'offline'>('checking');

  useEffect(() => {
    fetch('/api/health')
      .then((response) => {
        if (!response.ok) throw new Error('API unavailable');
        return response.json();
      })
      .then(() => setApiStatus('online'))
      .catch(() => setApiStatus('offline'));
  }, []);

  const navItems = [
    { label: 'Overview', icon: LayoutDashboard },
    { label: 'ERP', icon: BriefcaseBusiness },
    { label: 'CRM', icon: Users },
    { label: 'HR & People', icon: ShieldCheck },
    { label: 'AI Assistant', icon: Bot },
    { label: 'Insights', icon: ChartNoAxesCombined },
    { label: 'Workspace Settings', icon: Settings2 },
  ];

  return (
    <div className="app-shell">
      <aside className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`}>
        <div className="brand">
          <div className="brand-mark"><Command size={22} strokeWidth={2.4} /></div>
          <div className="brand-copy"><strong>vertizoom<span>one</span></strong><small>BUSINESS PLATFORM</small></div>
          <button className="icon-button mobile-close" aria-label="Close menu" onClick={() => setMenuOpen(false)}><X size={19} /></button>
        </div>

        <button className="workspace-switch">
          <div className="workspace-avatar">V</div>
          <div className="workspace-copy"><strong>{organization?.name ?? 'Your workspace'}</strong><span>Free plan</span></div>
          <ChevronDown size={16} className="muted-icon" />
        </button>

        <div className="nav-label">WORKSPACE</div>
        <nav className="main-nav" aria-label="Main navigation">
          {navItems.map(({ label, icon: Icon }) => (
            <button key={label} className={`nav-item ${activeNav === label ? 'active' : ''}`} onClick={() => { setActiveNav(label); setMenuOpen(false); }}>
              <Icon size={18} /><span>{label}</span>
              {label === 'AI Assistant' && <span className="nav-new">NEW</span>}
            </button>
          ))}
        </nav>

        <div className="nav-label module-label">YOUR MODULES</div>
        <div className="module-shortcuts">
          {modules.map(({ name, icon: Icon, tone }) => (
            <button key={name} className="module-shortcut" onClick={() => setActiveNav(name === 'HR' ? 'HR & People' : name === 'AI' ? 'AI Assistant' : name)}>
              <span className={`mini-module-icon ${tone}`}><Icon size={15} /></span>{name}
              <span className="coming-soon">Preview</span>
            </button>
          ))}
        </div>

        <div className="sidebar-bottom">
          <div className="help-card"><div className="help-icon"><CircleHelp size={18} /></div><strong>Need a hand?</strong><p>Explore the platform and get started.</p><button onClick={() => setActiveNav('Help & Support')}>Visit help center <span>↗</span></button></div>
          <button className="nav-item" onClick={() => setActiveNav('Settings')}><Settings2 size={18} /><span>Settings</span></button>
          <div className="user-profile"><div className="profile-avatar">VR</div><div className="profile-copy"><strong>{user.name ?? 'Workspace member'}</strong><span>{user.email}</span></div><ChevronDown size={16} className="muted-icon" /></div>
        </div>
      </aside>

      {menuOpen && <button className="mobile-overlay" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}

      <main className="main-area">
        <header className="topbar">
          <div className="topbar-left">
            <button className="icon-button mobile-menu" aria-label="Open menu" onClick={() => setMenuOpen(true)}><Menu size={21} /></button>
            <div className="breadcrumb">Workspace <span>/</span> <strong>{activeNav}</strong></div>
          </div>
          <div className="topbar-actions">
            <div className="search-box"><Search size={16} /><input aria-label="Search" placeholder="Search anything..." /><kbd>⌘ K</kbd></div>
            <button className="icon-button notification-button" aria-label="Notifications"><Bell size={19} /><i /></button>
            <div className="topbar-divider" />
            <button className="profile-avatar top-avatar" aria-label="Account">{(user.name ?? user.email).slice(0, 2).toUpperCase()}</button><button className="icon-button" onClick={onLogout} aria-label="Sign out" title="Sign out"><LogOut size={18} /></button>
          </div>
        </header>

        <div className="page-content">
          {activeNav === 'HR & People' && organization ? <HRWorkspace organizationId={organization.id} role={organization.role} /> : activeNav === 'Workspace Settings' && organization ? <WorkspaceSettings organization={organization} onOrganizationUpdated={onOrganizationUpdated} /> : <>
          <section className="welcome-row">
            <div><div className="eyebrow"><span className="eyebrow-dot" /> YOUR BUSINESS, AT A GLANCE</div><h1>Good morning, {displayName} <span>✦</span></h1><p>Here's what's happening across your workspace today.</p></div>
            <button className="date-pill"><CalendarDays size={16} /> October 14, 2026 <ChevronDown size={15} /></button>
          </section>

          {activeNav !== 'Overview' && <div className="preview-notice"><Zap size={17} /><div><strong>{activeNav} workspace preview</strong><p>This is the initial product foundation. Module workflows will be added in upcoming iterations.</p></div><button onClick={() => setActiveNav('Overview')}>Back to overview</button></div>}

          <section className="metric-grid" aria-label="Business metrics">
            {metrics.map((metric) => (
              <article className="metric-card" key={metric.label}>
                <div className="metric-top"><span>{metric.label}</span><span className={`metric-icon ${metric.color}`}>{metric.label === 'Total revenue' ? <CreditCard size={18} /> : metric.label === 'Active customers' ? <Users size={18} /> : metric.label === 'Team members' ? <ShieldCheck size={18} /> : <Activity size={18} />}</span></div>
                <div className="metric-value">{metric.value}</div>
                <div className="metric-foot"><span className={metric.up ? 'positive-change' : 'attention-change'}>{metric.up ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}{metric.change}</span><span>{metric.detail}</span></div>
              </article>
            ))}
          </section>

          <section className="section-heading"><div><h2>Your business, connected</h2><p>Everything you need, working together.</p></div><button className="text-button">Explore platform <span>↗</span></button></section>
          <section className="module-grid" aria-label="Product modules">
            {modules.map(({ name, description, icon: Icon, tone }, index) => (
              <button key={name} className="product-card" onClick={() => setActiveNav(name === 'HR' ? 'HR & People' : name === 'AI' ? 'AI Assistant' : name)}>
                <div className="product-card-top"><span className={`product-icon ${tone}`}><Icon size={21} /></span><span className="card-arrow">↗</span></div>
                <h3>{name}</h3><p>{description}</p>
                <div className="product-card-foot"><span className={`status-dot ${index === 3 ? 'status-ai' : ''}`} />{index === 3 ? 'AI-powered tools' : 'Module preview'}<span className="foot-arrow">→</span></div>
              </button>
            ))}
          </section>

          <section className="lower-grid">
            <article className="panel activity-panel"><div className="panel-heading"><div><h2>Recent activity</h2><p>Latest updates from your workspace</p></div><button className="subtle-button">View all <span>→</span></button></div>
              <div className="activity-list">{activities.map((item) => <div className="activity-item" key={item.title}><span className={`activity-icon ${item.color}`}>{item.color === 'violet' ? <Users size={17} /> : item.color === 'green' ? <CreditCard size={17} /> : item.color === 'blue' ? <ShieldCheck size={17} /> : <ChartNoAxesCombined size={17} />}</span><div className="activity-copy"><strong>{item.title}</strong><span>{item.detail}</span></div><time>{item.time}</time></div>)}</div>
            </article>
            <article className="panel assistant-panel"><div className="assistant-orb"><Bot size={24} /></div><span className="assistant-tag"><span /> VERTIZOOM AI</span><h2>Your business copilot</h2><p>Get help understanding your business, finding insights, and planning your next move.</p><button className="assistant-button" onClick={() => setActiveNav('AI Assistant')}>Explore AI assistant <span>→</span></button><div className="assistant-decoration decoration-one" /><div className="assistant-decoration decoration-two" /></article>
          </section>

          </>}
          <footer className="app-footer"><span>© 2026 Vertizoom One</span><span className="api-indicator"><i className={apiStatus} /> API {apiStatus === 'checking' ? 'checking…' : apiStatus === 'online' ? 'connected' : 'offline'}</span><span>One Platform. Smarter Business.</span></footer>
        </div>
      </main>
    </div>
  );
}

export default App;
