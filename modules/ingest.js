const { normalize } = require('./normalize');
const { scoreFraud } = require('./fraud');
const {
  getLedger, getHoldQueue,
  appendToLedger, appendToHoldQueue, appendToRejectionLog,
  appendToAuditLog, markTransactionProcessed
} = require('../db/supabase');

const ingestTransaction = async (raw, companyId) => {
  // Normalize field names — accept both capitalized (sheet) and lowercase (API)
  const row = {
    Date:        raw.Date        || raw.date        || new Date().toISOString().split('T')[0],
    Vendor:      raw.Vendor      || raw.vendor      || '',
    Amount:      raw.Amount      || raw.amount      || '',
    Currency:    raw.Currency    || raw.currency    || 'USD',
    Entity:      raw.Entity      || raw.entity      || 'HELIX XI',
    Description: raw.Description || raw.description || '',
    Category:    raw.Category    || raw.category    || '',
    _rowIndex:   raw._rowIndex,
  };

  console.log(`📥 ARIA: Ingesting transaction from ${row.Vendor || 'Unknown'}...`);

  // STEP 1: Validation
  const requiredFields = ['Vendor', 'Amount', 'Currency'];
  const missing = requiredFields.filter(f => !row[f] || row[f].toString().trim() === '');
  if (missing.length > 0) {
    const reason = `Missing required fields: ${missing.join(', ')}`;
    await appendToRejectionLog({ timestamp: new Date().toISOString(), reason, rawData: JSON.stringify(row), status: 'REJECTED' }, companyId).catch(() => {});
    console.log(`❌ ARIA: Rejected — ${reason}`);
    return { success: false, reason };
  }

  const amount = parseFloat(row.Amount);
  if (isNaN(amount) || amount <= 0) {
    const reason = `Invalid amount: ${row.Amount}`;
    await appendToRejectionLog({ timestamp: new Date().toISOString(), reason, rawData: JSON.stringify(row), status: 'REJECTED' }, companyId).catch(() => {});
    return { success: false, reason };
  }

  // STEP 2: Normalize
  const normalized = await normalize(row);
  console.log(`⚙️  ARIA: Normalized — ${normalized.HXID}`);

  // STEP 3: Duplicate check + velocity detection
  const [ledger, holdQueue] = await Promise.all([getLedger(companyId), getHoldQueue(companyId)]);
  const allRecords = [...ledger, ...holdQueue];
  const threeDays = 3 * 24 * 60 * 60 * 1000;
  const twentyFourHours = 24 * 60 * 60 * 1000;
  const txTime = new Date(normalized.date).getTime();

  // Duplicate check
  normalized._isDuplicate = allRecords.some(r => {
    const rVendor = (r.Vendor || '').toUpperCase().replace(/[^A-Z0-9 ]/g, '').trim();
    const rAmount = parseFloat(r.Amount);
    const rTime   = new Date(r.Date || r.date || 0).getTime();
    return rVendor === normalized.vendorNormalized
      && rAmount === normalized.amount
      && Math.abs(rTime - txTime) <= threeDays;
  });

  // Velocity detection — same vendor 3+ times in 24 hours
  const recentSameVendor = allRecords.filter(r => {
    const rVendor = (r.Vendor || '').toUpperCase().replace(/[^A-Z0-9 ]/g, '').trim();
    const rTime   = new Date(r.Date || r.date || 0).getTime();
    return rVendor === normalized.vendorNormalized && Math.abs(rTime - txTime) <= twentyFourHours;
  });
  normalized._velocityFlag = recentSameVendor.length >= 2; // 2 existing + this one = 3 total
  if (normalized._velocityFlag) {
    console.log(`⚡ ARIA: Velocity flag — ${normalized.vendor} appeared ${recentSameVendor.length + 1}x in 24hrs`);
  }

  // STEP 4: Fraud scoring
  const scored = await scoreFraud(normalized);
  scored.companyId = companyId || raw.companyId || raw.company_id || null;
  console.log(`🔴 ARIA: HXFRS ${scored.HXFRS}/100 — ${scored.actionTier}`);

  // STEP 5: Route + audit log in parallel
  if (scored.requiresHold) {
    scored.status = 'PENDING_CFO_REVIEW';
    scored.heldAt = new Date().toISOString();
    await appendToHoldQueue(scored, companyId);
    console.log(`🔒 ARIA: HELD — ${scored.HXID}`);
  } else {
    scored.status = 'POSTED';
    scored.postedAt = new Date().toISOString();
    await appendToLedger(scored, companyId);
    console.log(`✅ ARIA: POSTED — ${scored.HXID}`);
  }

  const auditWrite = appendToAuditLog({
    companyId: scored.companyId,
    timestamp: new Date().toISOString(),
    action: `TRANSACTION_${scored.status}`,
    details: `HXID: ${scored.HXID} | Vendor: ${scored.vendor} | Amount: ${scored.currency} ${scored.amount} | HXFRS: ${scored.HXFRS}`,
    layer: 'MODULE_1_2_INGESTION_FRAUD',
    status: scored.status,
  });

  const markWrite = row._rowIndex ? markTransactionProcessed(row._rowIndex, companyId) : Promise.resolve();

  await Promise.all([auditWrite, markWrite]).catch(() => {});

  return {
    success: true,
    HXID: scored.HXID,
    status: scored.status,
    HXFRS: scored.HXFRS,
    actionTier: scored.actionTier,
    fraudSignals: scored.fraudSignals,
  };
};

module.exports = { ingestTransaction };
