const { getLedger, getHoldQueue, appendToAuditLog } = require('../db/supabase');

const runReconciliation = async (companyId) => {
  console.log('🔄 ARIA: Running reconciliation...');
  const [ledger, holdQueue] = await Promise.all([getLedger(companyId), getHoldQueue(companyId)]);

  // Duplicate HXID check
  const hxids = ledger.map(r => r.HXID).filter(Boolean);
  const duplicateHXIDs = hxids.filter((id, i) => hxids.indexOf(id) !== i);

  // Intercompany elimination check
  const intercoEntries = ledger.filter(r => r.IsIntercompany === 'true' || r.isIntercompany === 'true');
  const intercoTotal = intercoEntries.reduce((s, r) => s + (parseFloat(r.Amount) || 0), 0);

  // Stale holds > 48hrs
  const now = Date.now();
  const stalePending = holdQueue.filter(r => {
    if (r.Status !== 'PENDING_CFO_REVIEW') return false;
    const heldTime = new Date(r.HeldAt || r.heldAt || 0).getTime();
    return heldTime > 0 && (now - heldTime) > 48 * 60 * 60 * 1000;
  });

  const result = {
    ledgerCount:       ledger.length,
    duplicateHXIDs,
    intercoTotal:      intercoTotal.toFixed(2),
    intercoBalanced:   Math.abs(intercoTotal) < 0.01,
    stalePendingCount: stalePending.length,
    stalePendingHXIDs: stalePending.map(r => r.HXID),
    reconciledAt:      new Date().toISOString(),
  };

  const status = duplicateHXIDs.length === 0 && result.intercoBalanced ? 'COMPLETE' : 'NEEDS_REVIEW';

  await appendToAuditLog({
    companyId,
    timestamp: new Date().toISOString(),
    action: 'RECONCILIATION_RUN',
    details: `Ledger: ${result.ledgerCount} | Duplicates: ${duplicateHXIDs.length} | Interco balanced: ${result.intercoBalanced} | Stale holds: ${result.stalePendingCount}`,
    layer: 'MODULE_1_RECONCILIATION',
    status,
  }).catch(() => {});

  console.log(`✅ ARIA: Reconciliation complete.`);
  return result;
};

module.exports = { runReconciliation };
