/**
 * Mail Hub — envelope encryption for connection secrets.
 *
 * Every refresh token and mailbox password is sealed with its own random 256-bit data key
 * (AES-256-GCM), and that data key is itself wrapped by a key-encryption key the database never
 * sees: a Cloud KMS key in production (`MAIL_HUB_KMS_KEY_NAME`), or a 32-byte key held in Secret
 * Manager and exposed to the server as `MAIL_HUB_TOKEN_KEY`. See `secrets.ts` for the choice.
 *
 * Two properties beyond "encrypted":
 *
 *  - **Bound to the account.** The account id is GCM additional authenticated data, so a sealed
 *    credential copied onto another account's document fails authentication instead of decrypting
 *    — an attacker with write access to the credentials collection cannot graft one user's grant
 *    onto another user's mailbox.
 *  - **Rotatable.** The wrapped data key records which key-encryption key wrapped it, so rotating
 *    the KEK re-wraps 32-byte data keys rather than re-encrypting every secret, and a sealed secret
 *    from before a rotation still opens.
 *
 * Uses only `node:crypto`, so it is unit-tested directly.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface KeyWrapper {
  /** Stable description stored alongside the wrapped key, e.g. `gcp-kms:projects/…/cryptoKeys/mail`. */
  readonly id: string;
  wrap(dataKey: Buffer): Promise<string>;
  unwrap(wrapped: string): Promise<Buffer>;
}

export interface SealedSecret {
  v: 1;
  alg: 'AES-256-GCM';
  kek: string;
  wrappedKey: string;
  iv: string;
  tag: string;
  cipher: string;
}

export class SecretUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretUnavailableError';
  }
}

export async function sealSecret(plaintext: string, boundTo: string, wrapper: KeyWrapper): Promise<SealedSecret> {
  const dataKey = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', dataKey, iv);
  cipher.setAAD(Buffer.from(`mail-hub:${boundTo}`, 'utf8'));
  const sealed = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const wrappedKey = await wrapper.wrap(dataKey);
  dataKey.fill(0);
  return {
    v: 1,
    alg: 'AES-256-GCM',
    kek: wrapper.id,
    wrappedKey,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    cipher: sealed.toString('base64'),
  };
}

export async function openSecret(sealed: SealedSecret, boundTo: string, wrappers: KeyWrapper[]): Promise<string> {
  const wrapper = wrappers.find((entry) => entry.id === sealed.kek);
  if (!wrapper) throw new SecretUnavailableError(`The key that sealed this credential (${sealed.kek}) is not configured.`);
  let dataKey: Buffer;
  try {
    dataKey = await wrapper.unwrap(sealed.wrappedKey);
  } catch (error) {
    throw new SecretUnavailableError(`The credential key could not be unwrapped: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', dataKey, Buffer.from(sealed.iv, 'base64'));
    decipher.setAAD(Buffer.from(`mail-hub:${boundTo}`, 'utf8'));
    decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(sealed.cipher, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    throw new SecretUnavailableError('The stored credential failed its integrity check.');
  } finally {
    dataKey.fill(0);
  }
}

/** A key-encryption key held in memory (from Secret Manager via the environment). */
export class LocalKeyWrapper implements KeyWrapper {
  readonly id: string;
  private readonly key: Buffer;
  constructor(key: Buffer, version = 'v1') {
    this.key = key;
    if (key.length !== 32) throw new SecretUnavailableError(`The local key-encryption key must be 32 bytes, not ${key.length}.`);
    this.id = `local:${version}`;
  }

  async wrap(dataKey: Buffer): Promise<string> {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const wrapped = Buffer.concat([cipher.update(dataKey), cipher.final()]);
    return [iv, cipher.getAuthTag(), wrapped].map((part) => part.toString('base64')).join('.');
  }

  async unwrap(value: string): Promise<Buffer> {
    const [iv, tag, wrapped] = value.split('.').map((part) => Buffer.from(part, 'base64'));
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(wrapped), decipher.final()]);
  }
}

export function parseKeyMaterial(raw: string | undefined | null): Buffer | null {
  const value = raw?.trim();
  if (!value) return null;
  const candidate = /^[0-9a-f]{64}$/i.test(value) ? Buffer.from(value, 'hex') : Buffer.from(value, 'base64');
  return candidate.length === 32 ? candidate : null;
}

/** What the credential document holds once opened. */
export type MailCredentialPayload =
  | { type: 'oauth'; refreshToken: string; scopes: string[]; tenant?: string | null }
  | { type: 'password'; username: string; password: string };
