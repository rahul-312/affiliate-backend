'use strict';

const crypto = require('node:crypto');

/**
 * Authenticated encryption (AES-256-GCM) for sensitive fields such as bank
 * account numbers. Ciphertext format: v1.<iv>.<authTag>.<data> (base64url).
 * The version prefix allows key rotation or algorithm changes later.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const VERSION = 'v1';

function createFieldCipher(hexKey) {
  const key = Buffer.from(hexKey, 'hex');
  if (key.length !== 32) throw new Error('Field encryption key must be 32 bytes');

  return Object.freeze({
    /** @param {object} value JSON-serialisable value */
    encrypt(value) {
      const iv = crypto.randomBytes(IV_BYTES);
      const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
      const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();
      return [VERSION, iv, tag, data].map((part) => (Buffer.isBuffer(part) ? part.toString('base64url') : part)).join('.');
    },

    /** @returns {object} the decrypted value; throws if tampered with */
    decrypt(payload) {
      const [version, iv, tag, data] = String(payload).split('.');
      if (version !== VERSION || !iv || !tag || !data) throw new Error('Unsupported ciphertext format');
      const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64url'));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      const plain = Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]);
      return JSON.parse(plain.toString('utf8'));
    },
  });
}

module.exports = { createFieldCipher };
