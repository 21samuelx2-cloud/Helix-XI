const bcrypt = require('bcryptjs');
const { Resend } = require('resend');

async function sendSecurityAlert(event) {
  const alertTo = process.env.ALERT_EMAIL;
  if (!alertTo || !process.env.RESEND_API_KEY) return;
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: 'ARIA Security <onboarding@resend.dev>',
      to: alertTo,
      subject: `ARIA security event: ${event.title}`,
      html: `<div style="font-family:monospace;background:#0f172a;color:#e2e8f0;padding:20px">
        <h2 style="margin:0 0 12px;color:#fb923c">${event.title}</h2>
        <div><strong>Actor:</strong> ${event.actor || 'unknown'}</div>
        <div><strong>Action:</strong> ${event.action || 'unknown'}</div>
        <div><strong>Status:</strong> ${event.status || 'unknown'}</div>
        <div><strong>Detail:</strong> ${event.detail || 'n/a'}</div>
        <div><strong>At:</strong> ${new Date().toISOString()}</div>
      </div>`,
    });
  } catch (err) {
    console.error('Security alert failed:', err.message);
  }
}

async function recordSecurityEvent(event, companyId, appendToAuditLog) {
  await appendToAuditLog({
    timestamp: new Date().toISOString(),
    action: event.action,
    details: event.detail,
    layer: 'SECURITY',
    status: event.status,
    companyId,
  }, companyId).catch(() => {});

  if (event.status !== 'OK') {
    await sendSecurityAlert(event).catch(() => {});
  }
}

function summarizeSecurityEvents(auditLog) {
  const securityRows = auditLog.filter((row) => (row.Layer || row.layer) === 'SECURITY');
  const now = Date.now();
  const last24h = securityRows.filter((row) => {
    const ts = new Date(row.Timestamp || row.timestamp || 0).getTime();
    return Number.isFinite(ts) && (now - ts) <= 24 * 60 * 60 * 1000;
  });
  const denied24h = last24h.filter((row) => (row.Status || row.status) === 'DENIED').length;
  const ok24h = last24h.filter((row) => (row.Status || row.status) === 'OK').length;
  const lastEvent = securityRows[securityRows.length - 1] || null;
  return {
    total: securityRows.length,
    last24h: last24h.length,
    denied24h,
    approved24h: ok24h,
    lastEventAt: lastEvent?.Timestamp || lastEvent?.timestamp || null,
    lastEventAction: lastEvent?.Action || lastEvent?.action || null,
  };
}

function summarizeIntegrationHealth(companies) {
  const rows = (companies || []).filter((company) => company.integration_status || company.integration_trust_score || company.last_webhook_at);
  const trusted = rows.filter((company) => Number(company.integration_trust_score || 0) >= 85).length;
  const healthy = rows.filter((company) => {
    if (company.integration_quarantined) return false;
    const score = Number(company.integration_trust_score || 0);
    return score >= 65 && score < 85;
  }).length;
  const watch = rows.filter((company) => {
    if (company.integration_quarantined) return false;
    const score = Number(company.integration_trust_score || 0);
    return score >= 40 && score < 65;
  }).length;
  const quarantined = rows.filter((company) => Boolean(company.integration_quarantined)).length;
  const atRisk = rows.filter((company) => !company.integration_quarantined && Number(company.integration_trust_score || 0) < 40).length;
  const lastActive = rows
    .map((company) => company.integration_last_event_at || company.last_webhook_at || null)
    .filter(Boolean)
    .sort()
    .slice(-1)[0] || null;

  return {
    total: rows.length,
    connected: rows.filter((company) => String(company.integration_status || '').toLowerCase() === 'connected').length,
    trusted,
    healthy,
    watch,
    atRisk,
    quarantined,
    lastActive,
  };
}

function summarizeProviderDiagnostics(companies) {
  const now = Date.now();
  const rows = (companies || []).filter((company) => company.integration_status || company.integration_last_event_at || company.last_webhook_at);
  const providers = new Map();

  rows.forEach((company) => {
    const provider = String(company.integration_provider_profile || company.provider || company.integration_last_event_provider || 'custom').toLowerCase();
    const lastActive = company.integration_last_event_at || company.last_webhook_at || null;
    const lastActiveTs = lastActive ? new Date(lastActive).getTime() : 0;
    const isStale = !lastActiveTs || !Number.isFinite(lastActiveTs) || (now - lastActiveTs) > (7 * 24 * 60 * 60 * 1000);

    if (!providers.has(provider)) {
      providers.set(provider, {
        provider,
        companies: 0,
        trusted: 0,
        watch: 0,
        quarantined: 0,
        stale: 0,
        eventsTotal: 0,
        failures24h: 0,
        duplicates: 0,
        avgTrustScore: 0,
        lastActive: null,
      });
    }

    const current = providers.get(provider);
    current.companies += 1;
    current.eventsTotal += Number(company.integration_events_total || 0);
    current.failures24h += Number(company.integration_failures_24h || 0);
    current.duplicates += Number(company.integration_duplicate_events || 0);
    current.avgTrustScore += Number(company.integration_trust_score || 0);
    if (company.integration_quarantined) current.quarantined += 1;
    else if (Number(company.integration_trust_score || 0) >= 85) current.trusted += 1;
    else current.watch += 1;
    if (isStale) current.stale += 1;
    if (!current.lastActive || new Date(lastActive || 0).getTime() > new Date(current.lastActive || 0).getTime()) {
      current.lastActive = lastActive;
    }
  });

  return [...providers.values()]
    .map((entry) => ({
      ...entry,
      avgTrustScore: entry.companies ? Math.round(entry.avgTrustScore / entry.companies) : 0,
    }))
    .sort((left, right) => {
      if (right.quarantined !== left.quarantined) return right.quarantined - left.quarantined;
      if (right.watch !== left.watch) return right.watch - left.watch;
      return right.companies - left.companies;
    });
}

function registerAuthAdminRoutes(app, deps) {
  const {
    authCookieOptions,
    appendToAuditLog,
    clearStepUpToken,
    csrfCookieOptions,
    csrfGuard,
    getARIAJournal,
    getARIAMemory,
    getAuditLog,
    getCompanies,
    getHoldQueue,
    getLedger,
    getTransactions,
    getUsers,
    ingestTransaction,
    issueCsrfToken,
    issueStepUpToken,
    jwtAuth,
    loginUser,
    registerCompany,
    registerIndividual,
    requirePermission,
    requireRecentStepUp,
    sb,
    updateUserPassword,
    updateUserStatus,
    updateUserRole,
    validateUserPassword,
  } = deps;

  app.post('/auth/login', async (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
      const result = await loginUser({ username, password });
      const csrfToken = issueCsrfToken(res);
      res.cookie('token', result.token, authCookieOptions());
      clearStepUpToken(res);
      res.json({ ...result, csrfToken });
    } catch (err) {
      res.status(401).json({ error: err.message });
    }
  });

  app.post('/auth/signup/individual', csrfGuard, async (req, res) => {
    try {
      const { username, email, password } = req.body;
      if (!username || !email || !password) return res.status(400).json({ error: 'All fields required' });
      if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
      const result = await registerIndividual({ username, email, password });
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/auth/signup/company', csrfGuard, async (req, res) => {
    try {
      const { companyName, domain, managerEmail, password, username } = req.body;
      if (!companyName || !domain || !managerEmail || !password || !username) {
        return res.status(400).json({ error: 'All fields required' });
      }
      const result = await registerCompany({ companyName, domain, managerEmail, password, username });
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/auth/recovery/request', async (req, res) => {
    try {
      const loginId = String(req.body?.loginId || '').trim().slice(0, 200);
      if (!loginId) return res.status(400).json({ error: 'Username or email is required' });

      const { data: user } = await sb
        .from('helixxi_users')
        .select('id, username, email, company_id, status')
        .or(`username.ilike.${loginId},email.ilike.${loginId}`)
        .limit(1)
        .maybeSingle()
        .catch(() => ({ data: null }));

      await recordSecurityEvent({
        title: 'Account recovery requested',
        actor: user?.id || loginId,
        action: 'ACCOUNT_RECOVERY_REQUEST',
        status: 'OK',
        detail: user
          ? `Recovery requested for ${user.username || user.email || loginId} (${user.status || 'unknown status'}).`
          : `Recovery requested for unknown login identifier ${loginId}.`,
      }, user?.company_id || null, appendToAuditLog);

      res.json({
        success: true,
        message: 'Recovery request received. If the account exists, the ARIA access team will review it and follow up.',
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/auth/me', jwtAuth, (req, res) => {
    const csrfToken = req.cookies?.csrf_token || issueCsrfToken(res);
    res.json({ user: req.user, csrfToken, stepUpActive: !!req.cookies?.step_up });
  });

  app.post('/auth/step-up', csrfGuard, jwtAuth, async (req, res) => {
    try {
      const { password, action } = req.body || {};
      if (!password) return res.status(400).json({ error: 'Password is required' });

      let valid = false;
      if (req.user.role === 'ADMIN' && req.user.isRootAdmin) {
        const adminHash = process.env.ADMIN_PASSWORD_HASH;
        valid = !!adminHash && bcrypt.compareSync(password, adminHash);
      } else {
        valid = await validateUserPassword({ userId: req.user.userId, password });
      }

      if (!valid) {
        await recordSecurityEvent({
          title: 'Step-up authentication failed',
          actor: req.user.userId,
          action: action || 'unknown',
          status: 'DENIED',
          detail: `Step-up failed for role ${req.user.role}`,
        }, req.user.companyId, appendToAuditLog);
        return res.status(401).json({ error: 'Invalid password' });
      }

      issueStepUpToken(res, req.user);
      await recordSecurityEvent({
        title: 'Step-up authentication granted',
        actor: req.user.userId,
        action: action || 'unknown',
        status: 'OK',
        detail: `Step-up granted for role ${req.user.role}`,
      }, req.user.companyId, appendToAuditLog);
      res.json({ success: true, stepUpActive: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/auth/logout', csrfGuard, (req, res) => {
    res.clearCookie('token', authCookieOptions());
    res.clearCookie('csrf_token', csrfCookieOptions());
    clearStepUpToken(res);
    res.json({ success: true });
  });

  app.get('/admin/users', jwtAuth, requirePermission('admin.users.read'), async (req, res) => {
    try {
      res.json(await getUsers());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/admin/companies', jwtAuth, requirePermission('admin.companies.read'), async (req, res) => {
    try {
      res.json(await getCompanies());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/admin/users/:id/status', jwtAuth, requirePermission('admin.users.update'), csrfGuard, async (req, res) => {
    try {
      const { status } = req.body;
      if (!['APPROVED', 'REJECTED', 'SUSPENDED'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
      }
      await updateUserStatus(req.params.id, status, req.user.userId);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/admin/users/:id/role', jwtAuth, requirePermission('admin.users.update'), csrfGuard, async (req, res) => {
    try {
      const { role } = req.body || {};
      const updated = await updateUserRole(req.params.id, role, req.user.userId);
      res.json({ success: true, user: updated });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/admin/users/:id/password', jwtAuth, requirePermission('admin.users.update'), csrfGuard, requireRecentStepUp, async (req, res) => {
    try {
      const password = String(req.body?.password || '');
      const updated = await updateUserPassword(req.params.id, password, req.user.userId);
      await appendToAuditLog({
        companyId: req.user.companyId,
        timestamp: new Date().toISOString(),
        action: 'ADMIN_PASSWORD_RESET',
        details: `Password reset by admin ${req.user.userId} for ${updated.username || updated.email || req.params.id}.`,
        layer: 'SECURITY',
        status: 'OK',
      }, req.user.companyId).catch(() => {});
      res.json({ success: true, user: updated });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/admin/stats', jwtAuth, requirePermission('admin.stats.read'), async (req, res) => {
    try {
      const [ledger, holdQueue, memoryRows, journalEntries, users, companies, auditLog] = await Promise.all([
        getLedger(),
        getHoldQueue(),
        getARIAMemory(),
        getARIAJournal(),
        getUsers(),
        getCompanies(),
        getAuditLog(),
      ]);
      const count = ledger.length;
      const level = count >= 500 ? 'ADVANCED' : count >= 200 ? 'MATURE' : count >= 50 ? 'DEVELOPING' : count >= 10 ? 'LEARNING' : 'INFANT';
      const lastJournal = journalEntries[0] || null;
      const lastMemory = memoryRows[memoryRows.length - 1] || null;

      res.json({
        aria: {
          level,
          transactionCount: count,
          memoryCount: memoryRows.length,
          journalCount: journalEntries.length,
          lastJournalTitle: lastJournal?.Title || lastJournal?.title || null,
          lastJournalDate: lastJournal?.Timestamp || lastJournal?.timestamp || null,
          lastConversation: lastMemory?.Timestamp || lastMemory?.timestamp || null,
          heldTransactions: holdQueue.filter((h) => h.Status === 'PENDING_CFO_REVIEW').length,
        },
        users: {
          total: users.length,
          pending: users.filter((u) => u.status === 'PENDING').length,
          approved: users.filter((u) => u.status === 'APPROVED').length,
          rejected: users.filter((u) => u.status === 'REJECTED').length,
        },
        companies: {
          total: companies.length,
          pending: companies.filter((c) => c.status === 'PENDING').length,
          approved: companies.filter((c) => c.status === 'APPROVED').length,
        },
        integrations: summarizeIntegrationHealth(companies),
        system: {
          uptime: Math.floor(process.uptime()),
          nodeVersion: process.version,
          timestamp: new Date().toISOString(),
        },
        security: summarizeSecurityEvents(auditLog),
      });
    } catch (err) {
      console.error('Admin stats error:', err.message, err.stack);
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/admin/journal', jwtAuth, requirePermission('admin.journal.read'), async (req, res) => {
    try {
      res.json(await getARIAJournal());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/admin/security-events', jwtAuth, requirePermission('admin.stats.read'), async (req, res) => {
    try {
      const auditLog = await getAuditLog();
      const securityRows = auditLog
        .filter((row) => (row.Layer || row.layer) === 'SECURITY')
        .reverse()
        .slice(0, 100);
      res.json({ summary: summarizeSecurityEvents(auditLog), events: securityRows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/admin/integration-events', jwtAuth, requirePermission('admin.stats.read'), async (req, res) => {
    try {
      const companies = await getCompanies();
      const events = companies
        .filter((company) => company.integration_status || company.integration_last_event_at || company.last_webhook_at)
        .map((company) => ({
          companyId: company.id,
          companyName: company.company_name,
          provider: company.integration_provider_profile || company.provider || 'custom',
          mode: company.integration_mode || 'backend',
          status: company.integration_status || 'disconnected',
          trustScore: Number(company.integration_trust_score || 0),
          lastEventAt: company.integration_last_event_at || company.last_webhook_at || null,
          lastEventSource: company.integration_last_event_source || null,
          lastEventStatus: company.integration_last_event_status || null,
          lastEventDetail: company.integration_last_event_detail || null,
          failures24h: Number(company.integration_failures_24h || 0),
          duplicateEvents: Number(company.integration_duplicate_events || 0),
          eventsTotal: Number(company.integration_events_total || 0),
          quarantined: Boolean(company.integration_quarantined),
          quarantineReason: company.integration_quarantine_reason || null,
          quarantinedAt: company.integration_quarantined_at || null,
          driftEvents: Number(company.integration_drift_events || 0),
          lastDriftAt: company.integration_last_drift_at || null,
          lastDriftReason: company.integration_last_drift_reason || null,
        }))
        .sort((left, right) => {
          const a = new Date(right.lastEventAt || 0).getTime();
          const b = new Date(left.lastEventAt || 0).getTime();
          return a - b;
        })
        .slice(0, 100);

      res.json({
        summary: summarizeIntegrationHealth(companies),
        providers: summarizeProviderDiagnostics(companies),
        events,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/admin/integration-events/:companyId/quarantine', jwtAuth, requirePermission('admin.users.update'), csrfGuard, requireRecentStepUp, async (req, res) => {
    try {
      const companyId = req.params.companyId;
      const reason = String(req.body?.reason || '').trim() || 'Locked by ARIA operator.';
      const patch = {
        integration_quarantined: true,
        integration_quarantine_reason: reason,
        integration_quarantined_at: new Date().toISOString(),
        integration_status: 'quarantined',
      };
      const { error } = await sb.from('helixxi_companies').update(patch).eq('id', companyId);
      if (error) throw error;

      await appendToAuditLog({
        companyId,
        timestamp: new Date().toISOString(),
        action: 'INTEGRATION_QUARANTINE',
        details: `Integration lane quarantined by admin ${req.user.userId}. ${reason}`,
        layer: 'SECURITY',
        status: 'LOCKED',
      }, companyId).catch(() => {});

      res.json({ success: true, quarantined: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/admin/integration-events/:companyId/unquarantine', jwtAuth, requirePermission('admin.users.update'), csrfGuard, requireRecentStepUp, async (req, res) => {
    try {
      const companyId = req.params.companyId;
      const patch = {
        integration_quarantined: false,
        integration_quarantine_reason: null,
        integration_quarantined_at: null,
        integration_status: 'connected',
      };
      const { error } = await sb.from('helixxi_companies').update(patch).eq('id', companyId);
      if (error) throw error;

      await appendToAuditLog({
        companyId,
        timestamp: new Date().toISOString(),
        action: 'INTEGRATION_UNQUARANTINE',
        details: `Integration lane restored by admin ${req.user.userId}.`,
        layer: 'SECURITY',
        status: 'RESTORED',
      }, companyId).catch(() => {});

      res.json({ success: true, quarantined: false });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/admin/integration-events/:companyId/clear-failures', jwtAuth, requirePermission('admin.users.update'), csrfGuard, requireRecentStepUp, async (req, res) => {
    try {
      const companyId = req.params.companyId;
      const reason = String(req.body?.reason || '').trim() || 'Failures cleared by ARIA operator.';
      const patch = {
        integration_failures_24h: 0,
        integration_status: 'connected',
      };
      const { error } = await sb.from('helixxi_companies').update(patch).eq('id', companyId);
      if (error) throw error;

      await appendToAuditLog({
        companyId,
        timestamp: new Date().toISOString(),
        action: 'INTEGRATION_CLEAR_FAILURES',
        details: `Integration failures cleared by admin ${req.user.userId}. ${reason}`,
        layer: 'SECURITY',
        status: 'RESTORED',
      }, companyId).catch(() => {});

      res.json({ success: true, cleared: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/admin/integration-events/:companyId/backfill', jwtAuth, requirePermission('admin.users.update'), csrfGuard, requireRecentStepUp, async (req, res) => {
    try {
      const companyId = req.params.companyId;
      const pending = await getTransactions(companyId);
      let processed = 0;
      let failed = 0;

      for (const tx of pending) {
        const result = await ingestTransaction(tx, companyId);
        if (result?.success) processed += 1;
        else failed += 1;
      }

      await appendToAuditLog({
        companyId,
        timestamp: new Date().toISOString(),
        action: 'INTEGRATION_BACKFILL',
        details: `Admin backfill executed. processed=${processed} failed=${failed}`,
        layer: 'SECURITY',
        status: failed > 0 ? 'WARN' : 'OK',
      }, companyId).catch(() => {});

      res.json({ success: true, processed, failed });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = { registerAuthAdminRoutes };
