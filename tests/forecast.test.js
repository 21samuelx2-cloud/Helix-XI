const test = require('node:test');
const assert = require('node:assert/strict');

const { buildForecastFromLedger, toLedgerSpendRows, classifyCashDirection } = require('../modules/forecast');

test('classifyCashDirection detects likely inflows from finance language', () => {
  assert.equal(classifyCashDirection({
    Category: 'Revenue',
    Description: 'Customer payment received for annual subscription',
    Amount: '4200',
    Status: 'POSTED',
  }), 'inflow');

  assert.equal(classifyCashDirection({
    Category: 'Software & Subscriptions',
    Description: 'Monthly Vanta invoice',
    Amount: '900',
    Status: 'POSTED',
  }), 'outflow');
});

test('toLedgerSpendRows keeps only positive posted ledger transactions', () => {
  const rows = toLedgerSpendRows([
    { Date: '2026-03-01', Amount: '1200', Status: 'POSTED' },
    { Date: '2026-03-02', Amount: '0', Status: 'POSTED' },
    { Date: '2026-03-03', Amount: '900', Status: 'REJECTED' },
    { Date: 'bad-date', Amount: '300', Status: 'POSTED' },
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].amount, 1200);
});

test('buildForecastFromLedger produces a forecast from sparse older history', () => {
  const forecast = buildForecastFromLedger([
    { Date: '2025-11-01', Amount: '1200', Status: 'POSTED' },
    { Date: '2025-11-05', Amount: '1800', Status: 'POSTED' },
    { Date: '2025-11-17', Amount: '1600', Status: 'POSTED' },
    { Date: '2025-11-28', Amount: '2100', Status: 'POSTED' },
  ], {
    anchorDate: new Date('2026-03-21T12:00:00Z'),
  });

  assert.ok(forecast);
  assert.equal(forecast.Metadata.stale, true);
  assert.equal(typeof forecast.Metadata.trendDirection, 'string');
  assert.equal(Number(forecast.MonthlyBurn) > 0, true);
  assert.equal(Number(forecast.ModelC_Stress) >= Number(forecast.ModelC_Base), true);
});

test('buildForecastFromLedger includes net cash metadata when inflows are present', () => {
  const forecast = buildForecastFromLedger([
    { Date: '2026-02-03', Amount: '3000', Status: 'POSTED', Category: 'Revenue', Description: 'Customer payment' },
    { Date: '2026-02-10', Amount: '2800', Status: 'POSTED', Category: 'Revenue', Description: 'Invoice paid' },
    { Date: '2026-02-12', Amount: '1800', Status: 'POSTED', Category: 'Payroll', Description: 'Team payroll' },
    { Date: '2026-02-22', Amount: '900', Status: 'POSTED', Category: 'Software & Subscriptions', Description: 'Platform bill' },
    { Date: '2026-03-03', Amount: '3200', Status: 'POSTED', Category: 'Revenue', Description: 'Subscription revenue' },
    { Date: '2026-03-09', Amount: '1500', Status: 'POSTED', Category: 'Marketing', Description: 'Campaign spend' },
    { Date: '2026-03-14', Amount: '1100', Status: 'POSTED', Category: 'Payroll', Description: 'Contractor payout' },
  ], {
    anchorDate: new Date('2026-03-21T12:00:00Z'),
  });

  assert.ok(forecast);
  assert.equal(forecast.Metadata.inflowDetected, true);
  assert.equal(Number(forecast.Metadata.inflowProjection30) > 0, true);
  assert.equal(typeof forecast.Metadata.cashPressure, 'string');
  assert.equal(typeof forecast.Metadata.coverageRatio, 'string');
});

test('buildForecastFromLedger estimates runway when opening cash balance is provided', () => {
  const forecast = buildForecastFromLedger([
    { Date: '2026-02-03', Amount: '3200', Status: 'POSTED', Category: 'Payroll', Description: 'Payroll run' },
    { Date: '2026-02-14', Amount: '1500', Status: 'POSTED', Category: 'Marketing', Description: 'Ad spend' },
    { Date: '2026-03-02', Amount: '3100', Status: 'POSTED', Category: 'Payroll', Description: 'Payroll run' },
    { Date: '2026-03-16', Amount: '1700', Status: 'POSTED', Category: 'Software & Subscriptions', Description: 'Annual tools' },
  ], {
    anchorDate: new Date('2026-03-21T12:00:00Z'),
    openingCashBalance: 120000,
  });

  assert.ok(forecast);
  assert.equal(forecast.Metadata.runwayReady, true);
  assert.equal(Number(forecast.Metadata.runwayMonths) > 0, true);
  assert.equal(Number(forecast.Metadata.runwayDays) > 0, true);
});

test('buildForecastFromLedger returns null when there is no usable spend history', () => {
  const forecast = buildForecastFromLedger([
    { Date: '2026-03-01', Amount: '500', Status: 'REJECTED' },
    { Date: '2026-03-02', Amount: '0', Status: 'POSTED' },
  ]);

  assert.equal(forecast, null);
});
