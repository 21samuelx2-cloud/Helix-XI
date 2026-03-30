const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');

const {
  csrfGuard,
  createJwtAuth,
  requirePermission,
  requireCompanyContext,
  requireRecentStepUp,
} = require('../modules/security');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'helix-xi-test-jwt-secret';

function stepUpCookieFor(user) {
  return jwt.sign(
    {
      type: 'step_up',
      userId: user.userId,
      role: user.role,
      companyId: user.companyId || null,
    },
    process.env.JWT_SECRET,
    { expiresIn: 600 }
  );
}

function createRouteHarness() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());

  const verifyToken = (token) => {
    if (token === 'manager-company-token') {
      return { userId: 'u_mgr', role: 'MANAGER', companyId: 'cmp_1' };
    }
    if (token === 'individual-token') {
      return { userId: 'u_ind', role: 'INDIVIDUAL', companyId: null };
    }
    if (token === 'admin-token') {
      return { userId: 'admin', role: 'ADMIN', companyId: null };
    }
    return null;
  };

  const jwtAuth = createJwtAuth(verifyToken);

  app.get('/api/dashboard/kpis', jwtAuth, requirePermission('dashboard.read'), (req, res) => {
    res.json({ ok: true, route: 'dashboard', user: req.user });
  });

  app.get('/api/integrations/settings', jwtAuth, requireCompanyContext, requirePermission('integrations.read'), (req, res) => {
    res.json({ ok: true, route: 'integrations', companyId: req.user.companyId });
  });

  app.post(
    '/api/holdqueue/:hxid/decision',
    csrfGuard,
    jwtAuth,
    requireCompanyContext,
    requireRecentStepUp,
    requirePermission('holdqueue.approve'),
    (req, res) => {
      res.json({ ok: true, hxid: req.params.hxid, decision: req.body.decision });
    }
  );

  app.get('/api/journal', jwtAuth, requireCompanyContext, requirePermission('journal.read'), (req, res) => {
    res.json({ ok: true, route: 'journal' });
  });

  app.get('/api/forecasts', jwtAuth, requirePermission('forecast.read'), (req, res) => {
    res.json({ ok: true, route: 'forecasts' });
  });

  app.post(
    '/api/forecasts/run',
    csrfGuard,
    jwtAuth,
    requireCompanyContext,
    requireRecentStepUp,
    requirePermission('forecast.run'),
    (req, res) => {
      res.json({ ok: true, route: 'forecast-run' });
    }
  );

  app.get('/api/auditlog', jwtAuth, requirePermission('audit.read'), (req, res) => {
    res.json({ ok: true, route: 'auditlog' });
  });

  app.post(
    '/api/journal',
    csrfGuard,
    jwtAuth,
    requirePermission('journal.write'),
    (req, res) => {
      res.json({ ok: true, title: req.body.title || null });
    }
  );

  app.post(
    '/api/integrations/credentials/rotate',
    csrfGuard,
    jwtAuth,
    requireCompanyContext,
    requireRecentStepUp,
    requirePermission('integrations.rotate'),
    (req, res) => {
      res.json({ ok: true, rotated: req.body.kind });
    }
  );

  app.post(
    '/admin/system/shutdown',
    jwtAuth,
    requireRecentStepUp,
    requirePermission('admin.system.shutdown'),
    csrfGuard,
    (req, res) => {
      res.json({ ok: true, route: 'shutdown' });
    }
  );

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

async function jsonFetch(baseUrl, path, options = {}) {
  const res = await fetch(`${baseUrl}${path}`, options);
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

test('route harness enforces dashboard read auth and rejects anonymous requests', async () => {
  const harness = await createRouteHarness();
  try {
    const denied = await jsonFetch(harness.baseUrl, '/api/dashboard/kpis');
    assert.equal(denied.status, 401);

    const allowed = await jsonFetch(harness.baseUrl, '/api/dashboard/kpis', {
      headers: { Cookie: 'token=manager-company-token' },
    });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.body.route, 'dashboard');
    assert.equal(allowed.body.user.role, 'MANAGER');
  } finally {
    await harness.close();
  }
});

test('route harness enforces company context on integrations and journal reads', async () => {
  const harness = await createRouteHarness();
  try {
    const noCompany = await jsonFetch(harness.baseUrl, '/api/integrations/settings', {
      headers: { Cookie: 'token=individual-token' },
    });
    assert.equal(noCompany.status, 403);

    const companyUser = await jsonFetch(harness.baseUrl, '/api/integrations/settings', {
      headers: { Cookie: 'token=manager-company-token' },
    });
    assert.equal(companyUser.status, 200);
    assert.equal(companyUser.body.companyId, 'cmp_1');

    const journalDenied = await jsonFetch(harness.baseUrl, '/api/journal', {
      headers: { Cookie: 'token=individual-token' },
    });
    assert.equal(journalDenied.status, 403);
  } finally {
    await harness.close();
  }
});

test('route harness enforces CSRF and permission checks on hold queue decisions', async () => {
  const harness = await createRouteHarness();
  try {
    const missingCsrf = await jsonFetch(harness.baseUrl, '/api/holdqueue/HX123/decision', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: 'token=manager-company-token; csrf_token=match-me',
      },
      body: JSON.stringify({ decision: 'APPROVE' }),
    });
    assert.equal(missingCsrf.status, 403);

    const missingStepUp = await jsonFetch(harness.baseUrl, '/api/holdqueue/HX123/decision', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': 'match-me',
        Cookie: 'token=manager-company-token; csrf_token=match-me',
      },
      body: JSON.stringify({ decision: 'APPROVE' }),
    });
    assert.equal(missingStepUp.status, 403);

    const wrongPermission = await jsonFetch(harness.baseUrl, '/api/holdqueue/HX123/decision', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': 'match-me',
        Cookie: `token=individual-token; csrf_token=match-me; step_up=${stepUpCookieFor({ userId: 'u_ind', role: 'INDIVIDUAL', companyId: null })}`,
      },
      body: JSON.stringify({ decision: 'APPROVE' }),
    });
    assert.equal(wrongPermission.status, 403);

    const allowed = await jsonFetch(harness.baseUrl, '/api/holdqueue/HX123/decision', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': 'match-me',
        Cookie: `token=manager-company-token; csrf_token=match-me; step_up=${stepUpCookieFor({ userId: 'u_mgr', role: 'MANAGER', companyId: 'cmp_1' })}`,
      },
      body: JSON.stringify({ decision: 'APPROVE' }),
    });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.body.hxid, 'HX123');
  } finally {
    await harness.close();
  }
});

test('admin bypasses permission checks but still fails company-only routes without company context', async () => {
  const harness = await createRouteHarness();
  try {
    const dashboard = await jsonFetch(harness.baseUrl, '/api/dashboard/kpis', {
      headers: { Cookie: 'token=admin-token' },
    });
    assert.equal(dashboard.status, 200);

    const companyOnly = await jsonFetch(harness.baseUrl, '/api/integrations/settings', {
      headers: { Cookie: 'token=admin-token' },
    });
    assert.equal(companyOnly.status, 403);
  } finally {
    await harness.close();
  }
});

test('forecast and audit routes enforce permission intent correctly', async () => {
  const harness = await createRouteHarness();
  try {
    const forecastRead = await jsonFetch(harness.baseUrl, '/api/forecasts', {
      headers: { Cookie: 'token=individual-token' },
    });
    assert.equal(forecastRead.status, 200);

    const auditRead = await jsonFetch(harness.baseUrl, '/api/auditlog', {
      headers: { Cookie: 'token=individual-token' },
    });
    assert.equal(auditRead.status, 200);

    const forecastRunDenied = await jsonFetch(harness.baseUrl, '/api/forecasts/run', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': 'match-me',
        Cookie: `token=individual-token; csrf_token=match-me; step_up=${stepUpCookieFor({ userId: 'u_ind', role: 'INDIVIDUAL', companyId: null })}`,
      },
      body: JSON.stringify({}),
    });
    assert.equal(forecastRunDenied.status, 403);

    const forecastRunAllowed = await jsonFetch(harness.baseUrl, '/api/forecasts/run', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': 'match-me',
        Cookie: `token=manager-company-token; csrf_token=match-me; step_up=${stepUpCookieFor({ userId: 'u_mgr', role: 'MANAGER', companyId: 'cmp_1' })}`,
      },
      body: JSON.stringify({}),
    });
    assert.equal(forecastRunAllowed.status, 200);
  } finally {
    await harness.close();
  }
});

test('journal write, integration rotate, and admin shutdown enforce the right boundaries', async () => {
  const harness = await createRouteHarness();
  try {
    const journalWrite = await jsonFetch(harness.baseUrl, '/api/journal', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': 'match-me',
        Cookie: 'token=individual-token; csrf_token=match-me',
      },
      body: JSON.stringify({ title: 'note', content: 'hello' }),
    });
    assert.equal(journalWrite.status, 200);

    const rotateDenied = await jsonFetch(harness.baseUrl, '/api/integrations/credentials/rotate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': 'match-me',
        Cookie: `token=individual-token; csrf_token=match-me; step_up=${stepUpCookieFor({ userId: 'u_ind', role: 'INDIVIDUAL', companyId: null })}`,
      },
      body: JSON.stringify({ kind: 'api' }),
    });
    assert.equal(rotateDenied.status, 403);

    const rotateAllowed = await jsonFetch(harness.baseUrl, '/api/integrations/credentials/rotate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': 'match-me',
        Cookie: `token=manager-company-token; csrf_token=match-me; step_up=${stepUpCookieFor({ userId: 'u_mgr', role: 'MANAGER', companyId: 'cmp_1' })}`,
      },
      body: JSON.stringify({ kind: 'api' }),
    });
    assert.equal(rotateAllowed.status, 200);
    assert.equal(rotateAllowed.body.rotated, 'api');

    const shutdownDenied = await jsonFetch(harness.baseUrl, '/admin/system/shutdown', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': 'match-me',
        Cookie: `token=manager-company-token; csrf_token=match-me; step_up=${stepUpCookieFor({ userId: 'u_mgr', role: 'MANAGER', companyId: 'cmp_1' })}`,
      },
      body: JSON.stringify({}),
    });
    assert.equal(shutdownDenied.status, 403);

    const shutdownAllowed = await jsonFetch(harness.baseUrl, '/admin/system/shutdown', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': 'match-me',
        Cookie: `token=admin-token; csrf_token=match-me; step_up=${stepUpCookieFor({ userId: 'admin', role: 'ADMIN', companyId: null })}`,
      },
      body: JSON.stringify({}),
    });
    assert.equal(shutdownAllowed.status, 200);
  } finally {
    await harness.close();
  }
});
