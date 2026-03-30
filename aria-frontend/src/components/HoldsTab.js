import { apiFetch } from '../lib/api';

const TIER_CLASS = {
  GREEN: 'badge-green',
  YELLOW: 'badge-yellow',
  ORANGE: 'badge-orange',
  RED: 'badge-red',
  CRITICAL: 'badge-red',
  POSTED: 'badge-green',
  PENDING_CFO_REVIEW: 'badge-yellow',
  APPROVED: 'badge-green',
  REJECTED: 'badge-red',
  FROZEN: 'badge-purple',
};

function Badge({ label }) {
  if (!label) return null;
  return <span className={`badge ${TIER_CLASS[label] || 'badge-blue'}`}>{label.replace(/_/g, ' ')}</span>;
}

export default function HoldsTab({ holds, loadHolds, setTab, ensureStepUp }) {
  async function decide(hxid, decision) {
    const allowed = await ensureStepUp(`${decision === 'APPROVE' ? 'approving' : 'rejecting'} a held transaction`);
    if (!allowed) return;

    await apiFetch(`/api/holdqueue/${hxid}/decision`, {
      method: 'POST',
      body: JSON.stringify({ decision, cfoName: 'CFO' }),
    }).catch(() => {});

    loadHolds();
  }

  if (holds.length === 0) {
    return (
      <div className="empty">
        <div className="empty-icon">OK</div>
        <div className="empty-text">No transactions need CFO review right now.</div>
        <div style={{ maxWidth: 520, textAlign: 'center', fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
          When ARIA flags a transaction, it will appear here for approval. Want to sanity-check the workflow? Submit a test transaction and refresh.
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
          <button className="btn-ghost" onClick={() => setTab('submit')}>+ New Transaction</button>
          <button className="btn-ghost" onClick={() => loadHolds()}>Refresh</button>
        </div>
      </div>
    );
  }

  return (
    <div className="hold-list">
      {holds.map((hold, index) => (
        <div key={index} className="hold-card">
          <div className="hold-top">
            <div className="hold-meta">
              <span className="hxid">{hold.HXID || hold.hxid}</span>
              <span className="hold-vendor">{hold.Vendor || hold.vendor}</span>
              <span className="hold-amount">{hold.Amount || hold.amount} {hold.Currency || hold.currency}</span>
              <Badge label={hold.ActionTier || hold.actionTier} />
              <span className="hold-score">Score: <strong>{hold.HXFRS || hold.hxfrs}</strong></span>
            </div>
            <div className="hold-actions">
              <button className="btn-approve" onClick={() => decide(hold.HXID || hold.hxid, 'APPROVE')}>Approve</button>
              <button className="btn-reject" onClick={() => decide(hold.HXID || hold.hxid, 'REJECT')}>Reject</button>
            </div>
          </div>
          {(hold.FraudSignals || hold.fraudSignals) && (
            <div className="hold-flags">
              {(hold.FraudSignals || hold.fraudSignals).split(' | ').map((flag, flagIndex) => (
                <span key={flagIndex} className="flag-chip">Flag {flag}</span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
