// Legacy reference file.
// Active ingest logic lives in ../modules/ingest.js.

const { normalize } = require('./normalize');
const { scoreFraud } = require('./fraud');
const { appendToLedger, appendToHoldQueue, appendToRejectionLog, appendToAuditLog, markTransactionProcessed } = require('../db/sheets');

const ingestTransaction = async (row) => {
  console.log(`📥 HELIX XI: Ingesting transaction from ${row.Vendor || 'Unknown'}...`);

  // STEP 1: Schema validation
  const requiredFields = ['Date', 'Vendor', 'Amount', 'Currency', 'Entity', 'Description'];
  const missing = requiredFields.filter(f => !row[f] || row[f].toString().trim() === '');

  if (missing.length > 0) {
    const rejection = {
      timestamp: new Date().toISOString(),
      reason: `Missing required fields: ${missing.join(', ')}`,
      rawData: JSON.stringify(row),
      status: 'REJECTED'
    };
    await appendToRejectionLog(rejection);
    console.log(`❌ HELIX XI: Transaction rejected — ${rejection.reason}`);
    return { success: false, reason: rejection.reason };
  }

  const amount = parseFloat(row.Amount);
  if (isNaN(amount) || amount <= 0) {
    const rejection = { timestamp: new Date().toISOString(), reason: `Invalid amount: ${row.Amount}`, rawData: JSON.stringify(row), status: 'REJECTED' };
    await appendToRejectionLog(rejection);
    return { success: false, reason: rejection.reason };
  }

  // STEPS 2-8: Normalize
  const normalized = normalize(row);
  console.log(`⚙️ HELIX XI: Normalized — HXID: ${normalized.HXID}`);

  // FRAUD SCORING
  const scored = scoreFraud(normalized);
  console.log(`🔴 HELIX XI: HXFRS Score: ${scored.HXFRS}/100 — ${scored.actionTier}`);

  // ROUTE by score
  if (scored.requiresHold) {
    scored.status = 'HELD_PENDING_CFO_REVIEW';
    scored.heldAt = new Date().toISOString();
    await appendToHoldQueue(scored);
    console.log(`🔒 HELIX XI: Transaction HELD — ${scored.HXID}`);
  } else {
    scored.status = 'POSTED';
    scored.postedAt = new Date().toISOString();
    await appendToLedger(scored);
    console.log(`✅ HELIX XI: Transaction POSTED — ${scored.HXID}`);
  }

  // Audit log
  await appendToAuditLog({
    timestamp: new Date().toISOString(),
    action: `TRANSACTION_${scored.status}`,
    details: `HXID: ${scored.HXID} | Vendor: ${scored.vendor} | Amount: ${scored.currency} ${scored.amount} | HXFRS: ${scored.HXFRS}`,
    layer: 'MODULE_1_2_INGESTION_FRAUD',
    status: scored.status
  });

  // Mark as processed in source sheet
  if (row._rowIndex) await markTransactionProcessed(row._rowIndex);

  return { success: true, HXID: scored.HXID, status: scored.status, HXFRS: scored.HXFRS };
};

module.exports = { ingestTransaction };
