const { getLedger, getHoldQueue, getForecasts, getVendorMap, appendToAuditLog, appendToPerformanceReport } = require('../db/supabase');

const generatePerformanceReport = async (companyId) => {
  console.log('📋 ARIA: Generating weekly performance report...');
  try {
    const [ledger, holdQueue, forecasts, vendorMap] = await Promise.all([
      getLedger(companyId), getHoldQueue(companyId), getForecasts(companyId), getVendorMap(),
    ]);

    const now     = new Date();
    const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);

    // ── Fraud accuracy ──────────────────────────────────────
    const recentHolds    = holdQueue.filter(r => {
      const d = new Date(r.HeldAt || r.Date || 0);
      return !isNaN(d) && d >= weekAgo;
    });
    const falsePositives = recentHolds.filter(r => r.Status === 'APPROVED').length;
    const truePositives  = recentHolds.filter(r => r.Status === 'REJECTED').length;
    const totalHeld      = recentHolds.length;
    const fpRate         = totalHeld > 0 ? (falsePositives / totalHeld * 100).toFixed(1) : 'N/A';
    const precision      = totalHeld > 0 ? (truePositives  / totalHeld * 100).toFixed(1) : 'N/A';

    // ── Categorization accuracy ─────────────────────────────
    const recentLedger  = ledger.filter(r => {
      const d = new Date(r.Date || 0);
      return !isNaN(d) && d >= weekAgo;
    });
    const uncategorized = recentLedger.filter(r => r.Category === 'UNCATEGORIZED').length;
    const catAccuracy   = recentLedger.length > 0
      ? (((recentLedger.length - uncategorized) / recentLedger.length) * 100).toFixed(1)
      : 'N/A';

    // ── Forecast accuracy ───────────────────────────────────
    let forecastAccuracy = 'N/A';
    if (forecasts.length >= 2) {
      const prev      = forecasts[forecasts.length - 2];
      const actual    = recentLedger.reduce((s, r) => s + (parseFloat(r.Amount) || 0), 0);
      const predicted = parseFloat(prev.ModelA_30Day) / 4;
      if (predicted > 0 && !isNaN(actual)) {
        const error = Math.abs(actual - predicted) / predicted * 100;
        forecastAccuracy = Math.max(0, Math.min(100, 100 - error)).toFixed(1);
      }
    }

    // ── Volume & scores ─────────────────────────────────────
    const weeklyVolume  = recentLedger.reduce((s, r) => s + (parseFloat(r.Amount) || 0), 0);
    const avgFraudScore = recentLedger.length > 0
      ? (recentLedger.reduce((s, r) => s + (parseFloat(r.HXFRS) || 0), 0) / recentLedger.length).toFixed(1)
      : 'N/A';

    // ── Health signal ───────────────────────────────────────
    let healthSignal = 'HEALTHY';
    if (fpRate !== 'N/A'         && parseFloat(fpRate) > 40)           healthSignal = 'REVIEW_THRESHOLDS';
    if (catAccuracy !== 'N/A'    && parseFloat(catAccuracy) < 70)      healthSignal = 'REVIEW_CATEGORIES';
    if (forecastAccuracy !== 'N/A' && parseFloat(forecastAccuracy) < 60) healthSignal = 'REVIEW_FORECAST_MODEL';

    const report = {
      GeneratedAt:       now.toISOString(),
      PeriodStart:       weekAgo.toISOString().split('T')[0],
      PeriodEnd:         now.toISOString().split('T')[0],
      TxCount:           recentLedger.length,
      WeeklyVolume:      weeklyVolume.toFixed(2),
      AvgFraudScore:     avgFraudScore,
      TotalHeld:         totalHeld,
      FalsePositives:    falsePositives,
      TruePositives:     truePositives,
      FalsePositiveRate: fpRate,
      FraudPrecision:    precision,
      CatAccuracy:       catAccuracy,
      UncategorizedTx:   uncategorized,
      LearnedVendors:    vendorMap.length,
      ForecastAccuracy:  forecastAccuracy,
      HealthSignal:      healthSignal,
    };

    await appendToPerformanceReport({ ...report, companyId }, companyId);
    await appendToAuditLog({
      companyId,
      timestamp: now.toISOString(),
      action:    'WEEKLY_PERFORMANCE_REPORT',
      details:   `Health: ${healthSignal} | Fraud precision: ${precision}% | Cat accuracy: ${catAccuracy}% | Forecast accuracy: ${forecastAccuracy}% | Learned vendors: ${vendorMap.length}`,
      layer:     'SELF_REPORTING',
      status:    healthSignal,
    }).catch(() => {});

    console.log(`📋 ARIA: Report complete — Health: ${healthSignal} | Precision: ${precision}% | Cat: ${catAccuracy}%`);
    return report;

  } catch (err) {
    console.error('Performance report error:', err.message);
  }
};

module.exports = { generatePerformanceReport };
