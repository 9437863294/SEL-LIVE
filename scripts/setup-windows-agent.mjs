#!/usr/bin/env node
/**
 * Get a Windows Agent installation to the point where a PC can actually enrol.
 *
 *   npm run setup:windows-agent                        # status + create a dev enrolment code
 *   npm run setup:windows-agent -- --code SEL-HO-2026  # a specific code
 *   npm run setup:windows-agent -- --auto-approve      # skip the approval step (pilots only)
 *   npm run setup:windows-agent -- --status            # report only, change nothing
 *
 * ── Why this exists ────────────────────────────────────────────────────────────────────────────
 *
 * Four things have to be true before an agent can enrol, and three of them are invisible until
 * something fails with an unhelpful message:
 *
 *   1. An enrolment code exists in Firestore.
 *   2. The application catalogue is seeded, so the first reports are readable.
 *   3. Somebody holds the Windows Agent permissions, or every admin screen refuses.
 *   4. The composite indexes are deployed, or every report returns an index error.
 *
 * This script does (1) and (2), and *reports* on (3) and (4) rather than changing them — granting
 * permissions and deploying indexes are decisions, not setup steps, and a script that quietly gave
 * somebody fleet-wide monitoring access would be exactly the wrong kind of convenience.
 *
 * Safe to run repeatedly: the code is only created if absent, and the catalogue seed skips rows
 * that already exist.
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

/* ── arguments ───────────────────────────────────────────────────────────────────────────────── */

const argv = process.argv.slice(2);
const STATUS_ONLY = argv.includes('--status');
const AUTO_APPROVE = argv.includes('--auto-approve');

/**
 * Approve every device currently waiting.
 *
 * A pilot convenience, and kept separate from --auto-approve on purpose: that one changes the
 * enrolment code so future machines skip approval, which is a standing decision. This one
 * approves the machines already in the queue, once.
 */
const APPROVE_PENDING = argv.includes('--approve');

function argValue(name, fallback) {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
}

const CODE = String(argValue('--code', 'SEL-DEV-LOCAL')).toUpperCase();

const C = {
  devices: 'windowsDevices',
  enrollmentCodes: 'windowsEnrollmentCodes',
  appCatalog: 'windowsAppCatalog',
  sessions: 'windowsSessions',
  settings: 'windowsAgentSettings',
  users: 'users',
  roles: 'roles',
};

/**
 * The built-in application catalogue.
 *
 * A trimmed copy of `DEFAULT_APP_CATALOG` in `src/lib/windows-agent-rules.ts` — the script has no
 * build step and cannot import a TypeScript module. It is deliberately not the whole list: the
 * ingest route adds anything it has never seen, so this only needs to cover the software whose
 * first report would otherwise read as a wall of "Unclassified".
 */
const CATALOG = {
  'excel.exe': ['Microsoft Excel', 'OFFICE'],
  'winword.exe': ['Microsoft Word', 'OFFICE'],
  'powerpnt.exe': ['Microsoft PowerPoint', 'OFFICE'],
  'onenote.exe': ['Microsoft OneNote', 'OFFICE'],
  'outlook.exe': ['Microsoft Outlook', 'COMMUNICATION'],
  'teams.exe': ['Microsoft Teams', 'COMMUNICATION'],
  'ms-teams.exe': ['Microsoft Teams', 'COMMUNICATION'],
  'zoom.exe': ['Zoom', 'COMMUNICATION'],
  'whatsapp.exe': ['WhatsApp', 'COMMUNICATION'],
  'chrome.exe': ['Google Chrome', 'REFERENCE'],
  'msedge.exe': ['Microsoft Edge', 'REFERENCE'],
  'firefox.exe': ['Mozilla Firefox', 'REFERENCE'],
  'acrobat.exe': ['Adobe Acrobat', 'REFERENCE'],
  'acrord32.exe': ['Adobe Acrobat Reader', 'REFERENCE'],
  'code.exe': ['Visual Studio Code', 'DEVELOPMENT'],
  'devenv.exe': ['Visual Studio', 'DEVELOPMENT'],
  'powershell.exe': ['Windows PowerShell', 'DEVELOPMENT'],
  'pwsh.exe': ['PowerShell', 'DEVELOPMENT'],
  'cmd.exe': ['Command Prompt', 'DEVELOPMENT'],
  'acad.exe': ['AutoCAD', 'WORK'],
  'staadpro.exe': ['STAAD.Pro', 'WORK'],
  'revit.exe': ['Autodesk Revit', 'WORK'],
  'tally.exe': ['Tally', 'WORK'],
  'explorer.exe': ['Windows Explorer', 'SYSTEM'],
  'lockapp.exe': ['Windows Lock Screen', 'SYSTEM'],
  'logonui.exe': ['Windows Sign-in', 'SYSTEM'],
  'taskmgr.exe': ['Task Manager', 'SYSTEM'],
  'searchhost.exe': ['Windows Search', 'SYSTEM'],
  'shellexperiencehost.exe': ['Windows Shell', 'SYSTEM'],
  'systemsettings.exe': ['Windows Settings', 'SYSTEM'],
};

/* ── admin bootstrap ─────────────────────────────────────────────────────────────────────────── */

async function importAdmin() {
  const { getApps, initializeApp, cert, applicationDefault } = await import('firebase-admin/app');
  const { getFirestore, FieldValue } = await import('firebase-admin/firestore');

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  const hasServiceAccount = Boolean(
    projectId && clientEmail && privateKey?.includes('-----BEGIN PRIVATE KEY-----'),
  );

  if (!hasServiceAccount && !process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.FIRESTORE_EMULATOR_HOST) {
    console.error('\nFirebase Admin credentials are not configured.');
    console.error('Run `npm run firebase:admin-check` to see what is missing.');
    console.error('See docs/firebase-admin-local.md.');
    process.exit(1);
  }

  if (!getApps().length) {
    initializeApp({
      credential: hasServiceAccount ? cert({ projectId, clientEmail, privateKey }) : applicationDefault(),
      projectId,
    });
  }

  return { db: getFirestore(), FieldValue };
}

/* ── steps ───────────────────────────────────────────────────────────────────────────────────── */

const tick = (ok) => (ok ? '  OK  ' : '  --  ');

async function reportPermissions(db) {
  const roles = await db.collection(C.roles).get().catch(() => null);
  if (!roles) {
    console.log(`${tick(false)}Roles could not be read.`);
    return;
  }

  const holders = [];
  for (const role of roles.docs) {
    const permissions = role.data().permissions || {};
    const granted = Object.keys(permissions).filter((key) => key === 'Windows Agent' || key.startsWith('Windows Agent.'));
    if (granted.length) holders.push({ role: role.data().name || role.id, count: granted.length });
  }

  if (!holders.length) {
    console.log(`${tick(false)}No role holds any Windows Agent permission.`);
    console.log('        Nobody can open /windows-agent yet — every screen will refuse.');
    console.log('        Grant them in Settings > Role Management > (your role) > Windows Agent.');
    return;
  }

  console.log(`${tick(true)}Windows Agent permissions granted to ${holders.length} role(s):`);
  for (const holder of holders) {
    console.log(`        ${holder.role} — ${holder.count} permission node(s)`);
  }
}

async function ensureEnrollmentCode(db, FieldValue) {
  const ref = db.collection(C.enrollmentCodes).doc(CODE);
  const existing = await ref.get();

  if (existing.exists) {
    const data = existing.data();
    console.log(`${tick(true)}Enrolment code ${CODE} already exists `
      + `(${data.enabled === false ? 'DISABLED' : 'enabled'}, used ${data.registrationCount || 0}×, `
      + `${data.autoApprove ? 'auto-approve' : 'needs approval'}).`);
    return;
  }

  if (STATUS_ONLY) {
    console.log(`${tick(false)}Enrolment code ${CODE} does not exist. Re-run without --status to create it.`);
    return;
  }

  await ref.set({
    label: `Created by setup-windows-agent on ${new Date().toISOString().slice(0, 10)}`,
    departmentId: null,
    departmentName: null,
    assignedLocation: null,
    // Approval required by default. A code that auto-approves is a code that enrols any machine
    // it leaks to; for a pilot the extra click is worth it.
    autoApprove: AUTO_APPROVE,
    enabled: true,
    expiresAt: null,
    maxRegistrations: null,
    registrationCount: 0,
    createdAt: FieldValue.serverTimestamp(),
    createdBy: 'setup-script',
    createdByName: 'setup-windows-agent',
  });

  console.log(`${tick(true)}Created enrolment code ${CODE} `
    + `(${AUTO_APPROVE ? 'auto-approve' : 'needs administrator approval'}).`);
}

async function seedCatalog(db, FieldValue) {
  const collection = db.collection(C.appCatalog);
  const existing = await collection.get();
  const known = new Set(existing.docs.map((doc) => doc.id));

  const missing = Object.entries(CATALOG).filter(([processKey]) => !known.has(processKey));
  if (!missing.length) {
    console.log(`${tick(true)}Application catalogue already seeded (${known.size} entries).`);
    return;
  }

  if (STATUS_ONLY) {
    console.log(`${tick(false)}Application catalogue missing ${missing.length} built-in entries.`);
    return;
  }

  const batch = db.batch();
  for (const [processKey, [displayName, category]] of missing) {
    batch.set(collection.doc(processKey), {
      processName: processKey,
      displayName,
      category,
      isBuiltIn: true,
      autoDiscovered: false,
      firstSeenAt: null,
      lastSeenAt: null,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: 'setup-script',
      createdByName: 'setup-windows-agent',
    });
  }
  await batch.commit();
  console.log(`${tick(true)}Seeded ${missing.length} application catalogue entries.`);
}

async function reportFleet(db, FieldValue) {
  const [devices, sessions] = await Promise.all([
    db.collection(C.devices).get().catch(() => null),
    db.collection(C.sessions).limit(1).get().catch(() => null),
  ]);

  const count = devices ? devices.size : 0;
  if (count === 0) {
    console.log(`${tick(false)}No computers enrolled yet.`);
    return;
  }

  const pending = devices.docs.filter((doc) => doc.data().status === 'PENDING');
  console.log(`${tick(true)}${count} computer(s) enrolled`
    + (pending.length ? `, ${pending.length} awaiting approval:` : '.'));

  for (const doc of pending) {
    const name = doc.data().deviceName || doc.id;

    if (!APPROVE_PENDING || STATUS_ONLY) {
      console.log(`        ${name} — approve at /windows-agent/devices/${doc.id}`
        + (APPROVE_PENDING ? '' : '  (or re-run with --approve)'));
      continue;
    }

    // Approving from a script is a pilot convenience, not the normal path. It is written to the
    // audit trail with the same shape an administrator's approval would have, and attributed to
    // the script rather than to a person — an approval nobody can be asked about is worse than
    // no audit row at all.
    await doc.ref.update({
      status: 'ACTIVE',
      statusReason: 'Approved by setup-windows-agent (pilot setup).',
      statusChangedAt: new Date().toISOString(),
      statusChangedBy: 'setup-script',
      updatedAt: FieldValue.serverTimestamp(),
    });
    await db.collection('windowsAuditLogs').add({
      action: 'DEVICE_APPROVED',
      actorId: 'setup-script',
      actorName: 'setup-windows-agent',
      targetType: 'device',
      targetId: doc.id,
      targetLabel: name,
      oldValue: 'PENDING',
      newValue: 'ACTIVE',
      reason: 'Approved from the command line during pilot setup.',
      ipAddress: null,
      userAgent: null,
      at: new Date().toISOString(),
      module: 'Windows Agent',
      createdAt: FieldValue.serverTimestamp(),
    });
    console.log(`        ${name} — APPROVED.`);
  }

  if (sessions && !sessions.empty) {
    console.log(`${tick(true)}Work sessions have been recorded — the agent is reporting.`);
  } else {
    console.log(`${tick(false)}No work session recorded yet — nobody has signed in on the agent.`);
  }
}

/* ── main ────────────────────────────────────────────────────────────────────────────────────── */

async function main() {
  const { db, FieldValue } = await importAdmin();

  console.log('\nSEL LIVE Windows Agent — setup');
  console.log(`Project: ${process.env.FIREBASE_PROJECT_ID}`);
  console.log('-'.repeat(70));

  await reportPermissions(db);
  await ensureEnrollmentCode(db, FieldValue);
  await seedCatalog(db, FieldValue);
  await reportFleet(db, FieldValue);

  console.log('-'.repeat(70));
  console.log('\nRemaining manual steps:');
  console.log('  1. firebase deploy --only firestore:indexes     (reports fail without these)');
  console.log('  2. Copy the "Windows Agent" block from firestore.rules into the console ruleset');
  console.log('  3. Grant yourself the Windows Agent permissions in Role Management');
  console.log('\nThen configure and start an agent. The installer does this for you against');
  console.log('production; these are for pointing a development machine somewhere else:');
  console.log(`     SEL.Agent.Service.exe --write-config --url <https://your-host> --code ${CODE}`);
  console.log('     SEL.Agent.Service.exe --check');
  console.log('     SEL.Agent.exe\n');
  console.log('The Firebase key is fetched from that host, so it is no longer passed by hand.\n');
}

main().catch((error) => {
  console.error('\nSetup failed:', error && error.message ? error.message : error);
  process.exit(1);
});
