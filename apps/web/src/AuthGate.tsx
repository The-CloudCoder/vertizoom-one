import { type FormEvent, useEffect, useState } from 'react';
import { ArrowRight, CheckCircle2, Command, Eye, EyeOff, LoaderCircle, ShieldCheck } from 'lucide-react';
import App from './App';

type Organization = { id: string; name: string; slug: string; role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER' };
type User = { id: string; name: string | null; email: string };
type AuthState = { user: User; organizations: Organization[] };
type Mode = 'login' | 'signup';

export default function AuthGate() {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [checking, setChecking] = useState(true);
  const [mode, setMode] = useState<Mode>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [organizationName, setOrganizationName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    fetch('/api/auth/me', { credentials: 'include' })
      .then(async (response) => { if (response.ok && active) setAuth(await response.json() as AuthState); })
      .catch(() => { if (active) setError('Unable to reach the API. Check that the backend is running.'); })
      .finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const response = await fetch(mode === 'signup' ? '/api/auth/signup' : '/api/auth/login', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mode === 'signup' ? { name, email, password, organizationName } : { email, password }),
      });
      const body = await response.json() as AuthState & { error?: string };
      if (!response.ok) throw new Error(body.error ?? 'Unable to authenticate');
      setAuth(body);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Something went wrong. Please try again.');
    } finally { setBusy(false); }
  }
  async function logout() {
    try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }); }
    finally { setAuth(null); setPassword(''); setMode('login'); }
  }

  if (checking) return <div className="auth-loading"><LoaderCircle className="auth-spinner" size={28} /><span>Securing your workspace…</span></div>;
  if (auth) return <App user={auth.user} organization={auth.organizations[0] ?? null} onLogout={() => void logout()} />;

  return <main className="auth-shell">
    <section className="auth-story">
      <div className="auth-brand"><span className="auth-brand-mark"><Command size={22} /></span><span>vertizoom<strong> one</strong></span></div>
      <div className="auth-story-content">
        <span className="auth-kicker"><span /> ONE CONNECTED WORKSPACE</span>
        <h1>Bring your business into <span>focus.</span></h1>
        <p>One secure workspace for your people, customers, operations, and business intelligence.</p>
        <div className="auth-benefits">
          <div><CheckCircle2 size={18} /><span><strong>One place to work</strong><small>Connected business modules, built to grow.</small></span></div>
          <div><ShieldCheck size={18} /><span><strong>Designed with security in mind</strong><small>Your workspace and its access stay under your control.</small></span></div>
        </div>
      </div>
      <div className="auth-story-footer">© 2026 Vertizoom One <span>One Platform. Smarter Business.</span></div>
      <div className="auth-glow auth-glow-one" /><div className="auth-glow auth-glow-two" />
    </section>
    <section className="auth-panel">
      <div className="auth-mobile-brand"><span className="auth-brand-mark"><Command size={21} /></span><span>vertizoom<strong> one</strong></span></div>
      <div className="auth-form-wrap">
        <div className="auth-form-heading"><span className="auth-form-eyebrow">{mode === 'signup' ? 'GET STARTED' : 'WELCOME BACK'}</span><h2>{mode === 'signup' ? 'Create your workspace' : 'Sign in to Vertizoom One'}</h2><p>{mode === 'signup' ? 'Start with your account and first organization.' : 'Your business workspace is ready when you are.'}</p></div>
        <form className="auth-form" onSubmit={(event) => void submit(event)}>
          {mode === 'signup' && <label>Full name<input autoComplete="name" required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" /></label>}
          <label>Work email<input type="email" autoComplete="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" /></label>
          {mode === 'signup' && <label>Organization name<input autoComplete="organization" required maxLength={100} value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} placeholder="Your company or team" /></label>}
          <label>Password<span className="auth-password-wrap"><input type={showPassword ? 'text' : 'password'} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} minLength={mode === 'signup' ? 12 : undefined} maxLength={128} required value={password} onChange={(event) => setPassword(event.target.value)} placeholder={mode === 'signup' ? 'At least 12 characters' : 'Enter your password'} /><button type="button" className="auth-password-toggle" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></span>{mode === 'signup' && <small className="auth-field-hint">Use 12 or more characters for a stronger password.</small>}</label>
          {error && <div className="auth-error" role="alert">{error}</div>}
          <button className="auth-submit" type="submit" disabled={busy}>{busy ? <LoaderCircle className="auth-spinner" size={18} /> : <>{mode === 'signup' ? 'Create account' : 'Sign in'} <ArrowRight size={17} /></>}</button>
        </form>
        <p className="auth-switch">{mode === 'signup' ? 'Already have an account?' : 'New to Vertizoom One?'} <button onClick={() => { setMode(mode === 'signup' ? 'login' : 'signup'); setError(''); }} type="button">{mode === 'signup' ? 'Sign in' : 'Create an account'}</button></p>
        <div className="auth-security-note"><ShieldCheck size={15} /><span>Secure session · Protected workspace access</span></div>
      </div>
      <p className="auth-legal">By continuing, use of this workspace is subject to your organization's policies.</p>
    </section>
  </main>;
}
