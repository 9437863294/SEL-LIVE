'use client';

/**
 * Payment Reports: every monthly report and custom preview, newest period first.
 *
 * A month's report is generated on the 1st by the scheduled job (and on demand here), stays a
 * draft while trips are still being reviewed, and is approved for payment once — which locks it and
 * marks its trips paid. Custom periods are previews. Opening a row shows sections A–D.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus, ReceiptText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DataList, type ListColumn } from '@/components/shared/data-list';
import { PageHeader } from '@/components/shared/page-header';
import { StatusBadge } from '@/components/shared/status-badge';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useFleetQuery } from '@/components/fleet/use-fleet-query';
import { FleetRestricted } from '@/components/fleet/fleet-ui';
import { istTimeLabel, monthLabel, shortDateLabel } from '@/lib/fleet/dates';
import { formatINR, formatKm, type PaymentReport } from '@/lib/fleet/types';
import { VM_PRIMARY_BUTTON } from '../vm-ui';
import { FleetLoadError } from './fleet-charts';
import { GenerateReportDialog } from './generate-report-dialog';

export const reportPeriodLabel = (report: Pick<PaymentReport, 'monthKey' | 'from' | 'to'>) =>
  report.monthKey ? monthLabel(report.monthKey) : `${shortDateLabel(report.from)} – ${shortDateLabel(report.to)}`;

export function ReportStatusBadge({ report }: { report: Pick<PaymentReport, 'monthKey' | 'status'> }) {
  if (!report.monthKey) return <StatusBadge tone="neutral">Preview</StatusBadge>;
  return report.status === 'approved' ? <StatusBadge tone="success">Approved</StatusBadge> : <StatusBadge tone="warning">Draft</StatusBadge>;
}

export default function FleetReportsPage() {
  const router = useRouter();
  const { can } = useAuthorization();
  const canGenerate = can('Generate', 'Vehicle Management.Fleet Reports') || can('Approve for Payment', 'Vehicle Management.Fleet Reports');
  const canView = canGenerate || can('View', 'Vehicle Management.Fleet Reports');
  const { data, error, reload, setData } = useFleetQuery<{ reports: PaymentReport[] }>('reports');
  const [generateOpen, setGenerateOpen] = useState(false);
  const reports = data?.reports ?? [];

  const columns: Array<ListColumn<PaymentReport>> = [
    {
      header: 'Period',
      mobile: 'title',
      cell: (report) => (
        <span className="block min-w-0">
          <span className="block font-medium text-slate-800">{reportPeriodLabel(report)}</span>
          <span className="block text-xs text-muted-foreground">
            {report.from} to {report.to}
          </span>
        </span>
      ),
    },
    { header: 'Status', mobile: 'aside', cell: (report) => <ReportStatusBadge report={report} /> },
    { header: 'Trips', align: 'right', cell: (report) => <span className="tabular-nums">{report.totals.trips}</span> },
    { header: 'Km', align: 'right', cell: (report) => <span className="tabular-nums">{formatKm(report.totals.km)}</span> },
    { header: 'Payable', align: 'right', mobile: 'detail', cell: (report) => <span className="font-semibold tabular-nums text-slate-800">{formatINR(report.totals.payable)}</span> },
    { header: 'Held', align: 'right', cell: (report) => <span className={report.totals.heldTrips ? 'tabular-nums text-amber-700' : 'tabular-nums'}>{report.totals.heldTrips}</span> },
    { header: 'Reimbursements', align: 'right', cell: (report) => <span className="tabular-nums">{formatINR(report.totals.reimbursements)}</span> },
    { header: 'Version', align: 'right', mobile: 'omit', cell: (report) => <span className="tabular-nums">v{report.version}</span> },
    {
      header: 'Generated',
      mobile: 'footer',
      cell: (report) => (
        <span className="text-xs text-muted-foreground">
          {shortDateLabel(report.generatedAt.slice(0, 10))} {istTimeLabel(report.generatedAt)} · {report.generatedByName || 'Scheduled'}
          {report.status === 'approved' && report.approvedByName ? ` · approved by ${report.approvedByName}` : ''}
        </span>
      ),
    },
    {
      header: 'Emailed to',
      mobile: 'omit',
      cell: (report) => <span className="text-xs text-muted-foreground">{report.emailedTo.length ? report.emailedTo.join(', ') : '—'}</span>,
    },
  ];

  const header = (
    <PageHeader
      title="Payment Reports"
      icon={ReceiptText}
      description="The monthly fleet payment report: project-wise and vehicle-wise running and cost, held and flagged trips, and driver reimbursements."
      meta={data ? [{ label: 'Reports', value: reports.length }, { label: 'Drafts', value: reports.filter((report) => report.monthKey && report.status === 'draft').length }] : undefined}
      actions={
        canGenerate ? (
          <Button type="button" className={VM_PRIMARY_BUTTON} onClick={() => setGenerateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" aria-hidden />
            Generate report
          </Button>
        ) : undefined
      }
    />
  );

  return (
    <div className="space-y-5">
      {header}
      {!data && error ? (
        canView ? <FleetLoadError message={error} onRetry={() => void reload()} /> : <FleetRestricted message={error} />
      ) : !data ? (
        <div className="flex min-h-[30vh] items-center justify-center">
          <Loader2 className="h-7 w-7 animate-spin text-slate-400" aria-label="Loading" />
        </div>
      ) : (
        <DataList
          rows={reports}
          columns={columns}
          cardHref={(report) => `/vehicle-management/fleet/reports/${encodeURIComponent(report.id)}`}
          onRowClick={(report) => router.push(`/vehicle-management/fleet/reports/${encodeURIComponent(report.id)}`)}
          empty={
            <div className="py-10 text-center">
              <p className="text-sm font-medium text-slate-700">No reports yet</p>
              <p className="mt-1 text-xs text-muted-foreground">Last month&apos;s report is generated on the 1st at 06:00{canGenerate ? ', or generate one now' : ''}.</p>
            </div>
          }
        />
      )}

      <GenerateReportDialog
        open={generateOpen}
        onOpenChange={setGenerateOpen}
        reports={reports}
        onGenerated={(report) => {
          setData((current) => ({ reports: [{ ...report, reportA: [], reportB: [], reportC: [], reportD: [] }, ...(current?.reports ?? []).filter((entry) => entry.id !== report.id)] }));
          router.push(`/vehicle-management/fleet/reports/${encodeURIComponent(report.id)}`);
        }}
      />
    </div>
  );
}
