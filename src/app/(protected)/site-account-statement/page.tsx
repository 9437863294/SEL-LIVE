'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  addDoc, collection, doc, getDocs, orderBy, query, serverTimestamp, updateDoc,
} from 'firebase/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '@/lib/firebase-storage';
import { db } from '@/lib/firebase';
import {
  formatINR, PAYMENT_MODES, SAS_COLLECTIONS,
  type SASAttachment, type SASBudget, type SASCategory, type SASExpense, type SASPayment, type SASProject,
} from '@/lib/site-account-statement';
import { runBudgetAlertChecks } from '@/lib/sas-budget-alerts';
import { allExpenses as fetchAllExpenses, allPayments as fetchAllPayments } from '@/lib/site-account-statement-queries';
import { useFieldControl, validateFieldControlRequirements } from '@/components/site-account-statement/use-field-control';
import { fieldMark } from '@/components/site-account-statement/controlled-field';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useActivityLogger } from '@/hooks/useActivityLogger';
import { useAuth } from '@/components/auth/AuthProvider';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
  BookOpen, Building2, File, FileText, Filter, Loader2, Paperclip, Plus, Receipt, Search, Target,
  TrendingDown, TrendingUp, Wallet, X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

const MODULE = 'Site Account Statement';

// ─── FY helpers ──────────────────────────────────────────────────────────────

function currentFYStart(): number {
  const d = new Date();
  return d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
}

function getFYMonths(fyStartYear: number): string[] {
  const months: string[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(fyStartYear, 3 + i);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return months;
}

function fyLabel(fyStartYear: number): string {
  return `${fyStartYear}-${String(fyStartYear + 1).slice(-2)}`;
}

function currentMonthStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1).toLocaleString('default', { month: 'short', year: '2-digit' });
}

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
  const { field } = useFieldControl('expense');
  const { user } = useAuth();
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
    isGstBill: false,
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
      narration: '', expenseAmount: '', vendorPartyName: '', billNo: '', isGstBill: false, remarks: '',
    }));
    setPendingFiles([]);
  }

  async function submit() {
    if (!form.expenseDate) { toast({ title: 'Validation', description: 'Date is required.', variant: 'destructive' }); return; }
    const amount = Number(form.expenseAmount);
    if (!amount || amount <= 0) { toast({ title: 'Validation', description: 'Enter a valid amount.', variant: 'destructive' }); return; }
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
      attachment: pendingFiles.length > 0 ? 'attached' : '',
    }, field);
    if (missingLabel) { toast({ title: 'Validation', description: `${missingLabel} is required.`, variant: 'destructive' }); return; }

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
        isGstBill: form.isGstBill,
        remarks: form.remarks.trim(),
        attachments: [],
        createdAt: serverTimestamp(),
        createdBy: user?.id || '',
        createdByName: user?.name || '',
        updatedAt: serverTimestamp(),
        updatedBy: user?.id || '',
        updatedByName: user?.name || '',
      });

      if (pendingFiles.length > 0) {
        const attachments = await uploadAttachments(docRef.id, pendingFiles);
        // No updatedAt bump — finishing its own upload is part of recording, not an edit.
        await updateDoc(doc(db, SAS_COLLECTIONS.expenses, docRef.id), { attachments });
      }

      void log('Add SAS Expense (quick)', { project: project.projectName, amount });
      toast({ title: 'Expense recorded', description: `₹${amount.toLocaleString('en-IN')} saved for ${project.projectName}.` });
      resetForm();
      onOpenChange(false);
      onSuccess();
      /*
       * Fire-and-forget — do not await, do not block.
       *
       * This used to check only the *monthly* budget, so a quick-added expense could take a project
       * past its FY, total or category budget without anyone hearing about it, while the very same
       * expense added from the Site Expenses page would have alerted on all four. One call now runs
       * every scope from a single load of the alert configuration.
       */
      void runBudgetAlertChecks({
        projectId: project.id,
        projectName: project.projectName,
        periods: [form.expenseDate.slice(0, 7)],
        categoryNames: [form.expenseCategory].filter(Boolean),
        newExpenseAmount: amount,
        assignedPersonId: project.assignedPersonId,
        altUserId: project.altUserId,
      });
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
          {field('expenseCategory').visible && (
          <div className="col-span-2 space-y-1.5">
            <Label>{field('expenseCategory').label} {fieldMark(field('expenseCategory'))}</Label>
            <Select value={form.expenseCategoryId || '_none_'} onValueChange={handleMainCategoryChange}>
              <SelectTrigger><SelectValue placeholder="Select main category" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="_none_" disabled>Select main category</SelectItem>
                {mainCategories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          )}

          {/* Sub-Category */}
          {field('expenseSubCategory').visible && (
          <div className="col-span-2 space-y-1.5">
            <Label className="flex items-center gap-1.5">
              {field('expenseSubCategory').label} {fieldMark(field('expenseSubCategory'))}
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
          )}

          {/* Narration */}
          {field('narration').visible && (
          <div className="col-span-2 space-y-1.5">
            <Label className="flex items-center gap-1.5">
              {field('narration').label} {fieldMark(field('narration'))}
            </Label>
            <Input value={form.narration} onChange={e => setF('narration', e.target.value)} placeholder="e.g. Labour wages for week ending…" />
          </div>
          )}

          {/* Expensed By + Date */}
          {field('expensedBy').visible && (
          <div className="space-y-1.5">
            <Label>{field('expensedBy').label} {fieldMark(field('expensedBy'))}</Label>
            <Input value={form.expensedBy} onChange={e => setF('expensedBy', e.target.value)} />
          </div>
          )}
          <div className="space-y-1.5">
            <Label>{field('expenseDate').label} <span className="text-destructive">*</span></Label>
            <Input type="date" value={form.expenseDate} onChange={e => setF('expenseDate', e.target.value)} />
          </div>

          {/* Amount + Mode */}
          <div className="space-y-1.5">
            <Label>{field('expenseAmount').label} (₹) <span className="text-destructive">*</span></Label>
            <Input type="number" min="0" value={form.expenseAmount} onChange={e => setF('expenseAmount', e.target.value)} placeholder="0" />
          </div>
          {field('paymentMode').visible && (
          <div className="space-y-1.5">
            <Label>{field('paymentMode').label} {fieldMark(field('paymentMode'))}</Label>
            <Select value={form.paymentMode} onValueChange={v => setF('paymentMode', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{PAYMENT_MODES.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          )}

          {/* Vendor + Bill */}
          {field('vendorPartyName').visible && (
          <div className="space-y-1.5">
            <Label>{field('vendorPartyName').label} {fieldMark(field('vendorPartyName'))}</Label>
            <Input value={form.vendorPartyName} onChange={e => setF('vendorPartyName', e.target.value)} placeholder="Optional" />
          </div>
          )}
          {field('billNo').visible && (
          <div className="space-y-1.5">
            <Label>{field('billNo').label} {fieldMark(field('billNo'))}</Label>
            <Input value={form.billNo} onChange={e => setF('billNo', e.target.value)} placeholder="Optional" />
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

          {/* Remarks */}
          {field('remarks').visible && (
          <div className="col-span-2 space-y-1.5">
            <Label>{field('remarks').label} {fieldMark(field('remarks'))}</Label>
            <Textarea rows={2} value={form.remarks} onChange={e => setF('remarks', e.target.value)} placeholder="Additional notes" />
          </div>
          )}

          {/* Documents */}
          {field('attachment').visible && (
          <div className="col-span-2 space-y-2">
            <Label className="flex items-center gap-1.5">
              <Paperclip className="h-3.5 w-3.5" /> {field('attachment').label} {fieldMark(field('attachment'))}
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
          )}

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
  totalBudgetAmount?: number;
  /** How `totalBudgetAmount` was arrived at, so the card can say so rather than imply an exact figure. */
  budgetSource?: 'total' | 'fy-sum' | 'month-sum';
  /** False for viewer-only assignments — the card renders read-only. */
  canRecordExpense: boolean;
  onRefresh: () => void;
}

function MyProjectCard({
  project, payments, expenses, categories, currentUserName,
  totalBudgetAmount, budgetSource, canRecordExpense, onRefresh,
}: MyProjectCardProps) {
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
          {!!totalBudgetAmount && (
            <div className="rounded-lg bg-emerald-50 border border-emerald-100 px-3 py-2.5">
              <div className="flex items-center justify-between gap-2 mb-1">
                <div className="flex items-center gap-1.5">
                  <Target className="h-3.5 w-3.5 text-emerald-600" />
                  {/* The label now states which budget this actually is. It previously read
                      "Total Budget" while showing the sum of every monthly budget row ever
                      recorded — a different number from the one the summary table called by the
                      same name two sections below. */}
                  <p className="text-xs text-emerald-700 font-medium">
                    {budgetSource === 'total' ? 'Total Budget'
                      : budgetSource === 'fy-sum' ? 'Total Budget (∑ FY)'
                      : 'Total Budget (∑ monthly)'}
                  </p>
                </div>
                <span className={cn('text-xs font-semibold', totalExpenses > totalBudgetAmount ? 'text-destructive' : totalExpenses / totalBudgetAmount >= 0.8 ? 'text-amber-600' : 'text-emerald-600')}>
                  {((totalExpenses / totalBudgetAmount) * 100).toFixed(1)}% used
                </span>
              </div>
              <div className="w-full bg-emerald-200/50 rounded-full h-1.5">
                <div
                  className={cn('h-1.5 rounded-full', totalExpenses > totalBudgetAmount ? 'bg-destructive' : totalExpenses / totalBudgetAmount >= 0.8 ? 'bg-amber-500' : 'bg-emerald-500')}
                  style={{ width: `${Math.min((totalExpenses / totalBudgetAmount) * 100, 100)}%` }}
                />
              </div>
              <div className="flex justify-between mt-1">
                <p className="text-[10px] text-muted-foreground">{formatINR(totalExpenses)} spent</p>
                <p className={cn('text-[10px] font-medium', totalBudgetAmount - totalExpenses < 0 ? 'text-destructive' : 'text-emerald-600')}>
                  {totalBudgetAmount - totalExpenses >= 0 ? formatINR(totalBudgetAmount - totalExpenses) + ' remaining' : formatINR(totalExpenses - totalBudgetAmount) + ' over budget'}
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
            {/* Viewers see the same figures without a way to write to the project. */}
            {canRecordExpense ? (
              <Button
                size="sm"
                className="gap-1.5 bg-rose-600 hover:bg-rose-700 text-white"
                onClick={() => setExpenseDialogOpen(true)}
              >
                <Plus className="h-3.5 w-3.5" /> Add Expense
              </Button>
            ) : (
              <div className="flex items-center justify-center rounded-md border border-dashed border-slate-200 px-2 text-[11px] text-muted-foreground">
                View only
              </div>
            )}
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

      {canRecordExpense && (
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
      )}
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
  /** True when the ledger scan hit its cap, so the figures below are incomplete and say so. */
  const [ledgerTruncated, setLedgerTruncated] = useState(false);

  useEffect(() => {
    if (isAuthLoading) return;
    void loadAll();
    // `user?.id` matters: the ledger scope is derived from it, so a late-resolving profile has to
    // re-run the load rather than leave the page showing an empty scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthLoading, user?.id, canViewAll]);

  async function loadAll() {
    setLoading(true);
    try {
      // Projects first — the ledger reads below are scoped to whichever ones this user may see,
      // rather than pulling every expense and payment in the organisation and filtering in the
      // browser.
      const [pSnap, catSnap, budSnap] = await Promise.all([
        getDocs(query(collection(db, SAS_COLLECTIONS.projects))),
        getDocs(query(collection(db, SAS_COLLECTIONS.categories), orderBy('name'))),
        getDocs(collection(db, SAS_COLLECTIONS.budgets)),
      ]);
      const allProjects = pSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASProject));
      setProjects(allProjects);
      setCategories(catSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASCategory)).filter(c => c.isActive !== false));
      setBudgets(budSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASBudget)));

      const scopeIds = canViewAll
        ? null
        : allProjects
            .filter(p => p.assignedPersonId === user?.id || p.altUserId === user?.id || p.viewerId === user?.id)
            .map(p => p.id);

      const [expenseResult, paymentResult] = await Promise.all([
        fetchAllExpenses({ projectIds: scopeIds }),
        fetchAllPayments({ projectIds: scopeIds }),
      ]);
      setExpenses(expenseResult.rows);
      setPayments(paymentResult.rows);
      setLedgerTruncated(expenseResult.truncated || paymentResult.truncated);
    } finally {
      setLoading(false);
    }
  }

  /*
   * Every project the user is attached to in any role — primary, alt, or viewer.
   *
   * The card list used to exclude viewers while the access gate included them, so a viewer-only
   * user passed the gate and then landed on "No projects assigned" — an empty state for someone who
   * had been deliberately granted read access. Viewers now get the same cards, minus the write
   * actions (see `canRecordExpense`).
   */
  const myProjects = useMemo(
    () => canViewAll
      ? []
      : projects.filter(p =>
        (p.assignedPersonId === user?.id || p.altUserId === user?.id || p.viewerId === user?.id) &&
        p.enabledForSiteAccount && p.status === 'Active'
      ),
    [projects, user?.id, canViewAll]
  );

  const myAccessibleProjects = myProjects;

  /** Recording spend needs a primary or alt assignment — a viewer sees the card read-only. */
  const canRecordExpenseOn = useMemo(() => (project: SASProject): boolean =>
    project.assignedPersonId === user?.id || project.altUserId === user?.id,
    [user?.id]
  );

  /**
   * A project's overall budget, using the same cascade as the Site Fund Budget page:
   * explicit total → sum of FY budgets → sum of monthly budgets.
   *
   * The card used to sum only the monthly rows and label the result "Total Budget", which both
   * ignored an explicit total budget entirely and disagreed with the summary table below — two
   * different numbers under the same name on one screen.
   */
  const budgetForProject = useMemo(() => (projectId: string) => {
    const explicit = budgets.find(b => b.projectId === projectId && b.budgetType === 'total');
    if (explicit && explicit.budgetAmount > 0) {
      return { amount: explicit.budgetAmount, source: 'total' as const };
    }
    const fySum = budgets
      .filter(b => b.projectId === projectId && b.budgetType === 'fy')
      .reduce((sum, b) => sum + (b.budgetAmount || 0), 0);
    if (fySum > 0) return { amount: fySum, source: 'fy-sum' as const };

    const monthSum = budgets
      .filter(b => b.projectId === projectId && b.budgetType === 'monthly')
      .reduce((sum, b) => sum + (b.budgetAmount || 0), 0);
    return { amount: monthSum, source: 'month-sum' as const };
  }, [budgets]);

  // All enabled projects for admin overview
  const enabledProjects = useMemo(
    () => projects.filter(p => p.enabledForSiteAccount && p.status === 'Active'),
    [projects]
  );

  // Filters for admin overview
  const [filterSearch, setFilterSearch] = useState('');
  const [filterFY, setFilterFY] = useState('all');
  const [filterMonth, setFilterMonth] = useState('');
  const [filterBudgetStatus, setFilterBudgetStatus] = useState('all');

  // Reset month when FY changes
  useEffect(() => {
    if (filterFY === 'all') {
      setFilterMonth('');
      return;
    }
    const fyMonths = getFYMonths(parseInt(filterFY.split('-')[0]));
    setFilterMonth(current => fyMonths.includes(current) ? current : '');
  }, [filterFY]);

  // Derive available FYs from monthly budget records
  const availableFYs = useMemo(() => {
    const fySet = new Set<string>();
    budgets.filter(b => b.budgetType === 'monthly' && b.period).forEach(b => {
      const [y, m] = b.period!.split('-').map(Number);
      const s = m >= 4 ? y : y - 1;
      fySet.add(fyLabel(s));
    });
    expenses.filter(e => e.expenseDate).forEach(e => {
      const [y, m] = e.expenseDate.split('-').map(Number);
      fySet.add(fyLabel(m >= 4 ? y : y - 1));
    });
    const cur = fyLabel(currentFYStart());
    if (!fySet.has(cur)) fySet.add(cur);
    return Array.from(fySet).sort().reverse();
  }, [budgets, expenses]);

  // Admin summary numbers
  const totalReceived = useMemo(() => payments.reduce((s, p) => s + (p.receivedAmount || 0), 0), [payments]);
  const totalExpenses = useMemo(() => expenses.reduce((s, e) => s + (e.expenseAmount || 0), 0), [expenses]);
  const totalBalance = totalReceived - totalExpenses;

  const projectStats = useMemo(() => {
    const selectedMonths = filterFY === 'all'
      ? null
      : filterMonth
        ? [filterMonth]
        : getFYMonths(parseInt(filterFY.split('-')[0]));
    return enabledProjects.map(proj => {
      const cumulativeExpenses = expenses
        .filter(e => e.projectId === proj.id && (
          selectedMonths === null || selectedMonths.includes(e.expenseDate?.slice(0, 7) ?? '')
        ))
        .reduce((sum, expense) => sum + (expense.expenseAmount || 0), 0);
      // Same cascade as the project cards and the Site Fund Budget page, so "Total Planned Budget"
      // means one thing across the module.
      const plannedBudget = budgetForProject(proj.id).amount;
      const balanceFund = plannedBudget - cumulativeExpenses;
      return {
        id: proj.id,
        name: proj.projectName,
        plannedBudget,
        cumulativeExpenses,
        cumulativeUsedPct: plannedBudget > 0 ? (cumulativeExpenses / plannedBudget) * 100 : 0,
        balanceFund,
        balanceFundPct: plannedBudget > 0 ? (balanceFund / plannedBudget) * 100 : 0,
      };
    }).sort((a, b) => a.name.localeCompare(b.name));
  }, [enabledProjects, expenses, budgetForProject, filterFY, filterMonth]);

  const filteredProjectStats = useMemo(() => projectStats.filter(stat => {
    if (filterSearch && !stat.name.toLowerCase().includes(filterSearch.toLowerCase())) return false;
    if (filterBudgetStatus === 'over' && !(stat.plannedBudget > 0 && stat.cumulativeExpenses > stat.plannedBudget)) return false;
    if (filterBudgetStatus === 'ok' && !(stat.plannedBudget > 0 && stat.cumulativeExpenses <= stat.plannedBudget)) return false;
    if (filterBudgetStatus === 'none' && stat.plannedBudget > 0) return false;
    return true;
  }), [projectStats, filterSearch, filterBudgetStatus]);

  // FY budget total for stat card
  const totalFYBudget = useMemo(() => projectStats.reduce((s, p) => s + p.plannedBudget, 0), [projectStats]);

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

      {/* The dashboard totals every record it holds, so it has to say when it could not hold
          them all rather than present a partial sum as the whole picture. */}
      {ledgerTruncated && (
        <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="text-xs text-amber-800">
            This organisation has more transactions than the dashboard loads at once, so the totals
            below are based on the most recent records only. Use the reports for exact figures.
          </p>
        </div>
      )}

      {/* ── My Projects (assigned person view) ── */}
      {myProjects.length > 0 && (
        <section>
          <div className="mb-3 flex items-center gap-2">
            <Wallet className="h-4 w-4 text-emerald-600" />
            <h2 className="text-base font-bold text-slate-800">My Projects</h2>
            <Badge className="bg-emerald-100 text-emerald-700 text-xs">{myProjects.length}</Badge>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {myProjects.map(proj => {
              const projectBudget = budgetForProject(proj.id);
              return (
                <MyProjectCard
                  key={proj.id}
                  project={proj}
                  payments={payments}
                  expenses={expenses}
                  categories={categories}
                  currentUserName={user?.name ?? ''}
                  totalBudgetAmount={projectBudget.amount || undefined}
                  budgetSource={projectBudget.source}
                  canRecordExpense={canRecordExpenseOn(proj)}
                  onRefresh={loadAll}
                />
              );
            })}
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
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 mb-4">
            <StatCard icon={Building2} label="Enabled Projects" value={String(enabledProjects.length)} colorClass="text-emerald-600" />
            <StatCard icon={TrendingUp} label="Total Received from HO" value={formatINR(totalReceived)} colorClass="text-blue-600" />
            <StatCard icon={TrendingDown} label="Total Site Expenses" value={formatINR(totalExpenses)} colorClass="text-rose-600" />
            <StatCard
              icon={Wallet}
              label="Total Balance"
              value={formatINR(totalBalance)}
              colorClass={totalBalance >= 0 ? 'text-teal-600' : 'text-destructive'}
            />
            <StatCard
              icon={Target}
              label={filterFY === 'all' ? 'All Time Planned Budget' : filterMonth ? `Budget (${monthLabel(filterMonth)})` : `FY ${filterFY} Budget`}
              value={totalFYBudget > 0 ? formatINR(totalFYBudget) : '—'}
              colorClass="text-indigo-600"
            />
          </div>

          {/* Project-wise summary table */}
          <Card className="bg-white/80 backdrop-blur-sm">
            <CardHeader className="pb-2 flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <CardTitle className="text-sm">Project-Wise Summary</CardTitle>
                <span className="text-xs text-muted-foreground">{filteredProjectStats.length} of {projectStats.length} project{projectStats.length !== 1 ? 's' : ''}</span>
              </div>
              {/* Filter bar */}
              <div className="flex flex-wrap gap-2">
                <div className="relative flex-1 min-w-[150px]">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                  <Input
                    className="pl-8 h-8 text-xs"
                    placeholder="Search projects…"
                    value={filterSearch}
                    onChange={e => setFilterSearch(e.target.value)}
                  />
                </div>
                <Select value={filterFY} onValueChange={setFilterFY}>
                  <SelectTrigger className="h-8 text-xs w-[110px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Time</SelectItem>
                    {availableFYs.map(fy => (
                      <SelectItem key={fy} value={fy}>FY {fy}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={filterMonth || '_all_'}
                  onValueChange={v => setFilterMonth(v === '_all_' ? '' : v)}
                  disabled={filterFY === 'all'}
                >
                  <SelectTrigger className="h-8 text-xs w-[110px]">
                    <SelectValue placeholder="All Months" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_all_">All Months</SelectItem>
                    {(filterFY === 'all' ? [] : getFYMonths(parseInt(filterFY.split('-')[0]))).map(m => (
                      <SelectItem key={m} value={m}>
                        {monthLabel(m)}{m === currentMonthStr() ? ' ·' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={filterBudgetStatus} onValueChange={setFilterBudgetStatus}>
                  <SelectTrigger className="h-8 text-xs w-[130px]">
                    <Filter className="h-3 w-3 mr-1" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="over">Over Budget</SelectItem>
                    <SelectItem value="ok">Within Budget</SelectItem>
                    <SelectItem value="none">No Budget</SelectItem>
                  </SelectContent>
                </Select>
                {(filterSearch || filterBudgetStatus !== 'all') && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 px-2 text-xs"
                    onClick={() => { setFilterSearch(''); setFilterBudgetStatus('all'); }}
                  >
                    <X className="h-3.5 w-3.5 mr-1" /> Clear filters
                  </Button>
                )}
              </div>
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
                        <th className="px-4 py-2 text-right font-medium">Total Planned Budget</th>
                        <th className="px-4 py-2 text-right font-medium">Cumulative Project Expense</th>
                        <th className="px-4 py-2 text-right font-medium">Cumulative Project Used %</th>
                        <th className="px-4 py-2 text-right font-medium">Balance Fund</th>
                        <th className="px-4 py-2 text-right font-medium">Balance Fund %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredProjectStats.map(stat => (
                        <tr key={stat.id} className="border-b hover:bg-muted/20 transition-colors">
                          <td className="px-4 py-2 font-medium">{stat.name}</td>
                          <td className="px-4 py-2 text-right">{formatINR(stat.plannedBudget)}</td>
                          <td className="px-4 py-2 text-right">{formatINR(stat.cumulativeExpenses)}</td>
                          <td className="px-4 py-2 text-right">{stat.plannedBudget > 0 ? `${stat.cumulativeUsedPct.toFixed(2)}%` : '—'}</td>
                          <td className="px-4 py-2 text-right">{formatINR(stat.balanceFund)}</td>
                          <td className="px-4 py-2 text-right">{stat.plannedBudget > 0 ? `${stat.balanceFundPct.toFixed(2)}%` : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
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
