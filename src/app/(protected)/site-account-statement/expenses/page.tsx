'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  addDoc, collection, deleteDoc, doc, getDocs, orderBy, query,
  serverTimestamp, updateDoc, where,
} from 'firebase/firestore';
import { deleteObject, getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import { db } from '@/lib/firebase';
import { storage } from '@/lib/firebase';
import {
  formatINR, PAYMENT_MODES, SAS_COLLECTIONS,
  type SASAttachment, type SASCategory, type SASCategoryBudget, type SASExpense, type SASPayment, type SASProject,
} from '@/lib/site-account-statement';
import { createUserNotification, type NotificationType } from '@/lib/notifications';
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
  Calendar, Camera, ChevronLeft, ChevronRight,
  Download, ExternalLink, File, FileText, Filter, Image, Loader2,
  Paperclip, Pencil, Plus, Receipt, Trash2, TrendingDown, TrendingUp, Upload, Wallet, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import ExcelJS from 'exceljs';
import { VehicleImportDialog, type ImportField } from '@/components/vehicle-management/import-dialog';

const MODULE    = 'Site Account Statement';
const RESOURCE  = 'Expenses';
const ACCEPT    = '.pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.txt';
const MAX_SIZE  = 5 * 1024 * 1024; // 5 MB

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
  remarks: string;
}

const blank = (): FormState => ({
  projectId: '', projectName: '',
  expenseCategoryId: '', expenseCategory: '', expenseSubCategory: '',
  narration: '', expensedBy: '', expenseDate: '', expenseAmount: '',
  paymentMode: 'Cash', vendorPartyName: '', billNo: '', remarks: '',
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
  const fileInputRef   = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const canViewAll = can('View', `${MODULE}.All Projects`);
  const canView   = can('View',   `${MODULE}.${RESOURCE}`) || canViewAll;
  const canAdd    = can('Add',    `${MODULE}.${RESOURCE}`);
  const canEdit   = can('Edit',   `${MODULE}.${RESOURCE}`);
  const canDelete = can('Delete', `${MODULE}.${RESOURCE}`);
  const canExport = can('Export', `${MODULE}.${RESOURCE}`);
  const canImport = canAdd;

  const [projects,   setProjects]   = useState<SASProject[]>([]);
  const [categories, setCategories] = useState<SASCategory[]>([]);
  const [expenses,   setExpenses]   = useState<SASExpense[]>([]);
  const [payments,   setPayments]   = useState<SASPayment[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [saving,           setSaving]           = useState(false);
  const [uploading,        setUploading]        = useState(false);
  const [exporting,        setExporting]        = useState(false);
  const [dialogOpen,       setDialogOpen]       = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [editingRow,       setEditingRow]       = useState<SASExpense | null>(null);
  const [form,             setForm]             = useState<FormState>(blank());

  // Attachment state
  const [pendingFiles,        setPendingFiles]        = useState<File[]>([]);
  const [existingAttachments, setExistingAttachments] = useState<SASAttachment[]>([]);
  const [removedAttachments,  setRemovedAttachments]  = useState<SASAttachment[]>([]);
  const [viewDocExpense,      setViewDocExpense]      = useState<SASExpense | null>(null);
  const [viewExpense,         setViewExpense]         = useState<SASExpense | null>(null);

  // Filters — default to current month
  const [filterProject,     setFilterProject]     = useState('');
  const [filterCategory,    setFilterCategory]    = useState('');
  const [filterSubCategory, setFilterSubCategory] = useState('');
  const [filterMode,        setFilterMode]        = useState('');
  const [filterFrom,        setFilterFrom]        = useState(() => getMonthRange().start);
  const [filterTo,          setFilterTo]          = useState(() => getMonthRange().end);
  const [search,            setSearch]            = useState('');
  const [showFilters,       setShowFilters]       = useState(false);

  useEffect(() => {
    if (!isAuthLoading) void loadAll();
  }, [isAuthLoading]);

  async function loadAll() {
    setLoading(true);
    try {
      const [pSnap, catSnap, expSnap, paySnap] = await Promise.all([
        getDocs(query(collection(db, SAS_COLLECTIONS.projects), orderBy('projectName'))),
        getDocs(query(collection(db, SAS_COLLECTIONS.categories), orderBy('name'))),
        getDocs(query(collection(db, SAS_COLLECTIONS.expenses), orderBy('expenseDate', 'desc'))),
        getDocs(query(collection(db, SAS_COLLECTIONS.payments))),
      ]);
      setProjects(pSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASProject)).filter(p => p.enabledForSiteAccount && p.status === 'Active'));
      setCategories(catSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASCategory)).filter(c => c.isActive !== false));
      setExpenses(expSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASExpense)));
      setPayments(paySnap.docs.map(d => ({ id: d.id, ...d.data() } as SASPayment)));
    } finally {
      setLoading(false);
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

  // Alt-user projects allow add/edit even without RBAC permissions
  const isAltUser = useMemo(
    () => !canViewAll && visibleProjects.some(p => p.altUserId === user?.id),
    [canViewAll, visibleProjects, user?.id]
  );
  const effectiveCanAdd    = canAdd    || isAltUser;
  const effectiveCanEdit   = canEdit   || isAltUser;
  const effectiveCanImport = canImport || isAltUser;

  // Per-project balance (received - expenses)
  const perProjectBalance = useMemo(() => {
    const map = new Map<string, { received: number; spent: number; balance: number }>();
    payments.forEach(p => {
      const cur = map.get(p.projectId) ?? { received: 0, spent: 0, balance: 0 };
      cur.received += p.receivedAmount || 0;
      map.set(p.projectId, cur);
    });
    expenses.forEach(e => {
      const cur = map.get(e.projectId) ?? { received: 0, spent: 0, balance: 0 };
      cur.spent += e.expenseAmount || 0;
      map.set(e.projectId, cur);
    });
    map.forEach((v, k) => { v.balance = v.received - v.spent; map.set(k, v); });
    return map;
  }, [payments, expenses]);

  // Balance for the project currently selected in the form
  const formProjectBalance = useMemo(
    () => form.projectId ? perProjectBalance.get(form.projectId) : undefined,
    [perProjectBalance, form.projectId]
  );

  // Balance for the project currently being filtered in the list
  const filterProjectBalance = useMemo(
    () => filterProject ? perProjectBalance.get(filterProject) : undefined,
    [perProjectBalance, filterProject]
  );

  // ── Opening / closing balance for the filtered period ────────────────────────
  const openingBalance = useMemo(() => {
    if (!filterFrom) return null;
    const inScope = (id: string) => filterProject ? id === filterProject : (!userProjectIds || userProjectIds.has(id));
    const rec = payments.filter(p => inScope(p.projectId) && p.receiptDate < filterFrom)
      .reduce((s, p) => s + (p.receivedAmount || 0), 0);
    const exp = expenses.filter(e => inScope(e.projectId) && e.expenseDate < filterFrom)
      .reduce((s, e) => s + (e.expenseAmount || 0), 0);
    return rec - exp;
  }, [filterFrom, filterProject, payments, expenses, userProjectIds]);

  const periodReceipts = useMemo(() => payments
    .filter(p => {
      if (filterProject && p.projectId !== filterProject) return false;
      if (userProjectIds && !userProjectIds.has(p.projectId)) return false;
      if (filterFrom && p.receiptDate < filterFrom) return false;
      if (filterTo   && p.receiptDate > filterTo)   return false;
      return true;
    })
    .reduce((s, p) => s + (p.receivedAmount || 0), 0),
  [filterFrom, filterTo, filterProject, payments, userProjectIds]);

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
    { key: 'remarks',         label: 'Remarks' },
  ], [visibleProjects, mainCategories, subCategories]);

  async function saveExpenseRow(row: Record<string, any>) {
    const projName = String(row.projectName || '').trim();
    const proj = visibleProjects.find(p => p.projectName.toLowerCase() === projName.toLowerCase());
    if (!proj) throw new Error(`Project "${projName}" not found`);

    const catRaw  = String(row.expenseCategory || '').trim();
    const mainCat = mainCategories.find(c => c.name.toLowerCase() === catRaw.toLowerCase());
    if (!mainCat) throw new Error(`Main category "${catRaw}" not found`);

    const subCatRaw = String(row.expenseSubCategory || '').trim();
    let subCatName = '';
    if (subCatRaw) {
      const subCat = subCategories.find(c =>
        c.parentId === mainCat.id && c.name.toLowerCase() === subCatRaw.toLowerCase()
      );
      subCatName = subCat?.name || subCatRaw;
    }

    const amount = Number(row.expenseAmount);
    if (!amount || amount <= 0) throw new Error('Amount must be > 0');
    const mode = PAYMENT_MODES.includes(row.paymentMode as any) ? row.paymentMode : 'Cash';

    await addDoc(collection(db, SAS_COLLECTIONS.expenses), {
      projectId:          proj.id,
      projectName:        proj.projectName,
      expenseCategory:    mainCat.name,
      expenseSubCategory: subCatName,
      narration:          String(row.narration       || '').trim(),
      expensedBy:         String(row.expensedBy      || '').trim(),
      expenseDate:        String(row.expenseDate      || '').trim(),
      expenseAmount:      amount,
      paymentMode:        mode,
      vendorPartyName:    String(row.vendorPartyName  || '').trim(),
      billNo:             String(row.billNo           || '').trim(),
      remarks:            String(row.remarks          || '').trim(),
      attachments:        [],
      createdAt:          serverTimestamp(),
      updatedAt:          serverTimestamp(),
    });
  }

  // ── Attachment helpers ────────────────────────────────────────────────────────
  async function uploadAttachments(expenseId: string, files: File[]): Promise<SASAttachment[]> {
    return Promise.all(files.map(async file => {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `siteAccountExpenses/${expenseId}/${Date.now()}-${safeName}`;
      const sRef = storageRef(storage, path);
      await uploadBytes(sRef, file);
      const url = await getDownloadURL(sRef);
      return { name: file.name, url, storagePath: path, size: file.size, type: file.type || 'application/octet-stream' };
    }));
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
    if (ok.length > 0) setPendingFiles(prev => [...prev, ...ok]);
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

  function handleRemovePending(idx: number) {
    setPendingFiles(prev => prev.filter((_, i) => i !== idx));
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
    setPendingFiles([]);
    setExistingAttachments([]);
    setRemovedAttachments([]);
    setDialogOpen(true);
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
      billNo: row.billNo || '', remarks: row.remarks || '',
    });
    setPendingFiles([]);
    setExistingAttachments(row.attachments ? [...row.attachments] : []);
    setRemovedAttachments([]);
    setDialogOpen(true);
  }

  function setField(key: keyof FormState, value: string) { setForm(f => ({ ...f, [key]: value })); }

  function selectProject(id: string) {
    const proj = visibleProjects.find(p => p.id === id);
    setForm(f => ({ ...f, projectId: id, projectName: proj?.projectName || '' }));
  }

  function selectMainCategory(id: string) {
    const cat = mainCategories.find(c => c.id === id);
    setForm(f => ({ ...f, expenseCategoryId: id, expenseCategory: cat?.name || '', expenseSubCategory: '' }));
  }

  // ── Budget breach check (fire-and-forget after new expense) ─────────────────
  async function checkCategoryBudgetBreach(
    projectId: string,
    projectName: string,
    categoryName: string,
    expenseDate: string,
    prevExpenses: SASExpense[],
    newAmount: number,
    project: SASProject,
  ) {
    const monthStr = expenseDate.substring(0, 7);
    const cbSnap = await getDocs(
      query(
        collection(db, SAS_COLLECTIONS.categoryBudgets),
        where('projectId', '==', projectId),
        where('categoryName', '==', categoryName),
        where('period', '==', monthStr),
      )
    );
    if (cbSnap.empty) return;

    const budget = cbSnap.docs[0].data() as SASCategoryBudget;
    const prevTotal = prevExpenses
      .filter(e => e.projectId === projectId && e.expenseCategory === categoryName && e.expenseDate?.startsWith(monthStr))
      .reduce((s, e) => s + (e.expenseAmount || 0), 0);
    const newTotal = prevTotal + newAmount;

    // Only notify on the first crossing (prevTotal was within budget, newTotal exceeds it)
    if (prevTotal >= budget.budgetAmount) return;
    if (newTotal <= budget.budgetAmount) return;

    const overage = newTotal - budget.budgetAmount;
    const mLabel  = new Date(`${monthStr}-15`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    const notifPayload = {
      type: 'budget_alert' as NotificationType,
      title: `Category Budget Exceeded: ${categoryName}`,
      body: `${categoryName} expenses for "${projectName}" in ${mLabel} have crossed the set budget. Budget: ₹${budget.budgetAmount.toLocaleString('en-IN')}, Spent: ₹${newTotal.toLocaleString('en-IN')}, Over by: ₹${overage.toLocaleString('en-IN')}.`,
      module: 'site-account-statement',
      itemId: projectId,
      itemRef: projectName,
      stepName: 'category_budget_breach',
      link: '/site-account-statement/budget/category',
    };

    const notifyIds = new Set<string>();
    if (project.assignedPersonId) notifyIds.add(project.assignedPersonId);
    if (project.altUserId) notifyIds.add(project.altUserId);

    // Find project managers: users whose role grants 'View' on 'Site Account Statement.All Projects'
    try {
      const rolesSnap = await getDocs(collection(db, 'roles'));
      const adminRoleNames = rolesSnap.docs
        .filter(d => {
          const perms = (d.data().permissions || {}) as Record<string, string[]>;
          return (perms['Site Account Statement.All Projects'] || []).includes('View');
        })
        .map(d => d.data().name as string)
        .filter(Boolean);

      if (adminRoleNames.length > 0) {
        const usersSnap = await getDocs(
          query(collection(db, 'users'), where('role', 'in', adminRoleNames), where('status', '==', 'Active'))
        );
        usersSnap.docs.forEach(d => notifyIds.add(d.id));
      }
    } catch {
      // Best-effort — role query failure does not block the notification to the project handler
    }

    await Promise.allSettled([...notifyIds].map(uid => createUserNotification(uid, notifPayload)));
  }

  // ── Submit ────────────────────────────────────────────────────────────────────
  async function handleSubmit() {
    if (!form.projectId)        { toast({ title: 'Validation', description: 'Select a project.',         variant: 'destructive' }); return; }
    if (!form.expenseCategory)  { toast({ title: 'Validation', description: 'Select main category.',     variant: 'destructive' }); return; }
    if (!form.expensedBy.trim()){ toast({ title: 'Validation', description: 'Expensed By is required.',  variant: 'destructive' }); return; }
    if (!form.expenseDate)      { toast({ title: 'Validation', description: 'Expense date is required.', variant: 'destructive' }); return; }
    const amount = Number(form.expenseAmount);
    if (!amount || amount <= 0) { toast({ title: 'Validation', description: 'Enter a valid amount.',     variant: 'destructive' }); return; }

    setSaving(true);
    if (pendingFiles.length > 0) setUploading(true);
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
        remarks:            form.remarks.trim(),
        updatedAt:          serverTimestamp(),
      };

      if (editingRow) {
        // Delete removed attachments from Storage (best-effort)
        await Promise.allSettled(
          removedAttachments.map(a => deleteObject(storageRef(storage, a.storagePath)))
        );
        // Upload new pending files
        const newAttachments = await uploadAttachments(editingRow.id, pendingFiles);
        const finalAttachments = [...existingAttachments, ...newAttachments];
        await updateDoc(doc(db, SAS_COLLECTIONS.expenses, editingRow.id), {
          ...baseData, attachments: finalAttachments,
        });
        void log('Edit SAS Expense', { project: form.projectName, category: form.expenseCategory, amount });
        toast({ title: 'Updated', description: 'Expense updated.' });
      } else {
        // Create expense first to get the ID
        const docRef = await addDoc(collection(db, SAS_COLLECTIONS.expenses), {
          ...baseData, attachments: [], createdAt: serverTimestamp(),
        });
        // Upload files using the new doc ID
        const attachments = await uploadAttachments(docRef.id, pendingFiles);
        if (attachments.length > 0) {
          await updateDoc(docRef, { attachments });
        }
        void log('Add SAS Expense', { project: form.projectName, category: form.expenseCategory, amount });
        toast({ title: 'Added', description: `Expense recorded${attachments.length > 0 ? ` with ${attachments.length} attachment${attachments.length > 1 ? 's' : ''}` : ''}.` });
        // Check if category budget is exceeded (fire-and-forget, does not block UI)
        const project = projects.find(p => p.id === form.projectId);
        if (project && form.expenseCategory && form.expenseDate) {
          void checkCategoryBudgetBreach(
            form.projectId, form.projectName, form.expenseCategory,
            form.expenseDate, expenses, amount, project,
          );
        }
      }

      setDialogOpen(false);
      void loadAll();
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
      setUploading(false);
    }
  }

  async function handleDelete(row: SASExpense) {
    try {
      // Delete storage files first (best-effort)
      if (row.attachments?.length) {
        await Promise.allSettled(
          row.attachments.map(a => deleteObject(storageRef(storage, a.storagePath)))
        );
      }
      await deleteDoc(doc(db, SAS_COLLECTIONS.expenses, row.id));
      void log('Delete SAS Expense', { project: row.projectName });
      toast({ title: 'Deleted', description: 'Expense and attachments deleted.' });
      void loadAll();
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
  }

  // ── Filters ───────────────────────────────────────────────────────────────────
  const filtered = useMemo(() => expenses.filter(e => {
    if (userProjectIds    && !userProjectIds.has(e.projectId))                         return false;
    if (filterProject     && e.projectId !== filterProject)                            return false;
    if (filterCategory    && e.expenseCategory !== filterCategory)                     return false;
    if (filterSubCategory && (e.expenseSubCategory || '') !== filterSubCategory)       return false;
    if (filterMode        && e.paymentMode !== filterMode)                             return false;
    if (filterFrom        && e.expenseDate < filterFrom)                               return false;
    if (filterTo          && e.expenseDate > filterTo)                                 return false;
    if (search &&
      !(e.projectName        || '').toLowerCase().includes(search.toLowerCase()) &&
      !(e.expensedBy         || '').toLowerCase().includes(search.toLowerCase()) &&
      !(e.expenseCategory    || '').toLowerCase().includes(search.toLowerCase()) &&
      !(e.expenseSubCategory || '').toLowerCase().includes(search.toLowerCase()) &&
      !(e.narration          || '').toLowerCase().includes(search.toLowerCase()) &&
      !(e.billNo             || '').toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), [expenses, userProjectIds, filterProject, filterCategory, filterSubCategory, filterMode, filterFrom, filterTo, search]);

  const totalFiltered = useMemo(() => filtered.reduce((s, e) => s + (e.expenseAmount || 0), 0), [filtered]);

  const closingBalance = useMemo(
    () => openingBalance === null ? null : openingBalance + periodReceipts - totalFiltered,
    [openingBalance, periodReceipts, totalFiltered]
  );

  // ── Export ────────────────────────────────────────────────────────────────────
  async function exportExcel() {
    setExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Site Expenses');

      // Balance summary rows at top
      if (openingBalance !== null) {
        ws.addRow(['Period', filterFrom || '', 'to', filterTo || '']);
        ws.addRow(['Opening Balance', openingBalance]);
        ws.addRow(['Receipts (period)', periodReceipts]);
        ws.addRow(['Expenses (period)', totalFiltered]);
        ws.addRow(['Closing Balance', closingBalance ?? '']);
        ws.addRow([]);
      }

      const headerRow = ws.rowCount + 1;
      ws.columns = [
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
        { header: 'Remarks',        key: 'remarks',            width: 30 },
        { header: 'Attachments',    key: 'attachCount',        width: 14 },
        { header: 'Recorded At',    key: 'createdAtStr',       width: 22 },
      ];
      ws.getRow(headerRow).font = { bold: true };
      filtered.forEach(e => ws.addRow({
        ...e,
        expenseSubCategory: e.expenseSubCategory || '',
        narration:          e.narration          || '',
        attachCount:        e.attachments?.length || 0,
        createdAtStr:       formatTimestamp(e.createdAt),
      }));
      const buf = await wb.xlsx.writeBuffer();
      const url = URL.createObjectURL(new Blob([buf]));
      const a = document.createElement('a'); a.href = url; a.download = 'site-expenses.xlsx'; a.click();
      URL.revokeObjectURL(url);
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
          <h1 className="text-lg font-bold text-slate-800">Site Expenses</h1>
          <p className="text-sm text-muted-foreground">All expenses incurred at project sites</p>
        </div>
        <div className="flex gap-2">
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
        const activeCount = [filterProject, filterCategory, filterSubCategory, filterMode, search].filter(Boolean).length;
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
        </div>
      </div>

      {/* Opening / Closing balance strip */}
      {openingBalance !== null && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="flex items-center gap-2.5 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2.5">
            <Wallet className="h-4 w-4 shrink-0 text-emerald-600" />
            <div className="min-w-0">
              <p className="text-[10px] font-medium text-emerald-600 uppercase tracking-wide">Opening Balance</p>
              <p className={`text-sm font-bold leading-tight ${openingBalance >= 0 ? 'text-emerald-700' : 'text-destructive'}`}>
                {formatINR(openingBalance)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2.5 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2.5">
            <TrendingUp className="h-4 w-4 shrink-0 text-blue-600" />
            <div className="min-w-0">
              <p className="text-[10px] font-medium text-blue-600 uppercase tracking-wide">Receipts</p>
              <p className="text-sm font-bold text-blue-700 leading-tight">{formatINR(periodReceipts)}</p>
            </div>
          </div>
          <div className="flex items-center gap-2.5 rounded-xl border border-rose-100 bg-rose-50 px-3 py-2.5">
            <TrendingDown className="h-4 w-4 shrink-0 text-rose-600" />
            <div className="min-w-0">
              <p className="text-[10px] font-medium text-rose-600 uppercase tracking-wide">Expenses ({filtered.length})</p>
              <p className="text-sm font-bold text-rose-700 leading-tight">{formatINR(totalFiltered)}</p>
            </div>
          </div>
          <div className="flex items-center gap-2.5 rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-2.5">
            <Receipt className="h-4 w-4 shrink-0 text-indigo-600" />
            <div className="min-w-0">
              <p className="text-[10px] font-medium text-indigo-600 uppercase tracking-wide">Closing Balance</p>
              <p className={`text-sm font-bold leading-tight ${(closingBalance ?? 0) >= 0 ? 'text-indigo-700' : 'text-destructive'}`}>
                {closingBalance !== null ? formatINR(closingBalance) : '—'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Summary bar */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-rose-50 px-4 py-2.5">
        <Receipt className="h-4 w-4 shrink-0 text-rose-600" />
        <span className="text-sm font-medium text-rose-700">
          Total shown: <strong>{formatINR(totalFiltered)}</strong> — {filtered.length} record{filtered.length !== 1 ? 's' : ''}
        </span>
        {filterProjectBalance !== undefined && (
          <>
            <span className="h-4 w-px bg-rose-200" />
            <span className="text-xs text-blue-600 font-medium">Received: {formatINR(filterProjectBalance.received)}</span>
            <span className="text-xs text-rose-600 font-medium">Expenses: {formatINR(filterProjectBalance.spent)}</span>
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
              <table className="w-full text-sm">
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
                      <td className="px-4 py-2.5 text-muted-foreground">{row.billNo || '—'}</td>
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
                    <td colSpan={5} className="px-4 py-2.5">Total</td>
                    <td className="px-4 py-2.5 text-right text-rose-700">{formatINR(totalFiltered)}</td>
                    <td colSpan={(effectiveCanEdit || canDelete) ? 7 : 6} />
                  </tr>
                </tfoot>
              </table>
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
        onImportComplete={() => { void log('Import SAS Expenses', {}); void loadAll(); }}
      />

      {/* Expense Detail Dialog */}
      <Dialog open={!!viewExpense} onOpenChange={() => setViewExpense(null)}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
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
                <p className="text-xs text-muted-foreground mt-0.5">{viewExpense.expenseDate} &bull; <Badge variant="secondary" className="text-xs">{viewExpense.paymentMode}</Badge></p>
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
                <div className="col-span-2 border-t pt-3">
                  <p className="text-xs text-muted-foreground">Recorded: {formatTimestamp(viewExpense.createdAt)}</p>
                  {viewExpense.updatedAt && viewExpense.updatedAt !== viewExpense.createdAt && (
                    <p className="text-xs text-muted-foreground">Updated: {formatTimestamp(viewExpense.updatedAt)}</p>
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
        <DialogContent className="max-w-sm">
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
      <Dialog open={dialogOpen} onOpenChange={open => { if (!open && !saving) setDialogOpen(false); }}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingRow ? 'Edit Expense' : 'Record Site Expense'}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">

            {/* Project */}
            <div className="col-span-2 space-y-1.5">
              <Label>Project <span className="text-destructive">*</span></Label>
              <Select value={form.projectId} onValueChange={selectProject}>
                <SelectTrigger><SelectValue placeholder="Select project" /></SelectTrigger>
                <SelectContent>
                  {visibleProjects.map(p => <SelectItem key={p.id} value={p.id}>{p.projectName}</SelectItem>)}
                </SelectContent>
              </Select>
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
            <div className="space-y-1.5">
              <Label>Main Category <span className="text-destructive">*</span></Label>
              <Select value={form.expenseCategoryId} onValueChange={selectMainCategory}>
                <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>
                  {mainCategories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* Sub-Category */}
            <div className="space-y-1.5">
              <Label>Sub-Category <span className="text-muted-foreground text-xs">(optional)</span></Label>
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

            {/* Expensed By */}
            <div className="space-y-1.5">
              <Label>Expensed By <span className="text-destructive">*</span></Label>
              <Input value={form.expensedBy} onChange={e => setField('expensedBy', e.target.value)} placeholder="Person who spent" />
            </div>

            {/* Date */}
            <div className="space-y-1.5">
              <Label>Expense Date <span className="text-destructive">*</span></Label>
              <Input type="date" value={form.expenseDate} onChange={e => setField('expenseDate', e.target.value)} />
            </div>

            {/* Amount */}
            <div className="space-y-1.5">
              <Label>Amount (₹) <span className="text-destructive">*</span></Label>
              <Input type="number" min="0" value={form.expenseAmount} onChange={e => setField('expenseAmount', e.target.value)} placeholder="0" />
            </div>

            {/* Payment Mode */}
            <div className="space-y-1.5">
              <Label>Payment Mode</Label>
              <Select value={form.paymentMode} onValueChange={v => setField('paymentMode', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAYMENT_MODES.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* Vendor */}
            <div className="space-y-1.5">
              <Label>Vendor / Party Name</Label>
              <Input value={form.vendorPartyName} onChange={e => setField('vendorPartyName', e.target.value)} placeholder="Vendor or party name" />
            </div>

            {/* Bill No */}
            <div className="space-y-1.5">
              <Label>Bill No.</Label>
              <Input value={form.billNo} onChange={e => setField('billNo', e.target.value)} placeholder="Bill / voucher number" />
            </div>

            {/* Narration */}
            <div className="col-span-2 space-y-1.5">
              <Label>Narration</Label>
              <Input value={form.narration} onChange={e => setField('narration', e.target.value)} placeholder="Brief description of payment purpose" />
            </div>

            {/* Remarks */}
            <div className="col-span-2 space-y-1.5">
              <Label>Remarks</Label>
              <Textarea rows={2} value={form.remarks} onChange={e => setField('remarks', e.target.value)} placeholder="Additional notes" />
            </div>

            {/* ── Attachments ─────────────────────────────────────────────────── */}
            <div className="col-span-2 space-y-2">
              <Label className="flex items-center gap-1.5">
                <Paperclip className="h-3.5 w-3.5" />
                Attachments
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

              {/* Pending files (not yet uploaded) */}
              {pendingFiles.map((file, i) => (
                <div key={i} className="flex items-center gap-2 rounded-lg border border-dashed border-blue-300 bg-blue-50/60 px-3 py-2">
                  <AttachmentIcon type={file.type} />
                  <span className="flex-1 text-sm truncate">{file.name}</span>
                  <span className="text-xs text-muted-foreground shrink-0">{formatSize(file.size)}</span>
                  <Badge variant="outline" className="text-xs text-blue-600 border-blue-300 shrink-0">Pending</Badge>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-destructive hover:bg-destructive/10 shrink-0"
                    onClick={() => handleRemovePending(i)}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}

              {/* File picker row */}
              <div className="flex gap-2">
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

              {pendingFiles.length > 0 && (
                <p className="text-xs text-blue-600">
                  {pendingFiles.length} file{pendingFiles.length > 1 ? 's' : ''} will be uploaded when you save.
                </p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={saving} className="bg-rose-600 hover:bg-rose-700 min-w-[130px]">
              {saving && (
                uploading
                  ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Uploading…</>
                  : <><Loader2 className="h-4 w-4 animate-spin mr-2" />Saving…</>
              )}
              {!saving && (editingRow ? 'Save Changes' : 'Record Expense')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
