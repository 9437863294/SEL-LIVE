/**
 * Shared "download this report as a real Excel workbook" helper for the Recurring Payments
 * reports section. Every report used to hand-roll a CSV export (`downloadCsv` in
 * recurring-payments.ts) except the module's overview dashboard, which alone built a styled
 * multi-sheet .xlsx via `exceljs` — so every report's "Export" button produced a different format
 * for no real reason. This generalizes that dashboard's approach so any report can produce the
 * same properly-typed, frozen-header, auto-filtered workbook, with one or more sheets.
 */
export interface ExcelColumn {
  header: string;
  key: string;
  width?: number;
}

export interface ExcelSheet {
  name: string;
  columns: ExcelColumn[];
  rows: Array<Record<string, unknown>>;
}

function styleSheet(sheet: {
  getRow: (row: number) => { font: unknown; fill: unknown };
  views: unknown[];
  autoFilter?: unknown;
  rowCount: number;
  columnCount: number;
}) {
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F9D74' } };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: sheet.rowCount, column: sheet.columnCount } };
}

function downloadBlob(blob: Blob, filename: string) {
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}

/** Builds a workbook from one or more sheets and triggers a browser download of the .xlsx file. */
export async function exportWorkbook(filename: string, sheets: ExcelSheet[]) {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'SEL Live';
  workbook.created = new Date();
  sheets.forEach(({ name, columns, rows }) => {
    const sheet = workbook.addWorksheet(name);
    sheet.columns = columns;
    rows.forEach((row) => sheet.addRow(row));
    if (rows.length) styleSheet(sheet as Parameters<typeof styleSheet>[0]);
  });
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  downloadBlob(blob, filename);
}
