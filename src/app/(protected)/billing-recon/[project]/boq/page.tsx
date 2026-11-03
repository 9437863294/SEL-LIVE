'use client';

/**
 * Billing Recon › BOQ: the project's bill of quantities at a glance — items, value, scope groups and
 * rows missing a rate or quantity — then its actions and its value by Scope 2 › Scope 1.
 *
 * One read: the BOQ in the project's register (`billingReconRegister(project).boqItems`, via the
 * Billing Recon shell), each row read with `readBoqRow` so qty, rate, amount and scopes agree with
 * the BOQ view and the reconciliation.
 */

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { AlertTriangle, ClipboardList, Eye, FileQuestion, IndianRupee, Layers, ListOrdered, PlusSquare, RefreshCw, UploadCloud } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/shared/page-header';
import { KpiCard } from '@/components/shared/kpi-card';
import { StatusBadge } from '@/components/shared/status-badge';
import { TableCard } from '@/components/shared/table-card';
import { DataList, type ListColumn } from '@/components/shared/data-list';
import { useBillingReconProjects } from '@/components/billing-recon/billing-recon-shell';
import { ActionCard, BrAccessDenied, BrNotice, BrPage, BrPageSkeleton, BrSection, BR_TONE } from '@/components/billing-recon/page-kit';
import { useAuthorization } from '@/hooks/useAuthorization';
import { db } from '@/lib/firebase';
import { registerLabel } from '@/lib/billing-recon/register';
import { compareNatural, formatAmount, formatAmountCompact, normaliseScope, readBoqRow, round2, type BoqRowFields } from '@/lib/billing-recon/lines';

/** Scope groups shown in the table; the rest are summed in its footer. */
const TOP_GROUPS = 12;

interface ScopeGroup {
  id: string;
  scope2: string;
  scope1: string;
  items: number;
  value: number;
}

interface BoqData {
  baseKey: string;
  refresh: number;
  rows: BoqRowFields[];
  error: string | null;
}

function shareLabel(value: number, total: number): string {
  if (total <= 0 || value <= 0) return '—';
  const pct = (value / total) * 100;
  return pct < 1 ? '<1%' : `${Math.round(pct)}%`;
}

const scopeCell = (scope: string) =>
  scope ? (
    <span className="block max-w-[18rem] truncate" title={scope}>
      {scope}
    </span>
  ) : (
    <span className="text-muted-foreground">No scope</span>
  );

export default function BoqPage() {
  const params = useParams<{ project: string }>();
  const projectSlug = params?.project ?? '';
  const base = `/billing-recon/${projectSlug}/boq`;
  const { can, isLoading } = useAuthorization();
  const { currentProject, register, loading: projectsLoading } = useBillingReconProjects();

  const canViewModule = can('View', 'Billing Recon.BOQ');
  const canImport = can('Import', 'Billing Recon.BOQ');
  const canAdd = can('Add Manual', 'Billing Recon.BOQ');

  const projectId = currentProject?.id ?? '';
  const boqCollection = register.boqItems;
  const baseKey = `${projectId}|${boqCollection}`;
  const ready = !isLoading && !projectsLoading && canViewModule && Boolean(projectId);

  const [refresh, setRefresh] = useState(0);
  const [data, setData] = useState<BoqData | null>(null);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    getDocs(collection(db, 'projects', projectId, boqCollection))
      .then((snap) => {
        if (!cancelled) setData({ baseKey, refresh, rows: snap.docs.map((d) => readBoqRow(d.data())), error: null });
      })
      .catch((error) => {
        console.error('Billing Recon BOQ: could not read the BOQ', error);
        if (!cancelled) setData({ baseKey, refresh, rows: [], error: 'The BOQ could not be read. Try Refresh in a moment.' });
      });
    return () => {
      cancelled = true;
    };
  }, [ready, baseKey, refresh, projectId, boqCollection]);

  const current = data && data.baseKey === baseKey ? data : null;
  const refreshing = Boolean(current && current.refresh !== refresh);
  const rows = useMemo(() => current?.rows ?? [], [current]);

  const stats = useMemo(() => {
    const groups = new Map<string, ScopeGroup>();
    const scope2s = new Set<string>();
    const scope1s = new Set<string>();
    let value = 0;
    let missing = 0;
    let noRate = 0;
    let noQty = 0;
    for (const r of rows) {
      value += r.amount;
      if (!r.rate) noRate += 1;
      if (!r.qty) noQty += 1;
      if (!r.rate || !r.qty) missing += 1;
      const s2 = normaliseScope(r.scope2);
      const s1 = normaliseScope(r.scope1);
      if (s2) scope2s.add(s2);
      if (s1) scope1s.add(`${s2}__${s1}`);
      const id = `${s2}__${s1}`;
      const g = groups.get(id) ?? { id, scope2: r.scope2, scope1: r.scope1, items: 0, value: 0 };
      g.items += 1;
      g.value += r.amount;
      groups.set(id, g);
    }
    const sorted = [...groups.values()]
      .map((g) => ({ ...g, value: round2(g.value) }))
      .sort((a, b) => b.value - a.value || b.items - a.items || compareNatural(a.scope2, b.scope2) || compareNatural(a.scope1, b.scope1));
    return { value: round2(value), missing, noRate, noQty, scope2: scope2s.size, scope1: scope1s.size, groups: sorted };
  }, [rows]);

  const shown = stats.groups.slice(0, TOP_GROUPS);
  const rest = stats.groups.slice(TOP_GROUPS);
  const restValue = round2(rest.reduce((s, g) => s + g.value, 0));

  const columns: Array<ListColumn<ScopeGroup>> = [
    { header: 'Scope 2', cell: (g) => scopeCell(g.scope2), mobile: 'title' },
    { header: 'Scope 1', cell: (g) => scopeCell(g.scope1) },
    { header: 'Items', cell: (g) => <span className="tabular-nums">{g.items}</span>, align: 'right' },
    { header: 'Value', cell: (g) => <span className="whitespace-nowrap font-medium tabular-nums text-foreground">{formatAmount(g.value)}</span>, align: 'right', mobile: 'aside' },
    { header: 'Share', cell: (g) => <span className="tabular-nums text-muted-foreground">{shareLabel(g.value, stats.value)}</span>, align: 'right' },
  ];

  if (isLoading || projectsLoading) return <BrPageSkeleton kpis={4} blocks={2} />;
  if (!canViewModule) return <BrAccessDenied message="You do not have permission to access BOQ management." />;

  if (!currentProject) {
    return (
      <BrPage tone={BR_TONE.boq}>
        <PageHeader title="BOQ Management" icon={ClipboardList} />
        <BrNotice tone="danger" icon={AlertTriangle} title="Project not found">
          This link does not match any project. It may have been renamed or removed — pick the project again from the switcher.
        </BrNotice>
      </BrPage>
    );
  }

  if (!current) return <BrPageSkeleton kpis={4} blocks={2} />;

  const empty = !current.error && rows.length === 0;

  return (
    <BrPage tone={BR_TONE.boq}>
      <PageHeader
        eyebrow={currentProject.projectName}
        title="BOQ Management"
        description="The project's bill of quantities: what's in it, what it's worth, and which rows are incomplete."
        icon={ClipboardList}
        meta={[{ label: 'Register', value: registerLabel(currentProject) }]}
        actions={
          <>
            <Button variant="outline" onClick={() => setRefresh((n) => n + 1)} disabled={refreshing}>
              <RefreshCw className={refreshing ? 'mr-2 h-4 w-4 animate-spin' : 'mr-2 h-4 w-4'} />
              Refresh
            </Button>
            <Button asChild>
              <Link href={`${base}/view`}>
                <Eye className="mr-2 h-4 w-4" />
                View BOQ
              </Link>
            </Button>
          </>
        }
      />

      {current.error && (
        <BrNotice tone="danger" icon={AlertTriangle} title="Couldn't read the BOQ">
          {current.error}
        </BrNotice>
      )}

      {empty && (
        <BrNotice
          tone="info"
          icon={UploadCloud}
          title="No BOQ for this project yet"
          action={
            canImport ? (
              <Button asChild size="sm">
                <Link href={`${base}/import`}>Import BOQ</Link>
              </Button>
            ) : undefined
          }
        >
          JMC and MVAC entries are raised against BOQ items, so start by importing the BOQ from Excel
          {canImport ? '.' : ' — ask someone with import access to do it.'}
        </BrNotice>
      )}

      {!empty && !current.error && (
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <KpiCard label="BOQ items" value={rows.length} hint="Rows in this project's BOQ" icon={ListOrdered} tone="emerald" accent />
          <KpiCard label="BOQ value" value={formatAmountCompact(stats.value)} hint={formatAmount(stats.value)} icon={IndianRupee} tone="teal" accent />
          <KpiCard label="Scope 2 / Scope 1" value={`${stats.scope2} / ${stats.scope1}`} hint="Distinct groups in the BOQ" icon={Layers} tone="cyan" accent />
          <KpiCard
            label="Missing rate or qty"
            value={stats.missing}
            hint={stats.missing ? `${stats.noRate} without a rate · ${stats.noQty} without a qty` : 'Every row has a rate and qty'}
            icon={FileQuestion}
            tone={stats.missing ? 'amber' : 'emerald'}
            accent
          />
        </div>
      )}

      <BrSection title="BOQ actions" description="Bring the BOQ in, read it, or add to it." icon={ClipboardList} tone={BR_TONE.boq}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <ActionCard
            href={`${base}/import`}
            title="Import BOQ"
            description="Upload and process a BOQ file from Excel."
            icon={UploadCloud}
            tone={BR_TONE.boq}
            badge={empty && canImport ? <StatusBadge tone="info">Start here</StatusBadge> : undefined}
            disabled={!canImport}
            disabledReason="No permission to import"
          />
          <ActionCard
            href={`${base}/view`}
            title="View BOQ"
            description="Every item with its quantities, rates and what's been measured against it."
            icon={Eye}
            tone="teal"
            figure={current.error ? '—' : rows.length}
            figureLabel={rows.length === 1 ? 'item' : 'items'}
          />
          <ActionCard
            href={`${base}/add`}
            title="Add BOQ Items"
            description="Add items to the BOQ by hand."
            icon={PlusSquare}
            tone="cyan"
            disabled={!canAdd}
            disabledReason="No permission to add items"
          />
        </div>
      </BrSection>

      {!empty && !current.error && (
        <TableCard
          title="Value by scope"
          description="Scope 2 › Scope 1 groups, largest value first."
          icon={Layers}
          count={shown.length}
          total={stats.groups.length}
          noun="group"
          scroll="natural"
          footer={
            rest.length > 0 ? (
              <span>
                +{rest.length} more {rest.length === 1 ? 'group' : 'groups'} worth {formatAmount(restValue)} — the BOQ view lists every item.
              </span>
            ) : undefined
          }
        >
          <DataList rows={shown} columns={columns} dense />
        </TableCard>
      )}
    </BrPage>
  );
}
