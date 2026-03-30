import { useEffect, useState } from 'react';

export default function StepUpModal({ actionLabel, error, onCancel, onConfirm, open, submitting }) {
  const [password, setPassword] = useState('');
  const passwordInputId = 'step-up-password';

  useEffect(() => {
    if (open) setPassword('');
  }, [open]);

  if (!open) return null;

  return (
    <div className="journal-overlay" onClick={submitting ? undefined : onCancel}>
      <div className="journal-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <div className="journal-header">
          <div className="journal-title">Security Confirmation</div>
          <button className="journal-close" onClick={onCancel} disabled={submitting}>Close</button>
        </div>
        <div style={{ padding: 20 }}>
          <div style={{ color: 'var(--muted)', fontSize: 13, lineHeight: 1.6, marginBottom: 14 }}>
            Confirm your password to continue with {actionLabel}.
          </div>
          <label htmlFor={passwordInputId} style={{ display: 'block', marginBottom: 8, fontSize: 12, color: 'var(--muted)' }}>
            Password
          </label>
          <input
            id={passwordInputId}
            className="chat-input"
            type="password"
            placeholder="Enter your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={submitting}
            autoFocus
          />
          {error && (
            <div role="alert" style={{ marginTop: 12, color: 'var(--red-l)', background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.2)', padding: '10px 12px', borderRadius: 10 }}>
              {error}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
            <button className="btn-ghost" onClick={onCancel} disabled={submitting}>Cancel</button>
            <button className="chat-send" onClick={() => onConfirm(password)} disabled={submitting || !password.trim()}>
              {submitting ? 'Confirming...' : 'Confirm'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
