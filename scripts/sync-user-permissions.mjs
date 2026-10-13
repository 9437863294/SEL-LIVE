#!/usr/bin/env node
/**
 * Write `userPermissions/{authUid}` — the resolved permissions the Firestore rules read — for every
 * user at once. The app keeps these documents fresh itself (AuthProvider at every load, create-user,
 * Access Management); this is for the first fill and for repairs.
 *
 *   node --experimental-strip-types scripts/sync-user-permissions.mjs           (dry run, prints a summary)
 *   node --experimental-strip-types scripts/sync-user-permissions.mjs --write   (writes the documents)
 *
 * Resolves access with the same pure resolver `authenticateUserById` uses, over the same documents:
 * the user, every role, the user's grant and the scope rules. Reads `.env` like the dev server.
 */

import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import {
  deactivationHasLapsed,
  normalizeUserAccessGrant,
  resolveEffectiveAccess,
} from '../src/lib/access-control.ts';
import { buildUserPermissionsDoc, USER_PERMISSIONS_COLLECTION } from '../src/lib/access-rules-permissions.ts';

const write = process.argv.includes('--write');
process.loadEnvFile(resolve(process.cwd(), '.env'));
const require = createRequire(resolve(process.cwd(), 'package.json'));
const { cert, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { FieldValue, getFirestore } = require('firebase-admin/firestore');

const app = initializeApp({
  credential: cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  }),
});
const db = getFirestore(app);

const [usersSnap, rolesSnap, grantsSnap, scopeSnap] = await Promise.all([
  db.collection('users').get(),
  db.collection('roles').get(),
  db.collection('accessGrants').get(),
  db.collection('accessScopeGrants').get().catch(() => null),
]);
const roles = rolesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
const grants = new Map(grantsSnap.docs.map((d) => [d.id, d.data()]));
const scopeGrants = scopeSnap?.docs.map((d) => ({ id: d.id, ...d.data() })) ?? [];

const byUid = new Set();
const byEmail = new Map();
let pageToken;
do {
  const page = await getAuth(app).listUsers(1000, pageToken);
  for (const account of page.users) {
    byUid.add(account.uid);
    if (account.email) byEmail.set(account.email.toLowerCase(), account.uid);
  }
  pageToken = page.pageToken;
} while (pageToken);

const docs = new Map();
let inactive = 0;
let noAccount = 0;
for (const user of usersSnap.docs) {
  const data = user.data();
  const email = String(data.email || '').toLowerCase();
  const uid = byUid.has(user.id) ? user.id : byEmail.get(email);
  if (!uid) {
    noAccount++;
    continue;
  }
  const lapsed = deactivationHasLapsed(data);
  const active = !(data.status === 'Inactive' && !lapsed);
  if (!active) inactive++;
  const access = resolveEffectiveAccess({
    user: {
      id: user.id,
      name: String(data.name || ''),
      email: String(data.email || ''),
      role: String(data.role || ''),
      status: lapsed ? 'Active' : String(data.status || 'Active'),
    },
    roles,
    grant: normalizeUserAccessGrant(user.id, grants.get(user.id) ?? null),
    scopeGrants,
  });
  docs.set(uid, buildUserPermissionsDoc({
    userDocId: user.id,
    permissions: access.permissions,
    roleNames: access.effectiveRoleNames,
    projectIds: access.projectIds,
    departmentIds: access.departmentIds,
    active,
  }));
}

const existing = await db.collection(USER_PERMISSIONS_COLLECTION).select().get();
const orphans = existing.docs.map((d) => d.id).filter((id) => !docs.has(id));
const sizes = [...docs.values()].map((d) => Buffer.byteLength(JSON.stringify(d.p))).sort((a, b) => a - b);
console.log(
  `users ${usersSnap.size}: documents ${docs.size} (inactive ${inactive}), no sign-in account ${noAccount}, ` +
  `stale documents to remove ${orphans.length}; permission map bytes median ${sizes[sizes.length >> 1] ?? 0} max ${sizes.at(-1) ?? 0}`,
);

if (!write) {
  console.log('Dry run. Pass --write to write the documents.');
} else {
  const ops = [
    ...[...docs].map(([uid, doc]) => (b) => b.set(db.collection(USER_PERMISSIONS_COLLECTION).doc(uid), { ...doc, updatedAt: FieldValue.serverTimestamp() })),
    ...orphans.map((uid) => (b) => b.delete(db.collection(USER_PERMISSIONS_COLLECTION).doc(uid))),
  ];
  for (let i = 0; i < ops.length; i += 400) {
    const batch = db.batch();
    for (const op of ops.slice(i, i + 400)) op(batch);
    await batch.commit();
  }
  console.log(`Wrote ${docs.size} documents, removed ${orphans.length}.`);
}
