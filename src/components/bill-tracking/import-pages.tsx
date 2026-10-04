'use client';

/**
 * Import history (`/bill-tracking/import/history`), one import job (`/bill-tracking/import/[jobId]`)
 * and its reconciliation (`/bill-tracking/import/[jobId]/reconciliation`).
 *
 * A job shows every row's outcome (imported, updated, skipped, failed, pending), resumes an
 * interrupted import, retries failed rows, downloads the error rows, and — for an administrator —
 * rolls the whole import back, which the server refuses if any imported bill was worked on since.
 */

import { Fragment, useState } from 'react';
import Link from 'next/link';
import { GitCompare, History, Loader2, RotateCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader, SectionHeader } from '@/components/shared/page-header';
import { StatusBadge, type StatusTone } from '@/components/shared/status-badge';
import { PM_DIALOG } from '@/components/project-management/pm-shell';
import { useToast } from '@/hooks/use-toast';
import { IMPORT_COLUMNS, type ImportCell } from '@/lib/bill-tracking/import';
import type { BillImportJob, ImportJobStatus } from '@/lib/bill-tracking/types';
import type { ImportRowRecord, Reconciliation, ReconciliationLine } from '@/lib/bill-tracking/server/import-service';

import { btFetch, useBt, useBtQuery } from './bt-client';
import { BtTable, type BtColumn } from './bt-table';
import { Amount, BtEmpty, BtError, BtLoading, Notice, dateTimeText, ExportMenu } from './bt-ui';
import { FinancialPanel, downloadErrorRows } from './import-wizard';

const JOB_TONES: Record<ImportJobStatus, StatusTone> = { previewed: 'neutral', importing: 'progress', completed: 'success', partial: 'warning', failed: 'danger', rolled_back: 'neutral' };
const JOB_LABELS: Record<ImportJobStatus, string> = { previewed: 'Previewed', importing: 'Importing / paused', completed: 'Completed', partial: 'Completed with failures', failed: 'Failed', rolled_back: 'Rolled back' };

export function ImportHistory() {
  const { data, loading, error, reload } = useBtQuery<{ jobs: BillImportJob[] }>('import/jobs');
  const columns: BtColumn<BillImportJob>[] = [
    { key: 'job', header: 'Job', pinned: true, mobile: 'title', cell: (job) => <Link className="font-medium text-emerald-700 hover:underline" href={`/bill-tracking/import/${job.id}`}>{job.jobNumber}</Link> },
    { key: 'file', header: 'File', cell: (job) => <span className="line-clamp-1">{job.fileName}</span> },
    { key: 'fy', header: 'FY', cell: (job) => job.financialYear ?? '—' },
    { key: 'by', header: 'Uploaded by', cell: (job) => job.uploadedByName ?? job.uploadedBy },
    { key: 'at', header: 'Uploaded', sortValue: (job) => job.uploadedAt, cell: (job) => <span className="whitespace-nowrap">{dateTimeText(job.uploadedAt)}</span> },
    { key: 'detected', header: 'Detected', align: 'right', cell: (job) => job.rowsDetected },
    { key: 'imported', header: 'Imported', align: 'right', cell: (job) => job.rowsImported },
    { key: 'updated', header: 'Updated', align: 'right', cell: (job) => job.rowsUpdated },
    { key: 'dup', header: 'Duplicates', align: 'right', cell: (job) => job.rowsDuplicate },
    { key: 'failed', header: 'Failed', align: 'right', cell: (job) => (job.rowsFailed ? <span className="font-semibold text-rose-700">{job.rowsFailed}</span> : 0) },
    { key: 'status', header: 'Status', mobile: 'aside', cell: (job) => <StatusBadge tone={JOB_TONES[job.status]}>{JOB_LABELS[job.status]}</StatusBadge> },
  ];
  return (
    <div className="space-y-4">
      <PageHeader icon={History} title="Import history" backHref="/bill-tracking/import" backLabel="Import" description="Every workbook import with its outcome. Open one to resume, review rows, reconcile or roll back." />
      <BtError message={error} onRetry={reload} />
      {loading && !data ? <BtLoading /> : <BtTable rows={data?.jobs ?? []} columns={columns} storageKey="import-history" rowHref={(job) => `/bill-tracking/import/${job.id}`} empty={<BtEmpty title="No imports yet." action={<Button asChild size="sm"><Link href="/bill-tracking/import">Import a workbook</Link></Button>} />} />}
    </div>
  );
}

const ROW_TONES: Record<string, StatusTone> = { pending: 'progress', imported: 'success', updated: 'info', skipped: 'neutral', failed: 'danger', rolled_back: 'neutral' };

export function ImportJobPage({ jobId }: { jobId: string }) {
  const { can } = useBt();
  const { toast } = useToast();
  const { data, loading, error, reload } = useBtQuery<{ job: BillImportJob; rows: ImportRowRecord[] }>(`import/jobs/${jobId}`);
  const [running, setRunning] = useState(false);
  const [rollback, setRollback] = useState(false);
  const [reason, setReason] = useState('');
  const [rollbackError, setRollbackError] = useState<string | null>(null);

  const resume = async (retryFailed: boolean) => {
    setRunning(true);
    try {
      for (let guard = 0; guard < 500; guard += 1) {
        const result: { job: BillImportJob; processed: number } = await btFetch(`import/jobs/${jobId}/process`, { body: { chunkSize: 40, retryFailed } });
        if (result.job.rowsPending === 0 || result.processed === 0 || retryFailed) break;
      }
      toast({ title: retryFailed ? 'Failed rows retried' : 'Import resumed' });
    } catch (caught) {
      toast({ title: 'Could not continue', description: caught instanceof Error ? caught.message : undefined, variant: 'destructive' });
    } finally {
      setRunning(false);
      reload();
    }
  };

  if (loading && !data) return <BtLoading />;
  if (!data) return <BtError message={error ?? 'Import not found.'} onRetry={reload} />;
  const { job, rows } = data;
  const headings = IMPORT_COLUMNS.map((column) => column.label);

  const columns: BtColumn<ImportRowRecord & { id: string }>[] = [
    { key: 'row', header: 'Row', pinned: true, mobile: 'title', sortValue: (row) => row.row, cell: (row) => <span className="font-medium">{row.row}</span> },
    { key: 'bill', header: 'Bill', cell: (row) => (row.billId ? <Link className="text-emerald-700 hover:underline" href={`/bill-tracking/bills/${row.billId}`}>{row.parsed.gstInvoiceNumber || row.parsed.billSerialNumber || 'Open'}</Link> : row.parsed.gstInvoiceNumber || row.parsed.billSerialNumber || '—') },
    { key: 'project', header: 'Project', cell: (row) => row.parsed.projectName ?? row.parsed.projectExcelName },
    { key: 'net', header: 'Net', align: 'right', cell: (row) => <Amount value={row.parsed.calculated.net} signed /> },
    { key: 'received', header: 'Received', align: 'right', cell: (row) => <Amount value={row.parsed.calculated.received} /> },
    { key: 'action', header: 'Action', cell: (row) => row.action.replace('_', ' ') },
    { key: 'state', header: 'Outcome', mobile: 'aside', cell: (row) => <StatusBadge tone={ROW_TONES[row.state] ?? 'neutral'}>{row.state.replace('_', ' ')}</StatusBadge> },
    { key: 'issues', header: 'Issues', className: 'max-w-[360px]', cell: (row) => <span className="line-clamp-2 text-xs text-muted-foreground">{[row.error, ...row.issues.map((issue) => issue.message)].filter(Boolean).join(' · ') || '—'}</span> },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        icon={History}
        title={`Import ${job.jobNumber}`}
        backHref="/bill-tracking/import/history"
        backLabel="History"
        badge={<StatusBadge tone={JOB_TONES[job.status]}>{JOB_LABELS[job.status]}</StatusBadge>}
        meta={[
          { label: 'File', value: job.fileName },
          { label: 'Sheet', value: job.sheetName },
          { label: 'Uploaded', value: `${dateTimeText(job.uploadedAt)} · ${job.uploadedByName ?? job.uploadedBy}` },
          { label: 'Checksum', value: `${job.checksum.slice(0, 12)}…` },
        ]}
        actions={
          <div className="flex flex-wrap gap-2">
            {job.status !== 'rolled_back' ? (
              <Button asChild size="sm" className="gap-1.5">
                <Link href={`/bill-tracking/import/${job.id}/reconciliation`}>
                  <GitCompare className="h-4 w-4" /> Reconciliation
                </Link>
              </Button>
            ) : null}
            {job.rowsPending > 0 && can('Import', 'Import') ? (
              <Button size="sm" variant="outline" disabled={running} onClick={() => void resume(false)}>
                {running ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}Resume import
              </Button>
            ) : null}
            {job.rowsFailed > 0 && job.status !== 'rolled_back' && can('Import', 'Import') ? (
              <Button size="sm" variant="outline" disabled={running} onClick={() => void resume(true)}>
                Retry failed rows
              </Button>
            ) : null}
            <Button size="sm" variant="outline" onClick={() => downloadErrorRows(rows, headings, `${job.jobNumber}-error-rows`)} disabled={!rows.some((row) => row.state === 'failed' || row.issues.some((issue) => issue.level === 'error'))}>
              Download error rows
            </Button>
            {can('Import', 'Rollback') && job.status !== 'rolled_back' && job.status !== 'importing' ? (
              <Button size="sm" variant="outline" className="gap-1.5 text-rose-700" onClick={() => setRollback(true)}>
                <RotateCcw className="h-4 w-4" /> Roll back
              </Button>
            ) : null}
          </div>
        }
      />
      {job.status === 'rolled_back' ? <Notice tone="blue" title="Rolled back">{dateTimeText(job.rolledBackAt)} · {job.rollbackReason}</Notice> : null}
      {job.rowsPending > 0 ? <Notice tone="amber" title={`${job.rowsPending} rows are still pending`}>The import stopped before finishing (a closed tab or a timeout). Resume it — rows already imported are recognised and not duplicated.</Notice> : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
        {[
          ['Detected', job.rowsDetected],
          ['Valid', job.rowsValid],
          ['Warnings', job.rowsWarning],
          ['Duplicates', job.rowsDuplicate],
          ['Imported', job.rowsImported],
          ['Updated', job.rowsUpdated],
          ['Skipped', job.rowsSkipped],
          ['Failed', job.rowsFailed],
        ].map(([label, value]) => (
          <div key={label as string} className="rounded-xl border border-white/60 bg-white/85 p-3 shadow-sm">
            <p className="text-[11px] uppercase text-muted-foreground">{label}</p>
            <p className="text-lg font-semibold">{value as number}</p>
          </div>
        ))}
      </div>

      <Card className="border-white/60 bg-white/85 shadow-sm">
        <CardContent className="p-4">
          <SectionHeader title="Rows" as="h3" description="The original cells of every row are kept with the job for traceability." />
          <div className="mt-3">
            <BtTable rows={rows.map((row) => ({ ...row, id: String(row.row) }))} columns={columns} storageKey="import-rows" dense rowClassName={(row) => (row.state === 'failed' ? 'bg-rose-50/60' : undefined)} empty={<BtEmpty title="No rows." />} />
          </div>
        </CardContent>
      </Card>

      <Dialog open={rollback} onOpenChange={setRollback}>
        <DialogContent className={PM_DIALOG.content}>
          <DialogHeader className={PM_DIALOG.header}>
            <DialogTitle>Roll back {job.jobNumber}</DialogTitle>
            <DialogDescription>Bills this import created are soft-deleted and their imported receipts cancelled; bills it updated are restored to their previous values. Refused if any of them has been changed since. Everything stays in the audit trail.</DialogDescription>
          </DialogHeader>
          <div className={PM_DIALOG.body}>
            <Label>Reason *</Label>
            <Textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} />
            <BtError message={rollbackError} />
          </div>
          <DialogFooter className={PM_DIALOG.footer}>
            <Button variant="outline" onClick={() => setRollback(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={reason.trim().length < 3}
              onClick={async () => {
                setRollbackError(null);
                try {
                  const result = await btFetch<{ deleted: number; restored: number }>(`import/jobs/${jobId}/rollback`, { body: { reason: reason.trim() } });
                  setRollback(false);
                  toast({ title: 'Import rolled back', description: `${result.deleted} removed, ${result.restored} restored.` });
                  reload();
                } catch (caught) {
                  setRollbackError(caught instanceof Error ? caught.message : 'Rollback failed.');
                }
              }}
            >
              Roll back
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function ReconciliationPage({ jobId }: { jobId: string }) {
  const { data, loading, error, reload } = useBtQuery<Reconciliation>(`import/jobs/${jobId}/reconciliation`);
  const [expanded, setExpanded] = useState<string | null>(null);
  if (loading && !data) return <BtLoading label="Reconciling…" />;
  if (!data) return <BtError message={error ?? 'Not found.'} onRetry={reload} />;

  const lineTable = (title: string, lines: ReconciliationLine[], filterKey: 'project' | 'billType' | 'month') => (
    <Card className="border-white/60 bg-white/85 shadow-sm">
      <CardContent className="space-y-2 p-4">
        <SectionHeader title={title} as="h3" />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">{filterKey === 'project' ? 'Project' : filterKey === 'billType' ? 'Bill type' : 'Month'}</th>
                <th className="px-3 py-2 text-right">Bills</th>
                <th className="px-3 py-2 text-right">Excel net</th>
                <th className="px-3 py-2 text-right">SEL LIVE net</th>
                <th className="px-3 py-2 text-right">Difference</th>
                <th className="px-3 py-2 text-right">Excel received</th>
                <th className="px-3 py-2 text-right">SEL LIVE received</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => {
                const difference = Math.round((line.live.net - line.excel.net) * 100) / 100;
                const id = `${filterKey}:${line.key}`;
                const rows = data.differences.filter((row) => (filterKey === 'project' ? row.project === line.label : filterKey === 'billType' ? (row.billType ?? 'Unclassified') === line.label : (row.month ?? 'No date') === line.label));
                return (
                  <Fragment key={id}>
                    <tr className="border-t border-slate-100">
                      <td className="px-3 py-1.5">
                        {rows.length ? (
                          <button type="button" className="text-left font-medium text-emerald-700 hover:underline" onClick={() => setExpanded(expanded === id ? null : id)} aria-expanded={expanded === id}>
                            {line.label} ({rows.length} row{rows.length === 1 ? '' : 's'} differ)
                          </button>
                        ) : (
                          line.label
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-right">{line.live.bills}</td>
                      <td className="px-3 py-1.5 text-right"><Amount value={line.excel.net} /></td>
                      <td className="px-3 py-1.5 text-right"><Amount value={line.live.net} /></td>
                      <td className={`px-3 py-1.5 text-right ${difference ? 'font-semibold text-amber-700' : 'text-muted-foreground'}`}><Amount value={difference} signed /></td>
                      <td className="px-3 py-1.5 text-right"><Amount value={line.excel.received} /></td>
                      <td className="px-3 py-1.5 text-right"><Amount value={line.live.received} /></td>
                    </tr>
                    {expanded === id ? (
                      <tr className="bg-slate-50">
                        <td colSpan={7} className="px-4 py-2">
                          <ul className="space-y-1 text-xs">
                            {rows.map((row) => (
                              <li key={row.row}>
                                Row {row.row}{' '}
                                {row.billId ? <Link className="text-emerald-700 hover:underline" href={`/bill-tracking/bills/${row.billId}`}>{row.reference ?? 'bill'}</Link> : row.reference} — net {row.excelNet} → {row.liveNet}, received {row.excelReceived} → {row.liveReceived}. {row.explanation.join(' ')}
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-4">
      <PageHeader
        icon={GitCompare}
        title={`Reconciliation · ${data.job.jobNumber}`}
        backHref={`/bill-tracking/import/${jobId}`}
        backLabel="Import job"
        description={`${data.job.fileName} — workbook figures against the bills as they stand in SEL LIVE now.`}
        badge={<StatusBadge tone={data.reconciled ? 'success' : 'warning'}>{data.reconciled ? 'Every difference explained' : 'Unexplained differences'}</StatusBadge>}
        actions={
          <ExportMenu
            spec={() => ({
              title: `Reconciliation ${data.job.jobNumber}`,
              fileName: `reconciliation-${data.job.jobNumber}`,
              rows: data.differences.map((row) => ({ ...row, id: String(row.row) })),
              columns: [
                { key: 'row', label: 'Sheet Row', value: (row) => row.row },
                { key: 'reference', label: 'Bill', value: (row) => row.reference },
                { key: 'project', label: 'Project', value: (row) => row.project },
                { key: 'excelNet', label: 'Excel Net', value: (row) => row.excelNet, money: true },
                { key: 'liveNet', label: 'SEL LIVE Net', value: (row) => row.liveNet, money: true },
                { key: 'excelReceived', label: 'Excel Received', value: (row) => row.excelReceived, money: true },
                { key: 'liveReceived', label: 'SEL LIVE Received', value: (row) => row.liveReceived, money: true },
                { key: 'explanation', label: 'Explanation', value: (row) => row.explanation.join(' ') },
              ],
            })}
          />
        }
      />
      <Notice tone={data.reconciled ? 'emerald' : 'amber'} title={data.reconciled ? 'Migration reconciles' : 'Review the differences below'}>
        {data.differences.length === 0
          ? 'Every imported row matches the workbook exactly.'
          : `${data.differences.length} row(s) differ from the workbook. Each is listed with the reason the import recorded — typically a net typed over the sheet’s formula, or work done on the bill since the import.`}
      </Notice>
      <FinancialPanel excel={data.totals.excel} calculated={data.totals.live} tolerance={0} liveLabel="SEL LIVE" />
      {lineTable('By project', data.byProject, 'project')}
      {lineTable('By bill type', data.byBillType, 'billType')}
      {lineTable('By month', data.byMonth, 'month')}
    </div>
  );
}

export type { ImportCell };
