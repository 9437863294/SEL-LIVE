'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  addDoc, collection, deleteDoc, doc, getDocs, orderBy, query, serverTimestamp, updateDoc,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { storage } from '@/lib/firebase-storage';
import { deleteObject, getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import {
  formatINR, SAS_COLLECTIONS,
  type SASBudget, type SASBudgetApproval, type SASCategory, type SASCategoryBudget,
  type SASExpense, type SASPayment, type SASProject,
} from '@/lib/site-account-statement';
import {
  effectiveMonthlyBudget, summariseAllocations,
  type SASBudgetAllocation,
} from '@/lib/site-account-statement-allocations';
import { resetBudgetAlertState } from '@/lib/sas-budget-alerts';
import { loadScopedLedger } from '@/lib/site-account-statement-queries';
import { BudgetAllocationsDialog } from '@/components/site-account-statement/budget-allocations-dialog';
import { useFieldControl, validateFieldControlRequirements } from '@/components/site-account-statement/use-field-control';
import { ControlledField } from '@/components/site-account-statement/controlled-field';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useActivityLogger } from '@/hooks/useActivityLogger';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/shared/page-header';
import { TableCard } from '@/components/shared/table-card';
import { FilterBar } from '@/components/shared/filter-bar';
import { StatusBadge } from '@/components/shared/status-badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
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
  Calendar, ChevronDown, ChevronLeft, ChevronRight, Clock, Download, FileText, Filter, Layers,
  Loader2, Lock, Pencil, Plus, ShieldAlert, Split, Target, Trash2, TrendingDown, TrendingUp,
  Upload, Wallet,
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
function BudgetStatusBadge({ budget, spent }: { budget: SASBudget | null; spent: number }) {
  if (!budget) return <StatusBadge status="No Budget" tone="neutral" />;
  const pct = budget.budgetAmount > 0 ? (spent / budget.budgetAmount) * 100 : 0;
  if (spent > budget.budgetAmount) return <StatusBadge status="Over Budget" tone="danger" />;
  if (pct >= 80) return <StatusBadge status="Warning" tone="warning" />;
  return <StatusBadge status="On Track" tone="success" />;
}

function CatStatusBadge({ budget, spent }: { budget: SASCategoryBudget | undefined; spent: number }) {
  if (!budget) return <StatusBadge status="none" tone="neutral">—</StatusBadge>;
  const pct = budget.budgetAmount > 0 ? (spent / budget.budgetAmount) * 100 : 0;
  if (spent > budget.budgetAmount) return <StatusBadge status="Over" tone="danger" />;
  if (pct >= 80) return <StatusBadge status="Near" tone="warning" />;
  return <StatusBadge status="OK" tone="success">OK</StatusBadge>;
}

// ── Restricted-by-role placeholder (shown instead of budget figures the current
// role isn't permitted to view for a given budget level) ─────────────────────
function RestrictedCell() {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground/70" title="You don't have permission to view this budget level">
      <Lock className="h-3 w-3" /> Restricted
    </span>
  );
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
  const { field } = useFieldControl('siteFundBudget');
  const { field: categoryBudgetField } = useFieldControl('categoryBudget');

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
  const [allAllocations, setAllAllocations] = useState<SASBudgetAllocation[]>([]);
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

  // ── Monthly allocation ledger dialog ─────────────────────────────────────────
  const [allocDialog, setAllocDialog] = useState<{ project: SASProject; period: string } | null>(null);

  // ── PDF approval upload state ─────────────────────────────────────────────────
  const [pdfUploadingKey, setPdfUploadingKey] = useState<string | null>(null); // "projectId:period"
  const pdfPendingKeyRef = useRef<string | null>(null); // sync ref for file input onChange

  // ── Table filters ─────────────────────────────────────────────────────────────
  const [filterSearch,  setFilterSearch]  = useState('');
  const [filterStatus,  setFilterStatus]  = useState<'all' | 'on-track' | 'warning' | 'over-budget' | 'no-budget'>('all');
  const [filterFY,      setFilterFY]      = useState<string>('all');

  // Scope depends on the resolved user and their All-Projects permission, so a late-arriving
  // profile re-runs the load rather than leaving the page scoped to nothing.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (!isAuthLoading) void loadAll(); }, [isAuthLoading, user?.id, canViewAll]);

  async function loadAll() {
    setLoading(true);
    try {
      const [pSnap, bSnap, cSnap, cbSnap] = await Promise.all([
        getDocs(query(collection(db, SAS_COLLECTIONS.projects), orderBy('projectName'))),
        getDocs(query(collection(db, SAS_COLLECTIONS.budgets))),
        getDocs(query(collection(db, SAS_COLLECTIONS.categories))),
        getDocs(collection(db, SAS_COLLECTIONS.categoryBudgets)),
      ]);
      const allProjects = pSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASProject));
      setProjects(allProjects.filter(p => p.enabledForSiteAccount && p.status === 'Active'));
      setAllBudgets(bSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASBudget)));
      setCategories(cSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASCategory)).filter(c => c.isActive !== false).sort((a, b) => a.name.localeCompare(b.name)));
      setAllCatBudgets(cbSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASCategoryBudget)));
      // Scoped to the projects this user may see, on the server — this page used to pull the
      // organisation's entire expense and payment collections and filter them in the browser.
      const ledger = await loadScopedLedger({ projects: allProjects, userId: user?.id, canViewAll });
      setAllExpenses(ledger.expenses);
      setAllPayments(ledger.payments);
    } finally {
      setLoading(false);
    }
    // Load budget approvals separately so a missing collection doesn't blank the page
    try {
      const appSnap = await getDocs(collection(db, SAS_COLLECTIONS.budgetApprovals));
      setAllApprovals(appSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASBudgetApproval)));
    } catch { /* collection may not exist yet */ }

    // Same treatment for the allocation ledger: it does not exist until the first instalment is
    // recorded, and an absent collection must not take the whole budget tree down with it.
    try {
      const allocSnap = await getDocs(collection(db, SAS_COLLECTIONS.budgetAllocations));
      setAllAllocations(allocSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASBudgetAllocation)));
    } catch { /* collection may not exist yet */ }
  }

  const visibleProjects = useMemo(
    () => canViewAll ? projects : projects.filter(p =>
      p.assignedPersonId === user?.id || p.altUserId === user?.id || p.viewerId === user?.id
    ),
    [projects, user?.id, canViewAll]
  );

  /*
   * Whether the user has a write-bearing assignment on a *specific* project.
   *
   * `isAltUser` used to be one page-wide boolean — "am I the alt user on any project" — that was
   * OR-ed into every budget-type permission. Since `visibleProjects` also contains projects where
   * the user is only the viewer, being alt user on one project silently granted budget-editing
   * rights over every project on the page.
   */
  const isAssignedTo = useMemo(() => (projectId: string): boolean => {
    const project = projects.find(p => p.id === projectId);
    if (!project) return false;
    return project.assignedPersonId === user?.id || project.altUserId === user?.id;
  }, [projects, user?.id]);

  // ── Per-budget-type permissions ───────────────────────────────────────────────
  // Role management is granular per budget level (Total / FY / Monthly / Category).
  // Any role that still has the coarse "Budget" permission keeps seeing everything
  // (backward compatible); admins who want to restrict a role to e.g. only Category
  // Budget uncheck "Budget" and tick just the sub-resources that role should see.
  //
  // `projectId` narrows the assignment-based grant to the project the row belongs to. Omitting it
  // answers the page-level question "could this user edit anything at all", which is what the
  // toolbar buttons need.
  function typePerm(resource: string, projectId?: string) {
    const assigned = projectId
      ? isAssignedTo(projectId)
      : visibleProjects.some(p => isAssignedTo(p.id));
    return {
      view: canView   || can('View',   `${MODULE}.${resource}`),
      add:  canAdd    || can('Add',    `${MODULE}.${resource}`) || assigned,
      edit: canEdit   || can('Edit',   `${MODULE}.${resource}`) || assigned,
      del:  canDelete || can('Delete', `${MODULE}.${resource}`),
    };
  }
  const totalPerm    = typePerm('Total Budget');
  const fyPerm       = typePerm('FY Budget');
  const monthlyPerm  = typePerm('Monthly Budget');
  const categoryPerm = typePerm('Category Budget');

  /*
   * Allocation rights, deliberately not folded into `typePerm`.
   *
   * Recording an instalment and verifying it are different jobs, so `Verify` is its own action and
   * is *not* granted by a project assignment — a site engineer who can record what Head Office sent
   * must not also be the one who confirms it. Add follows the same assignment rule as the rest of
   * the page, because whoever runs the site is usually the one who knows a transfer landed.
   */
  function allocPerm(projectId?: string) {
    const resource = `${MODULE}.Budget Allocation`;
    const assigned = projectId
      ? isAssignedTo(projectId)
      : visibleProjects.some(p => isAssignedTo(p.id));
    return {
      view:   monthlyPerm.view || can('View', resource),
      add:    can('Add', resource) || assigned,
      verify: can('Verify', resource),
      remove: can('Delete', resource),
    };
  }
  const anyAllocPerm = (() => {
    const p = allocPerm();
    return p.add || p.verify || p.remove;
  })();

  const anyRowActionPerm = [totalPerm, fyPerm, monthlyPerm, categoryPerm].some(p => p.add || p.edit || p.del)
    || anyAllocPerm;

  /**
   * The allocation rows for one project-month.
   *
   * Indexed once rather than filtered per row: the tree renders a dozen months for each of many
   * projects, and a linear scan of the whole ledger inside each of those cells is the kind of thing
   * that only shows up as sluggishness once a site has a year of instalments behind it.
   */
  const allocationIndex = useMemo(() => {
    const index = new Map<string, SASBudgetAllocation[]>();
    for (const allocation of allAllocations) {
      const key = `${allocation.projectId}:${allocation.period}`;
      const bucket = index.get(key);
      if (bucket) bucket.push(allocation); else index.set(key, [allocation]);
    }
    return index;
  }, [allAllocations]);

  const allocationsForMonth = useMemo(
    () => (projectId: string, period: string) => allocationIndex.get(`${projectId}:${period}`) ?? [],
    [allocationIndex]
  );

  /**
   * What a month's budget actually is, and what is still waiting to become part of it.
   *
   * `legacy` is the single figure on the old monthly budget document. It is added to the verified
   * allocations rather than replaced by them, so installations that set budgets before the ledger
   * existed keep the number they have been spending against.
   */
  const monthlyBudgetFor = useMemo(() => (projectId: string, period: string) => {
    const legacyRow = allBudgets.find(
      b => b.projectId === projectId && b.budgetType === 'monthly' && b.period === period
    ) ?? null;
    const allocations = allocationsForMonth(projectId, period);
    const summary = summariseAllocations(allocations);
    return {
      legacyRow,
      legacy: legacyRow?.budgetAmount ?? 0,
      allocations,
      approved: summary.approved,
      pending: summary.pending,
      pendingCount: summary.pendingCount,
      approvedCount: summary.approvedCount,
      effective: effectiveMonthlyBudget(legacyRow?.budgetAmount ?? 0, allocations),
    };
  }, [allBudgets, allocationsForMonth]);

  // Budget-type tabs the current role is allowed to create in the Set Budget dialog.
  const addableBudgetTabs = useMemo(() => [
    ...(totalPerm.add   ? [{ value: 'total'   as BudgetTab, label: 'Total' }]          : []),
    ...(fyPerm.add      ? [{ value: 'fy'      as BudgetTab, label: 'Financial Year' }] : []),
    ...(monthlyPerm.add ? [{ value: 'monthly' as BudgetTab, label: 'Monthly' }]        : []),
  ], [totalPerm.add, fyPerm.add, monthlyPerm.add]);

  // Auto-expand all projects + current FY on first load; months stay collapsed until clicked
  useEffect(() => {
    if (!loading && !initialized && visibleProjects.length > 0) {
      setExpandedProjects(new Set(visibleProjects.map(p => p.id)));
      const curFY = fyLabel(currentFYStart());
      setExpandedFYs(new Set(visibleProjects.map(p => `${p.id}:${curFY}`)));
      setInitialized(true);
    }
  }, [loading, initialized, visibleProjects]);

  /**
   * A project's overall budget: explicit total → sum of FY budgets → sum of monthly budgets.
   *
   * This is the cascade the tree rows have always used. The summary cards and the status filter
   * below used to sum only the *monthly* rows, so a project with an explicit total budget and no
   * monthly breakdown showed ₹0 in the header while the row beneath it showed the real figure, and
   * the "No Budget Set" filter hid projects that plainly had one.
   */
  const projectBudgetTotal = useMemo(() => (projectId: string): number => {
    const explicit = allBudgets.find(b => b.projectId === projectId && b.budgetType === 'total');
    if (explicit && explicit.budgetAmount > 0) return explicit.budgetAmount;
    const fySum = allBudgets
      .filter(b => b.projectId === projectId && b.budgetType === 'fy')
      .reduce((s, b) => s + (b.budgetAmount || 0), 0);
    if (fySum > 0) return fySum;
    const monthSum = allBudgets
      .filter(b => b.projectId === projectId && b.budgetType === 'monthly')
      .reduce((s, b) => s + (b.budgetAmount || 0), 0);
    // Verified allocations are monthly budget too, so a project funded entirely through the
    // allocation ledger still rolls up to a real total instead of showing ₹0.
    const allocSum = allAllocations
      .filter(a => a.projectId === projectId && a.status === 'approved')
      .reduce((s, a) => s + (Number(a.amount) || 0), 0);
    return monthSum + allocSum;
  }, [allBudgets, allAllocations]);

  // ── Summary cards ─────────────────────────────────────────────────────────────
  const summary = useMemo(() => {
    const ids = new Set(visibleProjects.map(p => p.id));
    const budget   = [...ids].reduce((s, id) => s + projectBudgetTotal(id), 0);
    const spent    = allExpenses.filter(e => ids.has(e.projectId)).reduce((s, e) => s + (e.expenseAmount || 0), 0);
    const received = allPayments.filter(p => ids.has(p.projectId)).reduce((s, p) => s + (p.receivedAmount || 0), 0);
    const overCount = [...ids].filter(id => {
      const projectBudget = projectBudgetTotal(id);
      const projectSpent = allExpenses.filter(e => e.projectId === id).reduce((s, e) => s + (e.expenseAmount || 0), 0);
      return projectBudget > 0 && projectSpent > projectBudget;
    }).length;
    return { budget, spent, received, overCount };
  }, [visibleProjects, projectBudgetTotal, allExpenses, allPayments]);

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
        // Same cascade as the rows themselves, so "No Budget Set" means what it says.
        const projectBudget = projectBudgetTotal(p.id);
        const spent = allExpenses.filter(e => e.projectId === p.id).reduce((s, e) => s + (e.expenseAmount || 0), 0);
        const pct   = projectBudget > 0 ? (spent / projectBudget) * 100 : 0;
        if (filterStatus === 'no-budget'    && projectBudget > 0) return false;
        if (filterStatus === 'on-track'     && !(projectBudget > 0 && pct < 80)) return false;
        if (filterStatus === 'warning'      && !(projectBudget > 0 && pct >= 80 && spent <= projectBudget)) return false;
        if (filterStatus === 'over-budget'  && !(projectBudget > 0 && spent > projectBudget)) return false;
      }
      return true;
    });
  }, [visibleProjects, filterSearch, filterFY, filterStatus, allBudgets, allExpenses, projectBudgetTotal]);


  // ── Tree helpers ──────────────────────────────────────────────────────────────
  function getRelevantFYs(projectId: string): number[] {
    const fySet = new Set<number>([currentFYStart()]);
    allBudgets.filter(b => b.projectId === projectId).forEach(b => {
      if (b.budgetType === 'fy'      && b.period) fySet.add(parseInt(b.period.split('-')[0]));
      if (b.budgetType === 'monthly' && b.period) fySet.add(getFYStartFromDate(b.period + '-01'));
    });
    allExpenses.filter(e => e.projectId === projectId).forEach(e => fySet.add(getFYStartFromDate(e.expenseDate)));
    allCatBudgets.filter(b => b.projectId === projectId && b.period).forEach(b => fySet.add(getFYStartFromDate(b.period + '-01')));
    allAllocations.filter(a => a.projectId === projectId && a.period).forEach(a => fySet.add(getFYStartFromDate(a.period + '-01')));
    return [...fySet].sort((a, b) => b - a);
  }

  function getRelevantMonths(projectId: string, fyStartYear: number): string[] {
    const cur = currentMonthStr();
    return getFYMonths(fyStartYear).filter(m =>
      m === cur ||
      allBudgets.some(b => b.projectId === projectId && b.budgetType === 'monthly' && b.period === m) ||
      allExpenses.some(e => e.projectId === projectId && e.expenseDate.startsWith(m)) ||
      allCatBudgets.some(b => b.projectId === projectId && b.period === m) ||
      // A month whose only budget is a recorded allocation still has to be reachable — including
      // while that allocation is pending, or nobody could open the ledger to verify it.
      allocationsForMonth(projectId, m).length > 0
    );
  }

  /**
   * Category names to list under a month.
   *
   * Only *main* categories. Spend is attributed by `expenseCategory`, which never holds a
   * sub-category name, so listing sub-categories here produced rows that could never show a rupee
   * of spend — and, worse, invited an admin to set a budget against one, which then rolled up into
   * the month's total alongside its parent and double-counted it.
   *
   * Names already carried by a stored budget or a recorded expense are still included even if the
   * category has since been renamed or deactivated, so historical rows do not silently vanish.
   */
  const mainCategoryNames = useMemo(
    () => new Set(categories.filter(c => !c.parentId).map(c => c.name).filter(Boolean)),
    [categories]
  );

  function getMonthCategories(projectId: string, month: string): string[] {
    const names = new Set<string>(mainCategoryNames);
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
    const missingLabel = validateFieldControlRequirements('siteFundBudget', { notes: form.notes }, field);
    if (missingLabel) { toast({ title: 'Validation', description: `${missingLabel} is required.`, variant: 'destructive' }); return; }

    // Defense in depth — the dialog only ever offers tabs/actions the role can use,
    // but re-check here in case dialogTab was left over from a different context.
    const typePermForTab = dialogTab === 'total' ? totalPerm : dialogTab === 'fy' ? fyPerm : monthlyPerm;
    const allowed = editingBudget ? typePermForTab.edit : typePermForTab.add;
    if (!allowed) { toast({ title: 'Not allowed', description: 'You do not have permission to set this budget type.', variant: 'destructive' }); return; }

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
      /*
       * Moving a budget moves every threshold line with it. `sentThresholds` was append-only, so
       * raising a budget after its 80% alert had fired meant 80% of the *new* budget could never
       * alert. Clearing this scope re-arms it.
       */
      void resetBudgetAlertState({
        projectId: form.projectId,
        ...(dialogTab === 'total' ? { scopeType: 'total' as const } : { period, scopeType: dialogTab }),
      });
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(budget: SASBudget) {
    const typePerm = budget.budgetType === 'total' ? totalPerm : budget.budgetType === 'fy' ? fyPerm : monthlyPerm;
    if (!typePerm.del) {
      toast({ title: 'Not allowed', description: 'You do not have permission to delete this budget type.', variant: 'destructive' });
      return;
    }
    try {
      await deleteDoc(doc(db, SAS_COLLECTIONS.budgets, budget.id));
      void log('Delete SAS Budget', { project: budget.projectName, type: budget.budgetType, period: budget.period });
      toast({ title: 'Deleted', description: 'Budget deleted.' });
      void loadAll();
      // Removing a budget falls the scope back to a rolled-up figure, which sits its thresholds
      // somewhere new — so the sent ledger for this project is no longer meaningful.
      void resetBudgetAlertState({ projectId: budget.projectId });
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
    if (!categoryPerm.add && !categoryPerm.edit) {
      toast({ title: 'Not allowed', description: 'You do not have permission to set category budgets.', variant: 'destructive' });
      return;
    }
    const bulkCategories = categories.filter(c => !c.parentId);

    /*
     * A blanked or zeroed field *removes* that category's budget.
     *
     * The grid used to save only rows with an amount greater than zero, so clearing a field left
     * the old value in place and there was no way to undo a budget set by mistake other than
     * hunting the row down in the tree. The dialog is pre-filled with the stored amounts, so an
     * emptied field is an unambiguous instruction to remove it.
     */
    const toSave = bulkCategories.filter(cat => Number(bulkAmounts[cat.name]) > 0);
    const toRemove = bulkCategories.filter(cat => {
      const entered = (bulkAmounts[cat.name] ?? '').trim();
      const cleared = entered === '' || Number(entered) === 0;
      const existed = allCatBudgets.some(b =>
        b.projectId === bulkProject.id && b.period === bulkMonth && b.categoryName === cat.name
      );
      return cleared && existed;
    });

    if (toSave.length === 0 && toRemove.length === 0) {
      toast({ title: 'Nothing to save', description: 'Enter a budget amount for at least one category.', variant: 'destructive' });
      return;
    }
    if (toRemove.length > 0 && !categoryPerm.del) {
      toast({ title: 'Not allowed', description: 'You do not have permission to remove category budgets.', variant: 'destructive' });
      return;
    }

    setBulkSaving(true);
    try {
      await Promise.all([
        ...toSave.map(async cat => {
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
        }),
        ...toRemove.map(async cat => {
          const existing = allCatBudgets.find(b =>
            b.projectId === bulkProject.id && b.period === bulkMonth && b.categoryName === cat.name
          );
          if (existing) await deleteDoc(doc(db, SAS_COLLECTIONS.categoryBudgets, existing.id));
        }),
      ]);

      const savedPart   = toSave.length   ? `${toSave.length} set`      : '';
      const removedPart = toRemove.length ? `${toRemove.length} removed` : '';
      toast({
        title: 'Saved',
        description: `${[savedPart, removedPart].filter(Boolean).join(', ')} for ${monthLabel(bulkMonth)}.`,
      });
      setBulkDialogOpen(false);
      void loadAll();
      // Changing a budget changes where its thresholds sit, so the "already sent" ledger for this
      // project's category scope has to be cleared or those thresholds can never fire again.
      void resetBudgetAlertState({ projectId: bulkProject.id, period: bulkMonth, scopeType: 'category' });
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
    const missingLabel = validateFieldControlRequirements('categoryBudget', { notes: catDialogNotes }, categoryBudgetField);
    if (missingLabel) { toast({ title: 'Validation', description: `${missingLabel} is required.`, variant: 'destructive' }); return; }
    if (!catDialogProject) return;
    if (!(catEditingBudget ? categoryPerm.edit : categoryPerm.add)) {
      toast({ title: 'Not allowed', description: 'You do not have permission to set category budgets.', variant: 'destructive' });
      return;
    }

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
      void resetBudgetAlertState({ projectId: catDialogProject.id, period: catDialogMonth, scopeType: 'category' });
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setCatSaving(false);
    }
  }

  async function handleCatDelete(budget: SASCategoryBudget) {
    if (!categoryPerm.del) {
      toast({ title: 'Not allowed', description: 'You do not have permission to delete category budgets.', variant: 'destructive' });
      return;
    }
    try {
      await deleteDoc(doc(db, SAS_COLLECTIONS.categoryBudgets, budget.id));
      toast({ title: 'Removed', description: 'Category budget removed.' });
      void loadAll();
      void resetBudgetAlertState({ projectId: budget.projectId, period: budget.period, scopeType: 'category' });
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
  }

  // ── PDF Approval upload helpers ───────────────────────────────────────────────
  async function handlePdfUpload(projectId: string, projectName: string, period: string, file: File) {
    if (!monthlyPerm.add) {
      toast({ title: 'Not allowed', description: 'You do not have permission to upload monthly budget approvals.', variant: 'destructive' });
      return;
    }
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
    if (!monthlyPerm.del) {
      toast({ title: 'Not allowed', description: 'You do not have permission to remove monthly budget approvals.', variant: 'destructive' });
      return;
    }
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
    if (!monthlyPerm.add) {
      toast({ title: 'Not allowed', description: 'You do not have permission to import monthly budgets.', variant: 'destructive' });
      return;
    }
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
      // Every project the sheet touched now has different threshold lines.
      void Promise.allSettled(
        [...new Set(valid.map(row => row.projectId))].map(projectId => resetBudgetAlertState({ projectId }))
      );
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
        { header: 'Name',           key: 'name',      width: 38 },
        { header: 'Budget (₹)',     key: 'budget',    width: 16 },
        { header: 'Received (₹)',   key: 'received',  width: 16 },
        { header: 'Spent (₹)',      key: 'spent',     width: 16 },
        { header: 'Remaining (₹)', key: 'remaining', width: 16 },
        { header: '% Used',         key: 'pctUsed',   width: 12 },
        { header: 'Status',         key: 'status',    width: 14 },
        { header: 'Notes',          key: 'notes',     width: 30 },
      ];
      ws.getRow(1).font = { bold: true };
      ws.views = [{ state: 'frozen', ySplit: 1 }];

      /*
       * Parent rows sit *above* their children, which is the opposite of Excel's default
       * assumption that a group's summary row comes last. Without this the collapse controls line
       * up against the wrong rows and folding a project hides the project instead of its contents.
       */
      // ExcelJS 3.10 honours these at runtime — written and read back to confirm — but its bundled
      // typings leave `outlineProperties` off `WorksheetProperties`. Widened to exactly the shape
      // being assigned rather than to `any`, so the assignment itself stays type-checked.
      (ws.properties as typeof ws.properties & {
        outlineProperties?: { summaryBelow: boolean; summaryRight: boolean };
      }).outlineProperties = { summaryBelow: false, summaryRight: false };

      /**
       * Writes one node of the tree.
       *
       * `depth` drives three things at once: Excel's own row grouping (the +/− controls in the
       * gutter, so Total → FY → Month → Category collapses like the on-screen tree), the visual
       * indent, and the weight of the type. Indentation is set through the cell's alignment rather
       * than by padding the string with spaces — a real indent survives sorting, and leaves the
       * name column filterable on the actual name.
       */
      const TINTS = ['FFE8F5EE', 'FFEFF4FB', 'FFFDF6E9', undefined];
      function addNode(depth: 0 | 1 | 2 | 3, data: Record<string, unknown>) {
        const row = ws.addRow(data);
        row.outlineLevel = depth;
        row.getCell('name').alignment = { indent: depth * 2 };
        if (depth === 0) row.font = { bold: true };
        if (depth === 1) row.font = { bold: true, color: { argb: 'FF1F4E79' } };
        const tint = TINTS[depth];
        if (tint) {
          row.eachCell({ includeEmpty: true }, cell => {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: tint } };
          });
        }
      }

      /*
       * Each level also gets its own flat sheet.
       *
       * The tree sheet is for reading: one shared header, and a "Budget" column that silently means
       * four different things depending on the row's depth. That is fine to look at and useless to
       * analyse — you cannot sort it, filter it, or drop it into a pivot without first working out
       * which rows are which. So the walk below also collects each level into its own list, written
       * afterwards with headers that name that level's fields and with the parent context carried
       * on every row, so each sheet stands alone.
       */
      type LevelRow = Record<string, string | number | null>;
      const totalRows: LevelRow[] = [];
      const fyRows: LevelRow[] = [];
      const monthRows: LevelRow[] = [];
      const categoryRows: LevelRow[] = [];

      /** Percentages are stored as fractions so Excel can sort them; the cell format shows a %. */
      const pctOf = (part: number, whole: number) => (whole > 0 ? part / whole : null);
      /** Absent budgets stay blank rather than becoming an em dash, which would make the column text. */
      const amount = (value: number) => (value > 0 ? value : null);

      for (const project of visibleProjects) {
        const pExp = allExpenses.filter(e => e.projectId === project.id);
        const pPay = allPayments.filter(p => p.projectId === project.id);
        const tb   = allBudgets.find(b => b.projectId === project.id && b.budgetType === 'total');
        const tSpent = pExp.reduce((s, e) => s + (e.expenseAmount || 0), 0);
        const tRcvd  = pPay.reduce((s, p) => s + (p.receivedAmount || 0), 0);
        const exportFySumAll = allBudgets.filter(b => b.projectId === project.id && b.budgetType === 'fy').reduce((s, b) => s + b.budgetAmount, 0);
        // Mirrors `projectBudgetTotal`: verified allocations are monthly budget, so the export
        // cannot read only the legacy rows without disagreeing with the screen it was run from.
        const exportMonthSumAll = allBudgets.filter(b => b.projectId === project.id && b.budgetType === 'monthly').reduce((s, b) => s + b.budgetAmount, 0)
          + allAllocations.filter(a => a.projectId === project.id && a.status === 'approved').reduce((s, a) => s + (Number(a.amount) || 0), 0);
        const tAmt   = tb ? tb.budgetAmount : exportFySumAll > 0 ? exportFySumAll : exportMonthSumAll;
        if (totalPerm.view) {
          addNode(0, {
            level: 'Total',
            name: project.projectName + (project.projectCode ? ` (${project.projectCode})` : ''),
            budget: tAmt || '—', received: tRcvd, spent: tSpent,
            remaining: tAmt > 0 ? tAmt - tSpent : '—',
            pctUsed: tAmt > 0 ? formatPct((tSpent / tAmt) * 100) : '—',
            status: tAmt === 0 ? 'No Budget' : tSpent > tAmt ? 'Over Budget' : (tSpent / tAmt) * 100 >= 80 ? 'Warning' : 'On Track',
            notes: tb?.notes || '',
          });
          totalRows.push({
            project: project.projectName,
            code: project.projectCode || '',
            budget: amount(tAmt),
            received: tRcvd,
            spent: tSpent,
            remaining: tAmt > 0 ? tAmt - tSpent : null,
            pctUsed: pctOf(tSpent, tAmt),
            status: tAmt === 0 ? 'No Budget' : tSpent > tAmt ? 'Over Budget' : (tSpent / tAmt) * 100 >= 80 ? 'Warning' : 'On Track',
            notes: tb?.notes || '',
          });
        }

        for (const fyS of getRelevantFYs(project.id)) {
          const r   = fyRange(fyS);
          const fyB = allBudgets.find(b => b.projectId === project.id && b.budgetType === 'fy' && b.period === fyLabel(fyS));
          const fySpent = pExp.filter(e => e.expenseDate >= r.start && e.expenseDate <= r.end).reduce((s, e) => s + (e.expenseAmount || 0), 0);
          const fyRcvd  = pPay.filter(p => p.receiptDate >= r.start && p.receiptDate <= r.end).reduce((s, p) => s + (p.receivedAmount || 0), 0);
          const exportFyMonthSum = getRelevantMonths(project.id, fyS).reduce(
            (s, m) => s + monthlyBudgetFor(project.id, m).effective, 0);
          if (!fyB && fySpent === 0 && exportFyMonthSum === 0) continue;
          const fAmt = fyB ? fyB.budgetAmount : exportFyMonthSum;
          if (fyPerm.view) {
            addNode(1, {
              level: 'Financial Year', name: `FY ${fyLabel(fyS)}`,
              budget: fAmt || '—', received: fyRcvd, spent: fySpent,
              remaining: fAmt > 0 ? fAmt - fySpent : '—',
              pctUsed: fAmt > 0 ? formatPct((fySpent / fAmt) * 100) : '—',
              status: fAmt === 0 ? 'No Budget' : fySpent > fAmt ? 'Over Budget' : (fySpent / fAmt) * 100 >= 80 ? 'Warning' : 'On Track',
              notes: fyB?.notes || '',
            });
            fyRows.push({
              project: project.projectName,
              code: project.projectCode || '',
              fy: `FY ${fyLabel(fyS)}`,
              budget: amount(fAmt),
              received: fyRcvd,
              spent: fySpent,
              remaining: fAmt > 0 ? fAmt - fySpent : null,
              pctUsed: pctOf(fySpent, fAmt),
              status: fAmt === 0 ? 'No Budget' : fySpent > fAmt ? 'Over Budget' : (fySpent / fAmt) * 100 >= 80 ? 'Warning' : 'On Track',
              notes: fyB?.notes || '',
            });
          }

          for (const m of getRelevantMonths(project.id, fyS)) {
            const mAlloc = monthlyBudgetFor(project.id, m);
            const mB = mAlloc.legacyRow;
            const mSpent = pExp.filter(e => e.expenseDate.startsWith(m)).reduce((s, e) => s + (e.expenseAmount || 0), 0);
            const mRcvd  = pPay.filter(p => p.receiptDate.startsWith(m)).reduce((s, p) => s + (p.receivedAmount || 0), 0);
            if (mAlloc.effective === 0 && mSpent === 0 && !allCatBudgets.some(b => b.projectId === project.id && b.period === m)) continue;
            const mAmt = mAlloc.effective;
            // The notes column carries the instalment breakdown, so a reader of the spreadsheet can
            // see that a month's figure is three sanctions rather than one, and what is still
            // waiting on a reviewer.
            const allocNote = [
              mAlloc.approvedCount > 0 ? `${mAlloc.approvedCount} verified allocation(s)` : '',
              mAlloc.pending > 0 ? `${formatINR(mAlloc.pending)} pending verification (not counted)` : '',
            ].filter(Boolean).join('; ');
            if (monthlyPerm.view) {
              addNode(2, {
                level: 'Month', name: monthLabel(m),
                budget: mAmt || '—', received: mRcvd, spent: mSpent,
                remaining: mAmt > 0 ? mAmt - mSpent : '—',
                pctUsed: mAmt > 0 ? formatPct((mSpent / mAmt) * 100) : '—',
                status: mAmt === 0 ? 'No Budget' : mSpent > mAmt ? 'Over Budget' : (mSpent / mAmt) * 100 >= 80 ? 'Warning' : 'On Track',
                notes: [mB?.notes || '', allocNote].filter(Boolean).join(' · '),
              });
              monthRows.push({
                project: project.projectName,
                code: project.projectCode || '',
                fy: `FY ${fyLabel(fyS)}`,
                month: monthLabel(m),
                period: m,
                budget: amount(mAmt),
                received: mRcvd,
                spent: mSpent,
                remaining: mAmt > 0 ? mAmt - mSpent : null,
                pctUsed: pctOf(mSpent, mAmt),
                status: mAmt === 0 ? 'No Budget' : mSpent > mAmt ? 'Over Budget' : (mSpent / mAmt) * 100 >= 80 ? 'Warning' : 'On Track',
                notes: [mB?.notes || '', allocNote].filter(Boolean).join(' · '),
              });
            }

            // Category rows
            if (categoryPerm.view) {
              for (const cat of getMonthCategories(project.id, m)) {
                const cb = allCatBudgets.find(b => b.projectId === project.id && b.period === m && b.categoryName === cat);
                const cSpent = pExp.filter(e => e.expenseDate.startsWith(m) && e.expenseCategory === cat).reduce((s, e) => s + (e.expenseAmount || 0), 0);
                if (!cb && cSpent === 0) continue;
                const cAmt = cb?.budgetAmount ?? 0;
                addNode(3, {
                  level: 'Category', name: cat,
                  budget: cAmt || '—', received: '—', spent: cSpent,
                  remaining: cAmt > 0 ? cAmt - cSpent : '—',
                  pctUsed: cAmt > 0 ? formatPct((cSpent / cAmt) * 100) : '—',
                  status: !cb ? 'No Budget' : cSpent > cAmt ? 'Over' : (cSpent / cAmt) * 100 >= 80 ? 'Near Limit' : 'OK',
                  notes: cb?.notes || '',
                });
                categoryRows.push({
                  project: project.projectName,
                  code: project.projectCode || '',
                  fy: `FY ${fyLabel(fyS)}`,
                  month: monthLabel(m),
                  period: m,
                  category: cat,
                  budget: amount(cAmt),
                  spent: cSpent,
                  remaining: cAmt > 0 ? cAmt - cSpent : null,
                  pctUsed: pctOf(cSpent, cAmt),
                  status: !cb ? 'No Budget' : cSpent > cAmt ? 'Over' : (cSpent / cAmt) * 100 >= 80 ? 'Near Limit' : 'OK',
                  notes: cb?.notes || '',
                });
              }
            }
          }
        }
      }

      /**
       * Writes one level's flat sheet: its own header, its own field names, one row per record.
       *
       * Skipped entirely when the level produced nothing, so an installation that never sets
       * category budgets does not ship an empty tab that looks like a bug.
       */
      function addLevelSheet(
        title: string,
        columns: { header: string; key: string; width: number; numFmt?: string }[],
        rows: LevelRow[],
      ) {
        if (rows.length === 0) return;
        const sheet = wb.addWorksheet(title);
        sheet.columns = columns.map(({ key, width }) => ({ key, width }));
        sheet.addRow(columns.map(c => c.header)).font = { bold: true };
        sheet.views = [{ state: 'frozen', ySplit: 1 }];

        rows.forEach(record => sheet.addRow(record));

        // Formats go on the column so they apply to rows added above and any added later.
        columns.forEach((column, index) => {
          if (column.numFmt) sheet.getColumn(index + 1).numFmt = column.numFmt;
        });

        // Filter handles on the header, so each sheet is usable on its own.
        sheet.autoFilter = {
          from: { row: 1, column: 1 },
          to: { row: rows.length + 1, column: columns.length },
        };
      }

      const MONEY = '#,##0';
      const PCT = '0.0%';

      addLevelSheet('Total', [
        { header: 'Project',        key: 'project',   width: 30 },
        { header: 'Code',           key: 'code',      width: 12 },
        { header: 'Total Budget',   key: 'budget',    width: 16, numFmt: MONEY },
        { header: 'Received',       key: 'received',  width: 16, numFmt: MONEY },
        { header: 'Spent',          key: 'spent',     width: 16, numFmt: MONEY },
        { header: 'Remaining',      key: 'remaining', width: 16, numFmt: MONEY },
        { header: '% Used',         key: 'pctUsed',   width: 10, numFmt: PCT },
        { header: 'Status',         key: 'status',    width: 14 },
        { header: 'Notes',          key: 'notes',     width: 30 },
      ], totalRows);

      addLevelSheet('Financial Year', [
        { header: 'Project',        key: 'project',   width: 30 },
        { header: 'Code',           key: 'code',      width: 12 },
        { header: 'Financial Year', key: 'fy',        width: 14 },
        { header: 'FY Budget',      key: 'budget',    width: 16, numFmt: MONEY },
        { header: 'Received',       key: 'received',  width: 16, numFmt: MONEY },
        { header: 'Spent',          key: 'spent',     width: 16, numFmt: MONEY },
        { header: 'Remaining',      key: 'remaining', width: 16, numFmt: MONEY },
        { header: '% Used',         key: 'pctUsed',   width: 10, numFmt: PCT },
        { header: 'Status',         key: 'status',    width: 14 },
        { header: 'Notes',          key: 'notes',     width: 30 },
      ], fyRows);

      addLevelSheet('Month', [
        { header: 'Project',        key: 'project',   width: 30 },
        { header: 'Code',           key: 'code',      width: 12 },
        { header: 'Financial Year', key: 'fy',        width: 14 },
        { header: 'Month',          key: 'month',     width: 18 },
        // The sortable form of the month, since "April 2026" sorts alphabetically otherwise.
        { header: 'Period',         key: 'period',    width: 10 },
        { header: 'Monthly Budget', key: 'budget',    width: 16, numFmt: MONEY },
        { header: 'Received',       key: 'received',  width: 16, numFmt: MONEY },
        { header: 'Spent',          key: 'spent',     width: 16, numFmt: MONEY },
        { header: 'Remaining',      key: 'remaining', width: 16, numFmt: MONEY },
        { header: '% Used',         key: 'pctUsed',   width: 10, numFmt: PCT },
        { header: 'Status',         key: 'status',    width: 14 },
        { header: 'Notes',          key: 'notes',     width: 30 },
      ], monthRows);

      // No Received column: money arrives from Head Office against a project, never a category.
      addLevelSheet('Category', [
        { header: 'Project',         key: 'project',   width: 30 },
        { header: 'Code',            key: 'code',      width: 12 },
        { header: 'Financial Year',  key: 'fy',        width: 14 },
        { header: 'Month',           key: 'month',     width: 18 },
        { header: 'Period',          key: 'period',    width: 10 },
        { header: 'Category',        key: 'category',  width: 26 },
        { header: 'Category Budget', key: 'budget',    width: 16, numFmt: MONEY },
        { header: 'Spent',           key: 'spent',     width: 16, numFmt: MONEY },
        { header: 'Remaining',       key: 'remaining', width: 16, numFmt: MONEY },
        { header: '% Used',          key: 'pctUsed',   width: 10, numFmt: PCT },
        { header: 'Status',          key: 'status',    width: 14 },
        { header: 'Notes',           key: 'notes',     width: 30 },
      ], categoryRows);

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

  const hasAnyBudgetAccess = canView || canAdd || canEdit ||
    [totalPerm, fyPerm, monthlyPerm, categoryPerm].some(p => p.view || p.add || p.edit || p.del);
  if (!hasAnyBudgetAccess) {
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
      <PageHeader
        title="Site Fund Budget"
        description="Hierarchical tracking — Total → FY-wise → Month-wise → Category-wise"
        actions={(canExport || monthlyPerm.add || totalPerm.add || fyPerm.add) ? (
          <>
            {canExport && (
              <Button variant="outline" size="sm" onClick={exportExcel} disabled={exporting} className="gap-2">
                {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                Export
              </Button>
            )}
            {monthlyPerm.add && (
              <Button variant="outline" size="sm" className="gap-2" onClick={() => document.getElementById('budget-upload-input')?.click()}>
                <Upload className="h-4 w-4" /> Upload Approval Sheet
              </Button>
            )}
            {(totalPerm.add || fyPerm.add || monthlyPerm.add) && (
              <Button size="sm" onClick={() => openAdd(undefined, totalPerm.add ? 'total' : fyPerm.add ? 'fy' : 'monthly')} className="gap-2 bg-emerald-700 hover:bg-emerald-800">
                <Plus className="h-4 w-4" /> Set Budget
              </Button>
            )}
          </>
        ) : undefined}
      />
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
      <TableCard
        title="Budget tree"
        count={filteredProjects.length}
        total={visibleProjects.length}
        noun="project"
        toolbar={
          <FilterBar
            search={{ value: filterSearch, onChange: setFilterSearch, placeholder: 'Search project...' }}
            activeCount={(filterStatus !== 'all' ? 1 : 0) + (filterFY !== 'all' ? 1 : 0)}
            onClear={() => { setFilterSearch(''); setFilterStatus('all'); setFilterFY('all'); }}
          >
          <Select value={filterFY} onValueChange={v => setFilterFY(v)}>
            <SelectTrigger aria-label="Financial year">
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
            <SelectTrigger aria-label="Budget status">
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
          </FilterBar>
        }
      >
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
              <Table className="min-w-[800px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[220px]">Project / Period</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Budget (₹)</TableHead>
                    {/* Money actually received from Head Office for the period on this row. Budget
                        is what was sanctioned; Received is what has landed — a site can be well
                        inside its budget and still unable to spend, which the other columns hide. */}
                    <TableHead className="text-right whitespace-nowrap">Received (₹)</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Spent (₹)</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Remaining (₹)</TableHead>
                    <TableHead className="min-w-[130px]">Usage</TableHead>
                    <TableHead>Status</TableHead>
                    {anyRowActionPerm && <TableHead className="text-right">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(() => {
                    const filterFYStart = filterFY !== 'all' ? parseInt(filterFY) : null;
                    return filteredProjects.map(project => {
                    /*
                     * Write rights are evaluated against *this* project, so an assignment on one
                     * project no longer confers budget-editing rights over a project the user can
                     * only view. Read rights stay page-level — they are pure RBAC.
                     */
                    const totalPerm    = typePerm('Total Budget',    project.id);
                    const fyPerm       = typePerm('FY Budget',       project.id);
                    const monthlyPerm  = typePerm('Monthly Budget',  project.id);
                    const categoryPerm = typePerm('Category Budget', project.id);
                    // NOTE: the Actions *column* is kept in step with the page-level
                    // `anyRowActionPerm` used by the header, so every row has the same cell count.
                    // Only the buttons inside it are gated per project.

                    const totalBudget = allBudgets.find(b => b.projectId === project.id && b.budgetType === 'total') ?? null;
                    const pExp    = allExpenses.filter(e => e.projectId === project.id);
                    const pPay    = allPayments.filter(p => p.projectId === project.id);
                    const tSpent  = pExp.reduce((s, e) => s + (e.expenseAmount  || 0), 0);
                    const tRcvd   = pPay.reduce((s, p) => s + (p.receivedAmount || 0), 0);
                    // Cascade: explicit total → sum of FY budgets → sum of all monthly budgets
                    const fyBudgetSumAll = allBudgets
                      .filter(b => b.projectId === project.id && b.budgetType === 'fy')
                      .reduce((s, b) => s + b.budgetAmount, 0);
                    const monthBudgetSumAll = allBudgets
                      .filter(b => b.projectId === project.id && b.budgetType === 'monthly')
                      .reduce((s, b) => s + b.budgetAmount, 0)
                      + allAllocations
                        .filter(a => a.projectId === project.id && a.status === 'approved')
                        .reduce((s, a) => s + (Number(a.amount) || 0), 0);
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
                        <TableRow className={cn(isExpanded ? 'bg-emerald-50/50' : '')}>
                          <TableCell>
                            <button onClick={() => toggleProject(project.id)} className="flex items-center gap-2 font-semibold text-slate-800 hover:text-emerald-700 transition-colors">
                              {isExpanded
                                ? <ChevronDown  className="h-4 w-4 text-emerald-600 shrink-0" />
                                : <ChevronRight className="h-4 w-4 text-slate-400 shrink-0" />}
                              {project.projectName}
                              {project.projectCode && (
                                <Badge variant="outline" className="font-mono font-normal">
                                  {project.projectCode}
                                </Badge>
                              )}
                            </button>
                          </TableCell>
                          <TableCell className="text-right font-medium text-emerald-700">
                            {!totalPerm.view ? <RestrictedCell /> : tAmt > 0
                              ? <div>
                                  {formatINR(tAmt)}
                                  {tBudgetSource === 'fy-sum' && <p className="text-[10px] font-normal text-muted-foreground">∑ FY budgets</p>}
                                  {tBudgetSource === 'month-sum' && <p className="text-[10px] font-normal text-muted-foreground">∑ monthly budgets</p>}
                                </div>
                              : <span className="text-muted-foreground text-xs">—</span>}
                          </TableCell>
                          <TableCell className="text-right text-blue-700 font-medium">
                            {totalPerm.view ? formatINR(tRcvd) : <RestrictedCell />}
                          </TableCell>
                          <TableCell className="text-right text-rose-700 font-medium">
                            {totalPerm.view ? formatINR(tSpent) : <RestrictedCell />}
                          </TableCell>
                          <TableCell className={cn('text-right font-medium', tAmt === 0 ? 'text-muted-foreground' : tAmt - tSpent < 0 ? 'text-destructive' : 'text-indigo-700')}>
                            {!totalPerm.view ? <RestrictedCell /> : tAmt > 0 ? formatINR(tAmt - tSpent) : '—'}
                          </TableCell>
                          <TableCell>
                            {!totalPerm.view ? <RestrictedCell /> : tAmt > 0 ? (
                              <div className="space-y-1 min-w-[110px]">
                                <Progress value={tPct} className="h-2" />
                                <p className="text-xs text-muted-foreground">{formatPct(tPct)}</p>
                              </div>
                            ) : <span className="text-xs text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell>
                            {totalPerm.view
                              ? <BudgetStatusBadge budget={tAmt > 0 ? { budgetAmount: tAmt } as SASBudget : null} spent={tSpent} />
                              : <RestrictedCell />}
                          </TableCell>
                          {anyRowActionPerm && (
                            <TableCell className="text-right">
                              <div className="flex justify-end items-center gap-1">
                                {totalPerm.edit && (
                                  totalBudget
                                    ? <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openEdit(totalBudget)}><Pencil className="h-3 w-3" /></Button>
                                    : <Button variant="outline" size="sm" className="h-6 text-[11px] gap-0.5 text-emerald-700 border-emerald-200 hover:bg-emerald-50 px-2" onClick={() => openAdd(project, 'total')}><Plus className="h-2.5 w-2.5" />Set Total</Button>
                                )}
                                {totalPerm.del && totalBudget && (
                                  <DeleteConfirm label={`Remove total budget for ${project.projectName}?`} onConfirm={() => handleDelete(totalBudget)} />
                                )}
                              </div>
                            </TableCell>
                          )}
                        </TableRow>

                        {/* ══ Level 1 — FY rows ══ */}
                        {isExpanded && fys.map(fyS => {
                          const fyKey   = `${project.id}:${fyLabel(fyS)}`;
                          // When a FY filter is active, auto-expand matching FY to show months
                          const isFYExp = expandedFYs.has(fyKey) || filterFYStart !== null;
                          const r       = fyRange(fyS);
                          const fyB     = allBudgets.find(b => b.projectId === project.id && b.budgetType === 'fy' && b.period === fyLabel(fyS)) ?? null;
                          const fySpent = pExp.filter(e => e.expenseDate >= r.start && e.expenseDate <= r.end).reduce((s, e) => s + (e.expenseAmount || 0), 0);
                          const fyRcvd  = pPay.filter(p => p.receiptDate >= r.start && p.receiptDate <= r.end).reduce((s, p) => s + (p.receivedAmount || 0), 0);
                          const isCurFY = fyS === curFYStart;
                          const months  = getRelevantMonths(project.id, fyS);
                          // Cascade: explicit FY budget → sum of monthly budgets in this FY
                          const fyMonthSum = months.reduce(
                            (s, m) => s + monthlyBudgetFor(project.id, m).effective, 0);
                          // Instalments across the year that nobody has verified yet, surfaced on
                          // the FY row so a reviewer sees there is a queue without opening months.
                          const fyPendingCount = months.reduce(
                            (s, m) => s + monthlyBudgetFor(project.id, m).pendingCount, 0);
                          const fAmt    = fyB ? fyB.budgetAmount : fyMonthSum;
                          const fBudgetSource = fyB ? 'explicit' : 'month-sum';
                          const fyPct   = fAmt > 0 ? Math.min((fySpent / fAmt) * 100, 100) : 0;

                          return (
                            <Fragment key={fyKey}>

                              {/* FY row */}
                              <TableRow className={cn(isFYExp ? 'bg-blue-50/30' : 'bg-slate-50/60')}>
                                <TableCell className="pl-10">
                                  <button onClick={() => toggleFY(fyKey)} className="flex items-center gap-2 font-medium text-slate-700 hover:text-blue-700 transition-colors">
                                    {months.length > 0
                                      ? isFYExp
                                        ? <ChevronDown  className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                                        : <ChevronRight className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                                      : <span className="w-3.5 h-3.5 shrink-0" />}
                                    <Target className="h-3 w-3 text-emerald-600 shrink-0" />
                                    <span>FY {fyLabel(fyS)}</span>
                                    {isCurFY && <Badge variant="info">Current FY</Badge>}
                                    {fyPendingCount > 0 && (
                                      <span
                                        title={`${fyPendingCount} budget allocation(s) awaiting verification this financial year`}
                                        className="flex items-center gap-0.5 rounded bg-amber-100 px-1 py-px text-[10px] font-medium text-amber-800"
                                      >
                                        <Clock className="h-2.5 w-2.5 shrink-0" />
                                        {fyPendingCount} to verify
                                      </span>
                                    )}
                                  </button>
                                </TableCell>
                                <TableCell className="text-right font-medium text-emerald-700">
                                  {!fyPerm.view ? <RestrictedCell /> : fAmt > 0
                                    ? <div>
                                        {formatINR(fAmt)}
                                        {fBudgetSource === 'month-sum' && <p className="text-[10px] font-normal text-muted-foreground">∑ monthly budgets</p>}
                                      </div>
                                    : <span className="text-muted-foreground text-xs">—</span>}
                                </TableCell>
                                <TableCell className="text-right text-blue-700">
                                  {!fyPerm.view ? <RestrictedCell /> : fyRcvd > 0 ? formatINR(fyRcvd) : <span className="text-muted-foreground text-xs">—</span>}
                                </TableCell>
                                <TableCell className="text-right text-rose-700">
                                  {!fyPerm.view ? <RestrictedCell /> : fySpent > 0 ? formatINR(fySpent) : <span className="text-muted-foreground text-xs">—</span>}
                                </TableCell>
                                <TableCell className={cn('text-right font-medium', fAmt === 0 ? 'text-muted-foreground' : fAmt - fySpent < 0 ? 'text-destructive' : 'text-indigo-700')}>
                                  {!fyPerm.view ? <RestrictedCell /> : fAmt > 0 ? formatINR(fAmt - fySpent) : '—'}
                                </TableCell>
                                <TableCell>
                                  {!fyPerm.view ? <RestrictedCell /> : fAmt > 0 ? (
                                    <div className="space-y-1 min-w-[110px]">
                                      <Progress value={fyPct} className="h-1.5" />
                                      <p className="text-xs text-muted-foreground">{formatPct(fyPct)}</p>
                                    </div>
                                  ) : <span className="text-xs text-muted-foreground">—</span>}
                                </TableCell>
                                <TableCell>
                                  {fyPerm.view
                                    ? <BudgetStatusBadge budget={fAmt > 0 ? { budgetAmount: fAmt } as SASBudget : null} spent={fySpent} />
                                    : <RestrictedCell />}
                                </TableCell>
                                {anyRowActionPerm && (
                                  <TableCell className="text-right">
                                    <div className="flex justify-end items-center gap-1">
                                      {fyPerm.edit && (
                                        fyB
                                          ? <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openEdit(fyB)}><Pencil className="h-3 w-3" /></Button>
                                          : <Button variant="outline" size="sm" className="h-6 text-[11px] gap-0.5 text-emerald-700 border-emerald-200 hover:bg-emerald-50 px-2" onClick={() => openAdd(project, 'fy', fyS)}><Plus className="h-2.5 w-2.5" />Set FY</Button>
                                      )}
                                      {fyPerm.del && fyB && (
                                        <DeleteConfirm label={`Remove FY ${fyLabel(fyS)} budget for ${project.projectName}?`} onConfirm={() => handleDelete(fyB)} size="sm" />
                                      )}
                                    </div>
                                  </TableCell>
                                )}
                              </TableRow>

                              {/* ══ Level 2 — Month rows ══ */}
                              {isFYExp && months.map(m => {
                                const monthKey = `${project.id}:${m}`;
                                const isMoExp  = expandedMonths.has(monthKey);
                                const alloc    = monthlyBudgetFor(project.id, m);
                                const mB       = alloc.legacyRow;
                                const mPerm    = allocPerm(project.id);
                                const approval = allApprovals.find(a => a.projectId === project.id && a.period === m);
                                const isPdfUploading = pdfUploadingKey === `${project.id}:${m}`;
                                const mSpent   = pExp.filter(e => e.expenseDate.startsWith(m)).reduce((s, e) => s + (e.expenseAmount || 0), 0);
                                const mRcvd    = pPay.filter(p => p.receiptDate?.startsWith(m)).reduce((s, p) => s + (p.receivedAmount || 0), 0);
                                // Roll-up: if no monthly budget, sum category budgets for this month
                                const catBudgetSum = allCatBudgets
                                  .filter(b => b.projectId === project.id && b.period === m)
                                  .reduce((s, b) => s + b.budgetAmount, 0);
                                /*
                                 * The month's spendable budget: the legacy single figure plus every
                                 * verified allocation, falling back to the category roll-up only
                                 * when neither exists. Pending allocations are deliberately absent
                                 * — an unverified instalment must not move the line that spending
                                 * and alerts are measured against.
                                 */
                                const mAmt     = alloc.effective > 0 ? alloc.effective : catBudgetSum;
                                const mPct     = mAmt > 0 ? Math.min((mSpent / mAmt) * 100, 100) : 0;
                                // How much of monthly budget has been allocated to categories
                                const catAllocated = catBudgetSum;
                                const showCatAlloc = mAmt > 0 && mAmt !== catBudgetSum && catAllocated > 0;
                                const isCurMo  = m === curMonth;
                                const catRows  = getMonthCategories(project.id, m);

                                return (
                                  <Fragment key={m}>
                                    <TableRow className={cn(isCurMo ? 'bg-amber-50/40' : isMoExp ? 'bg-amber-50/20' : '')}>
                                      <TableCell className="pl-14">
                                        <button
                                          onClick={() => toggleMonth(monthKey)}
                                          className="flex items-center gap-1.5 text-slate-600 hover:text-amber-700 transition-colors"
                                        >
                                          {isMoExp
                                            ? <ChevronDown  className="h-3 w-3 text-amber-500 shrink-0" />
                                            : <ChevronRight className="h-3 w-3 text-slate-400 shrink-0" />}
                                          <Calendar className="h-3 w-3 text-slate-400 shrink-0" />
                                          <span className="text-xs">{monthLabel(m)}</span>
                                          {isCurMo && <Badge variant="info">This Month</Badge>}
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
                                          {alloc.pendingCount > 0 && (
                                            <span
                                              title={`${alloc.pendingCount} allocation(s) worth ${formatINR(alloc.pending)} awaiting verification`}
                                              className="flex items-center gap-0.5 rounded bg-amber-100 px-1 py-px text-[10px] font-medium text-amber-800"
                                            >
                                              <Clock className="h-2.5 w-2.5 shrink-0" />
                                              {alloc.pendingCount} to verify
                                            </span>
                                          )}
                                        </button>
                                      </TableCell>
                                      <TableCell className="text-right font-medium text-emerald-700">
                                        {!monthlyPerm.view ? <RestrictedCell /> : mAmt > 0 || alloc.pending > 0
                                          ? <div>
                                              {mAmt > 0 ? formatINR(mAmt) : <span className="text-muted-foreground">—</span>}
                                              {mAmt > 0 && alloc.effective === 0 && (
                                                <p className="text-[10px] font-normal text-muted-foreground">∑ categories</p>
                                              )}
                                              {alloc.approvedCount > 0 && (
                                                <p className="text-[10px] font-normal text-muted-foreground">
                                                  {alloc.approvedCount} verified allocation{alloc.approvedCount > 1 ? 's' : ''}
                                                  {alloc.legacy > 0 && <> + {formatINR(alloc.legacy)} base</>}
                                                </p>
                                              )}
                                              {/* Shown but never added in: pending money is not budget. */}
                                              {alloc.pending > 0 && (
                                                <p className="text-[10px] font-normal text-amber-700">
                                                  + {formatINR(alloc.pending)} pending
                                                </p>
                                              )}
                                              {showCatAlloc && (
                                                <p className={cn('text-[10px] font-normal', catAllocated > mAmt ? 'text-destructive' : 'text-muted-foreground')}>
                                                  {formatINR(catAllocated)} to categories
                                                </p>
                                              )}
                                            </div>
                                          : <span className="text-muted-foreground">—</span>}
                                      </TableCell>
                                      <TableCell className="text-right text-blue-700">
                                        {!monthlyPerm.view ? <RestrictedCell /> : mRcvd > 0 ? formatINR(mRcvd) : <span className="text-muted-foreground">—</span>}
                                      </TableCell>
                                      <TableCell className="text-right text-rose-700">
                                        {!monthlyPerm.view ? <RestrictedCell /> : mSpent > 0 ? formatINR(mSpent) : <span className="text-muted-foreground">—</span>}
                                      </TableCell>
                                      <TableCell className={cn('text-right font-medium', mAmt === 0 ? 'text-muted-foreground' : mAmt - mSpent < 0 ? 'text-destructive' : 'text-indigo-700')}>
                                        {!monthlyPerm.view ? <RestrictedCell /> : mAmt > 0 ? formatINR(mAmt - mSpent) : '—'}
                                      </TableCell>
                                      <TableCell>
                                        {!monthlyPerm.view ? <RestrictedCell /> : mAmt > 0 ? (
                                          <div className="space-y-0.5 min-w-[110px]">
                                            <Progress value={mPct} className="h-1.5" />
                                            <p className="text-[11px] text-muted-foreground">{formatPct(mPct)}</p>
                                          </div>
                                        ) : <span className="text-xs text-muted-foreground">—</span>}
                                      </TableCell>
                                      <TableCell>
                                        {monthlyPerm.view
                                          ? <BudgetStatusBadge budget={mAmt > 0 ? { budgetAmount: mAmt } as SASBudget : null} spent={mSpent} />
                                          : <RestrictedCell />}
                                      </TableCell>
                                      {anyRowActionPerm && (
                                        <TableCell className="text-right">
                                          <div className="flex justify-end items-center gap-1">
                                            {monthlyPerm.edit && (
                                              mB
                                                ? <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openEdit(mB)}><Pencil className="h-3 w-3" /></Button>
                                                : monthlyPerm.add && <Button variant="outline" size="sm" className="h-6 text-[11px] gap-0.5 text-emerald-700 border-emerald-200 hover:bg-emerald-50 px-2" onClick={() => openAdd(project, 'monthly', fyS, m)}><Plus className="h-2.5 w-2.5" />Set</Button>
                                            )}
                                            {(mPerm.view || mPerm.add) && (
                                              <Button
                                                variant="outline" size="sm"
                                                className={cn(
                                                  'h-6 gap-0.5 px-2 text-[11px]',
                                                  alloc.pendingCount > 0
                                                    ? 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100'
                                                    : 'border-violet-200 text-violet-700 hover:bg-violet-50',
                                                )}
                                                title="Instalments sanctioned for this month"
                                                onClick={() => setAllocDialog({ project, period: m })}
                                              >
                                                <Split className="h-2.5 w-2.5" />
                                                Allocations
                                                {alloc.allocations.length > 0 && <> ({alloc.allocations.length})</>}
                                              </Button>
                                            )}
                                            {(categoryPerm.add || categoryPerm.edit) && (
                                              <Button
                                                variant="outline" size="sm"
                                                className="h-6 text-[11px] gap-0.5 text-teal-700 border-teal-200 hover:bg-teal-50 px-2"
                                                title="Set category budgets for this month"
                                                onClick={() => openBulkCatDialog(project, m)}
                                              >
                                                <Layers className="h-2.5 w-2.5" />Categories
                                              </Button>
                                            )}
                                            {monthlyPerm.del && mB && (
                                              <DeleteConfirm label={`Remove ${monthLabel(m)} budget for ${project.projectName}?`} onConfirm={() => handleDelete(mB)} size="sm" />
                                            )}
                                            {/* PDF approval buttons */}
                                            {monthlyPerm.add && (
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
                                            {approval && monthlyPerm.view && (
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
                                                {monthlyPerm.del && (
                                                  <DeleteConfirm
                                                    label={`Remove approval copy for ${monthLabel(m)}?`}
                                                    onConfirm={() => handleDeleteApproval(approval)}
                                                    size="sm"
                                                  />
                                                )}
                                              </>
                                            )}
                                          </div>
                                        </TableCell>
                                      )}
                                    </TableRow>

                                    {/* ══ Level 3 — Category rows ══ */}
                                    {isMoExp && catRows.map(cat => {
                                      const catB    = allCatBudgets.find(b => b.projectId === project.id && b.period === m && b.categoryName === cat);
                                      const cSpent  = pExp.filter(e => e.expenseDate.startsWith(m) && e.expenseCategory === cat).reduce((s, e) => s + (e.expenseAmount || 0), 0);
                                      const cAmt    = catB?.budgetAmount ?? 0;
                                      const cPct    = cAmt > 0 ? Math.min((cSpent / cAmt) * 100, 100) : 0;

                                      return (
                                        <TableRow key={`${m}:${cat}`} className="bg-slate-50/30">
                                          <TableCell className="pl-20">
                                            <div className="flex items-center gap-1.5">
                                              <Layers className="h-2.5 w-2.5 text-teal-400 shrink-0" />
                                              <span className="text-xs text-slate-600">{cat}</span>
                                            </div>
                                          </TableCell>
                                          <TableCell className="text-right font-medium text-emerald-700">
                                            {!categoryPerm.view ? <RestrictedCell /> : catB ? formatINR(cAmt) : <span className="text-muted-foreground text-xs">—</span>}
                                          </TableCell>
                                          {/* Receipts arrive from Head Office against the project as
                                              a whole, never against a category, so there is nothing
                                              to show here. */}
                                          <TableCell className="text-right text-muted-foreground">—</TableCell>
                                          <TableCell className="text-right text-rose-700">
                                            {!categoryPerm.view ? <RestrictedCell /> : cSpent > 0 ? formatINR(cSpent) : <span className="text-muted-foreground text-xs">—</span>}
                                          </TableCell>
                                          <TableCell className={cn('text-right font-medium',
                                            !catB ? 'text-muted-foreground' : cAmt - cSpent < 0 ? 'text-destructive' : 'text-indigo-700')}>
                                            {!categoryPerm.view ? <RestrictedCell /> : catB ? formatINR(cAmt - cSpent) : '—'}
                                          </TableCell>
                                          <TableCell>
                                            {!categoryPerm.view ? <RestrictedCell /> : catB ? (
                                              <div className="space-y-0.5 min-w-[110px]">
                                                <Progress value={cPct} className="h-1" />
                                                <p className="text-[10px] text-muted-foreground">{formatPct(cPct)}</p>
                                              </div>
                                            ) : <span className="text-xs text-muted-foreground">—</span>}
                                          </TableCell>
                                          <TableCell>
                                            {categoryPerm.view ? <CatStatusBadge budget={catB} spent={cSpent} /> : <RestrictedCell />}
                                          </TableCell>
                                          {anyRowActionPerm && (
                                            <TableCell className="text-right">
                                              <div className="flex justify-end gap-1">
                                                {categoryPerm.edit && catB && (
                                                  <Button variant="ghost" size="icon" className="h-5 w-5" title="Edit budget" onClick={() => openCatEdit(catB)}>
                                                    <Pencil className="h-2.5 w-2.5" />
                                                  </Button>
                                                )}
                                                {categoryPerm.del && catB && (
                                                  <DeleteConfirm label={`Remove ${cat} budget for ${monthLabel(m)}?`} onConfirm={() => handleCatDelete(catB)} size="sm" />
                                                )}
                                              </div>
                                            </TableCell>
                                          )}
                                        </TableRow>
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
                </TableBody>
              </Table>
          )}
      </TableCard>

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
                {addableBudgetTabs.length > 1 && (
                  <Tabs value={dialogTab} onValueChange={v => setDialogTab(v as BudgetTab)}>
                    <TabsList className={cn('grid w-full', addableBudgetTabs.length === 2 ? 'grid-cols-2' : 'grid-cols-3')}>
                      {addableBudgetTabs.map(t => <TabsTrigger key={t.value} value={t.value}>{t.label}</TabsTrigger>)}
                    </TabsList>
                  </Tabs>
                )}

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
              <Label>{field('projectId').label} <span className="text-destructive">*</span></Label>
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
              <Label>{field('budgetAmount').label} <span className="text-destructive">*</span></Label>
              <Input
                type="number" min="0"
                value={form.budgetAmount}
                onChange={e => setForm(f => ({ ...f, budgetAmount: e.target.value }))}
                placeholder="Enter budget amount"
              />
            </div>

            <ControlledField setting={field('notes')}>
              <Textarea rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional notes" />
            </ControlledField>

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
              <Label>{categoryBudgetField('amount').label} <span className="text-destructive">*</span></Label>
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
            <ControlledField setting={categoryBudgetField('notes')}>
              <Input
                value={catDialogNotes}
                onChange={e => setCatDialogNotes(e.target.value)}
                placeholder="Optional notes..."
                className="h-9"
              />
            </ControlledField>
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
            <div className="rounded-lg border">
              <Table containerClassName="max-h-[50vh]">
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>Project</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead className="text-right">Amount (₹)</TableHead>
                    <TableHead>Notes</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {uploadRows.map(r => (
                    <TableRow key={r.rowNum} className={cn(!r.valid && 'bg-rose-50/60')}>
                      <TableCell className="tabular-nums">{r.rowNum}</TableCell>
                      <TableCell>{r.projectName}</TableCell>
                      <TableCell className="font-mono whitespace-nowrap">{r.period || '—'}</TableCell>
                      <TableCell className="text-right whitespace-nowrap tabular-nums font-medium text-emerald-700">{r.amount > 0 ? formatINR(r.amount) : '—'}</TableCell>
                      <TableCell className="truncate max-w-[120px]">{r.notes || '—'}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {r.valid
                          ? <StatusBadge status="Valid" />
                          : <StatusBadge status="Error" title={r.error} />}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
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

      {/* ══ Monthly allocation ledger ══ */}
      {allocDialog && (
        <BudgetAllocationsDialog
          open
          onOpenChange={open => { if (!open) setAllocDialog(null); }}
          projectId={allocDialog.project.id}
          projectName={allocDialog.project.projectName}
          period={allocDialog.period}
          periodLabel={monthLabel(allocDialog.period)}
          allocations={allocationsForMonth(allocDialog.project.id, allocDialog.period)}
          legacyAmount={monthlyBudgetFor(allocDialog.project.id, allocDialog.period).legacy}
          permissions={allocPerm(allocDialog.project.id)}
          onChanged={() => {
            void loadAll();
            // Verifying, reopening or rejecting moves the spendable budget, so the "you have
            // crossed 80%" markers for this month are stale the moment it happens — clearing them
            // lets the alert fire again against the new figure instead of staying silent.
            void resetBudgetAlertState({
              projectId: allocDialog.project.id,
              period: allocDialog.period,
              scopeType: 'monthly',
            });
          }}
        />
      )}
    </div>
  );
}
