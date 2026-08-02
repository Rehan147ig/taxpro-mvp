import crypto from 'crypto';
import { env } from '../config/env.js';

const PREFIX = 'enc:v1';

function getKey(): Buffer {
  if (!env.DATA_ENCRYPTION_KEY) {
    throw new Error(
      'DATA_ENCRYPTION_KEY is not set. This is required for encrypting sensitive data like NetSuite credentials. ' +
      'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
  return crypto.createHash('sha256').update(env.DATA_ENCRYPTION_KEY).digest();
}

export function encryptSecret(value: string) {
  if (!value) return value;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    PREFIX,
    iv.toString('base64url'),
    tag.toString('base64url'),
    encrypted.toString('base64url'),
  ].join(':');
}

export function decryptSecret(value: string) {
  if (!value || !value.startsWith(`${PREFIX}:`)) return value;

  const [, , ivRaw, tagRaw, encryptedRaw] = value.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivRaw, 'base64url'), { authTagLength: 16 });
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));

  return Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
