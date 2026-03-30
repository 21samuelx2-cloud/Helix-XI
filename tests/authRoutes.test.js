const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const { registerAuthAdminRoutes } = require('../modules/authAdminRoutes');
const {
  authCookieOptions,
  clearStepUpToken,
  csrfCookieOptions,
  csrfGuard,
  issueCsrfToken,
  issueStepUpToken,
} = require('../modules/security');

function createHarness() {
  const app = express();
  app.use(express.json());

  registerAuthAdminRoutes(app, {
    authCookieOptions,
    appendToAuditLog: async () => {},
    clearStepUpToken,
    csrfCookieOptions,
    csrfGuard,
    getARIAJournal: async () => [],
    getARIAMemory: async () => [],
    getAuditLog: async () => [],
    getCompanies: async () => [],
    getHoldQueue: async () => [],
    getLedger: async () => [],
    getUsers: async () => [],
    issueCsrfToken,
    issueStepUpToken,
    jwtAuth: (req, res, next) => next(),
    loginUser: async () => ({
      token: 'session-token',
      user: {
        userId: 'u_1',
        role: 'MANAGER',
        companyId: 'cmp_1',
      },
    }),
    registerCompany: async () => ({ success: true }),
    registerIndividual: async () => ({ success: true }),
    requirePermission: () => (req, res, next) => next(),
    requireRecentStepUp: (req, res, next) => next(),
    sb: {
      from() {
        return {
          select() { return this; },
          or() { return this; },
          limit() { return this; },
          maybeSingle() { return Promise.resolve({ data: null }); },
        };
      },
    },
    updateUserPassword: async () => ({}),
    updateUserStatus: async () => ({}),
    updateUserRole: async () => ({}),
    validateUserPassword: async () => true,
  });

  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

function getSetCookieHeaders(res) {
  if (typeof res.headers.getSetCookie === 'function') {
    return res.headers.getSetCookie();
  }

  const header = res.headers.get('set-cookie');
  return header ? [header] : [];
}

test('login issues session and csrf cookies but does not auto-issue step-up', async () => {
  const harness = await createHarness();
  try {
    const res = await fetch(`${harness.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'manager', password: 'secret' }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.token, 'session-token');
    assert.equal(typeof body.csrfToken, 'string');

    const cookies = getSetCookieHeaders(res);
    assert.equal(cookies.some((cookie) => cookie.includes('token=session-token')), true);
    assert.equal(cookies.some((cookie) => cookie.includes('csrf_token=')), true);
    const stepUpCookie = cookies.find((cookie) => cookie.includes('step_up='));
    assert.equal(Boolean(stepUpCookie), true);
    assert.equal(/step_up=;/.test(stepUpCookie), true);
  } finally {
    await harness.close();
  }
});
