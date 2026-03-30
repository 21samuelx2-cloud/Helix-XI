const { getWeights } = require('./selfTune');
const { getCurrentBaseline } = require('./baseline');

// Cache weights and baseline for 10 mins to avoid hammering Sheets on every tx
let _weightsCache = null;
let _baselineCache = null;
let _cacheTime = 0;
const CACHE_TTL = 10 * 60 * 1000;

// Call this to force cache refresh after code changes
const clearCache = () => { _weightsCache = null; _baselineCache = null; _cacheTime = 0; };

const loadConfig = async () => {
  const now = Date.now();
  if (!_weightsCache || now - _cacheTime > CACHE_TTL) {
    _weightsCache  = await getWeights();
    _baselineCache = await getCurrentBaseline();
    _cacheTime = now;
  }
  return { weights: _weightsCache, baseline: _baselineCache };
};

const scoreFraud = async (tx) => {
  const { weights, baseline } = await loadConfig();

  let score = 0;
  const signals = [];

  // Signal 1: Amount deviation — tiered scoring + dynamic baseline
  const highLine = baseline ? parseFloat(baseline.highAmountLine) : 10000;
  const amountPct = weights.amount;
  const amountScore = tx.amount > 500000 ? amountPct
    : tx.amount > 100000  ? Math.round(amountPct * 0.88)
    : tx.amount > 75000   ? Math.round(amountPct * 0.80)
    : tx.amount > 50000   ? Math.round(amountPct * 0.75)
    : tx.amount > highLine ? Math.round(amountPct * 0.60)
    : tx.amount > highLine * 0.5 ? Math.round(amountPct * 0.35)
    : tx.amount > highLine * 0.1 ? Math.round(amountPct * 0.15)
    : 0;
  score += amountScore;
  if (amountScore >= Math.round(amountPct * 0.60)) signals.push(`High amount: ${tx.currency} ${tx.amount.toLocaleString()}`);

  // Signal 1b: Suspicious keywords — instant CRITICAL territory
  const suspiciousKeywords = [
    'hack', 'hacker', 'hacking',
    'launder', 'laundering', 'money laundering',
    'fraud', 'fraudulent',
    'scam', 'scammer',
    'illegal', 'illicit',
    'untraceable', 'anonymous', 'undetected',
    'bribe', 'bribery', 'corrupt', 'corruption',
    'blackmail', 'ransom', 'ransomware',
    'drug', 'cartel', 'trafficking',
    'terror', 'terrorist',
    'shell company', 'offshore', 'tax evasion',
    'cash', 'urgent', 'no invoice',
    'wire transfer', 'wire', 'transfer',
    'unknown', 'unverified',
  ];
  const descLower   = (tx.description || '').toLowerCase();
  const vendorLower = (tx.vendor || '').toLowerCase();
  const isSuspicious = suspiciousKeywords.some(k => descLower.includes(k) || vendorLower.includes(k));
  if (isSuspicious) {
    score += 40;
    signals.push('Suspicious keywords detected in vendor/description');
  }

  // Signal 2: New/unrecognized vendor
  const knownVendors = baseline ? baseline.knownVendors.split(' | ') : [];
  const isKnownVendor = knownVendors.includes(tx.vendorNormalized) || tx.fromMemory;
  if (!tx.vendor || tx.vendor === 'UNKNOWN' || !isKnownVendor) {
    score += weights.vendor;
    signals.push('Unrecognized vendor');
  }

  // Signal 3: Duplicate proximity
  if (tx._isDuplicate) {
    score += weights.duplicate;
    signals.push('Duplicate proximity detected (same vendor/amount ±3 days)');
  }

  // Signal 4: Timing anomaly — uses dynamic baseline weekend rate
  const baselineWeekendRate = baseline ? parseFloat(baseline.weekendRate) : 0.2;
  if (tx.isWeekend && baselineWeekendRate < 0.15) {
    score += Math.round(weights.timing * 0.55);
    signals.push('Weekend transaction');
  }
  if (tx.isOffHours) {
    score += Math.round(weights.timing * 0.45);
    signals.push('Off-hours transaction');
  }

  // Signal 5: Round number bias — uses dynamic baseline round rate
  const baselineRoundRate = baseline ? parseFloat(baseline.roundRate) : 0.1;
  if ((tx.amount % 1000 === 0 || tx.amount % 500 === 0) && tx.amount > 1000 && baselineRoundRate < 0.2) {
    score += weights.roundNumber;
    signals.push(`Round number bias: ${tx.currency} ${tx.amount}`);
  }

  // Signal 6: Category mismatch
  if (tx.category === 'UNCATEGORIZED') {
    score += weights.category;
    signals.push('Uncategorized transaction');
  }

  // Signal 7: Intercompany
  if (tx.isIntercompany) {
    score += weights.intercompany;
    signals.push('Intercompany — verify elimination');
  }

  // Signal 8: Velocity
  if (tx._velocityFlag) {
    score += 20;
    signals.push('Velocity alert: same vendor 3+ times in 24 hours');
  }

  const HXFRS = Math.min(Math.round(score), 100);

  // Force minimum score of 80 if suspicious keywords detected — should never auto-post
  const finalHXFRS = isSuspicious ? Math.max(HXFRS, 80) : HXFRS;

  let actionTier, action, requiresHold;
  if      (finalHXFRS <= 30) { actionTier = 'GREEN';    action = 'AUTO_POST';        requiresHold = false; }
  else if (finalHXFRS <= 59) { actionTier = 'YELLOW';   action = 'AUTO_POST_DIGEST'; requiresHold = false; }
  else if (finalHXFRS <= 79) { actionTier = 'ORANGE';   action = 'HOLD_REVIEW';      requiresHold = true;  }
  else if (finalHXFRS <= 89) { actionTier = 'RED';      action = 'HOLD_ESCALATE';    requiresHold = true;  }
  else                       { actionTier = 'CRITICAL'; action = 'HARD_BLOCK';       requiresHold = true;  }

  const anomalyBrief = [
    `HXID: ${tx.HXID}`, `Entity: ${tx.entity}`, `Vendor: ${tx.vendor}`,
    `Amount: ${tx.currency} ${tx.amount}`, `HXFRS: ${finalHXFRS}/100 [${actionTier}]`,
    signals.length ? `Signals: ${signals.join(' | ')}` : 'No anomaly signals',
  ].join(' · ');

  return { ...tx, HXFRS: finalHXFRS, actionTier, action, requiresHold, fraudSignals: signals, anomalyBrief };
};

module.exports = { scoreFraud, clearCache };
