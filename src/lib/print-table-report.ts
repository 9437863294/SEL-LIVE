/**
 * Turning an on-screen table into something worth putting on paper.
 *
 * `window.print()` on a live page prints the application: the module sidebar, the filter controls,
 * the gradient surfaces that cost ink and come out grey, and a table clipped to whatever its
 * scroll container was showing. What a person actually wants is the report — a title, the filters
 * that were in force, the figures, a total, and the date it was taken, on white paper.
 *
 * So this builds a self-contained HTML document instead, which the caller opens in a new window
 * and prints. Nothing of the app comes with it, the same output appears in every browser, and
 * "Save as PDF" in the print dialog gives a file that can be attached to an email.
 *
 * Importless on purpose, like the other domain modules here: `node --test` loads it directly, so
 * the escaping — the part that would otherwise be one unescaped project name away from a broken
 * document — is tested without a browser.
 */

export interface PrintColumn {
  key: string;
  label: string;
  /** Numbers read better right-aligned; the default is left. */
  align?: 'left' | 'right';
}

/** One caption above the table, e.g. "Financial Year — 2026-27". */
export interface PrintMeta {
  label: string;
  value: string;
}

export interface PrintReport {
  title: string;
  subtitle?: string;
  /** The filters in force when the report was taken. Printed so the page can be read in a year. */
  meta?: PrintMeta[];
  columns: PrintColumn[];
  rows: Record<string, string>[];
  /** A bold closing row. Keys that name no column are ignored. */
  totals?: Record<string, string>;
  /** Small print under the table — caveats, truncation warnings. */
  footNote?: string;
  /** Rendered bottom-left of every sheet. */
  generatedOn?: string;
  generatedBy?: string;
}

/**
 * Escapes text for HTML.
 *
 * Every value in this document comes from user-entered data — project names, references, notes.
 * A single `&` or `<` in one of them would otherwise corrupt the markup, and a name containing a
 * tag would inject it into the printed page.
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** A filesystem- and header-safe slug, for download names and window titles. */
export function slugify(value: string): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'report';
}

const STYLES = `
  @page { size: A4 landscape; margin: 12mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #111;
    font-size: 11px;
  }
  .sheet { padding: 16px; }
  h1 { font-size: 17px; margin: 0 0 2px; }
  .subtitle { font-size: 11px; color: #444; margin: 0 0 10px; }
  .meta { display: flex; flex-wrap: wrap; gap: 6px 18px; margin: 0 0 12px; padding: 8px 10px;
          border: 1px solid #d4d4d4; border-radius: 4px; background: #fafafa; }
  .meta div { font-size: 10px; }
  .meta span { color: #555; text-transform: uppercase; letter-spacing: .04em; }
  .meta strong { font-weight: 600; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #c8c8c8; padding: 5px 7px; vertical-align: top; }
  thead th { background: #eee; font-size: 10px; text-transform: uppercase;
             letter-spacing: .03em; text-align: left; }
  /* Repeat the header on every sheet — a multi-page table of figures is unreadable without it. */
  thead { display: table-header-group; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  tbody tr:nth-child(even) { background: #f7f7f7; }
  tfoot td { font-weight: 700; background: #eee; }
  .right { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .empty { padding: 24px; text-align: center; color: #666; border: 1px solid #c8c8c8;
           border-top: none; }
  .foot { margin-top: 10px; font-size: 9.5px; color: #555; }
  .sig { margin-top: 28px; display: flex; gap: 48px; }
  .sig div { flex: 1; border-top: 1px solid #999; padding-top: 4px; font-size: 10px; color: #555; }
  @media print { .sheet { padding: 0; } }
`;

function cellClass(column: PrintColumn): string {
  return column.align === 'right' ? ' class="right"' : '';
}

/** Builds the complete, standalone HTML document for one table report. */
export function buildPrintDocument(report: PrintReport): string {
  const { columns, rows } = report;

  const metaHtml = report.meta?.length
    ? `<div class="meta">${report.meta
        .map(m => `<div><span>${escapeHtml(m.label)}</span><br><strong>${escapeHtml(m.value)}</strong></div>`)
        .join('')}</div>`
    : '';

  const headHtml = columns
    .map(c => `<th${cellClass(c)}>${escapeHtml(c.label)}</th>`)
    .join('');

  const bodyHtml = rows
    .map(row => `<tr>${columns
      .map(c => `<td${cellClass(c)}>${escapeHtml(row[c.key] ?? '')}</td>`)
      .join('')}</tr>`)
    .join('');

  // A totals row that quietly dropped a column would misalign every figure beside it, so every
  // column is emitted and the ones the caller did not total come out blank.
  const totalsHtml = report.totals
    ? `<tfoot><tr>${columns
        .map(c => `<td${cellClass(c)}>${escapeHtml(report.totals?.[c.key] ?? '')}</td>`)
        .join('')}</tr></tfoot>`
    : '';

  const tableHtml = rows.length === 0
    ? `<table><thead><tr>${headHtml}</tr></thead></table><p class="empty">No records match the current filters.</p>`
    : `<table><thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml}</tbody>${totalsHtml}</table>`;

  const stamp = [
    report.generatedOn ? `Generated ${escapeHtml(report.generatedOn)}` : '',
    report.generatedBy ? `by ${escapeHtml(report.generatedBy)}` : '',
  ].filter(Boolean).join(' ');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(report.title)}</title>
<style>${STYLES}</style>
</head>
<body>
<div class="sheet">
  <h1>${escapeHtml(report.title)}</h1>
  ${report.subtitle ? `<p class="subtitle">${escapeHtml(report.subtitle)}</p>` : ''}
  ${metaHtml}
  ${tableHtml}
  ${report.footNote ? `<p class="foot">${escapeHtml(report.footNote)}</p>` : ''}
  ${stamp ? `<p class="foot">${stamp}</p>` : ''}
  <div class="sig"><div>Prepared by</div><div>Checked by</div><div>Approved by</div></div>
</div>
</body>
</html>`;
}
