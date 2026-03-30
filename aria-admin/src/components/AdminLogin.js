import { useState } from 'react';
import { API, setCsrfToken } from '../lib/api';

export default function AdminLogin({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const data = await fetch(`${API}/auth/login`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      }).then((response) => response.json());

      if (data.error) throw new Error(data.error);
      if (data.user?.role !== 'ADMIN') throw new Error('Admin access required');

      setCsrfToken(data.csrfToken);
      localStorage.setItem('aria-admin-user', JSON.stringify(data.user));
      onLogin(data.user);
    } catch (err) {
      setError(err.message);
    }

    setLoading(false);
  }

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="login-brand">
          <div className="login-brand-icon">HX</div>
          <div>
            <div className="login-brand-name">HELIX XI</div>
            <div className="login-brand-sub">Mission Control</div>
          </div>
        </div>
        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="admin-login-username">Username</label>
            <input id="admin-login-username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="samuel" required />
          </div>
          <div className="field">
            <label htmlFor="admin-login-password">Password</label>
            <input id="admin-login-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter password" required />
          </div>
          {error && <div className="error-msg" role="alert">{error}</div>}
          <button className="btn-primary" type="submit" disabled={loading}>
            {loading ? 'Authenticating...' : 'Enter Mission Control'}
          </button>
        </form>
      </div>
    </div>
  );
}
