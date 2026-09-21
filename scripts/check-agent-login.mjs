#!/usr/bin/env node
/**
 * Why can this person not sign in on the Windows Agent?
 *
 *   npm run check:agent-login -- someone@example.com
 *
 * Four things must all be true, and three of them fail with messages that point somewhere else:
 *
 *   1. The Firebase Web API key the agent holds is one Google accepts.
 *   2. The account exists in Firebase Authentication and is not disabled.
 *   3. A `users` document exists for it, and is not Inactive — the agent resolves the token to an
 *      application user and refuses a Firebase account with no SEL LIVE record behind it.
 *   4. The device is enrolled, approved, and the person is allowed to use it.
 *
 * Checks all four and says which one is the problem. Never needs the person's password: the key
 * probe deliberately sends a wrong one, because "is this key accepted" and "is this password
 * right" are different questions and only the first one needs asking here.
 *
 * Reads `.env` and `.env.local`, the same files the development server uses.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/* ── env ─────────────────────────────────────────────────────────────────────────────────────── */

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
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const env = {
  ...loadEnv(resolve(process.cwd(), '.env')),
  ...loadEnv(resolve(process.cwd(), '.env.local')),
};
for (const [key, value] of Object.entries(env)) {
  if (process.env[key] === undefined) process.env[key] = value;
}

const EMAIL = (process.argv[2] || '').trim();
if (!EMAIL) {
  console.error('usage: npm run check:agent-login -- someone@example.com');
  process.exit(2);
}

const AGENT_CONFIG = 'C:\\ProgramData\\SEL LIVE\\Agent\\agent.config.json';

const ok = (text) => console.log('  OK    ' + text);
const bad = (text) => console.log('  FAIL  ' + text);
const note = (text) => console.log('        ' + text);

let problems = 0;

/* ── 1. The key the agent actually holds ─────────────────────────────────────────────────────── */

async function checkApiKey() {
  let key = null;
  let url = null;

  if (existsSync(AGENT_CONFIG)) {
    try {
      const config = JSON.parse(readFileSync(AGENT_CONFIG, 'utf8'));
      key = config.firebaseApiKey;
      url = config.apiBaseUrl;
      ok('agent.config.json found, pointing at ' + url);
    } catch (error) {
      bad('agent.config.json exists but will not parse: ' + error.message);
      problems += 1;
      return;
    }
  } else {
    note('No agent.config.json on this machine — checking the server\'s key instead.');
  }

  // Fall back to what the server would hand a new agent.
  if (!key) {
    try {
      const response = await fetch((url || 'http://localhost:3000') + '/api/windows-agent/bootstrap');
      key = (await response.json()).firebaseApiKey;
    } catch (error) {
      bad('Could not reach the bootstrap endpoint: ' + error.message);
      problems += 1;
      return;
    }
  }

  const probe = await fetch(
    'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + key,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: EMAIL,
        password: 'deliberately-wrong-' + Date.now(),
        returnSecureToken: true,
      }),
    },
  ).catch((error) => ({ error }));

  if (probe.error) {
    bad('Could not reach Google Identity Toolkit: ' + probe.error.message);
    problems += 1;
    return;
  }

  const body = await probe.json().catch(() => ({}));
  const code = body?.error?.message || '';

  if (/INVALID_LOGIN_CREDENTIALS|INVALID_PASSWORD|EMAIL_NOT_FOUND/.test(code)) {
    // The expected answer to a wrong password, which is exactly what proves the key works.
    ok('Firebase API key is accepted by Google.');
  } else if (/API key not valid/i.test(code)) {
    bad('Firebase API key is REJECTED by Google.');
    note('Re-run: SEL.Agent.Service.exe --write-config --url <server> --key <key>');
    note('or delete agent.config.json and let the agent\'s setup window fetch it.');
    problems += 1;
  } else if (/OPERATION_NOT_ALLOWED/.test(code)) {
    bad('Email/password sign-in is disabled in this Firebase project.');
    note('Enable it under Firebase Console > Authentication > Sign-in method.');
    problems += 1;
  } else {
    bad('Unexpected answer from Identity Toolkit: ' + (code || 'HTTP ' + probe.status));
    problems += 1;
  }
}

/* ── 2, 3 and 4. The account, the user record and the device ─────────────────────────────────── */

async function checkAccount() {
  const { getApps, initializeApp, cert, applicationDefault } = await import('firebase-admin/app');
  const { getAuth } = await import('firebase-admin/auth');
  const { getFirestore } = await import('firebase-admin/firestore');

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  const hasServiceAccount = Boolean(
    projectId && clientEmail && privateKey?.includes('-----BEGIN PRIVATE KEY-----'),
  );

  if (!getApps().length) {
    initializeApp({
      credential: hasServiceAccount ? cert({ projectId, clientEmail, privateKey }) : applicationDefault(),
      projectId,
    });
  }

  let authUser = null;
  try {
    authUser = await getAuth().getUserByEmail(EMAIL);
    if (authUser.disabled) {
      bad('Firebase account exists but is DISABLED (uid ' + authUser.uid + ').');
      problems += 1;
    } else {
      ok('Firebase account exists and is enabled (uid ' + authUser.uid + ').');
    }
  } catch (error) {
    bad('No Firebase Authentication account for ' + EMAIL + '.');
    note('The agent signs in against Firebase, so the person needs an account there —');
    note('the same one they use on the SEL LIVE website.');
    problems += 1;
  }

  const db = getFirestore();
  const byUid = authUser ? await db.collection('users').doc(authUser.uid).get() : null;
  const byEmail = await db
    .collection('users')
    .where('email', '==', EMAIL.toLowerCase())
    .limit(2)
    .get()
    .catch(() => null);

  const record = byUid?.exists ? byUid : byEmail && !byEmail.empty ? byEmail.docs[0] : null;

  if (!record) {
    bad('No `users` document for ' + EMAIL + '.');
    note('Even with the right password the agent refuses: "This sign-in is not linked');
    note('to a SEL LIVE account." Create the user in Settings > User Management.');
    problems += 1;
    return null;
  }

  const data = record.data();
  if (data.status === 'Inactive') {
    bad('The SEL LIVE user is Inactive — sign-in is refused.');
    problems += 1;
  } else {
    ok('SEL LIVE user: ' + (data.name || record.id) + ' (role ' + (data.role || 'none') + ').');
  }
  if (!byUid?.exists) {
    note('Matched by email; the document id is not the Firebase uid. That is supported.');
  }

  return { userId: record.id, name: data.name || record.id };
}

async function checkDevices(user) {
  const { getFirestore } = await import('firebase-admin/firestore');
  const db = getFirestore();

  const devices = await db.collection('windowsDevices').get().catch(() => null);
  if (!devices || devices.empty) {
    bad('No computers are enrolled.');
    problems += 1;
    return;
  }

  const usable = devices.docs.filter((doc) => {
    const status = doc.data().status;
    return status === 'ACTIVE' || status === 'MAINTENANCE';
  });

  if (!usable.length) {
    bad(devices.size + ' computer(s) enrolled, none approved.');
    note('Approve with: npm run setup:windows-agent -- --approve');
    problems += 1;
    return;
  }
  ok(usable.length + ' of ' + devices.size + ' enrolled computer(s) are in service.');

  if (!user) return;

  const restriction = await db.collection('windowsUserAccess').doc(user.userId).get().catch(() => null);
  const allowedIds = restriction?.exists ? restriction.data().allowedDeviceIds || [] : [];

  const permitted = usable.filter((doc) => {
    const assigned = doc.data().assignedUserIds || [];
    if (assigned.length && !assigned.includes(user.userId)) return false;
    if (allowedIds.length && !allowedIds.includes(doc.id)) return false;
    return true;
  });

  if (!permitted.length) {
    bad(user.name + ' is not allowed to sign in on any enrolled computer.');
    note('Check /windows-agent/access and the device pages.');
    problems += 1;
  } else {
    ok(user.name + ' may sign in on ' + permitted.length + ' computer(s): '
      + permitted.slice(0, 5).map((doc) => doc.data().deviceName || doc.id).join(', '));
  }
}

/* ── main ────────────────────────────────────────────────────────────────────────────────────── */

console.log('\nWindows Agent sign-in check — ' + EMAIL);
console.log('-'.repeat(72));

await checkApiKey();
const user = await checkAccount();
await checkDevices(user);

console.log('-'.repeat(72));
console.log(problems === 0
  ? '\nEverything checks out. If sign-in still fails, the password is wrong.\n'
  : '\n' + problems + ' problem(s) found — see above.\n');

process.exit(problems === 0 ? 0 : 1);
