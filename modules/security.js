const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const ROLE_PERMISSIONS = {
  ADMIN: ['*'],
  MANAGER: [
    'dashboard.read',
    'ledger.read',
    'holdqueue.read',
    'holdqueue.approve',
    'forecast.read',
    'forecast.run',
    'journal.read',
    'journal.write',
    'integrations.read',
    'integrations.rotate',
    'reconcile.run',
    'transactions.submit',
    'audit.read',
  ],
  INDIVIDUAL: [
    'dashboard.read',
    'ledger.read',
    'holdqueue.read',
    'forecast.read',
    'journal.write',
    'transactions.submit',
    'audit.read',
  ],
};

const buildCsrfToken = () => crypto.randomBytes(32).toString('hex');
const STEP_UP_MAX_AGE_MS = 10 * 60 * 1000;

const authCookieOptions = () => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 30 * 24 * 60 * 60 * 1000,
  path: '/',
});

const csrfCookieOptions = () => ({
  httpOnly: false,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 30 * 24 * 60 * 60 * 1000,
  path: '/',
});

const stepUpCookieOptions = () => ({
  httpOnly: true,
  sameSite: 'strict',
  secure: process.env.NODE_ENV === 'production',
  maxAge: STEP_UP_MAX_AGE_MS,
  path: '/',
});

const issueCsrfToken = (res) => {
  const csrfToken = buildCsrfToken();
  res.cookie('csrf_token', csrfToken, csrfCookieOptions());
  return csrfToken;
};

const issueStepUpToken = (res, user) => {
  const token = jwt.sign(
    {
      type: 'step_up',
      userId: user?.userId,
      role: user?.role,
      companyId: user?.companyId || null,
    },
    process.env.JWT_SECRET,
    { expiresIn: Math.floor(STEP_UP_MAX_AGE_MS / 1000) }
  );
  res.cookie('step_up', token, stepUpCookieOptions());
  return token;
};

const clearStepUpToken = (res) => {
  res.clearCookie('step_up', stepUpCookieOptions());
};

const userPermissions = (user) => ROLE_PERMISSIONS[user?.role] || [];

const hasPermission = (user, permission) => {
  const permissions = userPermissions(user);
  return permissions.includes('*') || permissions.includes(permission);
};

const csrfGuard = (req, res, next) => {
  const ct = req.headers['content-type'] || '';
  if (!ct.includes('application/json')) {
    return res.status(415).json({ error: 'Content-Type must be application/json' });
  }
  const hasSessionCookie = Boolean(req.cookies?.token);
  if (!hasSessionCookie) return next();

  const csrfHeader = req.headers['x-csrf-token'];
  const csrfCookie = req.cookies?.csrf_token;
  if (!csrfHeader || !csrfCookie || csrfHeader !== csrfCookie) {
    return res.status(403).json({ error: 'Invalid CSRF token' });
  }
  next();
};

const createJwtAuth = (verifyToken) => (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  const decoded = verifyToken(token);
  if (!decoded) return res.status(401).json({ error: 'Invalid or expired token' });
  req.user = decoded;
  next();
};

const requirePermission = (permission) => (req, res, next) => {
  if (!hasPermission(req.user, permission)) {
    return res.status(403).json({ error: `Forbidden: ${permission} required` });
  }
  next();
};

const requireCompanyContext = (req, res, next) => {
  if (!req.user?.companyId) {
    return res.status(403).json({ error: 'This feature is available for company accounts only right now.' });
  }
  next();
};

const requireRecentStepUp = (req, res, next) => {
  const token = req.cookies?.step_up;
  if (!token) {
    return res.status(403).json({ error: 'Step-up authentication required' });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded?.type !== 'step_up') {
      return res.status(403).json({ error: 'Step-up authentication required' });
    }
    if (decoded.userId !== req.user?.userId || decoded.role !== req.user?.role) {
      return res.status(403).json({ error: 'Step-up authentication does not match the active user' });
    }
    next();
  } catch {
    return res.status(403).json({ error: 'Step-up authentication expired' });
  }
};

const hashSecret = (value) => crypto.createHash('sha256').update(value).digest('hex');
const generateCredential = (prefix) => `${prefix}_${crypto.randomBytes(24).toString('hex')}`;

const maskSecret = (value) => {
  if (!value) return null;
  if (value.length <= 8) return '********';
  return `${value.slice(0, 8)}****${value.slice(-4)}`;
};

module.exports = {
  ROLE_PERMISSIONS,
  authCookieOptions,
  csrfCookieOptions,
  stepUpCookieOptions,
  issueCsrfToken,
  issueStepUpToken,
  clearStepUpToken,
  userPermissions,
  hasPermission,
  csrfGuard,
  createJwtAuth,
  requirePermission,
  requireCompanyContext,
  requireRecentStepUp,
  hashSecret,
  generateCredential,
  maskSecret,
  STEP_UP_MAX_AGE_MS,
};
