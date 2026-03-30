const { google } = require('googleapis');
require('dotenv').config();

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_KEY_FILE = String(process.env.GOOGLE_KEY_FILE || '').trim();
const GOOGLE_SERVICE_ACCOUNT_JSON = String(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '').trim();

if (!SHEET_ID) throw new Error('GOOGLE_SHEET_ID is not set in .env');
if (!GOOGLE_KEY_FILE && !GOOGLE_SERVICE_ACCOUNT_JSON) {
  throw new Error('Set GOOGLE_KEY_FILE or GOOGLE_SERVICE_ACCOUNT_JSON before using Google Sheets integration');
}

let authConfig = {
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
};

if (GOOGLE_SERVICE_ACCOUNT_JSON) {
  authConfig = {
    ...authConfig,
    credentials: JSON.parse(GOOGLE_SERVICE_ACCOUNT_JSON),
  };
} else {
  authConfig = {
    ...authConfig,
    keyFile: GOOGLE_KEY_FILE,
  };
}

const auth = new google.auth.GoogleAuth(authConfig);

const sheets = google.sheets({ version: 'v4', auth });

// Sanitize a value before writing to sheet — prevent formula injection
const sanitize = (v) => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  // Block formula injection
  if (['=', '+', '-', '@'].includes(s[0])) return `'${s}`;
  return s;
};

const sanitizeRow = (values) => values.map(sanitize);

const getRows = async (range) => {
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range });
    const [headers, ...rows] = res.data.values || [];
    if (!headers) return [];
    return rows.map((r, i) => {
      const obj = {};
      headers.forEach((h, j) => { obj[h.trim()] = r[j] || ''; });
      obj._rowIndex = i + 2;
      return obj;
    });
  } catch (err) {
    // Return empty array for missing/empty sheets instead of crashing
    if (err.code === 400 || err.message?.includes('Unable to parse range')) return [];
    throw err;
  }
};

const appendRow = async (range, values) => {
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range,
    valueInputOption: 'RAW',
    resource: { values: [sanitizeRow(values)] },
  });
};

const updateCell = async (range, value) => {
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range,
    valueInputOption: 'RAW',
    resource: { values: [[sanitize(value)]] },
  });
};

// ── In-memory cache ─────────────────────────────────────────────────────────
const _cache = {};
const CACHE_TTL = {
  ledger:    30 * 1000,
  holdqueue: 30 * 1000,
  fxrates:   4  * 60 * 60 * 1000,
  vendormap: 5  * 60 * 1000,
  baseline:  10 * 60 * 1000,
  fraudconfig: 10 * 60 * 1000,
};

const cached = async (key, ttl, fn) => {
  const now = Date.now();
  if (_cache[key] && now - _cache[key].t < ttl) return _cache[key].v;
  const v = await fn();
  _cache[key] = { v, t: now };
  return v;
};

const invalidate = (...keys) => keys.forEach(k => { delete _cache[k]; });
const invalidateAll = () => { Object.keys(_cache).forEach(k => delete _cache[k]); };

// ── Sheet accessors ──────────────────────────────────────────────────────────

const getTransactions     = () => getRows('HELIXXI_Transactions!A:Z');
const getLedger           = () => cached('ledger',     CACHE_TTL.ledger,      () => getRows('HELIXXI_Ledger!A:Z'));
const getHoldQueue        = () => cached('holdqueue',  CACHE_TTL.holdqueue,   () => getRows('HELIXXI_HoldQueue!A:Z'));
const getForecasts        = () => cached('forecasts',  2  * 60 * 1000,  () => getRows('HELIXXI_Forecasts!A:Z'));
const getAuditLog         = () => cached('auditlog',   2  * 60 * 1000,  () => getRows('HELIXXI_AuditLog!A:Z'));
const getFreezeLog        = () => getRows('HELIXXI_FreezeLog!A:Z');
const getFXRates          = () => cached('fxrates',    CACHE_TTL.fxrates,     () => getRows('HELIXXI_FX_History!A:Z'));
const getVendorMap        = () => cached('vendormap',  CACHE_TTL.vendormap,   () => getRows('HELIXXI_VendorMap!A:Z'));
const getFraudConfig      = () => cached('fraudconfig',CACHE_TTL.fraudconfig, () => getRows('HELIXXI_FraudConfig!A:Z'));
const getBaseline         = () => cached('baseline',   CACHE_TTL.baseline,    () => getRows('HELIXXI_Baseline!A:Z'));
const getPerformanceReports = () => getRows('HELIXXI_Performance!A:Z');

// ── Upserts ──────────────────────────────────────────────────────────────────

const upsertVendorMap = async (vendor, category, confidence, timesConfirmed, rowIndex) => {
  if (rowIndex) {
    await updateCell(`HELIXXI_VendorMap!B${rowIndex}`, category);
    await updateCell(`HELIXXI_VendorMap!C${rowIndex}`, confidence);
    await updateCell(`HELIXXI_VendorMap!D${rowIndex}`, new Date().toISOString());
    await updateCell(`HELIXXI_VendorMap!E${rowIndex}`, timesConfirmed);
  } else {
    await appendRow('HELIXXI_VendorMap!A:E', [vendor, category, confidence, new Date().toISOString(), timesConfirmed]);
  }
};

const upsertFraudConfig = async (weights, fpRate, reason) => {
  await appendRow('HELIXXI_FraudConfig!A:J', [
    new Date().toISOString(),
    weights.amount, weights.vendor, weights.duplicate, weights.timing,
    weights.roundNumber, weights.category, weights.intercompany,
    fpRate, reason,
  ]);
};

const upsertBaseline = async (b) => {
  await appendRow('HELIXXI_Baseline!A:J', [
    b.updatedAt, b.txCount, b.meanAmount, b.stdDevAmount,
    b.highAmountLine, b.knownVendors, b.knownVendorCount,
    b.weekendRate, b.roundRate, b.topCategory,
  ]);
};

const appendToPerformanceReport = (r) => appendRow('HELIXXI_Performance!A:P', [
  r.GeneratedAt, r.PeriodStart, r.PeriodEnd, r.TxCount, r.WeeklyVolume,
  r.AvgFraudScore, r.TotalHeld, r.FalsePositives, r.TruePositives,
  r.FalsePositiveRate, r.FraudPrecision, r.CatAccuracy, r.UncategorizedTx,
  r.LearnedVendors, r.ForecastAccuracy, r.HealthSignal,
]);

// ── Ledger / Queue writes ────────────────────────────────────────────────────

const appendToLedger = async (tx) => {
  await appendRow('HELIXXI_Ledger!A:T', [
    tx.HXID, tx.date, tx.vendor, tx.amount, tx.currency, tx.amountBase, tx.fxRate,
    tx.entity, tx.category, tx.categoryConfidence, tx.HXFRS, tx.actionTier,
    tx.action, 'POSTED', tx.isIntercompany, tx.isDeductible, tx.vatApplicable,
    tx.duplicateCheckKey, tx.description, tx.postedAt,
  ]);
  invalidate('ledger');
};

const appendToHoldQueue = async (tx) => {
  await appendRow('HELIXXI_HoldQueue!A:N', [
    tx.HXID, tx.date, tx.vendor, tx.amount, tx.currency, tx.entity,
    tx.HXFRS, tx.actionTier, 'PENDING_CFO_REVIEW', tx.anomalyBrief,
    Array.isArray(tx.fraudSignals) ? tx.fraudSignals.join(' | ') : '',
    tx.heldAt, '', '',
  ]);
  invalidate('holdqueue');
};

const appendToRejectionLog = (r) => appendRow('HELIXXI_RejectionLog!A:D', [
  r.timestamp, r.reason, r.rawData, r.status,
]);

const appendToAuditLog = (e) => appendRow('HELIXXI_AuditLog!A:E', [
  e.timestamp, e.action, e.details, e.layer, e.status,
]);

const appendToForecast = (f) => appendRow('HELIXXI_Forecasts!A:N', [
  f.GeneratedAt, f.MonthlyBurn,
  f.ModelA_30Day, f.ModelA_60Day, f.ModelA_90Day,
  f.ModelB_P10_90Day, f.ModelB_P50_90Day, f.ModelB_P90_90Day,
  f.ModelC_Bull, f.ModelC_Base, f.ModelC_Stress,
  f.CashGapRisk, f.CashGapAlert, f.TransactionsAnalyzed,
]);

const appendToFXRates = (r) => appendRow('HELIXXI_FX_History!A:C', [
  r.timestamp, r.base, r.rates,
]);

const getARIAMemory      = () => cached('ariamemory', 60 * 1000,             () => getRows('HELIXXI_ARIAMemory!A:Z'));
const appendToARIAMemory = (m) => {
  invalidate('ariamemory');
  return appendRow('HELIXXI_ARIAMemory!A:D', [m.timestamp, m.role, m.content, m.sessionId]);
};

const getARIAJournal      = () => getRows('HELIXXI_ARIAJournal!A:C');
const appendToARIAJournal = (entry) => appendRow('HELIXXI_ARIAJournal!A:C', [
  entry.timestamp, entry.title, entry.content
]);

// Fixed: was pointing to wrong tab name 'Transactions' instead of 'HELIXXI_Transactions'
const markTransactionProcessed = async (rowIndex) => {
  await updateCell(`HELIXXI_Transactions!H${rowIndex}`, 'YES');
};

const updateHoldDecision = async (hxid, decision, cfoName) => {
  const queue = await getHoldQueue();
  const row = queue.find(r => r.HXID === hxid);
  if (!row) throw new Error(`HXID ${hxid} not found in HoldQueue`);

  const newStatus = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
  await updateCell(`HELIXXI_HoldQueue!I${row._rowIndex}`, newStatus);
  await updateCell(`HELIXXI_HoldQueue!M${row._rowIndex}`, cfoName);
  await updateCell(`HELIXXI_HoldQueue!N${row._rowIndex}`, new Date().toISOString());

  if (decision === 'APPROVE') {
    await appendToLedger({
      HXID: row.HXID,
      date: row.Date, vendor: row.Vendor, amount: row.Amount,
      currency: row.Currency, amountBase: row.Amount, fxRate: 1,
      entity: row.Entity, category: row.Category || 'UNCATEGORIZED',
      categoryConfidence: 0, HXFRS: row.HXFRS, actionTier: row.ActionTier,
      action: 'CFO_APPROVED', status: 'POSTED',
      isIntercompany: false, isDeductible: true, vatApplicable: false,
      duplicateCheckKey: '', description: row.AnomalyBrief,
      postedAt: new Date().toISOString(),
    });
  }

  await appendToAuditLog({
    timestamp: new Date().toISOString(),
    action: `CFO_${newStatus}`,
    details: `HXID: ${hxid} | Decision by: ${cfoName}`,
    layer: 'MODULE_4_APPROVAL_CHAIN',
    status: newStatus,
  });
  invalidate('holdqueue', 'ledger');
};

module.exports = {
  getTransactions, getLedger, getHoldQueue, getForecasts,
  getAuditLog, getFreezeLog, getFXRates,
  getVendorMap, getFraudConfig, getBaseline, getPerformanceReports,
  appendToLedger, appendToHoldQueue, appendToRejectionLog,
  appendToAuditLog, appendToForecast, appendToFXRates,
  upsertVendorMap, upsertFraudConfig, upsertBaseline, appendToPerformanceReport,
  markTransactionProcessed, updateHoldDecision,
  getARIAMemory, appendToARIAMemory,
  getARIAJournal, appendToARIAJournal,
  invalidateAll, invalidate,
};
