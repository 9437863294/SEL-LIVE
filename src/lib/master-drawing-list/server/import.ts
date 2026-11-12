import 'server-only';

/**
 * The Excel Import page's server side. The browser reads the workbook into text cells; this parses
 * them again with the shared readers — never trusting the browser's own preview — and either reports
 * what it would write (dry run) or writes it.
 *
 *   - The consolidated workbook (Projects, Items, Revisions sheets): `../import.ts`.
 *   - A project's own MDL workbook, into an existing drawing list, with the column mapping the page
 *     showed (and any rows skipped or corrected there): `../workbook-import.ts`.
 *
 * Every import is recorded in `mdl_imports/{id}` — who, when, which file, what it wrote — and the
 * items it writes carry that id, so Undo can remove the items an import created, as long as nobody
 * has edited them since. The column mappings of a project workbook are remembered (by the sheet's
 * headings) for the next import, in `mdl_settings/importMappings`.
 */

import { FieldValue, type DocumentData } from 'firebase-admin/firestore';

import { ImportFormatError, parseImport, summariseImport, writeImport, type ImportSummary, type ParsedImport } from '../import.ts';
import type { ImportInput } from '../schemas.ts';
import { allNames } from '../settings.ts';
import { headerSignature, parseProjectWorkbook, type ColumnRole, type ImportRowResult, type MappingTemplate, type WorkbookSheetSummary } from '../workbook-import.ts';
import { MdlError, type MdlContext } from './context.ts';
import { loadSettings, SETTINGS_COLLECTION } from './settings.ts';
import { allProjects, db, itemsCol, projectFor } from './store.ts';

export const IMPORTS_COLLECTION = 'mdl_imports';
const importsCol = () => db().collection(IMPORTS_COLLECTION);
const mappingsDoc = () => db().collection(SETTINGS_COLLECTION).doc('importMappings');
const MAX_TEMPLATES = 100;

export interface ImportResult {
  summary: ImportSummary;
  /** Per sheet, for a project workbook. */
  sheets?: WorkbookSheetSummary[];
  /** Every row as read, for a project workbook (the validation table). */
  rows?: ImportRowResult[];
  /** Set when the import was written. */
  written?: { projects: number; written: number; skipped: number };
  importId?: string;
}

export interface ImportRecord {
  id: string;
  at: string;
  by: string;
  byName: string;
  fileName: string;
  kind: 'project' | 'consolidated';
  projectCodes: string[];
  written: number;
  skipped: number;
  created: number;
  replaced: number;
  undoneAt?: string | null;
  undoneByName?: string | null;
  /** On undo: removed, and kept because they were edited (or are gone) since. */
  removed?: number;
  kept?: number;
}

/* ── saved column mappings ───────────────────────────────────────────────── */

export async function listMappings(context: MdlContext): Promise<MappingTemplate[]> {
  context.require('Import', 'View');
  const snap = await mappingsDoc().get();
  return ((snap.exists ? (snap.data() as DocumentData).templates : null) ?? []) as MappingTemplate[];
}

async function rememberMappings(context: MdlContext, input: NonNullable<ImportInput['source']>) {
  const ref = mappingsDoc();
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    let templates = ((snap.exists ? (snap.data() as DocumentData).templates : null) ?? []) as MappingTemplate[];
    for (const mapping of input.mappings.filter((m) => m.include)) {
      const sheet = input.sheets.find((entry) => entry.name === mapping.sheet);
      if (!sheet) continue;
      const signature = headerSignature(sheet, mapping.headerRow);
      if (!signature) continue;
      const template: MappingTemplate = {
        id: `${input.projectCode}-${signature.length}-${signature.slice(0, 40).replace(/[^a-z0-9]+/g, '-')}`,
        signature,
        headerRow: mapping.headerRow,
        schedule: mapping.schedule,
        scope: mapping.scope,
        columns: mapping.columns as ColumnRole[],
        projectCode: input.projectCode,
        sheetName: mapping.sheet,
        fileName: input.fileName,
        savedAt: new Date().toISOString(),
        savedByName: context.userName || context.userId,
      };
      // One template per drawing list and layout: a newer confirmation replaces the older one.
      templates = [template, ...templates.filter((entry) => !(entry.projectCode === template.projectCode && entry.signature === template.signature))];
    }
    tx.set(ref, { templates: templates.slice(0, MAX_TEMPLATES), updatedAt: FieldValue.serverTimestamp() });
  });
}

export async function deleteMapping(context: MdlContext, id: string): Promise<void> {
  if (!context.can('Import', 'Import') && !context.can('Settings', 'Manage')) throw new MdlError('Import permission on Master Drawing List · Import is required.', 403);
  const ref = mappingsDoc();
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const templates = ((snap.exists ? (snap.data() as DocumentData).templates : null) ?? []) as MappingTemplate[];
    if (!templates.some((entry) => entry.id === id)) throw new MdlError('That saved mapping no longer exists.', 404);
    tx.set(ref, { templates: templates.filter((entry) => entry.id !== id), updatedAt: FieldValue.serverTimestamp() });
  });
}

/* ── dry run and import ──────────────────────────────────────────────────── */

export async function runImport(context: MdlContext, input: ImportInput): Promise<ImportResult> {
  context.require('Import', input.mode === 'import' ? 'Import' : 'View');
  let parsed: ParsedImport;
  let forSummary: ParsedImport;
  let sheets: WorkbookSheetSummary[] | undefined;
  let rows: ImportRowResult[] | undefined;
  // Rows may use any schedule and scope listed in Settings, switched off or not (old lists keep theirs).
  const { masterData } = await loadSettings();
  const lists = { schedules: allNames(masterData.schedules), scopes: allNames(masterData.scopes) };
  if (input.source) {
    const project = await projectFor(context, input.source.projectCode);
    const result = parseProjectWorkbook(
      input.source.sheets,
      input.source.mappings.map((mapping) => ({ ...mapping, columns: mapping.columns as ColumnRole[] })),
      project.code,
      input.source.fileName,
      lists,
    );
    sheets = result.sheets;
    rows = result.rows;
    parsed = result;
    // The summary lists the drawing list the rows go into; the list itself is not rewritten.
    forSummary = { ...result, projects: [{ code: project.code, short: project.short, name: project.displayName, client: project.client, drgPrefix: project.drgPrefix }] };
  } else {
    try {
      parsed = parseImport(input.grid ?? {}, lists);
    } catch (error) {
      if (error instanceof ImportFormatError) throw new MdlError(error.message, 422);
      throw error;
    }
    forSummary = parsed;
  }
  const summary = summariseImport(forSummary);
  if (input.mode === 'preview') return { summary, sheets, rows };
  if (!parsed.items.length && !parsed.projects.length) throw new MdlError('The workbook has nothing to import.', 422);

  const record = importsCol().doc();
  const result = await writeImport(db(), parsed, {
    overwrite: input.overwrite,
    timestamp: () => FieldValue.serverTimestamp(),
    importedByName: context.userName || null,
    importId: record.id,
  });
  const projectCodes = input.source ? [input.source.projectCode] : parsed.projects.map((p) => p.code);
  await record.set({
    at: new Date().toISOString(),
    by: context.userId,
    byName: context.userName || context.userId,
    fileName: input.source?.fileName ?? input.fileName ?? 'Consolidated workbook',
    kind: input.source ? 'project' : 'consolidated',
    projectCodes,
    written: result.written,
    skipped: result.skipped,
    created: result.createdIds.length,
    replaced: result.replacedIds.length,
    createdIds: result.createdIds,
    replacedIds: result.replacedIds,
    undoneAt: null,
  });
  if (input.source && input.rememberMappings) await rememberMappings(context, input.source);
  const written = { projects: input.source ? 0 : result.projects, written: result.written, skipped: result.skipped };
  return { summary, sheets, rows, written, importId: record.id };
}

/* ── history and undo ────────────────────────────────────────────────────── */

const toRecord = (id: string, data: DocumentData): ImportRecord => ({
  id,
  at: String(data.at ?? ''),
  by: String(data.by ?? ''),
  byName: String(data.byName ?? ''),
  fileName: String(data.fileName ?? ''),
  kind: data.kind === 'consolidated' ? 'consolidated' : 'project',
  projectCodes: Array.isArray(data.projectCodes) ? data.projectCodes : [],
  written: Number(data.written ?? 0),
  skipped: Number(data.skipped ?? 0),
  created: Number(data.created ?? 0),
  replaced: Number(data.replaced ?? 0),
  undoneAt: data.undoneAt ?? null,
  undoneByName: data.undoneByName ?? null,
  removed: data.removed,
  kept: data.kept,
});

/** The last 30 imports into drawing lists the caller can see, newest first. */
export async function importHistory(context: MdlContext): Promise<ImportRecord[]> {
  context.require('Import', 'View');
  // Two reads in parallel, not one per record: the imports, and which drawing lists the caller sees.
  const [snap, projects] = await Promise.all([importsCol().get(), allProjects()]);
  const visibleCodes = new Set(projects.filter((project) => context.inScope(project)).map((project) => project.code));
  return snap.docs
    .map((doc) => toRecord(doc.id, doc.data()))
    .filter((record) => record.projectCodes.every((code) => visibleCodes.has(code)))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 30);
}

/**
 * Removes the items an import created, unless they were edited (or replaced by a later import)
 * since. Items the import replaced keep their imported version: their earlier version is not kept.
 */
export async function undoImport(context: MdlContext, importId: string): Promise<ImportRecord> {
  context.require('Import', 'Import');
  const ref = importsCol().doc(importId);
  const snap = await ref.get();
  if (!snap.exists) throw new MdlError('That import record does not exist.', 404);
  const data = snap.data() as DocumentData;
  if (data.undoneAt) throw new MdlError('This import has already been undone.', 409);
  for (const code of (data.projectCodes ?? []) as string[]) await projectFor(context, code);

  const ids = ((data.createdIds ?? []) as string[]).filter(Boolean);
  let removed = 0;
  let kept = 0;
  for (let i = 0; i < ids.length; i += 300) {
    const chunk = ids.slice(i, i + 300);
    const docs = await db().getAll(...chunk.map((id) => itemsCol().doc(id)));
    const batch = db().batch();
    docs.forEach((doc) => {
      const item = doc.exists ? (doc.data() as DocumentData) : null;
      if (item && item.importId === importId && item.updatedBy === 'import') {
        batch.delete(doc.ref);
        removed += 1;
      } else kept += 1;
    });
    await batch.commit();
  }
  const undone = { undoneAt: new Date().toISOString(), undoneBy: context.userId, undoneByName: context.userName || context.userId, removed, kept };
  await ref.update(undone);
  return toRecord(importId, { ...data, ...undone });
}
