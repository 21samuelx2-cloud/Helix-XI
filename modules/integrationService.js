// modules/integrationService.js
// Orchestration helpers extracted from integrationRoutes.js
// Owns: trust scoring, drift detection, provider catalog, telemetry, data-layer helpers

// --- Data-layer helpers ---
const INTEGRATION_OPTIONAL_COLUMNS = [
  'integration_trust_score',
  'integration_events_total',
  'integration_duplicate_events',
  'integration_failures_24h',
  'integration_last_event_at',
  'integration_last_event_source',
  'integration_last_event_status',
  'integration_last_event_detail',
  'integration_last_event_ip',
  'integration_last_event_provider',
  'integration_last_test_at',
  'integration_last_test_status',
  'integration_mode',
  'integration_provider_profile',
  'integration_expected_source',
  'integration_quarantined',
  'integration_quarantine_reason',
  'integration_quarantined_at',
  'integration_last_drift_at',
  'integration_last_drift_reason',
  'integration_drift_events',
];

const getMissingSchemaColumn = (message = '') => {
  const match = message.match(/Could not find the '([^']+)' column/);
  return match ? match[1] : null;
};

async function updateCompanyWithOptionalColumns(sb, companyId, payload) {
  const row = { ...payload };
  const stripped = new Set();

  while (true) {
    const { error } = await sb
      .from('helixxi_companies')
      .update(row)
      .eq('id', companyId);

    if (!error) return { ok: true, payload: row };

    const missingColumn = getMissingSchemaColumn(error.message);
    if (missingColumn && INTEGRATION_OPTIONAL_COLUMNS.includes(missingColumn) && !stripped.has(missingColumn)) {
      stripped.add(missingColumn);
      delete row[missingColumn];
      continue;
    }

    throw error;
  }
}

// --- Trust scoring + guardrails ---
function getClientIp(req) {
  // Only trust forwarded IP chains when Express trust proxy is configured.
  if (Array.isArray(req.ips) && req.ips.length > 0) {
    return req.ips[0];
  }
  return req.ip || req.socket?.remoteAddress || null;
}

function clampTrustScore(score) {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function buildTrustProfile(company = {}) {
  const hasApiKey = !!company.api_key_hash;
  const hasWebhookSecret = !!company.webhook_secret_hash;
  const lastInboundAt = company.last_webhook_at || company.integration_last_event_at || null;
  const recentInbound = lastInboundAt ? (Date.now() - new Date(lastInboundAt).getTime()) <= (7 * 24 * 60 * 60 * 1000) : false;
  const eventsTotal = Number(company.integration_events_total || 0);
  const duplicateEvents = Number(company.integration_duplicate_events || 0);
  const failures24h = Number(company.integration_failures_24h || 0);
  const driftEvents = Number(company.integration_drift_events || 0);
  const quarantined = Boolean(company.integration_quarantined);

  let score = Number(company.integration_trust_score || 0);
  if (!score) {
    score = 22;
    if (hasApiKey) score += 18;
    if (hasWebhookSecret) score += 18;
    if (recentInbound) score += 16;
    score += Math.min(18, eventsTotal * 2);
    score -= Math.min(20, duplicateEvents * 2);
    score -= Math.min(28, failures24h * 5);
    score -= Math.min(24, driftEvents * 6);
    if (quarantined) score -= 28;
  }

  const resolvedScore = clampTrustScore(score);
  const posture = quarantined
    ? 'QUARANTINED'
    : resolvedScore >= 85 ? 'TRUSTED' : resolvedScore >= 65 ? 'HEALTHY' : resolvedScore >= 40 ? 'WATCH' : 'AT_RISK';
  const blockers = [];
  const strengths = [];

  if (hasApiKey) strengths.push('Direct ingest credential is active.');
  else blockers.push('No direct ingest API key has been generated yet.');

  if (hasWebhookSecret) strengths.push('Webhook secret is active for signed inbound events.');
  else blockers.push('Webhook secret has not been generated yet.');

  if (recentInbound) strengths.push('ARIA has seen recent inbound traffic from this company.');
  else blockers.push('ARIA has not seen a recent verified inbound event yet.');

  if (duplicateEvents > 0) blockers.push(`${duplicateEvents} duplicate event${duplicateEvents === 1 ? '' : 's'} have been seen recently.`);
  if (failures24h > 0) blockers.push(`${failures24h} failed verification attempt${failures24h === 1 ? '' : 's'} landed in the last 24h.`);
  if (driftEvents > 0) blockers.push(`${driftEvents} source drift alert${driftEvents === 1 ? '' : 's'} have been recorded on this lane.`);
  if (quarantined) blockers.push(company.integration_quarantine_reason || 'This lane is quarantined until an operator unlocks it.');

  return {
    score: resolvedScore,
    posture,
    recentInbound,
    eventsTotal,
    duplicateEvents,
    failures24h,
    driftEvents,
    quarantined,
    strengths,
    blockers,
  };
}

function buildSecurityGuardrails(company = {}, trustProfile) {
  return [
    {
      title: 'Signed Inbound Events',
      status: company.webhook_secret_hash ? 'READY' : 'ACTION_REQUIRED',
      detail: company.webhook_secret_hash
        ? 'ARIA can verify signed inbound events with a company-scoped secret.'
        : 'Generate a webhook secret before trusting provider or custom webhook traffic.',
    },
    {
      title: 'Replay and Duplicate Defense',
      status: trustProfile.duplicateEvents > 0 ? 'WATCH' : 'READY',
      detail: trustProfile.duplicateEvents > 0
        ? `Duplicate traffic has been detected ${trustProfile.duplicateEvents} time${trustProfile.duplicateEvents === 1 ? '' : 's'}.`
        : 'Inbound events are protected by replay windows and idempotent event claiming.',
    },
    {
      title: 'Operator Verification',
      status: 'READY',
      detail: 'Credential rotation and sensitive integration changes require recent step-up authentication.',
    },
    {
      title: 'Source Drift Detection',
      status: trustProfile.quarantined ? 'LOCKED' : (trustProfile.driftEvents > 0 || trustProfile.failures24h > 0 ? 'WATCH' : 'READY'),
      detail: trustProfile.quarantined
        ? (company.integration_quarantine_reason || 'ARIA quarantined this connection because inbound trust broke.')
        : (trustProfile.driftEvents > 0 || trustProfile.failures24h > 0)
          ? 'ARIA has seen drift or failed verification attempts and is treating the lane more cautiously.'
          : 'No recent verification failures or drift alerts are degrading this integration lane right now.',
    },
  ];
}

// --- Drift logic ---
function normalizeExpectedInbound(source = '') {
  if (!source) return null;
  if (String(source).startsWith('webhook_')) return 'provider_webhook';
  if (source === 'direct_ingest_signed' || source === 'signed_backend') return 'signed_backend';
  if (source === 'direct_ingest') return 'direct_ingest';
  if (source === 'aggregator') return 'aggregator';
  return String(source);
}

function evaluateIntegrationDrift(company = {}, inbound = {}) {
  if (company.integration_quarantined) {
    return {
      blocked: true,
      statusCode: 423,
      reason: company.integration_quarantine_reason || 'Integration lane is quarantined.',
      autoQuarantine: false,
      reasons: [],
    };
  }

  const reasons = [];
  const expectedSource = normalizeExpectedInbound(company.integration_expected_source);
  const inboundSource = normalizeExpectedInbound(inbound.expectedSource || inbound.source);
  const expectedProvider = String(company.integration_provider_profile || company.provider || 'custom').toLowerCase();
  const inboundProvider = String(inbound.provider || '').toLowerCase();
  const lastIp = company.integration_last_event_ip || null;
  const inboundIp = inbound.ip || null;
  const failures24h = Number(company.integration_failures_24h || 0);
  const score = Number(company.integration_trust_score || 0);
  const mode = String(company.integration_mode || 'backend').toLowerCase();

  if (expectedSource && inboundSource && expectedSource !== inboundSource) {
    reasons.push(`Expected ${expectedSource} traffic but received ${inboundSource}.`);
  }

  if (expectedProvider && !['custom', 'aggregator'].includes(expectedProvider) && inboundProvider && expectedProvider !== inboundProvider) {
    reasons.push(`Provider drift detected: expected ${expectedProvider} but received ${inboundProvider}.`);
  }

  if (lastIp && inboundIp && lastIp !== inboundIp) {
    reasons.push(`Inbound source IP changed from ${lastIp} to ${inboundIp}.`);
  }

  const severeMismatch = reasons.some((reason) => reason.includes('Expected') || reason.includes('Provider drift'));
  const autoQuarantine = severeMismatch && (failures24h > 0 || score < 55 || mode === 'bank');

  return {
    blocked: false,
    statusCode: 409,
    reason: reasons[0] || null,
    reasons,
    autoQuarantine,
  };
}

// --- Provider catalog + blueprints ---
function buildProviderBlueprints(hostUrl, publicId, selectedProvider, selectedMode) {
  const activeProvider = selectedProvider || 'custom';
  const activeMode = selectedMode || 'backend';

  return [
    {
      id: 'backend',
      title: 'Website / Product Backend',
      provider: activeProvider === 'custom' ? 'custom' : activeProvider,
      status: activeMode === 'backend' ? 'ACTIVE' : 'AVAILABLE',
      idealFor: 'SaaS products, marketplaces, internal platforms, and any server that already knows when money moves.',
      security: 'Best path when your backend can send signed server-to-server events.',
      whatYouSend: [
        'Revenue events when orders or subscriptions succeed',
        'Refund events when payouts reverse',
        'Operational spend events when vendor charges happen inside your own stack',
      ],
      setup: [
        'Rotate a webhook secret to unlock trusted backend mode.',
        'Send events from your backend using x-company-id, x-request-timestamp, and x-aria-signature.',
        'Attach an idempotency key so retries cannot create duplicate entries.',
      ],
      endpoint: `${hostUrl}/api/integrations/ingest`,
    },
    {
      id: 'payments',
      title: 'Payment Processor Webhooks',
      provider: activeProvider,
      status: activeMode === 'payments' ? 'ACTIVE' : 'AVAILABLE',
      idealFor: 'Stripe, Paystack, Flutterwave, Monnify, and Square accounts that already emit webhooks.',
      security: 'ARIA verifies provider signatures and treats the payment account as the source of truth.',
      whatYouSend: [
        'Successful payments and subscriptions',
        'Refunds, disputes, and failed charges',
        'Settlement-side activity that should land in the finance trail',
      ],
      setup: [
        'Pick your provider in ARIA Connect.',
        'Rotate a webhook secret for company-scoped provider verification.',
        'Forward your provider webhook endpoint into ARIA.',
      ],
      endpoint: `${hostUrl}/api/webhook/${activeProvider || 'custom'}`,
    },
    {
      id: 'bank',
      title: 'Bank Feed via Aggregator',
      provider: 'aggregator',
      status: activeMode === 'bank' ? 'ACTIVE' : 'PLANNED',
      idealFor: 'Bank-grade transaction feeds through Plaid, Teller, Mono, or a similar secure aggregator.',
      security: 'ARIA should never ask for raw bank credentials directly. Use an audited aggregator token flow.',
      whatYouSend: [
        'Cleared bank transactions from the aggregator feed',
        'Balance snapshots and cash movement metadata',
        'Counterparty descriptors for reconciliation and anomaly review',
      ],
      setup: [
        'Connect a bank aggregator rather than the bank credentials themselves.',
        'Map the aggregator feed into ARIA as a trusted source.',
        'Use ARIA to classify, reconcile, and detect suspicious cash movement.',
      ],
      endpoint: `${hostUrl}/api/integrations/ingest`,
    },
  ];
}

function buildProviderCatalog(hostUrl, publicId, selectedProvider) {
  const providers = [
    {
      id: 'stripe',
      title: 'Stripe',
      fit: 'Best for subscription billing, checkout, and card-first SaaS flows.',
      security: 'Use Stripe-native webhook signatures plus your company-scoped webhook secret inside ARIA.',
      events: ['checkout.session.completed', 'invoice.paid', 'charge.refunded', 'payment_intent.succeeded'],
      endpoint: `${hostUrl}/api/webhook/stripe`,
      install: [
        'In Stripe, create a webhook endpoint that points to ARIA.',
        'Rotate your ARIA webhook secret so tenant-native verification is available.',
        'Select Stripe as the active provider profile in ARIA Connect.',
      ],
      snippet: `Stripe dashboard webhook URL:\n${hostUrl}/api/webhook/stripe\n\nHeaders:\nx-company-id: ${publicId}\nstripe-signature: <provided by Stripe>`,
    },
    {
      id: 'paystack',
      title: 'Paystack',
      fit: 'Best for African-market card and transfer payment flows.',
      security: 'ARIA verifies x-paystack-signature and keeps the company lane isolated with x-company-id.',
      events: ['charge.success', 'refund.processed', 'transfer.success', 'invoice.payment_failed'],
      endpoint: `${hostUrl}/api/webhook/paystack`,
      install: [
        'Create a Paystack webhook endpoint in your merchant account.',
        'Rotate your ARIA webhook secret before sending production traffic.',
        'Select Paystack as the provider so ARIA shows the right install path.',
      ],
      snippet: `Paystack webhook URL:\n${hostUrl}/api/webhook/paystack\n\nHeaders:\nx-company-id: ${publicId}\nx-paystack-signature: <provided by Paystack>`,
    },
    {
      id: 'flutterwave',
      title: 'Flutterwave',
      fit: 'Best for multi-country African payments with a mix of cards, bank transfers, and collections.',
      security: 'ARIA verifies the Flutterwave hash and routes every event into a company-scoped lane.',
      events: ['charge.completed', 'transfer.completed', 'refund.completed', 'payment.failed'],
      endpoint: `${hostUrl}/api/webhook/flutterwave`,
      install: [
        'Configure your Flutterwave webhook target to point at ARIA.',
        'Rotate the ARIA webhook secret so verified tenant traffic can be trusted.',
        'Choose Flutterwave in ARIA Connect before going live.',
      ],
      snippet: `Flutterwave webhook URL:\n${hostUrl}/api/webhook/flutterwave\n\nHeaders:\nx-company-id: ${publicId}\nverif-hash: <your Flutterwave secret hash>`,
    },
    {
      id: 'monnify',
      title: 'Monnify',
      fit: 'Best for bank transfer collections and virtual account workflows.',
      security: 'ARIA verifies Monnify signatures and keeps events tenant-scoped through your company public id.',
      events: ['SUCCESSFUL_TRANSACTION', 'FAILED_TRANSACTION', 'REFUND_COMPLETED', 'SETTLEMENT_COMPLETED'],
      endpoint: `${hostUrl}/api/webhook/monnify`,
      install: [
        'Point your Monnify webhook to ARIA.',
        'Rotate a webhook secret in ARIA before sending live transaction traffic.',
        'Select Monnify as your current provider profile.',
      ],
      snippet: `Monnify webhook URL:\n${hostUrl}/api/webhook/monnify\n\nHeaders:\nx-company-id: ${publicId}\nmonnify-signature: <provided by Monnify>`,
    },
    {
      id: 'square',
      title: 'Square',
      fit: 'Best for commerce, POS, and merchant operations already running on Square.',
      security: 'ARIA validates Square HMAC signatures against the exact webhook URL and raw payload.',
      events: ['payment.created', 'refund.updated', 'order.updated', 'invoice.published'],
      endpoint: `${hostUrl}/api/webhook/square`,
      install: [
        'Create a Square webhook subscription that points to ARIA.',
        'Rotate the ARIA webhook secret before activating production events.',
        'Choose Square in ARIA Connect so the lane reflects the source system.',
      ],
      snippet: `Square webhook URL:\n${hostUrl}/api/webhook/square\n\nHeaders:\nx-company-id: ${publicId}\nx-square-hmacsha256-signature: <provided by Square>`,
    },
  ];

  return providers.map((provider) => ({
    ...provider,
    status: provider.id === (selectedProvider || 'custom') ? 'ACTIVE' : 'AVAILABLE',
  }));
}

// --- Telemetry + state updates ---
async function loadRecentInboundEvents(sb, companyId) {
  try {
    const { data, error } = await sb
      .from('helixxi_inbound_events')
      .select('source, received_at, metadata')
      .eq('company_id', companyId)
      .order('received_at', { ascending: false })
      .limit(8);
    if (error) throw error;
    return (data || []).map((row) => ({
      source: row.source,
      receivedAt: row.received_at,
      metadata: row.metadata || {},
    }));
  } catch {
    return [];
  }
}

async function recordIntegrationActivity(sb, companyId, activity) {
  if (!companyId) return;

  const { data: company } = await sb
    .from('helixxi_companies')
    .select('*')
    .eq('id', companyId)
    .single()
    .catch(() => ({ data: null }));
  if (!company) return;

  const nextEventsTotal = Number(company.integration_events_total || 0) + (activity.countEvent === false ? 0 : 1);
  const nextDuplicates = Number(company.integration_duplicate_events || 0) + (activity.duplicate ? 1 : 0);
  const nextFailures24h = activity.status === 'FAILED'
    ? Number(company.integration_failures_24h || 0) + 1
    : Math.max(0, Number(company.integration_failures_24h || 0) - (activity.clearFailure ? 1 : 0));
  const nextDriftEvents = Number(company.integration_drift_events || 0) + (activity.drift ? 1 : 0);

  let nextScore = Number(company.integration_trust_score || 32);
  if (activity.status === 'VERIFIED') nextScore += activity.boost || 7;
  if (activity.status === 'FAILED') nextScore -= activity.penalty || 12;
  if (activity.duplicate) nextScore -= 3;
  if (activity.missingIdempotencyKey) nextScore -= 2;
  if (activity.drift) nextScore -= activity.driftPenalty || 9;
  if (activity.quarantine) nextScore -= 18;

  const patch = {
    integration_status: activity.integrationStatus || company.integration_status || 'connected',
    last_webhook_at: activity.touchLastWebhookAt ? new Date().toISOString() : (company.last_webhook_at || null),
    integration_trust_score: clampTrustScore(nextScore),
    integration_events_total: nextEventsTotal,
    integration_duplicate_events: nextDuplicates,
    integration_failures_24h: nextFailures24h,
    integration_last_event_at: new Date().toISOString(),
    integration_last_event_source: activity.source || null,
    integration_last_event_status: activity.status || null,
    integration_last_event_detail: activity.detail || null,
    integration_last_event_ip: activity.ip || null,
    integration_last_event_provider: activity.provider || null,
    integration_last_test_at: activity.isTest ? new Date().toISOString() : (company.integration_last_test_at || null),
    integration_last_test_status: activity.isTest ? activity.status : (company.integration_last_test_status || null),
    integration_drift_events: nextDriftEvents,
    integration_last_drift_at: activity.drift ? new Date().toISOString() : (company.integration_last_drift_at || null),
    integration_last_drift_reason: activity.drift ? (activity.driftReason || activity.detail || null) : (company.integration_last_drift_reason || null),
    integration_quarantined: activity.quarantine === undefined ? Boolean(company.integration_quarantined) : Boolean(activity.quarantine),
    integration_quarantine_reason: activity.quarantine === undefined
      ? (company.integration_quarantine_reason || null)
      : (activity.quarantine ? (activity.quarantineReason || activity.detail || 'Inbound trust drift triggered quarantine.') : null),
    integration_quarantined_at: activity.quarantine === undefined
      ? (company.integration_quarantined_at || null)
      : (activity.quarantine ? new Date().toISOString() : null),
  };

  await updateCompanyWithOptionalColumns(sb, companyId, patch).catch(() => {});
}

module.exports = {
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
};
