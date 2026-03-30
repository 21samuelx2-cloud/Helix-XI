const { getLedger, upsertBaseline, getBaseline } = require('../db/supabase');

const recalculateBaseline = async () => {
  console.log('📊 ARIA: Recalculating anomaly baselines...');
  try {
    const ledger = await getLedger();
    if (ledger.length < 5) {
      console.log('📊 ARIA: Not enough data for baseline (need 5+ transactions). Skipping.');
      return;
    }

    const amounts = ledger.map(r => parseFloat(r.Amount)).filter(n => !isNaN(n) && n > 0);
    const mean    = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const variance = amounts.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / amounts.length;
    const stdDev  = Math.sqrt(variance);

    // Vendor frequency map
    const vendorCounts = {};
    ledger.forEach(r => {
      const v = (r.Vendor || '').toUpperCase().trim();
      vendorCounts[v] = (vendorCounts[v] || 0) + 1;
    });
    const knownVendors = Object.keys(vendorCounts).filter(v => vendorCounts[v] >= 2);

    // Category distribution
    const catCounts = {};
    ledger.forEach(r => { catCounts[r.Category] = (catCounts[r.Category] || 0) + 1; });

    // Weekend/off-hours rate
    const weekendCount = ledger.filter(r => {
      const d = new Date(r.Date);
      return d.getDay() === 0 || d.getDay() === 6;
    }).length;
    const weekendRate = weekendCount / ledger.length;

    // Round number rate
    const roundCount = ledger.filter(r => {
      const a = parseFloat(r.Amount);
      return (a % 1000 === 0 || a % 500 === 0) && a > 1000;
    }).length;
    const roundRate = roundCount / ledger.length;

    const baseline = {
      updatedAt:      new Date().toISOString(),
      txCount:        ledger.length,
      meanAmount:     mean.toFixed(2),
      stdDevAmount:   stdDev.toFixed(2),
      highAmountLine: (mean + 2 * stdDev).toFixed(2), // 2 std devs above mean = anomaly
      knownVendors:   knownVendors.join(' | '),
      knownVendorCount: knownVendors.length,
      weekendRate:    weekendRate.toFixed(4),
      roundRate:      roundRate.toFixed(4),
      topCategory:    Object.keys(catCounts).sort((a, b) => catCounts[b] - catCounts[a])[0] || 'UNKNOWN',
    };

    await upsertBaseline(baseline);
    console.log(`📊 ARIA: Baseline updated — mean $${baseline.meanAmount}, high-amount line $${baseline.highAmountLine}, ${knownVendors.length} known vendors`);
    return baseline;

  } catch (err) {
    console.error('Baseline recalculation error:', err.message);
  }
};

// Used by fraud.js to get dynamic thresholds
const getCurrentBaseline = async () => {
  try {
    const rows = await getBaseline();
    if (rows.length > 0) return rows[rows.length - 1];
  } catch (_) {}
  return null;
};

module.exports = { recalculateBaseline, getCurrentBaseline };
