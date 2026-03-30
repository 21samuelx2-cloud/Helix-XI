const crypto = require('crypto');

const INBOUND_REPLAY_WINDOW_MS = 5 * 60 * 1000;

const hashPayload = (value) => crypto.createHash('sha256').update(value).digest('hex');

const normalizeTimestamp = (value) => {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (/^\d+$/.test(trimmed)) {
    const numeric = Number(trimmed);
    const ms = trimmed.length <= 10 ? numeric * 1000 : numeric;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date;
};

const enforceReplayWindow = (timestampHeader) => {
  const parsed = normalizeTimestamp(timestampHeader);
  if (!parsed) return { ok: true, timestamp: new Date().toISOString() };
  const age = Math.abs(Date.now() - parsed.getTime());
  if (age > INBOUND_REPLAY_WINDOW_MS) {
    return { ok: false, error: 'Request timestamp is outside the allowed replay window' };
  }
  return { ok: true, timestamp: parsed.toISOString() };
};

const buildInboundEventKey = ({ source, companyId, externalId, payloadHash }) => {
  const stableExternalId = externalId || payloadHash;
  return `${source}:${companyId || 'global'}:${stableExternalId}`;
};

const safeEqual = (left, right) => {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
};

const hmacHex = (algo, secret, value) => crypto.createHmac(algo, secret).update(value).digest('hex');
const hmacBase64 = (algo, secret, value) => crypto.createHmac(algo, secret).update(value).digest('base64');

const parseStripeSignature = (headerValue) => {
  const parts = String(headerValue || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  const parsed = { t: null, v1: [] };
  for (const part of parts) {
    const [key, value] = part.split('=');
    if (key === 't') parsed.t = value;
    if (key === 'v1' && value) parsed.v1.push(value);
  }
  return parsed;
};

const verifyStripeSignature = ({ rawBody, signatureHeader, secret }) => {
  const parsed = parseStripeSignature(signatureHeader);
  if (!parsed.t || parsed.v1.length === 0) return { ok: false, error: 'Missing Stripe signature' };
  const signedPayload = `${parsed.t}.${rawBody}`;
  const expected = hmacHex('sha256', secret, signedPayload);
  const matched = parsed.v1.some((candidate) => safeEqual(candidate, expected));
  if (!matched) return { ok: false, error: 'Invalid Stripe signature' };
  return { ok: true, timestamp: parsed.t };
};

const verifyProviderWebhook = ({ processor, req, rawBody, secret }) => {
  if (!secret) return { ok: true };
  switch (processor) {
    case 'stripe':
      return verifyStripeSignature({
        rawBody,
        signatureHeader: req.headers['stripe-signature'],
        secret,
      });
    case 'paystack': {
      const signature = req.headers['x-paystack-signature'];
      if (!signature) return { ok: false, error: 'Missing Paystack signature' };
      const expected = hmacHex('sha512', secret, rawBody);
      return safeEqual(signature, expected) ? { ok: true } : { ok: false, error: 'Invalid Paystack signature' };
    }
    case 'flutterwave': {
      const signature = req.headers['verif-hash'];
      if (!signature) return { ok: false, error: 'Missing Flutterwave signature' };
      return safeEqual(signature, secret) ? { ok: true } : { ok: false, error: 'Invalid Flutterwave signature' };
    }
    case 'monnify': {
      const signature = req.headers['monnify-signature'];
      if (!signature) return { ok: false, error: 'Missing Monnify signature' };
      const expected = hmacHex('sha512', secret, rawBody);
      return safeEqual(signature, expected) ? { ok: true } : { ok: false, error: 'Invalid Monnify signature' };
    }
    case 'square': {
      const signature = req.headers['x-square-hmacsha256-signature'];
      if (!signature) return { ok: false, error: 'Missing Square signature' };
      const notificationUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
      const expected = hmacBase64('sha1', secret, `${notificationUrl}${rawBody}`);
      return safeEqual(signature, expected) ? { ok: true } : { ok: false, error: 'Invalid Square signature' };
    }
    case 'custom': {
      const signature = req.headers['x-aria-signature'];
      if (!signature) return { ok: false, error: 'Missing custom webhook signature' };
      const expected = hmacHex('sha256', secret, rawBody);
      return safeEqual(signature, expected) ? { ok: true } : { ok: false, error: 'Invalid custom webhook signature' };
    }
    default:
      return { ok: true };
  }
};

module.exports = {
  INBOUND_REPLAY_WINDOW_MS,
  hashPayload,
  normalizeTimestamp,
  enforceReplayWindow,
  buildInboundEventKey,
  safeEqual,
  parseStripeSignature,
  verifyProviderWebhook,
};
