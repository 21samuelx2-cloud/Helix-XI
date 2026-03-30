const { getFXRates } = require('../db/supabase');
const { lookupVendor, reinforceCategory } = require('./categoryLearning');

const normalize = async (row) => {
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 100000).toString().padStart(8, '0');
  const HXID = `ARIA-${timestamp}-${random}`;

  const entity = (row.Entity || 'UNKNOWN').trim().toUpperCase();
  const currency = (row.Currency || 'USD').trim().toUpperCase();
  const amount = parseFloat(row.Amount);
  const vendor = (row.Vendor || 'UNKNOWN').trim();
  const vendorNormalized = vendor.toUpperCase().replace(/[^A-Z0-9 ]/g, '').trim();
  const description = (row.Description || '').toLowerCase();

  // FX conversion
  let fxRate = 1;
  let amountBase = amount;
  if (currency !== 'USD') {
    try {
      const rates = await getFXRates();
      // Supabase stores one row per currency
      const rateRow = rates.find(r => r.target_currency === currency || r.TargetCurrency === currency);
      if (rateRow) {
        fxRate = 1 / parseFloat(rateRow.rate || rateRow.Rate || 1);
        amountBase = parseFloat((amount * fxRate).toFixed(2));
      }
    } catch (_) {}
  }

  // Category — check learned vendor map first, then keyword map
  let category = row.Category || '';
  let categoryConfidence = 100;
  let fromMemory = false;

  if (!row.Category || row.Category.trim() === '') {
    const learned = await lookupVendor(vendorNormalized);
    if (learned) {
      category = learned.category;
      categoryConfidence = learned.confidence;
      fromMemory = true;
    } else {
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
        { keywords: ['food', 'catering', 'meals', 'restaurant', 'lunch', 'coffee'], cat: 'Meals & Entertainment', conf: 79 },
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
  }

  // Reinforce memory for any successfully categorized vendor
  if (category && category !== 'UNCATEGORIZED') {
    reinforceCategory(vendorNormalized, category).catch(() => {});
  }

  const icKeywords = ['interco', 'intercompany', 'related party', 'group transfer', 'intragroup'];
  const isIntercompany = icKeywords.some(k => description.includes(k) || vendor.toLowerCase().includes(k));

  const nonDeductible = ['fine', 'penalty', 'personal', 'parking ticket'];
  const isDeductible = !nonDeductible.some(k => description.includes(k));
  const vatApplicable = ['GBP', 'EUR'].includes(currency);

  const duplicateCheckKey = `${vendorNormalized}_${amount}_${row.Date}`;

  const txDate = new Date(row.Date);
  const isWeekend = txDate.getDay() === 0 || txDate.getDay() === 6;
  const txHour = new Date().getHours();
  const isOffHours = txHour < 5 || txHour >= 22;

  return {
    HXID, timestamp: new Date().toISOString(),
    rawDate: row.Date, date: txDate.toISOString().split('T')[0],
    vendor, vendorNormalized, amount, currency, amountBase, fxRate,
    entity, category, categoryConfidence, fromMemory,
    needsAIReview: categoryConfidence < 85,
    isIntercompany, isDeductible, vatApplicable,
    duplicateCheckKey, isWeekend, isOffHours,
    description: row.Description,
    status: 'PENDING_FRAUD_SCORE',
    processingLayer: 2,
  };
};

module.exports = { normalize };
