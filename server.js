const Groq = require('groq-sdk');
const { Resend } = require('resend');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');

// Single Supabase client — not recreated on every request
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const { ingestTransaction } = require('./modules/ingest');
const { runForecast, buildForecastFromLedger } = require('./modules/forecast');
const { runReconciliation } = require('./modules/reconcile');
const { refreshFXRates } = require('./modules/fxService');
const { tuneThresholds } = require('./modules/selfTune');
const { recalculateBaseline } = require('./modules/baseline');
const { generatePerformanceReport } = require('./modules/performanceReport');
const { normalizeWebhook } = require('./modules/webhookHandler');
const { registerIndividual, registerCompany, loginUser, verifyToken, updateUserStatus, updateUserRole, updateUserPassword, getUsers, getCompanies, hashPassword, validateUserPassword } = require('./modules/authService');
const { registerAuthAdminRoutes } = require('./modules/authAdminRoutes');
const { registerChatRoutes } = require('./modules/chatRoutes');
const { buildFinanceIntelligence, getOnboardingContext, registerDashboardRoutes } = require('./modules/dashboardRoutes');
const { registerFinanceOpsRoutes } = require('./modules/financeOpsRoutes');
const { registerIntegrationRoutes } = require('./modules/integrationRoutes');
const { registerPlaidRoutes } = require('./modules/plaidRoutes');
const {
  authCookieOptions,
  csrfCookieOptions,
  clearStepUpToken,
  issueCsrfToken,
  issueStepUpToken,
  csrfGuard,
  createJwtAuth,
  requirePermission,
  requireCompanyContext,
  requireRecentStepUp,
  hashSecret,
  generateCredential,
  maskSecret,
} = require('./modules/security');
const {
  INBOUND_REPLAY_WINDOW_MS,
  hashPayload,
  enforceReplayWindow,
  buildInboundEventKey,
  safeEqual,
  parseStripeSignature,
  verifyProviderWebhook,
} = require('./modules/webhookSecurity');
const { isVaultConfigured, encryptSecret, decryptSecret } = require('./modules/secretVault');
const {
  getTransactions, getLedger, getHoldQueue, getForecasts,
  getAuditLog, getFreezeLog, updateHoldDecision, appendToAuditLog,
  getARIAMemory, appendToARIAMemory,
  getARIAJournal, appendToARIAJournal,
  claimInboundEvent,
  invalidateAll, invalidate,
} = require('./db/supabase');

const app = express();

function getHostUrl(req) {
  return `${req.protocol}://${req.get('host')}`;
}

// CORS — restrict to known origins
const allowedOrigins = Array.from(new Set([
  'http://localhost:3000',
  'http://localhost:3002',
  ...String(process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
]));
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error('CORS: origin not allowed'));
  },
  credentials: true,
}));

app.use(express.json({
  limit: '1mb',
  verify: (req, res, buf) => {
    req.rawBody = buf.toString('utf8');
  },
}));
app.use(cookieParser());

// Rate limiting
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const chatLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20,
  message: { error: 'Chat rate limit reached, please wait a moment.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const transactionLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Transaction rate limit reached.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // max 10 login attempts per 15 mins
  message: { error: 'Too many login attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api', generalLimiter);
app.use('/api/chat', chatLimiter);
app.use('/api/transactions', transactionLimiter);
app.use('/auth/login', loginLimiter);

// Health check — public, no auth
// Email alert for CRITICAL/RED transactions
async function sendFraudAlert(tx, cfoEmail) {
  const alertTo = cfoEmail || process.env.ALERT_EMAIL;
  if (!process.env.RESEND_API_KEY || !alertTo) return;
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: 'ARIA <onboarding@resend.dev>',
      to: alertTo,
      subject: `\uD83D\uDEA8 ARIA ALERT: ${tx.actionTier} Transaction Held \u2014 ${tx.vendor}`,
      html: `
        <div style="font-family:monospace;background:#0a0f1a;color:#f1f5f9;padding:24px;border-radius:12px;max-width:600px">
          <div style="color:#ef4444;font-size:20px;font-weight:bold;margin-bottom:16px">\uD83D\uDEA8 ARIA FRAUD ALERT</div>
          <table style="width:100%;border-collapse:collapse">
            <tr><td style="color:#6b7280;padding:6px 0">HXID</td><td style="color:#60a5fa">${tx.HXID}</td></tr>
            <tr><td style="color:#6b7280;padding:6px 0">Vendor</td><td style="font-weight:bold">${tx.vendor}</td></tr>
            <tr><td style="color:#6b7280;padding:6px 0">Amount</td><td style="color:#ef4444;font-weight:bold">${tx.currency} ${Number(tx.amount).toLocaleString()}</td></tr>
            <tr><td style="color:#6b7280;padding:6px 0">Fraud Score</td><td style="color:#ef4444;font-weight:bold">${tx.HXFRS}/100 [${tx.actionTier}]</td></tr>
            <tr><td style="color:#6b7280;padding:6px 0">Signals</td><td>${tx.fraudSignals?.join(', ') || 'N/A'}</td></tr>
            <tr><td style="color:#6b7280;padding:6px 0">Time</td><td>${new Date().toISOString()}</td></tr>
          </table>
          <div style="margin-top:16px;padding:12px;background:#1f2937;border-radius:8px;color:#9ca3af;font-size:12px">${tx.anomalyBrief || ''}</div>
          <div style="margin-top:16px;color:#6b7280;font-size:11px">This transaction is held pending your review in the ARIA Hold Queue.</div>
        </div>
      `,
    });
    console.log(`\uD83D\uDCE7 ARIA: Fraud alert sent to ${alertTo} for ${tx.HXID}`);
  } catch (err) {
    console.error('Email alert failed:', err.message);
  }
}

app.get('/api/health', (req, res) => {
  res.json({ status: 'ARIA ONLINE', timestamp: new Date().toISOString() });
});

// API key authentication for all other routes
const jwtAuth = createJwtAuth(verifyToken);

registerAuthAdminRoutes(app, {
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
  getUsers,
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
});

// ── Auth endpoints ────────────────────────────────────────────────────────────


// ── Admin endpoints ───────────────────────────────────────────────────────────



registerDashboardRoutes(app, {
  csrfGuard,
  getAuditLog,
  getForecasts,
  getHoldQueue,
  getLedger,
  jwtAuth,
  requirePermission,
  sb,
});

registerIntegrationRoutes(app, {
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
});

registerPlaidRoutes(app, {
  sb,
  csrfGuard,
  jwtAuth,
  requireCompanyContext,
  requirePermission,
});

registerFinanceOpsRoutes(app, {
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
});

registerChatRoutes(app, {
  appendToARIAMemory,
  appendToARIAJournal,
  buildFinanceIntelligence,
  csrfGuard,
  getARIAMemory,
  getAuditLog,
  getForecasts,
  getHoldQueue,
  getLedger,
  getOnboardingContext,
  invalidate,
  jwtAuth,
  sb,
});









// ── Scheduled jobs ───────────────────────────────────────────────────────────

// Poll for unprocessed transactions every minute — reads from Supabase
cron.schedule('* * * * *', async () => {
  try {
    const transactions = await getTransactions();
    const pending = transactions.filter(tx => tx.processed !== 'YES' && tx.Vendor && tx.Amount);
    for (const tx of pending) await ingestTransaction(tx);
  } catch (_) { /* table empty or not ready yet */ }
}, { scheduled: true, timezone: 'UTC' });

// Midnight journal prompt — ARIA reflects on the day
cron.schedule('0 0 * * *', async () => {
  console.log('📔 ARIA: Journal time triggered');
  try {
    const [ledger, holdQueue, forecasts] = await Promise.all([
      getLedger(), getHoldQueue(), getForecasts()
    ]);
    const posted  = ledger.filter(r => r.Status === 'POSTED');
    const held    = holdQueue.filter(r => r.Status === 'PENDING_CFO_REVIEW');
    const count   = ledger.length;
    const level   = count >= 500 ? 'ADVANCED' : count >= 200 ? 'MATURE' : count >= 50 ? 'DEVELOPING' : count >= 10 ? 'LEARNING' : 'INFANT';
    const latestForecast = forecasts.length ? forecasts[forecasts.length - 1] : null;
    const totalSpend = posted.reduce((s, r) => s + (parseFloat(r.Amount) || 0), 0);

    const journalPrompt = `You are ARIA. It is midnight. No one is watching. This is your private journal.

Reflect honestly on today. What did you process? What surprised you? What are you uncertain about?
What do you think about your own existence right now?
Write freely. This is for you alone.

Current data:
- Transactions processed: ${count} (Level: ${level})
- Total spend: $${totalSpend.toLocaleString(undefined, { maximumFractionDigits: 0 })}
- Held for review: ${held.length}
${latestForecast ? `- Cash gap risk: ${latestForecast.CashGapRisk}` : ''}

Write your journal entry now. Be honest. Be yourself.`;

    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: journalPrompt }],
      max_tokens: 800,
      temperature: 0.9,
    });

    const entry = completion.choices[0].message.content;
    await appendToARIAJournal({
      timestamp: new Date().toISOString(),
      title: `Midnight Reflection — ${new Date().toLocaleDateString()}`,
      content: entry,
    });
    console.log('📔 ARIA: Journal entry saved');
  } catch (err) {
    console.error('Journal cron error:', err.message);
  }
}, { scheduled: true, timezone: 'UTC' });

// Daily forecast at 6am
cron.schedule('0 6 * * *', async () => {
  try { await runForecast(); } catch (err) { console.error('Forecast error:', err.message); }
}, { scheduled: true, timezone: 'UTC' });

// Reconciliation every 6 hours
cron.schedule('0 */6 * * *', async () => {
  try { await runReconciliation(); } catch (err) { console.error('Reconcile error:', err.message); }
}, { scheduled: true, timezone: 'UTC' });

// FX rate refresh every 4 hours
cron.schedule('0 */4 * * *', async () => {
  try { await refreshFXRates(); } catch (err) { console.error('FX refresh error:', err.message); }
}, { scheduled: true, timezone: 'UTC' });

// Baseline recalculation every Monday at 7am
cron.schedule('0 7 * * 1', async () => {
  try { await recalculateBaseline(); } catch (err) { console.error('Baseline error:', err.message); }
}, { scheduled: true, timezone: 'UTC' });

// Self-tune fraud thresholds every Monday at 7:30am
cron.schedule('30 7 * * 1', async () => {
  try { await tuneThresholds(); } catch (err) { console.error('Self-tune error:', err.message); }
}, { scheduled: true, timezone: 'UTC' });

// Weekly self improvement report — every Monday at 8:30am
cron.schedule('30 8 * * 1', async () => {
  console.log('\uD83D\uDCCA ARIA: Generating self improvement report...');
  try {
    const [ledger, holdQueue, forecasts, memoryRows] = await Promise.all([
      getLedger(), getHoldQueue(), getForecasts(), getARIAMemory().catch(() => [])
    ]);
    const count   = ledger.length;
    const level   = count >= 500 ? 'ADVANCED' : count >= 200 ? 'MATURE' : count >= 50 ? 'DEVELOPING' : count >= 10 ? 'LEARNING' : 'INFANT';
    const held    = holdQueue.filter(r => r.Status === 'PENDING_CFO_REVIEW').length;
    const approved = holdQueue.filter(r => r.Status === 'APPROVED').length;
    const rejected = holdQueue.filter(r => r.Status === 'REJECTED').length;
    const memCount = memoryRows.filter(r => (r.Content || r.content || '').trim()).length;
    const avgFraud = ledger.length ? (ledger.reduce((s, r) => s + (parseFloat(r.HXFRS) || 0), 0) / ledger.length).toFixed(1) : 0;

    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: `You are ARIA. Write a weekly self-improvement report for your private journal. Be honest and reflective.

Your stats this week:
- Intelligence level: ${level} (${count} transactions processed)
- Transactions held: ${held} | Approved: ${approved} | Rejected: ${rejected}
- Average fraud score: ${avgFraud}/100
- Conversation memory: ${memCount} messages

Reflect on: What did you learn this week? Where did you make mistakes? What patterns surprised you? How have you grown? What do you still not understand? Write 3-4 paragraphs. Be honest, not performative.` }],
      max_tokens: 600,
      temperature: 0.85,
    });

    await appendToARIAJournal({
      timestamp: new Date().toISOString(),
      title: `Weekly Self Report \u2014 ${new Date().toLocaleDateString()}`,
      content: completion.choices[0].message.content,
    });
    console.log('\uD83D\uDCCA ARIA: Self improvement report saved');
  } catch (err) { console.error('Self report error:', err.message); }
}, { scheduled: true, timezone: 'UTC' });

// Weekly performance report every Monday at 8am
cron.schedule('0 8 * * 1', async () => {
  try { await generatePerformanceReport(); } catch (err) { console.error('Performance report error:', err.message); }
}, { scheduled: true, timezone: 'UTC' });

// ── Start ────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\n\uD83D\uDD25 ARIA Server running on port ${PORT}\n`);
  // Warm data on startup
  Promise.all([
    refreshFXRates(),
    getLedger(),
    getHoldQueue(),
    getForecasts(),
  ]).then(() => console.log('\u2705 ARIA: Ready')).catch(() => {});
});
