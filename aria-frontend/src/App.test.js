import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import Login from './Login';

jest.setTimeout(15000);

jest.mock('./HeavyTabs', () => ({
  DashboardTab: () => <div>Dashboard Mock</div>,
  ForecastTab: ({ onRunForecast }) => (
    <div>
      <div>Forecast Mock</div>
      <button onClick={onRunForecast}>Run Forecast Now</button>
    </div>
  ),
  LedgerTab: () => <div>Ledger Mock</div>,
  IntegrationsTab: ({ apiFetch, ensureStepUp, revealedSecret, setRevealedSecret }) => {
    const { useState } = require('react');
    const [testResult, setTestResult] = useState(null);

    async function rotateApiKey() {
      const allowed = await ensureStepUp('rotating the api credential');
      if (!allowed) return;
      const result = await apiFetch('/api/integrations/credentials/rotate', {
        method: 'POST',
        body: JSON.stringify({ kind: 'api' }),
      });
      setRevealedSecret({ ...result, kind: 'api' });
    }

    async function runTestPing() {
      try {
        const result = await apiFetch('/api/integrations/test-ping', {
          method: 'POST',
          body: JSON.stringify({}),
        });
        setTestResult(`Connection live: ${result.message}`);
      } catch (error) {
        setTestResult(`Connection failed: ${error.message}`);
      }
    }

    return (
      <div>
        <div>Integrations Mock</div>
        <button onClick={rotateApiKey}>Rotate API Key</button>
        <button onClick={runTestPing}>Run Test Ping</button>
        {revealedSecret?.value && <div>Secret: {revealedSecret.value}</div>}
        {testResult && <div>{testResult}</div>}
      </div>
    );
  },
  WhyTab: () => <div>Why Engine Mock</div>,
}));

function jsonResponse(data, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => data,
  };
}

function pathnameFor(url) {
  try {
    return new URL(url, 'http://localhost:3000').pathname;
  } catch {
    return String(url);
  }
}

describe('frontend app shell', () => {
  beforeAll(() => {
    if (!window.requestIdleCallback) {
      window.requestIdleCallback = (cb) => setTimeout(() => cb(), 0);
    }
    if (!window.cancelIdleCallback) {
      window.cancelIdleCallback = (id) => clearTimeout(id);
    }
    if (!window.HTMLElement.prototype.scrollIntoView) {
      window.HTMLElement.prototype.scrollIntoView = jest.fn();
    }
  });

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    jest.restoreAllMocks();
  });

  test('renders the ARIA login shell', () => {
    render(<Login onLogin={() => {}} />);

    expect(screen.getByText('ARIA')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Sign In' })).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Individual' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Company' })).toBeInTheDocument();
    expect(screen.getByLabelText('Username')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Request recovery' })).toBeInTheDocument();
  });

  test('submits an account recovery request from the login screen', async () => {
    const fetchMock = jest.fn(async (url) => {
      const pathname = pathnameFor(url);
      if (pathname === '/auth/recovery/request') {
        return jsonResponse({
          success: true,
          message: 'Recovery request received. If the account exists, the ARIA access team will review it and follow up.',
        });
      }
      throw new Error(`Unhandled route ${pathname}`);
    });
    global.fetch = fetchMock;

    render(<Login onLogin={() => {}} />);

    await userEvent.click(screen.getByRole('button', { name: 'Request recovery' }));
    expect(screen.getByText(/Enter your username or email/i)).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Username or Email'), 'samuel');
    await userEvent.click(screen.getByRole('button', { name: 'Request Recovery' }));

    expect(await screen.findByText(/Recovery request received/i)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/auth/recovery/request'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ loginId: 'samuel' }),
      }),
    );
  });

  test('keeps anonymous users on the login gate', async () => {
    global.fetch = jest.fn(async (url) => {
      const pathname = pathnameFor(url);
      if (pathname === '/auth/me') return jsonResponse({ user: null });
      throw new Error(`Unhandled route ${pathname}`);
    });

    render(<App />);

    expect(await screen.findByText('ARIA')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Sign In' })).toHaveLength(2);
  });

  test('sends authenticated but not-onboarded users into onboarding', async () => {
    global.fetch = jest.fn(async (url) => {
      const pathname = pathnameFor(url);
      if (pathname === '/auth/me') {
        return jsonResponse({
          user: { username: 'samuel', role: 'FOUNDER', accountType: 'individual' },
          csrfToken: 'csrf-token',
        });
      }
      if (pathname === '/api/onboarding') return jsonResponse({ completed: false });
      if (pathname === '/api/health') return jsonResponse({ status: 'ARIA ONLINE' });
      if (pathname === '/api/dashboard/kpis') return jsonResponse({});
      throw new Error(`Unhandled route ${pathname}`);
    });

    render(<App />);

    expect(await screen.findByText(/Bring ARIA online with your business context/i)).toBeInTheDocument();
    expect(screen.getByText(/Personalizing ARIA for samuel/i)).toBeInTheDocument();
  });

  test('completes onboarding and persists mission control access', async () => {
    const fetchMock = jest.fn(async (url, options = {}) => {
      const pathname = pathnameFor(url);
      if (pathname === '/auth/me') {
        return jsonResponse({
          user: { username: 'samuel', role: 'FOUNDER', accountType: 'individual' },
          csrfToken: 'csrf-token',
        });
      }
      if (pathname === '/api/onboarding' && (!options.method || options.method === 'GET')) return jsonResponse({ completed: false });
      if (pathname === '/api/onboarding' && options.method === 'POST') return jsonResponse({ success: true });
      if (pathname === '/api/health') return jsonResponse({ status: 'ARIA ONLINE' });
      if (pathname === '/api/dashboard/kpis') return jsonResponse({ dailyBrief: null, alerts: [] });
      throw new Error(`Unhandled route ${pathname}`);
    });
    global.fetch = fetchMock;

    render(<App />);

    expect(await screen.findByText(/Bring ARIA online with your business context/i)).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Company Name'), 'HELIX XI');
    await userEvent.selectOptions(screen.getByLabelText('Industry'), 'Technology');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByText(/Help ARIA understand your business/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Meet ARIA' }));

    expect(await screen.findByText(/I'm ARIA\./i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Enter ARIA' }));

    expect(await screen.findByText(/You're all set, HELIX XI\./i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Enter Mission Control And Open Integrations' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Sign Out' })).toBeInTheDocument();
    });

    expect(localStorage.getItem('aria-onboarded')).toBe('true');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/onboarding'),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"companyName":"HELIX XI"'),
      }),
    );
  });

  test('uses the in-app step-up modal before approving a held transaction', async () => {
    localStorage.setItem('aria-onboarded', 'true');

    const fetchMock = jest.fn(async (url, options = {}) => {
      const pathname = pathnameFor(url);
      if (pathname === '/auth/me') {
        return jsonResponse({
          user: { username: 'samuel', role: 'FOUNDER', accountType: 'individual' },
          csrfToken: 'csrf-token',
        });
      }
      if (pathname === '/api/health') return jsonResponse({ status: 'ARIA ONLINE' });
      if (pathname === '/api/dashboard/kpis') return jsonResponse({ dailyBrief: null, alerts: [] });
      if (pathname === '/api/holdqueue') {
        return jsonResponse([
          {
            HXID: 'HX-1',
            Vendor: 'Stripe',
            Amount: '2499',
            Currency: 'USD',
            ActionTier: 'RED',
            HXFRS: 92,
            Status: 'PENDING_CFO_REVIEW',
            FraudSignals: 'Velocity spike | Unknown vendor',
          },
        ]);
      }
      if (pathname === '/auth/step-up') return jsonResponse({ success: true });
      if (pathname === '/api/holdqueue/HX-1/decision') return jsonResponse({ success: true });
      throw new Error(`Unhandled route ${pathname}`);
    });
    global.fetch = fetchMock;

    render(<App />);

    await screen.findByRole('button', { name: /Hold Queue/i });
    await userEvent.click(screen.getByRole('button', { name: /Hold Queue/i }));
    await screen.findByText('Stripe');

    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));

    expect(await screen.findByText('Security Confirmation')).toBeInTheDocument();
    expect(screen.getByText(/Confirm your password to continue with approving a held transaction/i)).toBeInTheDocument();

    await userEvent.type(screen.getByPlaceholderText('Enter your password'), 'super-secret');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/auth/step-up'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ password: 'super-secret', action: 'approving a held transaction' }),
        }),
      );
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/holdqueue/HX-1/decision'),
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  test('uses the in-app step-up modal before running a forecast manually', async () => {
    localStorage.setItem('aria-onboarded', 'true');

    const fetchMock = jest.fn(async (url) => {
      const pathname = pathnameFor(url);
      if (pathname === '/auth/me') {
        return jsonResponse({
          user: { username: 'samuel', role: 'FOUNDER', accountType: 'individual' },
          csrfToken: 'csrf-token',
        });
      }
      if (pathname === '/api/health') return jsonResponse({ status: 'ARIA ONLINE' });
      if (pathname === '/api/dashboard/kpis') return jsonResponse({ dailyBrief: null, alerts: [] });
      if (pathname === '/api/forecasts') return jsonResponse([]);
      if (pathname === '/auth/step-up') return jsonResponse({ success: true });
      if (pathname === '/api/forecasts/run') return jsonResponse({ success: true, result: {} });
      throw new Error(`Unhandled route ${pathname}`);
    });
    global.fetch = fetchMock;

    render(<App />);

    await screen.findByRole('button', { name: /Forecast/i });
    await userEvent.click(screen.getByRole('button', { name: /Forecast/i }));
    await screen.findByText('Forecast Mock');

    await userEvent.click(screen.getByRole('button', { name: 'Run Forecast Now' }));

    expect(await screen.findByText('Security Confirmation')).toBeInTheDocument();
    expect(screen.getByText(/Confirm your password to continue with running a new forecast/i)).toBeInTheDocument();

    await userEvent.type(screen.getByPlaceholderText('Enter your password'), 'super-secret');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/auth/step-up'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ password: 'super-secret', action: 'running a new forecast' }),
        }),
      );
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/forecasts/run'),
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  test('keeps the step-up modal open with an error so the user can retry', async () => {
    localStorage.setItem('aria-onboarded', 'true');
    let stepUpAttempts = 0;

    const fetchMock = jest.fn(async (url, options = {}) => {
      const pathname = pathnameFor(url);
      if (pathname === '/auth/me') {
        return jsonResponse({
          user: { username: 'samuel', role: 'FOUNDER', accountType: 'individual' },
          csrfToken: 'csrf-token',
        });
      }
      if (pathname === '/api/health') return jsonResponse({ status: 'ARIA ONLINE' });
      if (pathname === '/api/dashboard/kpis') return jsonResponse({ dailyBrief: null, alerts: [] });
      if (pathname === '/api/holdqueue') {
        return jsonResponse([
          {
            HXID: 'HX-1',
            Vendor: 'Stripe',
            Amount: '2499',
            Currency: 'USD',
            ActionTier: 'RED',
            HXFRS: 92,
            Status: 'PENDING_CFO_REVIEW',
            FraudSignals: 'Velocity spike | Unknown vendor',
          },
        ]);
      }
      if (pathname === '/auth/step-up') {
        stepUpAttempts += 1;
        if (stepUpAttempts === 1) return jsonResponse({ error: 'Bad password' }, false, 403);
        return jsonResponse({ success: true });
      }
      if (pathname === '/api/holdqueue/HX-1/decision' && options.method === 'POST') return jsonResponse({ success: true });
      throw new Error(`Unhandled route ${pathname}`);
    });
    global.fetch = fetchMock;

    render(<App />);

    await screen.findByRole('button', { name: /Hold Queue/i });
    await userEvent.click(screen.getByRole('button', { name: /Hold Queue/i }));
    await screen.findByText('Stripe');

    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('Security Confirmation')).toBeInTheDocument();

    await userEvent.type(screen.getByPlaceholderText('Enter your password'), 'wrong-pass');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(await screen.findByText(/Security confirmation failed: Bad password/i)).toBeInTheDocument();
    expect(screen.getByText('Security Confirmation')).toBeInTheDocument();

    const passwordInput = screen.getByPlaceholderText('Enter your password');
    await userEvent.clear(passwordInput);
    await userEvent.type(passwordInput, 'super-secret');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/holdqueue/HX-1/decision'),
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  test('uses the in-app step-up modal before rotating an integration credential', async () => {
    localStorage.setItem('aria-onboarded', 'true');

    const fetchMock = jest.fn(async (url, options = {}) => {
      const pathname = pathnameFor(url);
      if (pathname === '/auth/me') {
        return jsonResponse({
          user: { username: 'samuel', role: 'FOUNDER', accountType: 'company' },
          csrfToken: 'csrf-token',
        });
      }
      if (pathname === '/api/health') return jsonResponse({ status: 'ARIA ONLINE' });
      if (pathname === '/api/dashboard/kpis') return jsonResponse({ dailyBrief: null, alerts: [] });
      if (pathname === '/api/integrations/settings') {
        return jsonResponse({
          company: { name: 'HELIX XI', domain: 'helixxi.com' },
          integration: { status: 'READY', hasApiKey: true, hasWebhookSecret: true },
        });
      }
      if (pathname === '/auth/step-up') return jsonResponse({ success: true });
      if (pathname === '/api/integrations/credentials/rotate' && options.method === 'POST') {
        return jsonResponse({ value: 'hx_api_secret_123', warning: 'Copy this now.' });
      }
      throw new Error(`Unhandled route ${pathname}`);
    });
    global.fetch = fetchMock;

    render(<App />);

    await screen.findByRole('button', { name: /Integrations/i });
    await userEvent.click(screen.getByRole('button', { name: /Integrations/i }));
    await screen.findByText('Integrations Mock');

    await userEvent.click(screen.getByRole('button', { name: 'Rotate API Key' }));

    expect(await screen.findByText('Security Confirmation')).toBeInTheDocument();
    expect(screen.getByText(/Confirm your password to continue with rotating the api credential/i)).toBeInTheDocument();

    await userEvent.type(screen.getByPlaceholderText('Enter your password'), 'super-secret');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/auth/step-up'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ password: 'super-secret', action: 'rotating the api credential' }),
        }),
      );
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/integrations/credentials/rotate'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ kind: 'api' }),
        }),
      );
    });

    expect(await screen.findByText(/Secret: hx_api_secret_123/i)).toBeInTheDocument();
  });

  test('shows the integrations test-ping failure state', async () => {
    localStorage.setItem('aria-onboarded', 'true');

    const fetchMock = jest.fn(async (url) => {
      const pathname = pathnameFor(url);
      if (pathname === '/auth/me') {
        return jsonResponse({
          user: { username: 'samuel', role: 'FOUNDER', accountType: 'company' },
          csrfToken: 'csrf-token',
        });
      }
      if (pathname === '/api/health') return jsonResponse({ status: 'ARIA ONLINE' });
      if (pathname === '/api/dashboard/kpis') return jsonResponse({ dailyBrief: null, alerts: [] });
      if (pathname === '/api/integrations/settings') {
        return jsonResponse({
          company: { name: 'HELIX XI', domain: 'helixxi.com' },
          integration: { status: 'READY', hasApiKey: true, hasWebhookSecret: true },
        });
      }
      if (pathname === '/api/integrations/test-ping') return jsonResponse({ error: 'Webhook endpoint offline' }, false, 503);
      throw new Error(`Unhandled route ${pathname}`);
    });
    global.fetch = fetchMock;

    render(<App />);

    await screen.findByRole('button', { name: /Integrations/i });
    await userEvent.click(screen.getByRole('button', { name: /Integrations/i }));
    await screen.findByText('Integrations Mock');

    await userEvent.click(screen.getByRole('button', { name: 'Run Test Ping' }));

    expect(await screen.findByText(/Connection failed: Webhook endpoint offline/i)).toBeInTheDocument();
  });
});
