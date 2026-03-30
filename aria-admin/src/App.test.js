import React, { act } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

global.IS_REACT_ACT_ENVIRONMENT = true;

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

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function click(node) {
  await act(async () => {
    node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await flush();
  });
}

async function change(node, value) {
  const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  valueSetter.call(node, value);

  await act(async () => {
    node.dispatchEvent(new Event('input', { bubbles: true }));
    node.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
  });
}

function findButton(container, label) {
  return [...container.querySelectorAll('button')].find((button) => button.textContent.includes(label));
}

async function waitFor(assertion, attempts = 20) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await act(async () => {
        await flush();
      });
    }
  }

  throw lastError;
}

describe('admin app shell', () => {
  let container;
  let root;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    jest.restoreAllMocks();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  test('uses the in-app step-up modal before shutting ARIA down', async () => {
    const fetchMock = jest.fn(async (url) => {
      const pathname = pathnameFor(url);
      if (pathname === '/auth/me') {
        return jsonResponse({
          user: { username: 'samuel', role: 'ADMIN' },
          csrfToken: 'csrf-token',
        });
      }
      if (pathname === '/admin/stats') {
        return jsonResponse({
          aria: {
            level: 'MATURE',
            transactionCount: 240,
            journalCount: 5,
            memoryCount: 12,
            heldTransactions: 2,
            lastConversation: new Date().toISOString(),
            lastJournalDate: new Date().toISOString(),
            lastJournalTitle: 'Checkpoint',
          },
          users: { total: 4, pending: 1 },
          security: { denied24h: 1, last24h: 3, total: 8, approved24h: 2, lastEventAt: new Date().toISOString(), lastEventAction: 'STEP_UP_OK' },
          system: { uptime: 3600, nodeVersion: 'v22.0.0', timestamp: new Date().toISOString() },
        });
      }
      if (pathname === '/auth/step-up') return jsonResponse({ success: true });
      if (pathname === '/admin/system/shutdown') return jsonResponse({ success: true });
      throw new Error(`Unhandled route ${pathname}`);
    });
    global.fetch = fetchMock;

    await act(async () => {
      root.render(<App />);
      await flush();
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/admin/stats'),
        expect.any(Object),
      );
    });

    const systemNav = findButton(container, 'System');
    expect(systemNav).toBeTruthy();

    await click(systemNav);

    const activateButton = findButton(container, 'Activate Kill Switch');
    expect(activateButton).toBeTruthy();

    await click(activateButton);

    const confirmShutdown = findButton(container, 'Yes, Shut Down');
    expect(confirmShutdown).toBeTruthy();

    await click(confirmShutdown);

    await waitFor(() => {
      expect(container.textContent).toContain('Security Confirmation');
      expect(container.textContent).toContain('Confirm shutting down ARIA');
    });

    const passwordInput = container.querySelector('input[type="password"]');
    expect(passwordInput).toBeTruthy();

    await change(passwordInput, 'super-secret');

    const confirmButton = findButton(container, 'Confirm');
    expect(confirmButton).toBeTruthy();
    expect(confirmButton.disabled).toBe(false);

    await click(confirmButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/auth/step-up'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ password: 'super-secret', action: 'shutting down ARIA' }),
        }),
      );
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/admin/system/shutdown'),
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  test('approves a pending user and refreshes the users view', async () => {
    let userStatus = 'PENDING';

    const fetchMock = jest.fn(async (url, options = {}) => {
      const pathname = pathnameFor(url);
      if (pathname === '/auth/me') {
        return jsonResponse({
          user: { username: 'samuel', role: 'ADMIN' },
          csrfToken: 'csrf-token',
        });
      }
      if (pathname === '/admin/stats') {
        return jsonResponse({
          aria: {
            level: 'MATURE',
            transactionCount: 240,
            journalCount: 5,
            memoryCount: 12,
            heldTransactions: 2,
            lastConversation: new Date().toISOString(),
            lastJournalDate: new Date().toISOString(),
            lastJournalTitle: 'Checkpoint',
          },
          users: { total: 4, pending: userStatus === 'PENDING' ? 1 : 0 },
          security: { denied24h: 1, last24h: 3, total: 8, approved24h: 2, lastEventAt: new Date().toISOString(), lastEventAction: 'STEP_UP_OK' },
          system: { uptime: 3600, nodeVersion: 'v22.0.0', timestamp: new Date().toISOString() },
        });
      }
      if (pathname === '/admin/users') {
        return jsonResponse([
          {
            id: 'user-1',
            username: 'pending-user',
            email: 'pending@helixxi.com',
            account_type: 'company',
            role: 'FOUNDER',
            status: userStatus,
            created_at: new Date().toISOString(),
          },
        ]);
      }
      if (pathname === '/admin/companies') return jsonResponse([]);
      if (pathname === '/admin/users/user-1/status' && options.method === 'POST') {
        userStatus = 'APPROVED';
        return jsonResponse({ success: true });
      }
      throw new Error(`Unhandled route ${pathname}`);
    });
    global.fetch = fetchMock;

    await act(async () => {
      root.render(<App />);
      await flush();
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/admin/stats'),
        expect.any(Object),
      );
    });

    const usersNav = findButton(container, 'Users');
    expect(usersNav).toBeTruthy();

    await click(usersNav);

    await waitFor(() => {
      expect(container.textContent).toContain('Pending Approvals');
      expect(container.textContent).toContain('pending-user');
    });

    const approveButton = findButton(container, 'Approve');
    expect(approveButton).toBeTruthy();

    await click(approveButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/admin/users/user-1/status'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ status: 'APPROVED' }),
        }),
      );
    });

    await waitFor(() => {
      const statsCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/admin/stats'));
      const userCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/admin/users'));
      expect(statsCalls.length).toBeGreaterThan(1);
      expect(userCalls.length).toBeGreaterThan(1);
    });
  });

  test('grants admin access to an approved user', async () => {
    let userRole = 'MANAGER';

    const fetchMock = jest.fn(async (url, options = {}) => {
      const pathname = pathnameFor(url);
      if (pathname === '/auth/me') {
        return jsonResponse({
          user: { username: 'samuel', role: 'ADMIN', isRootAdmin: true },
          csrfToken: 'csrf-token',
        });
      }
      if (pathname === '/admin/stats') {
        return jsonResponse({
          aria: {
            level: 'MATURE',
            transactionCount: 240,
            journalCount: 5,
            memoryCount: 12,
            heldTransactions: 2,
            lastConversation: new Date().toISOString(),
            lastJournalDate: new Date().toISOString(),
            lastJournalTitle: 'Checkpoint',
          },
          users: { total: 4, pending: 0 },
          security: { denied24h: 1, last24h: 3, total: 8, approved24h: 2, lastEventAt: new Date().toISOString(), lastEventAction: 'STEP_UP_OK' },
          system: { uptime: 3600, nodeVersion: 'v22.0.0', timestamp: new Date().toISOString() },
        });
      }
      if (pathname === '/admin/users') {
        return jsonResponse([
          {
            id: 'user-2',
            username: 'ops-lead',
            email: 'ops@helixxi.com',
            account_type: 'company',
            role: userRole,
            status: 'APPROVED',
            created_at: new Date().toISOString(),
          },
        ]);
      }
      if (pathname === '/admin/companies') return jsonResponse([]);
      if (pathname === '/admin/users/user-2/role' && options.method === 'POST') {
        userRole = 'ADMIN';
        return jsonResponse({ success: true, user: { id: 'user-2', role: 'ADMIN' } });
      }
      throw new Error(`Unhandled route ${pathname}`);
    });
    global.fetch = fetchMock;

    await act(async () => {
      root.render(<App />);
      await flush();
    });

    const usersNav = findButton(container, 'Users');
    expect(usersNav).toBeTruthy();
    await click(usersNav);

    await waitFor(() => {
      expect(container.textContent).toContain('ops-lead');
      expect(container.textContent).toContain('Grant Admin');
    });

    const grantAdminButton = findButton(container, 'Grant Admin');
    expect(grantAdminButton).toBeTruthy();
    await click(grantAdminButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/admin/users/user-2/role'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ role: 'ADMIN' }),
        }),
      );
    });
  });

  test('resets a user password from the admin panel', async () => {
    const fetchMock = jest.fn(async (url, options = {}) => {
      const pathname = pathnameFor(url);
      if (pathname === '/auth/me') {
        return jsonResponse({
          user: { username: 'samuel', role: 'ADMIN', isRootAdmin: true },
          csrfToken: 'csrf-token',
        });
      }
      if (pathname === '/admin/stats') {
        return jsonResponse({
          aria: {
            level: 'MATURE',
            transactionCount: 240,
            journalCount: 5,
            memoryCount: 12,
            heldTransactions: 2,
            lastConversation: new Date().toISOString(),
            lastJournalDate: new Date().toISOString(),
            lastJournalTitle: 'Checkpoint',
          },
          users: { total: 4, pending: 0 },
          security: { denied24h: 1, last24h: 3, total: 8, approved24h: 2, lastEventAt: new Date().toISOString(), lastEventAction: 'STEP_UP_OK' },
          system: { uptime: 3600, nodeVersion: 'v22.0.0', timestamp: new Date().toISOString() },
        });
      }
      if (pathname === '/admin/users') {
        return jsonResponse([
          {
            id: 'user-3',
            username: 'finance-op',
            email: 'finance@helixxi.com',
            account_type: 'company',
            role: 'MANAGER',
            status: 'APPROVED',
            created_at: new Date().toISOString(),
          },
        ]);
      }
      if (pathname === '/admin/companies') return jsonResponse([]);
      if (pathname === '/auth/step-up') return jsonResponse({ success: true, stepUpActive: true });
      if (pathname === '/admin/users/user-3/password' && options.method === 'POST') {
        return jsonResponse({ success: true, user: { id: 'user-3', username: 'finance-op' } });
      }
      throw new Error(`Unhandled route ${pathname}`);
    });
    global.fetch = fetchMock;

    await act(async () => {
      root.render(<App />);
      await flush();
    });

    const usersNav = findButton(container, 'Users');
    expect(usersNav).toBeTruthy();
    await click(usersNav);

    await waitFor(() => {
      expect(container.textContent).toContain('finance-op');
      expect(container.textContent).toContain('Reset Password');
    });

    const resetButton = findButton(container, 'Reset Password');
    expect(resetButton).toBeTruthy();
    await click(resetButton);

    await waitFor(() => {
      expect(container.textContent).toContain('Reset Password');
      expect(container.textContent).toContain('Set a new password for finance-op');
    });

    const resetPasswordInput = container.querySelector('#admin-reset-password');
    const resetPasswordConfirmInput = container.querySelector('#admin-reset-password-confirm');
    expect(resetPasswordInput).toBeTruthy();
    expect(resetPasswordConfirmInput).toBeTruthy();
    await change(resetPasswordInput, 'new-password-123');
    await change(resetPasswordConfirmInput, 'new-password-123');

    const resetConfirmButton = findButton(container, 'Apply Reset');
    expect(resetConfirmButton).toBeTruthy();
    await click(resetConfirmButton);

    await waitFor(() => {
      expect(container.textContent).toContain('Security Confirmation');
      expect(container.textContent).toContain('Confirm resetting password for finance-op');
    });

    const stepUpInput = container.querySelector('#admin-step-up-password');
    expect(stepUpInput).toBeTruthy();
    await change(stepUpInput, 'super-secret');

    const confirmButton = findButton(container, 'Confirm');
    expect(confirmButton).toBeTruthy();
    await click(confirmButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/auth/step-up'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ password: 'super-secret', action: 'resetting password for finance-op' }),
        }),
      );
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/admin/users/user-3/password'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ password: 'new-password-123' }),
        }),
      );
    });
  });

  test('loads the connection watchtower view', async () => {
    const fetchMock = jest.fn(async (url) => {
      const pathname = pathnameFor(url);
      if (pathname === '/auth/me') {
        return jsonResponse({
          user: { username: 'samuel', role: 'ADMIN', isRootAdmin: true },
          csrfToken: 'csrf-token',
        });
      }
      if (pathname === '/admin/stats') {
        return jsonResponse({
          aria: {
            level: 'MATURE',
            transactionCount: 240,
            journalCount: 5,
            memoryCount: 12,
            heldTransactions: 2,
            lastConversation: new Date().toISOString(),
            lastJournalDate: new Date().toISOString(),
            lastJournalTitle: 'Checkpoint',
          },
          users: { total: 4, pending: 0 },
          integrations: { total: 2, connected: 2, trusted: 1, healthy: 1, watch: 1, atRisk: 0, lastActive: new Date().toISOString() },
          security: { denied24h: 1, last24h: 3, total: 8, approved24h: 2, lastEventAt: new Date().toISOString(), lastEventAction: 'STEP_UP_OK' },
          system: { uptime: 3600, nodeVersion: 'v22.0.0', timestamp: new Date().toISOString() },
        });
      }
      if (pathname === '/admin/integration-events') {
        return jsonResponse({
          summary: { total: 2, connected: 2, trusted: 1, healthy: 1, watch: 1, atRisk: 0, quarantined: 0, lastActive: new Date().toISOString() },
          providers: [
            {
              provider: 'stripe',
              companies: 1,
              trusted: 0,
              watch: 1,
              quarantined: 0,
              stale: 0,
              eventsTotal: 8,
              failures24h: 0,
              duplicates: 1,
              avgTrustScore: 78,
              lastActive: new Date().toISOString(),
            },
          ],
          events: [
            {
              companyId: 'cmp_1',
              companyName: 'HELIX XI',
              provider: 'stripe',
              mode: 'payments',
              status: 'connected',
              trustScore: 78,
              lastEventAt: new Date().toISOString(),
              lastEventSource: 'webhook_stripe',
              lastEventStatus: 'VERIFIED',
              lastEventDetail: 'Provider webhook verified and accepted from stripe.',
              failures24h: 0,
              duplicateEvents: 1,
              eventsTotal: 8,
              quarantined: false,
              quarantineReason: null,
              quarantinedAt: null,
              driftEvents: 1,
              lastDriftAt: new Date().toISOString(),
              lastDriftReason: 'Inbound source IP changed from 10.0.0.1 to 10.0.0.2.',
            },
          ],
        });
      }
      if (pathname === '/auth/step-up') return jsonResponse({ success: true, stepUpActive: true });
      if (pathname === '/admin/integration-events/cmp_1/quarantine') {
        return jsonResponse({ success: true, quarantined: true });
      }
      throw new Error(`Unhandled route ${pathname}`);
    });
    global.fetch = fetchMock;

    await act(async () => {
      root.render(<App />);
      await flush();
    });

    const connectionsNav = findButton(container, 'Connections');
    expect(connectionsNav).toBeTruthy();
    await click(connectionsNav);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/admin/integration-events'),
        expect.any(Object),
      );
      expect(container.textContent).toContain('Connection Watchtower');
      expect(container.textContent).toContain('Provider Diagnostics');
      expect(container.textContent).toContain('Stripe Diagnostics');
      expect(container.textContent).toContain('HELIX XI');
      expect(container.textContent).toContain('Trust 78/100');
      expect(container.textContent).toContain('Quarantine Lane');
    });

    const quarantineButton = findButton(container, 'Quarantine Lane');
    expect(quarantineButton).toBeTruthy();
    await click(quarantineButton);

    await waitFor(() => {
      expect(container.textContent).toContain('Security Confirmation');
      expect(container.textContent).toContain('Confirm quarantining integration lane');
    });

    const passwordInput = container.querySelector('input[type="password"]');
    expect(passwordInput).toBeTruthy();
    await change(passwordInput, 'super-secret');

    const confirmButton = findButton(container, 'Confirm');
    expect(confirmButton).toBeTruthy();
    await click(confirmButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/auth/step-up'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ password: 'super-secret', action: 'quarantining integration lane' }),
        }),
      );
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/admin/integration-events/cmp_1/quarantine'),
        expect.objectContaining({
          method: 'POST',
        }),
      );
    });
  });
});
