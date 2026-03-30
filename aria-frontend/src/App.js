import { lazy, Suspense, startTransition, useState, useEffect, useCallback, useRef } from 'react';
import './App.css';
import Terms from './Terms';
import Login from './Login';
import Onboarding from './Onboarding';
import ChatTab from './components/ChatTab';
import HoldsTab from './components/HoldsTab';
import LiveClock from './components/LiveClock';
import Sidebar from './components/Sidebar';
import StepUpModal from './components/StepUpModal';
import SubmitTab from './components/SubmitTab';
import { apiFetch, setCsrfToken, submitStepUp } from './lib/api';
const loadHeavyTabs = (() => {
  let promise;
  return () => {
    if (!promise) promise = import('./HeavyTabs');
    return promise;
  };
})();

const LazyDashboardTab = lazy(() => loadHeavyTabs().then((m) => ({ default: m.DashboardTab })));
const LazyForecastTab = lazy(() => loadHeavyTabs().then((m) => ({ default: m.ForecastTab })));
const LazyLedgerTab = lazy(() => loadHeavyTabs().then((m) => ({ default: m.LedgerTab })));
const LazyIntegrationsTab = lazy(() => loadHeavyTabs().then((m) => ({ default: m.IntegrationsTab })));
const LazyWhyTab = lazy(() => loadHeavyTabs().then((m) => ({ default: m.WhyTab })));

const PAGE_META = {
  chat:      { title: 'ARIA',               sub: 'Your financial intelligence' },
  why:       { title: 'Why Engine',         sub: 'Autonomous variance attribution and root cause analysis' },
  dashboard: { title: 'Dashboard',          sub: 'Financial health at a glance' },
  ledger:    { title: 'General Ledger',     sub: 'All transactions processed by ARIA' },
  holds:     { title: 'CFO Approval Queue', sub: 'Flagged transactions awaiting decision' },
  forecast:  { title: 'Cash Flow Forecast', sub: 'Multi-model 30-day projections' },
  integrations: { title: 'Integrations', sub: 'Connect ARIA to your company money flow' },
  submit:    { title: 'New Transaction',    sub: 'Submit a transaction for ARIA to process' },
};

const TAB_CACHE_MS = {
  chat: 30000,
  why: 30000,
  dashboard: 30000,
  ledger: 15000,
  holds: 15000,
  forecast: 30000,
  integrations: 60000,
};

export default function App() {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('aria-user')); } catch { return null; }
  });
  const [sessionReady, setSessionReady] = useState(false);
  const [sessionActive, setSessionActive] = useState(false);

  const handleLogin = (u) => {
    localStorage.setItem('aria-user', JSON.stringify(u));
    setUser(u);
    setSessionActive(true);
  };
  const handleLogout = async () => {
    try { await apiFetch('/auth/logout', { method: 'POST', body: JSON.stringify({}) }); } catch {}
    setCsrfToken('');
    localStorage.removeItem('aria-user');
    localStorage.removeItem('aria-onboarded');
    setUser(null);
    setSessionActive(false);
  };
  useEffect(() => {
    apiFetch('/auth/me')
      .then((data) => {
        if (data?.user) {
          setCsrfToken(data.csrfToken);
          setUser(data.user);
          localStorage.setItem('aria-user', JSON.stringify(data.user));
          setSessionActive(true);
        } else {
          setCsrfToken('');
          localStorage.removeItem('aria-user');
          setUser(null);
          setSessionActive(false);
        }
      })
      .catch(() => {
        setCsrfToken('');
        localStorage.removeItem('aria-user');
        setUser(null);
        setSessionActive(false);
      })
      .finally(() => setSessionReady(true));
  }, []);

  useEffect(() => {
    if (!sessionReady || !sessionActive) return undefined;

    const preload = () => {
      loadHeavyTabs().catch(() => {});
    };

    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      const id = window.requestIdleCallback(preload, { timeout: 1200 });
      return () => window.cancelIdleCallback?.(id);
    }

    const timeoutId = window.setTimeout(preload, 900);
    return () => window.clearTimeout(timeoutId);
  }, [sessionReady, sessionActive]);

  const [onboarded, setOnboarded] = useState(() => {
    return localStorage.getItem('aria-onboarded') === 'true';
  });

  // Check onboarding status from server
  useEffect(() => {
    if (!sessionActive || onboarded) return;
    // Admin skips onboarding
    try {
      const u = JSON.parse(localStorage.getItem('aria-user') || '{}');
      if (u.role === 'ADMIN') { setOnboarded(true); return; }
    } catch {}
    apiFetch('/api/onboarding')
      .then(d => {
        if (d.completed) {
          setOnboarded(true);
          localStorage.setItem('aria-onboarded', 'true');
        }
      }).catch(() => {});
  }, [sessionActive, onboarded]);

  const handleOnboardingComplete = (context = {}) => {
    setOnboarded(true);
    localStorage.setItem('aria-onboarded', 'true');
    startTransition(() => setTab('integrations'));
    if (context?.paymentProcessor) {
      setNotice(`Onboarding complete. Next move: connect ${context.paymentProcessor} in Integrations and run a test event.`);
    } else {
      setNotice('Onboarding complete. Next move: open Integrations and connect your first real transaction source.');
    }
  };

  const [tab, setTab]           = useState('chat');
  const [ledger, setLedger]     = useState([]);
  const [ledgerMeta, setLedgerMeta] = useState({ total: 0, page: 1, pages: 1 });
  const [holds, setHolds]       = useState([]);
  const [forecast, setForecast] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [integrations, setIntegrations] = useState(null);
  const [integrationSecret, setIntegrationSecret] = useState(null);
  const [ledgerDrilldown, setLedgerDrilldown] = useState(null);
  const [online, setOnline]     = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [showJournal, setShowJournal] = useState(false);
  const [journalEntries, setJournalEntries] = useState([]);
  const [ariaLevel, setAriaLevel] = useState('INFANT');
  const [notice, setNotice] = useState('');
  const [stepUpState, setStepUpState] = useState({ open: false, actionLabel: '', error: '', submitting: false });
  const tabLoadedAtRef = useRef({});
  const stepUpResolverRef = useRef(null);

  const markTabLoaded = useCallback((key) => {
    tabLoadedAtRef.current[key] = Date.now();
  }, []);

  const isTabFresh = useCallback((key, force = false) => {
    if (force) return false;
    const ttl = TAB_CACHE_MS[key] || 0;
    const loadedAt = tabLoadedAtRef.current[key] || 0;
    return ttl > 0 && (Date.now() - loadedAt) < ttl;
  }, []);

  const switchTab = useCallback((nextTab) => {
    startTransition(() => setTab(nextTab));
  }, []);

  const openJournal = useCallback(async () => {
    try {
      const data = await apiFetch('/api/journal');
      setJournalEntries(Array.isArray(data) ? data : []);
      setShowJournal(true);
    } catch (err) {
      setNotice(`Could not load journal: ${err.message}`);
    }
  }, []);

  const ensureStepUp = useCallback((actionLabel) => {
    setStepUpState({ open: true, actionLabel, error: '', submitting: false });
    return new Promise((resolve) => {
      stepUpResolverRef.current = resolve;
    });
  }, []);

  const closeStepUp = useCallback((result = false) => {
    setStepUpState({ open: false, actionLabel: '', error: '', submitting: false });
    if (stepUpResolverRef.current) {
      stepUpResolverRef.current(result);
      stepUpResolverRef.current = null;
    }
  }, []);

  const confirmStepUp = useCallback(async (password) => {
    setStepUpState((current) => ({ ...current, submitting: true, error: '' }));
    try {
      await submitStepUp(stepUpState.actionLabel, password);
      closeStepUp(true);
    } catch (err) {
      setStepUpState((current) => ({ ...current, submitting: false, error: `Security confirmation failed: ${err.message}` }));
    }
  }, [closeStepUp, stepUpState.actionLabel]);

  // Chat state lifted up so it persists across tab switches
  const [sessions, setSessions] = useState(() => {
    try { return JSON.parse(localStorage.getItem('aria-sessions') || '[]'); } catch { return []; }
  });
  const [activeSessionId, setActiveSessionId] = useState(() => {
    const sid = `session-${Date.now()}`;
    return sid;
  });
  const [chatMessages, setChatMessages] = useState([]);

  // Save sessions to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem('aria-sessions', JSON.stringify(sessions.slice(-20)));
  }, [sessions]);

  const newChat = useCallback(() => {
    const sid = `session-${Date.now()}`;
    setActiveSessionId(sid);
    setChatMessages([]);
    switchTab('chat');
  }, [switchTab]);

  const loadSession = useCallback((sid) => {
    const session = sessions.find(s => s.id === sid);
    if (session) {
      setActiveSessionId(sid);
      setChatMessages(session.messages || []);
      switchTab('chat');
    }
  }, [sessions, switchTab]);

  const updateSession = useCallback((sid, messages) => {
    setSessions(prev => {
      const existing = prev.find(s => s.id === sid);
      const title = messages.find(m => m.role === 'user')?.content?.slice(0, 40) || 'New conversation';
      if (existing) {
        return prev.map(s => s.id === sid ? { ...s, messages, title, updatedAt: Date.now() } : s);
      }
      return [...prev, { id: sid, title, messages, updatedAt: Date.now() }];
    });
  }, []);

  // health check
  useEffect(() => {
    apiFetch('/api/health')
      .then(d => setOnline(d.status === 'ARIA ONLINE'))
      .catch(() => setOnline(false));
  }, []);

  const loadHolds = useCallback(async ({ force = false } = {}) => {
    if (isTabFresh('holds', force)) return;
    try {
      const d = await apiFetch('/api/holdqueue');
      setHolds(Array.isArray(d) ? d.filter((h) => (h.Status || h.status) === 'PENDING_CFO_REVIEW') : []);
      markTabLoaded('holds');
    } catch {
      setHolds([]);
    }
  }, [isTabFresh, markTabLoaded]);

  const loadLedgerPage = useCallback(async (page = 1, { force = false } = {}) => {
    const cacheKey = `ledger:${page}`;
    if (isTabFresh(cacheKey, force)) return;
    try {
      const d = await apiFetch(`/api/transactions?page=${page}&limit=50`);
      setLedger(Array.isArray(d.data) ? d.data : []);
      setLedgerMeta({ total: d.total || 0, page: d.page || 1, pages: d.pages || 1 });
      const count = d.total || 0;
      setAriaLevel(count >= 500 ? 'ADVANCED' : count >= 200 ? 'MATURE' : count >= 50 ? 'DEVELOPING' : count >= 10 ? 'LEARNING' : 'INFANT');
      markTabLoaded(cacheKey);
      markTabLoaded('ledger');
    } catch {
      setLedger([]);
      setLedgerMeta({ total: 0, page: 1, pages: 1 });
    }
  }, [isTabFresh, markTabLoaded]);

  const openLedgerDrilldown = useCallback((drilldown) => {
    setLedgerDrilldown(drilldown || null);
    switchTab('ledger');
  }, [switchTab]);

  const loadDashboard = useCallback(async ({ force = false } = {}) => {
    if (isTabFresh('dashboard', force)) return;
    try {
      const d = await apiFetch('/api/dashboard/kpis');
      setDashboard(d || null);
      markTabLoaded('dashboard');
      markTabLoaded('chat');
      markTabLoaded('why');
    } catch {
      setDashboard(null);
    }
  }, [isTabFresh, markTabLoaded]);

  const loadForecast = useCallback(async ({ force = false } = {}) => {
    if (isTabFresh('forecast', force)) return;
    try {
      const d = await apiFetch('/api/forecasts');
      const last = Array.isArray(d) && d.length > 0 ? d[d.length - 1] : null;
      if (!last) {
        setForecast(null);
        markTabLoaded('forecast');
        return;
      }
      const burn = parseFloat(last.MonthlyBurn) || 0;
      const metadata = last.Metadata || last.metadata || {};
      setForecast({
        modelA: {
          forecast30: last.ModelA_30Day,
          avgDailyBurn: metadata.averageDaily || (burn / 30).toFixed(0),
          trend: metadata.trendDirection || (parseFloat(last.ModelA_30Day) < burn ? 'DECLINING' : 'GROWING'),
        },
        modelB: {
          mean: last.ModelB_P50_90Day,
          p10: last.ModelB_P10_90Day,
          p90: last.ModelB_P90_90Day,
          stdDev: Math.abs(parseFloat(last.ModelB_P90_90Day) - parseFloat(last.ModelB_P10_90Day)).toFixed(0),
        },
        modelC: { bull: last.ModelC_Bull, base: last.ModelC_Base, stress: last.ModelC_Stress },
        cashProfile: {
          inflowDetected: !!metadata.inflowDetected,
          monthlyInflow: metadata.monthlyInflow || '0',
          inflowProjection30: metadata.inflowProjection30 || '0',
          inflowProjection90: metadata.inflowProjection90 || '0',
          netBurn30: metadata.netBurn30 || last.MonthlyBurn || '0',
          netBurn90Base: metadata.netBurn90Base || last.ModelC_Base || '0',
          netBurn90Stress: metadata.netBurn90Stress || last.ModelC_Stress || '0',
          coverageRatio: metadata.coverageRatio || '0',
          cashPressure: metadata.cashPressure || 'HIGH',
          runwayReady: metadata.runwayReady === true,
          openingCashBalance: metadata.openingCashBalance || '0',
          runwayMonths: metadata.runwayMonths || null,
          runwayDays: metadata.runwayDays || null,
          runwayNote: metadata.runwayNote || '',
        },
        metadata: {
          stale: !!metadata.stale,
          latestSpendDate: metadata.latestSpendDate || null,
          trendDirection: metadata.trendDirection || null,
          averageDaily: metadata.averageDaily || (burn / 30).toFixed(0),
          previousMonthlyBurn: metadata.previousMonthlyBurn || null,
        },
      });
      markTabLoaded('forecast');
    } catch {
      setForecast(null);
    }
  }, [isTabFresh, markTabLoaded]);

  const loadIntegrations = useCallback(async ({ force = false } = {}) => {
    if (isTabFresh('integrations', force)) return;
    try {
      const d = await apiFetch('/api/integrations/settings');
      setIntegrations(d || null);
      markTabLoaded('integrations');
    } catch {
      setIntegrations({ error: 'This feature is available for company accounts after setup.' });
    }
  }, [isTabFresh, markTabLoaded]);

  const loadTab = useCallback(async (t, { force = false } = {}) => {
    if (t === 'chat' || t === 'dashboard' || t === 'why') {
      await loadDashboard({ force });
    }
    if (t === 'ledger') {
      await loadLedgerPage(1, { force });
    }
    if (t === 'holds') {
      await loadHolds({ force });
    }
    if (t === 'forecast') {
      await loadForecast({ force });
    }
    if (t === 'integrations') {
      await loadIntegrations({ force });
    }
  }, [loadDashboard, loadForecast, loadHolds, loadIntegrations, loadLedgerPage]);

  useEffect(() => { loadTab(tab); }, [tab, loadTab]);

  const [forecastRunning, setForecastRunning] = useState(false);
  const [forecastRunError, setForecastRunError] = useState('');

  const runForecastNow = useCallback(async () => {
    setForecastRunError('');
    setForecastRunning(true);
    try {
      const allowed = await ensureStepUp('running a new forecast');
      if (!allowed) return;
      await apiFetch('/api/forecasts/run', { method: 'POST', body: JSON.stringify({}) });
      await loadTab('forecast', { force: true });
    } catch (err) {
      setForecastRunError(err.message || 'Failed to run forecast');
    } finally {
      setForecastRunning(false);
    }
  }, [ensureStepUp, loadTab]);

  const meta = PAGE_META[tab];

  if (!sessionReady) return null;
  if (!user || !sessionActive) return <Login onLogin={handleLogin} />;
  if (!onboarded) return <Onboarding user={user} onComplete={handleOnboardingComplete} apiFetch={apiFetch} />;

  return (
    <div className="aria-shell">
      {showTerms && <Terms onClose={() => setShowTerms(false)} />}
      <StepUpModal
        actionLabel={stepUpState.actionLabel}
        error={stepUpState.error}
        onCancel={() => closeStepUp(false)}
        onConfirm={confirmStepUp}
        open={stepUpState.open}
        submitting={stepUpState.submitting}
      />
      {showJournal && (
        <div className="journal-overlay" onClick={() => setShowJournal(false)}>
          <div className="journal-modal" onClick={e => e.stopPropagation()}>
            <div className="journal-header">
              <div className="journal-title">ARIA Private Journal</div>
              <button className="journal-close" onClick={() => setShowJournal(false)}>Close</button>
            </div>
            <div className="journal-entries">
              {journalEntries.length === 0 && (
                <div style={{ color: 'var(--muted)', padding: 20 }}>No journal entries yet. Keep talking to ARIA.</div>
              )}
              {[...journalEntries].reverse().map((e, i) => (
                <div key={i} className="journal-entry">
                  <div className="journal-entry-meta">
                    <span className="journal-entry-title">{e.Title || e.title || 'Untitled'}</span>
                    <span className="journal-entry-date">{(e.Timestamp || e.timestamp || '').slice(0, 16).replace('T', ' ')}</span>
                  </div>
                  <div className="journal-entry-content">{e.Content || e.content}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {notice && (
        <div style={{ position: 'fixed', top: 20, right: 20, zIndex: 50, maxWidth: 420, background: 'var(--surface2)', border: '1px solid rgba(239,68,68,0.25)', color: 'var(--text)', borderRadius: 14, padding: '14px 16px', boxShadow: '0 16px 48px rgba(15,23,42,0.22)' }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <div style={{ color: 'var(--red-l)', fontWeight: 700 }}>Notice</div>
            <div style={{ flex: 1, fontSize: 13, lineHeight: 1.5 }}>{notice}</div>
            <button className="btn-ghost" onClick={() => setNotice('')}>Close</button>
          </div>
        </div>
      )}
      <Sidebar tab={tab} setTab={switchTab} onPrefetchTab={(nextTab) => {
        if (['why', 'dashboard', 'ledger', 'forecast', 'integrations'].includes(nextTab)) {
          loadHeavyTabs().catch(() => {});
        }
      }} online={online} holdCount={holds.length} onTerms={() => setShowTerms(true)} sessions={sessions} activeSessionId={activeSessionId} onNewChat={newChat} onLoadSession={loadSession} />
      <main className="main">
        <div className="topbar">
          <div className="topbar-left">
            <span className="topbar-title">{meta.title}</span>
            <span className="topbar-divider">/</span>
            <span className="topbar-sub">{meta.sub}</span>
          </div>
          <div className="topbar-right">
            <LiveClock />
            <div className="aria-level-wrap">
              <span className={`aria-level-badge level-${ariaLevel.toLowerCase()}`}>ARIA: {ariaLevel}</span>
              <div className="aria-level-bar">
                <div className="aria-level-fill" style={{ width: `${
                  ariaLevel === 'INFANT' ? (ledgerMeta.total / 10) * 100 :
                  ariaLevel === 'LEARNING' ? ((ledgerMeta.total - 10) / 40) * 100 :
                  ariaLevel === 'DEVELOPING' ? ((ledgerMeta.total - 50) / 150) * 100 :
                  ariaLevel === 'MATURE' ? ((ledgerMeta.total - 200) / 300) * 100 : 100
                }%` }} />
              </div>
            </div>
            <button className="btn-ghost" onClick={() => loadTab(tab, { force: true })}>Refresh</button>
            <button className="btn-journal" onClick={openJournal} title="ARIA Journal">Journal</button>
            <button className="btn-ghost" onClick={handleLogout} style={{ color: 'var(--red-l)', borderColor: 'rgba(239,68,68,0.3)' }}>Sign Out</button>
          </div>
        </div>
        <div className="content">
          {tab === 'chat'      && <ChatTab messages={chatMessages} setMessages={setChatMessages} sessionId={activeSessionId} onUpdateSession={updateSession} dashboard={dashboard} setTab={setTab} />}
          {tab === 'why'       && (
            <Suspense fallback={<div className="empty"><div className="empty-icon">WHY</div><div className="empty-text">Loading Why Engine...</div></div>}>
              <LazyWhyTab dashboard={dashboard} setTab={switchTab} onRefresh={() => loadDashboard({ force: true })} onOpenLedgerDrilldown={openLedgerDrilldown} />
            </Suspense>
          )}
          {tab === 'dashboard' && (
            <Suspense fallback={<div className="empty"><div className="empty-icon">DB</div><div className="empty-text">Loading Dashboard...</div></div>}>
              <LazyDashboardTab dashboard={dashboard} setTab={switchTab} onRefresh={() => loadDashboard({ force: true })} />
            </Suspense>
          )}
          {tab === 'ledger'    && (
            <Suspense fallback={<div className="empty"><div className="empty-icon">GL</div><div className="empty-text">Loading Ledger...</div></div>}>
              <LazyLedgerTab ledger={ledger} ledgerMeta={ledgerMeta} onPageChange={(page) => loadLedgerPage(page, { force: true })} setTab={switchTab} drilldown={ledgerDrilldown} onClearDrilldown={() => setLedgerDrilldown(null)} />
            </Suspense>
          )}
          {tab === 'holds'    && <HoldsTab    holds={holds}     loadHolds={() => loadHolds({ force: true })} setTab={switchTab} ensureStepUp={ensureStepUp} />}
          {tab === 'forecast' && (
            <Suspense fallback={<div className="empty"><div className="empty-icon">FC</div><div className="empty-text">Loading Forecast...</div></div>}>
              <LazyForecastTab forecast={forecast} onRunForecast={runForecastNow} running={forecastRunning} error={forecastRunError} />
            </Suspense>
          )}
          {tab === 'integrations' && (
            <Suspense fallback={<div className="empty"><div className="empty-icon">CN</div><div className="empty-text">Loading Integrations...</div></div>}>
              <LazyIntegrationsTab integrations={integrations} revealedSecret={integrationSecret} setRevealedSecret={setIntegrationSecret} user={user} ensureStepUp={ensureStepUp} apiFetch={apiFetch} onError={setNotice} />
            </Suspense>
          )}
          {tab === 'submit'   && <SubmitTab />}
        </div>
      </main>
    </div>
  );
}
