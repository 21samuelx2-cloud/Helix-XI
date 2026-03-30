const DEFAULT_API_ORIGIN = 'http://localhost:3001';
const rawApiUrl = (process.env.REACT_APP_API_URL || '').trim();
const CSRF_STORAGE_KEY = 'aria-csrf-token';

export const API = (() => {
  if (!rawApiUrl) return DEFAULT_API_ORIGIN;
  try {
    return new URL(rawApiUrl).origin;
  } catch {
    return DEFAULT_API_ORIGIN;
  }
})();

export function getCsrfToken() {
  return sessionStorage.getItem(CSRF_STORAGE_KEY) || '';
}

export function setCsrfToken(token) {
  if (token) sessionStorage.setItem(CSRF_STORAGE_KEY, token);
  else sessionStorage.removeItem(CSRF_STORAGE_KEY);
}

export async function apiFetch(path, opts = {}) {
  const method = (opts.method || 'GET').toUpperCase();
  const csrfToken = getCsrfToken();
  const res = await fetch(`${API}${path}`, {
    ...opts,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(method !== 'GET' && method !== 'HEAD' && csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
      ...(opts.headers || {}),
    },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }

  return res.json();
}

export async function submitStepUp(actionLabel, password) {
  await apiFetch('/auth/step-up', {
    method: 'POST',
    body: JSON.stringify({ password, action: actionLabel }),
  });
}
