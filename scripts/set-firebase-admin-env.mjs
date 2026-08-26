#!/usr/bin/env node
/**
 * Write Firebase Admin service-account credentials into `.env` from a downloaded key file.
 *
 *   node scripts/set-firebase-admin-env.mjs ~/Downloads/module-hub-uc7tw-firebase-adminsdk-xxxxx.json
 *
 * ── Why this exists rather than "paste the key into .env" ───────────────────────────────────────
 *
 * The private key is ~1,700 characters of base64 across 28 lines. Pasting it into a `.env` file goes
 * wrong in the same few ways every time, and each one produces a different unhelpful error hours
 * later:
 *
 *   - The real newlines survive unquoted, so the parser reads only the first line and the key is
 *     silently truncated.
 *   - An editor "helpfully" wraps or trims the trailing newline, and OpenSSL rejects the key.
 *   - The `\n` sequences get double-escaped to `\\n`, so `firebase-admin` receives literal
 *     backslashes and fails with `error:0909006C:PEM routines:get_name:no start line`.
 *
 * This reads the JSON that Firebase actually gives you and writes the one format that works, so none
 * of that is possible.
 *
 * It never prints the key. The confirmation is a short SHA-256 fingerprint, which is enough to check
 * that two machines hold the same credential without putting the credential in a terminal history.
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';

const KEYS = ['FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY'];
const ENV_PATH = resolve(process.cwd(), '.env');

function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

/* ── The key file ── */

const input = process.argv[2];
if (!input) {
  fail(
    'Usage: node scripts/set-firebase-admin-env.mjs <path-to-service-account.json>\n\n' +
      'Download the file from the Firebase console:\n' +
      '  Project settings → Service accounts → Generate new private key',
  );
}

const keyPath = resolve(process.cwd(), input);
if (!existsSync(keyPath)) fail(`No file at ${keyPath}`);

let account;
try {
  account = JSON.parse(readFileSync(keyPath, 'utf8'));
} catch (error) {
  fail(
    `${keyPath} is not valid JSON (${error.message}).\n` +
      'Pass the service-account file Firebase downloads, not a copied fragment of it.',
  );
}

for (const field of ['project_id', 'client_email', 'private_key']) {
  if (!account[field]) fail(`${keyPath} has no "${field}". This does not look like a service-account key.`);
}
if (!String(account.private_key).includes('-----BEGIN PRIVATE KEY-----')) {
  fail('The "private_key" field does not contain a PEM key. The file may be truncated.');
}

/* ── The existing .env ── */

const existing = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf8') : '';
const currentProject = existing.match(/^FIREBASE_PROJECT_ID=(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '');

/**
 * Refuse a key for a different project.
 *
 * This is the one failure worth stopping for: a key from the wrong project *works*, and writes to the
 * wrong database. Nothing errors, the data just goes somewhere else — which is far harder to notice
 * than a credential that does not load at all.
 */
if (currentProject && currentProject !== account.project_id) {
  fail(
    `This key is for project "${account.project_id}" but .env is configured for "${currentProject}".\n\n` +
      'A key from the wrong project does not error — it writes to the wrong database. Download the\n' +
      `key from the ${currentProject} project, or change FIREBASE_PROJECT_ID deliberately first.`,
  );
}

const values = {
  FIREBASE_PROJECT_ID: account.project_id,
  FIREBASE_CLIENT_EMAIL: account.client_email,
  // The only format that survives a `.env` round trip: one line, double-quoted, real newlines encoded
  // as the two characters `\` and `n`. `firebase-admin.ts` turns them back with `.replace(/\\n/g,'\n')`.
  FIREBASE_PRIVATE_KEY: String(account.private_key).replace(/\r?\n/g, '\\n'),
};

/** Replace the line if the key is present (even when empty), append it otherwise. */
let output = existing;
const changes = [];
for (const key of KEYS) {
  const line = `${key}="${values[key]}"`;
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  if (pattern.test(output)) {
    // Compared on the parsed *value*, not the raw line: an unquoted line that gains quotes has not
    // changed in any way that matters, and reporting it as an update is noise.
    const before = output.match(pattern)[0].slice(key.length + 1).trim().replace(/^["']|["']$/g, '');
    if (before === values[key]) {
      changes.push(`  = ${key} (already correct)`);
      continue;
    }
    output = output.replace(pattern, line);
    changes.push(`  ~ ${key} ${before ? 'replaced' : 'filled in'}`);
  } else {
    output = `${output.replace(/\s*$/, '')}\n${line}\n`;
    changes.push(`  + ${key} added`);
  }
}

/**
 * Clear an empty `GOOGLE_APPLICATION_CREDENTIALS`.
 *
 * `firebase-admin.ts` treats a *set* value as "use application-default credentials", and an empty
 * string is falsy so it does no harm today — but leaving it invites somebody to fill it in later and
 * end up with two credential sources disagreeing. Commented out instead of deleted, so the option
 * stays discoverable.
 */
output = output.replace(
  /^GOOGLE_APPLICATION_CREDENTIALS=\s*$/m,
  '# GOOGLE_APPLICATION_CREDENTIALS=  # unused: the three FIREBASE_* vars above take precedence',
);

writeFileSync(ENV_PATH, output, 'utf8');

/* ── Report ── */

const fingerprint = createHash('sha256').update(account.private_key).digest('hex').slice(0, 12);

console.log(`\n✔ Wrote Admin SDK credentials to ${relative(process.cwd(), ENV_PATH) || '.env'}\n`);
console.log(changes.join('\n'));
console.log(`\n  project      ${account.project_id}`);
console.log(`  client       ${account.client_email}`);
console.log(`  key SHA-256  ${fingerprint}…  (the key itself is never printed)`);

const insideRepo = !relative(process.cwd(), keyPath).startsWith('..') && !isAbsolute(relative(process.cwd(), keyPath));
if (insideRepo) {
  console.log(
    '\n⚠ The key file is inside the repository. Move or delete it — `.env` is gitignored,\n' +
      '  a stray *-firebase-adminsdk-*.json is not necessarily.',
  );
}

console.log('\nNext: restart the dev server. Env vars are read at startup, so a running one will not pick this up.\n');
