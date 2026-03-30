const express = require('express');
const {
  updateCompanyWithOptionalColumns,
  getClientIp,
  buildTrustProfile,
  buildSecurityGuardrails,
  normalizeExpectedInbound,
  evaluateIntegrationDrift,
  buildProviderBlueprints,
  buildProviderCatalog,
  loadRecentInboundEvents,
  recordIntegrationActivity,
} = require('./integrationService');

function registerIntegrationRoutes(app, deps) {
  const {
    INBOUND_REPLAY_WINDOW_MS,
    appendToAuditLog,
    buildInboundEventKey,
    claimInboundEvent,
    csrfGuard,
    decryptSecret,
    enforceReplayWindow,
    encryptSecret,
    generateCredential,
    getHostUrl,
    hashPayload,
    hashSecret,
    ingestTransaction,
    isVaultConfigured,
    jwtAuth,
    maskSecret,
    normalizeWebhook,
    parseStripeSignature,
    requireCompanyContext,
    requirePermission,
    requireRecentStepUp,
    safeEqual,
    sb,
    sendFraudAlert,
    verifyProviderWebhook,
  } = deps;

  app.get('/api/integrations/settings', jwtAuth, requireCompanyContext, requirePermission('integrations.read'), async (req, res) => {
    try {
      const { data, error } = await sb
        .from('helixxi_companies')
        .select('*')
        .eq('id', req.user.companyId)
        .single();
      if (error) throw error;

      const publicId = data.webhook_public_id || `cmp_${String(data.id).slice(0, 8)}`;
      if (!data.webhook_public_id) {
        await sb.from('helixxi_companies').update({ webhook_public_id: publicId }).eq('id', req.user.companyId);
      }

      const hostUrl = getHostUrl(req);
      const trustProfile = buildTrustProfile(data);
      const guardrails = buildSecurityGuardrails(data, trustProfile);
      const recentInboundEvents = await loadRecentInboundEvents(sb, req.user.companyId);
      const selectedMode = data.integration_mode || 'backend';
      const selectedProvider = data.integration_provider_profile || data.provider || 'custom';
      const providerBlueprints = buildProviderBlueprints(hostUrl, publicId, selectedProvider, selectedMode);
      const providerCatalog = buildProviderCatalog(hostUrl, publicId, selectedProvider);

      res.json({
        company: {
          id: data.id,
          name: data.company_name,
          domain: data.domain,
        },
        integration: {
          companyPublicId: publicId,
          provider: data.provider || 'custom',
          status: (data.integration_status || 'disconnected').toUpperCase(),
          hasApiKey: !!data.api_key_hash,
          hasWebhookSecret: !!data.webhook_secret_hash,
          supportsTenantProviderSignatures: !!data.webhook_secret_ciphertext && isVaultConfigured(),
          vaultReady: isVaultConfigured(),
          lastWebhookAt: data.last_webhook_at || null,
          trustProfile,
          securityGuardrails: guardrails,
          recentInboundEvents,
          trustedBackendMode: !!data.webhook_secret_ciphertext && isVaultConfigured(),
          selectedMode,
          selectedProvider,
          expectedSource: data.integration_expected_source || null,
          telemetry: {
            lastEventStatus: data.integration_last_event_status || null,
            lastEventSource: data.integration_last_event_source || null,
            lastEventDetail: data.integration_last_event_detail || null,
            lastEventIp: data.integration_last_event_ip || null,
            lastProvider: data.integration_last_event_provider || null,
          },
          providerBlueprints,
          providerCatalog,
          directIngestUrl: `${hostUrl}/api/integrations/ingest`,
          signedIngestUrl: `${hostUrl}/api/integrations/ingest`,
          webhookUrl: `${hostUrl}/api/webhook/custom`,
          headerGuide: {
            companyIdHeader: 'x-company-id',
            apiKeyHeader: 'x-company-key',
            requestTimestampHeader: 'x-request-timestamp',
            customSignatureHeader: 'x-aria-signature',
          },
          verificationGuide: {
            custom: 'Trusted backend mode: send x-company-id, x-request-timestamp, and x-aria-signature where x-aria-signature is HMAC-SHA256(raw body, your webhook secret).',
            providers: 'Tenant webhooks can now use native provider signature headers when SECRET_VAULT_KEY is configured and the webhook secret has been rotated.',
          },
          securityPlaybook: [
            'Keep API keys and webhook secrets server-side only. Never expose them in frontend code.',
            'Include an idempotency key for every direct ingest event so retries cannot create duplicate finance records.',
            'Treat ARIA as a finance event receiver: send events from your backend or provider webhook account, not from the browser.',
            'Use trusted backend mode with signed payloads whenever your server can compute HMAC signatures.',
          ],
          testEndpoint: `${hostUrl}/api/integrations/test-ping`,
          connectPlaybook: {
            steps: [
              'Generate your company API key and webhook secret.',
              'Install one server-to-server event path from your product, billing stack, or internal ops scripts.',
              'Send a test transaction into ARIA and confirm it appears in the ledger or hold queue.',
            ],
            channels: [
              {
                id: 'backend',
                title: 'Website / App Backend',
                fit: 'Best for product-led SaaS and marketplaces',
                summary: 'Send revenue, refunds, and operational spend from your server whenever money moves inside your app.',
              },
              {
                id: 'payments',
                title: 'Payment Processor Account',
                fit: 'Best for Stripe, Paystack, Flutterwave, Monnify, and Square',
                summary: 'Forward provider webhook events into ARIA so finance sees the same payment activity your billing stack sees.',
              },
              {
                id: 'ops',
                title: 'Internal Ops Scripts',
                fit: 'Best for RevOps, FinanceOps, and ERP sync jobs',
                summary: 'Push scheduled journal, invoice, or vendor events from cron jobs, ETL jobs, or internal tools.',
              },
            ],
            snippets: {
              backend: `const body = JSON.stringify({\n  vendor: 'Customer Checkout',\n  amount: order.total,\n  currency: 'USD',\n  category: 'Revenue',\n  description: \`Order \${order.id}\`,\n});\n\nawait fetch('${hostUrl}/api/integrations/ingest', {\n  method: 'POST',\n  headers: {\n    'Content-Type': 'application/json',\n    'x-company-id': '${publicId}',\n    'x-company-key': '<your api key>',\n    'x-idempotency-key': order.id,\n  },\n  body,\n});`,
              signedBackend: `const body = JSON.stringify({\n  vendor: 'Customer Checkout',\n  amount: order.total,\n  currency: 'USD',\n  category: 'Revenue',\n  description: \`Order \${order.id}\`,\n});\nconst timestamp = new Date().toISOString();\nconst signature = crypto\n  .createHmac('sha256', process.env.ARIA_WEBHOOK_SECRET)\n  .update(body)\n  .digest('hex');\n\nawait fetch('${hostUrl}/api/integrations/ingest', {\n  method: 'POST',\n  headers: {\n    'Content-Type': 'application/json',\n    'x-company-id': '${publicId}',\n    'x-request-timestamp': timestamp,\n    'x-idempotency-key': order.id,\n    'x-aria-signature': signature,\n  },\n  body,\n});`,
              webhook: `POST ${hostUrl}/api/webhook/custom\nx-company-id: ${publicId}\nx-aria-signature: <hmac sha256 raw body>\n\n{ "vendor": "Stripe", "amount": 2499, "currency": "USD", "description": "Subscription payment" }`,
            },
          },
        },
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/integrations/credentials/rotate', csrfGuard, jwtAuth, requireCompanyContext, requireRecentStepUp, requirePermission('integrations.rotate'), async (req, res) => {
    try {
      const kind = req.body?.kind;
      if (!['api', 'webhook'].includes(kind)) {
        return res.status(400).json({ error: 'kind must be api or webhook' });
      }
      if (kind === 'webhook' && !isVaultConfigured()) {
        return res.status(503).json({ error: 'Webhook vault is not configured. Set SECRET_VAULT_KEY before rotating tenant webhook secrets.' });
      }

      const plainSecret = kind === 'api'
        ? generateCredential('aria_live')
        : generateCredential('aria_whsec');
      const secretHash = hashSecret(plainSecret);
      const secretCiphertext = kind === 'webhook' ? encryptSecret(plainSecret) : null;
      const update = kind === 'api'
        ? { api_key_hash: secretHash, integration_status: 'connected' }
        : { webhook_secret_hash: secretHash, webhook_secret_ciphertext: secretCiphertext, integration_status: 'connected' };

      const { data: company, error } = await sb
        .from('helixxi_companies')
        .update(update)
        .eq('id', req.user.companyId)
        .select('company_name, webhook_public_id')
        .single();
      if (error) throw error;

      const publicId = company.webhook_public_id || `cmp_${String(req.user.companyId).slice(0, 8)}`;
      if (!company.webhook_public_id) {
        await sb.from('helixxi_companies').update({ webhook_public_id: publicId }).eq('id', req.user.companyId);
      }

      await recordIntegrationActivity(sb, req.user.companyId, {
        source: kind === 'api' ? 'credential_api' : 'credential_webhook',
        status: 'VERIFIED',
        detail: `${kind === 'api' ? 'API key' : 'Webhook secret'} rotated by operator`,
        provider: kind === 'api' ? 'direct_ingest' : 'custom_webhook',
        ip: getClientIp(req),
        countEvent: false,
        touchLastWebhookAt: false,
        boost: 4,
        integrationStatus: 'connected',
      });

      res.json({
        success: true,
        kind,
        companyPublicId: publicId,
        value: plainSecret,
        masked: maskSecret(plainSecret),
        warning: 'Store this secret now. ARIA will not show the full value again.',
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/integrations/profile', csrfGuard, jwtAuth, requireCompanyContext, requireRecentStepUp, requirePermission('integrations.rotate'), async (req, res) => {
    try {
      const provider = String(req.body?.provider || 'custom').toLowerCase();
      const mode = String(req.body?.mode || 'backend').toLowerCase();
      const expectedSource = String(req.body?.expectedSource || '').trim() || null;

      if (!['custom', 'stripe', 'paystack', 'flutterwave', 'monnify', 'square', 'aggregator'].includes(provider)) {
        return res.status(400).json({ error: 'Unsupported provider profile' });
      }
      if (!['backend', 'payments', 'bank'].includes(mode)) {
        return res.status(400).json({ error: 'Unsupported integration mode' });
      }

      await updateCompanyWithOptionalColumns(sb, req.user.companyId, {
        provider,
        integration_mode: mode,
        integration_provider_profile: provider,
        integration_expected_source: expectedSource || (mode === 'bank' ? 'aggregator' : mode === 'payments' ? 'provider_webhook' : 'signed_backend'),
        integration_status: 'connected',
      });

      await recordIntegrationActivity(sb, req.user.companyId, {
        source: 'integration_profile',
        status: 'VERIFIED',
        detail: `Integration path set to ${mode} using ${provider}.`,
        provider,
        ip: getClientIp(req),
        countEvent: false,
        touchLastWebhookAt: false,
        boost: 3,
        integrationStatus: 'connected',
      });

      res.json({ success: true, provider, mode });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/integrations/ingest', csrfGuard, async (req, res) => {
    try {
      const publicId = req.headers['x-company-id'];
      const key = req.headers['x-company-key'];
      const signature = req.headers['x-aria-signature'];
      const timestampHeader = req.headers['x-request-timestamp'] || req.headers['x-timestamp'];
      const idempotencyKey = req.headers['x-idempotency-key'] || req.body?._externalId || req.body?.externalId;
      if (!publicId || (!key && !signature)) {
        return res.status(401).json({ error: 'x-company-id and either x-company-key or x-aria-signature are required' });
      }

      const { data: company, error } = await sb
        .from('helixxi_companies')
        .select('*')
        .eq('webhook_public_id', publicId)
        .single();
      if (error || !company) {
        return res.status(401).json({ error: 'Invalid company credentials' });
      }

      const rawBody = req.rawBody || JSON.stringify(req.body || {});
      let authMode = 'api_key';
      const inboundIp = getClientIp(req);

      if (signature) {
        if (!company.webhook_secret_ciphertext || !isVaultConfigured()) {
          await recordIntegrationActivity(sb, company.id, {
            source: 'direct_ingest',
            status: 'FAILED',
            detail: 'Signed ingest attempted before trusted backend mode was fully configured.',
            provider: 'direct_ingest_signed',
            ip: inboundIp,
            penalty: 8,
            integrationStatus: 'watch',
          });
          return res.status(503).json({ error: 'Trusted backend mode requires a rotated webhook secret and SECRET_VAULT_KEY.' });
        }

        const tenantSecret = decryptSecret(company.webhook_secret_ciphertext);
        const signatureCheck = verifyProviderWebhook({
          processor: 'custom',
          req,
          rawBody,
          secret: tenantSecret,
        });
        if (!signatureCheck.ok) {
          await recordIntegrationActivity(sb, company.id, {
            source: 'direct_ingest',
            status: 'FAILED',
            detail: signatureCheck.error,
            provider: 'direct_ingest_signed',
            ip: inboundIp,
            penalty: 16,
            integrationStatus: 'watch',
          });
          return res.status(401).json({ error: signatureCheck.error });
        }

        authMode = 'signed_backend';
      } else if (!company.api_key_hash || hashSecret(key) !== company.api_key_hash) {
        await recordIntegrationActivity(sb, company.id, {
          source: 'direct_ingest',
          status: 'FAILED',
          detail: 'Direct ingest rejected because the API key did not match.',
          provider: 'direct_ingest',
          ip: inboundIp,
          penalty: 14,
          integrationStatus: 'watch',
        });
        return res.status(401).json({ error: 'Invalid company credentials' });
      }

      const drift = evaluateIntegrationDrift(company, {
        source: 'direct_ingest',
        expectedSource: signature ? 'signed_backend' : 'direct_ingest',
        provider: signature ? 'direct_ingest_signed' : 'direct_ingest',
        ip: inboundIp,
      });
      if (drift.blocked) {
        await recordIntegrationActivity(sb, company.id, {
          source: 'direct_ingest',
          status: 'FAILED',
          detail: drift.reason,
          provider: signature ? 'direct_ingest_signed' : 'direct_ingest',
          ip: inboundIp,
          penalty: 6,
          integrationStatus: 'quarantined',
        });
        return res.status(drift.statusCode).json({ error: drift.reason });
      }
      if (drift.reasons.length) {
        await recordIntegrationActivity(sb, company.id, {
          source: 'direct_ingest',
          status: 'FAILED',
          detail: drift.reasons.join(' '),
          provider: signature ? 'direct_ingest_signed' : 'direct_ingest',
          ip: inboundIp,
          penalty: 8,
          drift: true,
          driftPenalty: drift.autoQuarantine ? 15 : 9,
          driftReason: drift.reasons.join(' '),
          quarantine: drift.autoQuarantine,
          quarantineReason: drift.autoQuarantine ? `ARIA auto-quarantined this lane after drift: ${drift.reasons[0]}` : null,
          integrationStatus: drift.autoQuarantine ? 'quarantined' : 'watch',
        });
        return res.status(drift.autoQuarantine ? 423 : drift.statusCode).json({
          error: drift.autoQuarantine ? 'Integration lane auto-quarantined after trust drift.' : drift.reasons[0],
        });
      }

      const replayCheck = enforceReplayWindow(timestampHeader);
      if (!replayCheck.ok) {
        await recordIntegrationActivity(sb, company.id, {
          source: 'direct_ingest',
          status: 'FAILED',
          detail: replayCheck.error,
          provider: 'direct_ingest',
          ip: inboundIp,
          penalty: 10,
          integrationStatus: 'watch',
        });
        return res.status(409).json({ error: replayCheck.error });
      }

      const payloadHash = hashPayload(rawBody);
      const eventKey = buildInboundEventKey({
        source: 'direct_ingest',
        companyId: company.id,
        externalId: idempotencyKey,
        payloadHash,
      });
      const inboundClaim = await claimInboundEvent({
        eventKey,
        companyId: company.id,
        source: 'direct_ingest',
        payloadHash,
        receivedAt: replayCheck.timestamp,
        expiresAt: new Date(Date.now() + INBOUND_REPLAY_WINDOW_MS).toISOString(),
        metadata: { publicId, hasIdempotencyKey: !!idempotencyKey },
      });
      if (!inboundClaim.accepted) {
        await recordIntegrationActivity(sb, company.id, {
          source: 'direct_ingest',
          status: 'VERIFIED',
          detail: 'Duplicate inbound event safely ignored.',
          provider: 'direct_ingest',
          ip: inboundIp,
          duplicate: true,
          countEvent: false,
          integrationStatus: 'connected',
        });
        return res.json({ received: true, processed: false, duplicate: true, reason: 'Duplicate inbound event' });
      }

      const tx = { ...req.body, companyId: company.id };
      const result = await ingestTransaction(tx, company.id);
      await recordIntegrationActivity(sb, company.id, {
        source: 'direct_ingest',
        status: 'VERIFIED',
        detail: idempotencyKey
          ? `Direct ingest event verified and accepted via ${authMode}.`
          : `Direct ingest event accepted via ${authMode} without an idempotency key.`,
        provider: authMode,
        ip: inboundIp,
        missingIdempotencyKey: !idempotencyKey,
        boost: authMode === 'signed_backend' ? (idempotencyKey ? 12 : 9) : (idempotencyKey ? 8 : 5),
        integrationStatus: 'connected',
        touchLastWebhookAt: true,
      });

      res.json({ success: true, company: company.company_name, result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/integrations/test-ping', csrfGuard, jwtAuth, requireCompanyContext, requirePermission('transactions.submit'), async (req, res) => {
    try {
      const { data: company, error } = await sb
        .from('helixxi_companies')
        .select('company_name, domain')
        .eq('id', req.user.companyId)
        .single();
      if (error) throw error;

      const timestamp = new Date().toISOString();
      const tx = {
        Vendor: `${company.company_name || 'Company'} Website`,
        Amount: 149,
        Currency: 'USD',
        Category: 'Revenue',
        Description: `ARIA connect test ping from ${company.domain || 'business account'} at ${timestamp}`,
        Entity: company.company_name || 'Connected Business',
        Date: timestamp.slice(0, 10),
        _externalId: `connect-test-${req.user.companyId}-${Date.now()}`,
        Source: 'ARIA_CONNECT_TEST',
      };

      const result = await ingestTransaction(tx, req.user.companyId);
      await appendToAuditLog({
        companyId: req.user.companyId,
        timestamp,
        action: 'INTEGRATION_TEST_PING',
        details: `Business connection test executed by user ${req.user.userId}`,
        layer: 'ARIA_CONNECT',
        status: result?.status || 'OK',
      }, req.user.companyId).catch(() => {});

      await recordIntegrationActivity(sb, req.user.companyId, {
        source: 'test_ping',
        status: 'VERIFIED',
        detail: 'Operator test ping completed successfully.',
        provider: 'direct_ingest',
        ip: getClientIp(req),
        isTest: true,
        countEvent: false,
        boost: 6,
        integrationStatus: 'connected',
        touchLastWebhookAt: false,
      });

      res.json({
        success: true,
        message: 'ARIA received the business test ping.',
        tx,
        result,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/webhook/:processor', express.raw({ type: '*/*' }), async (req, res) => {
    try {
      const processor = req.params.processor.toLowerCase();
      const secret = req.headers['x-webhook-secret'] || req.headers['x-api-key'];
      const publicId = req.headers['x-company-id'];
      const timestampHeader = req.headers['x-request-timestamp'] || req.headers['x-timestamp'];
      const rawBody = req.body.toString();
      const inboundIp = getClientIp(req);

      const expectedSecret = process.env[`WEBHOOK_SECRET_${processor.toUpperCase()}`] || process.env.WEBHOOK_SECRET;

      let webhookCompanyId = null;
      if (publicId) {
        const { data: company } = await sb
          .from('helixxi_companies')
          .select('*')
          .eq('webhook_public_id', publicId)
          .single()
          .catch(() => ({ data: null }));
        if (!company || !company.webhook_secret_hash) {
          return res.status(401).json({ error: 'Invalid webhook secret' });
        }

        if (company.webhook_secret_ciphertext && isVaultConfigured()) {
          const tenantSecret = decryptSecret(company.webhook_secret_ciphertext);
          const verification = verifyProviderWebhook({ processor, req, rawBody, secret: tenantSecret });
          if (!verification.ok) {
            await recordIntegrationActivity(sb, company.id, {
              source: `webhook_${processor}`,
              status: 'FAILED',
              detail: verification.error,
              provider: processor,
              ip: inboundIp,
              penalty: 14,
              integrationStatus: 'watch',
            });
            return res.status(401).json({ error: verification.error });
          }
        } else if (!safeEqual(hashSecret(secret || ''), company.webhook_secret_hash)) {
          await recordIntegrationActivity(sb, company.id, {
            source: `webhook_${processor}`,
            status: 'FAILED',
            detail: 'Webhook secret mismatch.',
            provider: processor,
            ip: inboundIp,
            penalty: 14,
            integrationStatus: 'watch',
          });
          return res.status(401).json({ error: 'Invalid webhook secret' });
        }
        webhookCompanyId = company.id;
        const drift = evaluateIntegrationDrift(company, {
          source: `webhook_${processor}`,
          expectedSource: 'provider_webhook',
          provider: processor,
          ip: inboundIp,
        });
        if (drift.blocked) {
          await recordIntegrationActivity(sb, company.id, {
            source: `webhook_${processor}`,
            status: 'FAILED',
            detail: drift.reason,
            provider: processor,
            ip: inboundIp,
            penalty: 6,
            integrationStatus: 'quarantined',
          });
          return res.status(drift.statusCode).json({ error: drift.reason });
        }
        if (drift.reasons.length) {
          await recordIntegrationActivity(sb, company.id, {
            source: `webhook_${processor}`,
            status: 'FAILED',
            detail: drift.reasons.join(' '),
            provider: processor,
            ip: inboundIp,
            penalty: 8,
            drift: true,
            driftPenalty: drift.autoQuarantine ? 15 : 9,
            driftReason: drift.reasons.join(' '),
            quarantine: drift.autoQuarantine,
            quarantineReason: drift.autoQuarantine ? `ARIA auto-quarantined this lane after drift: ${drift.reasons[0]}` : null,
            integrationStatus: drift.autoQuarantine ? 'quarantined' : 'watch',
          });
          return res.status(drift.autoQuarantine ? 423 : drift.statusCode).json({
            error: drift.autoQuarantine ? 'Integration lane auto-quarantined after trust drift.' : drift.reasons[0],
          });
        }
      } else {
        const verification = verifyProviderWebhook({ processor, req, rawBody, secret: expectedSecret });
        if (!verification.ok) {
          return res.status(401).json({ error: verification.error });
        }
      }

      let payload;
      try {
        payload = JSON.parse(rawBody);
      } catch {
        return res.status(400).json({ error: 'Invalid JSON payload' });
      }

      const tx = normalizeWebhook(processor, payload);
      if (!tx) {
        return res.json({ received: true, processed: false, reason: 'Event type not actionable' });
      }

      webhookCompanyId =
        webhookCompanyId ||
        tx.companyId ||
        payload.companyId ||
        payload?.metadata?.companyId ||
        payload?.data?.metadata?.companyId ||
        null;

      const verifiedStripeTimestamp = processor === 'stripe'
        ? parseStripeSignature(req.headers['stripe-signature'])?.t
        : null;
      const replayCheck = enforceReplayWindow(timestampHeader || verifiedStripeTimestamp);
      if (!replayCheck.ok) {
        await recordIntegrationActivity(sb, webhookCompanyId, {
          source: `webhook_${processor}`,
          status: 'FAILED',
          detail: replayCheck.error,
          provider: processor,
          ip: inboundIp,
          penalty: 10,
          integrationStatus: 'watch',
        });
        return res.status(409).json({ error: replayCheck.error });
      }

      const externalId =
        req.headers['x-event-id'] ||
        payload.id ||
        payload.event_id ||
        payload.reference ||
        payload.data?.id ||
        payload.data?.reference ||
        payload.data?.object?.id ||
        payload.eventId ||
        tx._externalId ||
        null;
      const payloadHash = hashPayload(rawBody);
      const eventKey = buildInboundEventKey({
        source: `webhook_${processor}`,
        companyId: webhookCompanyId,
        externalId,
        payloadHash,
      });
      const inboundClaim = await claimInboundEvent({
        eventKey,
        companyId: webhookCompanyId,
        source: `webhook_${processor}`,
        payloadHash,
        receivedAt: replayCheck.timestamp,
        expiresAt: new Date(Date.now() + INBOUND_REPLAY_WINDOW_MS).toISOString(),
        metadata: { publicId: publicId || null, processor, externalId: externalId || null },
      });
      if (!inboundClaim.accepted) {
        await recordIntegrationActivity(sb, webhookCompanyId, {
          source: `webhook_${processor}`,
          status: 'VERIFIED',
          detail: 'Duplicate provider webhook safely ignored.',
          provider: processor,
          ip: inboundIp,
          duplicate: true,
          countEvent: false,
          integrationStatus: 'connected',
        });
        return res.json({ received: true, processed: false, duplicate: true, reason: 'Duplicate inbound event' });
      }

      const result = await ingestTransaction(tx, webhookCompanyId);
      await recordIntegrationActivity(sb, webhookCompanyId, {
        source: `webhook_${processor}`,
        status: 'VERIFIED',
        detail: `Provider webhook verified and accepted from ${processor}.`,
        provider: processor,
        ip: inboundIp,
        boost: 9,
        integrationStatus: 'connected',
        touchLastWebhookAt: true,
      });

      if (result.success && result.status === 'PENDING_CFO_REVIEW') {
        sendFraudAlert(result).catch(() => {});
      }

      console.log(`Webhook [${processor}]: ${tx.Vendor} ${tx.Currency} ${tx.Amount} -> ${result.status || 'processed'}`);
      res.json({ received: true, processed: true, hxid: result.HXID, status: result.status });
    } catch (err) {
      console.error('Webhook error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = { registerIntegrationRoutes };
