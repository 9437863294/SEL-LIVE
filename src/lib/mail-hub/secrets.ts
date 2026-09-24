import 'server-only';

/**
 * Mail Hub — where connection secrets live.
 *
 * Refresh tokens and IMAP passwords are sealed with `envelope.ts` and stored in
 * `mailHubCredentials/{accountId}`, a collection `firestore.rules` denies to every client. The
 * key that wraps them never touches Firestore. Two supported sources, in order of preference:
 *
 *   1. **Cloud KMS** — `MAIL_HUB_KMS_KEY_NAME=projects/<p>/locations/<l>/keyRings/<r>/cryptoKeys/<k>`.
 *      The key material never leaves KMS; the server asks KMS to wrap and unwrap 32-byte data keys
 *      using the Firebase Admin service account (grant it `roles/cloudkms.cryptoKeyEncrypterDecrypter`
 *      on that key and nothing else). Every unwrap is in the KMS audit log.
 *   2. **A Secret Manager key** — `MAIL_HUB_TOKEN_KEY`, 32 random bytes (base64 or hex), bound into
 *      the App Hosting runtime from Secret Manager. `MAIL_HUB_TOKEN_KEY_PREVIOUS` keeps secrets sealed
 *      under the previous key readable while `scripts/mail-hub-rotate-keys.mjs` re-wraps them.
 *
 * With neither configured, connecting a mailbox fails with an operator-readable message. There is
 * no plaintext fallback, for the reason Office Hub gives: a default nobody notices is the one that
 * ends up in production.
 */

import { getApp } from 'firebase-admin/app';
import { FieldValue } from 'firebase-admin/firestore';

import { getFirebaseAdminFirestore } from '../firebase-admin';
import {
  LocalKeyWrapper,
  SecretUnavailableError,
  openSecret,
  parseKeyMaterial,
  sealSecret,
  type KeyWrapper,
  type MailCredentialPayload,
  type SealedSecret,
} from './envelope';
import { MAIL_HUB_COLLECTIONS, type MailProvider } from './model';

class GcpKmsKeyWrapper implements KeyWrapper {
  readonly id: string;
  private readonly keyName: string;
  constructor(keyName: string) {
    this.keyName = keyName;
    this.id = `gcp-kms:${keyName}`;
  }

  private async token(): Promise<string> {
    // Initialise the Admin app (and its credential) the same way every other route does.
    getFirebaseAdminFirestore();
    const credential = getApp().options.credential;
    if (!credential) throw new SecretUnavailableError('Firebase Admin has no credential to call Cloud KMS with.');
    const { access_token: accessToken } = await credential.getAccessToken();
    return accessToken;
  }

  private async call(verb: 'encrypt' | 'decrypt', body: Record<string, string>): Promise<Record<string, string>> {
    const response = await fetch(`https://cloudkms.googleapis.com/v1/${this.keyName}:${verb}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await this.token()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      const message = (json.error as { message?: string } | undefined)?.message ?? `HTTP ${response.status}`;
      throw new SecretUnavailableError(`Cloud KMS ${verb} failed: ${message}`);
    }
    return json as Record<string, string>;
  }

  async wrap(dataKey: Buffer): Promise<string> {
    const result = await this.call('encrypt', { plaintext: dataKey.toString('base64') });
    return result.ciphertext;
  }

  async unwrap(wrapped: string): Promise<Buffer> {
    const result = await this.call('decrypt', { ciphertext: wrapped });
    return Buffer.from(result.plaintext, 'base64');
  }
}

let cachedWrappers: KeyWrapper[] | null = null;

function keyWrappers(): KeyWrapper[] {
  if (cachedWrappers) return cachedWrappers;
  const wrappers: KeyWrapper[] = [];
  const kms = process.env.MAIL_HUB_KMS_KEY_NAME?.trim();
  if (kms) wrappers.push(new GcpKmsKeyWrapper(kms));
  const current = parseKeyMaterial(process.env.MAIL_HUB_TOKEN_KEY);
  if (current) wrappers.push(new LocalKeyWrapper(current, process.env.MAIL_HUB_TOKEN_KEY_VERSION?.trim() || 'v1'));
  const previous = parseKeyMaterial(process.env.MAIL_HUB_TOKEN_KEY_PREVIOUS);
  if (previous) wrappers.push(new LocalKeyWrapper(previous, process.env.MAIL_HUB_TOKEN_KEY_PREVIOUS_VERSION?.trim() || 'v0'));
  cachedWrappers = wrappers;
  return wrappers;
}

export function secretStoreProblems(): string[] {
  const problems: string[] = [];
  if (!process.env.MAIL_HUB_KMS_KEY_NAME?.trim() && !process.env.MAIL_HUB_TOKEN_KEY?.trim()) {
    problems.push(
      'Neither MAIL_HUB_KMS_KEY_NAME (Cloud KMS, recommended) nor MAIL_HUB_TOKEN_KEY (32-byte key from Secret Manager) is set. ' +
        'Mail Hub will not store mailbox credentials unencrypted.',
    );
  } else if (process.env.MAIL_HUB_TOKEN_KEY?.trim() && !parseKeyMaterial(process.env.MAIL_HUB_TOKEN_KEY)) {
    problems.push('MAIL_HUB_TOKEN_KEY is not a 32-byte base64 or hex value.');
  }
  return problems;
}

export function secretStoreConfigured(): boolean {
  return secretStoreProblems().length === 0 && keyWrappers().length > 0;
}

function primaryWrapper(): KeyWrapper {
  const wrapper = keyWrappers()[0];
  if (!wrapper) throw new SecretUnavailableError(secretStoreProblems().join(' ') || 'No key-encryption key is configured.');
  return wrapper;
}

const credentialDoc = (accountId: string) =>
  getFirebaseAdminFirestore().collection(MAIL_HUB_COLLECTIONS.credentials).doc(accountId);

export async function storeCredential(input: {
  accountId: string;
  ownerUserId: string;
  provider: MailProvider;
  payload: MailCredentialPayload;
}): Promise<void> {
  const sealed = await sealSecret(JSON.stringify(input.payload), input.accountId, primaryWrapper());
  await credentialDoc(input.accountId).set({
    accountId: input.accountId,
    ownerUserId: input.ownerUserId,
    provider: input.provider,
    sealed,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

export async function readCredential(accountId: string): Promise<MailCredentialPayload | null> {
  const snapshot = await credentialDoc(accountId).get();
  if (!snapshot.exists) return null;
  const sealed = snapshot.get('sealed') as SealedSecret | undefined;
  if (!sealed) return null;
  const opened = await openSecret(sealed, accountId, keyWrappers());
  return JSON.parse(opened) as MailCredentialPayload;
}

export async function deleteCredential(accountId: string): Promise<void> {
  await credentialDoc(accountId).delete();
}

/** Re-wrap one credential under the current primary key. Used by the rotation script. */
export async function rewrapCredential(accountId: string): Promise<boolean> {
  const snapshot = await credentialDoc(accountId).get();
  const sealed = snapshot.get('sealed') as SealedSecret | undefined;
  if (!sealed || sealed.kek === primaryWrapper().id) return false;
  const opened = await openSecret(sealed, accountId, keyWrappers());
  const next = await sealSecret(opened, accountId, primaryWrapper());
  await credentialDoc(accountId).update({ sealed: next, updatedAt: FieldValue.serverTimestamp() });
  return true;
}

export { SecretUnavailableError };
