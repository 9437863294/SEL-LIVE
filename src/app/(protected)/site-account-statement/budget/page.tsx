'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  addDoc, collection, deleteDoc, doc, getDocs, orderBy, query, serverTimestamp, updateDoc,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { storage } from '@/lib/firebase';
import { deleteObject, getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import {
  formatINR, SAS_COLLECTIONS,
  type SASBudget, type SASBudgetApproval, type SASCategory, type SASCategoryBudget,
  type SASExpense, type SASPayment, type SASProject,
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
  Calendar, ChevronDown, ChevronLeft, ChevronRight, Download, FileText, Filter, Layers, Loader2,
  Pencil, Plus, Search, ShieldAlert, Target, Trash2, TrendingDown, TrendingUp, Upload, Wallet, X,
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

interface UploadRow {
  rowNum: number;
  projectName: string;
  projectId: string;   // empty string if not matched
  period: string;      // YYYY-MM, empty if invalid
  amount: number;
  notes: string;
  valid: boolean;
  error: string;
}

// ── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ budget, spent }: { budget: SASBudget | null; spent: number }) {
  if (!budget) return <Badge variant="outline" className="text-xs text-muted-foreground">No Budget</Badge>;
  const pct = budget.budgetAmount > 0 ? (spent / budget.budgetAmount) * 100 : 0;
  if (spent > budget.budgetAmount) return <Badge variant="destructive" className="text-xs">Over Budget</Badge>;
  if (pct >= 80) return <Badge className="text-xs bg-amber-500 hover:bg-amber-500">Warning</Badge>;
  return <Badge className="text-xs bg-emerald-600 hover:bg-emerald-600">On Track</Badge>;
}

function CatStatusBadge({ budget, spent }: { budget: SASCategoryBudget | undefined; spent: number }) {
  if (!budget) return <Badge variant="outline" className="text-[10px] px-1.5 text-muted-foreground">—</Badge>;
  const pct = budget.budgetAmount > 0 ? (spent / budget.budgetAmount) * 100 : 0;
  if (spent > budget.budgetAmount) return <Badge variant="destructive" className="text-[10px] px-1.5">Over</Badge>;
  if (pct >= 80) return <Badge className="text-[10px] px-1.5 bg-amber-500 hover:bg-amber-500">Near</Badge>;
  return <Badge className="text-[10px] px-1.5 bg-emerald-600 hover:bg-emerald-600">OK</Badge>;
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
  const canView    = can('View', `${MODULE}.${RESOURCE}`);
  const canAdd     = can('Add',    `${MODULE}.${RESOURCE}`);
  const canEdit    = can('Edit',   `${MODULE}.${RESOURCE}`);
  const canDelete  = can('Delete', `${MODULE}.${RESOURCE}`);
  const canExport  = can('Export', `${MODULE}.${RESOURCE}`);

  // ── Data ─────────────────────────────────────────────────────────────────────
  const [projects,     setProjects]     = useState<SASProject[]>([]);
  const [allBudgets,   setAllBudgets]   = useState<SASBudget[]>([]);
  const [allExpenses,  setAllExpenses]  = useState<SASExpense[]>([]);
  const [allPayments,  setAllPayments]  = useState<SASPayment[]>([]);
  const [categories,   setCategories]   = useState<SASCategory[]>([]);
  const [allCatBudgets,  setAllCatBudgets]  = useState<SASCategoryBudget[]>([]);
  const [allApprovals,   setAllApprovals]   = useState<SASBudgetApproval[]>([]);
  const [loading,        setLoading]        = useState(true);
  const [saving,       setSaving]       = useState(false);
  const [catSaving,    setCatSaving]    = useState(false);
  const [exporting,    setExporting]    = useState(false);

  // ── Tree expand state ─────────────────────────────────────────────────────────
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [expandedFYs,      setExpandedFYs]      = useState<Set<string>>(new Set());
  const [expandedMonths,   setExpandedMonths]   = useState<Set<string>>(new Set());
  const [initialized,      setInitialized]      = useState(false);

  // ── Budget dialog state ──────────────────────────────────────────────────────
  const [dialogOpen,    setDialogOpen]    = useState(false);
  const [editingBudget, setEditingBudget] = useState<SASBudget | null>(null);
  const [dialogTab,     setDialogTab]     = useState<BudgetTab>('total');
  const [dialogFYStart, setDialogFYStart] = useState(currentFYStart);
  const [dialogMonth,   setDialogMonth]   = useState(currentMonthStr);
  const [form,          setForm]          = useState<FormState>(blank());

  // ── Category budget dialog state (single-category edit) ─────────────────────
  const [catDialogOpen,     setCatDialogOpen]     = useState(false);
  const [catEditingBudget,  setCatEditingBudget]  = useState<SASCategoryBudget | null>(null);
  const [catDialogProject,  setCatDialogProject]  = useState<SASProject | null>(null);
  const [catDialogMonth,    setCatDialogMonth]    = useState('');
  const [catDialogCategory, setCatDialogCategory] = useState('');
  const [catDialogAmount,   setCatDialogAmount]   = useState('');
  const [catDialogNotes,    setCatDialogNotes]    = useState('');

  // ── Bulk category budget dialog state ────────────────────────────────────────
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false);
  const [bulkProject,    setBulkProject]    = useState<SASProject | null>(null);
  const [bulkMonth,      setBulkMonth]      = useState('');
  const [bulkAmounts,    setBulkAmounts]    = useState<Record<string, string>>({});
  const [bulkSaving,     setBulkSaving]     = useState(false);

  // ── Upload Approval Sheet (Excel import) state ───────────────────────────────
  const [uploadOpen,   setUploadOpen]   = useState(false);
  const [uploadRows,   setUploadRows]   = useState<UploadRow[]>([]);
  const [uploadSaving, setUploadSaving] = useState(false);

  // ── PDF approval upload state ─────────────────────────────────────────────────
  const [pdfUploadingKey, setPdfUploadingKey] = useState<string | null>(null); // "projectId:period"
  const pdfPendingKeyRef = useRef<string | null>(null); // sync ref for file input onChange

  // ── Table filters ─────────────────────────────────────────────────────────────
  const [filterSearch,  setFilterSearch]  = useState('');
  const [filterStatus,  setFilterStatus]  = useState<'all' | 'on-track' | 'warning' | 'over-budget' | 'no-budget'>('all');
  const [filterFY,      setFilterFY]      = useState<string>('all');

  useEffect(() => { if (!isAuthLoading) void loadAll(); }, [isAuthLoading]);

  async function loadAll() {
    setLoading(true);
    try {
      const [pSnap, bSnap, eSnap, paySnap, cSnap, cbSnap] = await Promise.all([
        getDocs(query(collection(db, SAS_COLLECTIONS.projects), orderBy('projectName'))),
        getDocs(query(collection(db, SAS_COLLECTIONS.budgets))),
        getDocs(query(collection(db, SAS_COLLECTIONS.expenses))),
        getDocs(query(collection(db, SAS_COLLECTIONS.payments))),
        getDocs(query(collection(db, SAS_COLLECTIONS.categories))),
        getDocs(collection(db, SAS_COLLECTIONS.categoryBudgets)),
      ]);
      setProjects(pSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASProject)).filter(p => p.enabledForSiteAccount && p.status === 'Active'));
      setAllBudgets(bSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASBudget)));
      setAllExpenses(eSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASExpense)));
      setAllPayments(paySnap.docs.map(d => ({ id: d.id, ...d.data() } as SASPayment)));
      setCategories(cSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASCategory)).filter(c => c.isActive !== false).sort((a, b) => a.name.localeCompare(b.name)));
      setAllCatBudgets(cbSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASCategoryBudget)));
    } finally {
      setLoading(false);
    }
    // Load budget approvals separately so a missing collection doesn't blank the page
    try {
      const appSnap = await getDocs(collection(db, SAS_COLLECTIONS.budgetApprovals));
      setAllApprovals(appSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASBudgetApproval)));
    } catch { /* collection may not exist yet */ }
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

  // Auto-expand all projects + current FY on first load; months stay collapsed until clicked
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
    const budget   = allBudgets.filter(b => b.budgetType === 'monthly' && ids.has(b.projectId)).reduce((s, b) => s + b.budgetAmount, 0);
    const spent    = allExpenses.filter(e => ids.has(e.projectId)).reduce((s, e) => s + (e.expenseAmount || 0), 0);
    const received = allPayments.filter(p => ids.has(p.projectId)).reduce((s, p) => s + (p.receivedAmount || 0), 0);
    const overCount = [...ids].filter(id => {
      const monthSum = allBudgets.filter(b => b.projectId === id && b.budgetType === 'monthly').reduce((s, b) => s + b.budgetAmount, 0);
      const spent = allExpenses.filter(e => e.projectId === id).reduce((s, e) => s + (e.expenseAmount || 0), 0);
      return monthSum > 0 && spent > monthSum;
    }).length;
    return { budget, spent, received, overCount };
  }, [visibleProjects, allBudgets, allExpenses, allPayments]);

  // ── Filter helpers ────────────────────────────────────────────────────────────
  const availableFYs = useMemo(() => {
    const fySet = new Set<number>([currentFYStart()]);
    allBudgets.filter(b => b.budgetType === 'monthly' && b.period).forEach(b => fySet.add(getFYStartFromDate(b.period! + '-01')));
    allExpenses.forEach(e => fySet.add(getFYStartFromDate(e.expenseDate)));
    return [...fySet].sort((a, b) => b - a);
  }, [allBudgets, allExpenses]);

  const filteredProjects = useMemo(() => {
    return visibleProjects.filter(p => {
      if (filterSearch && !p.projectName.toLowerCase().includes(filterSearch.toLowerCase()) &&
          !p.projectCode?.toLowerCase().includes(filterSearch.toLowerCase())) return false;
      if (filterFY !== 'all') {
        const fyStart = parseInt(filterFY);
        const fyMonths = getFYMonths(fyStart);
        const hasData = allBudgets.some(b => b.projectId === p.id && b.budgetType === 'monthly' && fyMonths.includes(b.period ?? '')) ||
                        allExpenses.some(e => e.projectId === p.id && fyMonths.some(m => e.expenseDate.startsWith(m)));
        if (!hasData) return false;
      }
      if (filterStatus !== 'all') {
        const monthSum = allBudgets.filter(b => b.projectId === p.id && b.budgetType === 'monthly').reduce((s, b) => s + b.budgetAmount, 0);
        const spent    = allExpenses.filter(e => e.projectId === p.id).reduce((s, e) => s + (e.expenseAmount || 0), 0);
        const pct      = monthSum > 0 ? (spent / monthSum) * 100 : 0;
        if (filterStatus === 'no-budget'    && monthSum > 0) return false;
        if (filterStatus === 'on-track'     && !(monthSum > 0 && pct < 80)) return false;
        if (filterStatus === 'warning'      && !(monthSum > 0 && pct >= 80 && spent <= monthSum)) return false;
        if (filterStatus === 'over-budget'  && !(monthSum > 0 && spent > monthSum)) return false;
      }
      return true;
    });
  }, [visibleProjects, filterSearch, filterFY, filterStatus, allBudgets, allExpenses]);

  const hasActiveFilters = filterSearch !== '' || filterStatus !== 'all' || filterFY !== 'all';

  // ── Tree helpers ──────────────────────────────────────────────────────────────
  function getRelevantFYs(projectId: string): number[] {
    const fySet = new Set<number>([currentFYStart()]);
    allBudgets.filter(b => b.projectId === projectId).forEach(b => {
      if (b.budgetType === 'fy'      && b.period) fySet.add(parseInt(b.period.split('-')[0]));
      if (b.budgetType === 'monthly' && b.period) fySet.add(getFYStartFromDate(b.period + '-01'));
    });
    allExpenses.filter(e => e.projectId === projectId).forEach(e => fySet.add(getFYStartFromDate(e.expenseDate)));
    allCatBudgets.filter(b => b.projectId === projectId && b.period).forEach(b => fySet.add(getFYStartFromDate(b.period + '-01')));
    return [...fySet].sort((a, b) => b - a);
  }

  function getRelevantMonths(projectId: string, fyStartYear: number): string[] {
    const cur = currentMonthStr();
    return getFYMonths(fyStartYear).filter(m =>
      m === cur ||
      allBudgets.some(b => b.projectId === projectId && b.budgetType === 'monthly' && b.period === m) ||
      allExpenses.some(e => e.projectId === projectId && e.expenseDate.startsWith(m)) ||
      allCatBudgets.some(b => b.projectId === projectId && b.period === m)
    );
  }

  // Returns sorted list of category names to show under a month
  function getMonthCategories(projectId: string, month: string): string[] {
    const names = new Set<string>();
    categories.forEach(c => { if (c.name) names.add(c.name); });
    allCatBudgets.filter(b => b.projectId === projectId && b.period === month).forEach(b => names.add(b.categoryName));
    allExpenses.filter(e => e.projectId === projectId && e.expenseDate?.startsWith(month)).forEach(e => {
      if (e.expenseCategory) names.add(e.expenseCategory);
    });
    return [...names].sort();
  }

  function toggleProject(id: string) {
    setExpandedProjects(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleFY(key: string) {
    setExpandedFYs(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  }
  function toggleMonth(key: string) {
    setExpandedMonths(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  }

  // ── Budget dialog helpers ─────────────────────────────────────────────────────
  function openAdd(project?: SASProject, tab: BudgetTab = 'monthly', fyStartYear?: number, month?: string) {
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
      if (dup) { toast({ title: 'Already exists', description: 'A budget already exists for this period. Edit it instead.', variant: 'destructive' }); return; }
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
        void log('Edit SAS Budget', { project: form.projectName, type: dialogTab, ...(period !== undefined && { period }), amount });
        toast({ title: 'Updated', description: 'Budget updated.' });
      } else {
        await addDoc(collection(db, SAS_COLLECTIONS.budgets), { ...data, createdAt: serverTimestamp() });
        void log('Add SAS Budget', { project: form.projectName, type: dialogTab, ...(period !== undefined && { period }), amount });
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

  // ── Bulk category budget helpers ─────────────────────────────────────────────
  function openBulkCatDialog(project: SASProject, month: string) {
    setBulkProject(project);
    setBulkMonth(month);
    // Pre-fill with existing budgets for this project+month
    const prefilled: Record<string, string> = {};
    allCatBudgets
      .filter(b => b.projectId === project.id && b.period === month)
      .forEach(b => { prefilled[b.categoryName] = String(b.budgetAmount); });
    setBulkAmounts(prefilled);
    setBulkDialogOpen(true);
  }

  async function handleBulkCatSave() {
    if (!bulkProject) return;
    const toSave = categories.filter(cat => {
      const v = bulkAmounts[cat.name];
      return v && Number(v) > 0;
    });
    if (toSave.length === 0) {
      toast({ title: 'Nothing to save', description: 'Enter a budget amount for at least one category.', variant: 'destructive' });
      return;
    }
    setBulkSaving(true);
    try {
      await Promise.all(toSave.map(async cat => {
        const amount = Number(bulkAmounts[cat.name]);
        const existing = allCatBudgets.find(b =>
          b.projectId === bulkProject.id && b.period === bulkMonth && b.categoryName === cat.name
        );
        if (existing) {
          await updateDoc(doc(db, SAS_COLLECTIONS.categoryBudgets, existing.id), {
            budgetAmount: amount, updatedAt: serverTimestamp(),
          });
        } else {
          await addDoc(collection(db, SAS_COLLECTIONS.categoryBudgets), {
            projectId:    bulkProject.id,
            projectName:  bulkProject.projectName,
            period:       bulkMonth,
            categoryId:   cat.id,
            categoryName: cat.name,
            budgetAmount: amount,
            notes:        '',
            createdAt:    serverTimestamp(),
            updatedAt:    serverTimestamp(),
          });
        }
      }));
      toast({ title: 'Saved', description: `Budgets set for ${toSave.length} categor${toSave.length > 1 ? 'ies' : 'y'} in ${monthLabel(bulkMonth)}.` });
      setBulkDialogOpen(false);
      void loadAll();
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setBulkSaving(false);
    }
  }

  // ── Category budget helpers ───────────────────────────────────────────────────
  function openCatAdd(project: SASProject, month: string, categoryName: string) {
    setCatEditingBudget(null);
    setCatDialogProject(project);
    setCatDialogMonth(month);
    setCatDialogCategory(categoryName);
    setCatDialogAmount('');
    setCatDialogNotes('');
    setCatDialogOpen(true);
  }

  function openCatEdit(budget: SASCategoryBudget) {
    setCatEditingBudget(budget);
    setCatDialogProject(projects.find(p => p.id === budget.projectId) || null);
    setCatDialogMonth(budget.period);
    setCatDialogCategory(budget.categoryName);
    setCatDialogAmount(String(budget.budgetAmount));
    setCatDialogNotes(budget.notes || '');
    setCatDialogOpen(true);
  }

  async function handleCatSubmit() {
    const amount = Number(catDialogAmount);
    if (!amount || amount <= 0) {
      toast({ title: 'Validation', description: 'Enter a valid budget amount.', variant: 'destructive' });
      return;
    }
    if (!catDialogProject) return;

    if (!catEditingBudget) {
      const dup = allCatBudgets.find(b =>
        b.projectId === catDialogProject.id &&
        b.period === catDialogMonth &&
        b.categoryName === catDialogCategory
      );
      if (dup) {
        toast({ title: 'Already exists', description: 'A budget for this category and month already exists. Edit it instead.', variant: 'destructive' });
        return;
      }
    }

    setCatSaving(true);
    try {
      const catDoc = categories.find(c => c.name === catDialogCategory);
      if (catEditingBudget) {
        await updateDoc(doc(db, SAS_COLLECTIONS.categoryBudgets, catEditingBudget.id), {
          budgetAmount: amount,
          notes: catDialogNotes.trim(),
          updatedAt: serverTimestamp(),
        });
        toast({ title: 'Updated', description: `${catDialogCategory} budget updated.` });
      } else {
        await addDoc(collection(db, SAS_COLLECTIONS.categoryBudgets), {
          projectId:    catDialogProject.id,
          projectName:  catDialogProject.projectName,
          period:       catDialogMonth,
          categoryId:   catDoc?.id || '',
          categoryName: catDialogCategory,
          budgetAmount: amount,
          notes:        catDialogNotes.trim(),
          createdAt:    serverTimestamp(),
          updatedAt:    serverTimestamp(),
        });
        toast({ title: 'Budget Set', description: `${catDialogCategory} budget set for ${monthLabel(catDialogMonth)}.` });
      }
      setCatDialogOpen(false);
      void loadAll();
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setCatSaving(false);
    }
  }

  async function handleCatDelete(budget: SASCategoryBudget) {
    try {
      await deleteDoc(doc(db, SAS_COLLECTIONS.categoryBudgets, budget.id));
      toast({ title: 'Removed', description: 'Category budget removed.' });
      void loadAll();
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
  }

  // ── PDF Approval upload helpers ───────────────────────────────────────────────
  async function handlePdfUpload(projectId: string, projectName: string, period: string, file: File) {
    setPdfUploadingKey(`${projectId}:${period}`);
    try {
      const existing = allApprovals.find(a => a.projectId === projectId && a.period === period);
      // Remove previous file from Storage if replacing
      if (existing?.storagePath) {
        try { await deleteObject(storageRef(storage, existing.storagePath)); } catch { /* ok if already deleted */ }
      }
      const path = `sas/budget-approvals/${projectId}/${period}/${file.name}`;
      const sRef = storageRef(storage, path);
      await uploadBytes(sRef, file);
      const url = await getDownloadURL(sRef);
      const data = {
        projectId, projectName, period,
        fileName: file.name, fileUrl: url, storagePath: path,
        uploadedBy: user?.id ?? '', uploadedByName: user?.name ?? '',
        uploadedAt: serverTimestamp(),
      };
      if (existing) {
        await updateDoc(doc(db, SAS_COLLECTIONS.budgetApprovals, existing.id), data);
      } else {
        await addDoc(collection(db, SAS_COLLECTIONS.budgetApprovals), data);
      }
      toast({ title: 'Uploaded', description: `Approval copy for ${monthLabel(period)} saved.` });
      // Reload approvals only
      const appSnap = await getDocs(collection(db, SAS_COLLECTIONS.budgetApprovals));
      setAllApprovals(appSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASBudgetApproval)));
    } catch (e: any) {
      toast({ title: 'Upload failed', description: e.message, variant: 'destructive' });
    } finally {
      setPdfUploadingKey(null);
    }
  }

  async function handleDeleteApproval(approval: SASBudgetApproval) {
    try {
      if (approval.storagePath) {
        try { await deleteObject(storageRef(storage, approval.storagePath)); } catch { /* ok */ }
      }
      await deleteDoc(doc(db, SAS_COLLECTIONS.budgetApprovals, approval.id));
      setAllApprovals(prev => prev.filter(a => a.id !== approval.id));
      toast({ title: 'Removed', description: 'Approval copy removed.' });
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
  }

  // ── Upload Approval Sheet helpers ─────────────────────────────────────────────
  function parseMonthStr(val: string): string {
    if (!val) return '';
    const s = String(val).trim();
    if (/^\d{4}-\d{2}$/.test(s)) return s;
    const monthNames = ['january','february','march','april','may','june','july','august','september','october','november','december'];
    const lower = s.toLowerCase();
    for (let i = 0; i < monthNames.length; i++) {
      if (lower.startsWith(monthNames[i].slice(0, 3))) {
        const yr = s.match(/\d{4}/);
        if (yr) return `${yr[0]}-${String(i + 1).padStart(2, '0')}`;
      }
    }
    // Excel date serial number
    if (/^\d+$/.test(s)) {
      const n = parseInt(s);
      if (n > 40000 && n < 60000) {
        const d = new Date((n - 25569) * 86400000);
        return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      }
    }
    return '';
  }

  async function handleUploadFile(file: File) {
    const buf = await file.arrayBuffer();
    const wb2 = new ExcelJS.Workbook();
    await wb2.xlsx.load(buf);
    const ws2 = wb2.worksheets[0];
    if (!ws2) { toast({ title: 'Error', description: 'No worksheet found in file.', variant: 'destructive' }); return; }

    const parsed: UploadRow[] = [];
    ws2.eachRow((row, rn) => {
      if (rn === 1) return; // skip header
      const cells = row.values as any[];
      const rawProject = String(cells[1] ?? '').trim();
      const rawPeriod  = String(cells[2] ?? '').trim();
      const rawAmount  = cells[3];
      const rawNotes   = String(cells[4] ?? '').trim();

      const amount  = parseFloat(String(rawAmount ?? '0').replace(/[^0-9.]/g, '')) || 0;
      const period  = parseMonthStr(rawPeriod);
      const matched = visibleProjects.find(p =>
        p.projectName.toLowerCase() === rawProject.toLowerCase() ||
        (p.projectCode && p.projectCode.toLowerCase() === rawProject.toLowerCase())
      );

      const errors: string[] = [];
      if (!rawProject) errors.push('Project name missing');
      else if (!matched) errors.push(`Project "${rawProject}" not found`);
      if (!period) errors.push(`Invalid month "${rawPeriod}"`);
      if (amount <= 0) errors.push('Amount must be > 0');

      parsed.push({
        rowNum:      rn,
        projectName: rawProject,
        projectId:   matched?.id ?? '',
        period,
        amount,
        notes:       rawNotes,
        valid:       errors.length === 0,
        error:       errors.join('; '),
      });
    });
    setUploadRows(parsed);
    setUploadOpen(true);
  }

  async function handleUploadSave() {
    const valid = uploadRows.filter(r => r.valid);
    if (!valid.length) return;
    setUploadSaving(true);
    try {
      await Promise.all(valid.map(async row => {
        const existing = allBudgets.find(b =>
          b.projectId === row.projectId && b.budgetType === 'monthly' && b.period === row.period
        );
        const proj = visibleProjects.find(p => p.id === row.projectId);
        if (existing) {
          await updateDoc(doc(db, SAS_COLLECTIONS.budgets, existing.id), {
            budgetAmount: row.amount, notes: row.notes, updatedAt: serverTimestamp(),
          });
        } else {
          await addDoc(collection(db, SAS_COLLECTIONS.budgets), {
            projectId:   row.projectId,
            projectName: proj?.projectName ?? row.projectName,
            budgetType:  'monthly',
            period:      row.period,
            budgetAmount: row.amount,
            notes:       row.notes,
            createdAt:   serverTimestamp(),
            updatedAt:   serverTimestamp(),
          });
        }
      }));
      toast({ title: 'Imported', description: `${valid.length} monthly budget${valid.length > 1 ? 's' : ''} saved.` });
      setUploadOpen(false);
      setUploadRows([]);
      void loadAll();
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setUploadSaving(false);
    }
  }

  async function downloadTemplate() {
    const wb2 = new ExcelJS.Workbook();
    const ws2 = wb2.addWorksheet('Monthly Budget');
    ws2.columns = [
      { header: 'Project Name', key: 'proj', width: 32 },
      { header: 'Period (YYYY-MM)', key: 'period', width: 18 },
      { header: 'Budget Amount (₹)', key: 'amount', width: 20 },
      { header: 'Notes', key: 'notes', width: 30 },
    ];
    ws2.getRow(1).font = { bold: true };
    // Add one sample row per visible project for current month
    const cur = currentMonthStr();
    visibleProjects.forEach(p => ws2.addRow({ proj: p.projectName, period: cur, amount: 0, notes: '' }));
    const buf = await wb2.xlsx.writeBuffer();
    const url = URL.createObjectURL(new Blob([buf]));
    const a = document.createElement('a'); a.href = url; a.download = 'monthly-budget-template.xlsx'; a.click();
    URL.revokeObjectURL(url);
  }

  // ── Export ────────────────────────────────────────────────────────────────────
  async function exportExcel() {
    setExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Budget Tree');
      ws.columns = [
        { header: 'Level',          key: 'level',     width: 16 },
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

      for (const project of visibleProjects) {
        const pExp = allExpenses.filter(e => e.projectId === project.id);
        const pPay = allPayments.filter(p => p.projectId === project.id);
        const tb   = allBudgets.find(b => b.projectId === project.id && b.budgetType === 'total');
        const tSpent = pExp.reduce((s, e) => s + (e.expenseAmount || 0), 0);
        const tRcvd  = pPay.reduce((s, p) => s + (p.receivedAmount || 0), 0);
        const exportFySumAll = allBudgets.filter(b => b.projectId === project.id && b.budgetType === 'fy').reduce((s, b) => s + b.budgetAmount, 0);
        const exportMonthSumAll = allBudgets.filter(b => b.projectId === project.id && b.budgetType === 'monthly').reduce((s, b) => s + b.budgetAmount, 0);
        const tAmt   = tb ? tb.budgetAmount : exportFySumAll > 0 ? exportFySumAll : exportMonthSumAll;
        const tRow = ws.addRow({
          level: 'Total', name: project.projectName,
          budget: tAmt || '—', received: tRcvd, spent: tSpent,
          remaining: tAmt > 0 ? tAmt - tSpent : '—',
          pctUsed: tAmt > 0 ? formatPct((tSpent / tAmt) * 100) : '—',
          status: tAmt === 0 ? 'No Budget' : tSpent > tAmt ? 'Over Budget' : (tSpent / tAmt) * 100 >= 80 ? 'Warning' : 'On Track',
          notes: tb?.notes || '',
        });
        tRow.font = { bold: true };

        for (const fyS of getRelevantFYs(project.id)) {
          const r   = fyRange(fyS);
          const fyB = allBudgets.find(b => b.projectId === project.id && b.budgetType === 'fy' && b.period === fyLabel(fyS));
          const fySpent = pExp.filter(e => e.expenseDate >= r.start && e.expenseDate <= r.end).reduce((s, e) => s + (e.expenseAmount || 0), 0);
          const fyRcvd  = pPay.filter(p => p.receiptDate >= r.start && p.receiptDate <= r.end).reduce((s, p) => s + (p.receivedAmount || 0), 0);
          const exportFyMonthSum = getRelevantMonths(project.id, fyS).reduce((s, m) => {
            const mb = allBudgets.find(b => b.projectId === project.id && b.budgetType === 'monthly' && b.period === m);
            return s + (mb?.budgetAmount ?? 0);
          }, 0);
          if (!fyB && fySpent === 0 && exportFyMonthSum === 0) continue;
          const fAmt = fyB ? fyB.budgetAmount : exportFyMonthSum;
          ws.addRow({
            level: `FY ${fyLabel(fyS)}`, name: `  FY ${fyLabel(fyS)}`,
            budget: fAmt || '—', received: fyRcvd, spent: fySpent,
            remaining: fAmt > 0 ? fAmt - fySpent : '—',
            pctUsed: fAmt > 0 ? formatPct((fySpent / fAmt) * 100) : '—',
            status: fAmt === 0 ? 'No Budget' : fySpent > fAmt ? 'Over Budget' : (fySpent / fAmt) * 100 >= 80 ? 'Warning' : 'On Track',
            notes: fyB?.notes || '',
          });

          for (const m of getRelevantMonths(project.id, fyS)) {
            const mB = allBudgets.find(b => b.projectId === project.id && b.budgetType === 'monthly' && b.period === m);
            const mSpent = pExp.filter(e => e.expenseDate.startsWith(m)).reduce((s, e) => s + (e.expenseAmount || 0), 0);
            const mRcvd  = pPay.filter(p => p.receiptDate.startsWith(m)).reduce((s, p) => s + (p.receivedAmount || 0), 0);
            if (!mB && mSpent === 0 && !allCatBudgets.some(b => b.projectId === project.id && b.period === m)) continue;
            const mAmt = mB?.budgetAmount ?? 0;
            ws.addRow({
              level: monthLabel(m), name: `    ${monthLabel(m)}`,
              budget: mAmt || '—', received: mRcvd, spent: mSpent,
              remaining: mAmt > 0 ? mAmt - mSpent : '—',
              pctUsed: mAmt > 0 ? formatPct((mSpent / mAmt) * 100) : '—',
              status: !mB ? 'No Budget' : mSpent > mAmt ? 'Over Budget' : (mSpent / mAmt) * 100 >= 80 ? 'Warning' : 'On Track',
              notes: mB?.notes || '',
            });

            // Category rows
            for (const cat of getMonthCategories(project.id, m)) {
              const cb = allCatBudgets.find(b => b.projectId === project.id && b.period === m && b.categoryName === cat);
              const cSpent = pExp.filter(e => e.expenseDate.startsWith(m) && e.expenseCategory === cat).reduce((s, e) => s + (e.expenseAmount || 0), 0);
              if (!cb && cSpent === 0) continue;
              const cAmt = cb?.budgetAmount ?? 0;
              ws.addRow({
                level: 'Category', name: `      ${cat}`,
                budget: cAmt || '—', received: '—', spent: cSpent,
                remaining: cAmt > 0 ? cAmt - cSpent : '—',
                pctUsed: cAmt > 0 ? formatPct((cSpent / cAmt) * 100) : '—',
                status: !cb ? 'No Budget' : cSpent > cAmt ? 'Over' : (cSpent / cAmt) * 100 >= 80 ? 'Near Limit' : 'OK',
                notes: cb?.notes || '',
              });
            }
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

  if (!canView && !canAdd && !canEdit) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border bg-card py-20 gap-3 text-center">
        <ShieldAlert className="h-11 w-11 text-destructive" />
        <p className="font-semibold text-slate-800">Access Denied</p>
        <p className="text-sm text-muted-foreground">You don&apos;t have permission to access Site Fund Budget.</p>
      </div>
    );
  }

  const curMonth  = currentMonthStr();
  const curFYStart = currentFYStart();

  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-base sm:text-lg font-bold text-slate-800">Site Fund Budget</h1>
          <p className="text-sm text-muted-foreground">
            Hierarchical tracking — Total → FY-wise → Month-wise → Category-wise
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {canExport && (
            <Button variant="outline" size="sm" onClick={exportExcel} disabled={exporting} className="gap-2">
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Export
            </Button>
          )}
          <input
            id="budget-upload-input"
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) void handleUploadFile(f); e.target.value = ''; }}
          />
          {/* Hidden PDF input for per-month approval uploads */}
          <input
            id="budget-pdf-input"
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={e => {
              const f = e.target.files?.[0];
              const key = pdfPendingKeyRef.current;
              if (f && key) {
                const [pid, period] = key.split(':');
                const proj = visibleProjects.find(p => p.id === pid);
                void handlePdfUpload(pid, proj?.projectName ?? '', period, f);
              } else {
                // User cancelled without picking — clear spinner
                setPdfUploadingKey(null);
                pdfPendingKeyRef.current = null;
              }
              e.target.value = '';
            }}
          />
          {effectiveCanAdd && (
            <Button variant="outline" size="sm" className="gap-2" onClick={() => document.getElementById('budget-upload-input')?.click()}>
              <Upload className="h-4 w-4" /> Upload Approval Sheet
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

        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
          <Filter className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <div className="relative w-full sm:w-auto min-w-[140px]">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search project..."
              value={filterSearch}
              onChange={e => setFilterSearch(e.target.value)}
              className="h-7 pl-7 pr-6 text-xs w-full"
            />
            {filterSearch && (
              <button onClick={() => setFilterSearch('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          <Select value={filterFY} onValueChange={v => setFilterFY(v)}>
            <SelectTrigger className="h-7 text-xs w-full sm:w-auto min-w-[140px]">
              <SelectValue placeholder="All FYs" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All FYs</SelectItem>
              {availableFYs.map(fy => (
                <SelectItem key={fy} value={String(fy)}>{fyLabel(fy)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filterStatus} onValueChange={v => setFilterStatus(v as typeof filterStatus)}>
            <SelectTrigger className="h-7 text-xs w-full sm:w-auto min-w-[140px]">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="on-track">On Track</SelectItem>
              <SelectItem value="warning">Warning (&gt;80%)</SelectItem>
              <SelectItem value="over-budget">Over Budget</SelectItem>
              <SelectItem value="no-budget">No Budget Set</SelectItem>
            </SelectContent>
          </Select>
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-muted-foreground"
              onClick={() => { setFilterSearch(''); setFilterStatus('all'); setFilterFY('all'); }}>
              <X className="h-3 w-3" /> Clear filters
            </Button>
          )}
          <span className="ml-auto text-xs text-muted-foreground">
            {filteredProjects.length} of {visibleProjects.length} project{visibleProjects.length !== 1 ? 's' : ''}
          </span>
        </div>

        <CardContent className="p-0">
          {visibleProjects.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <Target className="h-10 w-10 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">No active projects found.</p>
            </div>
          ) : filteredProjects.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <Filter className="h-10 w-10 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">No projects match the current filters.</p>
              <Button variant="outline" size="sm" onClick={() => { setFilterSearch(''); setFilterStatus('all'); setFilterFY('all'); }}>
                Clear filters
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto overflow-y-auto" style={{ maxHeight: 'calc(100vh - 340px)' }}>
              <table className="w-full text-sm min-w-[800px]">
                <thead className="sticky top-0 z-20">
                  <tr className="border-b bg-slate-100 shadow-sm">
                    <th className="px-4 py-2.5 text-left font-medium min-w-[220px]">Project / Period</th>
                    <th className="px-4 py-2.5 text-right font-medium whitespace-nowrap">Budget (₹)</th>
                    <th className="px-4 py-2.5 text-right font-medium whitespace-nowrap">Spent (₹)</th>
                    <th className="px-4 py-2.5 text-right font-medium whitespace-nowrap">Remaining (₹)</th>
                    <th className="px-4 py-2.5 text-left font-medium min-w-[130px]">Usage</th>
                    <th className="px-4 py-2.5 text-left font-medium">Status</th>
                    {(effectiveCanEdit || canDelete || effectiveCanAdd) && <th className="px-4 py-2.5 text-right font-medium">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const filterFYStart = filterFY !== 'all' ? parseInt(filterFY) : null;
                    return filteredProjects.map(project => {
                    const totalBudget = allBudgets.find(b => b.projectId === project.id && b.budgetType === 'total') ?? null;
                    const pExp    = allExpenses.filter(e => e.projectId === project.id);
                    const pPay    = allPayments.filter(p => p.projectId === project.id);
                    const tSpent  = pExp.reduce((s, e) => s + (e.expenseAmount  || 0), 0);
                    // Cascade: explicit total → sum of FY budgets → sum of all monthly budgets
                    const fyBudgetSumAll = allBudgets
                      .filter(b => b.projectId === project.id && b.budgetType === 'fy')
                      .reduce((s, b) => s + b.budgetAmount, 0);
                    const monthBudgetSumAll = allBudgets
                      .filter(b => b.projectId === project.id && b.budgetType === 'monthly')
                      .reduce((s, b) => s + b.budgetAmount, 0);
                    const tAmt    = totalBudget ? totalBudget.budgetAmount
                                   : fyBudgetSumAll > 0 ? fyBudgetSumAll
                                   : monthBudgetSumAll;
                    const tBudgetSource = totalBudget ? 'explicit' : fyBudgetSumAll > 0 ? 'fy-sum' : 'month-sum';
                    const tPct    = tAmt > 0 ? Math.min((tSpent / tAmt) * 100, 100) : 0;
                    // When a FY filter is active, force project open and show only the matching FY
                    const isExpanded = expandedProjects.has(project.id) || filterFYStart !== null;
                    const allFys = getRelevantFYs(project.id);
                    const fys = filterFYStart !== null ? allFys.filter(fy => fy === filterFYStart) : allFys;

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
                            {tAmt > 0
                              ? <div>
                                  {formatINR(tAmt)}
                                  {tBudgetSource === 'fy-sum' && <p className="text-[10px] font-normal text-muted-foreground">∑ FY budgets</p>}
                                  {tBudgetSource === 'month-sum' && <p className="text-[10px] font-normal text-muted-foreground">∑ monthly budgets</p>}
                                </div>
                              : <span className="text-muted-foreground text-xs">—</span>}
                          </td>
                          <td className="px-4 py-3 text-right text-rose-700 font-medium">{formatINR(tSpent)}</td>
                          <td className={cn('px-4 py-3 text-right font-semibold', tAmt === 0 ? 'text-muted-foreground' : tAmt - tSpent < 0 ? 'text-destructive' : 'text-indigo-700')}>
                            {tAmt > 0 ? formatINR(tAmt - tSpent) : '—'}
                          </td>
                          <td className="px-4 py-3">
                            {tAmt > 0 ? (
                              <div className="space-y-1 min-w-[110px]">
                                <Progress value={tPct} className="h-2" />
                                <p className="text-xs text-muted-foreground">{formatPct(tPct)}</p>
                              </div>
                            ) : <span className="text-xs text-muted-foreground">—</span>}
                          </td>
                          <td className="px-4 py-3">
                            <StatusBadge budget={tAmt > 0 ? { budgetAmount: tAmt } as SASBudget : null} spent={tSpent} />
                          </td>
                          {(effectiveCanEdit || canDelete) && (
                            <td className="px-4 py-3 text-right">
                              <div className="flex justify-end items-center gap-1">
                                {effectiveCanEdit && (
                                  totalBudget
                                    ? <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openEdit(totalBudget)}><Pencil className="h-3 w-3" /></Button>
                                    : <Button variant="outline" size="sm" className="h-6 text-[11px] gap-0.5 text-emerald-700 border-emerald-200 hover:bg-emerald-50 px-2" onClick={() => openAdd(project, 'total')}><Plus className="h-2.5 w-2.5" />Set Total</Button>
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
                          // When a FY filter is active, auto-expand matching FY to show months
                          const isFYExp = expandedFYs.has(fyKey) || filterFYStart !== null;
                          const r       = fyRange(fyS);
                          const fyB     = allBudgets.find(b => b.projectId === project.id && b.budgetType === 'fy' && b.period === fyLabel(fyS)) ?? null;
                          const fySpent = pExp.filter(e => e.expenseDate >= r.start && e.expenseDate <= r.end).reduce((s, e) => s + (e.expenseAmount || 0), 0);
                          const isCurFY = fyS === curFYStart;
                          const months  = getRelevantMonths(project.id, fyS);
                          // Cascade: explicit FY budget → sum of monthly budgets in this FY
                          const fyMonthSum = months.reduce((s, m) => {
                            const mb = allBudgets.find(b => b.projectId === project.id && b.budgetType === 'monthly' && b.period === m);
                            return s + (mb?.budgetAmount ?? 0);
                          }, 0);
                          const fAmt    = fyB ? fyB.budgetAmount : fyMonthSum;
                          const fBudgetSource = fyB ? 'explicit' : 'month-sum';
                          const fyPct   = fAmt > 0 ? Math.min((fySpent / fAmt) * 100, 100) : 0;

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
                                  {fAmt > 0
                                    ? <div>
                                        {formatINR(fAmt)}
                                        {fBudgetSource === 'month-sum' && <p className="text-[10px] font-normal text-muted-foreground">∑ monthly budgets</p>}
                                      </div>
                                    : <span className="text-muted-foreground text-xs">—</span>}
                                </td>
                                <td className="px-4 py-2.5 text-right text-rose-700">{fySpent > 0 ? formatINR(fySpent) : <span className="text-muted-foreground text-xs">—</span>}</td>
                                <td className={cn('px-4 py-2.5 text-right font-medium', fAmt === 0 ? 'text-muted-foreground' : fAmt - fySpent < 0 ? 'text-destructive' : 'text-indigo-700')}>
                                  {fAmt > 0 ? formatINR(fAmt - fySpent) : '—'}
                                </td>
                                <td className="px-4 py-2.5">
                                  {fAmt > 0 ? (
                                    <div className="space-y-1 min-w-[110px]">
                                      <Progress value={fyPct} className="h-1.5" />
                                      <p className="text-xs text-muted-foreground">{formatPct(fyPct)}</p>
                                    </div>
                                  ) : <span className="text-xs text-muted-foreground">—</span>}
                                </td>
                                <td className="px-4 py-2.5">
                                  <StatusBadge budget={fAmt > 0 ? { budgetAmount: fAmt } as SASBudget : null} spent={fySpent} />
                                </td>
                                {(effectiveCanEdit || canDelete) && (
                                  <td className="px-4 py-2.5 text-right">
                                    <div className="flex justify-end items-center gap-1">
                                      {effectiveCanEdit && (
                                        fyB
                                          ? <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openEdit(fyB)}><Pencil className="h-3 w-3" /></Button>
                                          : <Button variant="outline" size="sm" className="h-6 text-[11px] gap-0.5 text-emerald-700 border-emerald-200 hover:bg-emerald-50 px-2" onClick={() => openAdd(project, 'fy', fyS)}><Plus className="h-2.5 w-2.5" />Set FY</Button>
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
                                const monthKey = `${project.id}:${m}`;
                                const isMoExp  = expandedMonths.has(monthKey);
                                const mB       = allBudgets.find(b => b.projectId === project.id && b.budgetType === 'monthly' && b.period === m) ?? null;
                                const approval = allApprovals.find(a => a.projectId === project.id && a.period === m);
                                const isPdfUploading = pdfUploadingKey === `${project.id}:${m}`;
                                const mSpent   = pExp.filter(e => e.expenseDate.startsWith(m)).reduce((s, e) => s + (e.expenseAmount || 0), 0);
                                // Roll-up: if no monthly budget, sum category budgets for this month
                                const catBudgetSum = allCatBudgets
                                  .filter(b => b.projectId === project.id && b.period === m)
                                  .reduce((s, b) => s + b.budgetAmount, 0);
                                const mAmt     = mB?.budgetAmount ?? catBudgetSum;
                                const mPct     = mAmt > 0 ? Math.min((mSpent / mAmt) * 100, 100) : 0;
                                // How much of monthly budget has been allocated to categories
                                const catAllocated = catBudgetSum;
                                const showCatAlloc = mB && catAllocated > 0;
                                const isCurMo  = m === curMonth;
                                const catRows  = getMonthCategories(project.id, m);

                                return (
                                  <Fragment key={m}>
                                    <tr className={cn('border-b transition-colors', isCurMo ? 'bg-amber-50/40' : isMoExp ? 'bg-amber-50/20' : 'bg-white/50 hover:bg-muted/10')}>
                                      <td className="pl-14 pr-4 py-2">
                                        <button
                                          onClick={() => toggleMonth(monthKey)}
                                          className="flex items-center gap-1.5 text-slate-600 hover:text-amber-700 transition-colors"
                                        >
                                          {isMoExp
                                            ? <ChevronDown  className="h-3 w-3 text-amber-500 shrink-0" />
                                            : <ChevronRight className="h-3 w-3 text-slate-400 shrink-0" />}
                                          <Calendar className="h-3 w-3 text-slate-400 shrink-0" />
                                          <span className="text-xs">{monthLabel(m)}</span>
                                          {isCurMo && <Badge className="text-[9px] px-1.5 py-0 bg-amber-100 text-amber-700 hover:bg-amber-100 font-normal">This Month</Badge>}
                                          {approval && (
                                            <a
                                              href={approval.fileUrl}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              title={`View approval: ${approval.fileName}`}
                                              onClick={e => e.stopPropagation()}
                                              className="flex items-center gap-0.5 text-[10px] text-blue-600 hover:text-blue-800 hover:underline"
                                            >
                                              <FileText className="h-2.5 w-2.5 shrink-0" />
                                              <span>Approval</span>
                                            </a>
                                          )}
                                          <span className="ml-1 text-[10px] text-muted-foreground">
                                            ({catRows.length} categories)
                                          </span>
                                        </button>
                                      </td>
                                      <td className="px-4 py-2 text-right text-xs font-medium text-emerald-700">
                                        {mAmt > 0
                                          ? <div>
                                              {formatINR(mAmt)}
                                              {!mB && <p className="text-[10px] font-normal text-muted-foreground">∑ categories</p>}
                                              {showCatAlloc && (
                                                <p className={cn('text-[10px] font-normal', catAllocated > mAmt ? 'text-destructive' : 'text-muted-foreground')}>
                                                  {formatINR(catAllocated)} alloc'd
                                                </p>
                                              )}
                                            </div>
                                          : <span className="text-muted-foreground">—</span>}
                                      </td>
                                      <td className="px-4 py-2 text-right text-xs text-rose-700">
                                        {mSpent > 0 ? formatINR(mSpent) : <span className="text-muted-foreground">—</span>}
                                      </td>
                                      <td className={cn('px-4 py-2 text-right text-xs font-medium', mAmt === 0 ? 'text-muted-foreground' : mAmt - mSpent < 0 ? 'text-destructive' : 'text-indigo-700')}>
                                        {mAmt > 0 ? formatINR(mAmt - mSpent) : '—'}
                                      </td>
                                      <td className="px-4 py-2">
                                        {mAmt > 0 ? (
                                          <div className="space-y-0.5 min-w-[110px]">
                                            <Progress value={mPct} className="h-1.5" />
                                            <p className="text-[11px] text-muted-foreground">{formatPct(mPct)}</p>
                                          </div>
                                        ) : <span className="text-xs text-muted-foreground">—</span>}
                                      </td>
                                      <td className="px-4 py-2">
                                        <StatusBadge budget={mB ?? (catBudgetSum > 0 ? { budgetAmount: catBudgetSum } as SASBudget : null)} spent={mSpent} />
                                      </td>
                                      {(effectiveCanEdit || canDelete) && (
                                        <td className="px-4 py-2 text-right">
                                          <div className="flex justify-end items-center gap-1">
                                            {effectiveCanEdit && (
                                              <>
                                                {mB
                                                  ? <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openEdit(mB)}><Pencil className="h-3 w-3" /></Button>
                                                  : <Button variant="outline" size="sm" className="h-6 text-[11px] gap-0.5 text-emerald-700 border-emerald-200 hover:bg-emerald-50 px-2" onClick={() => openAdd(project, 'monthly', fyS, m)}><Plus className="h-2.5 w-2.5" />Set</Button>
                                                }
                                                <Button
                                                  variant="outline" size="sm"
                                                  className="h-6 text-[11px] gap-0.5 text-teal-700 border-teal-200 hover:bg-teal-50 px-2"
                                                  title="Set category budgets for this month"
                                                  onClick={() => openBulkCatDialog(project, m)}
                                                >
                                                  <Layers className="h-2.5 w-2.5" />Categories
                                                </Button>
                                              </>
                                            )}
                                            {canDelete && mB && (
                                              <DeleteConfirm label={`Remove ${monthLabel(m)} budget for ${project.projectName}?`} onConfirm={() => handleDelete(mB)} size="sm" />
                                            )}
                                            {/* PDF approval buttons */}
                                            {effectiveCanAdd && (
                                              <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-6 w-6 text-blue-600 hover:bg-blue-50"
                                                title={approval ? 'Replace approval copy' : 'Upload approval PDF'}
                                                disabled={isPdfUploading}
                                                onClick={() => {
                                                  const key = `${project.id}:${m}`;
                                                  pdfPendingKeyRef.current = key;
                                                  setPdfUploadingKey(key);
                                                  document.getElementById('budget-pdf-input')?.click();
                                                }}
                                              >
                                                {isPdfUploading
                                                  ? <Loader2 className="h-3 w-3 animate-spin" />
                                                  : <FileText className="h-3 w-3" />}
                                              </Button>
                                            )}
                                            {approval && (
                                              <>
                                                <Button
                                                  variant="ghost"
                                                  size="icon"
                                                  className="h-6 w-6 text-blue-600 hover:bg-blue-50"
                                                  title={`View: ${approval.fileName}`}
                                                  onClick={() => window.open(approval.fileUrl, '_blank')}
                                                >
                                                  <Download className="h-3 w-3" />
                                                </Button>
                                                {canDelete && (
                                                  <DeleteConfirm
                                                    label={`Remove approval copy for ${monthLabel(m)}?`}
                                                    onConfirm={() => handleDeleteApproval(approval)}
                                                    size="sm"
                                                  />
                                                )}
                                              </>
                                            )}
                                          </div>
                                        </td>
                                      )}
                                    </tr>

                                    {/* ══ Level 3 — Category rows ══ */}
                                    {isMoExp && catRows.map(cat => {
                                      const catB    = allCatBudgets.find(b => b.projectId === project.id && b.period === m && b.categoryName === cat);
                                      const cSpent  = pExp.filter(e => e.expenseDate.startsWith(m) && e.expenseCategory === cat).reduce((s, e) => s + (e.expenseAmount || 0), 0);
                                      const cAmt    = catB?.budgetAmount ?? 0;
                                      const cPct    = cAmt > 0 ? Math.min((cSpent / cAmt) * 100, 100) : 0;

                                      return (
                                        <tr key={`${m}:${cat}`} className="border-b bg-slate-50/30 hover:bg-muted/10 transition-colors">
                                          <td className="pl-20 pr-4 py-1.5">
                                            <div className="flex items-center gap-1.5">
                                              <Layers className="h-2.5 w-2.5 text-teal-400 shrink-0" />
                                              <span className="text-xs text-slate-600">{cat}</span>
                                            </div>
                                          </td>
                                          <td className="px-4 py-1.5 text-right text-xs font-medium text-emerald-700">
                                            {catB ? formatINR(cAmt) : <span className="text-muted-foreground text-xs">—</span>}
                                          </td>
                                          <td className="px-4 py-1.5 text-right text-xs text-rose-700">
                                            {cSpent > 0 ? formatINR(cSpent) : <span className="text-muted-foreground text-xs">—</span>}
                                          </td>
                                          <td className={cn('px-4 py-1.5 text-right text-xs font-medium',
                                            !catB ? 'text-muted-foreground' : cAmt - cSpent < 0 ? 'text-destructive' : 'text-indigo-700')}>
                                            {catB ? formatINR(cAmt - cSpent) : '—'}
                                          </td>
                                          <td className="px-4 py-1.5">
                                            {catB ? (
                                              <div className="space-y-0.5 min-w-[110px]">
                                                <Progress value={cPct} className="h-1" />
                                                <p className="text-[10px] text-muted-foreground">{formatPct(cPct)}</p>
                                              </div>
                                            ) : <span className="text-xs text-muted-foreground">—</span>}
                                          </td>
                                          <td className="px-4 py-1.5"><CatStatusBadge budget={catB} spent={cSpent} /></td>
                                          {(effectiveCanEdit || canDelete) && (
                                            <td className="px-4 py-1.5 text-right">
                                              <div className="flex justify-end gap-1">
                                                {effectiveCanEdit && catB && (
                                                  <Button variant="ghost" size="icon" className="h-5 w-5" title="Edit budget" onClick={() => openCatEdit(catB)}>
                                                    <Pencil className="h-2.5 w-2.5" />
                                                  </Button>
                                                )}
                                                {canDelete && catB && (
                                                  <DeleteConfirm label={`Remove ${cat} budget for ${monthLabel(m)}?`} onConfirm={() => handleCatDelete(catB)} size="sm" />
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
                      </Fragment>
                    );
                  });
                  })()}
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

      {/* ── Add / Edit Budget Dialog ── */}
      <Dialog open={dialogOpen} onOpenChange={open => { if (!open && !saving) setDialogOpen(false); }}>
        <DialogContent className="max-w-[95vw] sm:max-w-md overflow-y-auto max-h-[90vh]">
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
            {!editingBudget && (
              <div className="space-y-2">
                <Label>Budget Type</Label>
                <Tabs value={dialogTab} onValueChange={v => setDialogTab(v as BudgetTab)}>
                  <TabsList className="grid w-full grid-cols-3">
                    <TabsTrigger value="total">Total</TabsTrigger>
                    <TabsTrigger value="fy">Financial Year</TabsTrigger>
                    <TabsTrigger value="monthly">Monthly</TabsTrigger>
                  </TabsList>
                </Tabs>

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

            <div className="space-y-1.5">
              <Label>Budget Amount (₹) <span className="text-destructive">*</span></Label>
              <Input
                type="number" min="0"
                value={form.budgetAmount}
                onChange={e => setForm(f => ({ ...f, budgetAmount: e.target.value }))}
                placeholder="Enter budget amount"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional notes" />
            </div>

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

      {/* ── Bulk Category Budget Dialog ── */}
      <Dialog open={bulkDialogOpen} onOpenChange={open => { if (!open && !bulkSaving) setBulkDialogOpen(false); }}>
        <DialogContent className="max-w-[95vw] sm:max-w-md flex flex-col overflow-y-auto max-h-[90vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-teal-600" />
              Category Budgets — {bulkMonth ? monthLabel(bulkMonth) : ''}
            </DialogTitle>
          </DialogHeader>

          {/* Context */}
          <div className="rounded-lg bg-slate-50 border px-3 py-2 text-sm shrink-0">
            <p className="text-muted-foreground">
              <span className="font-medium text-slate-700">Project:</span> {bulkProject?.projectName}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Enter amounts for the categories you want to budget. Leave blank to skip.
            </p>
          </div>

          {/* Category list — scrollable */}
          <div className="flex-1 overflow-y-auto space-y-1 pr-1 py-1">
            {categories.map(cat => {
              const existing = allCatBudgets.find(b =>
                b.projectId === bulkProject?.id && b.period === bulkMonth && b.categoryName === cat.name
              );
              const actual = allExpenses
                .filter(e =>
                  e.projectId === bulkProject?.id &&
                  e.expenseCategory === cat.name &&
                  e.expenseDate?.startsWith(bulkMonth)
                )
                .reduce((s, e) => s + (e.expenseAmount || 0), 0);
              const val = bulkAmounts[cat.name] ?? '';
              const budgetNum = Number(val);
              const isOver = existing && actual > existing.budgetAmount;
              const isNew = val && !existing;

              return (
                <div key={cat.id} className={cn(
                  'flex items-center gap-3 rounded-lg px-2.5 py-2 border transition-colors',
                  val && budgetNum > 0 ? 'bg-teal-50/60 border-teal-100' : 'bg-white border-slate-100'
                )}>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-700 truncate">{cat.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {actual > 0 && (
                        <span className="text-[10px] text-rose-500">Spent: {formatINR(actual)}</span>
                      )}
                      {existing && (
                        <span className={cn('text-[10px]', isOver ? 'text-destructive' : 'text-emerald-600')}>
                          Current: {formatINR(existing.budgetAmount)}
                        </span>
                      )}
                      {isNew && (
                        <span className="text-[10px] text-teal-600 font-medium">New</span>
                      )}
                    </div>
                  </div>
                  <Input
                    type="number"
                    value={val}
                    onChange={e => setBulkAmounts(prev => ({ ...prev, [cat.name]: e.target.value }))}
                    placeholder="—"
                    className="h-8 w-32 text-right text-sm shrink-0"
                    min={0}
                  />
                </div>
              );
            })}
          </div>

          <p className="text-xs text-muted-foreground shrink-0 pt-1">
            {Object.values(bulkAmounts).filter(v => v && Number(v) > 0).length} of {categories.length} categories have a budget set.
          </p>

          <DialogFooter className="shrink-0">
            <Button variant="outline" onClick={() => setBulkDialogOpen(false)} disabled={bulkSaving}>Cancel</Button>
            <Button onClick={handleBulkCatSave} disabled={bulkSaving} className="gap-2 bg-teal-700 hover:bg-teal-800">
              {bulkSaving && <Loader2 className="h-4 w-4 animate-spin" />}
              Save All Budgets
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Category Budget Dialog (single edit) ── */}
      <Dialog open={catDialogOpen} onOpenChange={open => { if (!open && !catSaving) setCatDialogOpen(false); }}>
        <DialogContent className="max-w-[95vw] sm:max-w-sm overflow-y-auto max-h-[90vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-teal-600" />
              {catEditingBudget ? 'Edit Category Budget' : 'Set Category Budget'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-lg bg-slate-50 border px-3 py-2.5 text-sm space-y-1">
              <p className="text-muted-foreground">
                <span className="font-medium text-slate-700">Project:</span> {catDialogProject?.projectName}
              </p>
              <p className="text-muted-foreground">
                <span className="font-medium text-slate-700">Month:</span> {catDialogMonth ? monthLabel(catDialogMonth) : '—'}
              </p>
              <p className="text-muted-foreground">
                <span className="font-medium text-slate-700">Category:</span> {catDialogCategory}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Budget Amount (₹) <span className="text-destructive">*</span></Label>
              <Input
                type="number"
                value={catDialogAmount}
                onChange={e => setCatDialogAmount(e.target.value)}
                placeholder="e.g. 50000"
                min={1}
                className="h-9"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label>Notes (optional)</Label>
              <Input
                value={catDialogNotes}
                onChange={e => setCatDialogNotes(e.target.value)}
                placeholder="Optional notes..."
                className="h-9"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCatDialogOpen(false)} disabled={catSaving}>Cancel</Button>
            <Button onClick={handleCatSubmit} disabled={catSaving} className="gap-2 bg-teal-700 hover:bg-teal-800">
              {catSaving && <Loader2 className="h-4 w-4 animate-spin" />}
              {catEditingBudget ? 'Update' : 'Set Budget'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Upload preview dialog ── */}
      <Dialog open={uploadOpen} onOpenChange={open => { if (!open && !uploadSaving) { setUploadOpen(false); setUploadRows([]); } }}>
        <DialogContent className="max-w-[95vw] sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="h-4 w-4" /> Import Monthly Budgets
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>{uploadRows.filter(r => r.valid).length} valid</span>
              <span>·</span>
              <span className="text-destructive">{uploadRows.filter(r => !r.valid).length} errors</span>
              <Button variant="ghost" size="sm" className="ml-auto h-7 text-xs gap-1" onClick={downloadTemplate}>
                <Download className="h-3 w-3" /> Download Template
              </Button>
            </div>
            <div className="rounded-lg border overflow-x-auto max-h-[50vh]">
              <table className="w-full text-xs">
                <thead className="bg-slate-100 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left">#</th>
                    <th className="px-3 py-2 text-left">Project</th>
                    <th className="px-3 py-2 text-left">Period</th>
                    <th className="px-3 py-2 text-right">Amount (₹)</th>
                    <th className="px-3 py-2 text-left">Notes</th>
                    <th className="px-3 py-2 text-left">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {uploadRows.map(r => (
                    <tr key={r.rowNum} className={cn('border-t', r.valid ? 'bg-white' : 'bg-red-50/50')}>
                      <td className="px-3 py-1.5 text-muted-foreground">{r.rowNum}</td>
                      <td className="px-3 py-1.5">{r.projectName}</td>
                      <td className="px-3 py-1.5 font-mono">{r.period || '—'}</td>
                      <td className="px-3 py-1.5 text-right font-semibold text-emerald-700">{r.amount > 0 ? formatINR(r.amount) : '—'}</td>
                      <td className="px-3 py-1.5 text-muted-foreground truncate max-w-[120px]">{r.notes || '—'}</td>
                      <td className="px-3 py-1.5">
                        {r.valid
                          ? <Badge className="text-[10px] bg-emerald-100 text-emerald-700 hover:bg-emerald-100 px-1.5">Valid</Badge>
                          : <Badge variant="destructive" className="text-[10px] px-1.5" title={r.error}>Error</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setUploadOpen(false); setUploadRows([]); }}>Cancel</Button>
            <Button
              onClick={handleUploadSave}
              disabled={uploadSaving || uploadRows.filter(r => r.valid).length === 0}
              className="gap-2 bg-emerald-700 hover:bg-emerald-800"
            >
              {uploadSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              Import {uploadRows.filter(r => r.valid).length} Budget{uploadRows.filter(r => r.valid).length !== 1 ? 's' : ''}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
