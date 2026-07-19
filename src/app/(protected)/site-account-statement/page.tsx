'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  addDoc, collection, doc, getDocs, orderBy, query, serverTimestamp, updateDoc,
} from 'firebase/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '@/lib/firebase';
import { db } from '@/lib/firebase';
import {
  formatINR, PAYMENT_MODES, SAS_COLLECTIONS,
  type SASAttachment, type SASBudget, type SASCategory, type SASExpense, type SASPayment, type SASProject,
} from '@/lib/site-account-statement';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useActivityLogger } from '@/hooks/useActivityLogger';
import { useAuth } from '@/components/auth/AuthProvider';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import {
  AlertTriangle, ArrowDownRight, ArrowUpRight, BarChart3,
  BookOpen, Building2, File, FileText, Loader2, Paperclip, Plus, Receipt, Target,
  TrendingDown, TrendingUp, Wallet, X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

const MODULE = 'Site Account Statement';

// ─── Shared stat card ───────────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, colorClass }: {
  icon: LucideIcon; label: string; value: string; colorClass: string;
}) {
  return (
    <div className={cn('flex items-center gap-3 rounded-xl border bg-white/80 p-4 shadow-sm backdrop-blur-sm', colorClass)}>
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-current/10">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] sm:text-xs text-muted-foreground">{label}</p>
        <p className="text-sm sm:text-base font-bold leading-tight truncate">{value}</p>
      </div>
    </div>
  );
}

// ─── Quick-add expense dialog (per project card) ─────────────────────────────

interface QuickExpenseDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  project: SASProject;
  categories: SASCategory[];
  defaultExpensedBy: string;
  projectReceived: number;
  projectSpent: number;
  projectBalance: number;
  onSuccess: () => void;
}

function QuickExpenseDialog({
  open, onOpenChange, project, categories, defaultExpensedBy,
  projectReceived, projectSpent, projectBalance,
  onSuccess,
}: QuickExpenseDialogProps) {
  const { toast } = useToast();
  const { log } = useActivityLogger(MODULE);
  const [saving, setSaving] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    expenseCategoryId: '',   // UI only — for sub-cat filtering
    expenseCategory: '',   // main category name stored in DB
    expenseSubCategory: '',   // sub-category name stored in DB
    narration: '',
    expensedBy: defaultExpensedBy,
    expenseDate: new Date().toISOString().slice(0, 10),
    expenseAmount: '',
    paymentMode: 'Cash',
    vendorPartyName: '',
    billNo: '',
    remarks: '',
  });

  const mainCategories = useMemo(() => categories.filter(c => !c.parentId), [categories]);
  const subCategoryOptions = useMemo(
    () => form.expenseCategoryId
      ? categories.filter(c => c.parentId === form.expenseCategoryId)
      : [],
    [categories, form.expenseCategoryId]
  );

  function setF(key: string, value: string) { setForm(f => ({ ...f, [key]: value })); }

  function handleMainCategoryChange(catId: string) {
    if (catId === '_none_') { setForm(f => ({ ...f, expenseCategoryId: '', expenseCategory: '', expenseSubCategory: '' })); return; }
    const cat = mainCategories.find(c => c.id === catId);
    setForm(f => ({ ...f, expenseCategoryId: catId, expenseCategory: cat?.name ?? '', expenseSubCategory: '' }));
  }

  function addFiles(files: FileList | null) {
    if (!files) return;
    setPendingFiles(prev => [...prev, ...Array.from(files)]);
  }

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

  function resetForm() {
    setForm(f => ({
      ...f,
      expenseCategoryId: '', expenseCategory: '', expenseSubCategory: '',
      narration: '', expenseAmount: '', vendorPartyName: '', billNo: '', remarks: '',
    }));
    setPendingFiles([]);
  }

  async function submit() {
    if (!form.expenseCategory) { toast({ title: 'Validation', description: 'Select a main category.', variant: 'destructive' }); return; }
    if (!form.expensedBy.trim()) { toast({ title: 'Validation', description: 'Expensed By is required.', variant: 'destructive' }); return; }
    if (!form.expenseDate) { toast({ title: 'Validation', description: 'Date is required.', variant: 'destructive' }); return; }
    const amount = Number(form.expenseAmount);
    if (!amount || amount <= 0) { toast({ title: 'Validation', description: 'Enter a valid amount.', variant: 'destructive' }); return; }

    setSaving(true);
    try {
      const docRef = await addDoc(collection(db, SAS_COLLECTIONS.expenses), {
        projectId: project.id,
        projectName: project.projectName,
        expenseCategory: form.expenseCategory,
        expenseSubCategory: form.expenseSubCategory || null,
        narration: form.narration.trim() || null,
        expensedBy: form.expensedBy.trim(),
        expenseDate: form.expenseDate,
        expenseAmount: amount,
        paymentMode: form.paymentMode,
        vendorPartyName: form.vendorPartyName.trim(),
        billNo: form.billNo.trim(),
        remarks: form.remarks.trim(),
        attachments: [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      if (pendingFiles.length > 0) {
        const attachments = await uploadAttachments(docRef.id, pendingFiles);
        await updateDoc(doc(db, SAS_COLLECTIONS.expenses, docRef.id), { attachments, updatedAt: serverTimestamp() });
      }

      void log('Add SAS Expense (quick)', { project: project.projectName, amount });
      toast({ title: 'Expense recorded', description: `₹${amount.toLocaleString('en-IN')} saved for ${project.projectName}.` });
      resetForm();
      onOpenChange(false);
      onSuccess();
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Expense — {project.projectName}</DialogTitle>
        </DialogHeader>

        {/* Project balance banner */}
        <div className="grid grid-cols-3 gap-2 rounded-lg border bg-slate-50 px-3 py-2 text-center text-xs">
          <div>
            <p className="text-muted-foreground">Received</p>
            <p className="font-semibold text-blue-600">{formatINR(projectReceived)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Expenses</p>
            <p className="font-semibold text-rose-600">{formatINR(projectSpent)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Available Balance</p>
            <p className={`font-bold text-sm ${projectBalance >= 0 ? 'text-emerald-700' : 'text-destructive'}`}>
              {formatINR(projectBalance)}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 py-1">

          {/* Main Category */}
          <div className="col-span-2 space-y-1.5">
            <Label>Main Category <span className="text-destructive">*</span></Label>
            <Select value={form.expenseCategoryId || '_none_'} onValueChange={handleMainCategoryChange}>
              <SelectTrigger><SelectValue placeholder="Select main category" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="_none_" disabled>Select main category</SelectItem>
                {mainCategories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* Sub-Category */}
          <div className="col-span-2 space-y-1.5">
            <Label className="flex items-center gap-1.5">
              Sub-Category
              <span className="text-xs text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Select
              value={form.expenseSubCategory || '_none_'}
              onValueChange={v => setF('expenseSubCategory', v === '_none_' ? '' : v)}
              disabled={subCategoryOptions.length === 0}
            >
              <SelectTrigger>
                <SelectValue placeholder={subCategoryOptions.length === 0 ? 'No sub-categories' : 'Select sub-category'} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_none_">None</SelectItem>
                {subCategoryOptions.map(c => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* Narration */}
          <div className="col-span-2 space-y-1.5">
            <Label className="flex items-center gap-1.5">
              Narration
              <span className="text-xs text-muted-foreground font-normal">(payment details)</span>
            </Label>
            <Input value={form.narration} onChange={e => setF('narration', e.target.value)} placeholder="e.g. Labour wages for week ending…" />
          </div>

          {/* Expensed By + Date */}
          <div className="space-y-1.5">
            <Label>Expensed By <span className="text-destructive">*</span></Label>
            <Input value={form.expensedBy} onChange={e => setF('expensedBy', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Date <span className="text-destructive">*</span></Label>
            <Input type="date" value={form.expenseDate} onChange={e => setF('expenseDate', e.target.value)} />
          </div>

          {/* Amount + Mode */}
          <div className="space-y-1.5">
            <Label>Amount (₹) <span className="text-destructive">*</span></Label>
            <Input type="number" min="0" value={form.expenseAmount} onChange={e => setF('expenseAmount', e.target.value)} placeholder="0" />
          </div>
          <div className="space-y-1.5">
            <Label>Payment Mode</Label>
            <Select value={form.paymentMode} onValueChange={v => setF('paymentMode', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{PAYMENT_MODES.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
            </Select>
          </div>

          {/* Vendor + Bill */}
          <div className="space-y-1.5">
            <Label>Vendor / Party</Label>
            <Input value={form.vendorPartyName} onChange={e => setF('vendorPartyName', e.target.value)} placeholder="Optional" />
          </div>
          <div className="space-y-1.5">
            <Label>Bill No.</Label>
            <Input value={form.billNo} onChange={e => setF('billNo', e.target.value)} placeholder="Optional" />
          </div>

          {/* Remarks */}
          <div className="col-span-2 space-y-1.5">
            <Label>Remarks</Label>
            <Textarea rows={2} value={form.remarks} onChange={e => setF('remarks', e.target.value)} placeholder="Additional notes" />
          </div>

          {/* Documents */}
          <div className="col-span-2 space-y-2">
            <Label className="flex items-center gap-1.5">
              <Paperclip className="h-3.5 w-3.5" /> Documents
              <span className="text-xs text-muted-foreground font-normal">(optional)</span>
            </Label>

            {/* Pending files list */}
            {pendingFiles.length > 0 && (
              <div className="space-y-1">
                {pendingFiles.map((f, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5">
                    <File className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                    <span className="flex-1 truncate text-xs">{f.name}</span>
                    <span className="text-[10px] text-muted-foreground">{(f.size / 1024).toFixed(0)} KB</span>
                    <button
                      type="button"
                      onClick={() => setPendingFiles(prev => prev.filter((_, idx) => idx !== i))}
                      className="ml-1 rounded-sm text-blue-400 hover:text-destructive"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* File picker */}
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-muted-foreground/30 px-3 py-2 text-xs text-muted-foreground hover:border-primary hover:text-primary transition-colors">
              <Paperclip className="h-3.5 w-3.5 shrink-0" />
              <span>Click to attach files (PDF, images, documents)</span>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.txt"
                className="sr-only"
                onChange={e => { addFiles(e.target.files); e.target.value = ''; }}
              />
            </label>
          </div>

        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={saving} className="bg-rose-600 hover:bg-rose-700">
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            {saving && pendingFiles.length > 0 ? 'Uploading…' : 'Save Expense'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Per-project card for assigned person ────────────────────────────────────

interface MyProjectCardProps {
  project: SASProject;
  payments: SASPayment[];
  expenses: SASExpense[];
  categories: SASCategory[];
  currentUserName: string;
  budget?: SASBudget;
  onRefresh: () => void;
}

function MyProjectCard({ project, payments, expenses, categories, currentUserName, budget, onRefresh }: MyProjectCardProps) {
  const [expenseDialogOpen, setExpenseDialogOpen] = useState(false);

  const projPayments = useMemo(() => payments.filter(p => p.projectId === project.id), [payments, project.id]);
  const projExpenses = useMemo(() => expenses.filter(e => e.projectId === project.id), [expenses, project.id]);

  const totalReceived = useMemo(() => projPayments.reduce((s, p) => s + (p.receivedAmount || 0), 0), [projPayments]);
  const totalExpenses = useMemo(() => projExpenses.reduce((s, e) => s + (e.expenseAmount || 0), 0), [projExpenses]);
  const balance = totalReceived - totalExpenses;

  const recentTx = useMemo(() => {
    type Tx = { date: string; label: string; amount: number; type: 'receipt' | 'expense' };
    const list: Tx[] = [
      ...projPayments.map(p => ({ date: p.receiptDate, label: 'Payment from HO', amount: p.receivedAmount, type: 'receipt' as const })),
      ...projExpenses.map(e => ({ date: e.expenseDate, label: e.expenseCategory, amount: e.expenseAmount, type: 'expense' as const })),
    ];
    return list.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  }, [projPayments, projExpenses]);

  return (
    <>
      <Card className="bg-white/90 border border-emerald-100 shadow-md overflow-hidden">
        {/* Card header */}
        <CardHeader className="bg-gradient-to-r from-emerald-50 to-teal-50 border-b border-emerald-100 pb-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="text-base font-bold text-slate-800 truncate">{project.projectName}</CardTitle>
              {project.projectCode && (
                <Badge variant="outline" className="mt-1 text-xs border-emerald-300 text-emerald-700">{project.projectCode}</Badge>
              )}
            </div>
            <div className="text-right shrink-0">
              <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Balance</p>
              <p className={cn('text-2xl font-bold leading-tight', balance >= 0 ? 'text-emerald-600' : 'text-destructive')}>
                {formatINR(balance)}
              </p>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-4 space-y-4">
          {/* Received / Expenses row */}
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-blue-50 border border-blue-100 px-3 py-2.5">
              <div className="flex items-center gap-1.5 mb-0.5">
                <TrendingUp className="h-3.5 w-3.5 text-blue-500" />
                <p className="text-xs text-blue-600 font-medium">Received</p>
              </div>
              <p className="text-base font-bold text-blue-700">{formatINR(totalReceived)}</p>
            </div>
            <div className="rounded-lg bg-rose-50 border border-rose-100 px-3 py-2.5">
              <div className="flex items-center gap-1.5 mb-0.5">
                <TrendingDown className="h-3.5 w-3.5 text-rose-500" />
                <p className="text-xs text-rose-600 font-medium">Expenses</p>
              </div>
              <p className="text-base font-bold text-rose-700">{formatINR(totalExpenses)}</p>
            </div>
          </div>

          {/* Budget utilization */}
          {budget && (
            <div className="rounded-lg bg-emerald-50 border border-emerald-100 px-3 py-2.5">
              <div className="flex items-center justify-between gap-2 mb-1">
                <div className="flex items-center gap-1.5">
                  <Target className="h-3.5 w-3.5 text-emerald-600" />
                  <p className="text-xs text-emerald-700 font-medium">Total Budget</p>
                </div>
                <span className={cn('text-xs font-semibold', totalExpenses > budget.budgetAmount ? 'text-destructive' : totalExpenses / budget.budgetAmount >= 0.8 ? 'text-amber-600' : 'text-emerald-600')}>
                  {((totalExpenses / budget.budgetAmount) * 100).toFixed(1)}% used
                </span>
              </div>
              <div className="w-full bg-emerald-200/50 rounded-full h-1.5">
                <div
                  className={cn('h-1.5 rounded-full', totalExpenses > budget.budgetAmount ? 'bg-destructive' : totalExpenses / budget.budgetAmount >= 0.8 ? 'bg-amber-500' : 'bg-emerald-500')}
                  style={{ width: `${Math.min((totalExpenses / budget.budgetAmount) * 100, 100)}%` }}
                />
              </div>
              <div className="flex justify-between mt-1">
                <p className="text-[10px] text-muted-foreground">{formatINR(totalExpenses)} spent</p>
                <p className={cn('text-[10px] font-medium', budget.budgetAmount - totalExpenses < 0 ? 'text-destructive' : 'text-emerald-600')}>
                  {budget.budgetAmount - totalExpenses >= 0 ? formatINR(budget.budgetAmount - totalExpenses) + ' remaining' : formatINR(totalExpenses - budget.budgetAmount) + ' over budget'}
                </p>
              </div>
            </div>
          )}

          {/* Recent transactions */}
          {recentTx.length > 0 ? (
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Recent Transactions</p>
              <div className="space-y-1.5">
                {recentTx.map((tx, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <div className={cn(
                      'flex h-6 w-6 shrink-0 items-center justify-center rounded-full',
                      tx.type === 'receipt' ? 'bg-blue-100' : 'bg-rose-100'
                    )}>
                      {tx.type === 'receipt'
                        ? <ArrowUpRight className="h-3.5 w-3.5 text-blue-600" />
                        : <ArrowDownRight className="h-3.5 w-3.5 text-rose-600" />}
                    </div>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">{tx.date}</span>
                    <span className="flex-1 truncate text-xs">{tx.label}</span>
                    <span className={cn('text-xs font-semibold shrink-0', tx.type === 'receipt' ? 'text-blue-600' : 'text-rose-600')}>
                      {tx.type === 'receipt' ? '+' : '-'}{formatINR(tx.amount)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-center text-xs text-muted-foreground py-2">No transactions yet.</p>
          )}

          {/* Action buttons */}
          <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-100">
            <Button
              size="sm"
              className="gap-1.5 bg-rose-600 hover:bg-rose-700 text-white"
              onClick={() => setExpenseDialogOpen(true)}
            >
              <Plus className="h-3.5 w-3.5" /> Add Expense
            </Button>
            <Link href={`/site-account-statement/reports/statement?projectId=${project.id}`} className="w-full">
              <Button size="sm" variant="outline" className="w-full gap-1.5">
                <BookOpen className="h-3.5 w-3.5" /> Statement
              </Button>
            </Link>
            <Link href="/site-account-statement/expenses" className="w-full">
              <Button size="sm" variant="outline" className="w-full gap-1.5">
                <Receipt className="h-3.5 w-3.5" /> All Expenses
              </Button>
            </Link>
            <Link href={`/site-account-statement/reports/expenses`} className="w-full">
              <Button size="sm" variant="outline" className="w-full gap-1.5">
                <FileText className="h-3.5 w-3.5" /> Expense Report
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>

      <QuickExpenseDialog
        open={expenseDialogOpen}
        onOpenChange={setExpenseDialogOpen}
        project={project}
        categories={categories}
        defaultExpensedBy={currentUserName}
        projectReceived={totalReceived}
        projectSpent={totalExpenses}
        projectBalance={balance}
        onSuccess={onRefresh}
      />
    </>
  );
}

// ─── Main dashboard page ──────────────────────────────────────────────────────

export default function SiteAccountDashboardPage() {
  const { user } = useAuth();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const canViewAll = can('View', `${MODULE}.All Projects`);
  const canViewDashboard = can('View', `${MODULE}.Dashboard`) || canViewAll;

  const [projects, setProjects] = useState<SASProject[]>([]);
  const [payments, setPayments] = useState<SASPayment[]>([]);
  const [expenses, setExpenses] = useState<SASExpense[]>([]);
  const [categories, setCategories] = useState<SASCategory[]>([]);
  const [budgets, setBudgets] = useState<SASBudget[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isAuthLoading) return;
    void loadAll();
  }, [isAuthLoading]);

  async function loadAll() {
    setLoading(true);
    try {
      const [pSnap, paySnap, expSnap, catSnap, budSnap] = await Promise.all([
        getDocs(query(collection(db, SAS_COLLECTIONS.projects))),
        getDocs(query(collection(db, SAS_COLLECTIONS.payments), orderBy('receiptDate', 'desc'))),
        getDocs(query(collection(db, SAS_COLLECTIONS.expenses), orderBy('expenseDate', 'desc'))),
        getDocs(query(collection(db, SAS_COLLECTIONS.categories), orderBy('name'))),
        getDocs(collection(db, SAS_COLLECTIONS.budgets)),
      ]);
      setProjects(pSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASProject)));
      setPayments(paySnap.docs.map(d => ({ id: d.id, ...d.data() } as SASPayment)));
      setExpenses(expSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASExpense)));
      setCategories(catSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASCategory)).filter(c => c.isActive !== false));
      setBudgets(budSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASBudget)));
    } finally {
      setLoading(false);
    }
  }

  // Projects where the current user is primary, alt, or viewer
  const myProjects = useMemo(
    () => canViewAll
      ? []
      : projects.filter(p =>
        (p.assignedPersonId === user?.id || p.altUserId === user?.id) &&
        p.enabledForSiteAccount && p.status === 'Active'
      ),
    [projects, user?.id, canViewAll]
  );

  // Includes viewer-only access (for access gate)
  const myAccessibleProjects = useMemo(
    () => canViewAll
      ? []
      : projects.filter(p =>
        (p.assignedPersonId === user?.id || p.altUserId === user?.id || p.viewerId === user?.id) &&
        p.enabledForSiteAccount && p.status === 'Active'
      ),
    [projects, user?.id, canViewAll]
  );

  // All enabled projects for admin overview
  const enabledProjects = useMemo(
    () => projects.filter(p => p.enabledForSiteAccount && p.status === 'Active'),
    [projects]
  );

  // Admin summary numbers
  const totalReceived = useMemo(() => payments.reduce((s, p) => s + (p.receivedAmount || 0), 0), [payments]);
  const totalExpenses = useMemo(() => expenses.reduce((s, e) => s + (e.expenseAmount || 0), 0), [expenses]);
  const totalBalance = totalReceived - totalExpenses;

  const projectStats = useMemo(() => enabledProjects.map(proj => {
    const received = payments.filter(p => p.projectId === proj.id).reduce((s, p) => s + (p.receivedAmount || 0), 0);
    const spent = expenses.filter(e => e.projectId === proj.id).reduce((s, e) => s + (e.expenseAmount || 0), 0);
    const budget = budgets.find(b => b.projectId === proj.id && b.budgetType === 'total');
    const totalBudget = budget?.budgetAmount ?? 0;
    return { id: proj.id, name: proj.projectName, received, expenses: spent, balance: received - spent, totalBudget, budgetUsedPct: totalBudget > 0 ? (spent / totalBudget) * 100 : 0 };
  }).sort((a, b) => b.balance - a.balance), [enabledProjects, payments, expenses, budgets]);

  const highestExpense = useMemo(() => [...projectStats].sort((a, b) => b.expenses - a.expenses)[0], [projectStats]);
  const lowBalance = useMemo(() => projectStats.filter(p => p.balance < 10000), [projectStats]);
  const overBudget = useMemo(() => projectStats.filter(p => p.totalBudget > 0 && p.expenses > p.totalBudget), [projectStats]);

  if (isAuthLoading || loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {[...Array(2)].map((_, i) => <Skeleton key={i} className="h-64 rounded-xl" />)}
        </div>
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  if (!canViewDashboard && myAccessibleProjects.length === 0) {
    return (
      <Card><CardHeader><CardTitle>Access Denied</CardTitle></CardHeader>
        <CardContent><p className="text-muted-foreground text-sm">You do not have permission to view this module.</p></CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">

      {/* ── My Projects (assigned person view) ── */}
      {myProjects.length > 0 && (
        <section>
          <div className="mb-3 flex items-center gap-2">
            <Wallet className="h-4 w-4 text-emerald-600" />
            <h2 className="text-base font-bold text-slate-800">My Projects</h2>
            <Badge className="bg-emerald-100 text-emerald-700 text-xs">{myProjects.length}</Badge>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {myProjects.map(proj => (
              <MyProjectCard
                key={proj.id}
                project={proj}
                payments={payments}
                expenses={expenses}
                categories={categories}
                currentUserName={user?.name ?? ''}
                budget={budgets.find(b => b.projectId === proj.id && b.budgetType === 'total')}
                onRefresh={loadAll}
              />
            ))}
          </div>
        </section>
      )}

      {/* ── Admin overview (only for View Module holders) ── */}
      {canViewAll && (
        <section>
          {myProjects.length > 0 && (
            <div className="mb-3 flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-indigo-600" />
              <h2 className="text-base font-bold text-slate-800">Overall Overview</h2>
            </div>
          )}

          {/* Stat cards */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 mb-4">
            <StatCard icon={Building2} label="Enabled Projects" value={String(enabledProjects.length)} colorClass="text-emerald-600" />
            <StatCard icon={TrendingUp} label="Total Received from HO" value={formatINR(totalReceived)} colorClass="text-blue-600" />
            <StatCard icon={TrendingDown} label="Total Site Expenses" value={formatINR(totalExpenses)} colorClass="text-rose-600" />
            <StatCard
              icon={Wallet}
              label="Total Balance"
              value={formatINR(totalBalance)}
              colorClass={totalBalance >= 0 ? 'text-teal-600' : 'text-destructive'}
            />
          </div>

          {/* Project-wise summary table */}
          <Card className="bg-white/80 backdrop-blur-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Project-Wise Summary</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {projectStats.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                  No enabled projects. Configure in Project Settings.
                </p>
              ) : (
                <div className="overflow-x-auto overflow-y-auto max-h-[60vh]">
                  <table className="w-full min-w-[600px] text-sm">
                    <thead className="sticky top-0 z-10">
                      <tr className="border-b bg-slate-100">
                        <th className="px-4 py-2 text-left font-medium">Project</th>
                        <th className="px-4 py-2 text-right font-medium">Received</th>
                        <th className="px-4 py-2 text-right font-medium">Expenses</th>
                        <th className="px-4 py-2 text-right font-medium">Balance</th>
                        <th className="px-4 py-2 text-right font-medium">Budget</th>
                        <th className="px-4 py-2 text-right font-medium">Used %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {projectStats.map(stat => (
                        <tr key={stat.id} className="border-b hover:bg-muted/20 transition-colors">
                          <td className="px-4 py-2 font-medium">{stat.name}</td>
                          <td className="px-4 py-2 text-right text-blue-600">{formatINR(stat.received)}</td>
                          <td className="px-4 py-2 text-right text-rose-600">{formatINR(stat.expenses)}</td>
                          <td className={cn('px-4 py-2 text-right font-semibold', stat.balance >= 0 ? 'text-emerald-600' : 'text-destructive')}>
                            {formatINR(stat.balance)}
                          </td>
                          <td className="px-4 py-2 text-right text-emerald-700 text-sm">
                            {stat.totalBudget > 0 ? formatINR(stat.totalBudget) : <span className="text-muted-foreground">—</span>}
                          </td>
                          <td className={cn('px-4 py-2 text-right text-sm font-medium', stat.totalBudget > 0 && stat.budgetUsedPct >= 100 ? 'text-destructive' : stat.totalBudget > 0 && stat.budgetUsedPct >= 80 ? 'text-amber-600' : 'text-slate-500')}>
                            {stat.totalBudget > 0 ? `${stat.budgetUsedPct.toFixed(1)}%` : <span className="text-muted-foreground">—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-muted/30 font-semibold">
                        <td className="px-4 py-2">Total</td>
                        <td className="px-4 py-2 text-right text-blue-700">{formatINR(totalReceived)}</td>
                        <td className="px-4 py-2 text-right text-rose-700">{formatINR(totalExpenses)}</td>
                        <td className={cn('px-4 py-2 text-right', totalBalance >= 0 ? 'text-emerald-700' : 'text-destructive')}>
                          {formatINR(totalBalance)}
                        </td>
                        <td />
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      )}

      {/* Neither admin nor assigned — show empty state */}
      {!canViewAll && myProjects.length === 0 && (
        <Card className="bg-white/80">
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <Wallet className="h-12 w-12 text-muted-foreground/30" />
            <p className="font-medium text-slate-700">No projects assigned</p>
            <p className="text-sm text-muted-foreground max-w-xs">
              You have not been assigned to any project yet. Contact your admin to get access.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
