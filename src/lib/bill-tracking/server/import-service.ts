import 'server-only';

/**
 * Workbook import on the server.
 *
 *   preview  — stateless. Re-parses the grid the browser read against the live masters, classifies
 *              duplicates against existing bills, and returns the preview. Writes nothing.
 *   start    — the user confirmed the preview. Parses again (the browser's preview is never
 *              trusted), refuses the import while any selected row has an error or an undecided
 *              duplicate, then records the job, its rows, remembered project mappings and any new
 *              bill types. Still no bills.
 *   process  — imports the next chunk of pending rows, one transaction per row. Bill and receipt ids
 *              are derived from the job and row (`imp-<job>-<row>`), so re-running a chunk after a
 *              timeout finds the bill already there and marks the row imported instead of
 *              duplicating it. The browser calls this until nothing is pending.
 *   rollback — soft-deletes what the job created and restores what it updated, but only if none of
 *              those bills has been changed since (receipt, edit, follow-up all bump `version`).
 *
 * Each row keeps its original cells, so the import is traceable back to the sheet row it came from.
 */

import { FieldValue, type DocumentReference } from 'firebase-admin/firestore';

import { getFirebaseAdminBucket } from '@/lib/firebase-admin';

import { RETENTION_KINDS, deductionsOfKind, deriveBillTotals, financialYearOf, monthKeyOf, protectedChanges } from '../calculations.ts';
import { withConfigDefaults } from '../defaults.ts';
import { amountsLocked, stepLabel } from '../workflow.ts';
import {
  classifyDuplicate,
  defaultRowAction,
  excelTotals,
  IMPORT_COLUMNS,
  parseImportRows,
  projectKey,
  againstInvoiceFromDescription,
  matchBillType,
  provisionalBillType,
  readSheetLayout,
  type ExistingBillKey,
  type ImportCell,
  type ImportColumnMap,
  type ImportFieldKey,
  type ParsedImportRow,
  type ProjectMatch,
} from '../import.ts';
import { deductionsByType } from '../certification.ts';
import { roundMoney, subtractMoney, sumMoney, toPaise } from '../money.ts';
import { buildSearchTokens } from '../reports.ts';
import type { ImportPreviewInput } from '../schemas';
import type {
  Bill,
  BillCollection,
  BillDeduction,
  BillImportJob,
  BillTrackingConfig,
  BillTypeMaster,
  ImportReconciliationTotals,
  ImportRowAction,
  ImportRowState,
  ProjectNameMapping,
} from '../types';
import { calculationOptions, computeDueDate, derivedFields } from './bills';
import { BtError, db, type BtContext } from './context';
import { BT_COLLECTIONS, clean, configRef, invalidateConfig, loadClients, loadConfig, loadProjects, loadScopedBills, logActivity, nowIso, type ProjectRecord } from './store';

type StoredBill = Bill & { organizationId: string };
/** `headings`: the sheet's own column headings, so the error-rows CSV labels its cells as the sheet did. */
type StoredJob = BillImportJob & { organizationId: string; columnMap: ImportColumnMap; headerRow: number; headings?: string[] };

export interface PreviewRow extends Omit<ParsedImportRow, 'projectMatch' | 'raw'> {
  duplicate: ReturnType<typeof classifyDuplicate>;
  action: ImportRowAction | 'review';
}

export interface ImportPreview {
  sheetName: string;
  headerRow: number;
  headings: string[];
  columnMap: ImportColumnMap;
  unmappedHeadings: string[];
  missingRequired: string[];
  rows: PreviewRow[];
  blankRows: number;
  staleRows: { row: number; netAmount: number }[];
  projects: (Omit<ProjectMatch, 'candidates'> & { key: string; rows: number; candidates: { id: string; name: string; score: number }[] })[];
  unknownBillTypes: string[];
  summary: {
    detected: number;
    valid: number;
    warning: number;
    error: number;
    duplicateExact: number;
    duplicatePossible: number;
    toImport: number;
    toUpdate: number;
    toSkip: number;
    undecided: number;
    receipts: number;
  };
  excelTotals: ImportReconciliationTotals;
  calculatedTotals: ImportReconciliationTotals;
}

function applyColumnOverrides(map: ImportColumnMap, overrides: Record<string, number>): ImportColumnMap {
  const next: ImportColumnMap = { ...map };
  for (const [key, index] of Object.entries(overrides)) {
    if (!IMPORT_COLUMNS.some((column) => column.key === key)) continue;
    // Taking a column for one field frees it from whichever field had it.
    for (const [other, value] of Object.entries(next)) if (value === index && other !== key) delete next[other as ImportFieldKey];
    if (index < 0) delete next[key as ImportFieldKey];
    else next[key as ImportFieldKey] = index;
  }
  return next;
}

/**
 * A bill's figures as raised: its raised deductions (and the retention among them), the net they give
 * and that net less what was received. The workbook knows nothing of a client certification on the
 * bill — whose deductions replace the raised ones in what it is paid — so the import compares the
 * sheet with these. (A bill stored before 2026-10-27 has no raised fields; its stored totals were
 * still the raised figures.)
 */
const asRaised = (bill: Bill) => {
  const net = bill.raisedNetReceivable ?? bill.netReceivable;
  return {
    deduction: bill.raisedTotalDeduction ?? bill.totalDeduction,
    net,
    retention: deductionsOfKind(bill.deductions ?? [], RETENTION_KINDS),
    shortfall: subtractMoney(net, bill.totalReceived),
  };
};

/**
 * The same deduction amounts per head, in any order — a sheet row carries only heads and amounts. A
 * head at ₹0 deducts nothing, so a certified ₹0 line and a sheet with no such column agree.
 */
const sameDeductionAmounts = (a: readonly BillDeduction[], b: readonly BillDeduction[]) => {
  const byHead = (lines: readonly BillDeduction[]) =>
    JSON.stringify([...deductionsByType(lines).entries()].filter(([, entry]) => toPaise(entry.amount) !== 0).map(([id, entry]) => [id, toPaise(entry.amount)]).sort());
  return byHead(a) === byHead(b);
};

/**
 * A bill's GST parts for the sheet's GST total, split the way the bill is: CGST + SGST halves (an odd
 * paisa to SGST) or all IGST. A "No GST" bill the sheet gives GST keeps it as one unsplit figure, as an
 * imported legacy bill does. Nothing changes while the total is the same.
 */
function gstPartsFor(bill: Pick<Bill, 'gstType' | 'gstAmount'>, gstAmount: number): Partial<Pick<Bill, 'gstType' | 'cgstAmount' | 'sgstAmount' | 'igstAmount'>> {
  if (toPaise(gstAmount) === toPaise(bill.gstAmount ?? 0)) return {};
  if (bill.gstType === 'cgst-sgst') {
    const cgstAmount = roundMoney(gstAmount / 2);
    return { cgstAmount, sgstAmount: subtractMoney(gstAmount, cgstAmount), igstAmount: 0 };
  }
  if (bill.gstType === 'igst') return { cgstAmount: 0, sgstAmount: 0, igstAmount: roundMoney(gstAmount) };
  if (bill.gstType === 'none') return { gstType: undefined, cgstAmount: 0, sgstAmount: 0, igstAmount: 0 };
  return {};
}

const existingKeys = (bills: readonly Bill[]): ExistingBillKey[] =>
  bills.map((bill) => ({
    id: bill.id,
    projectId: bill.projectId,
    billSerialNumber: bill.billSerialNumber,
    gstInvoiceNumber: bill.gstInvoiceNumber,
    billDate: bill.billDate,
    billTypeName: bill.billTypeName,
    taxableAmount: bill.taxableAmount,
    // A sheet row's net is its own deduction columns' net, so the same bill matches on its raised net.
    netReceivable: asRaised(bill).net,
    // …and a workbook exported from SEL LIVE carries the net it is paid (the certified deductions').
    paidNetReceivable: toPaise(bill.netReceivable) !== toPaise(asRaised(bill).net) ? bill.netReceivable : undefined,
    importFingerprint: bill.importFingerprint,
    projectNameSnapshot: bill.projectNameSnapshot,
  }));

const calculatedTotalsOf = (rows: readonly ParsedImportRow[]): ImportReconciliationTotals => ({
  bills: rows.length,
  taxable: sumMoney(rows.map((row) => row.taxableAmount)),
  gst: sumMoney(rows.map((row) => row.gstAmount)),
  gross: sumMoney(rows.map((row) => row.calculated.gross)),
  deduction: sumMoney(rows.map((row) => row.calculated.totalDeduction)),
  net: sumMoney(rows.map((row) => row.calculated.net)),
  received: sumMoney(rows.map((row) => row.calculated.received)),
  outstanding: sumMoney(rows.map((row) => row.calculated.outstanding)),
  retention: sumMoney(rows.flatMap((row) => row.deductions.filter((line) => line.code.startsWith('RET_')).map((line) => line.amount))),
});

interface Analysis {
  preview: ImportPreview;
  parsed: ParsedImportRow[];
  projects: ProjectRecord[];
  config: BillTrackingConfig;
}

async function analyse(context: BtContext, input: ImportPreviewInput): Promise<Analysis> {
  context.require('Import', 'Import');
  const config = await loadConfig(context.organizationId);
  const [projects, clients, existing] = await Promise.all([loadProjects(context, config.projectProfiles), loadClients(), loadScopedBills(context)]);
  const clientName = new Map(clients.map((client) => [client.id, client.name]));
  const grid = input.grid as ImportCell[][];
  const autoLayout = readSheetLayout(grid, input.headerRow);
  const columnMap = applyColumnOverrides(autoLayout.columnMap, input.columnOverrides);
  const used = new Set(Object.values(columnMap));
  const parsed = parseImportRows(
    grid,
    { headerRow: autoLayout.headerRow, columnMap },
    {
      projects: projects.map((project) => ({ id: project.id, name: project.name, code: project.code, clientName: project.clientName ?? (project.clientId ? clientName.get(project.clientId) : undefined), dgmOffice: project.dgmOffice })),
      billTypes: config.billTypes,
      billCategories: config.billCategories,
      deductionTypes: config.deductionTypes,
      projectMappings: config.projectMappings,
      tolerance: config.settings.tolerance,
      roundNetToRupee: config.settings.roundNetToRupee,
      piMarker: config.settings.piMarker,
    },
    { projectOverrides: input.projectOverrides, confirmedFuzzy: input.confirmedFuzzy },
  );

  const keys = existingKeys(existing);
  const rows: PreviewRow[] = parsed.rows.map((row, index) => {
    const duplicate = classifyDuplicate(row, keys, parsed.rows.slice(0, index));
    const chosen = input.rowActions[String(row.row)];
    const fallback = defaultRowAction(duplicate.kind);
    // "Update existing" only makes sense against a bill already in SEL LIVE.
    const action = chosen === 'update' && !duplicate.existingBillId ? fallback : (chosen ?? fallback);
    const { projectMatch: _match, raw: _raw, ...rest } = row;
    return { ...rest, duplicate, action };
  });

  const rowsByProject = new Map<string, number>();
  parsed.rows.forEach((row) => rowsByProject.set(projectKey(row.projectExcelName), (rowsByProject.get(projectKey(row.projectExcelName)) ?? 0) + 1));
  const selected = parsed.rows.filter((row, index) => rows[index].action !== 'skip');

  const preview: ImportPreview = {
    sheetName: input.sheetName,
    headerRow: autoLayout.headerRow,
    headings: autoLayout.headings,
    columnMap,
    unmappedHeadings: autoLayout.headings.filter((heading, index) => heading && !used.has(index)),
    missingRequired: IMPORT_COLUMNS.filter((column) => column.required && columnMap[column.key] === undefined).map((column) => column.label),
    rows,
    blankRows: parsed.blankRows,
    staleRows: parsed.staleRows,
    projects: parsed.projects.map((match) => ({
      ...match,
      key: projectKey(match.excelName),
      rows: rowsByProject.get(projectKey(match.excelName)) ?? 0,
      candidates: match.candidates.map((candidate) => ({ id: candidate.project.id, name: candidate.project.name, score: Math.round(candidate.score * 100) / 100 })),
    })),
    unknownBillTypes: parsed.unknownBillTypes,
    summary: {
      detected: rows.length,
      valid: rows.filter((row) => row.validation === 'valid').length,
      warning: rows.filter((row) => row.validation === 'warning').length,
      error: rows.filter((row) => row.validation === 'error').length,
      duplicateExact: rows.filter((row) => row.duplicate.kind === 'exact').length,
      duplicatePossible: rows.filter((row) => row.duplicate.kind === 'possible').length,
      toImport: rows.filter((row) => row.action === 'import' || row.action === 'import_new').length,
      toUpdate: rows.filter((row) => row.action === 'update').length,
      toSkip: rows.filter((row) => row.action === 'skip').length,
      undecided: rows.filter((row) => row.action === 'review').length,
      receipts: rows.filter((row) => row.action !== 'skip' && row.action !== 'update' && toPaise(row.calculated.received) !== 0).length,
    },
    excelTotals: excelTotals(selected),
    calculatedTotals: calculatedTotalsOf(selected),
  };
  return { preview, parsed: parsed.rows, projects, config };
}

export async function previewImport(context: BtContext, input: ImportPreviewInput): Promise<ImportPreview> {
  return (await analyse(context, input)).preview;
}

/* ── start ───────────────────────────────────────────────────────────────── */

interface StartOptions {
  rememberMappings: boolean;
  addUnknownBillTypes: boolean;
}

export async function startImport(context: BtContext, input: ImportPreviewInput, options: StartOptions): Promise<{ jobId: string; preview: ImportPreview }> {
  const { preview, parsed, config } = await analyse(context, input);
  if (preview.missingRequired.length) throw new BtError(`Map the required columns first: ${preview.missingRequired.join(', ')}.`);
  const blocking = preview.rows.filter((row) => row.action !== 'skip' && (row.validation === 'error' || row.action === 'review'));
  if (blocking.length) {
    throw new BtError(`${blocking.length} selected row(s) still have errors or an undecided duplicate (rows ${blocking.slice(0, 12).map((row) => row.row).join(', ')}${blocking.length > 12 ? '…' : ''}). Fix or skip them first.`, 422);
  }
  if (!preview.rows.some((row) => row.action !== 'skip')) throw new BtError('Every row is set to skip — there is nothing to import.');
  // A row's bill date, and the date of the receipt it brings in, must both be in open months.
  const closedMonth = (dateKey: string | undefined) => (dateKey && config.settings.closedMonths.includes(monthKeyOf(dateKey)) ? monthKeyOf(dateKey) : null);
  const closedOf = (row: PreviewRow) =>
    [closedMonth(row.billDate), row.action !== 'update' && toPaise(row.calculated.received) !== 0 ? closedMonth(row.receiptDate ?? row.billDate) : null].filter((month): month is string => Boolean(month));
  const closedRows = preview.rows.filter((row) => row.action !== 'skip' && closedOf(row).length);
  if (closedRows.length && !context.can('Settings', 'Close Month')) {
    throw new BtError(`${closedRows.length} row(s) are dated, or bring a receipt dated, in closed months (${[...new Set(closedRows.flatMap(closedOf))].join(', ')}). Reopen those months or skip the rows.`, 423);
  }

  const firestore = db();
  const jobRef = firestore.collection(BT_COLLECTIONS.importJobs).doc();
  const counterRef = firestore.collection(BT_COLLECTIONS.counters).doc(`${context.organizationId}_import`);
  const grid = input.grid as ImportCell[][];
  const financialYears = [...new Set(preview.rows.filter((row) => row.financialYear).map((row) => row.financialYear as string))];

  // Configuration first: the sub categories the rows will post to, and the mappings to remember.
  // A sub category the workbook introduces is created under its inferred main category for the
  // projects that use it; a known one used on a project it is not enabled for is enabled there.
  const imported = preview.rows.filter((row) => row.action !== 'skip' && row.billTypeName && row.projectId);
  const projectsUsing = (name: string) => [...new Set(imported.filter((row) => row.billTypeName === name).map((row) => row.projectId as string))];
  // Remembered for the next workbook: a project chosen by hand, or a suggestion the user confirmed — and
  // only for an Excel name some imported row uses. An unconfirmed guess, or one whose rows were all
  // skipped, is never remembered.
  const importedNames = new Set(imported.map((row) => projectKey(row.projectExcelName)));
  const confirmed = new Set(input.confirmedFuzzy);
  const toRemember = options.rememberMappings
    ? preview.projects.filter((match) => match.project && importedNames.has(match.key) && (match.kind === 'override' || (match.kind === 'fuzzy' && confirmed.has(match.key))))
    : [];
  if (options.addUnknownBillTypes || toRemember.length) {
    // Read fresh in a transaction, never the cached copy, and write only these two lists: a month closed
    // or a setting saved meanwhile is never reverted. `settings.updatedAt` moves on, so a Settings page
    // opened before the import is refused as stale instead of deleting what the import added.
    const ref = configRef(firestore, context.organizationId);
    const changed = await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const fresh = withConfigDefaults(snapshot.exists ? (snapshot.data() as Partial<BillTrackingConfig>) : null);
      const billTypes: BillTypeMaster[] = fresh.billTypes.map((type) => ({ ...type, projectIds: [...type.projectIds] }));
      if (options.addUnknownBillTypes) {
        for (const name of preview.unknownBillTypes) {
          billTypes.push({ id: `bt-imp-${projectKey(name)}-${Date.now().toString(36)}`, ...provisionalBillType(name, fresh.billCategories, projectsUsing(name)) });
        }
        for (const row of imported) {
          if (!row.billTypeId) continue;
          const type = billTypes.find((entry) => entry.id === row.billTypeId);
          if (type && type.projectIds.length && !type.projectIds.includes(row.projectId as string)) type.projectIds.push(row.projectId as string);
        }
      }
      const mappings: ProjectNameMapping[] = [...fresh.projectMappings];
      for (const match of toRemember) {
        const project = match.project as NonNullable<typeof match.project>;
        const index = mappings.findIndex((entry) => entry.key === match.key);
        if (index >= 0 && mappings[index].projectId === project.id) continue;
        const entry: ProjectNameMapping = { key: match.key, excelName: match.excelName, projectId: project.id, projectName: project.name, createdBy: context.userId, createdAt: nowIso() };
        if (index >= 0) mappings[index] = entry;
        else mappings.push(entry);
      }
      if (JSON.stringify(billTypes) === JSON.stringify(fresh.billTypes) && JSON.stringify(mappings) === JSON.stringify(fresh.projectMappings)) return false;
      transaction.set(ref, clean({ billTypes, projectMappings: mappings, settings: { updatedAt: nowIso(), updatedBy: context.userId } }), { merge: true });
      return true;
    });
    if (changed) invalidateConfig(context.organizationId);
  }

  const jobNumber = await firestore.runTransaction(async (transaction) => {
    const counter = await transaction.get(counterRef);
    const next = (counter.exists ? Number(counter.data()?.value ?? 0) : 0) + 1;
    transaction.set(counterRef, { value: next, updatedAt: nowIso() }, { merge: true });
    return `IMP-${new Date().getFullYear()}-${String(next).padStart(4, '0')}`;
  });

  const job: Omit<StoredJob, 'id'> = clean({
    organizationId: context.organizationId,
    jobNumber,
    fileName: input.fileName,
    fileSize: input.fileSize,
    checksum: input.checksum,
    sheetName: input.sheetName,
    headerRow: preview.headerRow,
    headings: preview.headings,
    columnMap: preview.columnMap,
    financialYear: financialYears.length === 1 ? financialYears[0] : financialYears.join(', '),
    rowsDetected: preview.summary.detected,
    rowsValid: preview.summary.valid,
    rowsWarning: preview.summary.warning,
    rowsFailed: 0,
    rowsDuplicate: preview.summary.duplicateExact + preview.summary.duplicatePossible,
    rowsImported: 0,
    rowsUpdated: 0,
    rowsSkipped: preview.summary.toSkip,
    rowsPending: preview.summary.toImport + preview.summary.toUpdate,
    status: 'importing',
    excelTotals: preview.excelTotals,
    uploadedBy: context.userId,
    uploadedByName: context.userName,
    uploadedAt: nowIso(),
  });
  await jobRef.set(job);

  // Rows in batches of 400 (Firestore's batch limit is 500 writes).
  const byRow = new Map(parsed.map((row) => [row.row, row]));
  for (let start = 0; start < preview.rows.length; start += 400) {
    const batch = firestore.batch();
    for (const row of preview.rows.slice(start, start + 400)) {
      const parsedRow = byRow.get(row.row) as ParsedImportRow;
      const { projectMatch: _match, ...storedParsed } = parsedRow;
      batch.set(
        jobRef.collection(BT_COLLECTIONS.importRows).doc(String(row.row).padStart(5, '0')),
        clean({
          row: row.row,
          cells: grid[row.row - 1] ?? [],
          parsed: storedParsed,
          duplicate: row.duplicate,
          action: row.action,
          state: (row.action === 'skip' ? 'skipped' : 'pending') as ImportRowState,
          validation: row.validation,
          issues: row.issues,
        }),
      );
    }
    await batch.commit();
  }

  await logActivity(context, {
    entityType: 'import',
    entityId: jobRef.id,
    action: 'import_started',
    summary: `Import ${jobNumber} started from ${input.fileName}: ${preview.summary.toImport} to import, ${preview.summary.toUpdate} to update, ${preview.summary.toSkip} skipped`,
  });
  return { jobId: jobRef.id, preview };
}

/** Keeps the original workbook alongside the job (never modified). */
export async function storeImportFile(context: BtContext, jobId: string, file: File): Promise<void> {
  context.require('Import', 'Import');
  const jobRef = db().collection(BT_COLLECTIONS.importJobs).doc(jobId);
  const job = (await jobRef.get()).data() as StoredJob | undefined;
  if (!job || job.organizationId !== context.organizationId) throw new BtError('Import job not found.', 404);
  if (file.size > 25 * 1024 * 1024) throw new BtError('Workbooks are limited to 25 MB.', 413);
  const bytes = Buffer.from(await file.arrayBuffer());
  const digest = Buffer.from(await globalThis.crypto.subtle.digest('SHA-256', bytes)).toString('hex');
  if (digest !== job.checksum) throw new BtError('This file does not match the workbook that was previewed.', 409);
  const storagePath = `bill-tracking/${context.organizationId}/imports/${jobId}/${job.fileName.replace(/[^A-Za-z0-9._-]+/g, '_')}`;
  await getFirebaseAdminBucket().file(storagePath).save(bytes, { contentType: file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', resumable: false });
  await jobRef.update({ storagePath });
}

/* ── process ─────────────────────────────────────────────────────────────── */

interface StoredRow {
  row: number;
  cells: ImportCell[];
  parsed: Omit<ParsedImportRow, 'projectMatch'>;
  duplicate: ReturnType<typeof classifyDuplicate>;
  action: ImportRowAction;
  state: ImportRowState;
  billId?: string;
  collectionId?: string;
  importVersion?: number;
  previous?: Partial<Bill>;
  error?: string;
  issues: ParsedImportRow['issues'];
}

const importedBillId = (jobId: string, row: number) => `imp-${jobId}-${row}`;

function deductionsOf(row: StoredRow['parsed'], config: BillTrackingConfig): BillDeduction[] {
  return row.deductions.map((line, index) => {
    const type = config.deductionTypes.find((entry) => entry.code === line.code || entry.id === line.deductionTypeId);
    return clean({
      id: `d${index + 1}-${line.code}`,
      deductionTypeId: type?.id ?? line.deductionTypeId ?? line.code,
      deductionTypeName: type?.name ?? line.name,
      kind: type?.kind ?? 'other',
      amount: line.amount,
    });
  });
}

/**
 * The source values an "update existing" row writes, kept for the rollback — never receipts, never
 * workflow, never the transaction type (SEL LIVE knows a debit note or an advance better than the
 * sheet does, and a certified invoice may not become a note). The GST parts follow the GST total.
 */
const SOURCE_FIELDS = ['taxableAmount', 'gstAmount', 'gstType', 'cgstAmount', 'sgstAmount', 'igstAmount', 'deductions', 'gstInvoiceNumber', 'billSerialNumber', 'serialNumber', 'billDate', 'financialYear', 'description', 'billTypeId', 'billTypeName', 'billCategory', 'billCategoryName', 'isRetentionBill', 'legacyStatus', 'importedNetAmount', 'importedTotalDeduction', 'importedReceived', 'targetWeek', 'receivedWeek', 'currentStage', 'remarks', 'typeV2', 'taxableOrAdvance', 'netMismatch'] as const;

export async function processImport(context: BtContext, jobId: string, chunkSize: number, retryFailed = false): Promise<{ job: BillImportJob; processed: number }> {
  context.require('Import', 'Import');
  const firestore = db();
  const jobRef = firestore.collection(BT_COLLECTIONS.importJobs).doc(jobId);
  const jobSnapshot = await jobRef.get();
  const job = jobSnapshot.data() as StoredJob | undefined;
  if (!job || job.organizationId !== context.organizationId) throw new BtError('Import job not found.', 404);
  if (job.status === 'rolled_back') throw new BtError('This import was rolled back.', 409);

  const config = await loadConfig(context.organizationId);
  const projects = await loadProjects(context, config.projectProfiles);
  const clients = await loadClients();
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const options = calculationOptions(config);

  // Legacy credit/debit notes name their invoice in the description ("Against Inv No -OD-168/…");
  // when that invoice is in SEL LIVE for the same project, the note is linked to it. One read per
  // project per run.
  const invoicesByProject = new Map<string, StoredBill[]>();
  const findInvoice = async (projectId: string, reference: string | undefined): Promise<StoredBill | undefined> => {
    if (!reference) return undefined;
    if (!invoicesByProject.has(projectId)) {
      const found = await firestore.collection(BT_COLLECTIONS.bills).where('organizationId', '==', context.organizationId).where('projectId', '==', projectId).where('isDeleted', '==', false).get();
      invoicesByProject.set(projectId, found.docs.map((doc) => ({ ...(doc.data() as StoredBill), id: doc.id })));
    }
    const key = reference.toLowerCase().replace(/[^a-z0-9]/g, '');
    return invoicesByProject.get(projectId)?.find((bill) => bill.transactionType !== 'credit_note' && bill.transactionType !== 'debit_note' && (bill.gstInvoiceNumber ?? '').toLowerCase().replace(/[^a-z0-9]/g, '') === key);
  };

  // "Retry failed rows" re-queues rows whose cause may since be fixed (a reopened month, a project
  // granted). Sorted here rather than with orderBy so the rows subcollection needs no composite index.
  const candidates = await jobRef.collection(BT_COLLECTIONS.importRows).where('state', 'in', retryFailed ? ['pending', 'failed'] : ['pending']).get();
  const pending = candidates.docs.sort((a, b) => Number(a.data().row) - Number(b.data().row)).slice(0, chunkSize);
  let processed = 0;

  for (const rowDoc of pending) {
    const stored = rowDoc.data() as StoredRow;
    const row = stored.parsed;
    processed += 1;
    try {
      const project = row.projectId ? projectById.get(row.projectId) : undefined;
      if (!project) throw new BtError(`Project for "${row.projectExcelName}" is not available to you.`);
      if (!row.billDate) throw new BtError('Bill date missing.');
      if (config.settings.closedMonths.includes(monthKeyOf(row.billDate)) && !context.can('Settings', 'Close Month')) throw new BtError(`${monthKeyOf(row.billDate)} is closed.`);
      const billType = config.billTypes.find((type) => type.id === row.billTypeId) ?? (row.billTypeName ? matchBillType(row.billTypeName, config.billTypes, project.id) : undefined);
      const category = config.billCategories.find((entry) => entry.id === (billType?.categoryId ?? row.billCategory));
      const client = project.clientId ? clients.find((entry) => entry.id === project.clientId) : undefined;
      const deductions = deductionsOf(row, config);
      const sourceValues = {
        financialYear: row.financialYear ?? financialYearOf(row.billDate),
        serialNumber: row.serialNumber,
        billSerialNumber: row.billSerialNumber,
        transactionType: row.transactionType,
        gstInvoiceNumber: row.gstInvoiceNumber,
        billDate: row.billDate,
        description: row.description,
        billTypeId: billType?.id,
        billTypeName: billType?.name ?? row.billTypeName ?? 'UNCLASSIFIED',
        billCategory: billType?.categoryId ?? row.billCategory,
        billCategoryName: category?.name,
        isRetentionBill: billType?.isRetentionBill ?? row.isRetentionBill,
        taxableAmount: row.taxableAmount,
        gstAmount: row.gstAmount,
        deductions,
        targetWeek: row.targetWeek,
        receivedWeek: row.receivedWeek,
        currentStage: row.stage,
        remarks: row.remarks,
        typeV2: row.typeV2,
        taxableOrAdvance: row.taxableOrAdvance,
        legacyStatus: row.legacyStatus,
        legacyTimestamp: row.legacyTimestamp,
        importedNetAmount: row.imported.netAmount,
        importedTotalDeduction: row.imported.totalDeduction,
        importedReceived: row.imported.received,
        // The sheet's net against the net of its own deduction columns — the bill as raised. Never the
        // totals below: a certified bill being updated is paid against its certified deductions.
        netMismatch: row.netMismatch && row.imported.netAmount !== undefined ? { imported: row.imported.netAmount, calculated: row.calculated.net } : undefined,
      };

      if (stored.action === 'update') {
        const billId = stored.duplicate.existingBillId as string;
        const billRef = firestore.collection(BT_COLLECTIONS.bills).doc(billId);
        await firestore.runTransaction(async (transaction) => {
          const [billSnapshot, rowSnapshot] = await transaction.getAll(billRef, rowDoc.ref);
          if ((rowSnapshot.data() as StoredRow).state === 'updated') return;
          const bill = { ...(billSnapshot.data() as StoredBill), id: billId };
          if (!billSnapshot.exists || bill.organizationId !== context.organizationId || bill.isDeleted) throw new BtError('The bill to update no longer exists.');
          context.require('Bills', 'Edit', bill.projectId);
          // The month the bill is dated in now must be open too, not only the sheet's date for it.
          if (config.settings.closedMonths.includes(monthKeyOf(bill.billDate)) && !context.can('Settings', 'Close Month')) {
            throw new BtError(`This bill is dated in ${monthKeyOf(bill.billDate)}, which is closed.`, 423);
          }
          const previous = Object.fromEntries(SOURCE_FIELDS.map((key) => [key, bill[key] ?? null]));
          const { transactionType: _sheetType, ...sheetValues } = sourceValues;
          // The stored bill's certification is kept, and with it its certified deductions. A sheet
          // exported from SEL LIVE carries those certified lines: they must not overwrite the lines
          // as raised, which the raised-vs-certified comparison still needs.
          const lines = bill.certification && sameDeductionAmounts(sheetValues.deductions, bill.certification.deductions ?? []) ? { ...sheetValues, deductions: bill.deductions } : sheetValues;
          const update = { ...lines, ...gstPartsFor(bill, sheetValues.gstAmount) };
          const merged = { ...bill, ...update };
          // The same lock as the bill form's: a bill past its amount-lock step changes its figures only
          // with Edit After Approval. Without it the row is left, failed, for someone who holds it.
          const changes = protectedChanges(bill, merged);
          if (changes.length && amountsLocked(bill, config.settings) && !context.can('Bills', 'Edit After Approval', bill.projectId)) {
            const at = bill.workflowStatus === 'returned' ? (bill.returnedFrom ?? 'draft') : bill.workflowStatus;
            throw new BtError(`This bill is at “${stepLabel(config.settings, at)}”: changing ${changes.join(', ')} needs Edit After Approval, so the row was left for someone who holds it.`, 403);
          }
          const totals = deriveBillTotals(merged, options);
          const version = (bill.version ?? 1) + 1;
          transaction.update(billRef, clean({
            ...update,
            // A "No GST" bill the sheet gives GST becomes one unsplit figure (`gstPartsFor`).
            ...('gstType' in update && update.gstType === undefined ? { gstType: FieldValue.delete() } : {}),
            netMismatch: sourceValues.netMismatch ?? FieldValue.delete(),
            ...derivedFields(totals),
            searchTokens: buildSearchTokens(merged),
            importJobId: jobId,
            importRowNumber: row.row,
            importFingerprint: row.fingerprint,
            version,
            updatedAt: nowIso(),
            updatedBy: context.userId,
            updatedByName: context.userName,
          }));
          transaction.update(rowDoc.ref, { state: 'updated', billId, importVersion: version, previous: clean(previous), error: FieldValue.delete() });
          transaction.set(firestore.collection(BT_COLLECTIONS.activity).doc(), clean({
            organizationId: context.organizationId, entityType: 'bill', entityId: billId, billId, projectId: bill.projectId, action: 'bill_updated_by_import',
            summary: `Updated from ${job.fileName} row ${row.row} (${job.jobNumber})`, previous, next: { taxableAmount: row.taxableAmount, gstAmount: row.gstAmount, netReceivable: totals.netReceivable },
            actorId: context.userId, actorName: context.userName, at: nowIso(),
          }));
        });
        continue;
      }

      // import / import_new
      const billId = importedBillId(jobId, row.row);
      const billRef = firestore.collection(BT_COLLECTIONS.bills).doc(billId);
      const isNote = row.transactionType === 'credit_note' || row.transactionType === 'debit_note';
      const againstInvoice = isNote ? await findInvoice(project.id, againstInvoiceFromDescription(row.description)) : undefined;
      const hasReceipt = toPaise(row.calculated.received) !== 0;
      // The receipt is checked against its own date, as a receipt recorded by hand is.
      const receiptMonth = hasReceipt ? monthKeyOf(row.receiptDate ?? (row.billDate as string)) : null;
      if (receiptMonth && config.settings.closedMonths.includes(receiptMonth) && !context.can('Settings', 'Close Month')) throw new BtError(`The receipt is dated in ${receiptMonth}, which is closed.`, 423);
      const collectionRef = firestore.collection(BT_COLLECTIONS.collections).doc(`${billId}-c`);
      await firestore.runTransaction(async (transaction) => {
        const [existing, rowSnapshot] = await transaction.getAll(billRef, rowDoc.ref);
        if (existing.exists) {
          // A previous attempt committed the bill but not the row state: record it, don't duplicate.
          if ((rowSnapshot.data() as StoredRow).state !== 'imported') transaction.update(rowDoc.ref, { state: 'imported', billId, importVersion: Number(existing.data()?.version ?? 1), error: FieldValue.delete() });
          return;
        }
        context.require('Bills', 'Add', project.id);
        const receiptDate = row.receiptDate ?? row.billDate as string;
        const collections = hasReceipt ? [clean({ collectionId: collectionRef.id, receiptDate, amount: row.calculated.received, status: 'verified' as const })] : [];
        const totals = deriveBillTotals({ taxableAmount: row.taxableAmount, gstAmount: row.gstAmount, deductions, collections }, options);
        const dueDate = computeDueDate(row.billDate as string, project, client, config);
        const bill: Omit<StoredBill, 'id'> = clean({
          ...sourceValues,
          organizationId: context.organizationId,
          dueDate,
          originalDueDate: dueDate,
          againstBillId: againstInvoice?.id,
          againstBillRef: againstInvoice ? againstInvoice.gstInvoiceNumber || againstInvoice.billSerialNumber : undefined,
          againstBillDate: againstInvoice?.billDate,
          projectId: project.id,
          projectNameSnapshot: project.name,
          clientId: project.clientId,
          clientNameSnapshot: client?.name ?? project.clientName,
          dgmOffice: project.dgmOffice,
          ...derivedFields(totals),
          lastReceiptDate: totals.lastReceiptDate,
          collections,
          // Legacy bills were raised long ago; they enter at follow-up (or closed when paid).
          workflowStatus: totals.paymentStatus === 'received' ? 'closed' : 'payment_followup',
          source: 'excel_import',
          importJobId: jobId,
          importRowNumber: row.row,
          importFingerprint: row.fingerprint,
          searchTokens: buildSearchTokens({ ...sourceValues, projectNameSnapshot: project.name, clientNameSnapshot: client?.name ?? project.clientName, dgmOffice: project.dgmOffice }),
          version: 1,
          createdAt: nowIso(),
          createdBy: context.userId,
          createdByName: context.userName,
          updatedAt: nowIso(),
          updatedBy: context.userId,
          updatedByName: context.userName,
          isDeleted: false,
        });
        transaction.set(billRef, bill);
        if (hasReceipt) {
          const collection: Omit<BillCollection, 'id'> & { organizationId: string } = clean({
            organizationId: context.organizationId,
            financialYear: financialYearOf(receiptDate),
            receiptDate,
            amount: row.calculated.received,
            allocatedAmount: row.calculated.received,
            unallocatedAmount: 0,
            allocations: [clean({ billId, billSerialNumber: row.billSerialNumber, gstInvoiceNumber: row.gstInvoiceNumber, projectId: project.id, projectNameSnapshot: project.name, amount: row.calculated.received })],
            billIds: [billId],
            projectIds: [project.id],
            clientId: project.clientId,
            remarks: `Imported from ${job.fileName} row ${row.row}${row.receiptDate ? '' : ' (no receipt date on the sheet — bill date used)'}`,
            status: 'verified',
            source: 'excel_import',
            importJobId: jobId,
            createdBy: context.userId,
            createdByName: context.userName,
            createdAt: nowIso(),
            verifiedBy: context.userId,
            verifiedByName: context.userName,
            verifiedAt: nowIso(),
            updatedAt: nowIso(),
          });
          transaction.set(collectionRef, collection);
          if (bill.isRetentionBill) {
            transaction.set(firestore.collection(BT_COLLECTIONS.retention).doc(`${billId}-r`), clean({
              organizationId: context.organizationId, projectId: project.id, projectNameSnapshot: project.name, retentionBillId: billId, collectionId: collectionRef.id,
              kind: 'retention_invoice', releaseDate: receiptDate, amount: row.calculated.received, remarks: `Imported receipt on retention bill (row ${row.row})`,
              status: 'active', createdBy: context.userId, createdByName: context.userName, createdAt: nowIso(),
            }));
          }
        }
        transaction.update(rowDoc.ref, { state: 'imported', billId, collectionId: hasReceipt ? collectionRef.id : FieldValue.delete(), importVersion: 1, error: FieldValue.delete() });
        transaction.set(firestore.collection(BT_COLLECTIONS.activity).doc(), clean({
          organizationId: context.organizationId, entityType: 'bill', entityId: billId, billId, projectId: project.id, action: 'bill_imported',
          summary: `Imported from ${job.fileName} row ${row.row} (${job.jobNumber})`, next: { netReceivable: totals.netReceivable, received: totals.totalReceived },
          actorId: context.userId, actorName: context.userName, at: nowIso(),
        }));
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Import failed';
      console.error(`[bill-tracking:import] job ${jobId} row ${stored.row}: ${error instanceof BtError ? message : (error as Error)?.name ?? 'error'}`);
      await rowDoc.ref.update({ state: 'failed', error: message.slice(0, 500) });
    }
  }

  const refreshed = await refreshJobCounts(jobRef);
  return { job: refreshed, processed };
}

async function refreshJobCounts(jobRef: DocumentReference): Promise<BillImportJob> {
  const rows = await jobRef.collection(BT_COLLECTIONS.importRows).select('state').get();
  const count = (state: ImportRowState) => rows.docs.filter((doc) => doc.data().state === state).length;
  const pending = count('pending');
  const failed = count('failed');
  const update = {
    rowsImported: count('imported'),
    rowsUpdated: count('updated'),
    rowsSkipped: count('skipped'),
    rowsFailed: failed,
    rowsPending: pending,
    status: pending > 0 ? 'importing' : failed > 0 ? 'partial' : 'completed',
    ...(pending === 0 ? { completedAt: nowIso() } : {}),
  };
  await jobRef.update(update);
  const snapshot = await jobRef.get();
  return { ...(snapshot.data() as BillImportJob), id: snapshot.id };
}

/* ── history, rows, rollback ─────────────────────────────────────────────── */

export async function listImportJobs(context: BtContext): Promise<BillImportJob[]> {
  context.require('Import', 'View');
  const snapshot = await db().collection(BT_COLLECTIONS.importJobs).where('organizationId', '==', context.organizationId).get();
  return snapshot.docs
    .map((doc) => {
      const { columnMap: _map, ...job } = doc.data() as StoredJob;
      return { ...job, id: doc.id };
    })
    .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
}

export async function loadImportJob(context: BtContext, jobId: string): Promise<{ job: BillImportJob; rows: StoredRow[] }> {
  context.require('Import', 'View');
  const jobRef = db().collection(BT_COLLECTIONS.importJobs).doc(jobId);
  const snapshot = await jobRef.get();
  const job = snapshot.data() as StoredJob | undefined;
  if (!job || job.organizationId !== context.organizationId) throw new BtError('Import job not found.', 404);
  const rows = await jobRef.collection(BT_COLLECTIONS.importRows).orderBy('row').get();
  return { job: { ...job, id: snapshot.id }, rows: rows.docs.map((doc) => doc.data() as StoredRow) };
}

export async function rollbackImport(context: BtContext, jobId: string, reason: string): Promise<{ deleted: number; restored: number }> {
  context.require('Import', 'Rollback');
  const firestore = db();
  const config = await loadConfig(context.organizationId);
  const { job, rows } = await loadImportJob(context, jobId);
  if (job.status === 'rolled_back') throw new BtError('This import has already been rolled back.', 409);
  if (job.status === 'importing') throw new BtError('Finish or abandon the running import before rolling it back.', 409);
  const touched = rows.filter((row) => row.state === 'imported' || row.state === 'updated');

  // Refuse if anything the import wrote has been worked on since. A bill it updated may have had
  // receipts before the import — its version alone says whether anything happened since.
  const changed: string[] = [];
  const closed = new Set<string>();
  const isClosed = (dateKey: unknown) => typeof dateKey === 'string' && config.settings.closedMonths.includes(monthKeyOf(dateKey));
  for (const group of chunked(touched, 100)) {
    const snapshots = await firestore.getAll(...group.map((row) => firestore.collection(BT_COLLECTIONS.bills).doc(row.billId as string)));
    snapshots.forEach((snapshot, index) => {
      const row = group[index];
      const bill = snapshot.data() as StoredBill | undefined;
      if (!bill) return;
      context.requireProject(bill.projectId);
      if ((bill.version ?? 1) !== (row.importVersion ?? 1) || (row.state === 'imported' && bill.collections.some((entry) => !entry.collectionId.startsWith(`imp-${jobId}`)))) {
        changed.push(`row ${row.row} (${bill.gstInvoiceNumber || bill.billSerialNumber || snapshot.id})`);
      }
      // Rolling back deletes or rewrites records dated in these months: a month closed since is respected.
      const dates = row.state === 'imported' ? [bill.billDate, row.collectionId ? (row.parsed.receiptDate ?? row.parsed.billDate) : undefined] : [bill.billDate, row.previous?.billDate];
      for (const date of dates) if (isClosed(date)) closed.add(monthKeyOf(date as string));
    });
  }
  if (changed.length) {
    throw new BtError(`${changed.length} bill(s) from this import have been changed since (${changed.slice(0, 8).join(', ')}${changed.length > 8 ? '…' : ''}). Roll back is refused so that later work is not lost.`, 409, { changed });
  }
  if (closed.size && !context.can('Settings', 'Close Month')) {
    throw new BtError(`Rolling back would change bills or receipts dated in closed months (${[...closed].sort().join(', ')}). Reopen those months first.`, 423);
  }

  let deleted = 0;
  let restored = 0;
  for (const group of chunked(touched, 120)) {
    const batch = firestore.batch();
    for (const row of group) {
      const billRef = firestore.collection(BT_COLLECTIONS.bills).doc(row.billId as string);
      if (row.state === 'imported') {
        batch.update(billRef, { isDeleted: true, deletedAt: nowIso(), deletedBy: context.userId, deleteReason: `Import ${job.jobNumber} rolled back: ${reason}`, paymentStatus: 'cancelled', outstandingAmount: 0, updatedAt: nowIso() });
        if (row.collectionId) {
          batch.update(firestore.collection(BT_COLLECTIONS.collections).doc(row.collectionId), { status: 'cancelled', cancelledBy: context.userId, cancelledAt: nowIso(), cancelReason: `Import rolled back: ${reason}`, updatedAt: nowIso() });
          const releaseRef = firestore.collection(BT_COLLECTIONS.retention).doc(`${row.billId}-r`);
          batch.set(releaseRef, { status: 'cancelled', cancelledBy: context.userId, cancelledAt: nowIso(), cancelReason: 'Import rolled back' }, { merge: true });
        }
        deleted += 1;
      } else if (row.previous) {
        const snapshot = await billRef.get();
        const bill = { ...(snapshot.data() as StoredBill), id: snapshot.id };
        const merged = { ...bill, ...(row.previous as Partial<Bill>) };
        const totals = deriveBillTotals(merged as Bill, calculationOptions(config));
        batch.update(billRef, clean({
          ...Object.fromEntries(Object.entries(row.previous).map(([key, value]) => [key, value === null ? FieldValue.delete() : value])),
          ...derivedFields(totals),
          version: (bill.version ?? 1) + 1,
          updatedAt: nowIso(),
          updatedBy: context.userId,
        }));
        restored += 1;
      }
      batch.update(firestore.collection(BT_COLLECTIONS.importJobs).doc(jobId).collection(BT_COLLECTIONS.importRows).doc(String(row.row).padStart(5, '0')), { state: 'rolled_back' });
    }
    await batch.commit();
  }
  await firestore.collection(BT_COLLECTIONS.importJobs).doc(jobId).update({ status: 'rolled_back', rolledBackAt: nowIso(), rolledBackBy: context.userId, rollbackReason: reason });
  await logActivity(context, { entityType: 'import', entityId: jobId, action: 'import_rolled_back', summary: `Import ${job.jobNumber} rolled back: ${deleted} bill(s) removed, ${restored} restored`, reason });
  return { deleted, restored };
}

const chunked = <T>(items: readonly T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
};

/* ── reconciliation ──────────────────────────────────────────────────────── */

export interface ReconciliationLine {
  key: string;
  label: string;
  excel: ImportReconciliationTotals;
  live: ImportReconciliationTotals;
}

export interface ReconciliationRow {
  row: number;
  billId?: string;
  project: string;
  billType?: string;
  month?: string;
  reference?: string;
  excelNet: number;
  liveNet: number;
  excelReceived: number;
  liveReceived: number;
  excelOutstanding: number;
  liveOutstanding: number;
  explanation: string[];
}

export interface Reconciliation {
  job: BillImportJob;
  totals: ReconciliationLine;
  byProject: ReconciliationLine[];
  byBillType: ReconciliationLine[];
  byMonth: ReconciliationLine[];
  differences: ReconciliationRow[];
  reconciled: boolean;
}

/**
 * Workbook vs SEL LIVE for one import: the sheet's own figures (its Net, Total Deduction and
 * Shortfall columns) against the bills as they stand now, read as raised (`asRaised`). Every row
 * whose figures differ is listed with the reason the import recorded (net mismatch, rounding within
 * tolerance, legacy status), so the migration is accepted only when each difference is explained.
 */
export async function reconcileImport(context: BtContext, jobId: string): Promise<Reconciliation> {
  const { job, rows } = await loadImportJob(context, jobId);
  const touched = rows.filter((row) => row.state === 'imported' || row.state === 'updated');
  const bills = new Map<string, StoredBill>();
  for (const group of chunked(touched, 100)) {
    const snapshots = await db().getAll(...group.map((row) => db().collection(BT_COLLECTIONS.bills).doc(row.billId as string)));
    snapshots.forEach((snapshot) => snapshot.exists && bills.set(snapshot.id, { ...(snapshot.data() as StoredBill), id: snapshot.id }));
  }

  // A certification's deductions would otherwise read as an import difference — "unexplained", or rounding.
  const liveTotals = (list: StoredBill[]): ImportReconciliationTotals => ({
    bills: list.length,
    taxable: sumMoney(list.map((bill) => bill.taxableAmount)),
    gst: sumMoney(list.map((bill) => bill.gstAmount)),
    gross: sumMoney(list.map((bill) => bill.grossAmount)),
    deduction: sumMoney(list.map((bill) => asRaised(bill).deduction)),
    net: sumMoney(list.map((bill) => asRaised(bill).net)),
    received: sumMoney(list.map((bill) => bill.totalReceived)),
    // Shortfall, not "outstanding after tolerance": the workbook keeps rupee differences, so compare like with like.
    outstanding: sumMoney(list.map((bill) => asRaised(bill).shortfall)),
    retention: sumMoney(list.map((bill) => asRaised(bill).retention)),
  });

  const line = (key: string, label: string, subset: StoredRow[]): ReconciliationLine => ({
    key,
    label,
    excel: excelTotals(subset.map((row) => row.parsed as ParsedImportRow)),
    live: liveTotals(subset.map((row) => bills.get(row.billId as string)).filter((bill): bill is StoredBill => Boolean(bill) && !bill?.isDeleted)),
  });
  const groupBy = (keyOf: (row: StoredRow) => string, labelOf: (row: StoredRow) => string) => {
    const groups = new Map<string, StoredRow[]>();
    touched.forEach((row) => groups.set(keyOf(row), [...(groups.get(keyOf(row)) ?? []), row]));
    return [...groups.entries()].map(([key, subset]) => line(key, labelOf(subset[0]), subset)).sort((a, b) => a.label.localeCompare(b.label));
  };

  const differences: ReconciliationRow[] = [];
  for (const row of touched) {
    const bill = bills.get(row.billId as string);
    const parsed = row.parsed;
    const excelNet = parsed.imported.netAmount ?? parsed.calculated.net;
    const excelReceived = parsed.imported.received ?? 0;
    const excelOutstanding = parsed.imported.difference ?? subtractMoney(excelNet, excelReceived);
    const live = bill ? asRaised(bill) : undefined;
    const liveNet = live?.net ?? 0;
    const liveReceived = bill?.totalReceived ?? 0;
    const liveOutstanding = live?.shortfall ?? 0;
    if (toPaise(excelNet) === toPaise(liveNet) && toPaise(excelReceived) === toPaise(liveReceived) && toPaise(excelOutstanding) === toPaise(liveOutstanding)) continue;
    const explanation: string[] = [];
    if (!bill || bill.isDeleted) explanation.push('Bill no longer exists in SEL LIVE.');
    if (parsed.netMismatch) explanation.push(`Sheet net was typed over the formula: ${excelNet} vs calculated ${parsed.calculated.net}.`);
    else if (toPaise(excelNet) !== toPaise(liveNet) && Math.abs(excelNet - liveNet) <= 1) explanation.push('Rounding within the ₹1 tolerance.');
    if (bill && bill.version !== row.importVersion) explanation.push('Bill has been edited or received against since the import.');
    if (toPaise(excelReceived) !== toPaise(liveReceived) && bill?.version === row.importVersion) explanation.push('Receipt total differs from the sheet.');
    if (!explanation.length) explanation.push('Unexplained — review this row.');
    differences.push({
      row: row.row,
      billId: row.billId,
      project: bill?.projectNameSnapshot ?? parsed.projectExcelName,
      billType: parsed.billTypeName,
      month: parsed.billDate ? monthKeyOf(parsed.billDate) : undefined,
      reference: parsed.gstInvoiceNumber ?? parsed.billSerialNumber,
      excelNet,
      liveNet,
      excelReceived,
      liveReceived,
      excelOutstanding,
      liveOutstanding,
      explanation,
    });
  }

  return {
    job,
    totals: line('all', 'All imported rows', touched),
    byProject: groupBy((row) => row.parsed.projectId ?? row.parsed.projectExcelName, (row) => bills.get(row.billId as string)?.projectNameSnapshot ?? row.parsed.projectExcelName),
    byBillType: groupBy((row) => row.parsed.billTypeName ?? '—', (row) => row.parsed.billTypeName ?? 'Unclassified'),
    byMonth: groupBy((row) => (row.parsed.billDate ? monthKeyOf(row.parsed.billDate) : '—'), (row) => (row.parsed.billDate ? monthKeyOf(row.parsed.billDate) : 'No date')),
    differences: differences.sort((a, b) => a.row - b.row),
    reconciled: differences.every((row) => !row.explanation.includes('Unexplained — review this row.')),
  };
}

export type { StoredRow as ImportRowRecord };
