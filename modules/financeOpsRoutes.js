function registerFinanceOpsRoutes(app, deps) {
  const {
    appendToARIAJournal,
    buildFinanceIntelligence,
    buildForecastFromLedger,
    csrfGuard,
    getARIAJournal,
    getAuditLog,
    getForecasts,
    getFreezeLog,
    getHoldQueue,
    getLedger,
    getOnboardingContext,
    ingestTransaction,
    jwtAuth,
    requireCompanyContext,
    requirePermission,
    requireRecentStepUp,
    runForecast,
    runReconciliation,
    sb,
    sendFraudAlert,
    updateHoldDecision,
  } = deps;

  app.post('/api/transactions', csrfGuard, jwtAuth, requirePermission('transactions.submit'), async (req, res) => {
    try {
      const result = await ingestTransaction(req.body, req.user.companyId);
      if (result.success && result.status === 'PENDING_CFO_REVIEW') {
        const { data: ob } = await sb
          .from('helixxi_onboarding')
          .select('cfo_email')
          .eq('user_id', req.user.userId)
          .single()
          .catch(() => ({ data: null }));
        sendFraudAlert(result, ob?.cfo_email).catch(() => {});
      }
      res.json({ success: true, result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/transactions', jwtAuth, requirePermission('ledger.read'), async (req, res) => {
    try {
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
      const all = await getLedger(req.user.companyId);
      const total = all.length;
      const data = all.slice((page - 1) * limit, page * limit);
      res.json({ data, total, page, limit, pages: Math.ceil(total / limit) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/holdqueue', jwtAuth, requirePermission('holdqueue.read'), async (req, res) => {
    try {
      res.json(await getHoldQueue(req.user.companyId));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/holdqueue/:hxid/decision', csrfGuard, jwtAuth, requireCompanyContext, requireRecentStepUp, requirePermission('holdqueue.approve'), async (req, res) => {
    try {
      const { hxid } = req.params;
      const { decision, cfoName } = req.body;
      if (!['APPROVE', 'REJECT'].includes(decision)) {
        return res.status(400).json({ error: 'decision must be APPROVE or REJECT' });
      }
      await updateHoldDecision(hxid, decision, cfoName || 'CFO', req.user.companyId);
      res.json({ success: true, hxid, decision });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/forecasts', jwtAuth, requirePermission('forecast.read'), async (req, res) => {
    try {
      const [forecasts, ledger, budgetContext] = await Promise.all([
        getForecasts(req.user.companyId),
        getLedger(req.user.companyId),
        getOnboardingContext(sb, req.user),
      ]);
      const runtime = buildForecastFromLedger(ledger, {
        openingCashBalance: parseFloat(budgetContext?.opening_cash_balance || budgetContext?.openingCashBalance || 0) || 0,
      });
      if (!runtime) return res.json(forecasts);
      if (!forecasts.length) return res.json([runtime]);

      const merged = [...forecasts];
      merged[merged.length - 1] = {
        ...merged[merged.length - 1],
        Metadata: runtime.Metadata,
      };
      res.json(merged);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/forecasts/run', csrfGuard, jwtAuth, requireCompanyContext, requireRecentStepUp, requirePermission('forecast.run'), async (req, res) => {
    try {
      const onboarding = await getOnboardingContext(sb, req.user);
      const result = await runForecast(req.user.companyId, {
        openingCashBalance: parseFloat(onboarding?.opening_cash_balance || onboarding?.openingCashBalance || 0) || 0,
      });
      if (!result) {
        return res.status(400).json({ error: 'ARIA needs posted ledger history before it can generate a forecast.' });
      }
      res.json({ success: true, result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/auditlog', jwtAuth, requirePermission('audit.read'), async (req, res) => {
    try {
      res.json((await getAuditLog(req.user.companyId)).reverse());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/freezelog', jwtAuth, requirePermission('admin.freezelog.read'), async (req, res) => {
    try {
      res.json(await getFreezeLog());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/reconcile', csrfGuard, jwtAuth, requireCompanyContext, requireRecentStepUp, requirePermission('reconcile.run'), async (req, res) => {
    try {
      res.json({ success: true, result: await runReconciliation(req.user.companyId) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/admin/system/shutdown', jwtAuth, requireRecentStepUp, requirePermission('admin.system.shutdown'), csrfGuard, async (req, res) => {
    console.log('\n\u26a0\ufe0f  ARIA: Kill switch activated. Shutting down...');
    res.json({ success: true, message: 'ARIA shutting down' });
    setTimeout(() => process.exit(0), 1000);
  });

  app.delete('/api/auditlog', (req, res) => {
    res.status(403).json({ error: 'Audit log is immutable' });
  });

  app.post('/api/journal', csrfGuard, jwtAuth, requirePermission('journal.write'), async (req, res) => {
    try {
      const { title, content } = req.body;
      if (!content) return res.status(400).json({ error: 'content required' });
      await appendToARIAJournal({
        timestamp: new Date().toISOString(),
        title: title || 'Untitled',
        content,
        companyId: req.user.companyId,
      }, req.user.companyId);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/journal', jwtAuth, requireCompanyContext, requirePermission('journal.read'), async (req, res) => {
    try {
      res.json(await getARIAJournal(req.user.companyId));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = { registerFinanceOpsRoutes };
