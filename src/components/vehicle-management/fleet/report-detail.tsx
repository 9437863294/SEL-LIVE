'use client';

/**
 * One payment report: its totals, sections A–D, its files, and — for a monthly draft — approving it
 * for payment.
 *
 * Approving is the one irreversible step: the report locks, and every trip it pays is marked as paid
 * by this month so no later report pays it again. Trips settled after that go into next month's
 * report as carried. A draft can be generated again until then (after reviews, late fuel bills);
 * each run is a new version. A custom period is a preview and is never approved.
 *
 * The sections are wide registers: each sits in the table's own native scroll container, so it
 * scrolls sideways inside its card on a phone instead of stretching the page.
 */

import { useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, FileJson, FileSpreadsheet, FileText, IndianRupee, Loader2, Lock, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableEmpty, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { KpiCard } from '@/components/shared/kpi-card';
import { PageHeader } from '@/components/shared/page-header';
import { StatusBadge } from '@/components/shared/status-badge';
import { useToast } from '@/hooks/use-toast';
import { useAuthorization } from '@/hooks/useAuthorization';
import { downloadFleetFile, fleetErrorMessage, fleetFetch } from '@/components/fleet/fleet-api';
import { useFleetQuery } from '@/components/fleet/use-fleet-query';
import { FleetRestricted, TripFlagChips, TripStatusBadge } from '@/components/fleet/fleet-ui';
import { istDateKey, istTimeLabel, shortDateLabel } from '@/lib/fleet/dates';
import { COST_BASIS_LABELS, FLEET_CATEGORY_LABELS, formatINR, formatKm, round1, round2, type PaymentReport } from '@/lib/fleet/types';
import { FleetLoadError } from './fleet-charts';
import { ReportStatusBadge, reportPeriodLabel } from './fleet-reports';

const num = (value: number | null) => (value === null ? '—' : value.toLocaleString('en-IN', { maximumFractionDigits: 2 }));

function Section({ children }: { children: React.ReactNode }) {
  return <div className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white">{children}</div>;
}

function ProjectTable({ rows }: { rows: PaymentReport['reportA'] }) {
  const total = (pick: (row: PaymentReport['reportA'][number]) => number) => rows.reduce((sum, row) => sum + pick(row), 0);
  return (
    <Section>
      <Table containerClassName="max-h-[70vh]">
        <TableHeader>
          <TableRow>
            <TableHead>Code</TableHead>
            <TableHead>Project</TableHead>
            <TableHead className="text-right">Trips</TableHead>
            <TableHead className="text-right">Km</TableHead>
            <TableHead className="text-right">Per-km cost</TableHead>
            <TableHead className="text-right">Fixed share</TableHead>
            <TableHead className="text-right">Fuel share</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead className="text-right">Carried</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length ? (
            rows.map((row) => (
              <TableRow key={row.projectId ?? 'none'}>
                <TableCell className="text-muted-foreground">{row.projectCode || '—'}</TableCell>
                <TableCell className="font-medium text-slate-800">{row.projectName}</TableCell>
                <TableCell className="text-right tabular-nums">{row.trips}</TableCell>
                <TableCell className="text-right tabular-nums">{formatKm(row.km)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatINR(row.perKmCost)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatINR(row.fixedShare)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatINR(row.fuelShare)}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums text-slate-800">{formatINR(row.total)}</TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground" title="Trips from an earlier month, settled after its report was approved">
                  {row.carriedTrips || '—'}
                </TableCell>
              </TableRow>
            ))
          ) : (
            <TableEmpty colSpan={9}>No paid trips in this period.</TableEmpty>
          )}
        </TableBody>
        {rows.length > 0 && (
          <TableFooter>
            <TableRow>
              <TableCell colSpan={2} className="font-semibold">
                Total
              </TableCell>
              <TableCell className="text-right font-semibold tabular-nums">{total((row) => row.trips)}</TableCell>
              <TableCell className="text-right font-semibold tabular-nums">{formatKm(round1(total((row) => row.km)))}</TableCell>
              <TableCell className="text-right font-semibold tabular-nums">{formatINR(round2(total((row) => row.perKmCost)))}</TableCell>
              <TableCell className="text-right font-semibold tabular-nums">{formatINR(round2(total((row) => row.fixedShare)))}</TableCell>
              <TableCell className="text-right font-semibold tabular-nums">{formatINR(round2(total((row) => row.fuelShare)))}</TableCell>
              <TableCell className="text-right font-semibold tabular-nums">{formatINR(round2(total((row) => row.total)))}</TableCell>
              <TableCell className="text-right font-semibold tabular-nums">{total((row) => row.carriedTrips) || '—'}</TableCell>
            </TableRow>
          </TableFooter>
        )}
      </Table>
    </Section>
  );
}

function VehicleTable({ rows }: { rows: PaymentReport['reportB'] }) {
  const total = (pick: (row: PaymentReport['reportB'][number]) => number) => rows.reduce((sum, row) => sum + pick(row), 0);
  return (
    <Section>
      <Table containerClassName="max-h-[70vh]">
        <TableHeader>
          <TableRow>
            <TableHead>Vehicle</TableHead>
            <TableHead>Category</TableHead>
            <TableHead>Cost basis</TableHead>
            <TableHead className="text-right">Trips</TableHead>
            <TableHead className="text-right">Km</TableHead>
            <TableHead className="text-right">Fuel (L)</TableHead>
            <TableHead className="text-right">Fuel (₹)</TableHead>
            <TableHead className="text-right">Expected (L)</TableHead>
            <TableHead className="text-right">Variance (L)</TableHead>
            <TableHead className="text-right">Mileage</TableHead>
            <TableHead className="text-right">Standard</TableHead>
            <TableHead className="text-right">Cost</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length ? (
            rows.map((row) => {
              // More fuel than the km should have taken, beyond the vehicle's own tolerance band, is
              // the figure the fleet office looks at; the sign alone says which way it went.
              const over = row.varianceLitres !== null && row.expectedLitres !== null && row.varianceLitres > Math.max(1, row.expectedLitres * 0.1);
              return (
                <TableRow key={row.vehicleId}>
                  <TableCell className="font-medium text-slate-800">{row.vehicleNumber}</TableCell>
                  <TableCell>{FLEET_CATEGORY_LABELS[row.category]}</TableCell>
                  <TableCell>{COST_BASIS_LABELS[row.costBasis]}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.trips}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatKm(row.km)}</TableCell>
                  <TableCell className="text-right tabular-nums">{num(row.fuelLitres)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatINR(row.fuelAmount)}</TableCell>
                  <TableCell className="text-right tabular-nums">{num(row.expectedLitres)}</TableCell>
                  <TableCell className={over ? 'text-right font-semibold tabular-nums text-rose-700' : 'text-right tabular-nums'}>
                    {row.varianceLitres === null ? '—' : `${row.varianceLitres > 0 ? '+' : ''}${num(row.varianceLitres)}`}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{row.mileageKmpl === null ? '—' : `${num(row.mileageKmpl)} km/L`}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{row.stdMileageKmpl === null ? '—' : `${num(row.stdMileageKmpl)} km/L`}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums text-slate-800">{formatINR(row.cost)}</TableCell>
                </TableRow>
              );
            })
          ) : (
            <TableEmpty colSpan={12}>No vehicle ran or filled up in this period.</TableEmpty>
          )}
        </TableBody>
        {rows.length > 0 && (
          <TableFooter>
            <TableRow>
              <TableCell colSpan={3} className="font-semibold">
                Total
              </TableCell>
              <TableCell className="text-right font-semibold tabular-nums">{total((row) => row.trips)}</TableCell>
              <TableCell className="text-right font-semibold tabular-nums">{formatKm(round1(total((row) => row.km)))}</TableCell>
              <TableCell className="text-right font-semibold tabular-nums">{num(round2(total((row) => row.fuelLitres)))}</TableCell>
              <TableCell className="text-right font-semibold tabular-nums">{formatINR(round2(total((row) => row.fuelAmount)))}</TableCell>
              <TableCell colSpan={4} />
              <TableCell className="text-right font-semibold tabular-nums">{formatINR(round2(total((row) => row.cost)))}</TableCell>
            </TableRow>
          </TableFooter>
        )}
      </Table>
    </Section>
  );
}

function HeldTable({ rows, today }: { rows: PaymentReport['reportC']; today: string }) {
  return (
    <Section>
      <Table containerClassName="max-h-[70vh]">
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Vehicle</TableHead>
            <TableHead>Driver</TableHead>
            <TableHead>Project</TableHead>
            <TableHead>In this report</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">GPS</TableHead>
            <TableHead className="text-right">Odometer</TableHead>
            <TableHead className="text-right">Billed</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead>Flags</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length ? (
            rows.map((row) => (
              <TableRow key={row.tripId}>
                <TableCell>
                  <Link href={`/driver-management/fleet/trips/${row.tripId}`} className="font-medium text-primary hover:underline">
                    {shortDateLabel(row.dateKey, today)}
                  </Link>
                </TableCell>
                <TableCell className="font-medium text-slate-800">{row.vehicleNumber}</TableCell>
                <TableCell>{row.driverName}</TableCell>
                <TableCell>{row.projectName}</TableCell>
                <TableCell>{row.held ? <StatusBadge tone="warning">Held</StatusBadge> : <StatusBadge tone="success">Paid</StatusBadge>}</TableCell>
                <TableCell>
                  <TripStatusBadge status={row.status} />
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatKm(row.gpsKm)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatKm(row.odoKm)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatKm(row.billableKm)}</TableCell>
                <TableCell className="text-right tabular-nums">{row.held ? '—' : formatINR(row.amount)}</TableCell>
                <TableCell>
                  <TripFlagChips flags={row.flags} />
                </TableCell>
              </TableRow>
            ))
          ) : (
            <TableEmpty colSpan={11}>No held or flagged trips.</TableEmpty>
          )}
        </TableBody>
      </Table>
    </Section>
  );
}

function ReimbursementTable({ rows }: { rows: PaymentReport['reportD'] }) {
  const total = (pick: (row: PaymentReport['reportD'][number]) => number) => rows.reduce((sum, row) => sum + pick(row), 0);
  return (
    <Section>
      <Table containerClassName="max-h-[70vh]">
        <TableHeader>
          <TableRow>
            <TableHead>Driver</TableHead>
            <TableHead className="text-right">Fuel entries</TableHead>
            <TableHead className="text-right">Litres</TableHead>
            <TableHead className="text-right">Paid by the driver</TableHead>
            <TableHead className="text-right">From a cash advance</TableHead>
            <TableHead className="text-right">Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length ? (
            rows.map((row) => (
              <TableRow key={row.driverUserId || row.driverName}>
                <TableCell className="font-medium text-slate-800">{row.driverName}</TableCell>
                <TableCell className="text-right tabular-nums">{row.entries}</TableCell>
                <TableCell className="text-right tabular-nums">{num(row.litres)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatINR(row.driverPaid)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatINR(row.fromAdvance)}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums text-slate-800">{formatINR(row.total)}</TableCell>
              </TableRow>
            ))
          ) : (
            <TableEmpty colSpan={6}>No fuel was paid by drivers or from advances in this period.</TableEmpty>
          )}
        </TableBody>
        {rows.length > 0 && (
          <TableFooter>
            <TableRow>
              <TableCell className="font-semibold">Total</TableCell>
              <TableCell className="text-right font-semibold tabular-nums">{total((row) => row.entries)}</TableCell>
              <TableCell className="text-right font-semibold tabular-nums">{num(round2(total((row) => row.litres)))}</TableCell>
              <TableCell className="text-right font-semibold tabular-nums">{formatINR(round2(total((row) => row.driverPaid)))}</TableCell>
              <TableCell className="text-right font-semibold tabular-nums">{formatINR(round2(total((row) => row.fromAdvance)))}</TableCell>
              <TableCell className="text-right font-semibold tabular-nums">{formatINR(round2(total((row) => row.total)))}</TableCell>
            </TableRow>
          </TableFooter>
        )}
      </Table>
    </Section>
  );
}

export default function ReportDetailView({ reportId }: { reportId: string }) {
  const { toast } = useToast();
  const { can } = useAuthorization();
  const canGenerate = can('Generate', 'Vehicle Management.Fleet Reports') || can('Approve for Payment', 'Vehicle Management.Fleet Reports');
  const canApprove = can('Approve for Payment', 'Vehicle Management.Fleet Reports');
  const canView = canGenerate || can('View', 'Vehicle Management.Fleet Reports');
  const { data, error, reload, setData } = useFleetQuery<{ report: PaymentReport }>(reportId ? `reports/${encodeURIComponent(reportId)}` : null);
  const [approveOpen, setApproveOpen] = useState(false);
  const [busy, setBusy] = useState<null | 'approve' | 'regenerate' | 'xlsx' | 'pdf' | 'json'>(null);
  const [today] = useState(() => istDateKey(new Date()));
  const report = data?.report ?? null;

  const download = async (kind: 'xlsx' | 'pdf' | 'json') => {
    if (!report) return;
    setBusy(kind);
    try {
      await downloadFleetFile(`reports/${encodeURIComponent(report.id)}/file?kind=${kind}`, `fleet-payment-${report.id}.${kind}`);
    } catch (caught) {
      toast({ variant: 'destructive', title: 'Download failed', description: fleetErrorMessage(caught) });
    } finally {
      setBusy(null);
    }
  };

  const regenerate = async () => {
    if (!report) return;
    setBusy('regenerate');
    try {
      const body = report.monthKey ? { monthKey: report.monthKey, email: false } : { from: report.from, to: report.to, email: false };
      const result = await fleetFetch<{ report: PaymentReport }>('reports', { body });
      setData({ report: result.report });
      toast({ title: `Version ${result.report.version} generated`, description: `${result.report.totals.trips} trips · ${formatINR(result.report.totals.payable)} payable` });
    } catch (caught) {
      toast({ variant: 'destructive', title: 'Not generated', description: fleetErrorMessage(caught) });
    } finally {
      setBusy(null);
    }
  };

  const approve = async () => {
    if (!report) return;
    setBusy('approve');
    try {
      const result = await fleetFetch<{ report: PaymentReport }>(`reports/${encodeURIComponent(report.id)}/approve`, { method: 'POST', body: {} });
      setData({ report: result.report });
      setApproveOpen(false);
      toast({ title: 'Approved for payment', description: `${reportPeriodLabel(result.report)} is locked; its ${result.report.totals.trips} trips are marked paid.` });
    } catch (caught) {
      toast({ variant: 'destructive', title: 'Not approved', description: fleetErrorMessage(caught) });
      // Rethrown so ConfirmDialog stays open for another try.
      throw caught;
    } finally {
      setBusy(null);
    }
  };

  if (!report) {
    return (
      <div className="space-y-4">
        <PageHeader title="Payment report" backHref="/vehicle-management/fleet/reports" backLabel="Payment Reports" />
        {error ? (
          canView ? <FleetLoadError message={error} onRetry={() => void reload()} /> : <FleetRestricted message={error} />
        ) : (
          <div className="flex min-h-[30vh] items-center justify-center">
            <Loader2 className="h-7 w-7 animate-spin text-slate-400" aria-label="Loading" />
          </div>
        )}
      </div>
    );
  }

  const draft = report.status === 'draft';
  const monthly = Boolean(report.monthKey);
  const t = report.totals;

  return (
    <div className="space-y-5">
      <PageHeader
        title={reportPeriodLabel(report)}
        eyebrow="Fleet payment report"
        backHref="/vehicle-management/fleet/reports"
        backLabel="Payment Reports"
        badge={<ReportStatusBadge report={report} />}
        meta={[
          { label: 'Period', value: `${report.from} to ${report.to}` },
          { label: 'Version', value: `v${report.version}` },
          { label: 'Generated', value: `${shortDateLabel(report.generatedAt.slice(0, 10), today)} ${istTimeLabel(report.generatedAt)} · ${report.generatedByName || 'Scheduled'}` },
          ...(report.status === 'approved' && report.approvedAt ? [{ label: 'Approved', value: `${shortDateLabel(report.approvedAt.slice(0, 10), today)} · ${report.approvedByName}` }] : []),
          ...(report.emailedTo.length ? [{ label: 'Emailed to', value: report.emailedTo.join(', ') }] : []),
        ]}
        actions={
          <>
            <Button type="button" variant="outline" onClick={() => void download('xlsx')} disabled={busy !== null || !report.files.xlsx}>
              {busy === 'xlsx' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <FileSpreadsheet className="mr-2 h-4 w-4" aria-hidden />}
              Excel
            </Button>
            <Button type="button" variant="outline" onClick={() => void download('pdf')} disabled={busy !== null || !report.files.pdf}>
              {busy === 'pdf' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <FileText className="mr-2 h-4 w-4" aria-hidden />}
              PDF
            </Button>
            <Button type="button" variant="outline" onClick={() => void download('json')} disabled={busy !== null || !report.files.json}>
              {busy === 'json' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <FileJson className="mr-2 h-4 w-4" aria-hidden />}
              JSON
            </Button>
            {draft && canGenerate && (
              <Button type="button" variant="outline" onClick={() => void regenerate()} disabled={busy !== null}>
                <RefreshCw className={busy === 'regenerate' ? 'mr-2 h-4 w-4 animate-spin' : 'mr-2 h-4 w-4'} aria-hidden />
                Generate again
              </Button>
            )}
            {draft && monthly && canApprove && (
              <Button type="button" onClick={() => setApproveOpen(true)} disabled={busy !== null}>
                <CheckCircle2 className="mr-2 h-4 w-4" aria-hidden />
                Approve for payment
              </Button>
            )}
          </>
        }
      />

      {!monthly && (
        <p className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900">A preview of a custom period. It cannot be approved for payment and marks no trip as paid; payment runs month by month.</p>
      )}
      {report.status === 'approved' && (
        <p className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          Approved for payment and locked. Trips reviewed or corrected after this are carried into the next month&apos;s report.
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard label="Payable" value={formatINR(t.payable)} hint={`${t.trips} trips · ${formatKm(t.km)}`} icon={IndianRupee} tone="emerald" accent />
        <KpiCard label="Per-km vehicles" value={formatINR(t.perKmCost)} hint="Billable km at each vehicle's rate" tone="blue" accent />
        <KpiCard label="Fixed-plus-fuel vehicles" value={formatINR(round2(t.fixedCost + t.fuelCost))} hint={`${formatINR(t.fixedCost)} fixed · ${formatINR(t.fuelCost)} fuel, shared by km`} tone="indigo" accent />
        <KpiCard label="Held for review" value={t.heldTrips} hint={t.heldTrips ? `About ${formatKm(t.heldKm)} — paid once reviewed` : 'Nothing held'} tone={t.heldTrips ? 'amber' : 'slate'} accent />
        <KpiCard label="Driver reimbursements" value={formatINR(t.reimbursements)} hint="Fuel paid by drivers or from cash advances" tone="violet" accent />
        <KpiCard label="Flagged but paid" value={report.reportC.filter((row) => !row.held).length} hint="Listed in section C for information" tone="slate" accent />
      </div>

      <Tabs defaultValue="a" className="min-w-0 space-y-3">
        <TabsList className="max-w-full overflow-x-auto">
          <TabsTrigger value="a">A · Projects ({report.reportA.length})</TabsTrigger>
          <TabsTrigger value="b">B · Vehicles ({report.reportB.length})</TabsTrigger>
          <TabsTrigger value="c">C · Held &amp; flagged ({report.reportC.length})</TabsTrigger>
          <TabsTrigger value="d">D · Reimbursements ({report.reportD.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="a" className="min-w-0">
          <ProjectTable rows={report.reportA} />
        </TabsContent>
        <TabsContent value="b" className="min-w-0">
          <VehicleTable rows={report.reportB} />
        </TabsContent>
        <TabsContent value="c" className="min-w-0">
          <HeldTable rows={report.reportC} today={today} />
        </TabsContent>
        <TabsContent value="d" className="min-w-0">
          <ReimbursementTable rows={report.reportD} />
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={approveOpen}
        onOpenChange={setApproveOpen}
        title={`Approve ${reportPeriodLabel(report)} for payment?`}
        description="The report locks and cannot be generated again. Its trips are marked as paid by this month, so no later report pays them twice; trips settled afterwards go into the next month's report."
        confirmLabel="Approve for payment"
        loading={busy === 'approve'}
        onConfirm={approve}
      >
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
          <div className="flex justify-between gap-3">
            <span>Payable</span>
            <span className="font-semibold tabular-nums">{formatINR(t.payable)}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span>Trips paid</span>
            <span className="tabular-nums">
              {t.trips} · {formatKm(t.km)}
            </span>
          </div>
          <div className="flex justify-between gap-3">
            <span>Driver reimbursements</span>
            <span className="tabular-nums">{formatINR(t.reimbursements)}</span>
          </div>
          {t.heldTrips > 0 && <div className="mt-1 text-xs text-amber-800">{t.heldTrips} trip{t.heldTrips === 1 ? ' is' : 's are'} held for review and not paid by this report.</div>}
        </div>
      </ConfirmDialog>
    </div>
  );
}
