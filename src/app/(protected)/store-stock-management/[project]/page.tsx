'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Boxes,
  Building2,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  IndianRupee,
  MapPin,
  PackageCheck,
  PackageMinus,
  PackagePlus,
  RefreshCw,
  ShieldAlert,
  Warehouse,
  type LucideIcon,
} from 'lucide-react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { format, formatDistanceToNow } from 'date-fns';
import { db } from '@/lib/firebase';
import type { BoqItem, InventoryLog, Project } from '@/lib/types';
import { calculateProjectStockDashboard, type ProjectStockHealth } from '@/lib/project-stock-dashboard';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

const slugify = (text: string) => text.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]+/g, '');

const currency = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
});

export default function ProjectDashboardPage() {
  const params = useParams();
  const projectSlug = String(params?.project || '');
  const { toast } = useToast();
  const { can, isLoading: authorizationLoading } = useAuthorization();
  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  const [boqItems, setBoqItems] = useState<BoqItem[]>([]);
  const [inventoryLogs, setInventoryLogs] = useState<InventoryLog[]>([]);
  const [siteCount, setSiteCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const loadDashboard = useCallback(async () => {
    if (!projectSlug) return;
    setIsLoading(true);
    setLoadError('');
    try {
      const projectsSnapshot = await getDocs(collection(db, 'projects'));
      const project = projectsSnapshot.docs
        .map((projectDocument) => ({ id: projectDocument.id, ...projectDocument.data() }) as Project)
        .find((candidate) => slugify(candidate.projectName || '') === projectSlug);
      if (!project) {
        setCurrentProject(null);
        setLoadError('The requested project could not be found.');
        return;
      }
      setCurrentProject(project);

      const [boqSnapshot, inventorySnapshot, sitesSnapshot] = await Promise.all([
        getDocs(collection(db, 'projects', project.id, 'boqItems')),
        getDocs(query(collection(db, 'inventoryLogs'), where('projectId', '==', project.id))),
        getDocs(collection(db, 'projects', project.id, 'sites')),
      ]);
      setBoqItems(boqSnapshot.docs.map((document) => ({ id: document.id, ...document.data() }) as BoqItem));
      setInventoryLogs(inventorySnapshot.docs.map((document) => ({ id: document.id, ...document.data() }) as InventoryLog));
      setSiteCount(sitesSnapshot.size);
    } catch (error) {
      console.error('Unable to load project stock dashboard', error);
      setLoadError('Project stock information could not be loaded. Check your connection and try again.');
      toast({ title: 'Unable to load project dashboard', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  }, [projectSlug, toast]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const dashboard = useMemo(
    () => calculateProjectStockDashboard(boqItems, inventoryLogs),
    [boqItems, inventoryLogs],
  );

  const canViewDashboard = Boolean(currentProject) && can('View Dashboard', 'Store & Stock Management.Projects', currentProject?.id);
  const canViewInventory = Boolean(currentProject) && can('View Inventory', 'Store & Stock Management.Projects', currentProject?.id);
  const canViewTransactions = Boolean(currentProject) && can('View Transactions', 'Store & Stock Management.Projects', currentProject?.id);
  const canStockIn = Boolean(currentProject) && can('Stock In', 'Store & Stock Management.Projects', currentProject?.id);
  const canStockOut = Boolean(currentProject) && can('Stock Out', 'Store & Stock Management.Projects', currentProject?.id);
  const canViewBoq = Boolean(currentProject) && can('View BOQ', 'Store & Stock Management.Projects', currentProject?.id);
  const canViewReports = Boolean(currentProject) && can('View Reports', 'Store & Stock Management.Projects', currentProject?.id);

  const recentMovements = dashboard.movementSummaries.slice(0, 6);
  const currentStockRows = dashboard.stockRows.filter((row) => row.currentQuantity > 0.000001).slice(0, 6);
  const trackedStockItems = dashboard.stockRows.filter((row) => row.receivedQuantity > 0).length;
  const healthyStockItems = dashboard.stockRows.filter((row) => row.health === 'In stock' && row.receivedQuantity > 0).length;
  const healthPercentage = trackedStockItems ? (healthyStockItems / trackedStockItems) * 100 : 0;
  const lastMovementAt = dashboard.movementSummaries[0]?.date || null;

  if (isLoading || authorizationLoading) return <DashboardSkeleton />;

  if (loadError && !currentProject) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Project unavailable</AlertTitle>
        <AlertDescription className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <span>{loadError}</span>
          <Button variant="outline" size="sm" onClick={() => void loadDashboard()}><RefreshCw className="mr-2 h-4 w-4" />Retry</Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (!canViewDashboard || !currentProject) {
    return (
      <Card className="border-destructive/30">
        <CardHeader><CardTitle>Access denied</CardTitle><CardDescription>You do not have permission to view this project dashboard.</CardDescription></CardHeader>
        <CardContent className="flex justify-center py-10"><ShieldAlert className="h-14 w-14 text-destructive" /></CardContent>
      </Card>
    );
  }

  const workspaceLinks = [
    { label: 'Project inventory', description: 'Balances and item-level history', href: `/store-stock-management/${projectSlug}/inventory`, icon: Warehouse, tone: 'bg-emerald-100 text-emerald-700', visible: canViewInventory },
    { label: 'Transactions', description: 'Receipts, issues, and movement history', href: `/store-stock-management/${projectSlug}/transactions`, icon: Activity, tone: 'bg-violet-100 text-violet-700', visible: canViewTransactions },
    { label: 'BOQ control', description: 'Import, review, and maintain project BOQ', href: `/store-stock-management/${projectSlug}/boq`, icon: ClipboardList, tone: 'bg-cyan-100 text-cyan-700', visible: canViewBoq },
    { label: 'Reports', description: 'Ageing and project stock analysis', href: `/store-stock-management/${projectSlug}/reports`, icon: BarChart3, tone: 'bg-blue-100 text-blue-700', visible: canViewReports },
  ].filter((item) => item.visible);

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-2xl border border-emerald-200/60 bg-gradient-to-br from-slate-950 via-emerald-950 to-teal-900 p-6 text-white shadow-lg sm:p-8">
        <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-emerald-300/15 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 left-1/3 h-56 w-56 rounded-full bg-cyan-300/10 blur-3xl" />
        <div className="relative flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <Badge className="border-white/15 bg-white/10 text-white hover:bg-white/10"><Building2 className="mr-1.5 h-3.5 w-3.5" />Project stock workspace</Badge>
              <Badge className={cn('border-white/15', currentProject.status === 'Active' ? 'bg-emerald-400/20 text-emerald-100' : 'bg-slate-400/20 text-slate-100')}>{currentProject.status || 'Unknown'}</Badge>
            </div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{currentProject.projectName}</h1>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-emerald-100/85">
              <ProjectMeta icon={MapPin} value={currentProject.location || currentProject.projectSite || 'Location not configured'} />
              <ProjectMeta icon={ClipboardList} value={currentProject.siteCode || 'Site code not configured'} />
              <ProjectMeta icon={Building2} value={currentProject.projectDivision || 'Division not configured'} />
              <ProjectMeta icon={CalendarDays} value={lastMovementAt ? `Last movement ${formatDistanceToNow(lastMovementAt, { addSuffix: true })}` : 'No stock movement yet'} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {canViewInventory && <Button asChild variant="secondary"><Link href={`/store-stock-management/${projectSlug}/inventory`}><Boxes className="mr-2 h-4 w-4" />View inventory</Link></Button>}
            {canViewTransactions && <Button asChild className="border border-white/20 bg-white/10 text-white hover:bg-white/20"><Link href={`/store-stock-management/${projectSlug}/transactions`}><Activity className="mr-2 h-4 w-4" />Transactions</Link></Button>}
          </div>
        </div>
      </section>

      {loadError && (
        <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Some dashboard data may be unavailable</AlertTitle><AlertDescription>{loadError}</AlertDescription></Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="Current stock value" value={currency.format(dashboard.currentStockValue)} description={`${dashboard.itemsInStock} item${dashboard.itemsInStock === 1 ? '' : 's'} with available stock`} icon={IndianRupee} tone="bg-emerald-100 text-emerald-700" />
        <MetricCard title="BOQ value" value={currency.format(dashboard.boqValue)} description={`${dashboard.boqItemCount.toLocaleString('en-IN')} BOQ line${dashboard.boqItemCount === 1 ? '' : 's'}`} icon={ClipboardList} tone="bg-cyan-100 text-cyan-700" />
        <MetricCard title="BOQ stock coverage" value={`${dashboard.boqCoveragePercentage.toFixed(1)}%`} description={`${dashboard.coveredBoqItemCount} of ${dashboard.boqItemCount} BOQ items have movements`} icon={PackageCheck} tone="bg-blue-100 text-blue-700" />
        <MetricCard title="Movement documents" value={(dashboard.receiptDocumentCount + dashboard.issueDocumentCount).toLocaleString('en-IN')} description={`${dashboard.receiptDocumentCount} receipt · ${dashboard.issueDocumentCount} issue`} icon={Activity} tone="bg-violet-100 text-violet-700" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(300px,0.8fr)]">
        <Card className="min-w-0 border-slate-200/80 shadow-sm">
          <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div><CardTitle>Recent stock movements</CardTitle><CardDescription>Latest project receipts and issues, grouped into business documents.</CardDescription></div>
            {canViewTransactions && <Button asChild variant="outline" size="sm"><Link href={`/store-stock-management/${projectSlug}/transactions`}>View all<ArrowRight className="ml-2 h-4 w-4" /></Link></Button>}
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader><TableRow><TableHead>Document</TableHead><TableHead>Date</TableHead><TableHead>Type</TableHead><TableHead>Lines</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
              <TableBody>
                {recentMovements.map((movement) => (
                  <TableRow key={movement.id}>
                    <TableCell><p className="max-w-64 truncate font-medium">{movement.reference}</p><p className="max-w-64 truncate text-xs text-muted-foreground">{movement.counterparty}</p></TableCell>
                    <TableCell className="whitespace-nowrap text-sm">{movement.date ? format(movement.date, 'dd MMM yyyy') : '—'}</TableCell>
                    <TableCell><MovementBadge type={movement.transactionType} /></TableCell>
                    <TableCell>{movement.lineCount}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{currency.format(movement.totalAmount)}</TableCell>
                  </TableRow>
                ))}
                {!recentMovements.length && <TableRow><TableCell colSpan={5} className="h-32 text-center text-muted-foreground">No project stock movements have been recorded yet.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="border-slate-200/80 shadow-sm">
            <CardHeader><CardTitle>Stock health</CardTitle><CardDescription>Health is measured from remaining quantity in received stock layers.</CardDescription></CardHeader>
            <CardContent className="space-y-5">
              <div><div className="mb-2 flex items-center justify-between text-sm"><span className="text-muted-foreground">Healthy stocked items</span><span className="font-bold">{healthyStockItems}/{trackedStockItems}</span></div><Progress value={healthPercentage} className="h-2" /></div>
              <div><div className="mb-2 flex items-center justify-between text-sm"><span className="text-muted-foreground">BOQ movement coverage</span><span className="font-bold">{dashboard.boqCoveragePercentage.toFixed(1)}%</span></div><Progress value={Math.min(100, dashboard.boqCoveragePercentage)} className="h-2" /></div>
              <div className="grid grid-cols-3 gap-2">
                <HealthPill label="In stock" value={dashboard.itemsInStock} icon={CheckCircle2} className="bg-emerald-50 text-emerald-700" />
                <HealthPill label="Low" value={dashboard.lowStockItems} icon={AlertTriangle} className="bg-amber-50 text-amber-700" />
                <HealthPill label="Out" value={dashboard.outOfStockItems} icon={PackageMinus} className="bg-rose-50 text-rose-700" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200/80 shadow-sm">
            <CardHeader><CardTitle>Project setup</CardTitle><CardDescription>Operational master-data snapshot.</CardDescription></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <SetupRow label="Project status" value={currentProject.status || 'Unknown'} />
              <SetupRow label="Configured sites" value={siteCount.toLocaleString('en-IN')} />
              <SetupRow label="BOQ lines" value={dashboard.boqItemCount.toLocaleString('en-IN')} />
              <SetupRow label="Site in charge" value={currentProject.siteInCharge || 'Not configured'} />
            </CardContent>
          </Card>
        </div>
      </div>

      <Card className="border-slate-200/80 shadow-sm">
        <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div><CardTitle>Current stock positions</CardTitle><CardDescription>Highest-value available items. Values come from each receipt layer’s remaining quantity and cost.</CardDescription></div>
          {canViewInventory && <Button asChild variant="outline" size="sm"><Link href={`/store-stock-management/${projectSlug}/inventory`}>Open inventory<ArrowRight className="ml-2 h-4 w-4" /></Link></Button>}
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Item</TableHead><TableHead className="text-right">Received</TableHead><TableHead className="text-right">Issued</TableHead><TableHead className="text-right">Current</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Stock value</TableHead></TableRow></TableHeader>
            <TableBody>
              {currentStockRows.map((row) => <TableRow key={row.itemId}><TableCell><p className="max-w-xl truncate font-medium">{row.itemName}</p><p className="text-xs text-muted-foreground">{row.unit}</p></TableCell><TableCell className="text-right tabular-nums">{formatQuantity(row.receivedQuantity)}</TableCell><TableCell className="text-right tabular-nums">{formatQuantity(row.issuedQuantity)}</TableCell><TableCell className="text-right font-bold tabular-nums">{formatQuantity(row.currentQuantity)}</TableCell><TableCell><StockHealthBadge health={row.health} /></TableCell><TableCell className="text-right font-medium tabular-nums">{currency.format(row.currentValue)}</TableCell></TableRow>)}
              {!currentStockRows.length && <TableRow><TableCell colSpan={6} className="h-32 text-center text-muted-foreground">No available stock. Post a stock-in transaction to establish the project balance.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {workspaceLinks.length > 0 && (
        <section className="space-y-3">
          <div><h2 className="text-lg font-bold tracking-tight">Project workspaces</h2><p className="text-sm text-muted-foreground">Continue into the detailed project stock workflow.</p></div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {workspaceLinks.map((item) => {
              const Icon = item.icon;
              return <Link key={item.href} href={item.href} className="group rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"><Card className="h-full border-slate-200/80 transition-all duration-200 group-hover:-translate-y-0.5 group-hover:border-emerald-200 group-hover:shadow-md"><CardContent className="flex items-start gap-3 p-4"><div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', item.tone)}><Icon className="h-5 w-5" /></div><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><p className="font-bold">{item.label}</p><ArrowRight className="h-4 w-4 text-slate-400 transition-transform group-hover:translate-x-1 group-hover:text-emerald-700" /></div><p className="mt-1 text-xs leading-5 text-muted-foreground">{item.description}</p></div></CardContent></Card></Link>;
            })}
          </div>
        </section>
      )}

      {(canStockIn || canStockOut) && (
        <div className="flex flex-wrap justify-end gap-2">
          {canStockIn && <Button asChild variant="outline"><Link href={`/store-stock-management/${projectSlug}/transactions/stock-in`}><PackagePlus className="mr-2 h-4 w-4" />Record stock in</Link></Button>}
          {canStockOut && <Button asChild><Link href={`/store-stock-management/${projectSlug}/transactions/stock-out`}><PackageMinus className="mr-2 h-4 w-4" />Record stock out</Link></Button>}
        </div>
      )}
    </div>
  );
}

function ProjectMeta({ icon: Icon, value }: { icon: LucideIcon; value: string }) {
  return <span className="inline-flex items-center gap-1.5"><Icon className="h-4 w-4" />{value}</span>;
}

function MetricCard({ title, value, description, icon: Icon, tone }: { title: string; value: string; description: string; icon: LucideIcon; tone: string }) {
  return <Card className="border-slate-200/80 bg-white/90 shadow-sm"><CardContent className="flex h-full items-start justify-between gap-4 p-5"><div className="min-w-0"><p className="text-sm font-medium text-muted-foreground">{title}</p><p className="mt-2 truncate text-2xl font-bold tracking-tight">{value}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p></div><div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', tone)}><Icon className="h-5 w-5" /></div></CardContent></Card>;
}

function HealthPill({ label, value, icon: Icon, className }: { label: string; value: number; icon: LucideIcon; className: string }) {
  return <div className={cn('rounded-xl p-3 text-center', className)}><Icon className="mx-auto h-4 w-4" /><p className="mt-1 text-lg font-bold">{value}</p><p className="text-[10px] font-medium">{label}</p></div>;
}

function SetupRow({ label, value }: { label: string; value: string }) {
  return <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-3 last:border-0 last:pb-0"><span className="text-muted-foreground">{label}</span><span className="max-w-[60%] text-right font-medium">{value}</span></div>;
}

function MovementBadge({ type }: { type: string }) {
  if (type === 'Goods Receipt') return <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">Receipt</Badge>;
  if (type === 'Goods Issue') return <Badge className="bg-rose-100 text-rose-800 hover:bg-rose-100">Issue</Badge>;
  return <Badge variant="secondary">{type}</Badge>;
}

function StockHealthBadge({ health }: { health: ProjectStockHealth }) {
  if (health === 'Out of stock') return <Badge variant="destructive">Out of stock</Badge>;
  if (health === 'Low remaining') return <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">Low remaining</Badge>;
  return <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">In stock</Badge>;
}

function formatQuantity(value: number) {
  return value.toLocaleString('en-IN', { maximumFractionDigits: 3 });
}

function DashboardSkeleton() {
  return <div className="space-y-6"><Skeleton className="h-52 w-full rounded-2xl" /><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-32" />)}</div><div className="grid gap-6 xl:grid-cols-[1.7fr_0.8fr]"><Skeleton className="h-96" /><Skeleton className="h-96" /></div><Skeleton className="h-80" /></div>;
}
