#!/usr/bin/env node
/**
 * Prove the Admin SDK credentials actually work.
 *
 *   npm run firebase:admin-check
 *
 * Checking that the variables are *present* is not the same as checking they *work*: a truncated key
 * is present, a key from the wrong project is present, a revoked key is present. This does a real
 * signed round trip to Firestore, so a pass means the API routes will work.
 *
 * Reads `.env` directly rather than relying on the shell, because that is the file Next.js reads and
 * the one where the mistake will be.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ENV_PATH = resolve(process.cwd(), '.env');

/**
 * A deliberately small `.env` parser.
 *
 * Only what this file needs: `KEY=value`, optionally double-quoted, `#` comments skipped. Importing
 * `dotenv` for one read would add a dependency to a diagnostic whose whole job is to have no moving
 * parts of its own.
 */
function loadEnv(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const env = { ...loadEnv(ENV_PATH), ...loadEnv(resolve(process.cwd(), '.env.local')) };
// The real process env wins, matching how a deployment overrides a file.
for (const key of ['FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY', 'GOOGLE_APPLICATION_CREDENTIALS']) {
  if (process.env[key]) env[key] = process.env[key];
}

const projectId = env.FIREBASE_PROJECT_ID;
const clientEmail = env.FIREBASE_CLIENT_EMAIL;
const privateKey = env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

console.log('\nFirebase Admin credentials\n');

const problems = [];
const say = (label, ok, detail) => console.log(`  ${ok ? '✔' : '✖'} ${label.padEnd(32)} ${detail}`);

say('FIREBASE_PROJECT_ID', Boolean(projectId), projectId || 'missing');
if (!projectId) problems.push('FIREBASE_PROJECT_ID is not set.');

say('FIREBASE_CLIENT_EMAIL', Boolean(clientEmail), clientEmail || 'missing');
if (!clientEmail) problems.push('FIREBASE_CLIENT_EMAIL is not set.');

/* ── The key, checked in the order the failures actually happen ── */

if (!privateKey) {
  say('FIREBASE_PRIVATE_KEY', false, 'missing or empty');
  problems.push('FIREBASE_PRIVATE_KEY is empty. Run: npm run firebase:admin-env <key.json>');
} else if (privateKey.includes('\\n')) {
  // Survives `.replace(/\\n/g,'\n')` only if it was double-escaped in the file.
  say('FIREBASE_PRIVATE_KEY', false, 'contains literal \\\\n — double-escaped');
  problems.push('The key is double-escaped. Re-run: npm run firebase:admin-env <key.json>');
} else if (!privateKey.includes('-----BEGIN PRIVATE KEY-----') || !privateKey.includes('-----END PRIVATE KEY-----')) {
  say('FIREBASE_PRIVATE_KEY', false, 'no PEM header/footer');
  problems.push('The key is missing its BEGIN/END lines — usually a truncated paste.');
} else if (!privateKey.trimEnd().endsWith('-----END PRIVATE KEY-----')) {
  say('FIREBASE_PRIVATE_KEY', false, 'trailing content after END');
  problems.push('There is content after the END line. Check for a stray quote.');
} else if (privateKey.split('\n').filter(Boolean).length < 3) {
  // A single-line PEM body means the newlines were lost, which OpenSSL rejects.
  say('FIREBASE_PRIVATE_KEY', false, 'newlines were lost');
  problems.push('The key has no line breaks. Re-run: npm run firebase:admin-env <key.json>');
} else {
  say('FIREBASE_PRIVATE_KEY', true, `PEM, ${privateKey.split('\n').filter(Boolean).length} lines`);
}

if (env.GOOGLE_APPLICATION_CREDENTIALS) {
  const path = resolve(process.cwd(), env.GOOGLE_APPLICATION_CREDENTIALS);
  say('GOOGLE_APPLICATION_CREDENTIALS', existsSync(path), existsSync(path) ? path : `set but no file at ${path}`);
  if (!existsSync(path)) {
    problems.push('GOOGLE_APPLICATION_CREDENTIALS points at a file that does not exist. Blank it out or fix the path.');
  }
}

if (problems.length) {
  console.log('\n' + problems.map((problem) => `  → ${problem}`).join('\n') + '\n');
  process.exit(1);
}

/* ── The part that matters: a real call ── */

console.log('\n  Connecting…');

const { initializeApp, cert } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');

try {
  const app = initializeApp({ credential: cert({ projectId, clientEmail, privateKey }), projectId });

  // A collection that is not expected to exist. The point is the *authenticated round trip*; reading
  // real data would work too but would print somebody's employee record into a terminal.
  const snapshot = await getFirestore(app).collection('__admin_sdk_check__').limit(1).get();

  console.log(`\n✔ Connected to ${projectId}. Firestore answered (${snapshot.size} docs in the probe collection).`);
  console.log('\n  The greytHR sync, employee picker, documents and linking routes will all work now.');
  console.log('  Restart the dev server if it is already running — env vars are read at startup.\n');
  process.exit(0);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\n✖ Could not reach Firestore as ${clientEmail}\n\n  ${message}\n`);

  // The three failures that look identical in the browser but have different fixes.
  if (/PEM routines|DECODER|no start line|asn1/i.test(message)) {
    console.error('  The key is malformed rather than wrong. Re-run: npm run firebase:admin-env <key.json>\n');
  } else if (/invalid_grant|Invalid JWT|invalid_client/i.test(message)) {
    console.error(
      '  The key is well-formed but rejected. Either it was deleted in the console (keys revoked\n' +
        '  there stop working immediately) or this machine\'s clock is off — a signed JWT with a skewed\n' +
        '  timestamp is refused. Check the time, then generate a fresh key.\n',
    );
  } else if (/PERMISSION_DENIED|Missing or insufficient permissions/i.test(message)) {
    console.error(
      '  Authentication worked; authorisation did not. The service account needs a Firestore role\n' +
        '  (Cloud Datastore User is enough) in Google Cloud IAM for this project.\n',
    );
  } else if (/NOT_FOUND|does not exist/i.test(message)) {
    console.error(`  Authentication worked, but ${projectId} has no Firestore database. Create one in the console.\n`);
  }
  process.exit(1);
}
