#!/usr/bin/env node
/**
 * One-way copy of the (default) Firestore database into `newdatabase` (Firestore with MongoDB
 * compatibility), so the company's data can be queried with MongoDB tools. The app never reads or
 * writes `newdatabase`; this tool and the app's scheduled refresh are its only writers.
 *
 *   cd tools/mongo-sync && npm install
 *   node sync.mjs --dry-run            # what would be read; needs no MongoDB login
 *   node sync.mjs                      # refresh everything not excluded in config.mjs
 *   node sync.mjs --only users,roles   # refresh just these collections
 *   node sync.mjs --full               # look for subcollections again, check every collection for deletions
 *
 * Needs, in the repo's .env:
 *   - the Firebase Admin service account the app already uses (reads the source), and
 *   - NEWDATABASE_MONGODB_URI: the connection string from the Firebase console
 *     (newdatabase → Connect), with the user name and password of a database user that may write.
 *
 * Incremental, like the app's refresh (src/lib/reporting-copy-server.ts), with the same helpers:
 * every Firestore document is read, but only new and changed ones are written — each copy carries
 * `_hash`, the fingerprint of its content. Nothing is deleted: documents gone from Firestore are
 * marked `_deletedInApp: true` with `_deletedNoticedAt` (filter reports with
 * `{ _deletedInApp: { $ne: true } }`), and restored if they come back. Subcollections are copied as
 * collections named `<parent>.<sub>`, each document carrying `_parentPath`; their names are reused
 * from `reportingCopy/state` for a week (shared with the app), unless `--full`. Firestore
 * Timestamps become Dates and document references become their path, as strings.
 */
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { EXCLUDED_COLLECTIONS, EXCLUDED_FIELDS, SUBCOLLECTION_SAMPLE } from './config.mjs';
// Shared with the app's scheduled refresh (src/lib/reporting-copy-server.ts), so both write the same shapes.
import {
  ACTIVE_COPY_FILTER,
  cachedSubcollections,
  decideDeletionCheck,
  DELETION_CHECK_BATCH,
  deletionScanDone,
  EXISTING_COPY_PROJECTION,
  isDirectChildOf,
  makeValueConverter,
  markDeletedUpdate,
  planPageWrites,
  REPORTING_COPY_COLLECTION,
  subcollectionTarget,
} from '../../src/lib/reporting-copy.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
process.loadEnvFile(path.join(repo, '.env'));
const fromRepo = createRequire(path.join(repo, 'package.json'));
const { cert, initializeApp } = fromRepo('firebase-admin/app');
const { getFirestore, FieldPath, Timestamp, GeoPoint, DocumentReference } = fromRepo('firebase-admin/firestore');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const full = args.includes('--full');
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
const sha1 = (text) => createHash('sha1').update(text).digest('hex');

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
  return [...names].sort();
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

/**
 * Refresh one target collection from a stream of document pages: write only new and changed
 * documents, then mark the copies whose documents are gone (never delete them).
 */
async function copy(name, docPages, toDoc, refOf) {
  const counts = { documents: 0, inserted: 0, updated: 0, unchanged: 0, restored: 0, markedDeleted: 0 };
  for await (const page of docPages) {
    const docs = page.map(toDoc);
    counts.documents += docs.length;
    if (dryRun || !docs.length) continue;
    const collection = target.collection(name);
    const existing = await collection.find({ _id: { $in: docs.map((doc) => doc._id) } }, { projection: EXISTING_COPY_PROJECTION }).toArray();
    const plan = planPageWrites(docs, existing, { hash: sha1, now: new Date() });
    for (const key of ['inserted', 'updated', 'unchanged', 'restored']) counts[key] += plan.counts[key];
    for (let i = 0; i < plan.writes.length; i += WRITE_BATCH) {
      await collection.bulkWrite(plan.writes.slice(i, i + WRITE_BATCH), { ordered: false });
    }
  }
  if (dryRun) return counts;

  // Deletions: only when the copy has more live documents than were just read (or with --full).
  const collection = target.collection(name);
  const mongoActive = await collection.countDocuments(ACTIVE_COPY_FILTER);
  const decision = decideDeletionCheck({ mongoActive, firestoreRead: counts.documents, full });
  if (!decision.scan) return counts;
  let cursor = null;
  for (;;) {
    const filter = cursor ? { ...ACTIVE_COPY_FILTER, _id: { $gt: cursor } } : { ...ACTIVE_COPY_FILTER };
    const ids = (await collection.find(filter, { projection: { _id: 1 } }).sort({ _id: 1 }).limit(DELETION_CHECK_BATCH).toArray()).map((d) => String(d._id));
    if (ids.length) {
      const snaps = await source.getAll(...ids.map(refOf), { fieldMask: [] });
      const missing = ids.filter((_, i) => !snaps[i].exists);
      if (missing.length) await collection.updateMany({ _id: { $in: missing } }, markDeletedUpdate(new Date()));
      counts.markedDeleted += missing.length;
      cursor = ids[ids.length - 1];
    }
    if (deletionScanDone(ids.length, counts.markedDeleted, decision.expectedMissing)) return counts;
  }
}

const describe = (c) => dryRun
  ? `${c.documents} read`
  : `${c.documents} read · ${c.inserted} new · ${c.updated} changed · ${c.unchanged} unchanged${c.restored ? ` · ${c.restored} restored` : ''}${c.markedDeleted ? ` · ${c.markedDeleted} marked deleted` : ''}`;

// Subcollection names, shared with the app's refresh: reused for a week unless --full.
const stateRef = source.collection(REPORTING_COPY_COLLECTION).doc('state');
const subcollectionCache = (await stateRef.get()).get('subcollectionCache') ?? {};

const started = Date.now();
const excluded = new Set(EXCLUDED_COLLECTIONS);
const summary = [];
for (const collection of await source.listCollections()) {
  if (only && !only.has(collection.id)) continue;
  if (excluded.has(collection.id)) {
    summary.push(`${collection.id}: excluded`);
    continue;
  }

  const root = await copy(collection.id, pages(collection), (doc) => ({ _id: doc.id, ...convert(doc.data()) }), (id) => collection.doc(id));
  summary.push(`${collection.id}: ${describe(root)}`);

  let subs = cachedSubcollections(subcollectionCache, collection.id, new Date(), full);
  if (!subs) {
    subs = await subcollectionsOf(collection);
    const entry = { names: subs, discoveredAt: new Date().toISOString() };
    subcollectionCache[collection.id] = entry;
    if (!dryRun) await stateRef.set({ subcollectionCache: { [collection.id]: entry } }, { merge: true });
  }
  for (const sub of subs) {
    const name = subcollectionTarget(collection.id, sub);
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
    }), (id) => source.doc(id));
    summary.push(`  ${name}: ${describe(res)}`);
  }
}

console.log(`${dryRun ? 'DRY RUN, nothing written. ' : ''}${full ? 'Full refresh. ' : ''}Finished in ${Math.round((Date.now() - started) / 1000)}s.`);
for (const line of summary) console.log(line);
if (mongo) await mongo.close();
