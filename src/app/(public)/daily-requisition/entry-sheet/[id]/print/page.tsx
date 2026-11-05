'use client';

/**
 * The payment checklist for one requisition (`/daily-requisition/entry-sheet/<id>/print`), or for a
 * batch (`?ids=a,b,c` — the entry sheet's "Print Checklists" arrives through the
 * `/daily-requisition/entry-sheet/print` route, which renders this same page).
 *
 * Printed from this page itself, like the app's other print pages: the checklist is laid out with
 * the app's own styles, shown on screen, and the print dialog opens once it has loaded. It used to
 * copy its HTML into a pop-up window — which the browser blocks when no click opened it, and which
 * carried none of the styles the layout depends on.
 *
 * Laid out as Settings › Printing Setup says (`settings/printing`, src/lib/daily-requisition-print.ts):
 * paper, margins, copies, type size, sections, footer and watermark. `?sample=1` prints a made-up
 * requisition with the settings Printing Setup is still editing — its "Print test page".
 */

import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { collection, doc, documentId, getDoc, getDocs, query, where, type FieldPath } from 'firebase/firestore';
import { format } from 'date-fns';
import { Loader2, Printer } from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useUiText } from '@/hooks/use-company-profile';
import type { DailyRequisitionEntry, ExpenseRequest, Project } from '@/lib/types';
import { readChecklistPrintBatch } from '@/lib/checklist-print-batch';
import {
  ChecklistSheet,
  SAMPLE_EXPENSE_HEADS,
  SAMPLE_PROJECT_NAME,
  sampleChecklistEntry,
} from '@/components/daily-requisition/checklist-sheet';
import {
  defaultPrintSettings,
  marginsMm,
  pageCss,
  pageSizeMm,
  PRINT_DRAFT_STORAGE_KEY,
  PRINT_SETTINGS_DOC,
  resolvePrintSettings,
  type DRPrintSettings,
} from '@/lib/daily-requisition-print';

/** Firestore caps an `in` filter at 30 values, and a bulk print can select more. */
const IN_LIMIT = 30;

async function getDocsWhereIn<T>(collectionName: string, field: string | FieldPath, values: string[]): Promise<T[]> {
  const unique = Array.from(new Set(values.filter(Boolean)));
  const chunks: string[][] = [];
  for (let index = 0; index < unique.length; index += IN_LIMIT) chunks.push(unique.slice(index, index + IN_LIMIT));
  const snapshots = await Promise.all(
    chunks.map((chunk) => getDocs(query(collection(db, collectionName), where(field, 'in', chunk)))),
  );
  return snapshots.flatMap((snapshot) => snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as T));
}

/** Each sheet on its own page, the page set up as Printing Setup says. */
const PrintStyles = ({ settings }: { settings: DRPrintSettings }) => (
  <style>{`
    @media print {
      ${pageCss(settings)}
      html, body { background: #fff !important; }
      .no-print { display: none !important; }
      .checklist-sheet { break-after: page; page-break-after: always; }
      .checklist-sheet:last-child { break-after: auto; page-break-after: auto; }
    }
  `}</style>
);

function ChecklistPrint() {
  const params = useParams<{ id?: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user, users } = useAuth();
  const t = useUiText();
  const isSample = searchParams.get('sample') === '1';

  // A long selection arrives as a `?batch=` key to this browser's storage (checklist-print-batch.ts).
  // Storage is read after mount, so the server render and the first client render agree; `null`
  // until then, so the page waits instead of reporting nothing chosen.
  const batch = searchParams.get('batch');
  const [batchIds, setBatchIds] = useState<string[] | null>(null);
  useEffect(() => {
    if (!batch) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser storage is read after mount, so the server render and the first client render agree
    setBatchIds(readChecklistPrintBatch(batch));
  }, [batch]);
  const waitingForBatch = Boolean(batch) && batchIds === null;

  // Keyed on the joined string, not a fresh array per render — an array in the effect's
  // dependencies re-ran the fetch after every render.
  const idsKey = batch ? (batchIds ?? []).join(',') : searchParams.get('ids') || (typeof params?.id === 'string' ? params.id : '');
  const ids = useMemo(
    () => idsKey.split(',').map((value) => value.trim()).filter(Boolean),
    [idsKey],
  );

  const [entries, setEntries] = useState<DailyRequisitionEntry[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [expenseRequests, setExpenseRequests] = useState<ExpenseRequest[]>([]);
  const [settings, setSettings] = useState<DRPrintSettings>(defaultPrintSettings);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const printed = useRef(false);

  // The test page from Printing Setup: a made-up requisition, printed with the settings still being
  // edited there (handed over through this browser's storage).
  useEffect(() => {
    if (!isSample) return;
    let draft: unknown = null;
    try {
      draft = JSON.parse(window.localStorage.getItem(PRINT_DRAFT_STORAGE_KEY) || 'null');
    } catch {
      draft = null;
    }
    const sample = sampleChecklistEntry();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser storage is read after mount, so the server render and the first client render agree
    setSettings(resolvePrintSettings(draft));
    setEntries([sample]);
    setProjects([{ id: sample.projectId, projectName: SAMPLE_PROJECT_NAME } as Project]);
    setExpenseRequests([{ ...SAMPLE_EXPENSE_HEADS, requestNo: sample.depNo, receptionNo: sample.receptionNo } as ExpenseRequest]);
    setIsLoading(false);
  }, [isSample]);

  useEffect(() => {
    let cancelled = false;
    if (waitingForBatch || isSample) return;
    if (!ids.length) {
      setError(
        batch
          ? 'This selection is no longer saved in this browser. Choose the entries again on the Entry Sheet.'
          : 'No requisition was chosen to print.',
      );
      setIsLoading(false);
      return;
    }
    const load = async () => {
      setIsLoading(true);
      setError('');
      try {
        const found = await getDocsWhereIn<DailyRequisitionEntry>('dailyRequisitions', documentId(), ids);
        // In the order they were chosen, not the order Firestore returned them.
        const order = new Map(ids.map((id, index) => [id, index]));
        found.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
        const [projectDocs, expenseDocs, settingsSnap] = await Promise.all([
          getDocsWhereIn<Project>('projects', documentId(), found.map((entry) => entry.projectId)),
          getDocsWhereIn<ExpenseRequest>('expenseRequests', 'requestNo', found.map((entry) => entry.depNo)),
          // Printing Setup; without it the checklist prints as it always has.
          getDoc(doc(db, PRINT_SETTINGS_DOC.collection, PRINT_SETTINGS_DOC.doc)).catch(() => null),
        ]);
        if (cancelled) return;
        setSettings(resolvePrintSettings(settingsSnap?.exists() ? settingsSnap.data() : null));
        setEntries(found);
        setProjects(projectDocs);
        setExpenseRequests(expenseDocs);
        if (!found.length) setError('That requisition could not be found. It may have been deleted.');
      } catch (err) {
        console.error('Error fetching checklist data:', err);
        if (!cancelled) setError('The checklist could not be loaded.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [ids, batch, waitingForBatch, isSample]);

  useEffect(() => {
    if (!entries.length) return;
    document.title = entries.length === 1 ? `Checklist-${entries[0].receptionNo}` : `Checklists-${entries.length}`;
  }, [entries]);

  // Open the print dialog once, when the checklists are on the page. Marked inside the timer so a
  // development double-run of the effect does not cancel the only print.
  useEffect(() => {
    if (isLoading || !entries.length || printed.current) return;
    const timer = window.setTimeout(() => {
      printed.current = true;
      window.print();
    }, 400);
    return () => window.clearTimeout(timer);
  }, [isLoading, entries]);

  const close = () => {
    window.close();
    // Only a tab opened by a script can close itself; otherwise go back to the entry sheet.
    window.setTimeout(() => {
      if (!window.closed) router.push('/daily-requisition/entry-sheet');
    }, 150);
  };

  const printedAt = format(new Date(), 'dd MMM yyyy HH:mm');
  const nameOf = (id: string) => users.find((u) => u.id === id)?.name || id;
  // Every sheet that prints: each requisition once per copy, in order.
  const sheets = entries.flatMap((entry) => Array.from({ length: settings.copies }, (_, copyIndex) => ({ entry, copyIndex })));
  const page = pageSizeMm(settings);
  const margins = marginsMm(settings);
  const expenseFor = (entry: DailyRequisitionEntry) =>
    expenseRequests.find((er) => er.requestNo === entry.depNo && er.receptionNo === entry.receptionNo) ??
    expenseRequests.find((er) => er.requestNo === entry.depNo);

  return (
    <div className="min-h-screen bg-slate-100 p-4 md:p-8 print:bg-white print:p-0">
      <PrintStyles settings={settings} />
      <div className="no-print mx-auto mb-4 flex max-w-4xl flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600">
          {isLoading
            ? t('loading', 'Loading…')
            : isSample
              ? 'Test page — a sample requisition, with the settings from Printing Setup'
              : entries.length > 1
                ? `${entries.length} checklists${settings.copies > 1 ? ` × ${settings.copies} copies` : ''}`
                : `Payment checklist${settings.copies > 1 ? ` × ${settings.copies} copies` : ''}`}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={close}>
            {t('close', 'Close')}
          </Button>
          <Button onClick={() => window.print()} disabled={isLoading || !entries.length}>
            {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Printer className="mr-2 h-4 w-4" />}
            Print / Save as PDF
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="mx-auto max-w-4xl rounded-lg border bg-white p-8">
          <Skeleton className="h-96 w-full" />
        </div>
      ) : !entries.length ? (
        <div className="mx-auto max-w-4xl rounded-lg border bg-white p-8 text-center text-sm text-slate-600">
          <p>{error || 'Nothing to print.'}</p>
          <Link href="/daily-requisition/entry-sheet" className="mt-3 inline-block font-medium text-primary underline">
            Back to the entry sheet
          </Link>
        </div>
      ) : (
        sheets.map(({ entry, copyIndex }, index) => (
          // On screen, the sheet at its paper size with the margins drawn in; on paper, @page does both.
          <div
            key={`${entry.id}-${copyIndex}`}
            className="checklist-sheet mx-auto mb-6 max-w-full overflow-hidden rounded-lg border bg-white print:!m-0 print:!min-h-0 print:!w-auto print:!max-w-none print:overflow-visible print:rounded-none print:border-0 print:!p-0"
            style={{
              width: `${page.width}mm`,
              minHeight: `${page.height}mm`,
              padding: `${margins.top}mm ${margins.right}mm ${margins.bottom}mm ${margins.left}mm`,
            }}
          >
            <ChecklistSheet
              entry={entry}
              projectName={projects.find((p) => p.id === entry.projectId)?.projectName}
              expenseRequest={expenseFor(entry)}
              printedBy={user?.name || 'N/A'}
              printedAt={printedAt}
              settings={settings}
              copyIndex={copyIndex}
              sheet={{ index, total: sheets.length }}
              nameOf={nameOf}
            />
          </div>
        ))
      )}
    </div>
  );
}

export default function PrintChecklistPage() {
  // useSearchParams (`?ids=`) needs a Suspense boundary for a route that prerenders.
  return (
    <Suspense fallback={<div className="p-8"><Skeleton className="h-96 w-full" /></div>}>
      <ChecklistPrint />
    </Suspense>
  );
}
