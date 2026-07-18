'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  addDoc, collection, deleteDoc, doc, getDocs, orderBy, query, serverTimestamp, updateDoc,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  formatINR, SAS_COLLECTIONS,
  type SASBudget, type SASExpense, type SASPayment, type SASProject,
} from '@/lib/site-account-statement';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useActivityLogger } from '@/hooks/useActivityLogger';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Calendar, ChevronDown, ChevronLeft, ChevronRight, Download, Loader2,
  Pencil, Plus, Target, Trash2, TrendingDown, TrendingUp, Wallet,
} from 'lucide-react';
import ExcelJS from 'exceljs';
import { cn } from '@/lib/utils';

const MODULE   = 'Site Account Statement';
const RESOURCE = 'Budget';

// ── Period helpers ────────────────────────────────────────────────────────────
function currentFYStart(): number {
  const now = new Date();
  return now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
}
function fyLabel(y: number) { return `${y}-${String(y + 1).slice(-2)}`; }
function fyRange(y: number) { return { start: `${y}-04-01`, end: `${y + 1}-03-31` }; }
function currentMonthStr(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}
function monthLabel(m: string): string {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}
function shiftMonth(m: string, delta: number): string {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(y, mo - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function getFYStartFromDate(dateStr: string): number {
  const [y, mo] = dateStr.split('-').map(Number);
  return mo >= 4 ? y : y - 1;
}
function getFYMonths(fyStartYear: number): string[] {
  const months: string[] = [];
  for (let m = 4; m <= 12; m++) months.push(`${fyStartYear}-${String(m).padStart(2, '0')}`);
  for (let m = 1;  m <= 3;  m++) months.push(`${fyStartYear + 1}-${String(m).padStart(2, '0')}`);
  return months;
}
function formatPct(p: number) { return `${Math.min(p, 999).toFixed(1)}%`; }

// ── Types ─────────────────────────────────────────────────────────────────────
type BudgetTab = 'total' | 'monthly' | 'fy';

interface FormState {
  projectId:    string;
  projectName:  string;
  budgetAmount: string;
  notes:        string;
}
const blank = (): FormState => ({ projectId: '', projectName: '', budgetAmount: '', notes: '' });

// ── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ budget, spent }: { budget: SASBudget | null; spent: number }) {
  if (!budget) return <Badge variant="outline" className="text-xs text-muted-foreground">No Budget</Badge>;
  const pct = budget.budgetAmount > 0 ? (spent / budget.budgetAmount) * 100 : 0;
  if (spent > budget.budgetAmount) return <Badge variant="destructive" className="text-xs">Over Budget</Badge>;
  if (pct >= 80) return <Badge className="text-xs bg-amber-500 hover:bg-amber-500">Warning</Badge>;
  return <Badge className="text-xs bg-emerald-600 hover:bg-emerald-600">On Track</Badge>;
}

// ── Delete confirm dialog ─────────────────────────────────────────────────────
function DeleteConfirm({ label, onConfirm, size = 'md' }: { label: string; onConfirm: () => void; size?: 'sm' | 'md' }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon" className={cn('text-destructive hover:bg-destructive/10', size === 'sm' ? 'h-6 w-6' : 'h-8 w-8')}>
          <Trash2 className={size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Budget</AlertDialogTitle>
          <AlertDialogDescription>{label}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} className="bg-destructive hover:bg-destructive/90">Delete</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function SiteFundBudgetPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { log } = useActivityLogger(MODULE);
  const { toast } = useToast();
  const { user } = useAuth();

  const canViewAll = can('View',   `${MODULE}.All Projects`);
  const canAdd     = can('Add',    `${MODULE}.${RESOURCE}`);
  const canEdit    = can('Edit',   `${MODULE}.${RESOURCE}`);
  const canDelete  = can('Delete', `${MODULE}.${RESOURCE}`);
  const canExport  = can('Export', `${MODULE}.${RESOURCE}`);

  // ── Data ─────────────────────────────────────────────────────────────────────
  const [projects,    setProjects]    = useState<SASProject[]>([]);
  const [allBudgets,  setAllBudgets]  = useState<SASBudget[]>([]);
  const [allExpenses, setAllExpenses] = useState<SASExpense[]>([]);
  const [allPayments, setAllPayments] = useState<SASPayment[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [saving,      setSaving]      = useState(false);
  const [exporting,   setExporting]   = useState(false);

  // ── Tree expand state ─────────────────────────────────────────────────────────
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [expandedFYs,      setExpandedFYs]      = useState<Set<string>>(new Set());
  const [initialized,      setInitialized]      = useState(false);

  // ── Dialog state ──────────────────────────────────────────────────────────────
  const [dialogOpen,    setDialogOpen]    = useState(false);
  const [editingBudget, setEditingBudget] = useState<SASBudget | null>(null);
  const [dialogTab,     setDialogTab]     = useState<BudgetTab>('total');
  const [dialogFYStart, setDialogFYStart] = useState(currentFYStart);
  const [dialogMonth,   setDialogMonth]   = useState(currentMonthStr);
  const [form,          setForm]          = useState<FormState>(blank());

  useEffect(() => { if (!isAuthLoading) void loadAll(); }, [isAuthLoading]);

  async function loadAll() {
    setLoading(true);
    try {
      const [pSnap, bSnap, eSnap, paySnap] = await Promise.all([
        getDocs(query(collection(db, SAS_COLLECTIONS.projects), orderBy('projectName'))),
        getDocs(query(collection(db, SAS_COLLECTIONS.budgets))),
        getDocs(query(collection(db, SAS_COLLECTIONS.expenses))),
        getDocs(query(collection(db, SAS_COLLECTIONS.payments))),
      ]);
      setProjects(pSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASProject)).filter(p => p.enabledForSiteAccount && p.status === 'Active'));
      setAllBudgets(bSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASBudget)));
      setAllExpenses(eSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASExpense)));
      setAllPayments(paySnap.docs.map(d => ({ id: d.id, ...d.data() } as SASPayment)));
    } finally {
      setLoading(false);
    }
  }

  const visibleProjects = useMemo(
    () => canViewAll ? projects : projects.filter(p =>
      p.assignedPersonId === user?.id || p.altUserId === user?.id || p.viewerId === user?.id
    ),
    [projects, user?.id, canViewAll]
  );

  const isAltUser        = useMemo(() => !canViewAll && visibleProjects.some(p => p.altUserId === user?.id), [canViewAll, visibleProjects, user?.id]);
  const effectiveCanAdd  = canAdd  || isAltUser;
  const effectiveCanEdit = canEdit || isAltUser;

  // Auto-expand all projects + current FY on first load
  useEffect(() => {
    if (!loading && !initialized && visibleProjects.length > 0) {
      setExpandedProjects(new Set(visibleProjects.map(p => p.id)));
      const curFY = fyLabel(currentFYStart());
      setExpandedFYs(new Set(visibleProjects.map(p => `${p.id}:${curFY}`)));
      setInitialized(true);
    }
  }, [loading, initialized, visibleProjects]);

  // ── Summary cards (total-budget level only) ───────────────────────────────────
  const summary = useMemo(() => {
    const ids = new Set(visibleProjects.map(p => p.id));
    const budget   = allBudgets.filter(b => b.budgetType === 'total' && ids.has(b.projectId)).reduce((s, b) => s + b.budgetAmount, 0);
    const spent    = allExpenses.filter(e => ids.has(e.projectId)).reduce((s, e) => s + (e.expenseAmount || 0), 0);
    const received = allPayments.filter(p => ids.has(p.projectId)).reduce((s, p) => s + (p.receivedAmount || 0), 0);
    const overCount = [...ids].filter(id => {
      const b = allBudgets.find(b => b.projectId === id && b.budgetType === 'total');
      const s = allExpenses.filter(e => e.projectId === id).reduce((sum, e) => sum + (e.expenseAmount || 0), 0);
      return b && s > b.budgetAmount;
    }).length;
    return { budget, spent, received, overCount };
  }, [visibleProjects, allBudgets, allExpenses, allPayments]);

  // ── Tree helpers ──────────────────────────────────────────────────────────────
  function getRelevantFYs(projectId: string): number[] {
    const fySet = new Set<number>([currentFYStart()]);
    allBudgets.filter(b => b.projectId === projectId).forEach(b => {
      if (b.budgetType === 'fy'      && b.period) fySet.add(parseInt(b.period.split('-')[0]));
      if (b.budgetType === 'monthly' && b.period) fySet.add(getFYStartFromDate(b.period + '-01'));
    });
    allExpenses.filter(e => e.projectId === projectId).forEach(e => fySet.add(getFYStartFromDate(e.expenseDate)));
    return [...fySet].sort((a, b) => b - a); // newest first
  }

  function getRelevantMonths(projectId: string, fyStartYear: number): string[] {
    const cur = currentMonthStr();
    return getFYMonths(fyStartYear).filter(m =>
      m === cur ||
      allBudgets.some(b => b.projectId === projectId && b.budgetType === 'monthly' && b.period === m) ||
      allExpenses.some(e => e.projectId === projectId && e.expenseDate.startsWith(m))
    );
  }

  function toggleProject(id: string) {
    setExpandedProjects(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleFY(key: string) {
    setExpandedFYs(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  }

  // ── Dialog helpers ────────────────────────────────────────────────────────────
  function openAdd(project?: SASProject, tab: BudgetTab = 'total', fyStartYear?: number, month?: string) {
    setEditingBudget(null);
    setDialogTab(tab);
    if (fyStartYear !== undefined) setDialogFYStart(fyStartYear);
    if (month       !== undefined) setDialogMonth(month);
    setForm(project ? { projectId: project.id, projectName: project.projectName, budgetAmount: '', notes: '' } : blank());
    setDialogOpen(true);
  }

  function openEdit(budget: SASBudget) {
    setEditingBudget(budget);
    setDialogTab(budget.budgetType);
    if (budget.budgetType === 'fy'      && budget.period) setDialogFYStart(parseInt(budget.period.split('-')[0]));
    if (budget.budgetType === 'monthly' && budget.period) setDialogMonth(budget.period);
    setForm({ projectId: budget.projectId, projectName: budget.projectName, budgetAmount: String(budget.budgetAmount), notes: budget.notes || '' });
    setDialogOpen(true);
  }

  async function handleSubmit() {
    if (!form.projectId) { toast({ title: 'Validation', description: 'Select a project.', variant: 'destructive' }); return; }
    const amount = Number(form.budgetAmount);
    if (!amount || amount <= 0) { toast({ title: 'Validation', description: 'Enter a valid budget amount.', variant: 'destructive' }); return; }

    const period = dialogTab === 'monthly' ? dialogMonth : dialogTab === 'fy' ? fyLabel(dialogFYStart) : undefined;

    if (!editingBudget) {
      const dup = allBudgets.find(b => b.projectId === form.projectId && b.budgetType === dialogTab && b.period === period);
      if (dup) { toast({ title: 'Already exists', description: 'A budget already exists for this project and period. Edit it instead.', variant: 'destructive' }); return; }
    }

    setSaving(true);
    try {
      const data: Record<string, any> = {
        projectId: form.projectId, projectName: form.projectName,
        budgetType: dialogTab, budgetAmount: amount,
        notes: form.notes.trim(), updatedAt: serverTimestamp(),
      };
      if (period !== undefined) data.period = period;

      if (editingBudget) {
        await updateDoc(doc(db, SAS_COLLECTIONS.budgets, editingBudget.id), data);
        void log('Edit SAS Budget', { project: form.projectName, type: dialogTab, period, amount });
        toast({ title: 'Updated', description: 'Budget updated.' });
      } else {
        await addDoc(collection(db, SAS_COLLECTIONS.budgets), { ...data, createdAt: serverTimestamp() });
        void log('Add SAS Budget', { project: form.projectName, type: dialogTab, period, amount });
        toast({ title: 'Saved', description: 'Budget saved.' });
      }
      setDialogOpen(false);
      void loadAll();
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(budget: SASBudget) {
    try {
      await deleteDoc(doc(db, SAS_COLLECTIONS.budgets, budget.id));
      void log('Delete SAS Budget', { project: budget.projectName, type: budget.budgetType, period: budget.period });
      toast({ title: 'Deleted', description: 'Budget deleted.' });
      void loadAll();
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
  }

  // ── Export ────────────────────────────────────────────────────────────────────
  async function exportExcel() {
    setExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Budget Tree');
      ws.columns = [
        { header: 'Level',          key: 'level',     width: 14 },
        { header: 'Name',           key: 'name',      width: 35 },
        { header: 'Budget (₹)',     key: 'budget',    width: 16 },
        { header: 'Received (₹)',   key: 'received',  width: 16 },
        { header: 'Spent (₹)',      key: 'spent',     width: 16 },
        { header: 'Remaining (₹)', key: 'remaining', width: 16 },
        { header: '% Used',         key: 'pctUsed',   width: 12 },
        { header: 'Status',         key: 'status',    width: 14 },
        { header: 'Notes',          key: 'notes',     width: 30 },
      ];
      ws.getRow(1).font = { bold: true };

      const allFYStarts = [...new Set([
        ...allBudgets.filter(b => b.budgetType === 'fy'      && b.period).map(b => parseInt(b.period!.split('-')[0])),
        ...allBudgets.filter(b => b.budgetType === 'monthly' && b.period).map(b => getFYStartFromDate(b.period! + '-01')),
        currentFYStart(),
      ])].sort((a, b) => b - a);

      for (const project of visibleProjects) {
        const pExp = allExpenses.filter(e => e.projectId === project.id);
        const pPay = allPayments.filter(p => p.projectId === project.id);
        const tb   = allBudgets.find(b => b.projectId === project.id && b.budgetType === 'total');
        const tSpent = pExp.reduce((s, e) => s + (e.expenseAmount || 0), 0);
        const tRcvd  = pPay.reduce((s, p) => s + (p.receivedAmount || 0), 0);
        const tAmt   = tb?.budgetAmount ?? 0;
        const tRow = ws.addRow({
          level: 'Total', name: project.projectName,
          budget: tAmt, received: tRcvd, spent: tSpent,
          remaining: tAmt > 0 ? tAmt - tSpent : '—',
          pctUsed: tAmt > 0 ? formatPct((tSpent / tAmt) * 100) : '—',
          status: !tb ? 'No Budget' : tSpent > tAmt ? 'Over Budget' : (tSpent / tAmt) * 100 >= 80 ? 'Warning' : 'On Track',
          notes: tb?.notes || '',
        });
        tRow.font = { bold: true };

        for (const fyS of allFYStarts) {
          const r   = fyRange(fyS);
          const fyB = allBudgets.find(b => b.projectId === project.id && b.budgetType === 'fy' && b.period === fyLabel(fyS));
          const fySpent = pExp.filter(e => e.expenseDate >= r.start && e.expenseDate <= r.end).reduce((s, e) => s + (e.expenseAmount || 0), 0);
          const fyRcvd  = pPay.filter(p => p.receiptDate >= r.start && p.receiptDate <= r.end).reduce((s, p) => s + (p.receivedAmount || 0), 0);
          if (!fyB && fySpent === 0) continue;
          const fAmt = fyB?.budgetAmount ?? 0;
          ws.addRow({
            level: `FY ${fyLabel(fyS)}`, name: `  FY ${fyLabel(fyS)}`,
            budget: fAmt || '—', received: fyRcvd, spent: fySpent,
            remaining: fAmt > 0 ? fAmt - fySpent : '—',
            pctUsed: fAmt > 0 ? formatPct((fySpent / fAmt) * 100) : '—',
            status: !fyB ? 'No Budget' : fySpent > fAmt ? 'Over Budget' : (fySpent / fAmt) * 100 >= 80 ? 'Warning' : 'On Track',
            notes: fyB?.notes || '',
          });

          for (const m of getFYMonths(fyS)) {
            const mB = allBudgets.find(b => b.projectId === project.id && b.budgetType === 'monthly' && b.period === m);
            const mSpent = pExp.filter(e => e.expenseDate.startsWith(m)).reduce((s, e) => s + (e.expenseAmount || 0), 0);
            const mRcvd  = pPay.filter(p => p.receiptDate.startsWith(m)).reduce((s, p) => s + (p.receivedAmount || 0), 0);
            if (!mB && mSpent === 0) continue;
            const mAmt = mB?.budgetAmount ?? 0;
            ws.addRow({
              level: monthLabel(m), name: `    ${monthLabel(m)}`,
              budget: mAmt || '—', received: mRcvd, spent: mSpent,
              remaining: mAmt > 0 ? mAmt - mSpent : '—',
              pctUsed: mAmt > 0 ? formatPct((mSpent / mAmt) * 100) : '—',
              status: !mB ? 'No Budget' : mSpent > mAmt ? 'Over Budget' : (mSpent / mAmt) * 100 >= 80 ? 'Warning' : 'On Track',
              notes: mB?.notes || '',
            });
          }
        }
      }

      const buf = await wb.xlsx.writeBuffer();
      const url = URL.createObjectURL(new Blob([buf]));
      const a = document.createElement('a'); a.href = url; a.download = 'site-fund-budget.xlsx'; a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  if (isAuthLoading || loading) {
    return <div className="space-y-3">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)}</div>;
  }

  const curMonth = currentMonthStr();
  const curFYStart = currentFYStart();

  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-bold text-slate-800">Site Fund Budget</h1>
          <p className="text-sm text-muted-foreground">Hierarchical tracking — Total → FY-wise → Month-wise per project</p>
        </div>
        <div className="flex gap-2">
          {canExport && (
            <Button variant="outline" size="sm" onClick={exportExcel} disabled={exporting} className="gap-2">
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Export
            </Button>
          )}
          {effectiveCanAdd && (
            <Button size="sm" onClick={() => openAdd()} className="gap-2 bg-emerald-700 hover:bg-emerald-800">
              <Plus className="h-4 w-4" /> Set Budget
            </Button>
          )}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="flex items-center gap-2.5 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2.5">
          <Target className="h-4 w-4 shrink-0 text-emerald-700" />
          <div className="min-w-0">
            <p className="text-[10px] font-medium text-emerald-700 uppercase tracking-wide">Total Budget</p>
            <p className="text-sm font-bold text-emerald-800 leading-tight">{formatINR(summary.budget)}</p>
          </div>
        </div>
        <div className="flex items-center gap-2.5 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2.5">
          <TrendingUp className="h-4 w-4 shrink-0 text-blue-600" />
          <div className="min-w-0">
            <p className="text-[10px] font-medium text-blue-600 uppercase tracking-wide">Total Received</p>
            <p className="text-sm font-bold text-blue-700 leading-tight">{formatINR(summary.received)}</p>
          </div>
        </div>
        <div className="flex items-center gap-2.5 rounded-xl border border-rose-100 bg-rose-50 px-3 py-2.5">
          <TrendingDown className="h-4 w-4 shrink-0 text-rose-600" />
          <div className="min-w-0">
            <p className="text-[10px] font-medium text-rose-600 uppercase tracking-wide">Total Spent</p>
            <p className="text-sm font-bold text-rose-700 leading-tight">{formatINR(summary.spent)}</p>
          </div>
        </div>
        <div className="flex items-center gap-2.5 rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-2.5">
          <Wallet className="h-4 w-4 shrink-0 text-indigo-600" />
          <div className="min-w-0">
            <p className="text-[10px] font-medium text-indigo-600 uppercase tracking-wide">Remaining</p>
            <p className={cn('text-sm font-bold leading-tight', (summary.budget - summary.spent) >= 0 ? 'text-indigo-700' : 'text-destructive')}>
              {formatINR(summary.budget - summary.spent)}
            </p>
          </div>
        </div>
      </div>

      {/* ── Tree table ── */}
      <Card className="bg-white/80 backdrop-blur-sm">
        <CardContent className="p-0">
          {visibleProjects.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <Target className="h-10 w-10 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">No active projects found.</p>
            </div>
          ) : (
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10">
                  <tr className="border-b bg-slate-100">
                    <th className="px-4 py-2.5 text-left font-medium min-w-[220px]">Project / Period</th>
                    <th className="px-4 py-2.5 text-right font-medium whitespace-nowrap">Budget (₹)</th>
                    <th className="px-4 py-2.5 text-right font-medium whitespace-nowrap">Spent (₹)</th>
                    <th className="px-4 py-2.5 text-right font-medium whitespace-nowrap">Remaining (₹)</th>
                    <th className="px-4 py-2.5 text-left font-medium min-w-[130px]">Usage</th>
                    <th className="px-4 py-2.5 text-left font-medium">Status</th>
                    {(effectiveCanEdit || canDelete) && <th className="px-4 py-2.5 text-right font-medium">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {visibleProjects.map(project => {
                    const totalBudget = allBudgets.find(b => b.projectId === project.id && b.budgetType === 'total') ?? null;
                    const pExp    = allExpenses.filter(e => e.projectId === project.id);
                    const pPay    = allPayments.filter(p => p.projectId === project.id);
                    const tSpent  = pExp.reduce((s, e) => s + (e.expenseAmount  || 0), 0);
                    const tAmt    = totalBudget?.budgetAmount ?? 0;
                    const tPct    = tAmt > 0 ? Math.min((tSpent / tAmt) * 100, 100) : 0;
                    const isExpanded = expandedProjects.has(project.id);
                    const fys = getRelevantFYs(project.id);

                    return (
                      <Fragment key={project.id}>

                        {/* ══ Level 0 — Project ══ */}
                        <tr className={cn('border-b transition-colors', isExpanded ? 'bg-emerald-50/50' : 'bg-white hover:bg-muted/10')}>
                          <td className="px-4 py-3">
                            <button onClick={() => toggleProject(project.id)} className="flex items-center gap-2 font-semibold text-slate-800 hover:text-emerald-700 transition-colors">
                              {isExpanded
                                ? <ChevronDown  className="h-4 w-4 text-emerald-600 shrink-0" />
                                : <ChevronRight className="h-4 w-4 text-slate-400 shrink-0" />}
                              {project.projectName}
                              {project.projectCode && (
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-emerald-200 text-emerald-600 font-normal">
                                  {project.projectCode}
                                </Badge>
                              )}
                            </button>
                          </td>
                          <td className="px-4 py-3 text-right font-semibold text-emerald-700">
                            {totalBudget ? formatINR(tAmt) : <span className="text-muted-foreground text-xs">—</span>}
                          </td>
                          <td className="px-4 py-3 text-right text-rose-700 font-medium">{formatINR(tSpent)}</td>
                          <td className={cn('px-4 py-3 text-right font-semibold', !totalBudget ? 'text-muted-foreground' : tAmt - tSpent < 0 ? 'text-destructive' : 'text-indigo-700')}>
                            {totalBudget ? formatINR(tAmt - tSpent) : '—'}
                          </td>
                          <td className="px-4 py-3">
                            {totalBudget ? (
                              <div className="space-y-1 min-w-[110px]">
                                <Progress value={tPct} className="h-2" />
                                <p className="text-xs text-muted-foreground">{formatPct(tPct)}</p>
                              </div>
                            ) : <span className="text-xs text-muted-foreground">—</span>}
                          </td>
                          <td className="px-4 py-3"><StatusBadge budget={totalBudget} spent={tSpent} /></td>
                          {(effectiveCanEdit || canDelete) && (
                            <td className="px-4 py-3 text-right">
                              <div className="flex justify-end gap-1">
                                {effectiveCanEdit && (
                                  totalBudget
                                    ? <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(totalBudget)}><Pencil className="h-3.5 w-3.5" /></Button>
                                    : <Button variant="outline" size="sm" className="h-7 text-xs gap-1 text-emerald-700 border-emerald-200 hover:bg-emerald-50" onClick={() => openAdd(project, 'total')}><Plus className="h-3 w-3" />Set Total</Button>
                                )}
                                {canDelete && totalBudget && (
                                  <DeleteConfirm label={`Remove total budget for ${project.projectName}?`} onConfirm={() => handleDelete(totalBudget)} />
                                )}
                              </div>
                            </td>
                          )}
                        </tr>

                        {/* ══ Level 1 — FY rows ══ */}
                        {isExpanded && fys.map(fyS => {
                          const fyKey   = `${project.id}:${fyLabel(fyS)}`;
                          const isFYExp = expandedFYs.has(fyKey);
                          const r       = fyRange(fyS);
                          const fyB     = allBudgets.find(b => b.projectId === project.id && b.budgetType === 'fy' && b.period === fyLabel(fyS)) ?? null;
                          const fySpent = pExp.filter(e => e.expenseDate >= r.start && e.expenseDate <= r.end).reduce((s, e) => s + (e.expenseAmount || 0), 0);
                          const fAmt    = fyB?.budgetAmount ?? 0;
                          const fyPct   = fAmt > 0 ? Math.min((fySpent / fAmt) * 100, 100) : 0;
                          const isCurFY = fyS === curFYStart;
                          const months  = getRelevantMonths(project.id, fyS);

                          return (
                            <Fragment key={fyKey}>

                              {/* FY row */}
                              <tr className={cn('border-b transition-colors', isFYExp ? 'bg-blue-50/30' : 'bg-slate-50/60 hover:bg-muted/10')}>
                                <td className="pl-10 pr-4 py-2.5">
                                  <button onClick={() => toggleFY(fyKey)} className="flex items-center gap-2 font-medium text-slate-700 hover:text-blue-700 transition-colors">
                                    {months.length > 0
                                      ? isFYExp
                                        ? <ChevronDown  className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                                        : <ChevronRight className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                                      : <span className="w-3.5 h-3.5 shrink-0" />}
                                    <Target className="h-3 w-3 text-emerald-600 shrink-0" />
                                    <span>FY {fyLabel(fyS)}</span>
                                    {isCurFY && <Badge className="text-[9px] px-1.5 py-0 bg-blue-100 text-blue-700 hover:bg-blue-100 font-normal">Current FY</Badge>}
                                  </button>
                                </td>
                                <td className="px-4 py-2.5 text-right font-medium text-emerald-700">
                                  {fyB ? formatINR(fAmt) : <span className="text-muted-foreground text-xs">—</span>}
                                </td>
                                <td className="px-4 py-2.5 text-right text-rose-700">{fySpent > 0 ? formatINR(fySpent) : <span className="text-muted-foreground text-xs">—</span>}</td>
                                <td className={cn('px-4 py-2.5 text-right font-medium', !fyB ? 'text-muted-foreground' : fAmt - fySpent < 0 ? 'text-destructive' : 'text-indigo-700')}>
                                  {fyB ? formatINR(fAmt - fySpent) : '—'}
                                </td>
                                <td className="px-4 py-2.5">
                                  {fyB ? (
                                    <div className="space-y-1 min-w-[110px]">
                                      <Progress value={fyPct} className="h-1.5" />
                                      <p className="text-xs text-muted-foreground">{formatPct(fyPct)}</p>
                                    </div>
                                  ) : <span className="text-xs text-muted-foreground">—</span>}
                                </td>
                                <td className="px-4 py-2.5"><StatusBadge budget={fyB} spent={fySpent} /></td>
                                {(effectiveCanEdit || canDelete) && (
                                  <td className="px-4 py-2.5 text-right">
                                    <div className="flex justify-end gap-1">
                                      {effectiveCanEdit && (
                                        fyB
                                          ? <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(fyB)}><Pencil className="h-3 w-3" /></Button>
                                          : <Button variant="outline" size="sm" className="h-6 text-xs gap-0.5 text-emerald-700 border-emerald-200 hover:bg-emerald-50 px-2" onClick={() => openAdd(project, 'fy', fyS)}><Plus className="h-2.5 w-2.5" />Set</Button>
                                      )}
                                      {canDelete && fyB && (
                                        <DeleteConfirm label={`Remove FY ${fyLabel(fyS)} budget for ${project.projectName}?`} onConfirm={() => handleDelete(fyB)} size="sm" />
                                      )}
                                    </div>
                                  </td>
                                )}
                              </tr>

                              {/* ══ Level 2 — Month rows ══ */}
                              {isFYExp && months.map(m => {
                                const mB      = allBudgets.find(b => b.projectId === project.id && b.budgetType === 'monthly' && b.period === m) ?? null;
                                const mSpent  = pExp.filter(e => e.expenseDate.startsWith(m)).reduce((s, e) => s + (e.expenseAmount || 0), 0);
                                const mAmt    = mB?.budgetAmount ?? 0;
                                const mPct    = mAmt > 0 ? Math.min((mSpent / mAmt) * 100, 100) : 0;
                                const isCurMo = m === curMonth;

                                return (
                                  <tr key={m} className={cn('border-b transition-colors', isCurMo ? 'bg-amber-50/40' : 'bg-white/50 hover:bg-muted/10')}>
                                    <td className="pl-16 pr-4 py-2">
                                      <div className="flex items-center gap-2 text-slate-600">
                                        <Calendar className="h-3 w-3 text-slate-400 shrink-0" />
                                        <span className="text-xs">{monthLabel(m)}</span>
                                        {isCurMo && <Badge className="text-[9px] px-1.5 py-0 bg-amber-100 text-amber-700 hover:bg-amber-100 font-normal">This Month</Badge>}
                                      </div>
                                    </td>
                                    <td className="px-4 py-2 text-right text-xs font-medium text-emerald-700">
                                      {mB ? formatINR(mAmt) : <span className="text-muted-foreground">—</span>}
                                    </td>
                                    <td className="px-4 py-2 text-right text-xs text-rose-700">
                                      {mSpent > 0 ? formatINR(mSpent) : <span className="text-muted-foreground">—</span>}
                                    </td>
                                    <td className={cn('px-4 py-2 text-right text-xs font-medium', !mB ? 'text-muted-foreground' : mAmt - mSpent < 0 ? 'text-destructive' : 'text-indigo-700')}>
                                      {mB ? formatINR(mAmt - mSpent) : '—'}
                                    </td>
                                    <td className="px-4 py-2">
                                      {mB ? (
                                        <div className="space-y-0.5 min-w-[110px]">
                                          <Progress value={mPct} className="h-1.5" />
                                          <p className="text-[11px] text-muted-foreground">{formatPct(mPct)}</p>
                                        </div>
                                      ) : <span className="text-xs text-muted-foreground">—</span>}
                                    </td>
                                    <td className="px-4 py-2"><StatusBadge budget={mB} spent={mSpent} /></td>
                                    {(effectiveCanEdit || canDelete) && (
                                      <td className="px-4 py-2 text-right">
                                        <div className="flex justify-end gap-1">
                                          {effectiveCanEdit && (
                                            mB
                                              ? <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openEdit(mB)}><Pencil className="h-3 w-3" /></Button>
                                              : <Button variant="outline" size="sm" className="h-6 text-[11px] gap-0.5 text-emerald-700 border-emerald-200 hover:bg-emerald-50 px-2" onClick={() => openAdd(project, 'monthly', fyS, m)}><Plus className="h-2.5 w-2.5" />Set</Button>
                                          )}
                                          {canDelete && mB && (
                                            <DeleteConfirm label={`Remove ${monthLabel(m)} budget for ${project.projectName}?`} onConfirm={() => handleDelete(mB)} size="sm" />
                                          )}
                                        </div>
                                      </td>
                                    )}
                                  </tr>
                                );
                              })}
                            </Fragment>
                          );
                        })}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Over-budget callout */}
      {summary.overCount > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <TrendingDown className="h-4 w-4 shrink-0" />
          <span>
            <strong>{summary.overCount} project{summary.overCount > 1 ? 's' : ''}</strong> {summary.overCount > 1 ? 'have' : 'has'} exceeded the total allocated budget.
          </span>
        </div>
      )}

      {/* ── Add / Edit Dialog ── */}
      <Dialog open={dialogOpen} onOpenChange={open => { if (!open && !saving) setDialogOpen(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingBudget ? 'Edit Budget' : 'Set Budget'}
              {' — '}
              {dialogTab === 'total'   ? 'Total (All-time)'
               : dialogTab === 'monthly' ? monthLabel(dialogMonth)
               : `FY ${fyLabel(dialogFYStart)}`}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">

            {/* Budget type tabs (add mode only) */}
            {!editingBudget && (
              <div className="space-y-2">
                <Label>Budget Type</Label>
                <Tabs value={dialogTab} onValueChange={v => setDialogTab(v as BudgetTab)}>
                  <TabsList className="grid w-full grid-cols-3">
                    <TabsTrigger value="total">Total</TabsTrigger>
                    <TabsTrigger value="fy">FY-wise</TabsTrigger>
                    <TabsTrigger value="monthly">Monthly</TabsTrigger>
                  </TabsList>
                </Tabs>

                {/* FY period picker */}
                {dialogTab === 'fy' && (
                  <div className="flex items-center gap-2 pt-0.5">
                    <Button variant="outline" size="sm" className="h-7 px-2" onClick={() => setDialogFYStart(y => y - 1)}>
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </Button>
                    <span className="text-sm font-medium min-w-[90px] text-center">FY {fyLabel(dialogFYStart)}</span>
                    <Button variant="outline" size="sm" className="h-7 px-2" onClick={() => setDialogFYStart(y => y + 1)}>
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                    <span className="text-xs text-muted-foreground">Apr {dialogFYStart} – Mar {dialogFYStart + 1}</span>
                  </div>
                )}

                {/* Monthly period picker */}
                {dialogTab === 'monthly' && (
                  <div className="flex items-center gap-2 pt-0.5">
                    <Button variant="outline" size="sm" className="h-7 px-2" onClick={() => setDialogMonth(m => shiftMonth(m, -1))}>
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </Button>
                    <span className="text-sm font-medium min-w-[130px] text-center">{monthLabel(dialogMonth)}</span>
                    <Button variant="outline" size="sm" className="h-7 px-2" onClick={() => setDialogMonth(m => shiftMonth(m, 1))}>
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}

                <p className="text-xs text-muted-foreground">
                  {dialogTab === 'total'
                    ? 'Covers all-time expenses for this project.'
                    : dialogTab === 'monthly'
                    ? `Covers expenses in ${monthLabel(dialogMonth)}.`
                    : `Covers expenses in FY ${fyLabel(dialogFYStart)} (Apr ${dialogFYStart} – Mar ${dialogFYStart + 1}).`}
                </p>
              </div>
            )}

            {/* Project select */}
            <div className="space-y-1.5">
              <Label>Project <span className="text-destructive">*</span></Label>
              <Select
                value={form.projectId}
                onValueChange={id => {
                  const p = visibleProjects.find(p => p.id === id);
                  setForm(f => ({ ...f, projectId: id, projectName: p?.projectName || '' }));
                }}
                disabled={!!editingBudget}
              >
                <SelectTrigger><SelectValue placeholder="Select project" /></SelectTrigger>
                <SelectContent>
                  {visibleProjects.map(p => <SelectItem key={p.id} value={p.id}>{p.projectName}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* Amount */}
            <div className="space-y-1.5">
              <Label>Budget Amount (₹) <span className="text-destructive">*</span></Label>
              <Input
                type="number" min="0"
                value={form.budgetAmount}
                onChange={e => setForm(f => ({ ...f, budgetAmount: e.target.value }))}
                placeholder="Enter budget amount"
              />
            </div>

            {/* Notes */}
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional notes" />
            </div>

            {/* Live preview (edit mode) */}
            {editingBudget && (() => {
              const newAmt = Number(form.budgetAmount) || 0;
              if (!newAmt) return null;
              const pExp = allExpenses.filter(e => e.projectId === form.projectId);
              let spent = 0;
              if (editingBudget.budgetType === 'total') {
                spent = pExp.reduce((s, e) => s + (e.expenseAmount || 0), 0);
              } else if (editingBudget.budgetType === 'fy' && editingBudget.period) {
                const fyS = parseInt(editingBudget.period.split('-')[0]);
                const r = fyRange(fyS);
                spent = pExp.filter(e => e.expenseDate >= r.start && e.expenseDate <= r.end).reduce((s, e) => s + (e.expenseAmount || 0), 0);
              } else if (editingBudget.budgetType === 'monthly' && editingBudget.period) {
                spent = pExp.filter(e => e.expenseDate.startsWith(editingBudget.period!)).reduce((s, e) => s + (e.expenseAmount || 0), 0);
              }
              const newRem = newAmt - spent;
              const newPct = Math.min((spent / newAmt) * 100, 100);
              return (
                <div className="rounded-lg border bg-slate-50 px-3 py-2.5 space-y-1.5 text-xs">
                  <p className="font-medium text-slate-700">Preview</p>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div><p className="text-muted-foreground">Budget</p><p className="font-semibold">{formatINR(newAmt)}</p></div>
                    <div><p className="text-muted-foreground">Spent</p><p className="font-semibold text-rose-600">{formatINR(spent)}</p></div>
                    <div><p className="text-muted-foreground">Remaining</p><p className={cn('font-semibold', newRem >= 0 ? 'text-emerald-700' : 'text-destructive')}>{formatINR(newRem)}</p></div>
                  </div>
                  <Progress value={newPct} className="h-1.5" />
                  <p className="text-muted-foreground text-center">{formatPct(newPct)} used</p>
                </div>
              );
            })()}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={saving} className="bg-emerald-700 hover:bg-emerald-800 min-w-[110px]">
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {editingBudget ? 'Save Changes' : 'Save Budget'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
