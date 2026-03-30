import { useState } from 'react';
import './Login.css';

const API = (() => {
  try {
    const url = new URL(process.env.REACT_APP_API_URL || '');
    return url.origin;
  } catch { return 'http://localhost:3001'; }
})();

const CSRF_STORAGE_KEY = 'aria-csrf-token';

function setCsrfToken(token) {
  if (token) sessionStorage.setItem(CSRF_STORAGE_KEY, token);
  else sessionStorage.removeItem(CSRF_STORAGE_KEY);
}

export default function Login({ onLogin }) {
  const [mode, setMode]       = useState('login'); // login | signup-individual | signup-company | recovery
  const [form, setForm]       = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [success, setSuccess] = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  async function submit(e) {
    e.preventDefault();
    setLoading(true); setError(''); setSuccess('');
    try {
      let endpoint, body;
      if (mode === 'login') {
        endpoint = '/auth/login';
        body = { username: form.username, password: form.password };
      } else if (mode === 'recovery') {
        endpoint = '/auth/recovery/request';
        body = { loginId: form.loginId };
      } else if (mode === 'signup-individual') {
        endpoint = '/auth/signup/individual';
        body = { username: form.username, email: form.email, password: form.password };
      } else {
        endpoint = '/auth/signup/company';
        body = { companyName: form.companyName, domain: form.domain, managerEmail: form.email, password: form.password, username: form.username };
      }

      const res = await fetch(`${API}${endpoint}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');

      if (mode === 'login') {
        setCsrfToken(data.csrfToken);
        localStorage.setItem('aria-user', JSON.stringify(data.user));
        onLogin(data.user);
      } else {
        setSuccess(data.message);
        setMode('login');
        setForm({});
      }
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="login-logo">
          <svg viewBox="0 0 160 160" xmlns="http://www.w3.org/2000/svg" width="48" height="48">
            <circle cx="80" cy="80" r="72" fill="none" stroke="#0891b2" strokeWidth="1" opacity="0.25"/>
            <circle cx="80" cy="80" r="58" fill="none" stroke="#0891b2" strokeWidth="0.8" opacity="0.15"/>
            <path d="M80 24 L110 120 M80 24 L50 120 M58 88 L102 88" fill="none" stroke="#0891b2" strokeWidth="7" strokeLinecap="square"/>
            <circle cx="80" cy="18" r="4" fill="#0891b2"/>
          </svg>
          <div>
            <div className="login-logo-name">ARIA</div>
            <div className="login-logo-by">by HELIX XI</div>
          </div>
        </div>

        <div className="login-tabs">
          <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>Sign In</button>
          <button type="button" className={mode === 'signup-individual' ? 'active' : ''} onClick={() => setMode('signup-individual')}>Individual</button>
          <button type="button" className={mode === 'signup-company' ? 'active' : ''} onClick={() => setMode('signup-company')}>Company</button>
        </div>

        <form onSubmit={submit}>
          {mode === 'recovery' ? (
            <>
              <div className="login-recovery-note">
                Enter your username or email. ARIA will send the recovery request to the team managing account access without exposing whether the account exists.
              </div>
              <div className="login-group">
                <label htmlFor="login-recovery-id">Username or Email</label>
                <input id="login-recovery-id" placeholder="samuel or you@example.com" value={form.loginId || ''} onChange={e => set('loginId', e.target.value)} required />
              </div>
            </>
          ) : (
            <>
          {mode === 'signup-company' && (
            <>
              <div className="login-group">
                <label htmlFor="company-name">Company Name</label>
                <input id="company-name" placeholder="HELIX XI Technologies" value={form.companyName || ''} onChange={e => set('companyName', e.target.value)} required />
              </div>
              <div className="login-group">
                <label htmlFor="company-domain">Company Domain</label>
                <input id="company-domain" placeholder="helixxi.com" value={form.domain || ''} onChange={e => set('domain', e.target.value)} required />
              </div>
            </>
          )}
          <div className="login-group">
            <label htmlFor="login-username">Username</label>
            <input id="login-username" placeholder="samuel" value={form.username || ''} onChange={e => set('username', e.target.value)} required />
          </div>
          {mode !== 'login' && (
            <div className="login-group">
              <label htmlFor="login-email">{mode === 'signup-company' ? 'Manager Email' : 'Email'}</label>
              <input id="login-email" type="email" placeholder="you@example.com" value={form.email || ''} onChange={e => set('email', e.target.value)} required />
            </div>
          )}
          <div className="login-group">
            <label htmlFor="login-password">Password</label>
            <input id="login-password" type="password" placeholder="Password" value={form.password || ''} onChange={e => set('password', e.target.value)} required />
          </div>
            </>
          )}

          {error   && <div className="login-error" role="alert">{error}</div>}
          {success && <div className="login-success" role="status">{success}</div>}

          <button className="login-btn" type="submit" disabled={loading}>
            {loading ? 'Please wait...' : mode === 'login' ? 'Sign In' : mode === 'recovery' ? 'Request Recovery' : 'Create Account'}
          </button>
        </form>

        {mode === 'login' && (
          <div className="login-footer">
            Don't have an account?{' '}
            <button type="button" onClick={() => setMode('signup-individual')}>Sign up</button>
          </div>
        )}

        {mode === 'login' && (
          <div className="login-footer login-footer-secondary">
            Need help accessing your account?{' '}
            <button type="button" onClick={() => setMode('recovery')}>Request recovery</button>
          </div>
        )}

        {mode === 'recovery' && (
          <div className="login-footer">
            Remembered your details?{' '}
            <button type="button" onClick={() => setMode('login')}>Back to sign in</button>
          </div>
        )}
      </div>
    </div>
  );
}
