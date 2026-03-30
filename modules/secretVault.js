const crypto = require('crypto');

const VAULT_PREFIX = 'v1';

const resolveVaultKey = () => {
  const raw = process.env.SECRET_VAULT_KEY || process.env.WEBHOOK_SECRET_VAULT_KEY || '';
  if (!raw) return null;

  const trimmed = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, 'hex');
  }

  try {
    const fromBase64 = Buffer.from(trimmed, 'base64');
    if (fromBase64.length === 32) return fromBase64;
  } catch {}

  if (trimmed.length >= 16) {
    return crypto.createHash('sha256').update(trimmed).digest();
  }

  return null;
};

const isVaultConfigured = () => Boolean(resolveVaultKey());

const encryptSecret = (plaintext) => {
  const key = resolveVaultKey();
  if (!key) throw new Error('Secret vault key is not configured');
  if (!plaintext) throw new Error('Secret plaintext is required');

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [
    VAULT_PREFIX,
    iv.toString('base64'),
    authTag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
};

const decryptSecret = (sealedValue) => {
  const key = resolveVaultKey();
  if (!key) throw new Error('Secret vault key is not configured');
  if (!sealedValue) throw new Error('Secret ciphertext is required');

  const [version, ivB64, tagB64, cipherB64] = String(sealedValue).split(':');
  if (version !== VAULT_PREFIX || !ivB64 || !tagB64 || !cipherB64) {
    throw new Error('Invalid secret ciphertext format');
  }

  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(tagB64, 'base64');
  const ciphertext = Buffer.from(cipherB64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
};

module.exports = {
  isVaultConfigured,
  encryptSecret,
  decryptSecret,
};
