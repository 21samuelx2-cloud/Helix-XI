/**
 * ARIA Universal Webhook Handler
 * Normalizes payment events from Stripe, Paystack, Flutterwave, Square, etc.
 * into ARIA's standard transaction format.
 */

// ── Normalizers ───────────────────────────────────────────────────────────────

function normalizeStripe(payload) {
  const obj = payload.data?.object || {};
  const type = payload.type || '';

  // Handle charges, payment intents, and invoices
  let amount, currency, vendor, description, status;

  if (type.startsWith('charge')) {
    amount      = (obj.amount || 0) / 100;
    currency    = (obj.currency || 'USD').toUpperCase();
    vendor      = obj.billing_details?.name || obj.description || 'Stripe Customer';
    description = obj.description || `Stripe charge ${obj.id}`;
    status      = obj.status;
  } else if (type.startsWith('payment_intent')) {
    amount      = (obj.amount || 0) / 100;
    currency    = (obj.currency || 'USD').toUpperCase();
    vendor      = obj.description || 'Stripe Payment';
    description = obj.description || `Payment intent ${obj.id}`;
    status      = obj.status;
  } else if (type.startsWith('invoice')) {
    amount      = (obj.amount_paid || 0) / 100;
    currency    = (obj.currency || 'USD').toUpperCase();
    vendor      = obj.customer_name || obj.customer_email || 'Stripe Invoice';
    description = obj.description || `Invoice ${obj.number}`;
    status      = obj.status;
  } else {
    return null;
  }

  if (!amount || amount <= 0) return null;

  return {
    Vendor:      vendor,
    Amount:      amount.toFixed(2),
    Currency:    currency,
    Description: description,
    Category:    'Payment',
    Entity:      'WEBHOOK',
    Date:        new Date().toISOString().split('T')[0],
    _source:     'stripe',
    _externalId: obj.id,
  };
}

function normalizePaystack(payload) {
  const data = payload.data || {};
  const event = payload.event || '';

  if (!event.includes('success') && !event.includes('complete')) return null;

  const amount   = (data.amount || 0) / 100;
  const currency = (data.currency || 'NGN').toUpperCase();
  const vendor   = data.customer?.name || data.customer?.email || 'Paystack Customer';
  const desc     = data.metadata?.description || `Paystack ${event} ${data.reference}`;

  if (!amount || amount <= 0) return null;

  return {
    Vendor:      vendor,
    Amount:      amount.toFixed(2),
    Currency:    currency,
    Description: desc,
    Category:    data.metadata?.category || 'Payment',
    Entity:      'WEBHOOK',
    Date:        new Date().toISOString().split('T')[0],
    _source:     'paystack',
    _externalId: data.reference,
  };
}

function normalizeFlutterwave(payload) {
  const data = payload.data || {};
  const event = payload.event || '';

  if (!event.includes('successful') && !event.includes('completed')) return null;

  const amount   = parseFloat(data.amount || 0);
  const currency = (data.currency || 'NGN').toUpperCase();
  const vendor   = data.customer?.name || data.customer?.email || 'Flutterwave Customer';
  const desc     = data.narration || `Flutterwave ${data.tx_ref}`;

  if (!amount || amount <= 0) return null;

  return {
    Vendor:      vendor,
    Amount:      amount.toFixed(2),
    Currency:    currency,
    Description: desc,
    Category:    'Payment',
    Entity:      'WEBHOOK',
    Date:        new Date().toISOString().split('T')[0],
    _source:     'flutterwave',
    _externalId: data.id?.toString(),
  };
}

function normalizeSquare(payload) {
  const obj = payload.data?.object?.payment || {};
  const event = payload.type || '';

  if (!event.includes('completed') && !event.includes('created')) return null;

  const amount   = (obj.amount_money?.amount || 0) / 100;
  const currency = (obj.amount_money?.currency || 'USD').toUpperCase();
  const vendor   = obj.buyer_email_address || obj.note || 'Square Customer';
  const desc     = obj.note || `Square payment ${obj.id}`;

  if (!amount || amount <= 0) return null;

  return {
    Vendor:      vendor,
    Amount:      amount.toFixed(2),
    Currency:    currency,
    Description: desc,
    Category:    'Payment',
    Entity:      'WEBHOOK',
    Date:        new Date().toISOString().split('T')[0],
    _source:     'square',
    _externalId: obj.id,
  };
}

function normalizeMonnify(payload) {
  const data = payload.eventData || {};
  if (payload.eventType !== 'SUCCESSFUL_TRANSACTION') return null;

  const amount   = parseFloat(data.amountPaid || 0);
  const currency = (data.currencyCode || 'NGN').toUpperCase();
  const vendor   = data.customer?.name || data.customer?.email || 'Monnify Customer';
  const desc     = data.paymentDescription || `Monnify ${data.transactionReference}`;

  if (!amount || amount <= 0) return null;

  return {
    Vendor:      vendor,
    Amount:      amount.toFixed(2),
    Currency:    currency,
    Description: desc,
    Category:    'Payment',
    Entity:      'WEBHOOK',
    Date:        new Date().toISOString().split('T')[0],
    _source:     'monnify',
    _externalId: data.transactionReference,
  };
}

function normalizeGeneric(payload) {
  // Try to extract common fields from any payment payload
  const amount   = parseFloat(payload.amount || payload.value || payload.total || 0);
  const currency = (payload.currency || payload.currency_code || 'USD').toUpperCase();
  const vendor   = payload.customer_name || payload.payer || payload.merchant || 'Webhook Payment';
  const desc     = payload.description || payload.narration || payload.note || 'Webhook transaction';

  if (!amount || amount <= 0) return null;

  return {
    Vendor:      vendor,
    Amount:      amount.toFixed(2),
    Currency:    currency,
    Description: desc,
    Category:    'Payment',
    Entity:      'WEBHOOK',
    Date:        new Date().toISOString().split('T')[0],
    _source:     'generic',
    _externalId: payload.id || payload.reference || payload.transaction_id,
  };
}

// ── Main normalizer ───────────────────────────────────────────────────────────

function normalizeWebhook(processor, payload) {
  switch (processor.toLowerCase()) {
    case 'stripe':      return normalizeStripe(payload);
    case 'paystack':    return normalizePaystack(payload);
    case 'flutterwave': return normalizeFlutterwave(payload);
    case 'square':      return normalizeSquare(payload);
    case 'monnify':     return normalizeMonnify(payload);
    default:            return normalizeGeneric(payload);
  }
}

module.exports = { normalizeWebhook };
