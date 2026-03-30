import { useEffect, useState } from 'react';

export default function StepUpModal({ actionLabel, error, onCancel, onConfirm, open, submitting }) {
  const [password, setPassword] = useState('');
  const passwordInputId = 'admin-step-up-password';

  useEffect(() => {
    if (open) setPassword('');
  }, [open]);

  if (!open) return null;

  return (
    <div className="login-shell">
      <div className="login-card" style={{ maxWidth: 420 }}>
        <div className="login-brand" style={{ marginBottom: 16 }}>
          <div className="login-brand-icon">HX</div>
          <div>
            <div className="login-brand-name">Security Confirmation</div>
            <div className="login-brand-sub">Confirm {actionLabel}</div>
          </div>
        </div>
        <div className="field">
          <label htmlFor={passwordInputId}>Password</label>
          <input
            id={passwordInputId}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter your password"
            disabled={submitting}
            autoFocus
          />
        </div>
        {error && <div className="error-msg" role="alert">{error}</div>}
        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button className="btn-primary" type="button" onClick={() => onConfirm(password)} disabled={submitting || !password.trim()}>
            {submitting ? 'Confirming...' : 'Confirm'}
          </button>
          <button className="btn-primary" type="button" onClick={onCancel} disabled={submitting} style={{ background: 'transparent', color: 'inherit', border: '1px solid rgba(255,255,255,0.15)' }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
