const test = require('node:test');
const assert = require('node:assert/strict');

const { isVaultConfigured, encryptSecret, decryptSecret } = require('../modules/secretVault');

test('secret vault encrypts and decrypts tenant webhook secrets', () => {
  process.env.SECRET_VAULT_KEY = 'helix-xi-elite-vault-key-for-tests';

  assert.equal(isVaultConfigured(), true);
  const sealed = encryptSecret('aria_whsec_123456');
  assert.match(sealed, /^v1:/);
  assert.equal(decryptSecret(sealed), 'aria_whsec_123456');
});

test('secret vault rejects malformed ciphertext', () => {
  process.env.SECRET_VAULT_KEY = 'helix-xi-elite-vault-key-for-tests';
  assert.throws(() => decryptSecret('bad-value'), /Invalid secret ciphertext format/);
});
