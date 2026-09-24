#!/usr/bin/env node
/**
 * Mail Hub — rotate the Secret Manager key that wraps mailbox credentials.
 *
 *   1. Put the new 32-byte key in MAIL_HUB_TOKEN_KEY (and bump MAIL_HUB_TOKEN_KEY_VERSION, e.g. v2),
 *      and the old one in MAIL_HUB_TOKEN_KEY_PREVIOUS (with MAIL_HUB_TOKEN_KEY_PREVIOUS_VERSION=v1).
 *      Deploy: the app now seals with the new key and can still open secrets sealed with the old one.
 *   2. Run this script with the same variables:  npm run mail-hub:rotate-keys  [-- --dry-run]
 *      It re-wraps every credential still sealed under the previous key. Only the 32-byte data key
 *      of each credential is re-wrapped; the refresh token or password itself never changes.
 *   3. Once it reports 0 remaining, remove MAIL_HUB_TOKEN_KEY_PREVIOUS and deploy again.
 *
 * Cloud KMS (MAIL_HUB_KMS_KEY_NAME) needs none of this: rotate the key version in KMS and it keeps
 * decrypting under older versions automatically.
 *
 * Run with: node --experimental-strip-types scripts/mail-hub-rotate-keys.mjs
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { LocalKeyWrapper, openSecret, parseKeyMaterial, sealSecret } from '../src/lib/mail-hub/envelope.ts';

for (const file of ['.env', '.env.local']) {
  const path = resolve(process.cwd(), file);
  if (!existsSync(path)) continue;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}

const DRY_RUN = process.argv.includes('--dry-run');
const current = parseKeyMaterial(process.env.MAIL_HUB_TOKEN_KEY);
const previous = parseKeyMaterial(process.env.MAIL_HUB_TOKEN_KEY_PREVIOUS);
if (!current || !previous) {
  console.error('Set both MAIL_HUB_TOKEN_KEY (new) and MAIL_HUB_TOKEN_KEY_PREVIOUS (old), as 32-byte base64 or hex values.');
  process.exit(1);
}
const primary = new LocalKeyWrapper(current, process.env.MAIL_HUB_TOKEN_KEY_VERSION?.trim() || 'v1');
const old = new LocalKeyWrapper(previous, process.env.MAIL_HUB_TOKEN_KEY_PREVIOUS_VERSION?.trim() || 'v0');
if (primary.id === old.id) {
  console.error('The two keys have the same version label; set MAIL_HUB_TOKEN_KEY_VERSION to a new value (for example v2).');
  process.exit(1);
}

const { getApps, initializeApp, cert, applicationDefault } = await import('firebase-admin/app');
const { getFirestore, FieldValue } = await import('firebase-admin/firestore');
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
if (!getApps().length) {
  initializeApp({
    credential: process.env.FIREBASE_CLIENT_EMAIL && privateKey ? cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey }) : applicationDefault(),
    projectId: process.env.FIREBASE_PROJECT_ID,
  });
}
const db = getFirestore();

let rewrapped = 0;
let alreadyCurrent = 0;
let unreadable = 0;
const snapshot = await db.collection('mailHubCredentials').get();
for (const doc of snapshot.docs) {
  const sealed = doc.get('sealed');
  if (!sealed) continue;
  if (sealed.kek === primary.id) {
    alreadyCurrent += 1;
    continue;
  }
  if (sealed.kek !== old.id) {
    console.warn(`  ${doc.id}: sealed with ${sealed.kek}, which is neither key — skipped`);
    unreadable += 1;
    continue;
  }
  try {
    const plaintext = await openSecret(sealed, doc.id, [old]);
    if (!DRY_RUN) await doc.ref.update({ sealed: await sealSecret(plaintext, doc.id, primary), updatedAt: FieldValue.serverTimestamp() });
    rewrapped += 1;
  } catch (error) {
    console.warn(`  ${doc.id}: could not be opened (${error.message}) — the owner will need to reconnect`);
    unreadable += 1;
  }
}
console.log(`${DRY_RUN ? '[dry run] ' : ''}Re-wrapped ${rewrapped}; already current ${alreadyCurrent}; unreadable ${unreadable}; remaining under the old key: ${DRY_RUN ? rewrapped : 0}.`);
