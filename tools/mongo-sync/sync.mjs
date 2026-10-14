#!/usr/bin/env node
/**
 * One-way copy of the (default) Firestore database into `newdatabase` (Firestore with MongoDB
 * compatibility), so the company's data can be queried with MongoDB tools. The app never reads or
 * writes `newdatabase`; this job is its only writer.
 *
 *   cd tools/mongo-sync && npm install
 *   node sync.mjs --dry-run            # what would be copied; needs no MongoDB login
 *   node sync.mjs                      # copy everything not excluded in config.mjs
 *   node sync.mjs --only users,roles   # copy just these collections
 *
 * Needs, in the repo's .env:
 *   - the Firebase Admin service account the app already uses (reads the source), and
 *   - NEWDATABASE_MONGODB_URI: the connection string from the Firebase console
 *     (newdatabase → Connect), with the user name and password of a database user that may write.
 *
 * Each run makes the copy match the source: documents are upserted by id (`_id`), and documents
 * that no longer exist in Firestore are deleted. Subcollections are copied as collections named
 * `<parent>.<sub>`, each document carrying `_parentPath`. Firestore Timestamps become Dates and
 * document references become their path, as strings.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { EXCLUDED_COLLECTIONS, EXCLUDED_FIELDS, SUBCOLLECTION_SAMPLE } from './config.mjs';
// Shared with the app's scheduled refresh (src/lib/reporting-copy-server.ts), so both write the same shapes.
import { isDirectChildOf, makeValueConverter } from '../../src/lib/reporting-copy.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
process.loadEnvFile(path.join(repo, '.env'));
const fromRepo = createRequire(path.join(repo, 'package.json'));
const { cert, initializeApp } = fromRepo('firebase-admin/app');
const { getFirestore, FieldPath, Timestamp, GeoPoint, DocumentReference } = fromRepo('firebase-admin/firestore');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const only = (() => {
  const at = args.indexOf('--only');
  return at >= 0 ? new Set(String(args[at + 1] ?? '').split(',').map((s) => s.trim()).filter(Boolean)) : null;
})();

const app = initializeApp({
  credential: cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  }),
});
const source = getFirestore(app);
const PAGE = 1000;
const WRITE_BATCH = 500;
/** Firestore value → plain BSON-friendly value. */
const convert = makeValueConverter({ Timestamp, GeoPoint, DocumentReference }, EXCLUDED_FIELDS);

/** Every document of a query, a page at a time, in document-id order. */
async function* pages(query) {
  let last = null;
  for (;;) {
    let q = query.orderBy(FieldPath.documentId()).limit(PAGE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) return;
    yield snap.docs;
    last = snap.docs[snap.docs.length - 1];
    if (snap.size < PAGE) return;
  }
}

/** Subcollection names found under a sample of a collection's documents. */
async function subcollectionsOf(collection) {
  const names = new Set();
  const refs = (await collection.select().limit(SUBCOLLECTION_SAMPLE).get()).docs.map((d) => d.ref);
  // Twenty at a time: each lookup is a round trip to a distant database.
  for (let i = 0; i < refs.length; i += 20) {
    const found = await Promise.all(refs.slice(i, i + 20).map((ref) => ref.listCollections()));
    for (const subs of found) for (const sub of subs) names.add(sub.id);
  }
  return [...names];
}

let mongo = null;
let target = null;
if (!dryRun) {
  const uri = process.env.NEWDATABASE_MONGODB_URI;
  if (!uri) throw new Error('Set NEWDATABASE_MONGODB_URI in .env (newdatabase → Connect in the Firebase console).');
  const { MongoClient } = await import('mongodb');
  mongo = new MongoClient(uri);
  await mongo.connect();
  target = mongo.db();
}

/** Write one target collection from a stream of document pages, then drop what was not seen. */
async function copy(name, docPages, toDoc) {
  const runId = Date.now();
  let count = 0;
  let ops = [];
  const flush = async () => {
    if (!ops.length) return;
    if (!dryRun) await target.collection(name).bulkWrite(ops, { ordered: false });
    ops = [];
  };
  for await (const docs of docPages) {
    for (const doc of docs) {
      count++;
      if (dryRun) continue;
      const body = { ...toDoc(doc), _syncRun: runId, _syncedAt: new Date() };
      ops.push({ replaceOne: { filter: { _id: body._id }, replacement: body, upsert: true } });
      if (ops.length >= WRITE_BATCH) await flush();
    }
  }
  await flush();
  let removed = 0;
  if (!dryRun) removed = (await target.collection(name).deleteMany({ _syncRun: { $ne: runId } })).deletedCount;
  return { count, removed };
}

const started = Date.now();
const excluded = new Set(EXCLUDED_COLLECTIONS);
const summary = [];
for (const collection of await source.listCollections()) {
  if (only && !only.has(collection.id)) continue;
  if (excluded.has(collection.id)) {
    summary.push(`${collection.id}: excluded`);
    continue;
  }

  const root = await copy(collection.id, pages(collection), (doc) => ({ _id: doc.id, ...convert(doc.data()) }));
  summary.push(`${collection.id}: ${root.count}${root.removed ? ` (removed ${root.removed})` : ''}`);

  for (const sub of await subcollectionsOf(collection)) {
    const name = `${collection.id}.${sub}`;
    // A collection group spans every parent; keep only this collection's children.
    const ownDocs = async function* () {
      for await (const docs of pages(source.collectionGroup(sub))) {
        yield docs.filter((d) => isDirectChildOf(d.ref.path, collection.id));
      }
    };
    const res = await copy(name, ownDocs(), (doc) => ({
      _id: doc.ref.path,
      _parentPath: doc.ref.parent.parent.path,
      ...convert(doc.data()),
    }));
    summary.push(`  ${name}: ${res.count}${res.removed ? ` (removed ${res.removed})` : ''}`);
  }
}

console.log(`${dryRun ? 'DRY RUN, nothing written. ' : ''}Finished in ${Math.round((Date.now() - started) / 1000)}s.`);
for (const line of summary) console.log(line);
if (mongo) await mongo.close();
