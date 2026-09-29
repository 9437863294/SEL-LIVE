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
 */

import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { collection, documentId, getDocs, query, where, type FieldPath } from 'firebase/firestore';
import { format } from 'date-fns';
import { Loader2, Printer } from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import type { DailyRequisitionEntry, ExpenseRequest, Project } from '@/lib/types';

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const money = (value: unknown) => inr.format(Number(value) || 0);

const toDateSafe = (value: unknown): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const maybe = value as { toDate?: () => Date; seconds?: number };
  if (typeof maybe.toDate === 'function') return maybe.toDate();
  if (typeof maybe.seconds === 'number') return new Date(maybe.seconds * 1000);
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
};

const formatDate = (value: unknown) => {
  const date = toDateSafe(value);
  return date ? format(date, 'dd MMM yyyy') : 'N/A';
};

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

const PrintStyles = () => (
  <style>{`
    @media print {
      @page { size: A4 portrait; margin: 14mm; }
      html, body { background: #fff !important; }
      .no-print { display: none !important; }
      .checklist-sheet { break-after: page; page-break-after: always; }
      .checklist-sheet:last-child { break-after: auto; page-break-after: auto; }
    }
  `}</style>
);

function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="flex min-w-0">
      <span className={`${wide ? 'w-36' : 'w-32'} shrink-0 font-medium`}>{label}</span>
      <span className="min-w-0 break-words">{children}</span>
    </div>
  );
}

function Checklist({
  entry,
  project,
  expenseRequest,
  printedBy,
  printedAt,
}: {
  entry: DailyRequisitionEntry;
  project?: Project;
  expenseRequest?: ExpenseRequest;
  printedBy: string;
  printedAt: string;
}) {
  return (
    <div className="bg-white p-8 font-sans text-black print:p-0">
      <div className="mb-4 text-center">
        <h2 className="text-xl font-bold">SIDDHARTHA ENGINEERING LIMITED</h2>
        <p className="text-sm font-medium">Nayapalli, Bhubaneswar</p>
      </div>
      <h3 className="mb-4 text-center text-lg font-semibold underline">Check List for Payment</h3>

      <div className="mb-4 grid grid-cols-1 gap-x-8 gap-y-2 text-sm sm:grid-cols-2 print:grid-cols-2">
        <Field label="Reception No:">{entry.receptionNo}</Field>
        <Field label="Reception Date:">{formatDate(entry.date)}</Field>
        <Field label="DEP No:">{entry.depNo || 'N/A'}</Field>
        <Field label="Project Name:">{project?.projectName || 'N/A'}</Field>
      </div>

      <Separator className="my-4 bg-gray-400" />

      <div className="mb-4 grid grid-cols-1 gap-x-8 gap-y-2 text-sm sm:grid-cols-2 print:grid-cols-2">
        <Field label="Name of the party:" wide>
          <span className="font-semibold">{entry.partyName}</span>
        </Field>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <div className="flex">
            <span className="w-28 shrink-0 font-medium">Gross Amount:</span>
            <span className="tabular-nums">{money(entry.grossAmount)}</span>
          </div>
          <div className="flex">
            <span className="w-28 shrink-0 font-medium">Net Amount:</span>
            <span className="tabular-nums">{money(entry.netAmount)}</span>
          </div>
        </div>
        <Field label="Head of A/c:" wide>{expenseRequest?.headOfAccount || 'N/A'}</Field>
        <Field label="Sub-Head of A/c:">{expenseRequest?.subHeadOfAccount || 'N/A'}</Field>
      </div>

      <div className="mb-8 space-y-2 text-sm">
        <p className="font-medium">Description:</p>
        <p className="min-h-[50px] border-l-2 border-gray-200 pl-4">{entry.description}</p>
      </div>

      <div className="mt-24 grid grid-cols-2 gap-x-8 gap-y-16 text-sm sm:gap-x-24 print:gap-x-24">
        <div className="border-t border-black pt-1">Prepared by</div>
        <div className="border-t border-black pt-1">Authorised by</div>
        <div className="border-t border-black pt-1">Checked by</div>
        <div className="border-t border-black pt-1">Approved by</div>
        <div className="border-t border-black pt-1">Verified by</div>
        <div className="border-t border-black pt-1">A/c Dept</div>
      </div>

      <div className="mt-24 flex flex-wrap justify-between gap-2 text-xs text-gray-500">
        <div>
          <span className="font-medium">Printed By:</span> <span>{printedBy}</span>
        </div>
        <div>
          <span className="font-medium">Timestamp:</span> <span>{printedAt}</span>
        </div>
      </div>
    </div>
  );
}

function ChecklistPrint() {
  const params = useParams<{ id?: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user } = useAuth();

  // Keyed on the joined string, not a fresh array per render — an array in the effect's
  // dependencies re-ran the fetch after every render.
  const idsKey = searchParams.get('ids') || (typeof params?.id === 'string' ? params.id : '');
  const ids = useMemo(
    () => idsKey.split(',').map((value) => value.trim()).filter(Boolean),
    [idsKey],
  );

  const [entries, setEntries] = useState<DailyRequisitionEntry[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [expenseRequests, setExpenseRequests] = useState<ExpenseRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const printed = useRef(false);

  useEffect(() => {
    let cancelled = false;
    if (!ids.length) {
      setError('No requisition was chosen to print.');
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
        const [projectDocs, expenseDocs] = await Promise.all([
          getDocsWhereIn<Project>('projects', documentId(), found.map((entry) => entry.projectId)),
          getDocsWhereIn<ExpenseRequest>('expenseRequests', 'requestNo', found.map((entry) => entry.depNo)),
        ]);
        if (cancelled) return;
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
  }, [ids]);

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
  const expenseFor = (entry: DailyRequisitionEntry) =>
    expenseRequests.find((er) => er.requestNo === entry.depNo && er.receptionNo === entry.receptionNo) ??
    expenseRequests.find((er) => er.requestNo === entry.depNo);

  return (
    <div className="min-h-screen bg-slate-100 p-4 md:p-8 print:bg-white print:p-0">
      <PrintStyles />
      <div className="no-print mx-auto mb-4 flex max-w-4xl flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600">
          {isLoading ? 'Loading…' : entries.length > 1 ? `${entries.length} checklists` : 'Payment checklist'}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={close}>
            Close
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
        entries.map((entry) => (
          <div
            key={entry.id}
            className="checklist-sheet mx-auto mb-6 max-w-4xl overflow-hidden rounded-lg border bg-white print:mb-0 print:max-w-none print:overflow-visible print:rounded-none print:border-0"
          >
            <Checklist
              entry={entry}
              project={projects.find((p) => p.id === entry.projectId)}
              expenseRequest={expenseFor(entry)}
              printedBy={user?.name || 'N/A'}
              printedAt={printedAt}
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
