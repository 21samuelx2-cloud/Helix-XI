const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const {
  INBOUND_REPLAY_WINDOW_MS,
  hashPayload,
  normalizeTimestamp,
  enforceReplayWindow,
  buildInboundEventKey,
  safeEqual,
  parseStripeSignature,
  verifyProviderWebhook,
} = require('../modules/webhookSecurity');

function createReq(headers = {}, extra = {}) {
  return {
    headers,
    protocol: 'https',
    get(name) {
      if (name.toLowerCase() === 'host') return 'aria.helixxi.test';
      return undefined;
    },
    originalUrl: '/api/webhook/square',
    ...extra,
  };
}

test('timestamp normalization and replay window behave safely', () => {
  const now = Date.now();
  const seconds = Math.floor(now / 1000).toString();
  const millis = now.toString();

  assert.equal(normalizeTimestamp(seconds)?.getTime() > 0, true);
  assert.equal(normalizeTimestamp(millis)?.getTime() > 0, true);
  assert.equal(normalizeTimestamp('not-a-date'), null);

  const fresh = enforceReplayWindow(new Date(now).toISOString());
  assert.equal(fresh.ok, true);

  const stale = enforceReplayWindow(new Date(now - INBOUND_REPLAY_WINDOW_MS - 1000).toISOString());
  assert.equal(stale.ok, false);
  assert.match(stale.error, /replay window/);
});

test('event keys and payload hashes are stable', () => {
  const payloadHash = hashPayload('{"ok":true}');
  assert.equal(payloadHash.length, 64);
  assert.equal(
    buildInboundEventKey({ source: 'webhook_stripe', companyId: 'cmp_1', externalId: 'evt_1', payloadHash }),
    'webhook_stripe:cmp_1:evt_1'
  );
  assert.equal(
    buildInboundEventKey({ source: 'webhook_custom', companyId: null, externalId: null, payloadHash }),
    `webhook_custom:global:${payloadHash}`
  );
});

test('safeEqual protects equal and unequal comparisons', () => {
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
  assert.equal(safeEqual('short', 'longer'), false);
});

test('Stripe signature parsing and verification work', () => {
  const secret = 'whsec_test';
  const rawBody = JSON.stringify({ id: 'evt_123', object: 'event' });
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');
  const header = `t=${timestamp},v1=${signature}`;

  const parsed = parseStripeSignature(header);
  assert.equal(parsed.t, timestamp);
  assert.deepEqual(parsed.v1, [signature]);

  const ok = verifyProviderWebhook({
    processor: 'stripe',
    req: createReq({ 'stripe-signature': header }),
    rawBody,
    secret,
  });
  assert.equal(ok.ok, true);

  const bad = verifyProviderWebhook({
    processor: 'stripe',
    req: createReq({ 'stripe-signature': `t=${timestamp},v1=deadbeef` }),
    rawBody,
    secret,
  });
  assert.equal(bad.ok, false);
});

test('Paystack, Flutterwave, Monnify, Square, and custom signatures verify correctly', () => {
  const rawBody = JSON.stringify({ amount: 5000, currency: 'USD' });

  const paystackSecret = 'paystack_secret';
  const paystackSig = crypto.createHmac('sha512', paystackSecret).update(rawBody).digest('hex');
  assert.equal(
    verifyProviderWebhook({
      processor: 'paystack',
      req: createReq({ 'x-paystack-signature': paystackSig }),
      rawBody,
      secret: paystackSecret,
    }).ok,
    true
  );

  assert.equal(
    verifyProviderWebhook({
      processor: 'flutterwave',
      req: createReq({ 'verif-hash': 'flutter_secret' }),
      rawBody,
      secret: 'flutter_secret',
    }).ok,
    true
  );

  const monnifySecret = 'monnify_secret';
  const monnifySig = crypto.createHmac('sha512', monnifySecret).update(rawBody).digest('hex');
  assert.equal(
    verifyProviderWebhook({
      processor: 'monnify',
      req: createReq({ 'monnify-signature': monnifySig }),
      rawBody,
      secret: monnifySecret,
    }).ok,
    true
  );

  const squareSecret = 'square_secret';
  const squareUrl = 'https://aria.helixxi.test/api/webhook/square';
  const squareSig = crypto.createHmac('sha1', squareSecret).update(`${squareUrl}${rawBody}`).digest('base64');
  assert.equal(
    verifyProviderWebhook({
      processor: 'square',
      req: createReq({ 'x-square-hmacsha256-signature': squareSig }),
      rawBody,
      secret: squareSecret,
    }).ok,
    true
  );

  const customSecret = 'custom_secret';
  const customSig = crypto.createHmac('sha256', customSecret).update(rawBody).digest('hex');
  assert.equal(
    verifyProviderWebhook({
      processor: 'custom',
      req: createReq({ 'x-aria-signature': customSig }, { originalUrl: '/api/webhook/custom' }),
      rawBody,
      secret: customSecret,
    }).ok,
    true
  );
});
