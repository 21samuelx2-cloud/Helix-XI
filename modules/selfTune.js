const { getHoldQueue, getFraudConfig, upsertFraudConfig } = require('../db/supabase');

const DEFAULT_WEIGHTS = {
  amount: 25, vendor: 20, duplicate: 15, timing: 15,
  roundNumber: 10, category: 10, intercompany: 5,
};

const getWeights = async () => {
  try {
    const config = await getFraudConfig();
    if (config.length > 0) {
      const row = config[config.length - 1];
      const w = {
        amount:       parseFloat(row.WeightAmount)       || DEFAULT_WEIGHTS.amount,
        vendor:       parseFloat(row.WeightVendor)       || DEFAULT_WEIGHTS.vendor,
        duplicate:    parseFloat(row.WeightDuplicate)    || DEFAULT_WEIGHTS.duplicate,
        timing:       parseFloat(row.WeightTiming)       || DEFAULT_WEIGHTS.timing,
        roundNumber:  parseFloat(row.WeightRoundNumber)  || DEFAULT_WEIGHTS.roundNumber,
        category:     parseFloat(row.WeightCategory)     || DEFAULT_WEIGHTS.category,
        intercompany: parseFloat(row.WeightIntercompany) || DEFAULT_WEIGHTS.intercompany,
      };
      // Validate — if any are NaN or sum is way off, fall back to defaults
      const sum = Object.values(w).reduce((a, b) => a + b, 0);
      if (sum > 0 && sum < 200) return w;
    }
  } catch (_) {}
  return { ...DEFAULT_WEIGHTS };
};

const tuneThresholds = async () => {
  console.log('🧠 ARIA: Running self-tuning fraud threshold analysis...');
  try {
    const holdQueue = await getHoldQueue();

    const falsePositives = holdQueue.filter(r => r.Status === 'APPROVED');
    const truePositives  = holdQueue.filter(r => r.Status === 'REJECTED');
    const totalHeld      = falsePositives.length + truePositives.length;

    if (totalHeld < 10) {
      console.log('🧠 ARIA: Not enough hold data yet (need 10+). Skipping.');
      return;
    }

    const fpRate   = falsePositives.length / totalHeld;
    const weights  = await getWeights();
    let adjustment = 0;
    let reason     = '';

    if (fpRate > 0.40) {
      adjustment = -2;
      reason = `High false positive rate (${(fpRate * 100).toFixed(1)}%) — softening thresholds`;
    } else if (fpRate < 0.10 && truePositives.length >= 5) {
      adjustment = +2;
      reason = `Low false positive rate (${(fpRate * 100).toFixed(1)}%) — tightening thresholds`;
    } else {
      console.log(`🧠 ARIA: False positive rate ${(fpRate * 100).toFixed(1)}% — thresholds healthy.`);
      return;
    }

    // Count which signals appear most in false positives
    const signalCounts = {};
    falsePositives.forEach(r => {
      if (!r.FraudSignals) return;
      r.FraudSignals.split(' | ').forEach(s => {
        const key = s.toLowerCase();
        if (key.includes('amount'))       signalCounts.amount       = (signalCounts.amount || 0) + 1;
        if (key.includes('vendor'))       signalCounts.vendor       = (signalCounts.vendor || 0) + 1;
        if (key.includes('duplicate'))    signalCounts.duplicate    = (signalCounts.duplicate || 0) + 1;
        if (key.includes('weekend') || key.includes('off-hours')) signalCounts.timing = (signalCounts.timing || 0) + 1;
        if (key.includes('round'))        signalCounts.roundNumber  = (signalCounts.roundNumber || 0) + 1;
        if (key.includes('uncategor'))    signalCounts.category     = (signalCounts.category || 0) + 1;
        if (key.includes('intercompany')) signalCounts.intercompany = (signalCounts.intercompany || 0) + 1;
      });
    });

    const newWeights = { ...weights };
    Object.keys(newWeights).forEach(signal => {
      const fpCount = signalCounts[signal] || 0;
      const adj = fpCount > 3 ? adjustment * 1.5 : adjustment;
      newWeights[signal] = Math.max(1, Math.min(35, newWeights[signal] + adj));
    });

    // Normalize to sum to 100
    const total = Object.values(newWeights).reduce((a, b) => a + b, 0);
    Object.keys(newWeights).forEach(k => {
      newWeights[k] = parseFloat(((newWeights[k] / total) * 100).toFixed(2));
    });

    await upsertFraudConfig(newWeights, fpRate, reason);
    console.log(`🧠 ARIA: Thresholds updated — ${reason}`);
    return { adjusted: true, reason, newWeights, fpRate };

  } catch (err) {
    console.error('Threshold tuning error:', err.message);
  }
};

module.exports = { getWeights, tuneThresholds };
