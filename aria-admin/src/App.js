import { useState, useEffect, useCallback, useRef } from 'react';
import './App.css';
import AdminLogin from './components/AdminLogin';
import { AdminSidebar } from './components/AdminChrome';
import PasswordResetModal from './components/PasswordResetModal';
import StepUpModal from './components/StepUpModal';
import { AriaStatusView, IntegrationView, JournalView, OverviewView, SecurityView, SystemView, UsersView } from './components/AdminViews';
import { adminFetch, setCsrfToken, submitAdminStepUp } from './lib/api';

export default function App() {
  const [user, setUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('aria-admin-user'));
    } catch {
      return null;
    }
  });
  const [sessionReady, setSessionReady] = useState(false);
  const [sessionActive, setSessionActive] = useState(false);
  const [tab, setTab] = useState('overview');
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [journal, setJournal] = useState([]);
  const [securityEvents, setSecurityEvents] = useState([]);
  const [integrationEvents, setIntegrationEvents] = useState([]);
  const [providerDiagnostics, setProviderDiagnostics] = useState([]);
  const [clock, setClock] = useState('');
  const [killConfirm, setKillConfirm] = useState(false);
  const [stepUpState, setStepUpState] = useState({ open: false, actionLabel: '', error: '', submitting: false });
  const [passwordResetState, setPasswordResetState] = useState({ open: false, targetUser: null, error: '', submitting: false });
  const stepUpResolverRef = useRef(null);

  useEffect(() => {
    adminFetch('/auth/me')
      .then((data) => {
        if (data?.user?.role === 'ADMIN') {
          setCsrfToken(data.csrfToken);
          setUser(data.user);
          localStorage.setItem('aria-admin-user', JSON.stringify(data.user));
          setSessionActive(true);
        } else {
          setCsrfToken('');
          localStorage.removeItem('aria-admin-user');
          setUser(null);
          setSessionActive(false);
        }
      })
      .catch(() => {
        setCsrfToken('');
        localStorage.removeItem('aria-admin-user');
        setUser(null);
        setSessionActive(false);
      })
      .finally(() => setSessionReady(true));
  }, []);

  useEffect(() => {
    const tick = () =>
      setClock(
        new Date().toLocaleTimeString('en-GB', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
      );
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const loadStats = useCallback(() => adminFetch('/admin/stats').then(setStats).catch(() => {}), []);
  const loadUsers = useCallback(() => adminFetch('/admin/users').then(setUsers).catch(() => {}), []);
  const loadCompanies = useCallback(() => adminFetch('/admin/companies').then(setCompanies).catch(() => {}), []);
  const loadJournal = useCallback(() => adminFetch('/admin/journal').then(setJournal).catch(() => {}), []);
  const loadSecurity = useCallback(() => {
    adminFetch('/admin/security-events')
      .then((data) => setSecurityEvents(data?.events || []))
      .catch(() => {});
  }, []);
  const loadIntegrations = useCallback(() => {
    adminFetch('/admin/integration-events')
      .then((data) => {
        setIntegrationEvents(data?.events || []);
        setProviderDiagnostics(data?.providers || []);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!user) return;
    loadStats();
    const id = setInterval(loadStats, 30000);
    return () => clearInterval(id);
  }, [user, loadStats]);

  useEffect(() => {
    if (!user) return;
    if (tab === 'users') {
      loadUsers();
      loadCompanies();
    }
    if (tab === 'journal') loadJournal();
    if (tab === 'security') loadSecurity();
    if (tab === 'integrations') loadIntegrations();
  }, [tab, user, loadUsers, loadCompanies, loadJournal, loadSecurity, loadIntegrations]);

  async function updateStatus(userId, status) {
    await adminFetch(`/admin/users/${userId}/status`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    });
    loadUsers();
    loadStats();
  }

  async function updateRole(userId, role) {
    await adminFetch(`/admin/users/${userId}/role`, {
      method: 'POST',
      body: JSON.stringify({ role }),
    });
    loadUsers();
    loadStats();
  }

  const openPasswordReset = useCallback((targetUser) => {
    setPasswordResetState({ open: true, targetUser, error: '', submitting: false });
  }, []);

  const closePasswordReset = useCallback(() => {
    setPasswordResetState({ open: false, targetUser: null, error: '', submitting: false });
  }, []);

  async function toggleIntegrationQuarantine(companyId, quarantine) {
    const actionLabel = quarantine ? 'quarantining integration lane' : 'restoring integration lane';
    const allowed = await ensureAdminStepUp(actionLabel);
    if (!allowed) return;

    await adminFetch(`/admin/integration-events/${companyId}/${quarantine ? 'quarantine' : 'unquarantine'}`, {
      method: 'POST',
      body: JSON.stringify({
        reason: quarantine ? 'Locked from Mission Control after trust review.' : '',
      }),
    });
    loadIntegrations();
    loadStats();
  }

  const ensureAdminStepUp = useCallback((actionLabel) => {
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
      await submitAdminStepUp(stepUpState.actionLabel, password);
      closeStepUp(true);
    } catch (err) {
      setStepUpState((current) => ({ ...current, submitting: false, error: `Security confirmation failed: ${err.message}` }));
    }
  }, [closeStepUp, stepUpState.actionLabel]);

  const resetUserPassword = useCallback(async (password) => {
    const targetUser = passwordResetState.targetUser;
    if (!targetUser) return;

    setPasswordResetState((current) => ({ ...current, submitting: true, error: '' }));
    const allowed = await ensureAdminStepUp(`resetting password for ${targetUser.username}`);
    if (!allowed) {
      setPasswordResetState((current) => ({ ...current, submitting: false }));
      return;
    }

    try {
      await adminFetch(`/admin/users/${targetUser.id}/password`, {
        method: 'POST',
        body: JSON.stringify({ password }),
      });
      closePasswordReset();
      loadUsers();
      loadStats();
    } catch (err) {
      setPasswordResetState((current) => ({ ...current, submitting: false, error: err.message }));
    }
  }, [closePasswordReset, ensureAdminStepUp, loadStats, loadUsers, passwordResetState.targetUser]);

  async function killSwitch() {
    const allowed = await ensureAdminStepUp('shutting down ARIA');
    if (!allowed) {
      setKillConfirm(false);
      return;
    }
    try {
      await adminFetch('/admin/system/shutdown', {
        method: 'POST',
        body: JSON.stringify({}),
      });
    } catch {}
    setKillConfirm(false);
  }

  const handleLogin = (nextUser) => {
    localStorage.setItem('aria-admin-user', JSON.stringify(nextUser));
    setUser(nextUser);
    setSessionActive(true);
    setTimeout(() => adminFetch('/admin/stats').then(setStats).catch(() => {}), 100);
  };

  const handleLogout = async () => {
    try {
      await adminFetch('/auth/logout', {
        method: 'POST',
        body: JSON.stringify({}),
      });
    } catch {}
    setCsrfToken('');
    localStorage.removeItem('aria-admin-user');
    setUser(null);
    setSessionActive(false);
  };

  if (!sessionReady) return null;
  if (!user || !sessionActive) return <AdminLogin onLogin={handleLogin} />;

  const levelColor = {
    INFANT: '#64748b',
    LEARNING: '#f59e0b',
    DEVELOPING: '#3b82f6',
    MATURE: '#8b5cf6',
    ADVANCED: '#10b981',
  };

  const navItems = [
    { id: 'overview', icon: '[]', label: 'Overview' },
    { id: 'aria', icon: 'AI', label: 'ARIA Status' },
    { id: 'users', icon: 'U', label: 'Users', badge: stats?.users?.pending },
    { id: 'integrations', icon: 'CN', label: 'Connections', badge: stats?.integrations?.quarantined || stats?.integrations?.watch || stats?.integrations?.atRisk },
    { id: 'journal', icon: 'J', label: "ARIA's Journal" },
    { id: 'security', icon: 'S', label: 'Security', badge: stats?.security?.denied24h },
    { id: 'system', icon: 'C', label: 'System' },
  ];

  return (
    <div className="shell">
      <StepUpModal
        actionLabel={stepUpState.actionLabel}
        error={stepUpState.error}
        onCancel={() => closeStepUp(false)}
        onConfirm={confirmStepUp}
        open={stepUpState.open}
        submitting={stepUpState.submitting}
      />
      <PasswordResetModal
        error={passwordResetState.error}
        onCancel={closePasswordReset}
        onConfirm={resetUserPassword}
        open={passwordResetState.open}
        submitting={passwordResetState.submitting}
        targetUser={passwordResetState.targetUser}
      />
      <AdminSidebar clock={clock} currentUser={user} handleLogout={handleLogout} navItems={navItems} setTab={setTab} tab={tab} />

      <main className="main">
        {tab === 'overview' && <OverviewView currentUser={user} levelColor={levelColor} setTab={setTab} stats={stats} />}
        {tab === 'aria' && <AriaStatusView levelColor={levelColor} setTab={setTab} stats={stats} />}
        {tab === 'users' && <UsersView companies={companies} loadStats={loadStats} loadUsers={loadUsers} onResetPassword={openPasswordReset} updateRole={updateRole} updateStatus={updateStatus} users={users} />}
        {tab === 'integrations' && (
          <IntegrationView
            integrationEvents={integrationEvents}
            onToggleQuarantine={toggleIntegrationQuarantine}
            providerDiagnostics={providerDiagnostics}
            stats={stats}
          />
        )}
        {tab === 'journal' && <JournalView journal={journal} />}
        {tab === 'security' && <SecurityView securityEvents={securityEvents} stats={stats} />}
        {tab === 'system' && <SystemView killConfirm={killConfirm} killSwitch={killSwitch} setKillConfirm={setKillConfirm} stats={stats} />}
      </main>
    </div>
  );
}
