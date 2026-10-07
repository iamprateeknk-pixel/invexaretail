import { useEffect, useState } from 'react';
import { controlRequest, WEB_APP_URL } from './lib/api';
import { clearControlSession, readControlSession, writeControlSession } from './lib/session';

export default function App() {
  const [session, setSession] = useState(() => readControlSession());
  const [email, setEmail] = useState('superadmin@invexa.local');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const platformToken = session?.platformToken;
  const controlToken = session?.controlToken;
  const companies = session?.companies ?? [];

  function persist(next) {
    writeControlSession(next);
    setSession(next);
  }

  async function handleLogin(event) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const login = await controlRequest('/control/v1/auth/login', {
        method: 'POST',
        body: { email: email.trim().toLowerCase(), password },
      });
      persist({
        platformToken: login.token,
        user: login.user,
        companies: login.companies ?? [],
      });
      setPassword('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  async function selectCompany(companyId) {
    setLoading(true);
    setError('');
    try {
      const selected = await controlRequest('/control/v1/sessions/select-company', {
        token: platformToken,
        method: 'POST',
        body: { companyId },
      });
      persist({
        ...session,
        controlToken: selected.token,
        company: selected.company,
        controlSession: selected.session,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Company lock failed');
    } finally {
      setLoading(false);
    }
  }

  function signOut() {
    clearControlSession();
    setSession(null);
    setError('');
  }

  // Locking a company only issues the token; the full Control Plane dashboard (users, billing,
  // studio, etc.) lives in the web app. Only a one-time code (single use, 60 s) goes in the URL;
  // the session itself is exchanged server-side and never appears in the address bar or history.
  useEffect(() => {
    if (!controlToken) return undefined;
    let cancelled = false;
    controlRequest('/control/v1/sessions/handoff', { token: controlToken, method: 'POST', body: { session } })
      .then(({ code }) => {
        if (cancelled) return;
        clearControlSession();
        window.location.href = `${WEB_APP_URL}/#/control?code=${encodeURIComponent(code)}`;
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'Could not open the Control Plane');
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controlToken]);

  if (!platformToken) {
    return (
      <main className="login-shell">
        <section className="card">
          <p className="eyebrow">Invexa Platform</p>
          <h1>Control Plane</h1>
          <p className="lede">Super Admin login. Company configuration requires a hard-locked session.</p>
          <form onSubmit={handleLogin}>
            <label htmlFor="control-email">
              Email
              <input
                id="control-email"
                name="email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label htmlFor="control-password">
              Password
              <input
                id="control-password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            {error ? <p className="error" role="alert">{error}</p> : null}
            <button type="submit" disabled={loading}>
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </section>
      </main>
    );
  }

  if (!controlToken) {
    return (
      <main className="panel">
        <div className="panel-inner">
          <div className="row">
            <div>
              <p className="eyebrow">Platform Super Admin</p>
              <h1>Select one company</h1>
              <p className="lede">Lock a company session to manage users, studio, and billing.</p>
            </div>
            <button type="button" className="secondary" onClick={signOut}>Sign out</button>
          </div>
          {error ? <p className="error" role="alert">{error}</p> : null}
          <div className="companies">
            {companies.map((entry) => (
              <article className="company" key={entry.id}>
                <div>
                  <h2>{entry.name}</h2>
                  <p>{entry.id} · {entry.planId} · {entry.status}</p>
                </div>
                <button type="button" disabled={loading || entry.status !== 'active'} onClick={() => selectCompany(entry.id)}>
                  Lock session
                </button>
              </article>
            ))}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="panel">
      <div className="panel-inner">
        <div className="row">
          <div>
            <p className="eyebrow">Control Plane</p>
            <h1>Redirecting…</h1>
            <p className="lede">Taking you to the Control Plane dashboard.</p>
          </div>
          <button type="button" className="secondary" onClick={signOut}>Sign out</button>
        </div>
      </div>
    </main>
  );
}
