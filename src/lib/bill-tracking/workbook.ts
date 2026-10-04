/**
 * Flattens an exceljs worksheet into the plain `ImportCell` grid the importer parses.
 *
 * Written against the shape of exceljs cell values rather than importing exceljs, so the same code
 * runs in the browser (where exceljs is loaded on demand) and in `node --test`.
 *
 * exceljs hands back:
 * - Dates as JS Dates at UTC midnight of the sheet's calendar day. Reading them with local getters
 *   would shift every date one day back for anyone west of Greenwich and is wrong east of it for
 *   times late in the day, so the UTC components are taken as the calendar date.
 * - Formulas as `{ formula | sharedFormula, result }`. The cached `result` is what the sheet
 *   displayed; a formula without one (Google Sheets exports skip results for blank outputs) becomes
 *   `{ formula: true }`, which every parser treats as blank.
 * - Rich text as `{ richText: [{ text }] }`, hyperlinks as `{ text, hyperlink }`, errors as
 *   `{ error: '#REF!' }`.
 */

import type { ImportCell } from './import';

const pad = (value: number) => String(value).padStart(2, '0');

const dateCell = (value: Date): ImportCell => {
  if (Number.isNaN(value.getTime())) return null;
  return { date: `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}` };
};

export function flattenCellValue(value: unknown): ImportCell {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return dateCell(value);
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if ('formula' in record || 'sharedFormula' in record) {
      if (record.result === undefined || record.result === null) return { formula: true };
      const result = record.result;
      if (typeof result === 'object' && result !== null && 'error' in (result as Record<string, unknown>)) {
        return String((result as Record<string, unknown>).error);
      }
      return flattenCellValue(result);
    }
    if ('richText' in record && Array.isArray(record.richText)) {
      return (record.richText as { text?: string }[]).map((part) => part.text ?? '').join('');
    }
    if ('text' in record) return String(record.text ?? '');
    if ('error' in record) return String(record.error);
  }
  return String(value);
}

export interface WorksheetLike {
  name: string;
  rowCount: number;
  columnCount: number;
  getRow(index: number): { getCell(index: number): { value: unknown } };
}

/** Reads a worksheet into rows of cells. Trailing empty rows are trimmed. */
export function worksheetToGrid(sheet: WorksheetLike, maxColumns = 80): ImportCell[][] {
  const columns = Math.min(sheet.columnCount, maxColumns);
  const grid: ImportCell[][] = [];
  for (let rowIndex = 1; rowIndex <= sheet.rowCount; rowIndex += 1) {
    const row = sheet.getRow(rowIndex);
    const cells: ImportCell[] = [];
    for (let column = 1; column <= columns; column += 1) cells.push(flattenCellValue(row.getCell(column).value));
    grid.push(cells);
  }
  while (grid.length && grid[grid.length - 1].every((cell) => cell === null || cell === '' || (typeof cell === 'object' && 'formula' in cell))) {
    grid.pop();
  }
  return grid;
}

/** Picks the sheet to import: one named like "Bill Tracking", else the first with bill headings. */
export function pickBillSheet(names: readonly string[]): string | undefined {
  const key = (name: string) => name.toLowerCase().replace(/[^a-z]/g, '');
  return names.find((name) => key(name) === 'billtracking') ?? names.find((name) => key(name).includes('billtracking')) ?? names[0];
}

/** SHA-256 hex of the file bytes, using Web Crypto (browser and Node 20+ both expose it). */
export async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
