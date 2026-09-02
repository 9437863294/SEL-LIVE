'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  addDoc, collection, deleteDoc, doc, getDocs, orderBy, query, serverTimestamp, setDoc, updateDoc,
} from 'firebase/firestore';
import {
  deleteObject, getDownloadURL, ref as storageRef, uploadBytesResumable, type UploadTask,
} from 'firebase/storage';
import { db } from '@/lib/firebase';
import { storage } from '@/lib/firebase-storage';
import {
  formatINR, PAYMENT_MODES, SAS_COLLECTIONS,
  type SASAttachment, type SASCategory, type SASExpense, type SASProject,
} from '@/lib/site-account-statement';
import {
  aggregateLedger, allExpenses as fetchAllExpenses, cumulativeBefore, cumulativeThrough,
  expensesPage, SAS_PAGE_SIZE, type SASCursor, type SASLedgerScope,
} from '@/lib/site-account-statement-queries';
import { resetBudgetAlertState, runBudgetAlertChecks } from '@/lib/sas-budget-alerts';
import { useFieldControl, validateFieldControlRequirements } from '@/components/site-account-statement/use-field-control';
import { fieldMark } from '@/components/site-account-statement/controlled-field';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useActivityLogger } from '@/hooks/useActivityLogger';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  AlertTriangle, Calendar, Camera, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight,
  Download, ExternalLink, File, FileText, Filter, Image, Loader2,
  Paperclip, Pencil, Plus, Receipt, RotateCw, Trash2, TrendingDown, TrendingUp, Upload, Wallet, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import ExcelJS from 'exceljs';
import { VehicleImportDialog, type ImportField } from '@/components/vehicle-management/import-dialog';

const MODULE    = 'Site Account Statement';
const RESOURCE  = 'Expenses';
const ACCEPT    = '.pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.txt';
const MAX_SIZE  = 5 * 1024 * 1024; // 5 MB

/**
 * A document the user picked in the dialog. Files start uploading to Storage the
 * moment they are selected — the expense can only be recorded once every one of
 * them reaches `done`.
 */
interface PendingUpload {
  id: string;
  file: File;
  progress: number;                 // 0–100
  status: 'uploading' | 'done' | 'error';
  error?: string;
  attachment?: SASAttachment;       // set once the file lands in the bucket
}

interface FormState {
  projectId: string;
  projectName: string;
  expenseCategoryId: string;
  expenseCategory: string;
  expenseSubCategory: string;
  narration: string;
  expensedBy: string;
  expenseDate: string;
  expenseAmount: string;
  paymentMode: string;
  vendorPartyName: string;
  billNo: string;
  isGstBill: boolean;
  remarks: string;
}

const blank = (): FormState => ({
  projectId: '', projectName: '',
  expenseCategoryId: '', expenseCategory: '', expenseSubCategory: '',
  narration: '', expensedBy: '', expenseDate: '', expenseAmount: '',
  paymentMode: 'Cash', vendorPartyName: '', billNo: '', isGstBill: false, remarks: '',
});

function getMonthRange(fromDate?: string, offset = 0) {
  let y: number, m: number;
  if (fromDate) {
    const parts = fromDate.split('-').map(Number);
    y = parts[0]; m = parts[1] - 1 + offset;
  } else {
    const now = new Date();
    y = now.getFullYear(); m = now.getMonth() + offset;
  }
  // normalise overflow (e.g. month 13 → next year)
  const d = new Date(y, m, 1);
  y = d.getFullYear(); m = d.getMonth();
  const start = `${y}-${String(m + 1).padStart(2, '0')}-01`;
  const lastDay = new Date(y, m + 1, 0).getDate();
  const end   = `${y}-${String(m + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { start, end, year: y, month: m };
}

function timestampMillis(ts: any): number | null {
  const d: Date | null = ts?.toDate?.() ?? (ts?.seconds ? new Date(ts.seconds * 1000) : null);
  return d && !isNaN(d.getTime()) ? d.getTime() : null;
}

function formatTimestamp(ts: any): string {
  if (!ts) return '—';
  const d: Date | null = ts?.toDate?.() ?? (ts?.seconds ? new Date(ts.seconds * 1000) : null);
  if (!d || isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

function formatSize(bytes: number): string {
  if (bytes < 1024)    return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function AttachmentIcon({ type }: { type: string }) {
  if (type.startsWith('image/')) return <Image className="h-4 w-4 text-sky-500 shrink-0" />;
  if (type === 'application/pdf')  return <FileText className="h-4 w-4 text-rose-500 shrink-0" />;
  return <File className="h-4 w-4 text-slate-400 shrink-0" />;
}

export default function SiteExpensesPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { log } = useActivityLogger('Site Account Statement');
  const { toast } = useToast();
  const { user } = useAuth();
  const { field } = useFieldControl('expense');
  const fileInputRef   = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  // Expense id the attachments upload under — the row's own id when editing, a
  // pre-allocated Firestore id when adding (so uploads can start before save).
  const targetExpenseIdRef = useRef<string>('');
  const uploadTasksRef     = useRef<Map<string, UploadTask>>(new Map());

  const canViewAll = can('View', `${MODULE}.All Projects`);
  const canAdd    = can('Add',    `${MODULE}.${RESOURCE}`);
  const canEdit   = can('Edit',   `${MODULE}.${RESOURCE}`);
  const canDelete = can('Delete', `${MODULE}.${RESOURCE}`);
  const canExport = can('Export', `${MODULE}.${RESOURCE}`);
  const canImport = canAdd;

  const [projects,      setProjects]      = useState<SASProject[]>([]);
  const [categories,    setCategories]    = useState<SASCategory[]>([]);
  const [expenses,      setExpenses]      = useState<SASExpense[]>([]);
  const [loading,              setLoading]              = useState(true);
  const [loadingMore,          setLoadingMore]          = useState(false);
  const [staticLoaded,         setStaticLoaded]         = useState(false);
  /** Bumped after every write to re-run the scope loader without duplicating its logic. */
  const [reloadToken,          setReloadToken]          = useState(0);
  const [pageCursor,           setPageCursor]           = useState<SASCursor | null>(null);
  /** Server-side sum + count for the whole filtered period — not just the rows on screen. */
  const [periodTotals,         setPeriodTotals]         = useState<{ total: number; count: number } | null>(null);
  const [openingBalance,       setOpeningBalance]       = useState<number | null>(null);
  const [periodReceipts,       setPeriodReceipts]       = useState(0);
  /** Cumulative project figures through the period end, for the summary strip and the dialog. */
  const [projectToDate,        setProjectToDate]        = useState<{ received: number; spent: number } | null>(null);
  const [saving,           setSaving]           = useState(false);
  const [exporting,        setExporting]        = useState(false);
  const [dialogOpen,       setDialogOpen]       = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [editingRow,       setEditingRow]       = useState<SASExpense | null>(null);
  const [form,             setForm]             = useState<FormState>(blank());

  // Attachment state
  const [uploads,             setUploads]             = useState<PendingUpload[]>([]);
  const [existingAttachments, setExistingAttachments] = useState<SASAttachment[]>([]);
  const [removedAttachments,  setRemovedAttachments]  = useState<SASAttachment[]>([]);
  const [viewDocExpense,      setViewDocExpense]      = useState<SASExpense | null>(null);
  const [viewExpense,         setViewExpense]         = useState<SASExpense | null>(null);

  // Filters — default to current month
  const [filterProject,     setFilterProject]     = useState('');
  const [filterCategory,    setFilterCategory]    = useState('');
  const [filterSubCategory, setFilterSubCategory] = useState('');
  const [filterMode,        setFilterMode]        = useState('');
  const [filterGstOnly,     setFilterGstOnly]     = useState(false);
  const [filterFrom,        setFilterFrom]        = useState(() => getMonthRange().start);
  const [filterTo,          setFilterTo]          = useState(() => getMonthRange().end);
  const [search,            setSearch]            = useState('');
  const [showFilters,       setShowFilters]       = useState(false);

  // Load projects + categories once on mount
  useEffect(() => {
    if (!isAuthLoading) void loadStatic();
  }, [isAuthLoading]);

  async function loadStatic() {
    setLoading(true);
    try {
      const [pSnap, catSnap] = await Promise.all([
        getDocs(query(collection(db, SAS_COLLECTIONS.projects), orderBy('projectName'))),
        getDocs(query(collection(db, SAS_COLLECTIONS.categories), orderBy('name'))),
      ]);
      setProjects(pSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASProject)).filter(p => p.enabledForSiteAccount && p.status === 'Active'));
      setCategories(catSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASCategory)).filter(c => c.isActive !== false));
      setStaticLoaded(true);
    } catch (e: any) {
      // Failing silently here rendered an empty, apparently-working page: no projects, no
      // categories, and no hint that anything had gone wrong.
      setLoading(false);
      toast({
        title: 'Could not load projects',
        description: e?.message || 'Check your connection and reload the page.',
        variant: 'destructive',
      });
    }
  }

  const mainCategories    = useMemo(() => categories.filter(c => !c.parentId), [categories]);
  const subCategories     = useMemo(() => categories.filter(c => !!c.parentId), [categories]);
  const formSubCategories = useMemo(
    () => subCategories.filter(c => c.parentId === form.expenseCategoryId),
    [subCategories, form.expenseCategoryId]
  );
  const filterSubCategoryOptions = useMemo(
    () => filterCategory
      ? subCategories.filter(c => {
          const main = mainCategories.find(m => m.name === filterCategory);
          return main ? c.parentId === main.id : false;
        })
      : subCategories,
    [filterCategory, subCategories, mainCategories]
  );

  const visibleProjects = useMemo(
    () => canViewAll ? projects : projects.filter(p =>
      p.assignedPersonId === user?.id || p.altUserId === user?.id || p.viewerId === user?.id
    ),
    [projects, user?.id, canViewAll]
  );
  const userProjectIds = useMemo(
    () => canViewAll ? null : new Set(visibleProjects.map(p => p.id)),
    [visibleProjects, canViewAll]
  );

  /** The project scope every server query is bounded by — `null` only for All-Projects holders. */
  const scopeProjectIds = useMemo<string[] | null>(
    () => canViewAll ? null : visibleProjects.map(p => p.id),
    [canViewAll, visibleProjects]
  );

  /*
   * Whether the user may write to a *specific* project.
   *
   * This used to be a single page-wide boolean — "am I the alt user on any project at all" — which
   * was then OR-ed into `canAdd`/`canEdit` for every project in the dropdown. Because that dropdown
   * also lists projects where the user is only the *viewer*, being alt user on one project silently
   * granted write access to every project they could see, including read-only ones. Write rights
   * are now decided per project, from that project's own row.
   */
  const canWriteToProject = useMemo(() => (projectId: string): boolean => {
    if (canViewAll || canAdd || canEdit) return true;
    const project = projects.find(p => p.id === projectId);
    if (!project) return false;
    return project.assignedPersonId === user?.id || project.altUserId === user?.id;
  }, [canViewAll, canAdd, canEdit, projects, user?.id]);

  /** Projects the user may actually record an expense against — what the form's dropdown offers. */
  const writableProjects = useMemo(
    () => visibleProjects.filter(p => canWriteToProject(p.id)),
    [visibleProjects, canWriteToProject]
  );

  // The toolbar buttons only need to know whether *any* project is writable.
  const effectiveCanAdd    = canAdd    || writableProjects.length > 0;
  const effectiveCanEdit   = canEdit   || writableProjects.length > 0;
  const effectiveCanImport = canImport || writableProjects.length > 0;

  // ── Server-side scope ────────────────────────────────────────────────────────

  /*
   * The scope every server query on this page shares.
   *
   * Filters that Firestore can answer with an equality constraint (project, main category, payment
   * mode, GST flag) are pushed down here, so the paginated rows AND the aggregate totals below them
   * describe exactly the same set. Sub-category and free-text search stay client-side over the rows
   * already loaded — they refine what is shown, and the strip is explicit that "Total shown" is the
   * loaded subset while the period figures come from the server.
   */
  const ledgerScope = useMemo<SASLedgerScope>(() => ({
    projectIds: filterProject ? [filterProject] : scopeProjectIds,
    from: filterFrom,
    to: filterTo,
    expenseCategory: filterCategory || undefined,
    paymentMode: filterMode || undefined,
    isGstBill: filterGstOnly || undefined,
  }), [filterProject, scopeProjectIds, filterFrom, filterTo, filterCategory, filterMode, filterGstOnly]);

  /** Stable identity for the scope, so the loader effect fires on real changes only. */
  const scopeKey = useMemo(() => JSON.stringify({
    ...ledgerScope,
    projectIds: ledgerScope.projectIds ? [...ledgerScope.projectIds].sort() : null,
  }), [ledgerScope]);

  // ── Page + aggregate loading ─────────────────────────────────────────────────

  useEffect(() => {
    if (!staticLoaded) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const receiptScope: SASLedgerScope = {
          projectIds: ledgerScope.projectIds,
          from: filterFrom,
          to: filterTo,
        };

        // One page of rows, plus every figure the summary strip needs — all computed on the
        // server, so they stay correct no matter how few rows are actually on screen.
        const [page, expenseAgg, receiptAgg, priorExpenses, priorReceipts] = await Promise.all([
          expensesPage(ledgerScope, { pageSize: SAS_PAGE_SIZE }),
          aggregateLedger('expenses', ledgerScope),
          aggregateLedger('payments', receiptScope),
          filterFrom ? cumulativeBefore('expenses', ledgerScope.projectIds, filterFrom) : Promise.resolve(0),
          filterFrom ? cumulativeBefore('payments', ledgerScope.projectIds, filterFrom) : Promise.resolve(0),
        ]);
        if (cancelled) return;

        setExpenses(page.rows);
        setPageCursor(page.cursor);
        setPeriodTotals({ total: expenseAgg.total, count: expenseAgg.count });
        setPeriodReceipts(receiptAgg.total);
        setOpeningBalance(filterFrom ? priorReceipts - priorExpenses : null);
      } catch (e: any) {
        if (cancelled) return;
        toast({
          title: 'Could not load expenses',
          description: e?.message || 'Check your connection and try again.',
          variant: 'destructive',
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => { cancelled = true; };
    // `scopeKey` stands in for the scope object, which is rebuilt on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staticLoaded, scopeKey, reloadToken]);

  /**
   * Cumulative received/spent for the selected project through the end of the period.
   *
   * These drive the "Available Balance" figures in the summary strip and — critically — in the Add
   * Expense dialog. They used to be derived from page state, which mixed *all-time* receipts (the
   * payments collection was loaded unfiltered) against *period-only* expenses (the expense query is
   * date-scoped, and defaults to the current month). On a project a year old that overstated
   * available funds by every rupee spent before this month — the exact number a site in-charge
   * checks before deciding whether they can afford a purchase. Both sides now come from the same
   * server-side cumulative aggregate over the same window.
   */
  /*
   * Whose cumulative figures to fetch: the project chosen in the open dialog, otherwise the one the
   * list is filtered to. Gated on `dialogOpen` so a stale `form.projectId` — the form is not
   * cleared on close — cannot keep overriding the list's own project after the dialog has gone.
   */
  const balanceTarget = (dialogOpen && form.projectId) ? form.projectId : filterProject;

  useEffect(() => {
    if (!staticLoaded || !balanceTarget) { setProjectToDate(null); return; }
    let cancelled = false;

    Promise.all([
      cumulativeThrough('payments', [balanceTarget], filterTo || '9999-12-31'),
      cumulativeThrough('expenses', [balanceTarget], filterTo || '9999-12-31'),
    ])
      .then(([received, spent]) => { if (!cancelled) setProjectToDate({ received, spent }); })
      .catch(() => { if (!cancelled) setProjectToDate(null); });

    return () => { cancelled = true; };
  }, [staticLoaded, balanceTarget, filterTo, reloadToken]);

  const projectBalance = useMemo(
    () => projectToDate
      ? { ...projectToDate, balance: projectToDate.received - projectToDate.spent }
      : undefined,
    [projectToDate]
  );

  /** Shown inside the Add/Edit dialog — only once the figures are for the project it has open. */
  const formProjectBalance =
    (dialogOpen && form.projectId && balanceTarget === form.projectId) ? projectBalance : undefined;

  /** Shown in the list's summary strip, whenever a single project is filtered. */
  const filterProjectBalance =
    (filterProject && balanceTarget === filterProject) ? projectBalance : undefined;

  async function loadMore() {
    if (!pageCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await expensesPage(ledgerScope, { cursor: pageCursor, pageSize: SAS_PAGE_SIZE });
      setExpenses(prev => [...prev, ...page.rows]);
      setPageCursor(page.cursor);
    } catch (e: any) {
      toast({ title: 'Could not load more', description: e?.message, variant: 'destructive' });
    } finally {
      setLoadingMore(false);
    }
  }

  /** Re-runs the scope effect above — used after any write. */
  function loadAll() { setReloadToken(token => token + 1); }

  // ── Month navigation ─────────────────────────────────────────────────────────
  function shiftMonth(offset: number) {
    const { start, end } = getMonthRange(filterFrom, offset);
    setFilterFrom(start);
    setFilterTo(end);
  }

  function goToCurrentMonth() {
    const { start, end } = getMonthRange();
    setFilterFrom(start);
    setFilterTo(end);
  }

  const monthLabel = useMemo(() => {
    if (!filterFrom) return 'All Time';
    const [y, m] = filterFrom.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  }, [filterFrom]);

  // ── Import field definitions ──────────────────────────────────────────────────
  const expenseImportFields = useMemo<ImportField[]>(() => [
    {
      key: 'projectName', label: 'Project Name', required: true,
      hint: 'Must exactly match an enabled project name',
      validate: (v) => {
        const match = visibleProjects.find(p => p.projectName.toLowerCase() === v.trim().toLowerCase());
        return match ? null : `Project "${v}" not found`;
      },
    },
    {
      key: 'expenseCategory', label: 'Main Category', required: true,
      hint: 'Must match a configured main category',
      validate: (v) => {
        const match = mainCategories.find(c => c.name.toLowerCase() === v.trim().toLowerCase());
        return match ? null : `Main category "${v}" not found`;
      },
    },
    {
      key: 'expenseSubCategory', label: 'Sub-Category',
      hint: 'Optional — must match a sub-category under the main category',
      validate: (v) => {
        if (!v.trim()) return null;
        const match = subCategories.find(c => c.name.toLowerCase() === v.trim().toLowerCase());
        return match ? null : `Sub-category "${v}" not found`;
      },
    },
    { key: 'narration', label: 'Narration', hint: 'Brief description of payment purpose' },
    { key: 'expensedBy', label: 'Expensed By', required: true, hint: 'Name of person who spent the amount' },
    {
      key: 'expenseDate', label: 'Expense Date', required: true,
      hint: 'YYYY-MM-DD  e.g. 2024-07-15',
      validate: (v) => /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? null : 'Date must be in YYYY-MM-DD format',
    },
    {
      key: 'expenseAmount', label: 'Amount (₹)', required: true, type: 'number',
      hint: 'Positive number without commas',
      validate: (v) => Number(v) > 0 ? null : 'Amount must be greater than 0',
    },
    {
      key: 'paymentMode', label: 'Payment Mode',
      hint: `Cash | Bank | UPI | Other  (defaults to Cash if blank)`,
      validate: (v) => !v || PAYMENT_MODES.includes(v as any) ? null : `Must be one of: ${PAYMENT_MODES.join(', ')}`,
    },
    { key: 'vendorPartyName', label: 'Vendor / Party Name', hint: 'Optional' },
    { key: 'billNo',          label: 'Bill No.',            hint: 'Bill or voucher number' },
    {
      key: 'isGstBill', label: 'GST Bill',
      hint: 'Yes / No  (blank means No)',
      validate: (v) => !v.trim() || /^(yes|no|y|n|true|false|1|0)$/i.test(v.trim())
        ? null : 'Must be Yes or No',
    },
    { key: 'remarks',         label: 'Remarks' },
  ], [visibleProjects, mainCategories, subCategories]);

  /** Projects and periods touched by the running import, so alerts can be evaluated once at the end. */
  const importTouchedRef = useRef<Map<string, { periods: Set<string>; categories: Set<string>; amount: number }>>(new Map());

  async function saveExpenseRow(row: Record<string, any>) {
    const projName = String(row.projectName || '').trim();
    const proj = visibleProjects.find(p => p.projectName.toLowerCase() === projName.toLowerCase());
    if (!proj) throw new Error(`Project "${projName}" not found`);
    // Import went through `visibleProjects`, which includes projects the user can only view.
    if (!canWriteToProject(proj.id)) throw new Error(`You have read-only access to "${proj.projectName}"`);

    const catRaw  = String(row.expenseCategory || '').trim();
    const mainCat = mainCategories.find(c => c.name.toLowerCase() === catRaw.toLowerCase());
    if (!mainCat) throw new Error(`Main category "${catRaw}" not found`);

    const subCatRaw = String(row.expenseSubCategory || '').trim();
    let subCatName = '';
    if (subCatRaw) {
      const subCat = subCategories.find(c =>
        c.parentId === mainCat.id && c.name.toLowerCase() === subCatRaw.toLowerCase()
      );
      // Storing the raw text when no sub-category matched used to smuggle unvalidated values into
      // the ledger, where they match no filter and no category budget. Reject the row instead.
      if (!subCat) throw new Error(`Sub-category "${subCatRaw}" does not belong to "${mainCat.name}"`);
      subCatName = subCat.name;
    }

    const amount = Number(row.expenseAmount);
    if (!amount || amount <= 0) throw new Error('Amount must be > 0');
    const mode = PAYMENT_MODES.includes(row.paymentMode as any) ? row.paymentMode : 'Cash';
    const expenseDate = String(row.expenseDate || '').trim();

    const record = {
      projectId:          proj.id,
      projectName:        proj.projectName,
      expenseCategory:    mainCat.name,
      expenseSubCategory: subCatName,
      narration:          String(row.narration       || '').trim(),
      expensedBy:         String(row.expensedBy      || '').trim(),
      expenseDate,
      expenseAmount:      amount,
      paymentMode:        mode,
      vendorPartyName:    String(row.vendorPartyName  || '').trim(),
      billNo:             String(row.billNo           || '').trim(),
      isGstBill:          /^(yes|y|true|1)$/i.test(String(row.isGstBill || '').trim()),
      remarks:            String(row.remarks          || '').trim(),
    };

    /*
     * Import used to bypass Field Control entirely, so a spreadsheet could create records the
     * Add Expense form would have refused — an admin who made "Bill No." mandatory would find
     * imported rows without one. The same check the form runs is applied to every row.
     */
    const missingLabel = validateFieldControlRequirements('expense', {
      ...record,
      attachment: '',
    }, field);
    if (missingLabel) throw new Error(`${missingLabel} is required`);

    await addDoc(collection(db, SAS_COLLECTIONS.expenses), {
      ...record,
      attachments:        [],
      createdAt:          serverTimestamp(),
      createdBy:          user?.id   || '',
      createdByName:      user?.name || '',
      updatedAt:          serverTimestamp(),
      updatedBy:          user?.id   || '',
      updatedByName:      user?.name || '',
    });

    // Remember what changed so alerts run once for the whole import rather than per row.
    const touched = importTouchedRef.current.get(proj.id)
      ?? { periods: new Set<string>(), categories: new Set<string>(), amount: 0 };
    if (expenseDate) touched.periods.add(expenseDate.slice(0, 7));
    touched.categories.add(mainCat.name);
    touched.amount += amount;
    importTouchedRef.current.set(proj.id, touched);
  }

  /**
   * Evaluates budget alerts once an import finishes.
   *
   * Firing per row would send one email per spreadsheet line; not firing at all — which is what
   * happened before — meant a 200-row import could blow through every threshold in silence.
   */
  async function runImportAlerts() {
    const touched = importTouchedRef.current;
    importTouchedRef.current = new Map();
    for (const [projectId, entry] of touched) {
      const project = projects.find(p => p.id === projectId);
      if (!project) continue;
      await runBudgetAlertChecks({
        projectId,
        projectName: project.projectName,
        periods: [...entry.periods],
        categoryNames: [...entry.categories],
        newExpenseAmount: entry.amount,
        assignedPersonId: project.assignedPersonId,
        altUserId: project.altUserId,
      });
    }
  }

  // ── Attachment helpers ────────────────────────────────────────────────────────
  function patchUpload(id: string, patch: Partial<PendingUpload>) {
    setUploads(prev => prev.map(u => (u.id === id ? { ...u, ...patch } : u)));
  }

  function startUpload(item: PendingUpload) {
    const safeName = item.file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `siteAccountExpenses/${targetExpenseIdRef.current}/${Date.now()}-${safeName}`;
    const contentType = item.file.type || 'application/octet-stream';
    const task = uploadBytesResumable(storageRef(storage, path), item.file, { contentType });
    uploadTasksRef.current.set(item.id, task);

    task.on(
      'state_changed',
      snap => {
        const pct = snap.totalBytes > 0 ? Math.round((snap.bytesTransferred / snap.totalBytes) * 100) : 0;
        patchUpload(item.id, { progress: pct });
      },
      err => {
        uploadTasksRef.current.delete(item.id);
        // A cancelled task means the user removed the row or closed the dialog.
        if ((err as any)?.code === 'storage/canceled') return;
        patchUpload(item.id, { status: 'error', error: err.message });
      },
      async () => {
        uploadTasksRef.current.delete(item.id);
        try {
          const url = await getDownloadURL(task.snapshot.ref);
          patchUpload(item.id, {
            status: 'done',
            progress: 100,
            attachment: { name: item.file.name, url, storagePath: path, size: item.file.size, type: contentType },
          });
        } catch (e: any) {
          patchUpload(item.id, { status: 'error', error: e?.message || 'Could not read the uploaded file.' });
        }
      },
    );
  }

  function addFiles(files: File[]) {
    const tooBig = files.filter(f => f.size > MAX_SIZE);
    const ok     = files.filter(f => f.size <= MAX_SIZE);
    if (tooBig.length > 0) {
      toast({
        title: 'File too large',
        description: `${tooBig.map(f => f.name).join(', ')} exceed${tooBig.length === 1 ? 's' : ''} the 5 MB limit and were skipped.`,
        variant: 'destructive',
      });
    }
    if (ok.length === 0) return;
    const items: PendingUpload[] = ok.map((file, i) => ({
      id: `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}`,
      file, progress: 0, status: 'uploading',
    }));
    setUploads(prev => [...prev, ...items]);
    items.forEach(startUpload);
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (files.length === 0) return;
    addFiles(files);
  }

  function handleCameraSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (cameraInputRef.current) cameraInputRef.current.value = '';
    if (files.length === 0) return;
    addFiles(files);
  }

  function handleRemoveUpload(id: string) {
    const item = uploads.find(u => u.id === id);
    const task = uploadTasksRef.current.get(id);
    if (task) { uploadTasksRef.current.delete(id); task.cancel(); }
    // Already in the bucket but never committed to the expense — drop it.
    if (item?.attachment) {
      void deleteObject(storageRef(storage, item.attachment.storagePath)).catch(() => {});
    }
    setUploads(prev => prev.filter(u => u.id !== id));
  }

  function handleRetryUpload(id: string) {
    const item = uploads.find(u => u.id === id);
    if (!item) return;
    const retried: PendingUpload = { ...item, progress: 0, status: 'uploading', error: undefined };
    patchUpload(id, retried);
    startUpload(retried);
  }

  /** Cancels in-flight uploads and removes files that were uploaded but never saved. */
  function discardUnsavedUploads() {
    uploadTasksRef.current.forEach(task => task.cancel());
    uploadTasksRef.current.clear();
    const orphans = uploads.filter(u => u.attachment);
    if (orphans.length > 0) {
      void Promise.allSettled(
        orphans.map(u => deleteObject(storageRef(storage, u.attachment!.storagePath)))
      );
    }
    setUploads([]);
  }

  function handleRemoveExisting(idx: number) {
    const att = existingAttachments[idx];
    setExistingAttachments(prev => prev.filter((_, i) => i !== idx));
    setRemovedAttachments(prev => [...prev, att]);
  }

  // ── Dialog open/close ─────────────────────────────────────────────────────────
  function openAdd() {
    setEditingRow(null);
    setForm(blank());
    setUploads([]);
    setExistingAttachments([]);
    setRemovedAttachments([]);
    // Reserve the document id up front so attachments can be uploaded to their
    // final Storage path before the expense itself is written.
    targetExpenseIdRef.current = doc(collection(db, SAS_COLLECTIONS.expenses)).id;
    setDialogOpen(true);
  }

  function closeDialog() {
    discardUnsavedUploads();
    setDialogOpen(false);
  }

  function openEdit(row: SASExpense) {
    setEditingRow(row);
    const mainCat = mainCategories.find(c => c.name === row.expenseCategory);
    setForm({
      projectId: row.projectId, projectName: row.projectName,
      expenseCategoryId: mainCat?.id || '',
      expenseCategory: row.expenseCategory,
      expenseSubCategory: row.expenseSubCategory || '',
      narration: row.narration || '',
      expensedBy: row.expensedBy,
      expenseDate: row.expenseDate, expenseAmount: String(row.expenseAmount),
      paymentMode: row.paymentMode, vendorPartyName: row.vendorPartyName || '',
      billNo: row.billNo || '', isGstBill: row.isGstBill === true, remarks: row.remarks || '',
    });
    setUploads([]);
    setExistingAttachments(row.attachments ? [...row.attachments] : []);
    setRemovedAttachments([]);
    targetExpenseIdRef.current = row.id;
    setDialogOpen(true);
  }

  function setField(key: keyof FormState, value: string) { setForm(f => ({ ...f, [key]: value })); }

  function selectProject(id: string) {
    const proj = writableProjects.find(p => p.id === id);
    setForm(f => ({ ...f, projectId: id, projectName: proj?.projectName || '' }));
  }

  function selectMainCategory(id: string) {
    const cat = mainCategories.find(c => c.id === id);
    setForm(f => ({ ...f, expenseCategoryId: id, expenseCategory: cat?.name || '', expenseSubCategory: '' }));
  }

  // ── Submit ────────────────────────────────────────────────────────────────────
  async function handleSubmit() {
    // Nothing is recorded while a document is still in flight — the expense and
    // its attachments must land together.
    const stillUploading = uploads.filter(u => u.status === 'uploading');
    if (stillUploading.length > 0) {
      toast({
        title: 'Upload in progress',
        description: `Wait for ${stillUploading.length} document${stillUploading.length > 1 ? 's' : ''} to finish uploading before recording the expense.`,
        variant: 'destructive',
      });
      return;
    }
    const failedUploads = uploads.filter(u => u.status === 'error');
    if (failedUploads.length > 0) {
      toast({
        title: 'Upload failed',
        description: `Retry or remove ${failedUploads.map(u => u.file.name).join(', ')} before recording the expense.`,
        variant: 'destructive',
      });
      return;
    }
    const uploadedAttachments = uploads.map(u => u.attachment).filter(Boolean) as SASAttachment[];

    // Project, Expense Date and Amount always stay mandatory — everything else
    // (including the document upload) follows the Field Control settings.
    if (!form.projectId)        { toast({ title: 'Validation', description: 'Select a project.',         variant: 'destructive' }); return; }
    if (!form.expenseDate)      { toast({ title: 'Validation', description: 'Expense date is required.', variant: 'destructive' }); return; }
    const amount = Number(form.expenseAmount);
    if (!amount || amount <= 0) { toast({ title: 'Validation', description: 'Enter a valid amount.',     variant: 'destructive' }); return; }

    // Re-check write access against the project actually chosen, not against a page-wide flag.
    if (!canWriteToProject(form.projectId)) {
      toast({ title: 'Not allowed', description: 'You have read-only access to this project.', variant: 'destructive' });
      return;
    }

    const missingLabel = validateFieldControlRequirements('expense', {
      expenseCategory: form.expenseCategory,
      expenseSubCategory: form.expenseSubCategory,
      expensedBy: form.expensedBy,
      paymentMode: form.paymentMode,
      vendorPartyName: form.vendorPartyName,
      billNo: form.billNo,
      isGstBill: form.isGstBill,
      narration: form.narration,
      remarks: form.remarks,
      attachment: uploadedAttachments.length + existingAttachments.length > 0 ? 'attached' : '',
    }, field);
    if (missingLabel) { toast({ title: 'Validation', description: `${missingLabel} is required.`, variant: 'destructive' }); return; }

    setSaving(true);
    try {
      const baseData = {
        projectId: form.projectId, projectName: form.projectName,
        expenseCategory:    form.expenseCategory,
        expenseSubCategory: form.expenseSubCategory.trim(),
        narration:          form.narration.trim(),
        expensedBy:         form.expensedBy.trim(),
        expenseDate:        form.expenseDate,
        expenseAmount:      amount,
        paymentMode:        form.paymentMode,
        vendorPartyName:    form.vendorPartyName.trim(),
        billNo:             form.billNo.trim(),
        isGstBill:          form.isGstBill,
        remarks:            form.remarks.trim(),
        updatedAt:          serverTimestamp(),
        updatedBy:          user?.id   || '',
        updatedByName:      user?.name || '',
      };

      if (editingRow) {
        // Delete removed attachments from Storage (best-effort)
        await Promise.allSettled(
          removedAttachments.map(a => deleteObject(storageRef(storage, a.storagePath)))
        );
        // Attachments are already in the bucket — just commit the references.
        await updateDoc(doc(db, SAS_COLLECTIONS.expenses, editingRow.id), {
          ...baseData, attachments: [...existingAttachments, ...uploadedAttachments],
        });
        void log('Edit SAS Expense', {
          project: form.projectName, category: form.expenseCategory,
          amount, previousAmount: editingRow.expenseAmount,
        });
        toast({ title: 'Updated', description: 'Expense updated.' });

        /*
         * An edit moves the spend total just as surely as a new expense does, but alerts only ever
         * fired on create — so raising an expense from ₹5,000 to ₹5,00,000 crossed every threshold
         * in silence. Re-check here too.
         *
         * Every period and category the edit touched is re-evaluated, not just the current one: an
         * expense moved from June to July, or re-categorised, changes the totals on both sides.
         * When the amount went *down*, or the record left a period entirely, the already-sent
         * thresholds for the affected scopes are cleared first — otherwise a budget that has been
         * brought back under its limit could never alert again.
         */
        void (async () => {
          const previousPeriod = (editingRow.expenseDate || '').slice(0, 7);
          const newPeriod = form.expenseDate.slice(0, 7);
          const periods = [newPeriod, previousPeriod].filter(Boolean);
          const categoryNames = [form.expenseCategory, editingRow.expenseCategory].filter(Boolean);
          const reducesSpend = amount < editingRow.expenseAmount || previousPeriod !== newPeriod
            || editingRow.projectId !== form.projectId;

          if (reducesSpend) {
            await Promise.allSettled([
              ...[...new Set([editingRow.projectId, form.projectId])].map(pid =>
                resetBudgetAlertState({ projectId: pid })
              ),
            ]);
          }

          const project = projects.find(p => p.id === form.projectId);
          await runBudgetAlertChecks({
            projectId: form.projectId,
            projectName: form.projectName,
            periods,
            categoryNames,
            newExpenseAmount: amount - editingRow.expenseAmount,
            assignedPersonId: project?.assignedPersonId,
            altUserId: project?.altUserId,
          });

          // An expense that moved between projects also changes the old project's totals.
          if (editingRow.projectId !== form.projectId) {
            const previous = projects.find(p => p.id === editingRow.projectId);
            if (previous) {
              await runBudgetAlertChecks({
                projectId: previous.id,
                projectName: previous.projectName,
                periods: [previousPeriod],
                categoryNames: [editingRow.expenseCategory].filter(Boolean),
                newExpenseAmount: -editingRow.expenseAmount,
                assignedPersonId: previous.assignedPersonId,
                altUserId: previous.altUserId,
              });
            }
          }
        })();
      } else {
        // Write under the id the attachments were uploaded against.
        await setDoc(doc(db, SAS_COLLECTIONS.expenses, targetExpenseIdRef.current), {
          ...baseData,
          attachments:   uploadedAttachments,
          createdAt:     serverTimestamp(),
          createdBy:     user?.id   || '',
          createdByName: user?.name || '',
        });
        const count = uploadedAttachments.length;
        void log('Add SAS Expense', { project: form.projectName, category: form.expenseCategory, amount });
        toast({ title: 'Added', description: `Expense recorded${count > 0 ? ` with ${count} attachment${count > 1 ? 's' : ''}` : ''}.` });
        // Fire budget alerts (fire-and-forget, does not block UI). One call now loads the alert
        // configuration once and runs all four budget scopes against it.
        const project = projects.find(p => p.id === form.projectId);
        void runBudgetAlertChecks({
          projectId: form.projectId,
          projectName: form.projectName,
          periods: [form.expenseDate.slice(0, 7)],
          categoryNames: [form.expenseCategory].filter(Boolean),
          newExpenseAmount: amount,
          assignedPersonId: project?.assignedPersonId,
          altUserId: project?.altUserId,
        });
      }

      // Committed — the uploads now belong to the expense, so don't clean them up.
      setUploads([]);
      setDialogOpen(false);
      void loadAll();
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(row: SASExpense) {
    if (!canDelete && !canWriteToProject(row.projectId)) {
      toast({ title: 'Not allowed', description: 'You have read-only access to this project.', variant: 'destructive' });
      return;
    }
    try {
      // Delete storage files first (best-effort)
      if (row.attachments?.length) {
        await Promise.allSettled(
          row.attachments.map(a => deleteObject(storageRef(storage, a.storagePath)))
        );
      }
      await deleteDoc(doc(db, SAS_COLLECTIONS.expenses, row.id));
      void log('Delete SAS Expense', { project: row.projectName, amount: row.expenseAmount });
      toast({ title: 'Deleted', description: 'Expense and attachments deleted.' });
      void loadAll();

      /*
       * Removing spend can only ever take a budget further *under* its thresholds, so nothing needs
       * to be sent — but the "already sent" ledger has to be cleared, or a project brought back
       * under 100% could never raise the 100% alert again when it climbs back over.
       */
      void resetBudgetAlertState({ projectId: row.projectId });
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
  }

  // ── Client-side refinement ────────────────────────────────────────────────────
  /*
   * Project, date range, main category, payment mode and the GST flag are all applied by the server
   * (see `ledgerScope`), so re-testing them here would be dead weight. Only the two filters
   * Firestore cannot index usefully are applied to the loaded rows: sub-category and free text.
   */
  const refining = Boolean(filterSubCategory || search.trim());

  const filtered = useMemo(() => {
    if (!refining) return expenses;
    const needle = search.trim().toLowerCase();
    return expenses.filter(e => {
      if (filterSubCategory && (e.expenseSubCategory || '') !== filterSubCategory) return false;
      if (needle &&
        !(e.projectName        || '').toLowerCase().includes(needle) &&
        !(e.expensedBy         || '').toLowerCase().includes(needle) &&
        !(e.expenseCategory    || '').toLowerCase().includes(needle) &&
        !(e.expenseSubCategory || '').toLowerCase().includes(needle) &&
        !(e.narration          || '').toLowerCase().includes(needle) &&
        !(e.vendorPartyName    || '').toLowerCase().includes(needle) &&
        !(e.billNo             || '').toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [expenses, refining, filterSubCategory, search]);

  /** Sum of the rows currently on screen. */
  const totalShown = useMemo(() => filtered.reduce((s, e) => s + (e.expenseAmount || 0), 0), [filtered]);

  /**
   * The period's true expense total, from the server aggregate — independent of how many rows have
   * been paged in. When a client-side refinement is active it no longer describes what is listed,
   * so the strip labels the two figures separately rather than presenting one as the other.
   */
  const periodExpenseTotal = periodTotals?.total ?? totalShown;
  const periodExpenseCount = periodTotals?.count ?? filtered.length;

  const closingBalance = useMemo(
    () => openingBalance === null ? null : openingBalance + periodReceipts - periodExpenseTotal,
    [openingBalance, periodReceipts, periodExpenseTotal]
  );

  // ── Upload gating for the expense dialog ──────────────────────────────────────
  const activeUploads   = uploads.filter(u => u.status === 'uploading');
  const failedUploads   = uploads.filter(u => u.status === 'error');
  const isUploading     = activeUploads.length > 0;
  const overallProgress = isUploading
    ? Math.round(activeUploads.reduce((s, u) => s + u.progress, 0) / activeUploads.length)
    : 0;

  // ── Export ────────────────────────────────────────────────────────────────────
  async function exportExcel() {
    setExporting(true);
    try {
      /*
       * The export covers the whole filtered period, not just the rows paged in on screen — a
       * spreadsheet that silently stopped at 50 rows would be worse than no export at all.
       */
      const { rows: scopeRows, truncated } = await fetchAllExpenses(ledgerScope);
      const needle = search.trim().toLowerCase();
      const rows = (filterSubCategory || needle)
        ? scopeRows.filter(e => {
            if (filterSubCategory && (e.expenseSubCategory || '') !== filterSubCategory) return false;
            if (needle &&
              !(e.projectName        || '').toLowerCase().includes(needle) &&
              !(e.expensedBy         || '').toLowerCase().includes(needle) &&
              !(e.expenseCategory    || '').toLowerCase().includes(needle) &&
              !(e.expenseSubCategory || '').toLowerCase().includes(needle) &&
              !(e.narration          || '').toLowerCase().includes(needle) &&
              !(e.vendorPartyName    || '').toLowerCase().includes(needle) &&
              !(e.billNo             || '').toLowerCase().includes(needle)) return false;
            return true;
          })
        : scopeRows;

      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Site Expenses');

      /*
       * Column widths are set without `header`, and the header row is written with `addRow`.
       *
       * Assigning `ws.columns` with `header` values makes ExcelJS write those headers straight into
       * row 1 — which used to overwrite the balance summary block added just above it, and left the
       * `headerRow` bolding pointed at an empty row further down. Declaring widths only, then
       * adding the header as an ordinary row, puts everything where the code says it goes.
       */
      const columns: { header: string; key: string; width: number }[] = [
        { header: 'Project',        key: 'projectName',        width: 28 },
        { header: 'Main Category',  key: 'expenseCategory',    width: 22 },
        { header: 'Sub-Category',   key: 'expenseSubCategory', width: 22 },
        { header: 'Narration',      key: 'narration',          width: 30 },
        { header: 'Expensed By',    key: 'expensedBy',         width: 20 },
        { header: 'Expense Date',   key: 'expenseDate',        width: 14 },
        { header: 'Amount (₹)',     key: 'expenseAmount',      width: 14 },
        { header: 'Payment Mode',   key: 'paymentMode',        width: 14 },
        { header: 'Vendor / Party', key: 'vendorPartyName',    width: 22 },
        { header: 'Bill No.',       key: 'billNo',             width: 16 },
        { header: 'GST Bill',       key: 'gstBillStr',         width: 10 },
        { header: 'Remarks',        key: 'remarks',            width: 30 },
        { header: 'Attachments',    key: 'attachCount',        width: 14 },
        { header: 'Recorded By',    key: 'createdByName',      width: 20 },
        { header: 'Recorded At',    key: 'createdAtStr',       width: 22 },
        { header: 'Updated By',     key: 'updatedByName',      width: 20 },
        { header: 'Updated At',     key: 'updatedAtStr',       width: 22 },
      ];
      ws.columns = columns.map(({ key, width }) => ({ key, width }));

      if (truncated) {
        ws.addRow([`NOTE: more than ${scopeRows.length} matching records — this export was truncated. Narrow the date range for a complete file.`]);
        ws.getRow(ws.rowCount).font = { bold: true, color: { argb: 'FFC00000' } };
      }

      // Balance summary rows at top
      if (openingBalance !== null) {
        ws.addRow(['Period', filterFrom || '', 'to', filterTo || '']);
        ws.addRow(['Opening Balance', openingBalance]);
        ws.addRow(['Receipts (period)', periodReceipts]);
        ws.addRow(['Expenses (period)', periodExpenseTotal]);
        ws.addRow(['Closing Balance', closingBalance ?? '']);
        ws.addRow([]);
      }

      ws.addRow(columns.map(c => c.header)).font = { bold: true };

      rows.forEach(e => ws.addRow(columns.map(({ key }) => {
        switch (key) {
          case 'expenseSubCategory': return e.expenseSubCategory || '';
          case 'narration':          return e.narration || '';
          case 'gstBillStr':         return e.isGstBill ? 'Yes' : 'No';
          case 'attachCount':        return e.attachments?.length || 0;
          case 'createdByName':      return e.createdByName || '';
          case 'createdAtStr':       return formatTimestamp(e.createdAt);
          case 'updatedByName':      return e.updatedByName || '';
          case 'updatedAtStr':       return timestampMillis(e.updatedAt) !== timestampMillis(e.createdAt)
                                            ? formatTimestamp(e.updatedAt) : '';
          default:                   return (e as unknown as Record<string, unknown>)[key] ?? '';
        }
      })));

      const buf = await wb.xlsx.writeBuffer();
      const url = URL.createObjectURL(new Blob([buf]));
      const a = document.createElement('a'); a.href = url; a.download = 'site-expenses.xlsx'; a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast({ title: 'Export failed', description: e?.message, variant: 'destructive' });
    } finally {
      setExporting(false);
    }
  }

  if (isAuthLoading || loading) {
    return <div className="space-y-3">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)}</div>;
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-base sm:text-lg font-bold text-slate-800">Site Expenses</h1>
          <p className="text-sm text-muted-foreground">All expenses incurred at project sites</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canExport && (
            <Button variant="outline" size="sm" onClick={exportExcel} disabled={exporting} className="gap-2">
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Export
            </Button>
          )}
          {effectiveCanImport && (
            <Button variant="outline" size="sm" onClick={() => setImportDialogOpen(true)} className="gap-2">
              <Upload className="h-4 w-4" /> Import
            </Button>
          )}
          {effectiveCanAdd && (
            <Button size="sm" onClick={openAdd} className="gap-2 bg-rose-600 hover:bg-rose-700">
              <Plus className="h-4 w-4" /> Add Expense
            </Button>
          )}
        </div>
      </div>

      {/* Month navigation */}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" className="h-8 px-2.5 gap-1" onClick={() => shiftMonth(-1)}>
          <ChevronLeft className="h-3.5 w-3.5" /> Prev
        </Button>
        <div className="flex items-center gap-1.5 rounded-md border bg-white/80 px-3 py-1.5 text-sm font-medium min-w-[160px] justify-center">
          <Calendar className="h-3.5 w-3.5 text-rose-500" />
          <span>{monthLabel}</span>
        </div>
        <Button variant="outline" size="sm" className="h-8 px-2.5 gap-1" onClick={() => shiftMonth(1)}>
          Next <ChevronRight className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground" onClick={goToCurrentMonth}>
          This Month
        </Button>
        <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground" onClick={() => { setFilterFrom(''); setFilterTo(''); }}>
          All Time
        </Button>
      </div>

      {/* Mobile filter toggle */}
      {(() => {
        const activeCount = [filterProject, filterCategory, filterSubCategory, filterMode, filterGstOnly, search].filter(Boolean).length;
        return (
          <div className="flex items-center gap-2 sm:hidden">
            <Button variant="outline" size="sm" className="h-9 gap-2 flex-1 justify-center"
              onClick={() => setShowFilters(s => !s)}>
              <Filter className="h-3.5 w-3.5" />
              {showFilters ? 'Hide Filters' : 'Filters'}
              {activeCount > 0 && (
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-rose-600 text-[9px] font-bold text-white">
                  {activeCount}
                </span>
              )}
            </Button>
          </div>
        );
      })()}

      {/* Filters (collapsible on mobile, always visible on sm+) */}
      <div className={cn('space-y-2', !showFilters && 'hidden sm:block')}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          <Select value={filterProject || '_all_'} onValueChange={v => setFilterProject(v === '_all_' ? '' : v)}>
            <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="All Projects" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_all_">All Projects</SelectItem>
              {visibleProjects.map(p => <SelectItem key={p.id} value={p.id}>{p.projectName}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterCategory || '_all_'} onValueChange={v => { setFilterCategory(v === '_all_' ? '' : v); setFilterSubCategory(''); }}>
            <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="All Categories" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_all_">All Categories</SelectItem>
              {mainCategories.map(c => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterSubCategory || '_all_'} onValueChange={v => setFilterSubCategory(v === '_all_' ? '' : v)}>
            <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="All Sub-Categories" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_all_">All Sub-Categories</SelectItem>
              {filterSubCategoryOptions.map(c => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterMode || '_all_'} onValueChange={v => setFilterMode(v === '_all_' ? '' : v)}>
            <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="All Modes" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_all_">All Modes</SelectItem>
              {PAYMENT_MODES.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          <Input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} className="h-9 text-sm" />
          <Input type="date" value={filterTo}   onChange={e => setFilterTo(e.target.value)}   className="h-9 text-sm" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..." className="h-9 text-sm" />
          {/* Sits under All Modes — shows only expenses flagged as GST bills */}
          <label
            className={cn(
              'flex h-9 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm transition-colors',
              filterGstOnly ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'bg-white/80 hover:bg-muted/40',
            )}
          >
            <Checkbox checked={filterGstOnly} onCheckedChange={v => setFilterGstOnly(v === true)} />
            <span className="truncate">GST Bills Only</span>
          </label>
        </div>
      </div>

      {/* Opening / Closing balance strip — scoped to the selected period only */}
      {openingBalance !== null && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Cash Flow — {monthLabel} (this period only)
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="flex items-center gap-2.5 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2.5">
              <Wallet className="h-4 w-4 shrink-0 text-emerald-600" />
              <div className="min-w-0">
                <p className="text-[10px] font-medium text-emerald-600 uppercase tracking-wide">Opening Balance <span className="font-normal opacity-70">(Period)</span></p>
                <p className={`text-sm font-bold leading-tight ${openingBalance >= 0 ? 'text-emerald-700' : 'text-destructive'}`}>
                  {formatINR(openingBalance)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2.5 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2.5">
              <TrendingUp className="h-4 w-4 shrink-0 text-blue-600" />
              <div className="min-w-0">
                <p className="text-[10px] font-medium text-blue-600 uppercase tracking-wide">Receipts <span className="font-normal opacity-70">(Period)</span></p>
                <p className="text-sm font-bold text-blue-700 leading-tight">{formatINR(periodReceipts)}</p>
              </div>
            </div>
            <div className="flex items-center gap-2.5 rounded-xl border border-rose-100 bg-rose-50 px-3 py-2.5">
              <TrendingDown className="h-4 w-4 shrink-0 text-rose-600" />
              <div className="min-w-0">
                <p className="text-[10px] font-medium text-rose-600 uppercase tracking-wide">Expenses <span className="font-normal opacity-70">(Period)</span> · {periodExpenseCount}</p>
                <p className="text-sm font-bold text-rose-700 leading-tight">{formatINR(periodExpenseTotal)}</p>
              </div>
            </div>
            <div className="flex items-center gap-2.5 rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-2.5">
              <Receipt className="h-4 w-4 shrink-0 text-indigo-600" />
              <div className="min-w-0">
                <p className="text-[10px] font-medium text-indigo-600 uppercase tracking-wide">Closing Balance <span className="font-normal opacity-70">(Period)</span></p>
                <p className={`text-sm font-bold leading-tight ${(closingBalance ?? 0) >= 0 ? 'text-indigo-700' : 'text-destructive'}`}>
                  {closingBalance !== null ? formatINR(closingBalance) : '—'}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Summary bar — cumulative project totals through the end of the selected period
         (or true all-time totals when "All Time" is selected) */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-rose-50 px-4 py-2.5">
        <Receipt className="h-4 w-4 shrink-0 text-rose-600" />
        <span className="text-sm font-medium text-rose-700">
          Period total: <strong>{formatINR(periodExpenseTotal)}</strong> — {periodExpenseCount} record{periodExpenseCount !== 1 ? 's' : ''}
        </span>
        {/* When a client-side refinement narrows the loaded rows, the two figures genuinely differ,
            so both are shown rather than one silently standing in for the other. */}
        {(refining || filtered.length < periodExpenseCount) && (
          <span className="text-xs text-muted-foreground">
            Showing {filtered.length} row{filtered.length !== 1 ? 's' : ''} · {formatINR(totalShown)}
          </span>
        )}
        {filterProjectBalance !== undefined && (
          <>
            <span className="h-4 w-px bg-rose-200" />
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
              Project Totals ({filterTo ? `through ${filterTo}` : 'All Time'}):
            </span>
            <span className="text-xs text-blue-600 font-medium">
              Received: {formatINR(filterProjectBalance.received)}
            </span>
            <span className="text-xs text-rose-600 font-medium">
              Expenses: {formatINR(filterProjectBalance.spent)}
            </span>
            <span className={`text-xs font-bold ${filterProjectBalance.balance >= 0 ? 'text-emerald-700' : 'text-destructive'}`}>
              Available Balance: {formatINR(filterProjectBalance.balance)}
            </span>
          </>
        )}
      </div>

      {/* Table */}
      <Card className="bg-white/80 backdrop-blur-sm">
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <Receipt className="h-10 w-10 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">{expenses.length === 0 ? 'No expenses recorded yet.' : 'No expenses match filters.'}</p>
            </div>
          ) : (
            <div className="overflow-auto max-h-[60vh]">
              <table className="w-full text-sm min-w-[800px]">
                <thead className="sticky top-0 z-10">
                  <tr className="border-b bg-slate-100">
                    <th className="px-4 py-2.5 text-left font-medium">Project</th>
                    <th className="px-4 py-2.5 text-left font-medium">Category</th>
                    <th className="px-4 py-2.5 text-left font-medium">Narration</th>
                    <th className="px-4 py-2.5 text-left font-medium">Expensed By</th>
                    <th className="px-4 py-2.5 text-left font-medium">Date</th>
                    <th className="px-4 py-2.5 text-right font-medium">Amount</th>
                    <th className="px-4 py-2.5 text-left font-medium">Mode</th>
                    <th className="px-4 py-2.5 text-left font-medium">Vendor / Party</th>
                    <th className="px-4 py-2.5 text-left font-medium">Bill No.</th>
                    <th className="px-4 py-2.5 text-center font-medium">
                      <Paperclip className="h-3.5 w-3.5 inline" />
                    </th>
                    <th className="px-4 py-2.5 text-left font-medium">Remarks</th>
                    <th className="px-4 py-2.5 text-left font-medium whitespace-nowrap">Recorded At</th>
                    {(effectiveCanEdit || canDelete) && <th className="px-4 py-2.5 text-right font-medium">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(row => (
                    <tr key={row.id} className="border-b hover:bg-muted/20 transition-colors cursor-pointer" onClick={() => setViewExpense(row)}>
                      <td className="px-4 py-2.5 font-medium max-w-[130px] truncate">{row.projectName}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-col gap-0.5">
                          <Badge variant="outline" className="text-xs w-fit">{row.expenseCategory}</Badge>
                          {row.expenseSubCategory && (
                            <span className="text-xs text-purple-600">↳ {row.expenseSubCategory}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground max-w-[130px] truncate">{row.narration || '—'}</td>
                      <td className="px-4 py-2.5">{row.expensedBy}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap">{row.expenseDate}</td>
                      <td className="px-4 py-2.5 text-right font-semibold text-rose-700">{formatINR(row.expenseAmount)}</td>
                      <td className="px-4 py-2.5"><Badge variant="secondary">{row.paymentMode}</Badge></td>
                      <td className="px-4 py-2.5 max-w-[110px] truncate">{row.vendorPartyName || '—'}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">
                        <div className="flex items-center gap-1.5">
                          <span>{row.billNo || '—'}</span>
                          {row.isGstBill && (
                            <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-[10px] text-emerald-700 px-1.5 py-0">GST</Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {row.attachments && row.attachments.length > 0 ? (
                          <button
                            onClick={e => { e.stopPropagation(); setViewExpense(row); }}
                            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-blue-600 hover:bg-blue-50 transition-colors"
                          >
                            <Paperclip className="h-3.5 w-3.5" />
                            <span className="text-xs font-medium">{row.attachments.length}</span>
                          </button>
                        ) : (
                          <Paperclip className="h-3.5 w-3.5 text-muted-foreground/25 mx-auto" />
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground max-w-[110px] truncate">{row.remarks || '—'}</td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{formatTimestamp(row.createdAt)}</td>
                      {(effectiveCanEdit || canDelete) && (
                        <td className="px-4 py-2.5 text-right">
                          <div className="flex justify-end gap-1" onClick={e => e.stopPropagation()}>
                            {effectiveCanEdit && (
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(row)}>
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            {canDelete && (
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:bg-destructive/10">
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Delete Expense</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      Delete this expense record{row.attachments?.length ? ` and its ${row.attachments.length} attachment${row.attachments.length > 1 ? 's' : ''}` : ''}? This cannot be undone.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => handleDelete(row)} className="bg-destructive hover:bg-destructive/90">Delete</AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-muted/30 font-semibold">
                    <td colSpan={5} className="px-4 py-2.5">
                      {refining || pageCursor ? 'Total (shown)' : 'Total'}
                    </td>
                    <td className="px-4 py-2.5 text-right text-rose-700">{formatINR(totalShown)}</td>
                    <td colSpan={(effectiveCanEdit || canDelete) ? 7 : 6} />
                  </tr>
                  {(refining || pageCursor) && (
                    <tr className="bg-muted/50 font-semibold">
                      <td colSpan={5} className="px-4 py-2.5">Period total (all {periodExpenseCount} records)</td>
                      <td className="px-4 py-2.5 text-right text-rose-800">{formatINR(periodExpenseTotal)}</td>
                      <td colSpan={(effectiveCanEdit || canDelete) ? 7 : 6} />
                    </tr>
                  )}
                </tfoot>
              </table>
            </div>
          )}

          {/* Cursor pagination — the table holds one page at a time rather than the whole
              collection, while the totals above come from the server-side aggregate. */}
          {pageCursor && (
            <div className="flex items-center justify-center gap-3 border-t px-4 py-3">
              <span className="text-xs text-muted-foreground">
                Showing {expenses.length} of {periodExpenseCount} records
              </span>
              <Button variant="outline" size="sm" onClick={loadMore} disabled={loadingMore} className="gap-2">
                {loadingMore ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ChevronDown className="h-3.5 w-3.5" />}
                Load {Math.min(SAS_PAGE_SIZE, periodExpenseCount - expenses.length)} more
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Import Dialog */}
      <VehicleImportDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        title="Import Site Expenses"
        fields={expenseImportFields}
        onSaveRow={saveExpenseRow}
        onImportComplete={() => {
          void log('Import SAS Expenses', {});
          void loadAll();
          void runImportAlerts();
        }}
      />

      {/* Expense Detail Dialog */}
      <Dialog open={!!viewExpense} onOpenChange={() => setViewExpense(null)}>
        <DialogContent className="max-w-[95vw] sm:max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Receipt className="h-4 w-4 text-rose-500" />
              Expense Details
            </DialogTitle>
          </DialogHeader>
          {viewExpense && (
            <div className="space-y-4 py-1">
              {/* Amount highlight */}
              <div className="rounded-xl border bg-rose-50 px-4 py-3 text-center">
                <p className="text-xs font-medium uppercase tracking-wide text-rose-500">Amount</p>
                <p className="text-2xl font-bold text-rose-700">{formatINR(viewExpense.expenseAmount)}</p>
                <div className="text-xs text-muted-foreground mt-0.5 flex items-center justify-center gap-1.5">{viewExpense.expenseDate} &bull; <Badge variant="secondary" className="text-xs">{viewExpense.paymentMode}</Badge></div>
              </div>

              {/* Fields grid */}
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Project</p>
                  <p className="font-medium mt-0.5">{viewExpense.projectName}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Expensed By</p>
                  <p className="mt-0.5">{viewExpense.expensedBy}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Main Category</p>
                  <p className="mt-0.5">{viewExpense.expenseCategory}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Sub-Category</p>
                  <p className="mt-0.5">{viewExpense.expenseSubCategory || <span className="text-muted-foreground">—</span>}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Vendor / Party</p>
                  <p className="mt-0.5">{viewExpense.vendorPartyName || <span className="text-muted-foreground">—</span>}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Bill No.</p>
                  <p className="mt-0.5">{viewExpense.billNo || <span className="text-muted-foreground">—</span>}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">GST Bill</p>
                  {/* div, not p — Badge renders a div and cannot nest inside a paragraph. */}
                  <div className="mt-0.5">
                    {viewExpense.isGstBill
                      ? <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-xs text-emerald-700">Yes</Badge>
                      : <span className="text-muted-foreground">No</span>}
                  </div>
                </div>
                {viewExpense.narration && (
                  <div className="col-span-2">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Narration</p>
                    <p className="mt-0.5">{viewExpense.narration}</p>
                  </div>
                )}
                {viewExpense.remarks && (
                  <div className="col-span-2">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Remarks</p>
                    <p className="mt-0.5">{viewExpense.remarks}</p>
                  </div>
                )}
                <div className="col-span-2 border-t pt-3 space-y-1">
                  <p className="text-xs text-muted-foreground">
                    Recorded by <span className="font-medium text-slate-700">{viewExpense.createdByName || '—'}</span>
                    {' '}on {formatTimestamp(viewExpense.createdAt)}
                  </p>
                  {/* Only a genuine later edit — a fresh record writes both stamps together. */}
                  {timestampMillis(viewExpense.updatedAt) !== timestampMillis(viewExpense.createdAt) && (
                    <p className="text-xs text-muted-foreground">
                      Updated by <span className="font-medium text-slate-700">{viewExpense.updatedByName || '—'}</span>
                      {' '}on {formatTimestamp(viewExpense.updatedAt)}
                    </p>
                  )}
                </div>
              </div>

              {/* Attachments */}
              {viewExpense.attachments && viewExpense.attachments.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                    <Paperclip className="h-3.5 w-3.5" />
                    Attachments ({viewExpense.attachments.length})
                  </p>
                  {viewExpense.attachments.map((att, i) => (
                    <a
                      key={i}
                      href={att.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 rounded-lg border bg-muted/20 px-3 py-2.5 hover:bg-muted/50 transition-colors group"
                    >
                      <AttachmentIcon type={att.type} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{att.name}</p>
                        <p className="text-xs text-muted-foreground">{formatSize(att.size)}</p>
                      </div>
                      <ExternalLink className="h-3.5 w-3.5 text-muted-foreground group-hover:text-blue-500 shrink-0 transition-colors" />
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewExpense(null)}>Close</Button>
            {effectiveCanEdit && viewExpense && (
              <Button
                className="bg-rose-600 hover:bg-rose-700"
                onClick={() => { const e = viewExpense; setViewExpense(null); openEdit(e); }}
              >
                <Pencil className="h-3.5 w-3.5 mr-1.5" /> Edit
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Attachments Dialog */}
      <Dialog open={!!viewDocExpense} onOpenChange={() => setViewDocExpense(null)}>
        <DialogContent className="max-w-[95vw] sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Paperclip className="h-4 w-4 text-blue-500" />
              Attachments
              {viewDocExpense?.attachments?.length
                ? <Badge variant="secondary" className="ml-1">{viewDocExpense.attachments.length}</Badge>
                : null}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-1">
            {viewDocExpense?.attachments?.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">No attachments.</p>
            )}
            {viewDocExpense?.attachments?.map((att, i) => (
              <a
                key={i}
                href={att.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 rounded-lg border bg-muted/20 px-3 py-2.5 hover:bg-muted/50 transition-colors group"
              >
                <AttachmentIcon type={att.type} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{att.name}</p>
                  <p className="text-xs text-muted-foreground">{formatSize(att.size)}</p>
                </div>
                <ExternalLink className="h-3.5 w-3.5 text-muted-foreground group-hover:text-blue-500 shrink-0 transition-colors" />
              </a>
            ))}
          </div>
          {viewDocExpense && effectiveCanEdit && (
            <p className="text-xs text-muted-foreground text-center pt-1">
              To add or remove attachments, use the Edit button on the expense row.
            </p>
          )}
        </DialogContent>
      </Dialog>

      {/* Add / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={open => { if (!open && !saving) closeDialog(); }}>
        <DialogContent className="max-w-[95vw] sm:max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingRow ? 'Edit Expense' : 'Record Site Expense'}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-2">

            {/* Project */}
            <div className="col-span-2 space-y-1.5">
              <Label>Project <span className="text-destructive">*</span></Label>
              {/* Only projects the user may actually write to — a viewer-only project has no
                  business being selectable in a form that records spend against it. */}
              <Select value={form.projectId} onValueChange={selectProject}>
                <SelectTrigger><SelectValue placeholder="Select project" /></SelectTrigger>
                <SelectContent>
                  {writableProjects.map(p => <SelectItem key={p.id} value={p.id}>{p.projectName}</SelectItem>)}
                </SelectContent>
              </Select>
              {writableProjects.length === 0 && (
                <p className="text-xs text-destructive">You have read-only access to every project assigned to you.</p>
              )}
            </div>

            {/* Available balance for selected project */}
            {formProjectBalance !== undefined && (
              <div className="col-span-2 grid grid-cols-3 gap-2 rounded-lg border bg-slate-50 px-3 py-2 text-center text-xs">
                <div>
                  <p className="text-muted-foreground">Received</p>
                  <p className="font-semibold text-blue-600">{formatINR(formProjectBalance.received)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Expenses</p>
                  <p className="font-semibold text-rose-600">{formatINR(formProjectBalance.spent)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Available Balance</p>
                  <p className={`font-bold text-sm ${formProjectBalance.balance >= 0 ? 'text-emerald-700' : 'text-destructive'}`}>
                    {formatINR(formProjectBalance.balance)}
                  </p>
                </div>
              </div>
            )}

            {/* Main Category */}
            {field('expenseCategory').visible && (
            <div className="space-y-1.5">
              <Label>{field('expenseCategory').label} {fieldMark(field('expenseCategory'))}</Label>
              <Select value={form.expenseCategoryId} onValueChange={selectMainCategory}>
                <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>
                  {mainCategories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            )}

            {/* Sub-Category */}
            {field('expenseSubCategory').visible && (
            <div className="space-y-1.5">
              <Label>{field('expenseSubCategory').label} {fieldMark(field('expenseSubCategory'))}</Label>
              <Select
                value={form.expenseSubCategory || '_none_'}
                onValueChange={v => setField('expenseSubCategory', v === '_none_' ? '' : v)}
                disabled={!form.expenseCategoryId || formSubCategories.length === 0}
              >
                <SelectTrigger>
                  <SelectValue placeholder={
                    !form.expenseCategoryId ? 'Select main category first'
                    : formSubCategories.length === 0 ? 'No sub-categories'
                    : 'Select sub-category'
                  } />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none_">None</SelectItem>
                  {formSubCategories.map(c => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            )}

            {/* Expensed By */}
            {field('expensedBy').visible && (
            <div className="space-y-1.5">
              <Label>{field('expensedBy').label} {fieldMark(field('expensedBy'))}</Label>
              <Input value={form.expensedBy} onChange={e => setField('expensedBy', e.target.value)} placeholder="Person who spent" />
            </div>
            )}

            {/* Date */}
            <div className="space-y-1.5">
              <Label>{field('expenseDate').label} <span className="text-destructive">*</span></Label>
              <Input type="date" value={form.expenseDate} onChange={e => setField('expenseDate', e.target.value)} />
            </div>

            {/* Amount */}
            <div className="space-y-1.5">
              <Label>{field('expenseAmount').label} (₹) <span className="text-destructive">*</span></Label>
              <Input type="number" min="0" value={form.expenseAmount} onChange={e => setField('expenseAmount', e.target.value)} placeholder="0" />
            </div>

            {/* Payment Mode */}
            {field('paymentMode').visible && (
            <div className="space-y-1.5">
              <Label>{field('paymentMode').label} {fieldMark(field('paymentMode'))}</Label>
              <Select value={form.paymentMode} onValueChange={v => setField('paymentMode', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAYMENT_MODES.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            )}

            {/* Vendor */}
            {field('vendorPartyName').visible && (
            <div className="space-y-1.5">
              <Label>{field('vendorPartyName').label} {fieldMark(field('vendorPartyName'))}</Label>
              <Input value={form.vendorPartyName} onChange={e => setField('vendorPartyName', e.target.value)} placeholder="Vendor or party name" />
            </div>
            )}

            {/* Bill No */}
            {field('billNo').visible && (
            <div className="space-y-1.5">
              <Label>{field('billNo').label} {fieldMark(field('billNo'))}</Label>
              <Input value={form.billNo} onChange={e => setField('billNo', e.target.value)} placeholder="Bill / voucher number" />
            </div>
            )}

            {/* GST bill flag */}
            {field('isGstBill').visible && (
            <div className="col-span-2">
              <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border bg-muted/20 px-3 py-2.5 hover:bg-muted/40 transition-colors">
                <Checkbox
                  checked={form.isGstBill}
                  onCheckedChange={v => setForm(f => ({ ...f, isGstBill: v === true }))}
                />
                <span className="text-sm font-medium">Is this a {field('isGstBill').label}?</span>
                <span className="text-xs text-muted-foreground">Tick if the bill carries GST</span>
              </label>
            </div>
            )}

            {/* Narration */}
            {field('narration').visible && (
            <div className="col-span-2 space-y-1.5">
              <Label>{field('narration').label} {fieldMark(field('narration'))}</Label>
              <Input value={form.narration} onChange={e => setField('narration', e.target.value)} placeholder="Brief description of payment purpose" />
            </div>
            )}

            {/* Remarks */}
            {field('remarks').visible && (
            <div className="col-span-2 space-y-1.5">
              <Label>{field('remarks').label} {fieldMark(field('remarks'))}</Label>
              <Textarea rows={2} value={form.remarks} onChange={e => setField('remarks', e.target.value)} placeholder="Additional notes" />
            </div>
            )}

            {/* ── Attachments ─────────────────────────────────────────────────── */}
            {field('attachment').visible && (
            <div className="col-span-2 space-y-2">
              <Label className="flex items-center gap-1.5">
                <Paperclip className="h-3.5 w-3.5" />
                {field('attachment').label} {fieldMark(field('attachment'))}
                <span className="text-muted-foreground text-xs font-normal">— PDF, images, Word, Excel</span>
              </Label>

              {/* Existing uploaded files */}
              {existingAttachments.map((att, i) => (
                <div key={i} className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
                  <AttachmentIcon type={att.type} />
                  <a
                    href={att.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 text-sm text-blue-600 hover:underline truncate"
                  >
                    {att.name}
                  </a>
                  <span className="text-xs text-muted-foreground shrink-0">{formatSize(att.size)}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-destructive hover:bg-destructive/10 shrink-0"
                    onClick={() => handleRemoveExisting(i)}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}

              {/* Files uploading to Storage — each carries its own progress line */}
              {uploads.map(u => (
                <div
                  key={u.id}
                  className={cn(
                    'rounded-lg border px-3 py-2',
                    u.status === 'error' ? 'border-destructive/40 bg-destructive/5'
                      : u.status === 'done' ? 'border-emerald-300 bg-emerald-50/60'
                      : 'border-dashed border-blue-300 bg-blue-50/60',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <AttachmentIcon type={u.file.type} />
                    <span className="flex-1 text-sm truncate">{u.file.name}</span>
                    <span className="text-xs text-muted-foreground shrink-0">{formatSize(u.file.size)}</span>
                    {u.status === 'uploading' && (
                      <span className="text-xs font-semibold text-blue-600 tabular-nums shrink-0">{u.progress}%</span>
                    )}
                    {u.status === 'done' && (
                      <Badge variant="outline" className="text-xs text-emerald-700 border-emerald-300 shrink-0">
                        <CheckCircle2 className="h-3 w-3 mr-1" />Uploaded
                      </Badge>
                    )}
                    {u.status === 'error' && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs text-amber-700 hover:bg-amber-100 shrink-0"
                        onClick={() => handleRetryUpload(u.id)}
                      >
                        <RotateCw className="h-3 w-3 mr-1" />Retry
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-destructive hover:bg-destructive/10 shrink-0"
                      onClick={() => handleRemoveUpload(u.id)}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>

                  {/* Thin progress line under the document */}
                  <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-slate-200">
                    <div
                      className={cn(
                        'h-full rounded-full transition-all duration-200',
                        u.status === 'error' ? 'bg-destructive'
                          : u.status === 'done' ? 'bg-emerald-500'
                          : 'bg-blue-500',
                      )}
                      style={{ width: `${u.status === 'error' ? 100 : u.progress}%` }}
                    />
                  </div>

                  {u.status === 'error' && (
                    <p className="mt-1 flex items-start gap-1 text-[11px] text-destructive">
                      <AlertTriangle className="h-3 w-3 mt-px shrink-0" />
                      <span>Upload failed{u.error ? ` — ${u.error}` : ''}. Retry or remove it to continue.</span>
                    </p>
                  )}
                </div>
              ))}

              {/* File picker row */}
              <div className="flex flex-wrap gap-2">
                <label className="flex flex-1 cursor-pointer items-center gap-2 rounded-lg border border-dashed border-muted-foreground/25 px-4 py-2.5 text-sm text-muted-foreground hover:border-emerald-400 hover:bg-emerald-50/40 transition-colors">
                  <Upload className="h-4 w-4 shrink-0" />
                  <span>Attach files</span>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept={ACCEPT}
                    className="sr-only"
                    onChange={handleFileSelect}
                  />
                </label>
                <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-muted-foreground/25 px-4 py-2.5 text-sm text-muted-foreground hover:border-sky-400 hover:bg-sky-50/40 transition-colors">
                  <Camera className="h-4 w-4 shrink-0" />
                  <span className="whitespace-nowrap">Take Photo</span>
                  <input
                    ref={cameraInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="sr-only"
                    onChange={handleCameraSelect}
                  />
                </label>
              </div>

              {isUploading && (
                <p className="flex items-center gap-1.5 text-xs text-blue-600">
                  <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                  Uploading {activeUploads.length} file{activeUploads.length > 1 ? 's' : ''} — the expense can be recorded once every document is uploaded.
                </p>
              )}
              {!isUploading && failedUploads.length > 0 && (
                <p className="text-xs text-destructive">
                  {failedUploads.length} document{failedUploads.length > 1 ? 's' : ''} failed to upload. Retry or remove {failedUploads.length > 1 ? 'them' : 'it'} to record the expense.
                </p>
              )}
            </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={saving}>Cancel</Button>
            <Button
              onClick={handleSubmit}
              disabled={saving || isUploading || failedUploads.length > 0}
              className="bg-rose-600 hover:bg-rose-700 min-w-[130px]"
            >
              {isUploading && <><Loader2 className="h-4 w-4 animate-spin mr-2" />Uploading {overallProgress}%</>}
              {!isUploading && saving && <><Loader2 className="h-4 w-4 animate-spin mr-2" />Saving…</>}
              {!isUploading && !saving && (editingRow ? 'Save Changes' : 'Record Expense')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
