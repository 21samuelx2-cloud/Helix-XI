// modules/plaidSync.js
// Owns: Plaid transaction sync pipeline
// Connects: Plaid API → ARIA transaction engine
// Status: stub — ready for live Plaid calls once network access is confirmed

const { plaidClient } = require('./plaidClient');

const PLAID_SYNC_BASE_BACKOFF_MINUTES = Number(process.env.PLAID_SYNC_BASE_BACKOFF_MINUTES || 5);
const PLAID_SYNC_MAX_BACKOFF_MINUTES = Number(process.env.PLAID_SYNC_MAX_BACKOFF_MINUTES || 120);

const OPTIONAL_PLAID_COLUMNS = [
  'last_sync_at',
  'last_sync_status',
  'last_sync_error',
  'sync_failure_count',
  'sync_next_retry_at',
  'updated_at',
];

const getMissingSchemaColumn = (message = '') => {
  const match = message.match(/Could not find the '([^']+)' column/);
  return match ? match[1] : null;
};

async function updatePlaidItemWithOptionalColumns(sb, itemId, payload) {
  const row = { ...payload };
  const stripped = new Set();

  while (true) {
    const { error } = await sb
      .from('helixxi_plaid_items')
      .update(row)
      .eq('item_id', itemId);

    if (!error) return { ok: true, payload: row };

    const missingColumn = getMissingSchemaColumn(error.message);
    if (missingColumn && OPTIONAL_PLAID_COLUMNS.includes(missingColumn) && !stripped.has(missingColumn)) {
      stripped.add(missingColumn);
      delete row[missingColumn];
      continue;
    }

    throw error;
  }
}

function computeNextRetryAt(failureCount) {
  const count = Math.max(1, Number(failureCount || 1));
  const minutes = Math.min(
    PLAID_SYNC_MAX_BACKOFF_MINUTES,
    PLAID_SYNC_BASE_BACKOFF_MINUTES * Math.pow(2, count - 1),
  );
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

async function syncPlaidTransactions(companyId, accessToken, supabase) {
  try {
    // Step 1: Pull transactions from Plaid
    const now = new Date();
    const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);

    const startDate = thirtyDaysAgo.toISOString().split('T')[0];
    const endDate = now.toISOString().split('T')[0];

    const response = await plaidClient.transactionsGet({
      access_token: accessToken,
      start_date: startDate,
      end_date: endDate,
      options: { count: 100, offset: 0 },
    });

    const transactions = response.data.transactions;

    // Step 2: Normalize to ARIA transaction shape
    const normalized = transactions.map(t => ({
      company_id: companyId,
      external_id: t.transaction_id,
      amount: t.amount,
      currency: t.iso_currency_code || 'USD',
      description: t.name,
      category: t.category?.[0] || 'Uncategorized',
      date: t.date,
      source: 'plaid',
      raw: t,
    }));

    // Step 3: Upsert into Supabase
    const { error } = await supabase
      .from('helixxi_transactions')
      .upsert(normalized, { onConflict: 'external_id' });

    if (error) throw error;

    return { synced: normalized.length };

  } catch (error) {
    console.error('Plaid sync error:', error.message);
    throw error;
  }
}

async function syncPlaidItem({ sb, item, decryptSecret, force }) {
  if (!item) return { skipped: true, reason: 'missing_item' };
  if (!item.access_token_ciphertext) return { skipped: true, reason: 'missing_access_token' };

  const retryAt = item.sync_next_retry_at ? new Date(item.sync_next_retry_at).getTime() : null;
  if (!force && retryAt && retryAt > Date.now()) {
    return { cooldown: true, retryAt: item.sync_next_retry_at };
  }

  const accessToken = decryptSecret(item.access_token_ciphertext);
  try {
    const result = await syncPlaidTransactions(item.company_id, accessToken, sb);
    await updatePlaidItemWithOptionalColumns(sb, item.item_id, {
      last_sync_at: new Date().toISOString(),
      last_sync_status: 'SUCCESS',
      last_sync_error: null,
      sync_failure_count: 0,
      sync_next_retry_at: null,
      updated_at: new Date().toISOString(),
    });
    return { synced: result.synced };
  } catch (error) {
    const nextFailureCount = Number(item.sync_failure_count || 0) + 1;
    const nextRetryAt = computeNextRetryAt(nextFailureCount);
    await updatePlaidItemWithOptionalColumns(sb, item.item_id, {
      last_sync_at: new Date().toISOString(),
      last_sync_status: 'FAILED',
      last_sync_error: error.response?.data?.error_message || error.message,
      sync_failure_count: nextFailureCount,
      sync_next_retry_at: nextRetryAt,
      updated_at: new Date().toISOString(),
    }).catch(() => {});
    throw error;
  }
}

async function runPlaidAutoRetry({ sb, decryptSecret, maxItems = 5 }) {
  const { data, error } = await sb
    .from('helixxi_plaid_items')
    .select('*')
    .eq('status', 'active');
  if (error) throw error;

  const now = Date.now();
  const candidates = (data || []).filter((item) => {
    const failures = Number(item.sync_failure_count || 0);
    if (failures <= 0) return false;
    const retryAt = item.sync_next_retry_at ? new Date(item.sync_next_retry_at).getTime() : null;
    return !retryAt || retryAt <= now;
  }).slice(0, maxItems);

  for (const item of candidates) {
    try {
      await syncPlaidItem({ sb, item, decryptSecret, force: false });
    } catch (err) {
      console.error('Plaid auto-retry error:', err.response?.data || err.message);
    }
  }
}

module.exports = {
  syncPlaidTransactions,
  syncPlaidItem,
  runPlaidAutoRetry,
};
