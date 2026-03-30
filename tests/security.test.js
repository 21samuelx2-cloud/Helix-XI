const test = require('node:test');
const assert = require('node:assert/strict');

const {
  userPermissions,
  hasPermission,
  csrfGuard,
  createJwtAuth,
  requirePermission,
  requireCompanyContext,
  hashSecret,
  generateCredential,
  maskSecret,
  authCookieOptions,
  csrfCookieOptions,
  issueCsrfToken,
} = require('../modules/security');

function createRes() {
  return {
    statusCode: 200,
    body: null,
    cookies: [],
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    cookie(name, value, options) {
      this.cookies.push({ name, value, options });
      return this;
    },
  };
}

test('userPermissions and hasPermission respect role mappings', () => {
  assert.deepEqual(userPermissions({ role: 'MANAGER' }).slice(0, 3), [
    'dashboard.read',
    'ledger.read',
    'holdqueue.read',
  ]);
  assert.equal(hasPermission({ role: 'ADMIN' }, 'anything.at.all'), true);
  assert.equal(hasPermission({ role: 'INDIVIDUAL' }, 'integrations.rotate'), false);
  assert.equal(hasPermission({ role: 'MANAGER' }, 'forecast.run'), true);
});

test('csrfGuard blocks cookie-authenticated writes without a matching token', () => {
  const req = {
    headers: { 'content-type': 'application/json' },
    cookies: { token: 'jwt', csrf_token: 'cookie-token' },
  };
  const res = createRes();
  let nextCalled = false;

  csrfGuard(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { error: 'Invalid CSRF token' });
});

test('csrfGuard allows matching CSRF token and rejects non-json writes', () => {
  const allowedReq = {
    headers: { 'content-type': 'application/json', 'x-csrf-token': 'match' },
    cookies: { token: 'jwt', csrf_token: 'match' },
  };
  const allowedRes = createRes();
  let nextCalled = false;

  csrfGuard(allowedReq, allowedRes, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(allowedRes.body, null);

  const badReq = { headers: { 'content-type': 'text/plain' }, cookies: {} };
  const badRes = createRes();
  csrfGuard(badReq, badRes, () => {});
  assert.equal(badRes.statusCode, 415);
});

test('createJwtAuth accepts cookie token and rejects invalid token', () => {
  const verifyToken = (token) => (token === 'good-token' ? { userId: 'u_1', role: 'MANAGER' } : null);
  const jwtAuth = createJwtAuth(verifyToken);

  const okReq = { headers: {}, cookies: { token: 'good-token' } };
  const okRes = createRes();
  let nextCalled = false;
  jwtAuth(okReq, okRes, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);
  assert.deepEqual(okReq.user, { userId: 'u_1', role: 'MANAGER' });

  const badReq = { headers: {}, cookies: { token: 'bad-token' } };
  const badRes = createRes();
  jwtAuth(badReq, badRes, () => {});
  assert.equal(badRes.statusCode, 401);
  assert.deepEqual(badRes.body, { error: 'Invalid or expired token' });
});

test('requirePermission and requireCompanyContext enforce access boundaries', () => {
  const req = { user: { role: 'INDIVIDUAL' } };
  const res = createRes();

  requirePermission('forecast.run')(req, res, () => {});
  assert.equal(res.statusCode, 403);
  assert.match(res.body.error, /forecast\.run/);

  const companyReq = { user: { role: 'MANAGER', companyId: null } };
  const companyRes = createRes();
  requireCompanyContext(companyReq, companyRes, () => {});
  assert.equal(companyRes.statusCode, 403);
});

test('secret helpers produce stable-safe outputs', () => {
  const hashed = hashSecret('super-secret');
  assert.equal(typeof hashed, 'string');
  assert.equal(hashed.length, 64);
  assert.match(generateCredential('aria_live'), /^aria_live_[0-9a-f]+$/);
  assert.equal(maskSecret('abcd1234wxyz9999'), 'abcd1234****9999');
  assert.equal(maskSecret('short'), '********');
});

test('cookie helpers issue aligned session settings and csrf cookie', () => {
  const auth = authCookieOptions();
  const csrf = csrfCookieOptions();
  assert.equal(auth.httpOnly, true);
  assert.equal(csrf.httpOnly, false);
  assert.equal(auth.sameSite, 'lax');
  assert.equal(csrf.sameSite, 'lax');

  const res = createRes();
  const csrfToken = issueCsrfToken(res);
  assert.equal(typeof csrfToken, 'string');
  assert.equal(csrfToken.length, 64);
  assert.equal(res.cookies[0].name, 'csrf_token');
  assert.equal(res.cookies[0].value, csrfToken);
});
