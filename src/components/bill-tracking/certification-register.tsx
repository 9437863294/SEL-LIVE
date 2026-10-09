'use client';

/**
 * The Bill Register's certification views (`/bill-tracking/bills?view=certified|compare`).
 *
 * - **Client certified** — every certifiable bill with what the client approved and deducts, and
 *   whether it is still awaiting certification.
 * - **Raised vs certified** — certified bills only: raised net, certified net, what the client
 *   changed, the notes raised so far and what is still to adjust, with a one-click "Raise note".
 *
 * The raised view is the register as it always was (`bill-register.tsx`); the three share the page
 * header, the view tabs and the filter bar.
 */

import Link from 'next/link';
import { CheckCircle2, ClipboardCheck, Plus, ReceiptIndianRupee, Scale } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/components/shared/page-header';
import type { CertificationSummary, CertificationTotals } from '@/lib/bill-tracking/certification';
import { CERTIFICATION_STATE_LABELS, type Bill } from '@/lib/bill-tracking/types';
import type { BillTotals } from '@/lib/bill-tracking/reports';
import { cn } from '@/lib/utils';

import { btFetch, useBt, useBtQuery, useLookups, useWorkflowActor } from './bt-client';
import { certificationBlocked } from '@/lib/bill-tracking/workflow';
import { BillFilterBar, useUrlFilters } from './bt-filters';
import { BtTable, Pager, type BtColumn } from './bt-table';
import { ToolbarSelect } from './bt-toolbar';
import { Amount, BT_TAB, BT_TABS_LIST, BtEmpty, BtError, BtLoading, CertificationBadge, ExportMenu, StatStrip, TransactionTypeBadge, dateText, type ExportColumn, TruncatedText } from './bt-ui';
import type { BillRow } from './bill-register';

export type RegisterView = 'raised' | 'certified' | 'compare';

export interface CertificationRow extends BillRow {
  cert: CertificationSummary;
}

interface CertificationResponse {
  rows: CertificationRow[];
  page: number;
  pages: number;
  pageSize: number;
  total: number;
  totals: BillTotals;
  certificationTotals: CertificationTotals;
  asOf: string;
}

/** The register's three views, as tabs under the page header. */
export function RegisterViewTabs({ view }: { view: RegisterView }) {
  const filters = useUrlFilters();
  return (
    <Tabs value={view} onValueChange={(next) => filters.set({ view: next === 'raised' ? undefined : next, sort: undefined, dir: undefined, cert: undefined })}>
      <TabsList className={BT_TABS_LIST} aria-label="Register view">
        <TabsTrigger className={BT_TAB} value="raised">
          <ReceiptIndianRupee className="h-4 w-4" /> Raised bills
        </TabsTrigger>
        <TabsTrigger className={BT_TAB} value="certified">
          <ClipboardCheck className="h-4 w-4" /> Client certified
        </TabsTrigger>
        <TabsTrigger className={BT_TAB} value="compare">
          <Scale className="h-4 w-4" /> Raised vs certified
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}

const matchNoteHref = (bill: Pick<Bill, 'id' | 'projectId'>) => `/bill-tracking/bills/new?match=1&against=${bill.id}&project=${bill.projectId}`;

const CERTIFIED_FILTERS = [
  { value: 'awaiting', label: 'Awaiting certification' },
  { value: 'certified', label: 'Certified' },
  { value: 'matched', label: 'Certified · matched' },
  { value: 'pending', label: 'Certified · note pending' },
];
const COMPARE_FILTERS = [
  { value: 'certified', label: 'All certified' },
  { value: 'matched', label: 'Matched' },
  { value: 'pending', label: 'Note pending' },
];

export default function CertificationRegister({ view }: { view: 'certified' | 'compare' }) {
  const lookups = useLookups();
  const { can } = useBt();
  const actor = useWorkflowActor();
  const filters = useUrlFilters();
  const compare = view === 'compare';
  // The comparison only makes sense for certified bills, so it never shows the ones still awaiting.
  const cert = filters.get('cert') || (compare ? 'certified' : '');
  const sort = filters.get('sort') || (compare ? 'pendingNet' : 'billDate');
  const dir = (filters.get('dir') || 'desc') as 'asc' | 'desc';
  const page = Number(filters.get('page')) || 1;
  const pageSize = Number(filters.get('pageSize')) || 25;
  const query = filters.apiQuery({ view, cert: cert || undefined, sort, dir, page, pageSize });
  const { data, loading, error, reload } = useBtQuery<CertificationResponse>(`bills?${query}`);
  const totals = data?.certificationTotals;

  const billColumn: BtColumn<CertificationRow> = {
    key: 'invoice',
    header: 'GST invoice',
    pinned: true,
    mobile: 'title',
    sortKey: 'gstInvoiceNumber',
    cell: (row) => (
      <div className="min-w-0">
        <Link href={`/bill-tracking/bills/${row.id}?tab=certification`} className={row.gstInvoiceNumber ? 'whitespace-nowrap font-medium text-emerald-700 hover:underline' : 'font-medium text-slate-500 hover:underline'}>
          {row.gstInvoiceNumber || 'NA'}
        </Link>
        <div className="flex flex-wrap items-center gap-1">
          <TransactionTypeBadge type={row.transactionType} />
        </div>
      </div>
    ),
    total: 'Total',
  };
  const shared: BtColumn<CertificationRow>[] = [
    { key: 'bill', header: 'Bill no.', label: 'Bill no.', sortKey: 'billSerialNumber', cell: (row) => <TruncatedText text={row.billSerialNumber} className="max-w-[150px] text-xs text-slate-600" /> },
    { key: 'date', header: 'Bill date', sortKey: 'billDate', defaultHidden: compare, cell: (row) => <span className="whitespace-nowrap">{dateText(row.billDate)}</span> },
    { key: 'project', header: 'Project', sortKey: 'projectNameSnapshot', cell: (row) => <TruncatedText text={row.projectNameSnapshot} className="max-w-[180px]" /> },
    { key: 'state', header: 'Certification', mobile: 'detail', cell: (row) => <CertificationBadge state={row.cert.state} /> },
    { key: 'certDate', header: 'Certified', sortKey: 'certifiedDate', defaultHidden: compare, cell: (row) => <span className="whitespace-nowrap">{dateText(row.certification?.certifiedDate)}</span> },
    { key: 'reference', header: 'Certificate ref', defaultHidden: compare, cell: (row) => row.certification?.reference || '—' },
  ];
  const actions: BtColumn<CertificationRow> = {
    key: 'actions',
    header: '',
    label: 'Actions',
    mobile: 'omit',
    align: 'right',
    cell: (row) => (
      <div className="flex justify-end gap-1">
        {row.cert.state === 'adjustment_pending' && can('Bills', 'Add') ? (
          <Button asChild size="sm" variant="outline" className="h-7 border-violet-300 px-2 text-xs text-violet-800">
            <Link href={matchNoteHref(row)}>Raise note</Link>
          </Button>
        ) : null}
        {certificationBlocked(row, lookups.config.settings, actor) === null ? (
          <Button asChild size="sm" variant={row.certification ? 'ghost' : 'outline'} className="h-7 px-2 text-xs">
            <Link href={`/bill-tracking/bills/${row.id}/certify`}>{row.certification ? 'Edit' : 'Certify'}</Link>
          </Button>
        ) : null}
      </div>
    ),
  };
  const certifiedOnly = (row: CertificationRow, value: (certification: NonNullable<Bill['certification']>) => number, className?: string) =>
    row.certification ? <Amount value={value(row.certification)} signed className={className} /> : <span className="text-muted-foreground">—</span>;

  const columns: BtColumn<CertificationRow>[] = compare
    ? [
        billColumn,
        ...shared,
        { key: 'raisedNet', header: 'Raised net', align: 'right', sortKey: 'netReceivable', cell: (row) => <Amount value={row.cert.raisedNet} signed />, total: <Amount value={totals?.raisedNetCertified} signed /> },
        { key: 'certifiedNet', header: 'Certified net', align: 'right', sortKey: 'certifiedNet', cell: (row) => <Amount value={row.cert.certifiedNet} signed />, total: <Amount value={totals?.certifiedNet} signed /> },
        {
          key: 'variance',
          header: 'Client change',
          align: 'right',
          sortKey: 'variance',
          cell: (row) => <Amount value={row.cert.variance} signed className={cn((row.cert.variance ?? 0) < 0 && 'text-rose-700', (row.cert.variance ?? 0) > 0 && 'text-emerald-700')} />,
          total: <Amount value={totals?.variance} signed />,
        },
        { key: 'notes', header: 'Notes raised', align: 'right', cell: (row) => (row.cert.notesCount ? <Amount value={row.cert.notesNet} signed muted /> : <span className="text-muted-foreground">—</span>), total: <Amount value={totals?.notesNet} signed /> },
        {
          key: 'pending',
          header: 'Still to adjust',
          align: 'right',
          sortKey: 'pendingNet',
          mobile: 'aside',
          cell: (row) =>
            row.cert.state === 'matched' ? (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                <CheckCircle2 className="h-3.5 w-3.5" /> Matched
              </span>
            ) : (
              <Amount value={row.cert.pendingNet} signed className="font-semibold text-violet-700" />
            ),
          total: <Amount value={totals?.pendingNet} signed />,
        },
        actions,
      ]
    : [
        billColumn,
        ...shared,
        { key: 'certTaxable', header: 'Cert. taxable', align: 'right', cell: (row) => certifiedOnly(row, (certification) => certification.taxableAmount) },
        { key: 'certGst', header: 'Cert. GST', align: 'right', cell: (row) => certifiedOnly(row, (certification) => certification.gstAmount) },
        { key: 'certGross', header: 'Cert. gross', align: 'right', defaultHidden: true, cell: (row) => certifiedOnly(row, (certification) => certification.grossAmount) },
        { key: 'certDeduction', header: 'Cert. deduction', align: 'right', cell: (row) => certifiedOnly(row, (certification) => certification.totalDeduction, 'text-slate-500') },
        { key: 'certifiedNet', header: 'Certified net', align: 'right', sortKey: 'certifiedNet', mobile: 'aside', cell: (row) => certifiedOnly(row, (certification) => certification.netAmount, 'font-semibold'), total: <Amount value={totals?.certifiedNet} signed /> },
        { key: 'raisedNet', header: 'Raised net', align: 'right', sortKey: 'netReceivable', cell: (row) => <Amount value={row.cert.raisedNet} signed muted />, total: <Amount value={totals?.raisedNet} signed /> },
        actions,
      ];

  const loadAll = async () => (await btFetch<CertificationResponse>(`bills?${filters.apiQuery({ view, cert: cert || undefined, sort, dir, all: '1' })}`)).rows;
  const exportColumns: ExportColumn<CertificationRow>[] = [
    { key: 'gstInvoiceNumber', label: 'GST Invoice', value: (row) => row.gstInvoiceNumber ?? 'NA' },
    { key: 'billSerialNumber', label: 'Bill No', value: (row) => row.billSerialNumber },
    { key: 'billDate', label: 'Bill Date', value: (row) => row.billDate },
    { key: 'project', label: 'Project', value: (row) => row.projectNameSnapshot },
    { key: 'status', label: 'Certification', value: (row) => CERTIFICATION_STATE_LABELS[row.cert.state] },
    { key: 'certifiedDate', label: 'Certified Date', value: (row) => row.certification?.certifiedDate },
    { key: 'reference', label: 'Certificate Ref', value: (row) => row.certification?.reference },
    { key: 'raisedTaxable', label: 'Raised Taxable', value: (row) => row.taxableAmount, money: true },
    { key: 'certTaxable', label: 'Certified Taxable', value: (row) => row.certification?.taxableAmount, money: true },
    { key: 'raisedGst', label: 'Raised GST', value: (row) => row.gstAmount, money: true },
    { key: 'certGst', label: 'Certified GST', value: (row) => row.certification?.gstAmount, money: true },
    { key: 'raisedDeduction', label: 'Raised Deduction', value: (row) => row.totalDeduction, money: true },
    { key: 'certDeduction', label: 'Certified Deduction', value: (row) => row.certification?.totalDeduction, money: true },
    { key: 'raisedNet', label: 'Raised Net', value: (row) => row.cert.raisedNet, money: true },
    { key: 'certifiedNet', label: 'Certified Net', value: (row) => row.cert.certifiedNet, money: true },
    { key: 'variance', label: 'Client Change', value: (row) => row.cert.variance, money: true },
    { key: 'notesNet', label: 'Notes Raised', value: (row) => row.cert.notesNet, money: true },
    { key: 'pendingNet', label: 'Still To Adjust', value: (row) => row.cert.pendingNet, money: true },
  ];
  const title = compare ? 'Raised vs Certified' : 'Client Certified Bills';

  return (
    <div className="space-y-4">
      <PageHeader
        icon={compare ? Scale : ClipboardCheck}
        title="Bill Register"
        description={compare ? 'Certified bills: what the client changed, the notes raised so far, and the credit note still to raise for each.' : 'What the client approved and deducts on each bill, and which bills are still awaiting certification.'}
        actions={
          can('Bills', 'Add') ? (
            <Button asChild size="sm" className="gap-1.5">
              <Link href="/bill-tracking/bills/new">
                <Plus className="h-4 w-4" /> New bill
              </Link>
            </Button>
          ) : null
        }
      />
      <RegisterViewTabs view={view} />

      <BillFilterBar
        filters={filters}
        page={`bills-${view}`}
        extra={<ToolbarSelect label="Certification" value={cert} onChange={(value) => filters.set({ cert: value || undefined })} options={compare ? COMPARE_FILTERS : CERTIFIED_FILTERS} allLabel="All bills" showAll={!compare} />}
        actions={
          <ExportMenu<CertificationRow>
            loadAll
            spec={async () => ({
              title,
              fileName: `${compare ? 'raised-vs-certified' : 'certified-bills'}-${filters.fy}`,
              columns: exportColumns,
              rows: await loadAll(),
              meta: [{ label: 'Financial year', value: filters.fy === 'all' ? 'All' : filters.fy }, ...(cert ? [{ label: 'Certification', value: [...CERTIFIED_FILTERS, ...COMPARE_FILTERS].find((option) => option.value === cert)?.label ?? cert }] : [])],
              generatedBy: lookups.user.name,
            })}
          />
        }
      />

      {totals ? (
        <StatStrip
          items={
            compare
              ? [
                  { label: 'Certified bills', value: totals.certified.toLocaleString('en-IN') },
                  { label: 'Matched', value: totals.matched.toLocaleString('en-IN'), tone: 'text-emerald-700' },
                  { label: 'Note pending', value: totals.pending.toLocaleString('en-IN'), tone: totals.pending ? 'text-violet-700' : 'text-slate-900' },
                  { label: 'Client changed', value: <Amount value={totals.variance} compact signed />, tone: totals.variance < 0 ? 'text-rose-700' : 'text-slate-900' },
                  { label: 'Notes raised', value: <Amount value={totals.notesNet} compact signed /> },
                  { label: 'Still to adjust', value: <Amount value={totals.pendingNet} compact signed />, tone: totals.pending ? 'text-violet-700' : 'text-emerald-700' },
                ]
              : [
                  { label: 'Bills', value: totals.count.toLocaleString('en-IN') },
                  { label: 'Certified', value: totals.certified.toLocaleString('en-IN'), tone: 'text-emerald-700' },
                  { label: 'Awaiting certification', value: totals.awaiting.toLocaleString('en-IN'), tone: totals.awaiting ? 'text-amber-700' : 'text-slate-900' },
                  { label: 'Raised net (certified)', value: <Amount value={totals.raisedNetCertified} compact signed /> },
                  { label: 'Certified net', value: <Amount value={totals.certifiedNet} compact signed /> },
                  { label: 'Client changed', value: <Amount value={totals.variance} compact signed />, tone: totals.variance < 0 ? 'text-rose-700' : 'text-slate-900' },
                ]
          }
        />
      ) : null}
      <BtError message={error} onRetry={reload} />

      {loading && !data ? (
        <BtLoading />
      ) : (
        <BtTable
          rows={data?.rows ?? []}
          columns={columns}
          storageKey={`bills-${view}`}
          sort={{ key: sort, dir }}
          onSort={(key, nextDir) => filters.set({ sort: key, dir: nextDir })}
          rowHref={(row) => `/bill-tracking/bills/${row.id}?tab=certification`}
          showTotals
          caption={data ? <span>{data.total.toLocaleString('en-IN')} bill{data.total === 1 ? '' : 's'}</span> : null}
          footer={data && data.total > 0 ? <Pager page={data.page} pages={data.pages} total={data.total} pageSize={data.pageSize} onPage={(next) => filters.set({ page: String(next) }, false)} onPageSize={(size) => filters.set({ pageSize: String(size) })} /> : undefined}
          empty={
            <BtEmpty
              icon={ClipboardCheck}
              title={compare ? 'No certified bills for the selected filters.' : 'No bills for the selected filters.'}
              description={compare ? 'Record the client’s certification from a bill (Actions → Record client certification) and it appears here.' : 'Credit and debit notes are not listed — they adjust the certification of their invoice.'}
            />
          }
        />
      )}
    </div>
  );
}
