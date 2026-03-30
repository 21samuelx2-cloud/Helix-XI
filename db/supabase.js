const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const applyCompanyFilter = (query, companyId) => {
  if (!companyId) return query;
  return query.eq('company_id', companyId);
};

const inboundEventCache = new Map();
const INBOUND_EVENT_CACHE_LIMIT = 5000;

const cleanupInboundEventCache = (now = Date.now()) => {
  for (const [key, expiresAt] of inboundEventCache.entries()) {
    if (expiresAt <= now) inboundEventCache.delete(key);
  }
  if (inboundEventCache.size <= INBOUND_EVENT_CACHE_LIMIT) return;
  const overflow = inboundEventCache.size - INBOUND_EVENT_CACHE_LIMIT;
  const keys = inboundEventCache.keys();
  for (let i = 0; i < overflow; i += 1) {
    const next = keys.next();
    if (next.done) break;
    inboundEventCache.delete(next.value);
  }
};

const getMissingSchemaColumn = (message = '') => {
  const match = message.match(/Could not find the '([^']+)' column/);
  return match ? match[1] : null;
};

const insertWithOptionalColumns = async (table, payload, optionalColumns = []) => {
  const row = { ...payload };
  const stripped = new Set();

  while (true) {
    const { error } = await supabase.from(table).insert(row);
    if (!error) return;

    const missingColumn = getMissingSchemaColumn(error.message);
    if (missingColumn && optionalColumns.includes(missingColumn) && !stripped.has(missingColumn)) {
      stripped.add(missingColumn);
      delete row[missingColumn];
      continue;
    }

    throw new Error(error.message);
  }
};

// ── Transactions ─────────────────────────────────────────────────────────────

const getTransactions = async (companyId) => {
  const { data, error } = await applyCompanyFilter(
    supabase
    .from('helixxi_transactions')
    .select('*')
    .eq('processed', 'NO')
    .order('created_at', { ascending: true }),
    companyId
  );
  if (error) throw new Error(error.message);
  return data.map(r => ({
    ...r,
    Date: r.date, Vendor: r.vendor, Amount: r.amount,
    Currency: r.currency, Entity: r.entity,
    Description: r.description, Category: r.category,
    Processed: r.processed, _rowIndex: r.id,
  }));
};

const markTransactionProcessed = async (id, companyId) => {
  const { error } = await applyCompanyFilter(
    supabase
    .from('helixxi_transactions')
    .update({ processed: 'YES' })
    .eq('id', id),
    companyId
  );
  if (error) throw new Error(error.message);
};

// ── Ledger ───────────────────────────────────────────────────────────────────

const getLedger = async (companyId) => {
  const { data, error } = await applyCompanyFilter(
    supabase
    .from('helixxi_ledger')
    .select('*')
    .order('created_at', { ascending: true }),
    companyId
  );
  if (error) throw new Error(error.message);
  return data.map(r => ({
    ...r,
    HXID: r.hxid, Date: r.date, Vendor: r.vendor, Amount: r.amount,
    Currency: r.currency, AmountBase: r.amount_base, FXRate: r.fx_rate,
    Entity: r.entity, Category: r.category,
    CategoryConfidence: r.category_confidence,
    HXFRS: r.hxfrs, ActionTier: r.action_tier,
    FraudSignals: r.fraud_signals, Status: r.status,
    Description: r.description,
  }));
};

const appendToLedger = async (tx, companyId) => {
  await insertWithOptionalColumns('helixxi_ledger', {
    company_id:          companyId || tx.companyId || tx.company_id || null,
    hxid:                tx.HXID,
    timestamp:           tx.timestamp || new Date().toISOString(),
    date:                tx.date,
    vendor:              tx.vendor,
    vendor_normalized:   tx.vendorNormalized,
    amount:              tx.amount,
    currency:            tx.currency,
    amount_base:         tx.amountBase,
    fx_rate:             tx.fxRate,
    entity:              tx.entity,
    category:            tx.category,
    category_confidence: tx.categoryConfidence,
    hxfrs:               tx.HXFRS,
    action_tier:         tx.actionTier,
    fraud_signals:       Array.isArray(tx.fraudSignals) ? tx.fraudSignals.join(' | ') : '',
    is_intercompany:     tx.isIntercompany || false,
    is_deductible:       tx.isDeductible !== false,
    vat_applicable:      tx.vatApplicable || false,
    description:         tx.description,
    status:              'POSTED',
    needs_ai_review:     tx.needsAIReview || false,
  }, ['fraud_signals']);
};

// ── Hold Queue ───────────────────────────────────────────────────────────────

const getHoldQueue = async (companyId) => {
  const { data, error } = await applyCompanyFilter(
    supabase
    .from('helixxi_holdqueue')
    .select('*')
    .order('created_at', { ascending: true }),
    companyId
  );
  if (error) throw new Error(error.message);
  return data.map(r => ({
    ...r,
    HXID: r.hxid, Vendor: r.vendor, Amount: r.amount,
    Currency: r.currency, Entity: r.entity,
    HXFRS: r.hxfrs, ActionTier: r.action_tier,
    AnomalyBrief: r.anomaly_brief, Status: r.status,
    FraudSignals: r.fraud_signals,
    HeldAt: r.held_at,
  }));
};

const appendToHoldQueue = async (tx, companyId) => {
  await insertWithOptionalColumns('helixxi_holdqueue', {
    company_id:  companyId || tx.companyId || tx.company_id || null,
    hxid:        tx.HXID,
    held_at:     tx.heldAt || new Date().toISOString(),
    vendor:      tx.vendor,
    amount:      tx.amount,
    currency:    tx.currency,
    entity:      tx.entity,
    hxfrs:       tx.HXFRS,
    action_tier: tx.actionTier,
    anomaly_brief: tx.anomalyBrief,
    fraud_signals: Array.isArray(tx.fraudSignals) ? tx.fraudSignals.join(' | ') : '',
    status:      'PENDING_CFO_REVIEW',
  }, ['fraud_signals']);
};

const updateHoldDecision = async (hxid, decision, cfoName, companyId) => {
  const newStatus = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';

  const { data: rows, error: fetchErr } = await applyCompanyFilter(
    supabase
    .from('helixxi_holdqueue')
    .select('*')
    .eq('hxid', hxid),
    companyId
  ).single();
  if (fetchErr) throw new Error(`HXID ${hxid} not found`);

  const { error: updateErr } = await applyCompanyFilter(
    supabase
    .from('helixxi_holdqueue')
    .update({ status: newStatus, cfo_decision: decision, cfo_name: cfoName, cfo_timestamp: new Date().toISOString() })
    .eq('hxid', hxid),
    companyId
  );
  if (updateErr) throw new Error(updateErr.message);

  if (decision === 'APPROVE') {
    await appendToLedger({
      companyId: rows.company_id || companyId || null,
      HXID: rows.hxid, timestamp: new Date().toISOString(),
      date: rows.held_at?.split('T')[0], vendor: rows.vendor,
      vendorNormalized: rows.vendor?.toUpperCase().replace(/[^A-Z0-9 ]/g, '').trim(),
      amount: rows.amount, currency: rows.currency,
      amountBase: rows.amount, fxRate: 1,
      entity: rows.entity, category: 'UNCATEGORIZED',
      categoryConfidence: 0, HXFRS: rows.hxfrs,
      actionTier: rows.action_tier, fraudSignals: [],
      description: rows.anomaly_brief,
    }, rows.company_id || companyId);
  }

  await appendToAuditLog({
    companyId: rows.company_id || companyId || null,
    timestamp: new Date().toISOString(),
    action: `CFO_${newStatus}`,
    details: `HXID: ${hxid} | Decision by: ${cfoName}`,
    layer: 'MODULE_4_APPROVAL_CHAIN',
    status: newStatus,
  }, rows.company_id || companyId);
};

// ── Forecasts ────────────────────────────────────────────────────────────────

const getForecasts = async (companyId) => {
  const { data, error } = await applyCompanyFilter(
    supabase
    .from('helixxi_forecasts')
    .select('*')
    .order('created_at', { ascending: true }),
    companyId
  );
  if (error) throw new Error(error.message);
  return data.map(r => ({
    ...r,
    GeneratedAt:      r.generated_at,
    MonthlyBurn:      r.monthly_burn,
    ModelA_30Day:     r.model_a_30day,
    ModelA_60Day:     r.model_a_60day,
    ModelA_90Day:     r.model_a_90day,
    ModelB_P10_90Day: r.model_b_p10_90day,
    ModelB_P50_90Day: r.model_b_p50_90day,
    ModelB_P90_90Day: r.model_b_p90_90day,
    ModelC_Bull:      r.model_c_bull,
    ModelC_Base:      r.model_c_base,
    ModelC_Stress:    r.model_c_stress,
    CashGapRisk:      r.cash_gap_risk?.toString(),
    CashGapAlert:     r.cash_gap_alert,
    TransactionsAnalyzed: r.transactions_analyzed,
  }));
};

const appendToForecast = async (f, companyId) => {
  const { error } = await supabase.from('helixxi_forecasts').insert({
    company_id:           companyId || f.companyId || f.company_id || null,
    generated_at:         f.GeneratedAt,
    monthly_burn:         parseFloat(f.MonthlyBurn),
    model_a_30day:        parseFloat(f.ModelA_30Day),
    model_a_60day:        parseFloat(f.ModelA_60Day),
    model_a_90day:        parseFloat(f.ModelA_90Day),
    model_b_p10_90day:    parseFloat(f.ModelB_P10_90Day),
    model_b_p50_90day:    parseFloat(f.ModelB_P50_90Day),
    model_b_p90_90day:    parseFloat(f.ModelB_P90_90Day),
    model_c_bull:         parseFloat(f.ModelC_Bull),
    model_c_base:         parseFloat(f.ModelC_Base),
    model_c_stress:       parseFloat(f.ModelC_Stress),
    cash_gap_risk:        f.CashGapRisk === 'true',
    cash_gap_alert:       f.CashGapAlert,
    transactions_analyzed: parseInt(f.TransactionsAnalyzed),
  });
  if (error) throw new Error(error.message);
};

// ── Audit Log ────────────────────────────────────────────────────────────────

const getAuditLog = async (companyId) => {
  const { data, error } = await applyCompanyFilter(
    supabase
    .from('helixxi_auditlog')
    .select('*')
    .order('created_at', { ascending: true }),
    companyId
  );
  if (error) throw new Error(error.message);
  return data.map(r => ({
    ...r,
    Timestamp: r.timestamp, Action: r.action,
    Details: r.details, Layer: r.layer, Status: r.status,
  }));
};

const appendToAuditLog = async (e, companyId) => {
  const { error } = await supabase.from('helixxi_auditlog').insert({
    company_id: e.companyId || e.company_id || companyId || null,
    timestamp: e.timestamp, action: e.action,
    details: e.details, layer: e.layer, status: e.status,
  });
  if (error) console.error('Audit log error:', error.message);
};

// ── FX Rates ─────────────────────────────────────────────────────────────────

const getFXRates = async () => {
  const { data, error } = await supabase
    .from('helixxi_fx_history')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return data.map(r => ({
    ...r,
    Timestamp: r.timestamp, Base: r.base_currency,
    Rates: JSON.stringify({ [r.target_currency]: r.rate }),
  }));
};

const appendToFXRates = async (r) => {
  const rates = JSON.parse(r.rates || '{}');
  const rows = Object.entries(rates).map(([currency, rate]) => ({
    timestamp: r.timestamp, base_currency: r.base,
    target_currency: currency, rate: parseFloat(rate), source: 'api',
  }));
  if (!rows.length) return;
  const { error } = await supabase.from('helixxi_fx_history').insert(rows);
  if (error) console.error('FX rates error:', error.message);
};

// ── Vendor Map ───────────────────────────────────────────────────────────────

const getVendorMap = async () => {
  const { data, error } = await supabase
    .from('helixxi_vendormap')
    .select('*');
  if (error) throw new Error(error.message);
  return data.map(r => ({
    ...r,
    Vendor: r.vendor_normalized, Category: r.category,
    Confidence: r.confidence, TimesConfirmed: r.times_seen,
  }));
};

const upsertVendorMap = async (vendor, category, confidence) => {
  const { error } = await supabase.from('helixxi_vendormap').upsert({
    vendor_normalized: vendor, category,
    confidence: parseInt(confidence),
    last_seen: new Date().toISOString(),
  }, { onConflict: 'vendor_normalized' });
  if (error) console.error('Vendor map error:', error.message);
};

// ── Fraud Config ─────────────────────────────────────────────────────────────

const getFraudConfig = async () => {
  const { data, error } = await supabase
    .from('helixxi_fraudconfig')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) return [];
  return (data || []).map(r => ({
    WeightAmount: r.weight_amount, WeightVendor: r.weight_vendor,
    WeightDuplicate: r.weight_duplicate, WeightTiming: r.weight_timing,
    WeightRoundNumber: r.weight_round_number, WeightCategory: r.weight_category,
    WeightIntercompany: r.weight_intercompany,
  }));
};

const upsertFraudConfig = async (weights, fpRate, reason) => {
  const { error } = await supabase.from('helixxi_fraudconfig').insert({
    weight_amount: weights.amount, weight_vendor: weights.vendor,
    weight_duplicate: weights.duplicate, weight_timing: weights.timing,
    weight_round_number: weights.roundNumber, weight_category: weights.category,
    weight_intercompany: weights.intercompany,
    fp_rate: fpRate, reason,
    timestamp: new Date().toISOString(),
  });
  if (error) console.error('Fraud config error:', error.message);
};

// ── Baseline ─────────────────────────────────────────────────────────────────

const getBaseline = async () => {
  const { data, error } = await supabase
    .from('helixxi_baseline')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) return [];
  return (data || []).map(r => ({
    highAmountLine: r.high_amount_line, knownVendors: r.known_vendors,
    weekendRate: r.weekend_rate, roundRate: r.round_rate,
    meanAmount: r.mean_amount, stdDevAmount: r.std_dev_amount,
    txCount: r.tx_count,
  }));
};

const upsertBaseline = async (b) => {
  const { error } = await supabase.from('helixxi_baseline').insert({
    updated_at: b.updatedAt, tx_count: b.txCount,
    mean_amount: b.meanAmount, std_dev_amount: b.stdDevAmount,
    high_amount_line: b.highAmountLine, known_vendors: b.knownVendors,
    known_vendor_count: b.knownVendorCount, weekend_rate: b.weekendRate,
    round_rate: b.roundRate, top_category: b.topCategory,
  });
  if (error) console.error('Baseline error:', error.message);
};

// ── ARIA Memory ──────────────────────────────────────────────────────────────

const getARIAMemory = async (companyId) => {
  const { data, error } = await applyCompanyFilter(
    supabase
    .from('helixxi_ariamemory')
    .select('*')
    .order('created_at', { ascending: true }),
    companyId
  );
  if (error) throw new Error(error.message);
  return data.map(r => ({
    ...r,
    Timestamp: r.timestamp, Role: r.role,
    Content: r.content, SessionId: r.session_id,
  }));
};

const appendToARIAMemory = async (m, companyId) => {
  const { error } = await supabase.from('helixxi_ariamemory').insert({
    company_id: m.companyId || m.company_id || companyId || null,
    timestamp: m.timestamp, role: m.role,
    content: m.content, session_id: m.sessionId,
  });
  if (error) console.error('Memory error:', error.message);
};

// ── ARIA Journal ─────────────────────────────────────────────────────────────

const getARIAJournal = async (companyId) => {
  const { data, error } = await applyCompanyFilter(
    supabase
    .from('helixxi_ariajournal')
    .select('*')
    .order('created_at', { ascending: false }),
    companyId
  );
  if (error) throw new Error(error.message);
  return data.map(r => ({
    ...r,
    Timestamp: r.timestamp, Title: r.title || 'Untitled',
    Content: r.content,
  }));
};

const appendToARIAJournal = async (entry, companyId) => {
  const { error } = await supabase.from('helixxi_ariajournal').insert({
    company_id: entry.companyId || entry.company_id || companyId || null,
    timestamp: entry.timestamp,
    title:     entry.title || 'Untitled',
    content:   entry.content,
    word_count: entry.content?.split(' ').length || 0,
  });
  if (error) throw new Error(error.message);
};

// ── Misc ─────────────────────────────────────────────────────────────────────

const getFreezeLog = async () => {
  const { data, error } = await supabase.from('helixxi_freezelog').select('*');
  if (error) return [];
  return data;
};

const appendToRejectionLog = async (r, companyId) => {
  const { error } = await supabase.from('helixxi_rejectionlog').insert({
    company_id: companyId || r.companyId || r.company_id || null,
    timestamp: r.timestamp, reason: r.reason,
    raw_data: r.rawData, status: r.status,
  });
  if (error) console.error('Rejection log error:', error.message);
};

const getPerformanceReports = async (companyId) => {
  const { data, error } = await applyCompanyFilter(
    supabase.from('helixxi_performance').select('*'),
    companyId
  );
  if (error) return [];
  return data;
};

const appendToPerformanceReport = async (r, companyId) => {
  const { error } = await supabase.from('helixxi_performance').insert({
    ...r,
    company_id: companyId || r.companyId || r.company_id || null,
  });
  if (error) console.error('Performance report error:', error.message);
};

const claimInboundEvent = async ({ eventKey, companyId, source, payloadHash, receivedAt, expiresAt, metadata }) => {
  const now = Date.now();
  cleanupInboundEventCache(now);
  const cacheExpiry = new Date(expiresAt || now + (10 * 60 * 1000)).getTime();
  if (inboundEventCache.has(eventKey)) {
    return { accepted: false, reason: 'duplicate' };
  }

  const row = {
    event_key: eventKey,
    company_id: companyId || null,
    source,
    payload_hash: payloadHash || null,
    metadata: metadata || {},
    received_at: receivedAt || new Date().toISOString(),
    expires_at: expiresAt || new Date(cacheExpiry).toISOString(),
  };

  const { error } = await supabase.from('helixxi_inbound_events').insert(row);
  if (!error) {
    inboundEventCache.set(eventKey, cacheExpiry);
    return { accepted: true };
  }

  if (error.code === '23505') {
    inboundEventCache.set(eventKey, cacheExpiry);
    return { accepted: false, reason: 'duplicate' };
  }

  // If the table is not present yet, fall back to process memory instead of failing ingestion.
  if (error.code === '42P01') {
    inboundEventCache.set(eventKey, cacheExpiry);
    return { accepted: true, fallback: true };
  }

  throw new Error(error.message);
};

const invalidate = () => {}; // No cache needed with Supabase
const invalidateAll = () => {};

module.exports = {
  getTransactions, markTransactionProcessed,
  getLedger, appendToLedger,
  getHoldQueue, appendToHoldQueue, updateHoldDecision,
  getForecasts, appendToForecast,
  getAuditLog, appendToAuditLog,
  getFXRates, appendToFXRates,
  getVendorMap, upsertVendorMap,
  getFraudConfig, upsertFraudConfig,
  getBaseline, upsertBaseline,
  getARIAMemory, appendToARIAMemory,
  getARIAJournal, appendToARIAJournal,
  getFreezeLog, appendToRejectionLog,
  getPerformanceReports, appendToPerformanceReport,
  claimInboundEvent,
  invalidate, invalidateAll,
};
