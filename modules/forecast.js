const DAY_MS = 24 * 60 * 60 * 1000;
const FORECAST_WINDOW_DAYS = 30;
const MONTE_CARLO_RUNS = 500;
const INFLOW_HINTS = [
  'REVENUE',
  'INCOME',
  'SALES',
  'SALE',
  'SUBSCRIPTION REVENUE',
  'ARR',
  'MRR',
  'CUSTOMER PAYMENT',
  'PAYMENT RECEIVED',
  'INVOICE PAID',
  'CLIENT PAYMENT',
  'RECEIVABLE',
  'PAYOUT',
  'SETTLEMENT',
  'DEPOSIT',
  'BANK TRANSFER IN',
];

function startOfDay(value) {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  return date;
}

function toMoney(value) {
  return Number(value || 0).toFixed(2);
}

function classifyCashDirection(row) {
  const amount = parseFloat(row.Amount ?? row.amount ?? 0);
  if (!Number.isFinite(amount) || amount === 0) return 'ignore';
  if (amount < 0) return 'inflow';

  const category = String(row.Category || row.category || '').toUpperCase();
  const description = String(row.Description || row.description || '').toUpperCase();
  const vendor = String(row.Vendor || row.vendor || '').toUpperCase();
  const entity = String(row.Entity || row.entity || '').toUpperCase();
  const combined = `${category} ${description} ${vendor} ${entity}`;

  if (INFLOW_HINTS.some((hint) => combined.includes(hint))) return 'inflow';
  return 'outflow';
}

function toLedgerCashRows(rows = []) {
  return rows
    .map((row) => {
      const rawDate = row.Date || row.date || row.timestamp || row.created_at;
      const date = startOfDay(rawDate);
      const amount = parseFloat(row.Amount ?? row.amount ?? 0);
      const status = String(row.Status || row.status || 'POSTED').toUpperCase();
      const direction = classifyCashDirection(row);
      return { date, amount: Math.abs(amount), status, direction };
    })
    .filter((row) => row.date && Number.isFinite(row.amount) && row.amount > 0 && row.status === 'POSTED' && row.direction !== 'ignore');
}

function toLedgerSpendRows(rows = []) {
  return toLedgerCashRows(rows).filter((row) => row.direction === 'outflow');
}

function buildDailySpendSeries(spendRows, anchorDate = new Date(), windowDays = FORECAST_WINDOW_DAYS) {
  if (!Array.isArray(spendRows) || spendRows.length === 0) return null;

  const orderedRows = [...spendRows].sort((a, b) => a.date - b.date);
  const latestSpendDate = orderedRows[orderedRows.length - 1].date;
  const today = startOfDay(anchorDate);
  const trailingCutoff = new Date(today.getTime() - ((windowDays - 1) * DAY_MS));
  const anchor = latestSpendDate < trailingCutoff ? latestSpendDate : today;
  const periodStart = new Date(anchor.getTime() - ((windowDays * 2) - 1) * DAY_MS);

  const totalsByDay = new Map();
  for (const row of orderedRows) {
    if (row.date < periodStart || row.date > anchor) continue;
    const key = row.date.toISOString().slice(0, 10);
    totalsByDay.set(key, (totalsByDay.get(key) || 0) + row.amount);
  }

  const daily = [];
  for (let index = 0; index < windowDays * 2; index += 1) {
    const date = new Date(periodStart.getTime() + (index * DAY_MS));
    const key = date.toISOString().slice(0, 10);
    daily.push({
      date,
      amount: totalsByDay.get(key) || 0,
    });
  }

  return {
    daily,
    anchor,
    stale: latestSpendDate < trailingCutoff,
    latestSpendDate,
  };
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function mean(values) {
  if (!values.length) return 0;
  return sum(values) / values.length;
}

function stdDev(values, baseline = mean(values)) {
  if (!values.length) return 0;
  const variance = values.reduce((total, value) => total + ((value - baseline) ** 2), 0) / values.length;
  return Math.sqrt(variance);
}

function linearRegression(values) {
  const n = values.length;
  if (!n) return { slope: 0, intercept: 0 };
  const xMean = (n - 1) / 2;
  const yMean = mean(values);

  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i += 1) {
    numerator += (i - xMean) * (values[i] - yMean);
    denominator += (i - xMean) ** 2;
  }

  const slope = denominator ? numerator / denominator : 0;
  const intercept = yMean - (slope * xMean);
  return { slope, intercept };
}

function projectLinear(values, days) {
  const { slope, intercept } = linearRegression(values);
  const start = values.length;
  let total = 0;
  for (let i = 0; i < days; i += 1) {
    total += Math.max(0, intercept + (slope * (start + i)));
  }
  return total;
}

function monteCarloProjection(samplePool, days, runs = MONTE_CARLO_RUNS) {
  const sanitizedPool = samplePool.filter((value) => Number.isFinite(value) && value >= 0);
  const pool = sanitizedPool.length ? sanitizedPool : [0];
  const totals = [];

  for (let run = 0; run < runs; run += 1) {
    let projection = 0;
    for (let day = 0; day < days; day += 1) {
      const pick = pool[Math.floor(Math.random() * pool.length)];
      projection += pick;
    }
    totals.push(projection);
  }

  totals.sort((a, b) => a - b);
  const percentile = (ratio) => totals[Math.min(totals.length - 1, Math.floor(ratio * totals.length))];

  return {
    p10: percentile(0.1),
    p50: percentile(0.5),
    p90: percentile(0.9),
  };
}

function buildForecastFromLedger(rows, options = {}) {
  const minimumReserve = Number(process.env.MINIMUM_CASH_RESERVE || 50000);
  const openingCashBalance = Number(options.openingCashBalance || 0);
  const cashRows = toLedgerCashRows(rows);
  const spendRows = cashRows.filter((row) => row.direction === 'outflow');
  if (!spendRows.length) return null;

  const series = buildDailySpendSeries(spendRows, options.anchorDate, FORECAST_WINDOW_DAYS);
  if (!series) return null;

  const inflowSeries = buildDailySpendSeries(cashRows.filter((row) => row.direction === 'inflow'), options.anchorDate, FORECAST_WINDOW_DAYS);

  const recent = series.daily.slice(-FORECAST_WINDOW_DAYS);
  const previous = series.daily.slice(0, FORECAST_WINDOW_DAYS);
  const recentValues = recent.map((row) => row.amount);
  const previousValues = previous.map((row) => row.amount);
  const monthlyBurn = sum(recentValues);
  const previousBurn = sum(previousValues);
  const averageDaily = mean(recentValues);
  const volatility = stdDev(recentValues, averageDaily);

  if (monthlyBurn <= 0 && previousBurn <= 0) return null;

  const baseBurn = monthlyBurn > 0 ? monthlyBurn : previousBurn;
  const regressionInput = monthlyBurn > 0 ? recentValues : previousValues;

  const modelA30 = projectLinear(regressionInput, 30);
  const modelA60 = projectLinear(regressionInput, 60);
  const modelA90 = projectLinear(regressionInput, 90);

  const historicalPool = series.daily.map((row) => row.amount).filter((value) => value > 0);
  const monteCarlo = monteCarloProjection(historicalPool.length ? historicalPool : [averageDaily], 90);

  const stressMultiplier = 1.2 + Math.min(0.45, averageDaily ? (volatility / averageDaily) : 0);
  const bullMultiplier = Math.max(0.65, 1 - Math.min(0.25, averageDaily ? (volatility / Math.max(averageDaily * 3, 1)) : 0.15));
  const modelC = {
    bull: baseBurn * 3 * bullMultiplier,
    base: baseBurn * 3,
    stress: baseBurn * 3 * stressMultiplier,
  };

  const inflowRecent = inflowSeries ? inflowSeries.daily.slice(-FORECAST_WINDOW_DAYS) : [];
  const inflowPrevious = inflowSeries ? inflowSeries.daily.slice(0, FORECAST_WINDOW_DAYS) : [];
  const inflowRecentValues = inflowRecent.map((row) => row.amount);
  const inflowPreviousValues = inflowPrevious.map((row) => row.amount);
  const monthlyInflow = sum(inflowRecentValues);
  const previousInflow = sum(inflowPreviousValues);
  const inflowBaseline = monthlyInflow > 0 ? monthlyInflow : previousInflow;
  const inflowProjection30 = inflowBaseline > 0
    ? projectLinear((monthlyInflow > 0 ? inflowRecentValues : inflowPreviousValues), 30)
    : 0;
  const inflowProjection90 = inflowBaseline > 0 ? inflowProjection30 * 3 : 0;
  const netBurn30 = baseBurn - inflowProjection30;
  const netBurn90Base = modelC.base - inflowProjection90;
  const netBurn90Stress = modelC.stress - inflowProjection90;
  const coverageRatio = baseBurn > 0 ? inflowProjection30 / baseBurn : 0;
  const cashPressure = coverageRatio >= 1
    ? 'LOW'
    : coverageRatio >= 0.75
      ? 'MODERATE'
      : coverageRatio >= 0.5
        ? 'ELEVATED'
        : 'HIGH';
  const runwayReady = openingCashBalance > 0 && netBurn30 > 0;
  const runwayMonths = runwayReady ? openingCashBalance / Math.max(netBurn30, 1) : null;
  const runwayDays = runwayReady ? runwayMonths * 30 : null;

  const cashGapRisk = netBurn90Stress > minimumReserve;
  const trendDelta = monthlyBurn - previousBurn;
  const trendDirection = trendDelta > 0 ? 'GROWING' : trendDelta < 0 ? 'DECLINING' : 'STABLE';

  return {
    GeneratedAt: new Date().toISOString(),
    MonthlyBurn: toMoney(baseBurn),
    ModelA_30Day: toMoney(modelA30 || baseBurn),
    ModelA_60Day: toMoney(modelA60 || (baseBurn * 2)),
    ModelA_90Day: toMoney(modelA90 || (baseBurn * 3)),
    ModelB_P10_90Day: toMoney(monteCarlo.p10),
    ModelB_P50_90Day: toMoney(monteCarlo.p50),
    ModelB_P90_90Day: toMoney(monteCarlo.p90),
    ModelC_Bull: toMoney(modelC.bull),
    ModelC_Base: toMoney(modelC.base),
    ModelC_Stress: toMoney(modelC.stress),
    CashGapRisk: String(cashGapRisk),
    CashGapAlert: cashGapRisk
      ? `Projected 90-day stress net burn ($${netBurn90Stress.toFixed(0)}) exceeds minimum reserve of $${minimumReserve.toLocaleString()}`
      : '',
    TransactionsAnalyzed: cashRows.length,
    Metadata: {
      stale: series.stale,
      latestSpendDate: series.latestSpendDate.toISOString(),
      anchorDate: series.anchor.toISOString(),
      averageDaily: toMoney(averageDaily),
      previousMonthlyBurn: toMoney(previousBurn),
      volatility: toMoney(volatility),
      trendDirection,
      inflowDetected: monthlyInflow > 0 || previousInflow > 0,
      monthlyInflow: toMoney(monthlyInflow),
      previousMonthlyInflow: toMoney(previousInflow),
      inflowProjection30: toMoney(inflowProjection30),
      inflowProjection90: toMoney(inflowProjection90),
      netBurn30: toMoney(netBurn30),
      netBurn90Base: toMoney(netBurn90Base),
      netBurn90Stress: toMoney(netBurn90Stress),
      coverageRatio: coverageRatio.toFixed(2),
      cashPressure,
      openingCashBalance: toMoney(openingCashBalance),
      runwayReady,
      runwayMonths: runwayMonths != null ? runwayMonths.toFixed(1) : null,
      runwayDays: runwayDays != null ? runwayDays.toFixed(0) : null,
      runwayNote: openingCashBalance > 0
        ? (runwayReady
          ? `ARIA estimated runway from the configured opening cash balance of $${openingCashBalance.toLocaleString()}.`
          : 'ARIA sees opening cash, but net burn is not positive enough to estimate a useful runway right now.')
        : 'Runway needs a trustworthy opening cash balance before ARIA should estimate months remaining.',
    },
  };
}

async function runForecast(companyId, options = {}) {
  const { getLedger, appendToForecast, appendToAuditLog } = require('../db/supabase');
  console.log('Forecast: running cash flow forecast');

  const rows = await getLedger(companyId);
  const forecast = buildForecastFromLedger(rows, options);

  if (!forecast) {
    console.log('Forecast: no usable posted ledger history, skipping forecast.');
    return null;
  }

  await appendToForecast({ ...forecast, companyId }, companyId);
  await appendToAuditLog({
    companyId,
    timestamp: new Date().toISOString(),
    action: 'FORECAST_GENERATED',
    details: `Monthly burn: $${forecast.MonthlyBurn} | Trend: ${forecast.Metadata?.trendDirection || 'UNKNOWN'} | Transactions: ${forecast.TransactionsAnalyzed}`,
    layer: 'MODULE_3_FORECASTING',
    status: 'COMPLETE',
  }).catch(() => {});

  console.log(`Forecast: complete. Monthly burn $${forecast.MonthlyBurn}`);
  return forecast;
}

module.exports = {
  runForecast,
  buildForecastFromLedger,
  buildDailySpendSeries,
  toLedgerSpendRows,
  toLedgerCashRows,
  classifyCashDirection,
};
