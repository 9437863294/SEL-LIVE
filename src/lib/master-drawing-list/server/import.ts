import 'server-only';

/**
 * The Excel Import page's server side. The browser reads the workbook into a grid of text cells;
 * this parses that grid again with the shared reader (`../import.ts`) — never trusting the browser's
 * own preview — and either reports what it would write (preview) or writes it.
 */

import { FieldValue } from 'firebase-admin/firestore';

import { ImportFormatError, parseImport, summariseImport, writeImport, type ImportSummary } from '../import.ts';
import type { ImportInput } from '../schemas.ts';
import { MdlError, type MdlContext } from './context.ts';
import { db } from './store.ts';

export interface ImportResult {
  summary: ImportSummary;
  /** Set when the import was written. */
  written?: { projects: number; written: number; skipped: number };
}

export async function runImport(context: MdlContext, input: ImportInput): Promise<ImportResult> {
  context.require('Import', input.mode === 'import' ? 'Import' : 'View');
  let parsed;
  try {
    parsed = parseImport(input.grid);
  } catch (error) {
    if (error instanceof ImportFormatError) throw new MdlError(error.message, 422);
    throw error;
  }
  const summary = summariseImport(parsed);
  if (input.mode === 'preview') return { summary };
  if (!parsed.items.length && !parsed.projects.length) throw new MdlError('The workbook has nothing to import.', 422);
  const written = await writeImport(db(), parsed, {
    overwrite: input.overwrite,
    timestamp: () => FieldValue.serverTimestamp(),
    importedByName: context.userName || null,
  });
  return { summary, written };
}
