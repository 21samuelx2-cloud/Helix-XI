// Legacy reference file.
// Active fraud logic lives in ../modules/fraud.js.

const scoreFraud = (tx) => {
  let score = 0;
  const signals = [];

  // Signal 1: Amount anomaly (22%)
  const amountScore = tx.amount > 10000 ? 22 : tx.amount > 5000 ? 14 : tx.amount > 1000 ? 8 : 0;
  score += amountScore;
  if (amountScore > 14) signals.push(`High amount: ${tx.currency} ${tx.amount}`);

  // Signal 2: New/unrecognized vendor (18%)
  const isNewVendor = !tx.vendor || tx.vendor === 'UNKNOWN';
  if (isNewVendor) { score += 18; signals.push('Unrecognized vendor'); }

  // Signal 3: Round number bias (10%)
  const isRoundNumber = tx.amount % 1000 === 0 || tx.amount % 500 === 0;
  if (isRoundNumber && tx.amount > 1000) { score += 10; signals.push(`Round number: ${tx.currency} ${tx.amount}`); }

  // Signal 4: Timing anomaly (10%)
  if (tx.isWeekend) { score += 5; signals.push('Weekend transaction'); }
  if (tx.isOffHours) { score += 5; signals.push('Off-hours transaction'); }

  // Signal 5: Uncategorized (10%)
  if (tx.category === 'UNCATEGORIZED') { score += 10; signals.push('Uncategorized transaction'); }

  // Signal 6: Intercompany (2%)
  if (tx.isIntercompany) { score += 2; signals.push('Intercompany — verify elimination'); }

  // Cap at 100
  const HXFRS = Math.min(score, 100);

  // Action tier
  let actionTier, action, requiresHold;
  if (HXFRS <= 29) { actionTier = 'GREEN'; action = 'AUTO_POST'; requiresHold = false; }
  else if (HXFRS <= 54) { actionTier = 'YELLOW'; action = 'AUTO_POST_DIGEST'; requiresHold = false; }
  else if (HXFRS <= 74) { actionTier = 'ORANGE'; action = 'AUTO_POST_ALERT'; requiresHold = false; }
  else if (HXFRS <= 89) { actionTier = 'RED'; action = 'HOLD_ESCALATE'; requiresHold = true; }
  else { actionTier = 'CRITICAL'; action = 'HARD_BLOCK'; requiresHold = true; }

  const anomalyBrief = `HXID: ${tx.HXID} | Entity: ${tx.entity} | Vendor: ${tx.vendor} | Amount: ${tx.currency} ${tx.amount} | HXFRS: ${HXFRS}/100 ${actionTier} | Signals: ${signals.join(', ')}`;

  return { ...tx, HXFRS, actionTier, action, requiresHold, fraudSignals: signals, anomalyBrief };
};

module.exports = { scoreFraud };
