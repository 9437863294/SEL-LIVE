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
 * Retention bills (2026-11-13). A retention bill now carries its amount as `retentionClaimed`, with
 * no taxable or GST (`src/lib/bill-tracking/retention-bill.ts`). One saved in the workbook's layout —
 * taxable 0 and a *negative* retention line — had that line counted off the retention held, and the
 * receipts on the bill released the same retention again. Such a bill is converted: the negative
 * retention line becomes `retentionClaimed` (its certification's likewise), so its net is unchanged
 * and the retention held is no longer reduced twice. A retention bill saved with a *taxable* (typed
 * for the retention, which counted it as new taxable value) is only listed: whether that taxable is
 * the claim, or new value under a sub category wrongly marked as a retention bill, is for a person to
 * decide — open it and save it from the bill form, which proposes the claim.
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

import { deriveBillTotals, isoWeekOf, totalDeduction } from '../src/lib/bill-tracking/calculations.ts';
import { claimOfRetentionBill, isRetentionBillOf } from '../src/lib/bill-tracking/retention-bill.ts';
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
 * A retention bill in the workbook's layout, converted: its negative retention line read as the
 * claim, on the raised bill and on its certification. Null when there is nothing to convert.
 */
function convertRetentionBill(bill) {
  if (!isRetentionBillOf(bill.transactionType, bill) || (bill.retentionClaimed !== undefined && bill.retentionClaimed !== null)) return null;
  const raised = claimOfRetentionBill(bill);
  if (raised.from !== 'lines') return null;
  const source = { retentionClaimed: raised.claim, deductions: raised.lines };
  if (bill.certification) {
    const certified = claimOfRetentionBill({ retentionClaimed: bill.certification.retentionClaimed, taxableAmount: bill.certification.taxableAmount ?? 0, deductions: bill.certification.deductions ?? [] });
    source.certification = { ...bill.certification, retentionClaimed: certified.claim ?? raised.claim, deductions: certified.lines, totalDeduction: totalDeduction(certified.lines) };
  }
  return source;
}

/** A retention bill saved with a taxable: listed for a person to correct, never converted here. */
const retentionBillWithTaxable = (bill) =>
  isRetentionBillOf(bill.transactionType, bill) && (bill.retentionClaimed === undefined || bill.retentionClaimed === null) && claimOfRetentionBill(bill).from === 'taxable';

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
const byHand = [];
for (const doc of live) {
  const stored = { ...doc.data(), id: doc.id };
  const options = await optionsFor(stored.organizationId);
  const converted = convertRetentionBill(stored);
  const bill = converted ? { ...stored, ...converted } : stored;
  if (converted || recompute(bill, options).stale) stale.push({ ref: doc.ref, bill: stored, converted, options });
  if (retentionBillWithTaxable(stored)) byHand.push(stored);
}

for (const [key, options] of optionsByOrganization) {
  console.log(`Organisation ${key}: tolerance ₹${options.tolerance}, net ${options.roundNetToRupee ? 'rounded to the rupee' : 'not rounded'}`);
}
const referenceOf = (bill) => [bill.gstInvoiceNumber, bill.billSerialNumber].filter(Boolean).join(' · ') || '(no number)';
for (const { bill, converted, options } of stale) {
  const certified = bill.certification ? `certified ${bill.certification.certifiedDate ?? ''}`.trim() : 'not certified';
  console.log(`\n  ${referenceOf(bill)} · ${bill.projectNameSnapshot ?? bill.projectId} · ${bill.transactionType} · ${certified} · ${BILLS}/${bill.id}`);
  if (converted) {
    console.log(`    retention bill: its negative retention line becomes Retention claimed ${shown(converted.retentionClaimed)}${converted.certification ? ` (certified ${shown(converted.certification.retentionClaimed)})` : ''}`);
  }
  for (const { field, before, after } of recompute(converted ? { ...bill, ...converted } : bill, options).changes) console.log(`    ${field.padEnd(22)} ${shown(before)} → ${shown(after)}`);
}
console.log(`\n${live.length} live bill(s) checked (${snapshot.size - live.length} deleted skipped): ${stale.length} to update (${stale.filter((entry) => entry.converted).length} retention bill(s) converted).`);
if (byHand.length) {
  console.log(`\n${byHand.length} retention bill(s) saved with a taxable — counted as new taxable value. Not changed here: open each, check the amount the form proposes as Retention claimed, and save.`);
  for (const bill of byHand) console.log(`  ${referenceOf(bill)} · ${bill.projectNameSnapshot ?? bill.projectId} · taxable ${shown(bill.taxableAmount)}, GST ${shown(bill.gstAmount)} · /bill-tracking/bills/${bill.id}`);
}

if (!WRITE) {
  console.log(stale.length ? 'Nothing was written. Run again with --write to store the new totals.\n' : 'Nothing to do.\n');
  process.exit(0);
}

let written = 0;
for (const { ref, options } of stale) {
  const done = await db.runTransaction(async (transaction) => {
    const fresh = await transaction.get(ref);
    if (!fresh.exists || fresh.data().isDeleted) return false;
    const stored = { ...fresh.data(), id: fresh.id };
    const converted = convertRetentionBill(stored);
    const bill = converted ? { ...stored, ...converted } : stored;
    const { stale: still, changes } = recompute(bill, options);
    if (!still && !converted) return false;
    // Firestore rejects `undefined`: a field with nothing to store is deleted, and recorded as null.
    transaction.update(ref, { ...(converted ?? {}), ...Object.fromEntries(changes.map(({ field, after }) => [field, after ?? FieldValue.delete()])) });
    const net = changes.find((change) => change.field === 'netReceivable');
    transaction.set(db.collection(ACTIVITY).doc(), {
      organizationId: bill.organizationId ?? '',
      entityType: 'bill',
      entityId: bill.id,
      billId: bill.id,
      projectId: bill.projectId ?? '',
      action: 'totals_recomputed',
      summary: converted
        ? `Retention bill converted: its negative retention line is now Retention claimed ${shown(converted.retentionClaimed)} — no longer counted off the retention held as well as released by its receipts`
        : `Stored totals brought up to date — ${bill.certification ? 'the certified deductions now apply' : 'recomputed from the bill’s figures'}${net ? `: net receivable ${shown(net.before)} → ${shown(net.after)}` : ''}`,
      previous: { ...(converted ? { retentionClaimed: null, deductions: stored.deductions ?? [] } : {}), ...Object.fromEntries(changes.map(({ field, before }) => [field, before ?? null])) },
      next: { ...(converted ? { retentionClaimed: converted.retentionClaimed, deductions: converted.deductions } : {}), ...Object.fromEntries(changes.map(({ field, after }) => [field, after ?? null])) },
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
