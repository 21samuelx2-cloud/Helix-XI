// Legacy reference file.
// Active normalization logic lives in ../modules/normalize.js.

const normalize = (row) => {
  // Generate HXID
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 100000).toString().padStart(8, '0');
  const HXID = `HX-${timestamp}-${random}`;

  // Step 2: Entity
  const entity = (row.Entity || 'UNKNOWN').trim().toUpperCase();

  // Step 3: Currency
  const currency = (row.Currency || 'USD').trim().toUpperCase();
  const amount = parseFloat(row.Amount);

  // Step 4: Vendor
  const vendor = (row.Vendor || 'UNKNOWN').trim();
  const vendorNormalized = vendor.toUpperCase().replace(/[^A-Z0-9 ]/g, '').trim();

  // Step 5: COA mapping
  const description = (row.Description || '').toLowerCase();
  let category = row.Category || '';
  let categoryConfidence = 100;

  if (!row.Category || row.Category.trim() === '') {
    categoryConfidence = 55;
    const catMap = [
      { keywords: ['software', 'subscription', 'saas', 'license', 'api'], cat: 'Software & Subscriptions', conf: 82 },
      { keywords: ['travel', 'flight', 'hotel', 'airbnb', 'uber', 'taxi'], cat: 'Travel & Entertainment', conf: 82 },
      { keywords: ['payroll', 'salary', 'wages', 'compensation', 'bonus'], cat: 'Payroll', conf: 88 },
      { keywords: ['rent', 'office', 'facility', 'utilities', 'electricity'], cat: 'Rent & Facilities', conf: 83 },
      { keywords: ['marketing', 'ads', 'advertising', 'facebook', 'google ads'], cat: 'Marketing', conf: 84 },
      { keywords: ['equipment', 'hardware', 'laptop', 'server', 'monitor'], cat: 'Equipment', conf: 80 },
      { keywords: ['consulting', 'professional', 'legal', 'accountant', 'audit'], cat: 'Professional Services', conf: 78 },
      { keywords: ['insurance', 'policy', 'premium', 'coverage'], cat: 'Insurance', conf: 85 },
      { keywords: ['shipping', 'freight', 'logistics', 'courier', 'delivery'], cat: 'Shipping & Logistics', conf: 80 },
      { keywords: ['food', 'catering', 'meals', 'restaurant', 'lunch', 'coffee'], cat: 'Meals & Entertainment', conf: 79 }
    ];
    for (const m of catMap) {
      if (m.keywords.some(k => description.includes(k) || vendorNormalized.toLowerCase().includes(k))) {
        category = m.cat;
        categoryConfidence = m.conf;
        break;
      }
    }
    if (!category) category = 'UNCATEGORIZED';
  }

  // Step 6: Intercompany
  const icKeywords = ['interco', 'intercompany', 'related party', 'group transfer', 'intragroup'];
  const isIntercompany = icKeywords.some(k => description.includes(k) || vendor.toLowerCase().includes(k));

  // Step 7: Tax metadata
  const nonDeductible = ['fine', 'penalty', 'personal', 'parking ticket'];
  const isDeductible = !nonDeductible.some(k => description.includes(k));
  const vatApplicable = ['GBP', 'EUR'].includes(currency);

  // Step 8: Duplicate key
  const duplicateCheckKey = `${vendorNormalized}_${amount}_${row.Date}`;

  // Timing flags
  const txDate = new Date(row.Date);
  const dayOfWeek = txDate.getDay();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  const txHour = new Date().getHours();
  const isOffHours = txHour < 5 || txHour >= 22;

  return {
    HXID,
    timestamp: new Date().toISOString(),
    rawDate: row.Date,
    date: txDate.toISOString().split('T')[0],
    vendor, vendorNormalized, amount, currency,
    amountBase: currency === 'USD' ? amount : null,
    fxRate: currency === 'USD' ? 1 : null,
    entity, category, categoryConfidence,
    needsAIReview: categoryConfidence < 85,
    isIntercompany, isDeductible, vatApplicable,
    duplicateCheckKey, isWeekend, isOffHours,
    description: row.Description,
    status: 'PENDING_FRAUD_SCORE',
    processingLayer: 2
  };
};

module.exports = { normalize };
