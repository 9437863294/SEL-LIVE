#!/usr/bin/env node
/**
 * Bill Tracking — recompute every live bill's stored totals from its source values.
 *
 *   node --experimental-strip-types scripts/bill-tracking-recompute-totals.mjs           # dry run: lists what would change
 *   node --experimental-strip-types scripts/bill-tracking-recompute-totals.mjs --write   # stores the new totals
 *
 * The API derives a bill's totals on every write (`deriveBillTotals`), so stored totals go stale only
 * when the formula changes. It did on 2026-10-27: a certified bill is now paid against the client's
 * certified deductions instead of the raised ones, and the raised deductions' total and net are
 * stored beside them (`raisedTotalDeduction`, `raisedNetReceivable`). A bill certified before then
 * keeps totals worked out on its raised deductions until something rewrites it; this brings every
 * such bill up to date, with each organisation's own settings (tolerance, net rounded to the rupee)
 * merged over the defaults exactly as the app reads them.
 *
 * A bill is listed when a figure the app reads would change. Bills stored before 2026-10-27 have no
 * raised fields, and the app then reads the effective ones — which are the raised figures for a bill
 * that is not certified — so a bill that only lacks them is left alone.
 *
 * Without `--write` nothing is written. With it, each listed bill is re-read and recomputed in its
 * own transaction (so a receipt recorded meanwhile is never overwritten), and the change is entered
 * in the bill's activity trail. `version` is left as it is: no one edited the bill, and an import
 * can still be rolled back. A second run should list nothing.
 *
 * Reads `.env` and `.env.local`, like the development server — which on this machine is PRODUCTION.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { deriveBillTotals, isoWeekOf } from '../src/lib/bill-tracking/calculations.ts';
import { withConfigDefaults } from '../src/lib/bill-tracking/defaults.ts';
import { toPaise } from '../src/lib/bill-tracking/money.ts';

function loadEnv(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index === -1) continue;
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"') && value.length > 1) || (value.startsWith("'") && value.endsWith("'") && value.length > 1)) value = value.slice(1, -1);
    out[trimmed.slice(0, index).trim()] = value;
  }
  return out;
}
// The process environment wins over the files, as it does for the dev server.
for (const [key, value] of Object.entries({ ...loadEnv(resolve(process.cwd(), '.env')), ...loadEnv(resolve(process.cwd(), '.env.local')) })) {
  if (process.env[key] === undefined) process.env[key] = value;
}

const WRITE = process.argv.slice(2).includes('--write');
const BILLS = 'billTrackingBills';
const CONFIG = 'billTrackingConfig';
const ACTIVITY = 'billTrackingActivity';

/** The derived fields a bill stores, in the order they are printed. */
const FIELDS = ['grossAmount', 'totalDeduction', 'statutoryDeduction', 'retentionDeducted', 'netReceivable', 'raisedTotalDeduction', 'raisedNetReceivable', 'totalReceived', 'outstandingAmount', 'shortfallSurplus', 'lastReceiptDate', 'paymentStatus', 'receivedWeek'];
const MONEY = new Set(['grossAmount', 'totalDeduction', 'statutoryDeduction', 'retentionDeducted', 'netReceivable', 'raisedTotalDeduction', 'raisedNetReceivable', 'totalReceived', 'outstandingAmount', 'shortfallSurplus']);
/** Absent on bills stored before 2026-10-27; the app then reads the field beside it. */
const READ_AS = { raisedTotalDeduction: 'totalDeduction', raisedNetReceivable: 'netReceivable' };

const same = (field, a, b) => (MONEY.has(field) ? typeof a === 'number' && typeof b === 'number' && toPaise(a) === toPaise(b) : (a ?? null) === (b ?? null));
const asRead = (bill, field) => bill[field] ?? (READ_AS[field] ? bill[READ_AS[field]] : undefined);
const shown = (value) => (value === undefined || value === null ? '—' : String(value));

/**
 * The bill's derived fields as the API would store them now — RECEIVED WEEK too, set and cleared the
 * way a receipt sets it (`totalsUpdate` in server/bills.ts) — and the stored fields that differ.
 */
function recompute(bill, options) {
  const totals = deriveBillTotals({ ...bill, deductions: bill.deductions ?? [], collections: bill.collections ?? [] }, options);
  let receivedWeek = bill.receivedWeek;
  if (totals.paymentStatus === 'received' && bill.paymentStatus !== 'received' && totals.lastReceiptDate) receivedWeek = isoWeekOf(totals.lastReceiptDate);
  if (totals.paymentStatus !== 'received' && bill.paymentStatus === 'received') receivedWeek = undefined;
  const next = { ...Object.fromEntries(FIELDS.map((field) => [field, totals[field]])), receivedWeek };
  return {
    // A figure the app reads changes: the bill needs writing.
    stale: FIELDS.some((field) => !same(field, asRead(bill, field), next[field])),
    // What a write changes in the document, absent raised fields included.
    changes: FIELDS.filter((field) => !same(field, bill[field], next[field])).map((field) => ({ field, before: bill[field], after: next[field] })),
  };
}

const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
const hasServiceAccount = Boolean(projectId && clientEmail && privateKey?.includes('-----BEGIN PRIVATE KEY-----') && privateKey.includes('-----END PRIVATE KEY-----'));
const useApplicationDefault = process.env.FIREBASE_USE_APPLICATION_DEFAULT_CREDENTIALS?.trim().toLowerCase() === 'true' || Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS);
if (!hasServiceAccount && !useApplicationDefault) {
  console.error('\nFirebase Admin credentials are not configured. Run `npm run firebase:admin-check` to see what is missing.\n');
  process.exit(1);
}

const { applicationDefault, cert, initializeApp } = await import('firebase-admin/app');
const { FieldValue, getFirestore } = await import('firebase-admin/firestore');
// The service account when it is complete, else Application Default Credentials — as the app chooses.
const db = getFirestore(initializeApp({ credential: hasServiceAccount ? cert({ projectId, clientEmail, privateKey }) : applicationDefault(), projectId }));

/** Each organisation's calculation options, read once (`loadConfig` + `calculationOptions` in the app). */
const optionsByOrganization = new Map();
async function optionsFor(organizationId) {
  const key = organizationId || 'default';
  if (!optionsByOrganization.has(key)) {
    const snapshot = await db.collection(CONFIG).doc(key).get();
    const { settings } = withConfigDefaults(snapshot.exists ? snapshot.data() : null);
    optionsByOrganization.set(key, { tolerance: settings.tolerance, roundNetToRupee: settings.roundNetToRupee });
  }
  return optionsByOrganization.get(key);
}

console.log(`\nBill Tracking — stored totals against a recompute${WRITE ? '' : ' (dry run: nothing is written)'}`);
console.log(`Firebase project ${projectId ?? '(from Application Default Credentials)'}, (default) database\n`);

const snapshot = await db.collection(BILLS).get();
const live = snapshot.docs.filter((doc) => !doc.data().isDeleted);
const stale = [];
for (const doc of live) {
  const bill = { ...doc.data(), id: doc.id };
  const options = await optionsFor(bill.organizationId);
  if (recompute(bill, options).stale) stale.push({ ref: doc.ref, bill, options });
}

for (const [key, options] of optionsByOrganization) {
  console.log(`Organisation ${key}: tolerance ₹${options.tolerance}, net ${options.roundNetToRupee ? 'rounded to the rupee' : 'not rounded'}`);
}
for (const { bill, options } of stale) {
  const reference = [bill.gstInvoiceNumber, bill.billSerialNumber].filter(Boolean).join(' · ') || '(no number)';
  const certified = bill.certification ? `certified ${bill.certification.certifiedDate ?? ''}`.trim() : 'not certified';
  console.log(`\n  ${reference} · ${bill.projectNameSnapshot ?? bill.projectId} · ${bill.transactionType} · ${certified} · ${BILLS}/${bill.id}`);
  for (const { field, before, after } of recompute(bill, options).changes) console.log(`    ${field.padEnd(22)} ${shown(before)} → ${shown(after)}`);
}
console.log(`\n${live.length} live bill(s) checked (${snapshot.size - live.length} deleted skipped): ${stale.length} with stale totals.`);

if (!WRITE) {
  console.log(stale.length ? 'Nothing was written. Run again with --write to store the new totals.\n' : 'Nothing to do.\n');
  process.exit(0);
}

let written = 0;
for (const { ref, options } of stale) {
  const done = await db.runTransaction(async (transaction) => {
    const fresh = await transaction.get(ref);
    if (!fresh.exists || fresh.data().isDeleted) return false;
    const bill = { ...fresh.data(), id: fresh.id };
    const { stale: still, changes } = recompute(bill, options);
    if (!still) return false;
    // Firestore rejects `undefined`: a field with nothing to store is deleted, and recorded as null.
    transaction.update(ref, Object.fromEntries(changes.map(({ field, after }) => [field, after ?? FieldValue.delete()])));
    const net = changes.find((change) => change.field === 'netReceivable');
    transaction.set(db.collection(ACTIVITY).doc(), {
      organizationId: bill.organizationId ?? '',
      entityType: 'bill',
      entityId: bill.id,
      billId: bill.id,
      projectId: bill.projectId ?? '',
      action: 'totals_recomputed',
      summary: `Stored totals brought up to date — ${bill.certification ? 'the certified deductions now apply' : 'recomputed from the bill’s figures'}${net ? `: net receivable ${shown(net.before)} → ${shown(net.after)}` : ''}`,
      previous: Object.fromEntries(changes.map(({ field, before }) => [field, before ?? null])),
      next: Object.fromEntries(changes.map(({ field, after }) => [field, after ?? null])),
      actorId: 'system',
      actorName: 'Recompute totals (script)',
      at: new Date().toISOString(),
    });
    return true;
  });
  if (done) written += 1;
}
console.log(`Wrote ${written} bill(s). Run the dry run again: it should list nothing.\n`);
process.exit(0);
