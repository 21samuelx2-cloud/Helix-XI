const https = require('https');
const { appendToFXRates, appendToAuditLog } = require('../db/supabase');

const FX_URL = 'https://api.exchangerate-api.com/v4/latest/USD';
const TIMEOUT_MS = 10000;

const fetchFXRates = () => new Promise((resolve, reject) => {
  const req = https.get(FX_URL, (res) => {
    if (res.statusCode !== 200) {
      reject(new Error(`FX API returned status ${res.statusCode}`));
      return;
    }
    let data = '';
    res.on('data', chunk => { data += chunk; });
    res.on('end', () => {
      try { resolve(JSON.parse(data)); }
      catch (e) { reject(new Error('Failed to parse FX response')); }
    });
  });
  req.setTimeout(TIMEOUT_MS, () => {
    req.destroy();
    reject(new Error('FX API request timed out'));
  });
  req.on('error', reject);
});

const refreshFXRates = async () => {
  console.log('💱 ARIA: Refreshing FX rates...');
  const data = await fetchFXRates();
  const rates = data.rates || {};

  if (Object.keys(rates).length === 0) {
    throw new Error('FX API returned empty rates');
  }

  await appendToFXRates({
    timestamp: new Date().toISOString(),
    base: 'USD',
    rates: JSON.stringify(rates),
  });

  await appendToAuditLog({
    timestamp: new Date().toISOString(),
    action: 'FX_RATES_REFRESHED',
    details: `Base: USD | Currencies: ${Object.keys(rates).length}`,
    layer: 'MODULE_1_FX_ENGINE',
    status: 'COMPLETE',
  }).catch(() => {});

  console.log(`✅ ARIA: FX rates updated — ${Object.keys(rates).length} currencies`);
  return rates;
};

module.exports = { refreshFXRates };
