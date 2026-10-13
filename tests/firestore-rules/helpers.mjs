// Shared set-up for the Firestore rules tests: loads the repo's firestore.rules into the emulator and
// hands out Firestore clients as a given user (or as nobody), plus an admin client that ignores the
// rules for seeding data.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';

const here = path.dirname(fileURLToPath(import.meta.url));
export const RULES_PATH = path.resolve(here, '../../firestore.rules');

export async function rulesEnv() {
  const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');
  return initializeTestEnvironment({
    projectId: 'demo-sel-rules',
    firestore: { rules: readFileSync(RULES_PATH, 'utf8'), host, port: Number(port) },
  });
}

/** A Firestore client signed in as `uid`, or signed out when `uid` is null. */
export function as(env, uid, claims = {}) {
  return uid ? env.authenticatedContext(uid, claims).firestore() : env.unauthenticatedContext().firestore();
}

/** Seed documents with rules disabled. `docs` is { 'collection/id': data }. */
export async function seed(env, docs) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await Promise.all(Object.entries(docs).map(([p, data]) => db.doc(p).set(data)));
  });
}
