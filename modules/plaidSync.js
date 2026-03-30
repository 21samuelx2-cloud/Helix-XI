// modules/plaidSync.js
// Owns: Plaid transaction sync pipeline
// Connects: Plaid API → ARIA transaction engine
// Status: stub — ready for live Plaid calls once network access is confirmed

const { plaidClient } = require('./plaidClient');

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

module.exports = { syncPlaidTransactions };
