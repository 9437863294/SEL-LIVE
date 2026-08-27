#!/usr/bin/env node
/**
 * Prove that the Firebase Admin credentials work against both Firestore and Firebase Auth.
 *
 *   npm run firebase:admin-check
 *
 * Supports either a service-account private key or keyless Application Default Credentials (ADC).
 * Reads `.env` and `.env.local`, matching the files used by the Next.js development server.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ENV_PATH = resolve(process.cwd(), '.env');

function loadEnv(path) {
  if (!existsSync(path)) return {};

  const out = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const equalsIndex = trimmed.indexOf('=');
    if (equalsIndex === -1) continue;

    const key = trimmed.slice(0, equalsIndex).trim();
    let value = trimmed.slice(equalsIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1)
      || (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const env = { ...loadEnv(ENV_PATH), ...loadEnv(resolve(process.cwd(), '.env.local')) };
for (const key of [
  'FIREBASE_PROJECT_ID',
  'FIREBASE_CLIENT_EMAIL',
  'FIREBASE_PRIVATE_KEY',
  'FIREBASE_USE_APPLICATION_DEFAULT_CREDENTIALS',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GOOGLE_CLOUD_PROJECT',
]) {
  if (process.env[key]) env[key] = process.env[key];
}

const projectId = env.FIREBASE_PROJECT_ID || env.GOOGLE_CLOUD_PROJECT;
const clientEmail = env.FIREBASE_CLIENT_EMAIL;
const privateKey = env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
const requestedApplicationDefault =
  env.FIREBASE_USE_APPLICATION_DEFAULT_CREDENTIALS?.trim().toLowerCase() === 'true';
const useApplicationDefault = requestedApplicationDefault || Boolean(env.GOOGLE_APPLICATION_CREDENTIALS);

console.log('\nFirebase Admin credentials\n');

const problems = [];
const say = (label, ok, detail) => console.log(`  ${ok ? 'OK' : '!!'} ${label.padEnd(44)} ${detail}`);

say(
  'Credential mode',
  true,
  useApplicationDefault ? 'Application Default Credentials (keyless)' : 'service-account private key',
);
say('FIREBASE_PROJECT_ID', Boolean(projectId), projectId || 'missing');
if (!projectId) problems.push('Set FIREBASE_PROJECT_ID (or GOOGLE_CLOUD_PROJECT).');

if (useApplicationDefault) {
  say(
    'FIREBASE_USE_APPLICATION_DEFAULT_CREDENTIALS',
    requestedApplicationDefault,
    requestedApplicationDefault ? 'true' : 'not needed because GOOGLE_APPLICATION_CREDENTIALS is set',
  );

  if (env.GOOGLE_APPLICATION_CREDENTIALS) {
    const credentialPath = resolve(process.cwd(), env.GOOGLE_APPLICATION_CREDENTIALS);
    const credentialExists = existsSync(credentialPath);
    say(
      'GOOGLE_APPLICATION_CREDENTIALS',
      credentialExists,
      credentialExists ? credentialPath : `set but no file at ${credentialPath}`,
    );
    if (!credentialExists) {
      problems.push('GOOGLE_APPLICATION_CREDENTIALS points at a file that does not exist.');
    }
  } else {
    const gcloudConfigDirectory = process.env.CLOUDSDK_CONFIG
      || (process.platform === 'win32' && process.env.APPDATA
        ? resolve(process.env.APPDATA, 'gcloud')
        : process.env.HOME
          ? resolve(process.env.HOME, '.config', 'gcloud')
          : '');
    const adcPath = gcloudConfigDirectory
      ? resolve(gcloudConfigDirectory, 'application_default_credentials.json')
      : '';
    const adcExists = Boolean(adcPath && existsSync(adcPath));
    say('gcloud ADC file', adcExists, adcExists ? adcPath : 'not found');
    if (!adcExists) {
      problems.push(
        'No local ADC file was found. Install gcloud, then run `gcloud auth application-default login`.',
      );
    }
  }
} else {
  say('FIREBASE_CLIENT_EMAIL', Boolean(clientEmail), clientEmail || 'missing');
  if (!clientEmail) problems.push('FIREBASE_CLIENT_EMAIL is not set.');

  if (!privateKey) {
    say('FIREBASE_PRIVATE_KEY', false, 'missing or empty');
    problems.push(
      'FIREBASE_PRIVATE_KEY is empty. If key creation is blocked, use keyless ADC instead.',
    );
  } else if (privateKey.includes('\\n')) {
    say('FIREBASE_PRIVATE_KEY', false, 'contains literal \\n - double-escaped');
    problems.push('The key is double-escaped. Re-run: npm run firebase:admin-env <key.json>');
  } else if (
    !privateKey.includes('-----BEGIN PRIVATE KEY-----')
    || !privateKey.includes('-----END PRIVATE KEY-----')
  ) {
    say('FIREBASE_PRIVATE_KEY', false, 'no PEM header/footer');
    problems.push('The key is missing its BEGIN/END lines, usually because it was truncated.');
  } else if (!privateKey.trimEnd().endsWith('-----END PRIVATE KEY-----')) {
    say('FIREBASE_PRIVATE_KEY', false, 'trailing content after END');
    problems.push('There is content after the END line. Check for a stray quote.');
  } else if (privateKey.split('\n').filter(Boolean).length < 3) {
    say('FIREBASE_PRIVATE_KEY', false, 'newlines were lost');
    problems.push('The key has no line breaks. Re-run: npm run firebase:admin-env <key.json>');
  } else {
    say('FIREBASE_PRIVATE_KEY', true, `PEM, ${privateKey.split('\n').filter(Boolean).length} lines`);
  }
}

if (problems.length) {
  console.log(`\n${problems.map((problem) => `  -> ${problem}`).join('\n')}\n`);
  process.exit(1);
}

console.log('\n  Connecting...');

const { applicationDefault, cert, initializeApp } = await import('firebase-admin/app');
const { getAuth } = await import('firebase-admin/auth');
const { getFirestore } = await import('firebase-admin/firestore');

let operation = 'Firestore';
try {
  const credential = useApplicationDefault
    ? applicationDefault()
    : cert({ projectId, clientEmail, privateKey });
  const app = initializeApp({ credential, projectId });

  // This probe prints no application data.
  const snapshot = await getFirestore(app).collection('__admin_sdk_check__').limit(1).get();
  console.log(`\n  OK Firestore answered (${snapshot.size} docs in the probe collection).`);

  // User creation needs Firebase Authentication IAM in addition to Firestore IAM. This is read-only
  // and deliberately discards the returned account rather than printing user data.
  operation = 'Firebase Authentication';
  await getAuth(app).listUsers(1);

  console.log(`  OK Firebase Authentication answered for ${projectId}.`);
  console.log('\n  Firebase Admin is ready for greytHR preview/sync and user creation.');
  console.log('  Restart the dev server if it is already running; env vars are read at startup.\n');
  process.exit(0);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const identity = useApplicationDefault ? 'Application Default Credentials' : clientEmail;
  console.error(`\n  FAILED ${operation} as ${identity}\n\n  ${message}\n`);

  if (operation === 'Firebase Authentication' && useApplicationDefault) {
    console.error(
      '  Firestore worked, but Firebase Authentication rejected these ADC credentials. Use\n'
        + '  service-account impersonation (recommended) or ADC created with your own desktop OAuth\n'
        + '  client, then run this check again.\n',
    );
  }

  if (/PEM routines|DECODER|no start line|asn1/i.test(message)) {
    console.error('  The private key is malformed. Re-run: npm run firebase:admin-env <key.json>\n');
  } else if (/invalid_grant|Invalid JWT|invalid_client/i.test(message)) {
    console.error(
      '  The credential was rejected. Check the machine clock and credential configuration.\n',
    );
  } else if (/PERMISSION_DENIED|Missing or insufficient permissions|permission/i.test(message)) {
    console.error(
      `  Authentication worked, but the identity lacks permission for ${operation}. Ask your Google\n`
        + '  Cloud administrator to grant only the roles this application requires.\n',
    );
  } else if (/NOT_FOUND|does not exist/i.test(message)) {
    console.error(
      `  Authentication worked, but ${projectId} does not have the required Firebase service enabled.\n`,
    );
  }
  process.exit(1);
}
