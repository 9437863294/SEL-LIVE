'use client';

/**
 * The Excel Import's row-by-row check: every row of the sheets being taken, as the import will read
 * it — an item (with what was left blank or looks wrong), a group heading, a schedule/scope switch,
 * or a row skipped here. A row's cells can be corrected in place (Fix) or the row left out (Skip);
 * the check reruns as you type, with the same reader the server uses on Import.
 */

import { useMemo, useState } from 'react';
import { CheckCircle2, Layers, Pencil, Undo2, XCircle } from 'lucide-react';

import { Pager } from '@/components/shared/pager';
import { TableCard } from '@/components/shared/table-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ROLE_LABEL, type ImportRowResult, type RawSheet, type SheetMapping } from '@/lib/master-drawing-list/workbook-import';
import { cn } from '@/lib/utils';

type Filter = 'warnings' | 'items' | 'headings' | 'skipped';
const PAGE = 50;

const colName = (index: number) => (index < 26 ? String.fromCharCode(65 + index) : `${String.fromCharCode(64 + Math.floor(index / 26))}${String.fromCharCode(65 + (index % 26))}`);

export function ImportValidation({
  rows,
  sheets,
  mappings,
  onEditCell,
  onToggleSkip,
}: {
  rows: ImportRowResult[];
  sheets: RawSheet[];
  mappings: SheetMapping[];
  onEditCell: (sheet: string, n: number, col: number, value: string) => void;
  onToggleSkip: (sheet: string, n: number) => void;
}) {
  const counts = useMemo(
    () => ({
      warnings: rows.filter((row) => row.kind === 'item' && row.issues.length).length,
      items: rows.filter((row) => row.kind === 'item').length,
      headings: rows.filter((row) => row.kind === 'group' || row.kind === 'section').length,
      skipped: rows.filter((row) => row.kind === 'skipped').length,
    }),
    [rows],
  );
  const [filter, setFilter] = useState<Filter>(counts.warnings ? 'warnings' : 'items');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<string | null>(null);

  const shown = rows.filter((row) =>
    filter === 'warnings' ? row.kind === 'item' && row.issues.length > 0 : filter === 'items' ? row.kind === 'item' : filter === 'headings' ? row.kind === 'group' || row.kind === 'section' : row.kind === 'skipped',
  );
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const current = Math.min(page, pages);
  const slice = shown.slice((current - 1) * PAGE, current * PAGE);

  const chip = (value: Filter, label: string, count: number, tone: string) => (
    <button
      key={value}
      type="button"
      onClick={() => {
        setFilter(value);
        setPage(1);
      }}
      aria-pressed={filter === value}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        filter === value ? 'border-primary bg-primary text-primary-foreground' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
      )}
    >
      <span className={cn('h-2 w-2 rounded-full', tone)} aria-hidden="true" />
      {label} <span className="tabular-nums opacity-80">{count}</span>
    </button>
  );

  return (
    <TableCard
      title="Check rows"
      description="Each row as it will be imported. Fix a cell here, or skip the row; the check updates as you type."
      count={shown.length}
      noun="row"
      scroll="natural"
      toolbar={
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="group" aria-label="Show rows">
          {chip('warnings', 'To correct', counts.warnings, 'bg-amber-500')}
          {chip('items', 'All items', counts.items, 'bg-sky-500')}
          {chip('headings', 'Headings', counts.headings, 'bg-violet-500')}
          {chip('skipped', 'Skipped', counts.skipped, 'bg-slate-400')}
        </div>
      }
      footer={shown.length > PAGE ? <Pager page={current} pages={pages} total={shown.length} pageSize={PAGE} onPage={setPage} /> : undefined}
    >
      {!slice.length ? (
        <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
          {filter === 'warnings' ? 'Nothing to correct — every row reads cleanly.' : 'No rows here.'}
        </p>
      ) : (
        <ul className="divide-y">
          {slice.map((row) => {
            const key = `${row.sheet}|${row.n}`;
            const mapping = mappings.find((entry) => entry.sheet === row.sheet);
            const raw = sheets.find((entry) => entry.name === row.sheet)?.rows.find((entry) => entry.n === row.n);
            const flaggedCols = new Set(row.issues.flatMap((issue) => issue.cols));
            const isEditing = editing === key;
            return (
              <li key={key} className={cn('px-4 py-3', row.kind === 'skipped' && 'bg-muted/30 opacity-75')}>
                <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
                  <span className="w-24 shrink-0 text-xs tabular-nums text-muted-foreground">
                    {row.sheet.trim()} · row {row.n}
                  </span>
                  <div className="min-w-0 flex-1 basis-64">
                    <p className="flex min-w-0 flex-wrap items-center gap-x-2 text-sm">
                      {row.slNo && <span className="tabular-nums text-muted-foreground">{row.slNo}.</span>}
                      <span className={cn('min-w-0 break-words', row.kind === 'item' ? 'text-slate-800' : 'font-semibold text-slate-700')}>{row.description || '—'}</span>
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                      {row.kind === 'group' && (
                        <Badge variant="progress" className="gap-1">
                          <Layers className="h-3 w-3" aria-hidden="true" /> Group heading
                        </Badge>
                      )}
                      {row.kind === 'section' && <Badge variant="progress">Switches to {row.schedule} › {row.scope}</Badge>}
                      {row.kind === 'skipped' && <Badge variant="neutral">Skipped</Badge>}
                      {row.kind === 'item' && (
                        <span>
                          {row.schedule} › {row.scope}
                          {row.group ? ` · ${row.group}` : ''}
                        </span>
                      )}
                    </div>
                    {row.issues.length > 0 && (
                      <ul className="mt-1.5 space-y-0.5 text-xs text-amber-800">
                        {row.issues.map((issue) => (
                          <li key={issue.text} className="flex gap-1.5">
                            <XCircle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                            <span>
                              {issue.text}
                              {issue.cols.length ? <span className="text-muted-foreground"> (column {issue.cols.map(colName).join(', ')})</span> : null}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    {row.kind === 'item' && (
                      <Button variant="outline" size="sm" className="h-8" onClick={() => setEditing(isEditing ? null : key)} aria-expanded={isEditing}>
                        <Pencil className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> {isEditing ? 'Done' : 'Fix'}
                      </Button>
                    )}
                    {(row.kind === 'item' || row.kind === 'skipped') && (
                      <Button variant="ghost" size="sm" className="h-8" onClick={() => onToggleSkip(row.sheet, row.n)}>
                        {row.kind === 'skipped' ? (
                          <>
                            <Undo2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Include
                          </>
                        ) : (
                          'Skip'
                        )}
                      </Button>
                    )}
                  </div>
                </div>
                {isEditing && mapping && raw && (
                  <div className="mt-3 grid grid-cols-1 gap-2 rounded-lg border bg-muted/20 p-3 sm:grid-cols-2 lg:grid-cols-3">
                    {mapping.columns.map((role, col) =>
                      role === 'ignore' ? null : (
                        <label key={col} className="min-w-0 space-y-1">
                          <span className="block text-[11px] font-medium text-muted-foreground">
                            {colName(col)} · {ROLE_LABEL(role)}
                          </span>
                          <Input
                            value={raw.cells[col] ?? ''}
                            onChange={(event) => onEditCell(row.sheet, row.n, col, event.target.value)}
                            className={cn('h-8 text-sm', flaggedCols.has(col) && 'border-amber-400 bg-amber-50')}
                            placeholder={/submitted|date/i.test(ROLE_LABEL(role)) ? 'DD.MM.YYYY' : ''}
                          />
                        </label>
                      ),
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </TableCard>
  );
}
