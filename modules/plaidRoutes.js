// modules/plaidRoutes.js
// Owns: Plaid API route handlers
// Endpoints: link token creation, token exchange, transaction sync

const { plaidClient } = require('./plaidClient');
const { CountryCode, Products } = require('plaid');
const { syncPlaidItem } = require('./plaidSync');
const { isVaultConfigured, encryptSecret, decryptSecret } = require('./secretVault');

async function registerPlaidRoutes(app, deps) {
  const {
    sb,
    csrfGuard,
    jwtAuth,
    requireCompanyContext,
    requirePermission,
  } = deps;

  // Step 1: Create a link token for a user
  // This is what opens the Plaid Link UI on the frontend
  app.post(
    '/api/plaid/create-link-token',
    csrfGuard,
    jwtAuth,
    requireCompanyContext,
    requirePermission('integrations.rotate'),
    async (req, res) => {
    try {
      const userId = req.user?.userId || req.body?.user_id;
      if (!userId) return res.status(400).json({ error: 'user_id is required' });

      const response = await plaidClient.linkTokenCreate({
        user: { client_user_id: String(userId) },
        client_name: 'ARIA Financial Intelligence',
        products: [Products.Transactions],
        country_codes: [CountryCode.Us, CountryCode.Ca],
        language: 'en',
      });

      return res.json({ link_token: response.data.link_token });

    } catch (error) {
      console.error('Plaid link token error:', error.response?.data || error.message);
      return res.status(500).json({ error: 'Failed to create link token' });
    }
  });

  // Step 2: Exchange a public token for a Plaid access token
  app.post(
    '/api/plaid/exchange-token',
    csrfGuard,
    jwtAuth,
    requireCompanyContext,
    requirePermission('integrations.rotate'),
    async (req, res) => {
      try {
        if (!isVaultConfigured()) {
          return res.status(503).json({ error: 'SECRET_VAULT_KEY is required before storing Plaid access tokens.' });
        }

        const { public_token, institution_id, institution_name } = req.body || {};
        if (!public_token) {
          return res.status(400).json({ error: 'public_token is required' });
        }

        const exchange = await plaidClient.itemPublicTokenExchange({ public_token });
        const accessToken = exchange.data?.access_token;
        const itemId = exchange.data?.item_id;

        if (!accessToken || !itemId) {
          return res.status(502).json({ error: 'Plaid did not return access_token and item_id.' });
        }

        const encrypted = encryptSecret(accessToken);
        const now = new Date().toISOString();
        const row = {
          company_id: req.user?.companyId || null,
          user_id: req.user?.userId || null,
          item_id: itemId,
          access_token_ciphertext: encrypted,
          institution_id: institution_id || null,
          institution_name: institution_name || null,
          status: 'active',
          created_at: now,
          updated_at: now,
        };

        const { error } = await sb
          .from('helixxi_plaid_items')
          .upsert(row, { onConflict: 'item_id' });
        if (error) throw error;

        return res.json({ success: true, item_id: itemId });
      } catch (error) {
        console.error('Plaid exchange token error:', error.response?.data || error.message);
        return res.status(500).json({ error: 'Failed to exchange public token' });
      }
    }
  );

  // Step 3: Trigger transaction sync for a company
  app.post(
    '/api/plaid/sync',
    csrfGuard,
    jwtAuth,
    requireCompanyContext,
    requirePermission('integrations.rotate'),
    async (req, res) => {
      try {
        if (!isVaultConfigured()) {
          return res.status(503).json({ error: 'SECRET_VAULT_KEY is required before syncing Plaid access tokens.' });
        }

        const companyId = req.user?.companyId || req.body?.company_id;
        if (!companyId) {
          return res.status(400).json({ error: 'company_id is required' });
        }

        // Fetch the encrypted access token from Supabase
        const { data, error } = await sb
          .from('helixxi_plaid_items')
          .select('*')
          .eq('company_id', companyId)
          .single();

        if (error || !data) {
          return res.status(404).json({ error: 'No Plaid connection found for this company' });
        }

        const result = await syncPlaidItem({
          sb,
          item: data,
          decryptSecret,
          force: Boolean(req.body?.force),
        });

        if (result.cooldown) {
          return res.status(429).json({ error: 'Sync cooldown active', retry_at: result.retryAt });
        }

        return res.json({ success: true, synced: result.synced });
      } catch (error) {
        console.error('Sync error:', error.response?.data || error.message);
        return res.status(500).json({ error: 'Sync failed' });
      }
    }
  );
}

module.exports = { registerPlaidRoutes };
