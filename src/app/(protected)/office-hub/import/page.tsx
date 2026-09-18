'use client';

/**
 * Employee import (§64).
 *
 * ── Preview before commit, always ───────────────────────────────────────────────────────────────
 *
 * §64 asks for a preview, duplicate validation, row-by-row errors and a downloadable error report,
 * and the order matters: nothing is written until the administrator has seen what *would* be
 * written. A 400-row sheet shows "380 already match, 15 will be updated, 3 created, 2 broken"
 * before any commit — which is the only version of a bulk import anybody should trust.
 *
 * ── It reconciles; it does not insert ───────────────────────────────────────────────────────────
 *
 * The employee master is the existing `employees` collection, synced from greytHR. Every row is
 * matched by employee ID and then by email, and a matched row produces an *update* of the fields
 * the sheet carries — never a second record for the same person. A blank cell means "no opinion",
 * not "clear this value", because an importer that empties fields on a partial upload destroys data
 * on every partial upload. Rows with no match are created and stamped
 * `source: 'office-hub-import'`, so a later sync can tell them from records it owns.
 */

import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  Upload,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  EMPLOYEE_IMPORT_COLUMNS,
  buildEmployeeImportPreview,
  buildEmployeeImportTemplate,
  buildImportErrorReport,
  committableRows,
  employeeImportInstructions,
  errorReportToCsv,
  parseEmployeeGrid,
  type EmployeeImportOutcome,
  type EmployeeImportPreview,
} from '@/lib/office-hub-import';
import { OFFICE_HUB_BASE_PATH } from '@/lib/office-hub';
import { importOfficeHubEmployees } from '@/lib/office-hub-service';
import { useOfficeHub, useOfficeHubAction } from '@/components/office-hub/hooks';
import {
  OfficeHubAccessDenied,
  OfficeHubDataList,
  OfficeHubEmptyState,
  OfficeHubKpiCard,
  OfficeHubPageHeader,
  OfficeHubSection,
  type OfficeHubListColumn,
} from '@/components/office-hub/ui';

const OUTCOME_TONE: Record<EmployeeImportOutcome, string> = {
  create: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  update: 'border-sky-200 bg-sky-50 text-sky-700',
  match: 'border-slate-200 bg-slate-50 text-slate-500',
  error: 'border-rose-200 bg-rose-50 text-rose-700',
};

const OUTCOME_LABEL: Record<EmployeeImportOutcome, string> = {
  create: 'Will be created',
  update: 'Will be updated',
  match: 'Already matches',
  error: 'Cannot import',
};

type Filter = 'all' | EmployeeImportOutcome;

export default function ImportEmployeesPage() {
  const { actor, capabilities, directory, settings, isLoading, refreshDirectory } = useOfficeHub();
  const { isBusy, run } = useOfficeHubAction();

  const [text, setText] = useState('');
  const [preview, setPreview] = useState<EmployeeImportPreview | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [committed, setCommitted] = useState<{ created: number; updated: number } | null>(null);

  /**
   * The directory the preview reconciles against.
   *
   * Built from the same join the rest of the module uses, so a row matches the same person here as
   * it would anywhere else. `id` is the `employees` document id where one exists; a login with no
   * HR record contributes its email for matching but has no id to update.
   */
  const importDirectory = useMemo(
    () => ({
      employees: directory.people.map((person) => ({
        id: person.employeeId ?? person.userId,
        employeeId: person.employeeId ?? '',
        name: person.name,
        email: person.email ?? null,
        designation: person.designation ?? null,
        departmentId: person.departmentId ?? null,
        departmentName: person.departmentName ?? null,
      })),
      departments: directory.departments.map((department) => ({
        id: department.id,
        name: department.name,
        status: department.status ?? null,
      })),
    }),
    [directory.people, directory.departments],
  );

  const analyse = (raw: string) => {
    setText(raw);
    setCommitted(null);
    if (!raw.trim()) {
      setPreview(null);
      return;
    }
    const grid = parseEmployeeGrid(raw);
    setPreview(buildEmployeeImportPreview(grid, importDirectory, { defaultTimeZone: settings.defaultTimeZone }));
  };

  const readFile = async (file: File | null | undefined) => {
    if (!file) return;
    const raw = await file.text();
    analyse(raw);
  };

  const commit = async () => {
    if (!preview || !actor) return;
    const rows = committableRows(preview);
    if (!rows.length) return;

    const result = await run(
      () =>
        importOfficeHubEmployees(
          actor,
          rows.map((row) => ({
            outcome: row.outcome as 'create' | 'update',
            existingId: row.existingId,
            employeeId: row.employeeId,
            name: row.name,
            email: row.email,
            mobile: row.mobile,
            designation: row.designation,
            departmentName: row.departmentName,
            location: row.location,
            reportingManagerId: row.reportingManagerId,
            reportingManagerName: row.reportingManagerName,
            status: row.status,
            joiningDate: row.joiningDate,
            timeZone: row.timeZone,
          })),
        ),
      { success: 'Import committed', failure: 'The import could not be committed' },
    );

    if (result) {
      setCommitted(result);
      await refreshDirectory();
      // Re-analysed against the refreshed directory, so the rows just written now read as matches
      // rather than still offering to create them.
      const grid = parseEmployeeGrid(text);
      setPreview(buildEmployeeImportPreview(grid, importDirectory, { defaultTimeZone: settings.defaultTimeZone }));
    }
  };

  const download = (filename: string, contents: string) => {
    const blob = new Blob([contents], { type: 'text/csv;charset=utf-8' });
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  };

  const filtered = useMemo(() => {
    if (!preview) return [];
    const rows = filter === 'all' ? preview.rows : preview.rows.filter((row) => row.outcome === filter);
    return rows.map((row) => ({ ...row, id: `row-${row.sheetRow}` }));
  }, [preview, filter]);

  if (isLoading) return <OfficeHubEmptyState icon={Upload} title="Loading…" />;
  if (!capabilities.canImportEmployees) return <OfficeHubAccessDenied what="importing employees" />;

  type Row = (typeof filtered)[number];

  const columns: OfficeHubListColumn<Row>[] = [
    {
      header: 'Row',
      mobile: 'aside',
      className: 'w-16',
      cell: (row) => <span className="text-xs tabular-nums text-muted-foreground">{row.sheetRow}</span>,
    },
    {
      header: 'Employee',
      mobile: 'title',
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-slate-800">{row.name || '—'}</p>
          <p className="truncate text-xs text-muted-foreground">
            {row.employeeId || 'no ID'} · {row.email || 'no email'}
          </p>
        </div>
      ),
    },
    {
      header: 'Department',
      mobile: 'detail',
      className: 'hidden sm:table-cell w-36',
      cell: (row) => <span className="text-xs">{row.departmentName ?? row.raw.department ?? '—'}</span>,
    },
    {
      header: 'Outcome',
      mobile: 'detail',
      className: 'w-32',
      cell: (row) => (
        <Badge variant="outline" className={cn('border text-[11px] font-medium', OUTCOME_TONE[row.outcome])}>
          {OUTCOME_LABEL[row.outcome]}
        </Badge>
      ),
    },
    {
      header: 'What changes',
      mobile: 'footer',
      cell: (row) => {
        if (row.errors.length) {
          return (
            <ul className="space-y-0.5">
              {row.errors.map((message) => (
                <li key={message} className="flex items-start gap-1 text-[11px] text-destructive">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  {message}
                </li>
              ))}
            </ul>
          );
        }
        if (row.outcome === 'update') {
          return (
            <ul className="space-y-0.5">
              {row.changes.map((change) => (
                <li key={change.field} className="flex flex-wrap items-center gap-1 text-[11px] text-slate-700">
                  <span className="font-medium">{change.field}:</span>
                  <span className="text-muted-foreground line-through">{change.from}</span>
                  <ArrowRight className="h-3 w-3 text-muted-foreground" />
                  <span>{change.to}</span>
                </li>
              ))}
            </ul>
          );
        }
        if (row.warnings.length) {
          return (
            <ul className="space-y-0.5">
              {row.warnings.map((message) => (
                <li key={message} className="text-[11px] text-amber-800">
                  {message}
                </li>
              ))}
            </ul>
          );
        }
        return (
          <span className="text-[11px] text-muted-foreground">
            {row.outcome === 'match' ? 'Nothing to do' : 'New record'}
          </span>
        );
      },
    },
  ];

  const ready = preview ? committableRows(preview) : [];

  return (
    <div className="space-y-3">
      <OfficeHubPageHeader
        title="Import employees"
        description="Reconciles a sheet against the existing employee directory. Nothing is written until you commit."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => download('office-hub-employee-template.csv', buildEmployeeImportTemplate())}
              className="gap-2"
            >
              <Download className="h-4 w-4" />
              Download template
            </Button>
            <Button variant="ghost" asChild>
              <Link href={`${OFFICE_HUB_BASE_PATH}/employees`}>Directory</Link>
            </Button>
          </div>
        }
      />

      <Card className="border-indigo-100 bg-indigo-50/50">
        <CardContent className="space-y-1.5 px-4 py-3">
          <p className="text-sm font-semibold text-indigo-900">How this behaves</p>
          <ul className="space-y-0.5 text-xs text-indigo-900/90">
            <li>
              • A row is matched by <strong>Employee ID</strong> first, then by <strong>email</strong>. A match
              updates; no match creates.
            </li>
            <li>
              • A <strong>blank cell means &ldquo;leave it alone&rdquo;</strong>, never &ldquo;clear it&rdquo;.
            </li>
            <li>
              • Duplicate IDs or emails <em>within your sheet</em> are refused, with the row number of the
              first occurrence.
            </li>
            <li>
              • A department that does not exist is an error, not a new department — create it in Settings
              first.
            </li>
          </ul>
        </CardContent>
      </Card>

      <OfficeHubSection
        title="Paste or upload"
        description="Copy the rows straight out of Excel, or choose a CSV file. Headers can be in any order."
      >
        <div className="space-y-2">
          <div>
            <Label className="mb-1 block text-xs">Paste rows (including the header row)</Label>
            <Textarea
              value={text}
              onChange={(event) => analyse(event.target.value)}
              rows={6}
              placeholder={`${EMPLOYEE_IMPORT_COLUMNS.map((column) => column.label).join('\t')}\nSEL-1042\tAsha Rao\tasha.rao@example.com\t9876543210\tFinance Manager\tFinance\tHead Office\tRavi Kumar\tActive\t2024-04-01\tAsia/Kolkata`}
              className="bg-white font-mono text-xs"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex">
              <input
                type="file"
                accept=".csv,.tsv,.txt"
                className="hidden"
                onChange={(event) => void readFile(event.target.files?.[0])}
              />
              <span className="inline-flex cursor-pointer items-center gap-2 rounded-md border bg-white px-3 py-2 text-sm hover:bg-slate-50">
                <FileSpreadsheet className="h-4 w-4" />
                Choose a CSV file
              </span>
            </label>
            {text && (
              <Button variant="ghost" size="sm" onClick={() => analyse('')} className="gap-1.5">
                <X className="h-4 w-4" />
                Clear
              </Button>
            )}
          </div>

          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground underline decoration-dotted">
              What each column means
            </summary>
            <ul className="mt-1.5 space-y-0.5 text-[11px] text-muted-foreground">
              {employeeImportInstructions().map((line) => (
                <li key={line}>• {line}</li>
              ))}
            </ul>
          </details>
        </div>
      </OfficeHubSection>

      {committed && (
        <Card className="border-emerald-200 bg-emerald-50/70">
          <CardContent className="flex items-start gap-2 px-4 py-3">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
            <div>
              <p className="text-sm font-semibold text-emerald-900">
                {committed.created} created, {committed.updated} updated
              </p>
              <p className="text-xs text-emerald-900/80">
                The directory has been refreshed, so the rows below now read against the new state.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {preview && preview.blocked && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="px-4 py-3">
            <p className="text-sm font-semibold text-destructive">
              Missing required column{preview.missingColumns.length === 1 ? '' : 's'}:{' '}
              {preview.missingColumns.join(', ')}
            </p>
            <p className="text-xs text-destructive/80">
              Nothing can be imported until the sheet has these headings. The downloadable template
              has them in the right order.
            </p>
          </CardContent>
        </Card>
      )}

      {preview && !preview.blocked && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <OfficeHubKpiCard label="Rows read" value={preview.summary.total} tone="slate" />
            <OfficeHubKpiCard label="Will be created" value={preview.summary.create} tone="emerald" />
            <OfficeHubKpiCard label="Will be updated" value={preview.summary.update} tone="blue" />
            <OfficeHubKpiCard label="Already match" value={preview.summary.match} tone="slate" />
            <OfficeHubKpiCard
              label="Cannot import"
              value={preview.summary.error}
              tone={preview.summary.error ? 'rose' : 'slate'}
            />
          </div>

          {preview.unmappedHeadings.length > 0 && (
            <p className="text-[11px] text-muted-foreground">
              Ignored column{preview.unmappedHeadings.length === 1 ? '' : 's'}:{' '}
              {preview.unmappedHeadings.join(', ')}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Tabs value={filter} onValueChange={(next) => setFilter(next as Filter)}>
              <TabsList className="h-auto flex-wrap">
                <TabsTrigger value="all" className="text-xs">
                  All ({preview.summary.total})
                </TabsTrigger>
                <TabsTrigger value="create" className="text-xs">
                  Create ({preview.summary.create})
                </TabsTrigger>
                <TabsTrigger value="update" className="text-xs">
                  Update ({preview.summary.update})
                </TabsTrigger>
                <TabsTrigger value="match" className="text-xs">
                  Match ({preview.summary.match})
                </TabsTrigger>
                <TabsTrigger value="error" className="text-xs">
                  Errors ({preview.summary.error})
                </TabsTrigger>
              </TabsList>
            </Tabs>

            {(preview.summary.error > 0 || preview.rows.some((row) => row.warnings.length)) && (
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() =>
                  download(
                    'office-hub-import-errors.csv',
                    errorReportToCsv(buildImportErrorReport(preview)),
                  )
                }
              >
                <Download className="h-4 w-4" />
                Download error report
              </Button>
            )}
          </div>

          <OfficeHubDataList
            rows={filtered}
            columns={columns}
            maxHeightClassName="sm:max-h-[36rem]"
            rowClassName={(row) =>
              row.outcome === 'error' ? 'bg-rose-50/60' : row.outcome === 'match' ? 'opacity-70' : undefined
            }
            empty={<OfficeHubEmptyState icon={Upload} title="No rows in this view." />}
          />

          <div className="sticky bottom-0 -mx-1 flex flex-wrap items-center gap-2 border-t bg-white/95 px-1 py-3 backdrop-blur">
            <Button onClick={() => void commit()} disabled={isBusy || ready.length === 0} className="gap-2">
              {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {ready.length === 0
                ? 'Nothing to commit'
                : `Commit ${ready.length} row${ready.length === 1 ? '' : 's'}`}
            </Button>
            {preview.summary.error > 0 && (
              <p className="text-xs text-muted-foreground">
                {preview.summary.error} row{preview.summary.error === 1 ? '' : 's'} will be skipped — fix
                them in your sheet and paste again.
              </p>
            )}
          </div>
        </>
      )}

      {!preview && !text && (
        <OfficeHubEmptyState
          icon={FileSpreadsheet}
          title="Nothing pasted yet."
          description="Paste the rows above, or download the template to see the expected columns."
        />
      )}
    </div>
  );
}
