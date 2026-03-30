const { getVendorMap, upsertVendorMap } = require('../db/supabase');

const lookupVendor = async (vendorNormalized) => {
  if (!vendorNormalized) return null;
  try {
    const map = await getVendorMap();
    const match = map.find(r => r.Vendor === vendorNormalized);
    if (match && parseFloat(match.Confidence) >= 70) {
      return {
        category:   match.Category,
        confidence: parseFloat(match.Confidence),
        fromMemory: true,
      };
    }
  } catch (_) {}
  return null;
};

const reinforceCategory = async (vendorNormalized, category, wasCorrection = false) => {
  if (!vendorNormalized || !category || category === 'UNCATEGORIZED') return;
  try {
    const map = await getVendorMap();
    const existing = map.find(r => r.Vendor === vendorNormalized);
    if (existing) {
      const times   = parseInt(existing.TimesConfirmed || '1', 10) + 1;
      const newConf = Math.min(99, parseFloat(existing.Confidence || '70') + (wasCorrection ? 10 : 2));
      // Only update if category matches or it's a correction
      if (wasCorrection || existing.Category === category) {
        await upsertVendorMap(vendorNormalized, category, newConf, times, existing._rowIndex);
      }
    } else {
      const initConf = wasCorrection ? 85 : 70;
      await upsertVendorMap(vendorNormalized, category, initConf, 1, null);
    }
  } catch (err) {
    console.error('Category learning error:', err.message);
  }
};

const correctCategory = async (vendorNormalized, newCategory) => {
  if (!vendorNormalized || !newCategory) return;
  await reinforceCategory(vendorNormalized, newCategory, true);
};

module.exports = { lookupVendor, reinforceCategory, correctCategory };
