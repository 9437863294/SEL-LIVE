'use client';

/**
 * Excel Import (`/master-drawing-list/import`): load the consolidated drawing-list workbook.
 *
 * 1. Choose the .xlsx. The browser reads its Projects, Items and Revisions sheets into text cells.
 * 2. Preview — a dry run on the server: projects, items and revisions read, status totals per
 *    project, rows it had to skip and why, and items whose status differs from the workbook's own
 *    column. Nothing is written.
 * 3. Import writes it. Items already in the ERP are skipped (or, when asked, replaced if nobody has
 *    edited them since they were imported).
 */

import { useRef, useState } from 'react';
import Link from 'next/link';
import { Download, FileSpreadsheet, FileUp, Loader2, TriangleAlert, Upload } from 'lucide-react';

import { KpiCard, KpiGrid } from '@/components/shared/kpi-card';
import { PageHeader, SectionHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { exportWorkbook } from '@/lib/report-excel';
import { ITEM_COLUMNS, PROJECT_COLUMNS, REVISION_COLUMNS, gridFromWorkbook, type ImportGrid } from '@/lib/master-drawing-list/import';
import type { ImportResult } from '@/lib/master-drawing-list/server/import';
import { OVERALL_STATUSES } from '@/lib/master-drawing-list/drawings';
import { STATUS_LABEL, type MdlStatus } from '@/lib/master-drawing-list/types';

import { mdlFetch, useMdl } from './mdl-client';
import { MdlError } from './mdl-ui';
import { MDL_BASE } from './module-layout-shell';

const SHOWN = 50;

/** The workbook's own classification, from its dates — the totals to check the file against. */
const DATE_STATUSES: MdlStatus[] = ['approved', 'under_review', 'comments_received', 'not_submitted', 'vendor_not_finalised'];

function Lines({ title, lines, tone }: { title: string; lines: string[]; tone: 'amber' | 'slate' }) {
  const [all, setAll] = useState(false);
  if (!lines.length) return null;
  const shown = all ? lines : lines.slice(0, SHOWN);
  return (
    <div className={tone === 'amber' ? 'rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900' : 'rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700'}>
      <p className="flex items-center gap-2 font-medium">
        {tone === 'amber' && <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />}
        {title} ({lines.length.toLocaleString('en-IN')})
      </p>
      <ul className="mt-1.5 max-h-72 list-disc space-y-0.5 overflow-auto pl-6 [overflow-wrap:anywhere]">
        {shown.map((line, index) => (
          <li key={`${index}-${line}`}>{line}</li>
        ))}
      </ul>
      {lines.length > SHOWN && (
        <Button variant="link" size="sm" className="h-auto px-0" onClick={() => setAll((value) => !value)}>
          {all ? 'Show fewer' : `Show all ${lines.length.toLocaleString('en-IN')}`}
        </Button>
      )}
    </div>
  );
}

export default function ExcelImport() {
  const { can, reload } = useMdl();
  const { toast } = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [grid, setGrid] = useState<ImportGrid | null>(null);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [done, setDone] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState<'reading' | 'importing' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const canImport = can('Import', 'Import');

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    setGrid(null);
    setPreview(null);
    setDone(null);
    setError(null);
    setBusy('reading');
    try {
      const ExcelJS = (await import('exceljs')).default;
      const book = new ExcelJS.Workbook();
      await book.xlsx.load(await file.arrayBuffer());
      const next = gridFromWorkbook(book);
      setGrid(next);
      setPreview(await mdlFetch<ImportResult>('import', { body: { grid: next, mode: 'preview', overwrite: false } }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The workbook could not be read.');
    } finally {
      setBusy(null);
      if (input.current) input.current.value = '';
    }
  };

  const runImport = async () => {
    if (!grid) return;
    setBusy('importing');
    setError(null);
    try {
      const result = await mdlFetch<ImportResult>('import', { body: { grid, mode: 'import', overwrite } });
      setDone(result);
      toast({ title: 'Imported', description: `${result.written?.written ?? 0} items written, ${result.written?.skipped ?? 0} skipped.` });
      void reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The import failed.');
    } finally {
      setBusy(null);
    }
  };

  const downloadTemplate = () =>
    void exportWorkbook('MDL-import-template.xlsx', [
      { name: 'Projects', columns: PROJECT_COLUMNS.map((header) => ({ header, key: header, width: Math.max(14, header.length + 4) })), rows: [] },
      { name: 'Items', columns: ITEM_COLUMNS.map((header) => ({ header, key: header, width: header === 'Description' ? 60 : Math.max(12, header.length + 4) })), rows: [] },
      { name: 'Revisions', columns: REVISION_COLUMNS.map((header) => ({ header, key: header, width: Math.max(12, header.length + 4) })), rows: [] },
    ]);

  const summary = (done ?? preview)?.summary;

  return (
    <>
      <PageHeader
        icon={FileUp}
        title="Excel Import"
        description="Load the consolidated drawing-list workbook. You see a dry run first; nothing is written until you press Import."
        actions={
          <Button variant="outline" onClick={downloadTemplate}>
            <Download className="mr-2 h-4 w-4" aria-hidden="true" />
            Blank template
          </Button>
        }
      />

      <Card className="min-w-0">
        <CardContent className="p-4 sm:p-5">
          <SectionHeader
            title="Workbook"
            description="Three sheets: Projects (Code, Short name, Full name, Client, Drawing no. prefix), Items (one row per drawing item) and Revisions (Item ID, Revision, Submitted on, Comments received on). Dates may be Excel dates or DD.MM.YYYY."
          />
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center">
            <FileSpreadsheet className="h-9 w-9 text-muted-foreground/70" aria-hidden="true" />
            <p className="max-w-full break-words text-sm text-slate-700">{fileName ?? 'No workbook chosen yet.'}</p>
            <input ref={input} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" id="mdl-import-file" onChange={(event) => void choose(event.target.files?.[0])} />
            <Button onClick={() => input.current?.click()} disabled={busy !== null}>
              {busy === 'reading' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <Upload className="mr-2 h-4 w-4" aria-hidden="true" />}
              {busy === 'reading' ? 'Reading…' : fileName ? 'Choose another workbook' : 'Choose .xlsx workbook'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <MdlError message={error} />

      {summary && (
        <>
          <KpiGrid>
            <KpiCard label="Projects" value={summary.projects.length.toLocaleString('en-IN')} icon={FileSpreadsheet} tone="slate" />
            <KpiCard label="Items" value={summary.itemCount.toLocaleString('en-IN')} tone="blue" />
            <KpiCard label="Revisions" value={summary.revisionCount.toLocaleString('en-IN')} tone="indigo" />
            {DATE_STATUSES.map((status) => (
              <KpiCard key={status} label={STATUS_LABEL[status]} value={summary.totals[status].toLocaleString('en-IN')} tone={status === 'approved' ? 'emerald' : status === 'under_review' ? 'blue' : status === 'comments_received' ? 'amber' : status === 'vendor_not_finalised' ? 'rose' : 'slate'} />
            ))}
          </KpiGrid>

          <Card className="min-w-0">
            <CardContent className="space-y-4 p-4 sm:p-5">
              <SectionHeader title={done ? 'Imported' : 'Dry run'} description={done ? 'What the import read and wrote.' : 'What the import would write. Nothing has been written yet.'} />
              <p className="text-sm text-muted-foreground">
                The figures above are the workbook&apos;s statuses, read from its dates. In the register each item gets an overall status:{' '}
                {OVERALL_STATUSES.filter((status) => summary.overall[status]).map((status, index) => (
                  <span key={status}>
                    {index ? ' · ' : ''}
                    <b className="font-medium text-slate-700">{status}</b> {summary.overall[status].toLocaleString('en-IN')}
                  </span>
                ))}
                . Each round&apos;s status is set from its dates too, and can be changed in the register.
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Project</TableHead>
                    <TableHead className="text-right">Items</TableHead>
                    {DATE_STATUSES.map((status) => (
                      <TableHead key={status} className="text-right">
                        {STATUS_LABEL[status]}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.projects.map((project) => (
                    <TableRow key={project.code}>
                      <TableCell className="whitespace-nowrap font-medium">{project.code}</TableCell>
                      <TableCell className="min-w-[12rem]">
                        <span className="font-medium">{project.short}</span>
                        <span className="block text-xs text-muted-foreground">{project.name}</span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{project.items.toLocaleString('en-IN')}</TableCell>
                      {DATE_STATUSES.map((status) => (
                        <TableCell key={status} className="text-right tabular-nums">
                          {project.counts[status].toLocaleString('en-IN')}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Lines title="Rows skipped or left blank" lines={summary.problems} tone="amber" />
              <Lines title="Items whose status differs from the workbook's own status column" lines={summary.differs} tone="slate" />

              {done?.written ? (
                <div className="flex flex-col gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 sm:flex-row sm:items-center sm:justify-between">
                  <p>
                    Wrote {done.written.projects} drawing list{done.written.projects === 1 ? '' : 's'} and {done.written.written.toLocaleString('en-IN')} items. Skipped{' '}
                    {done.written.skipped.toLocaleString('en-IN')} items already in the ERP.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button asChild size="sm">
                      <Link href={`${MDL_BASE}/register`}>Open the register</Link>
                    </Button>
                    {can('Settings', 'View') && (
                      <Button asChild size="sm" variant="outline">
                        <Link href={`${MDL_BASE}/settings`}>Link to ERP projects</Link>
                      </Button>
                    )}
                  </div>
                </div>
              ) : canImport ? (
                <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-3">
                    <Switch id="mdl-import-overwrite" checked={overwrite} onCheckedChange={setOverwrite} />
                    <Label htmlFor="mdl-import-overwrite" className="font-normal leading-snug">
                      Replace items imported before, if nobody has edited them in the ERP since
                    </Label>
                  </div>
                  <Button onClick={() => void runImport()} disabled={busy !== null || !summary.itemCount}>
                    {busy === 'importing' && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                    Import {summary.itemCount.toLocaleString('en-IN')} items
                  </Button>
                </div>
              ) : (
                <p className="border-t pt-4 text-sm text-muted-foreground">You may preview a workbook. Importing it needs Master Drawing List · Import · Import.</p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </>
  );
}
