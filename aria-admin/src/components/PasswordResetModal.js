import { useEffect, useState } from 'react';

export default function PasswordResetModal({ error, onCancel, onConfirm, open, submitting, targetUser }) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const passwordInputId = 'admin-reset-password';
  const confirmInputId = 'admin-reset-password-confirm';
  const mismatch = confirmPassword && password !== confirmPassword;

  useEffect(() => {
    if (open) {
      setPassword('');
      setConfirmPassword('');
    }
  }, [open]);

  if (!open) return null;

  return (
    <div className="login-shell">
      <div className="login-card" style={{ maxWidth: 460 }}>
        <div className="login-brand" style={{ marginBottom: 16 }}>
          <div className="login-brand-icon">PW</div>
          <div>
            <div className="login-brand-name">Reset Password</div>
            <div className="login-brand-sub">Set a new password for {targetUser?.username || 'this user'}</div>
          </div>
        </div>
        <div className="field">
          <label htmlFor={passwordInputId}>New Password</label>
          <input
            id={passwordInputId}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            disabled={submitting}
            autoFocus
          />
        </div>
        <div className="field">
          <label htmlFor={confirmInputId}>Confirm Password</label>
          <input
            id={confirmInputId}
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Repeat the new password"
            disabled={submitting}
          />
        </div>
        {mismatch && <div className="error-msg" role="alert">Passwords do not match.</div>}
        {error && <div className="error-msg" role="alert">{error}</div>}
        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button
            className="btn-primary"
            type="button"
            onClick={() => onConfirm(password)}
            disabled={submitting || password.length < 8 || mismatch}
          >
            {submitting ? 'Resetting...' : 'Apply Reset'}
          </button>
          <button
            className="btn-primary"
            type="button"
            onClick={onCancel}
            disabled={submitting}
            style={{ background: 'transparent', color: 'inherit', border: '1px solid rgba(255,255,255,0.15)' }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
