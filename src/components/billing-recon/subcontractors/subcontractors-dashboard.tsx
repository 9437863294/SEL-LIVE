'use client';

/**
 * Billing Recon › Subcontractors — the project's subcontractor dashboard.
 *
 * Everything here comes from Subcontractors Management's own records for this project (the shared
 * subcontractor register, `projects/{id}/workOrders`, `bills`, `proformaBills`); Billing Recon's
 * BOQ / JMC / MVAC / RA-bill registers are not read. The figures are defined in
 * src/lib/subcontractors-dashboard.ts. Each section shows only to someone holding the Subcontractors
 * right it reveals (Billing for money, Work Order for orders), scoped to the project as that
 * module's own sidebar does; rows open the same screens inside Billing Recon.
 */

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { collection, getDocs } from 'firebase/firestore';
import {
  AlertTriangle,
  Briefcase,
  Calculator,
  Clock,
  FileText,
  History,
  Landmark,
  ListChecks,
  Plus,
  RefreshCw,
  Users,
  Wallet,
} from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuthorization } from '@/hooks/useAuthorization';
import { PageHeader } from '@/components/shared/page-header';
import { KpiCard } from '@/components/shared/kpi-card';
import { DataList, type ListColumn } from '@/components/shared/data-list';
import { StatusBadge } from '@/components/shared/status-badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useBillingReconProjects } from '@/components/billing-recon/billing-recon-shell';
import { compactInr, formatInr } from '@/components/billing-recon/dashboard/br-charts';
import { Panel, statusTone } from '@/components/billing-recon/dashboard/dashboard-sections';
import {
  BrAccessDenied,
  BrHero,
  BrNotice,
  BrPage,
  BrPageSkeleton,
  HeroBar,
  HeroPanelTitle,
  HeroStat,
  type HeroAction,
} from '@/components/billing-recon/page-kit';
import { MonthlyBillingChart, SubcontractorValueChart } from './subcontractor-charts';
import {
  buildSubcontractorsDashboard,
  type BillStatus,
  type DashBill,
  type DashProforma,
  type DashSubcontractor,
  type DashWorkOrder,
  type OpenBillRow,
  type RecentBillRow,
  type SubcontractorRow,
  type WorkOrderRow,
} from '@/lib/subcontractors-dashboard';

const SC = 'Subcontractors Management';
const STATUSES: BillStatus[] = ['Pending', 'In Progress', 'Completed', 'Rejected'];

interface Loaded {
  subcontractors: DashSubcontractor[];
  workOrders: DashWorkOrder[];
  bills: DashBill[];
  proformas: DashProforma[];
  at: number;
}

const fmtDay = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? format(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])), 'dd MMM yyyy') : iso;
};
const fmtMs = (ms: number | null) => (ms === null ? '—' : format(new Date(ms), 'dd MMM yyyy'));

/** A thin meter for "billed of work order value", with the figure beside it (never colour alone). */
function Meter({ percent }: { percent: number | null }) {
  if (percent === null) return <span className="text-muted-foreground">—</span>;
  const width = Math.max(0, Math.min(100, percent));
  return (
    <span className="inline-flex min-w-[7rem] items-center gap-2">
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-muted" aria-hidden>
        <span className="block h-full rounded-full bg-teal-500" style={{ width: `${width}%` }} />
      </span>
      <span className="tabular-nums text-xs text-muted-foreground">{percent}%</span>
    </span>
  );
}

export default function SubcontractorsDashboardPage() {
  const router = useRouter();
  const { can, isLoading: authLoading } = useAuthorization();
  const { currentProject, loading: projectsLoading, currentSlug } = useBillingReconProjects();
  const pid = currentProject?.id ?? '';
  const base = `/billing-recon/${currentSlug}/subcontractors`;

  // Subcontractors Management's rights, scoped to the project as its own sidebar checks them.
  const canModule = Boolean(pid) && can('View Module', SC, pid);
  const canBilling = Boolean(pid) && can('View', `${SC}.Billing`, pid);
  const canWorkOrders = Boolean(pid) && can('View', `${SC}.Work Order`, pid);
  const canManage = Boolean(pid) && can('View', `${SC}.Manage Subcontractors`, pid);
  const allowed = canModule && (canBilling || canWorkOrders || canManage);

  const [reloads, setReloads] = useState(0);
  const [result, setResult] = useState<{ key: string; data?: Loaded; error?: string } | null>(null);
  const loadKey = `${pid}:${reloads}`;

  useEffect(() => {
    if (!pid || !allowed) return;
    let cancelled = false;
    const key = `${pid}:${reloads}`;
    Promise.all([
      getDocs(collection(db, 'subcontractors')),
      getDocs(collection(db, 'projects', pid, 'workOrders')),
      getDocs(collection(db, 'projects', pid, 'bills')),
      getDocs(collection(db, 'projects', pid, 'proformaBills')),
    ])
      .then(([subs, wos, bills, pfs]) => {
        if (cancelled) return;
        setResult({
          key,
          data: {
            subcontractors: subs.docs.map((d) => ({ id: d.id, ...d.data() }) as DashSubcontractor),
            workOrders: wos.docs.map((d) => ({ id: d.id, ...d.data() }) as DashWorkOrder),
            bills: bills.docs.map((d) => ({ id: d.id, ...d.data() }) as DashBill),
            proformas: pfs.docs.map((d) => ({ id: d.id, ...d.data() }) as DashProforma),
            at: Date.now(),
          },
        });
      })
      .catch((error) => {
        console.error('Subcontractors dashboard: could not load', error);
        if (!cancelled) {
          const denied = (error as { code?: string })?.code === 'permission-denied';
          setResult({ key, error: denied ? 'You do not have access to read these records.' : 'Could not load the subcontractor records. Check your connection and refresh.' });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [pid, allowed, reloads]);

  const current = result?.key === loadKey ? result : null;
  const dash = useMemo(
    () => (current?.data ? buildSubcontractorsDashboard({ ...current.data, now: current.data.at }) : null),
    [current],
  );

  if (authLoading || projectsLoading) return <BrPageSkeleton hero kpis={4} blocks={2} />;
  if (!currentProject) {
    return (
      <BrPage tone="rose">
        <PageHeader title="Subcontractors" icon={Briefcase} />
        <BrNotice tone="info" icon={Briefcase} title={`No project matches “${currentSlug}”`}>
          Pick one from the project switcher at the top of the menu.
        </BrNotice>
      </BrPage>
    );
  }
  if (!canModule) {
    return (
      <BrAccessDenied message="This needs View Module on Subcontractors Management, with View on Manage Subcontractors, Work Order or Billing for this project — the same rights as in Subcontractors Management. An administrator can grant them in Settings › Access Management." />
    );
  }
  if (!allowed) {
    return (
      <BrAccessDenied message="You can open Subcontractors Management but none of its registers for this project. Ask an administrator for View on Manage Subcontractors, Work Order or Billing." />
    );
  }

  const busy = !current;
  const t = dash?.totals;

  const actions: HeroAction[] = [
    ...(can('Create Bill', `${SC}.Billing`, pid) ? [{ href: `${base}/billing/create`, label: 'New bill', icon: Plus, primary: true }] : []),
    ...(can('Create', `${SC}.Work Order`, pid) ? [{ href: `${base}/work-order/create`, label: 'New work order', icon: FileText }] : []),
    ...(can('Proforma/Advance Bill', `${SC}.Billing`, pid) ? [{ href: `${base}/billing/proforma`, label: 'Advance bill', icon: Wallet }] : []),
    ...(can('Add', `${SC}.Manage Subcontractors`, pid) ? [{ href: `${base}/manage/add`, label: 'Add subcontractor', icon: Users }] : []),
  ];

  /* ── columns ── */

  const subcontractorColumns: ListColumn<SubcontractorRow>[] = [
    {
      header: 'Subcontractor',
      mobile: 'title',
      cell: (r) => (
        <span className="block min-w-[10rem]">
          <span className="font-medium text-foreground">{r.name}</span>
          {r.status === 'Inactive' && <span className="ml-1.5 text-[11px] text-muted-foreground">(inactive)</span>}
          <span className="block text-[11px] text-muted-foreground">{[r.gstNumber && `GST ${r.gstNumber}`, r.contact].filter(Boolean).join(' · ') || (r.inRegister ? '—' : 'Not in the subcontractor register')}</span>
        </span>
      ),
    },
    ...(canWorkOrders
      ? [
          {
            header: 'Work orders',
            align: 'right' as const,
            cell: (r: SubcontractorRow) => (
              <span className="tabular-nums" title={formatInr(r.workOrderValue)}>
                {compactInr(r.workOrderValue)}
                <span className="block text-[11px] text-muted-foreground">{r.workOrders} {r.workOrders === 1 ? 'order' : 'orders'}</span>
              </span>
            ),
          },
        ]
      : []),
    ...(canBilling
      ? [
          {
            header: 'Billed',
            align: 'right' as const,
            cell: (r: SubcontractorRow) => (
              <span className="tabular-nums" title={formatInr(r.billedValue)}>
                {compactInr(r.billedValue)}
                <span className="block text-[11px] text-muted-foreground">{r.bills} {r.bills === 1 ? 'bill' : 'bills'}</span>
              </span>
            ),
          },
          { header: 'Billed share', cell: (r: SubcontractorRow) => <Meter percent={r.billedPercent} /> },
          { header: 'Net payable', align: 'right' as const, cell: (r: SubcontractorRow) => <span className="tabular-nums" title={formatInr(r.netPayable)}>{compactInr(r.netPayable)}</span> },
          { header: 'Retention held', align: 'right' as const, cell: (r: SubcontractorRow) => <span className="tabular-nums" title={formatInr(r.retentionHeld)}>{compactInr(r.retentionHeld)}</span> },
          {
            header: 'Advance due back',
            align: 'right' as const,
            cell: (r: SubcontractorRow) => (
              <span className="tabular-nums" title={`Paid ${formatInr(r.advancePaid)} · recovered ${formatInr(r.advanceRecovered)}`}>
                {compactInr(r.advanceOutstanding)}
              </span>
            ),
          },
          {
            header: 'Open',
            align: 'right' as const,
            mobile: 'aside' as const,
            cell: (r: SubcontractorRow) =>
              r.openBills ? <StatusBadge tone="warning" status={`${r.openBills} in approval`} /> : <span className="text-muted-foreground">—</span>,
          },
          { header: 'Last bill', cell: (r: SubcontractorRow) => <span className="whitespace-nowrap text-muted-foreground">{fmtDay(r.lastBillDate)}</span> },
        ]
      : []),
  ];

  type OpenRow = OpenBillRow & { recordId: string };
  const openColumns: ListColumn<OpenRow>[] = [
    {
      header: 'Bill',
      mobile: 'title',
      cell: (r) => (
        <span className="font-medium text-foreground">
          {r.number}
          {r.kind !== 'Bill' && <span className="font-normal text-muted-foreground"> · {r.kind === 'Proforma' ? 'advance' : 'retention'}</span>}
        </span>
      ),
    },
    { header: 'Subcontractor', cell: (r) => r.subcontractorName },
    { header: 'Waiting at', cell: (r) => r.stage || r.status },
    { header: 'Age', align: 'right', cell: (r) => (r.ageDays === null ? '—' : `${r.ageDays} d`) },
    {
      header: 'Due',
      mobile: 'aside',
      cell: (r) => (r.overdue ? <StatusBadge tone="danger" status={`Overdue · ${fmtMs(r.deadline)}`} /> : <span className="text-muted-foreground">{fmtMs(r.deadline)}</span>),
    },
    { header: 'Amount', align: 'right', cell: (r) => <span className="tabular-nums">{formatInr(r.amount)}</span> },
  ];

  const workOrderColumns: ListColumn<WorkOrderRow>[] = [
    { header: 'Work order', mobile: 'title', cell: (w) => <span className="font-medium text-foreground">{w.workOrderNo}</span> },
    { header: 'Subcontractor', cell: (w) => w.subcontractorName },
    { header: 'Date', cell: (w) => <span className="whitespace-nowrap text-muted-foreground">{fmtDay(w.date)}</span> },
    { header: 'Value', align: 'right', cell: (w) => <span className="tabular-nums">{formatInr(w.value)}</span> },
    ...(canBilling
      ? [
          { header: 'Billed', cell: (w: WorkOrderRow) => <Meter percent={w.billedPercent} /> },
          { header: 'Left to bill', align: 'right' as const, cell: (w: WorkOrderRow) => <span className="tabular-nums">{formatInr(w.balance)}</span> },
        ]
      : []),
    {
      header: 'Status',
      mobile: 'aside',
      cell: (w) => <StatusBadge tone={w.status === 'Cancelled' ? 'neutral' : w.status === 'Completed' ? 'success' : 'progress'} status={w.status} />,
    },
  ];

  const recentColumns: ListColumn<RecentBillRow & { recordId: string }>[] = [
    {
      header: 'Bill',
      mobile: 'title',
      cell: (r) => (
        <span className="font-medium text-foreground">
          {r.number}
          {r.kind !== 'Bill' && <span className="font-normal text-muted-foreground"> · {r.kind === 'Proforma' ? 'advance' : 'retention'}</span>}
        </span>
      ),
    },
    { header: 'Subcontractor', cell: (r) => r.subcontractorName },
    { header: 'Date', cell: (r) => <span className="whitespace-nowrap text-muted-foreground">{fmtDay(r.date)}</span> },
    { header: 'Status', mobile: 'aside', cell: (r) => <StatusBadge tone={statusTone(r.status)} status={r.status} /> },
    { header: 'Amount', align: 'right', cell: (r) => <span className="tabular-nums">{formatInr(r.amount)}</span> },
  ];

  const subcontractorHref = (r: SubcontractorRow) => (canManage && r.inRegister ? `${base}/manage/edit/${encodeURIComponent(r.id)}` : '');
  const openHref = (r: OpenRow) => (r.currentStepId ? `${base}/billing/stage/${encodeURIComponent(r.currentStepId)}` : `${base}/billing/log`);
  const workOrderHref = (w: WorkOrderRow) => `${base}/work-order/${encodeURIComponent(w.id)}`;

  const openRows: OpenRow[] = (dash?.open ?? []).map((r) => ({ ...r, id: `${r.kind}:${r.id}`, recordId: r.id }));
  const recentRows = (dash?.recent ?? []).map((r) => ({ ...r, id: `${r.kind}:${r.id}`, recordId: r.id }));

  return (
    <BrPage tone="rose">
      <PageHeader
        title="Subcontractors"
        description={`${currentProject.projectName} — every subcontractor's work orders, bills, advances and retention.`}
        icon={Briefcase}
        actions={
          <Button variant="outline" size="sm" onClick={() => setReloads((n) => n + 1)} disabled={busy}>
            <RefreshCw className={busy ? 'mr-2 h-4 w-4 animate-spin' : 'mr-2 h-4 w-4'} />
            Refresh
          </Button>
        }
      />

      {current?.error && (
        <BrNotice tone="danger" icon={AlertTriangle} title="The dashboard could not load">
          {current.error}
        </BrNotice>
      )}

      {busy || !t ? (
        current?.error ? null : <Skeleton className="h-48 w-full rounded-3xl" />
      ) : (
        <BrHero
          eyebrow={canBilling ? 'Billed to subcontractors · work value' : 'Work orders on this project'}
          live={current?.data ? `Updated ${format(new Date(current.data.at), 'HH:mm')}` : undefined}
          value={formatInr(canBilling ? t.billedValue : t.workOrderValue)}
          caption={
            <>
              {canBilling && t.billedPercent !== null && (
                <>
                  <b className="text-white">{t.billedPercent}%</b> of {compactInr(t.workOrderValue)} in work orders billed ·{' '}
                </>
              )}
              <b className="text-white">{t.subcontractors}</b> {t.subcontractors === 1 ? 'subcontractor' : 'subcontractors'} ·{' '}
              <b className="text-white">{t.workOrders}</b> work {t.workOrders === 1 ? 'order' : 'orders'}
            </>
          }
          actions={actions}
          aside={
            canBilling ? (
              <>
                <HeroPanelTitle left="Where work order value stands" right={`Ordered ${compactInr(t.workOrderValue)}`} />
                <HeroBar
                  parts={[
                    { label: 'Billed', value: t.billedValue, color: '#4ade80' },
                    { label: 'Left to bill', value: t.balanceToBill, color: '#ffffff' },
                  ]}
                />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <HeroStat label="Net payable" value={compactInr(t.netPayable)} swatch="#4ade80" title={formatInr(t.netPayable)} hint={`${t.bills} bills`} />
                  <HeroStat label="Left to bill" value={compactInr(t.balanceToBill)} swatch="#ffffff" title={formatInr(t.balanceToBill)} hint="of open work orders" />
                  <HeroStat label="In approval" value={compactInr(t.openValue)} title={formatInr(t.openValue)} hint={`${t.openBills} bills${t.overdue ? ` · ${t.overdue} overdue` : ''}`} />
                </div>
              </>
            ) : undefined
          }
        />
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {busy || !t ? (
          current?.error ? null : Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)
        ) : (
          <>
            <KpiCard label="Subcontractors" value={t.subcontractors.toLocaleString('en-IN')} hint={`${t.activeSubcontractors} with open work orders`} icon={Users} tone="rose" accent />
            {canWorkOrders && (
              <KpiCard label="Work orders" value={compactInr(t.workOrderValue)} hint={`${t.workOrders} orders`} icon={FileText} tone="blue" accent />
            )}
            {canBilling && (
              <>
                <KpiCard label="Billed (work value)" value={compactInr(t.billedValue)} hint={t.billedPercent === null ? `${t.bills} bills` : `${t.billedPercent}% of work orders · ${t.bills} bills`} icon={Calculator} tone="teal" accent />
                <KpiCard label="Net payable" value={compactInr(t.netPayable)} hint={`Gross ${compactInr(t.grossBilled)} less deductions`} icon={Landmark} tone="emerald" accent />
                <KpiCard label="Retention held" value={compactInr(t.retentionHeld)} hint={`${compactInr(t.retentionReleased)} released`} icon={Clock} tone="amber" accent />
                <KpiCard label="Advance due back" value={compactInr(t.advanceOutstanding)} hint={`Paid ${compactInr(t.advancePaid)} · recovered ${compactInr(t.advanceRecovered)}`} icon={Wallet} tone="violet" accent />
                <KpiCard label="In approval" value={t.openBills.toLocaleString('en-IN')} hint={`${compactInr(t.openValue)}${t.overdue ? ` · ${t.overdue} overdue` : ''}`} icon={AlertTriangle} tone={t.overdue ? 'rose' : 'slate'} accent />
                <KpiCard label="Left to bill" value={compactInr(t.balanceToBill)} hint="Work order value not yet billed" icon={ListChecks} tone="indigo" accent />
              </>
            )}
          </>
        )}
      </div>

      {dash && canBilling && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <SubcontractorValueChart rows={dash.subcontractors} />
          <MonthlyBillingChart points={dash.byMonth} />
        </div>
      )}

      {dash && (
        <Panel
          title="Subcontractors on this project"
          description={`${dash.subcontractors.length} with a work order or bill here${canManage ? ' — open one for its details' : ''}.`}
          icon={Users}
          tone="rose"
          bodyClassName="p-0 sm:p-4 sm:pt-2"
        >
          <DataList
            rows={dash.subcontractors}
            columns={subcontractorColumns}
            dense
            empty="No subcontractor has a work order or bill on this project yet."
            cardHref={canManage ? (r) => subcontractorHref(r) || `${base}/manage` : undefined}
            onRowClick={canManage ? (r) => { const href = subcontractorHref(r); if (href) router.push(href); } : undefined}
          />
        </Panel>
      )}

      {dash && canBilling && (
        <Panel
          title="Bills in approval"
          description={`${dash.open.length} waiting, overdue first — open one to act on it at its stage.`}
          icon={History}
          tone="orange"
          bodyClassName="p-0 sm:p-4 sm:pt-2"
        >
          <DataList rows={openRows} columns={openColumns} dense empty="Nothing is waiting for approval." cardHref={openHref} onRowClick={(r) => router.push(openHref(r))} />
        </Panel>
      )}

      {dash && canWorkOrders && (
        <Panel
          title="Work orders"
          description={`${dash.workOrders.length} on this project, largest first${canBilling ? ', with what has been billed against each' : ''}.`}
          icon={FileText}
          tone="blue"
          bodyClassName="p-0 sm:p-4 sm:pt-2"
        >
          <DataList rows={dash.workOrders} columns={workOrderColumns} dense empty="No work order on this project yet." cardHref={workOrderHref} onRowClick={(w) => router.push(workOrderHref(w))} />
        </Panel>
      )}

      {dash && canBilling && (
        <Panel
          title="Latest bills"
          description="Regular, retention and advance bills, newest first."
          icon={Calculator}
          tone="sky"
          bodyClassName="p-0 sm:p-4 sm:pt-2"
        >
          <div className="flex flex-wrap items-center gap-2 px-4 pb-3 pt-2 sm:px-0 sm:pt-0">
            {STATUSES.map((s) => (
              <StatusBadge key={s} tone={statusTone(s)} status={s}>
                {s} · {dash.statusCounts[s]}
              </StatusBadge>
            ))}
          </div>
          <DataList
            rows={recentRows}
            columns={recentColumns}
            dense
            empty="No subcontractor bill on this project yet."
            cardHref={() => `${base}/billing/log`}
            onRowClick={() => router.push(`${base}/billing/log`)}
          />
        </Panel>
      )}
    </BrPage>
  );
}
