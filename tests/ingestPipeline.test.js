const test = require('node:test');
const assert = require('node:assert/strict');

function buildMocks({ requiresHold = false } = {}) {
  const calls = {
    appendToLedger: [],
    appendToHoldQueue: [],
    appendToRejectionLog: [],
    appendToAuditLog: [],
    markTransactionProcessed: [],
    getLedger: [],
    getHoldQueue: [],
  };

  const supabaseMock = {
    getLedger: async () => {
      calls.getLedger.push(true);
      return [];
    },
    getHoldQueue: async () => {
      calls.getHoldQueue.push(true);
      return [];
    },
    appendToLedger: async (tx) => calls.appendToLedger.push(tx),
    appendToHoldQueue: async (tx) => calls.appendToHoldQueue.push(tx),
    appendToRejectionLog: async (row) => calls.appendToRejectionLog.push(row),
    appendToAuditLog: async (row) => calls.appendToAuditLog.push(row),
    markTransactionProcessed: async (id, companyId) => calls.markTransactionProcessed.push({ id, companyId }),
  };

  const normalizeMock = async (row) => ({
    HXID: 'HX-TEST-1',
    timestamp: new Date().toISOString(),
    rawDate: row.Date,
    date: row.Date,
    vendor: row.Vendor,
    vendorNormalized: String(row.Vendor || '').toUpperCase(),
    amount: Number(row.Amount),
    currency: row.Currency,
    amountBase: Number(row.Amount),
    fxRate: 1,
    entity: row.Entity,
    category: row.Category || 'UNCATEGORIZED',
    categoryConfidence: 90,
    needsAIReview: false,
    isIntercompany: false,
    isDeductible: true,
    vatApplicable: false,
    duplicateCheckKey: 'dup',
    isWeekend: false,
    isOffHours: false,
    description: row.Description,
    status: 'PENDING_FRAUD_SCORE',
    processingLayer: 2,
  });

  const fraudMock = async (tx) => ({
    ...tx,
    HXFRS: requiresHold ? 85 : 25,
    actionTier: requiresHold ? 'RED' : 'GREEN',
    action: requiresHold ? 'HOLD_ESCALATE' : 'AUTO_POST',
    requiresHold,
    fraudSignals: [],
    anomalyBrief: 'test',
  });

  return { calls, supabaseMock, normalizeMock, fraudMock };
}

function wireMocks(mocks) {
  const supabasePath = require.resolve('../db/supabase');
  const normalizePath = require.resolve('../modules/normalize');
  const fraudPath = require.resolve('../modules/fraud');

  require.cache[supabasePath] = { exports: mocks.supabaseMock };
  require.cache[normalizePath] = { exports: { normalize: mocks.normalizeMock } };
  require.cache[fraudPath] = { exports: { scoreFraud: mocks.fraudMock } };
}

function clearModules() {
  delete require.cache[require.resolve('../modules/ingest')];
  delete require.cache[require.resolve('../db/supabase')];
  delete require.cache[require.resolve('../modules/normalize')];
  delete require.cache[require.resolve('../modules/fraud')];
}

test('ingestTransaction posts to ledger when score does not require hold', async () => {
  const mocks = buildMocks({ requiresHold: false });
  wireMocks(mocks);
  const { ingestTransaction } = require('../modules/ingest');

  const result = await ingestTransaction({
    Date: '2026-03-30',
    Vendor: 'Test Vendor',
    Amount: '120',
    Currency: 'USD',
    Entity: 'HELIX XI',
    Description: 'Test',
    Category: 'Software',
  }, 'cmp_1');

  assert.equal(result.success, true);
  assert.equal(mocks.calls.appendToLedger.length, 1);
  assert.equal(mocks.calls.appendToHoldQueue.length, 0);
  assert.equal(mocks.calls.appendToAuditLog.length, 1);

  clearModules();
});

test('ingestTransaction routes to hold queue when score requires hold', async () => {
  const mocks = buildMocks({ requiresHold: true });
  wireMocks(mocks);
  const { ingestTransaction } = require('../modules/ingest');

  const result = await ingestTransaction({
    Date: '2026-03-30',
    Vendor: 'Risk Vendor',
    Amount: '9000',
    Currency: 'USD',
    Entity: 'HELIX XI',
    Description: 'Risky',
  }, 'cmp_1');

  assert.equal(result.success, true);
  assert.equal(mocks.calls.appendToHoldQueue.length, 1);
  assert.equal(mocks.calls.appendToLedger.length, 0);
  assert.equal(mocks.calls.appendToAuditLog.length, 1);

  clearModules();
});

test('ingestTransaction rejects missing required fields', async () => {
  const mocks = buildMocks({ requiresHold: false });
  wireMocks(mocks);
  const { ingestTransaction } = require('../modules/ingest');

  const result = await ingestTransaction({
    Date: '2026-03-30',
    Vendor: '',
    Amount: '',
    Currency: 'USD',
  }, 'cmp_1');

  assert.equal(result.success, false);
  assert.equal(mocks.calls.appendToRejectionLog.length, 1);
  assert.equal(mocks.calls.appendToLedger.length, 0);
  assert.equal(mocks.calls.appendToHoldQueue.length, 0);

  clearModules();
});

test('ingestTransaction marks source row processed when row index is present', async () => {
  const mocks = buildMocks({ requiresHold: false });
  wireMocks(mocks);
  const { ingestTransaction } = require('../modules/ingest');

  const result = await ingestTransaction({
    Date: '2026-03-30',
    Vendor: 'Test Vendor',
    Amount: '120',
    Currency: 'USD',
    Entity: 'HELIX XI',
    Description: 'Test',
    _rowIndex: 'row-123',
  }, 'cmp_1');

  assert.equal(result.success, true);
  assert.equal(mocks.calls.markTransactionProcessed.length, 1);
  assert.deepEqual(mocks.calls.markTransactionProcessed[0], { id: 'row-123', companyId: 'cmp_1' });

  clearModules();
});
