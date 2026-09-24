#!/usr/bin/env node
/**
 * Mail Hub — schema setup and migrations.
 *
 *   npm run migrate:mail-hub               # apply (idempotent — safe to run on every deploy)
 *   npm run migrate:mail-hub -- --dry-run  # print what would change, change nothing
 *   npm run migrate:mail-hub -- --check    # report configuration and document counts only
 *
 * Firestore has no schema, so "migration" here means three things:
 *
 *   1. **Settings.** Create `mailHubSettings/global` with the defaults if it does not exist, and —
 *      when `MAIL_HUB_IMAP_DEFAULT_HOST` is set — add the company IMAP/SMTP server as the first
 *      preset, so users can connect the Roundcube mailbox without an administrator typing it in.
 *   2. **Backfills.** Older documents gain fields added later (`schemaVersion` records how far a
 *      database has been brought): accounts get `loginIdentity`, `sync.generation` and a
 *      `watch.nextPollAt`; messages get `syncGeneration`; outbound messages get the composer fields.
 *      Each step only writes documents that lack the field.
 *   3. **Reminders of what cannot be scripted here**: composite indexes (`firebase deploy --only
 *      firestore:indexes`), the Firestore rules (maintained in the console for this project — see the
 *      header of firestore.rules), and the Cloud Scheduler job (scripts/setup-cloud-scheduler.sh).
 *
 * Reads `.env` and `.env.local`, like the development server.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function loadEnv(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index === -1) continue;
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    out[trimmed.slice(0, index).trim()] = value;
  }
  return out;
}
for (const [key, value] of Object.entries({ ...loadEnv(resolve(process.cwd(), '.env')), ...loadEnv(resolve(process.cwd(), '.env.local')) })) {
  if (process.env[key] === undefined) process.env[key] = value;
}

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const CHECK_ONLY = argv.includes('--check');
const SCHEMA_VERSION = 1;

const C = {
  accounts: 'mailHubAccounts',
  messages: 'mailHubMessages',
  outbound: 'mailHubOutbound',
  settings: 'mailHubSettings',
};

async function admin() {
  const { getApps, initializeApp, cert, applicationDefault } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  const hasServiceAccount = Boolean(projectId && clientEmail && privateKey?.includes('-----BEGIN PRIVATE KEY-----'));
  if (!hasServiceAccount && !process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_USE_APPLICATION_DEFAULT_CREDENTIALS !== 'true') {
    console.error('\nFirebase Admin credentials are not configured. See docs/firebase-admin-local.md.');
    process.exit(1);
  }
  if (!getApps().length) initializeApp({ credential: hasServiceAccount ? cert({ projectId, clientEmail, privateKey }) : applicationDefault(), projectId });
  return getFirestore();
}

function configurationReport() {
  const has = (name) => Boolean(process.env[name]?.trim());
  const rows = [
    ['Secret store', has('MAIL_HUB_KMS_KEY_NAME') ? 'Cloud KMS' : has('MAIL_HUB_TOKEN_KEY') ? 'Secret Manager key (MAIL_HUB_TOKEN_KEY)' : 'MISSING — no mailbox can be connected'],
    ['Google', has('MAIL_HUB_GOOGLE_CLIENT_ID') || has('GOOGLE_OAUTH_CLIENT_ID') ? 'configured' : 'not configured'],
    ['Gmail push', has('MAIL_HUB_GMAIL_PUBSUB_TOPIC') ? `topic set; auth ${has('MAIL_HUB_GMAIL_PUSH_SERVICE_ACCOUNT') ? 'OIDC' : has('MAIL_HUB_GMAIL_PUSH_TOKEN') ? 'token' : 'MISSING'}` : 'off (polling every 30 min + on demand)'],
    ['Microsoft', has('MAIL_HUB_MICROSOFT_CLIENT_ID') && has('MAIL_HUB_MICROSOFT_CLIENT_SECRET') ? `configured (tenant ${process.env.MAIL_HUB_MICROSOFT_TENANT || 'organizations'})` : 'not configured'],
    ['Company IMAP default', has('MAIL_HUB_IMAP_DEFAULT_HOST') ? process.env.MAIL_HUB_IMAP_DEFAULT_HOST : 'none (add servers in Mail Hub › Permissions & sharing)'],
    ['Worker secret', has('CRON_SECRET') ? 'set' : 'MISSING — the worker will refuse to run'],
    ['Attachment scanner', has('MAIL_HUB_SCAN_URL') ? 'configured' : 'none (files marked "not scanned")'],
    ['Safe Browsing', has('MAIL_HUB_SAFE_BROWSING_KEY') ? 'configured' : 'none (heuristic link warnings only)'],
    ['AI', has('GEMINI_API_KEY') ? 'configured (still opt-in per user)' : 'not configured'],
  ];
  console.log('\nMail Hub configuration (names only, never values):');
  for (const [label, value] of rows) console.log(`  ${label.padEnd(22)} ${value}`);
}

async function backfill(db, collection, needs, patchFor, label) {
  let scanned = 0;
  let changed = 0;
  let cursor = null;
  for (;;) {
    let query = db.collection(collection).orderBy('__name__').limit(400);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    if (page.empty) break;
    const batch = db.batch();
    let pending = 0;
    for (const doc of page.docs) {
      scanned += 1;
      const data = doc.data();
      if (!needs(data)) continue;
      changed += 1;
      if (!DRY_RUN) {
        batch.set(doc.ref, patchFor(data), { merge: true });
        pending += 1;
      }
    }
    if (pending) await batch.commit();
    cursor = page.docs[page.docs.length - 1];
    if (page.size < 400) break;
  }
  console.log(`  ${label.padEnd(34)} scanned ${scanned}, ${DRY_RUN ? 'would update' : 'updated'} ${changed}`);
}

async function main() {
  configurationReport();
  const db = await admin();

  if (CHECK_ONLY) {
    console.log('\nDocument counts:');
    for (const name of ['mailHubAccounts', 'mailHubMessages', 'mailHubThreads', 'mailHubSharedMailboxes', 'mailHubMailboxMembers', 'mailHubOutbound', 'mailHubJobs']) {
      const count = await db.collection(name).count().get();
      console.log(`  ${name.padEnd(26)} ${count.data().count}`);
    }
    const dead = await db.collection('mailHubJobs').where('status', '==', 'dead').count().get();
    console.log(`  dead-lettered jobs          ${dead.data().count}`);
    return;
  }

  console.log(`\n${DRY_RUN ? '[dry run] ' : ''}Settings:`);
  const settingsRef = db.collection(C.settings).doc('global');
  const settings = await settingsRef.get();
  const current = settings.exists ? settings.data() : null;
  const next = {
    imapServers: current?.imapServers ?? [],
    enabledProviders: current?.enabledProviders ?? ['gmail', 'microsoft', 'imap'],
    defaultSyncWindowDays: current?.defaultSyncWindowDays ?? 90,
    bodyCacheDays: current?.bodyCacheDays ?? 14,
    uploadRetentionDays: current?.uploadRetentionDays ?? 7,
    maxAttachmentBytes: current?.maxAttachmentBytes ?? 20 * 1024 * 1024,
    updatedAt: current?.updatedAt ?? new Date().toISOString(),
    updatedById: current?.updatedById ?? 'migration',
    schemaVersion: SCHEMA_VERSION,
  };
  const host = process.env.MAIL_HUB_IMAP_DEFAULT_HOST?.trim().toLowerCase();
  if (host && !next.imapServers.some((preset) => preset.imapHost === host)) {
    const security = (value, fallback) => (value === 'starttls' ? 'starttls' : value === 'tls' ? 'tls' : fallback);
    next.imapServers.push({
      id: 'company-default',
      label: process.env.MAIL_HUB_IMAP_DEFAULT_LABEL?.trim() || 'Company mail',
      imapHost: host,
      imapPort: Number(process.env.MAIL_HUB_IMAP_DEFAULT_PORT || 993),
      imapSecurity: security(process.env.MAIL_HUB_IMAP_DEFAULT_SECURITY, 'tls'),
      smtpHost: (process.env.MAIL_HUB_SMTP_DEFAULT_HOST || host).trim().toLowerCase(),
      smtpPort: Number(process.env.MAIL_HUB_SMTP_DEFAULT_PORT || 465),
      smtpSecurity: security(process.env.MAIL_HUB_SMTP_DEFAULT_SECURITY, 'tls'),
      usernameStyle: process.env.MAIL_HUB_IMAP_DEFAULT_USERNAME_STYLE === 'local-part' ? 'local-part' : 'email',
      allowedDomains: (process.env.MAIL_HUB_IMAP_DEFAULT_DOMAINS || '').split(/[,\s]+/).filter(Boolean),
      smtpEnforcesSender: process.env.MAIL_HUB_SMTP_DEFAULT_ENFORCES_SENDER === 'true',
      appendSentCopy: process.env.MAIL_HUB_SMTP_DEFAULT_APPEND_SENT !== 'false',
    });
    console.log(`  adding IMAP preset for ${host}`);
  }
  console.log(`  mailHubSettings/global ${settings.exists ? 'exists' : 'created'} (schema v${SCHEMA_VERSION})`);
  if (!DRY_RUN) await settingsRef.set(next, { merge: true });

  console.log(`\n${DRY_RUN ? '[dry run] ' : ''}Backfills:`);
  await backfill(
    db,
    C.accounts,
    (data) => data.loginIdentity === undefined || data.sync?.generation === undefined || data.watch?.nextPollAt === undefined,
    (data) => ({
      loginIdentity: data.loginIdentity ?? data.emailAddress ?? null,
      sync: { generation: data.sync?.generation ?? 1, pendingRefetch: data.sync?.pendingRefetch ?? [] },
      watch: { nextPollAt: data.watch?.nextPollAt ?? new Date().toISOString() },
    }),
    'accounts: loginIdentity/generation/poll',
  );
  await backfill(db, C.messages, (data) => data.syncGeneration === undefined, () => ({ syncGeneration: 1 }), 'messages: syncGeneration');
  await backfill(
    db,
    C.outbound,
    (data) => data.composerBodyHtml === undefined || data.forwardedAttachments === undefined,
    (data) => ({
      composerBodyHtml: data.composerBodyHtml ?? data.html ?? '',
      signatureId: data.signatureId ?? null,
      includeQuote: data.includeQuote ?? true,
      forwardedAttachments: data.forwardedAttachments ?? [],
      sourceAccountId: data.sourceAccountId ?? data.accountId ?? null,
    }),
    'outbound: composer fields',
  );

  console.log(`
Still to do outside this script (see docs/mail-hub.md § Deployment):
  • firebase deploy --only firestore:indexes,storage
  • copy the Mail Hub blocks of firestore.rules into the console ruleset, then run
    Mail Hub › Permissions & sharing › Connection settings › Check security rules
  • ./scripts/setup-cloud-scheduler.sh   (creates the every-minute mail-hub-worker job)
`);
}

main().catch((error) => {
  console.error('\nMigration failed:', error);
  process.exit(1);
});
