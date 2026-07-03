'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  addDoc, collection, getDocs, orderBy, query, serverTimestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  formatINR, PAYMENT_MODES, SAS_COLLECTIONS,
  type SASCategory, type SASExpense, type SASPayment, type SASProject,
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
  BookOpen, Building2, FileText, Loader2, Plus, Receipt,
  TrendingDown, TrendingUp, Wallet,
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
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-lg font-bold leading-tight truncate">{value}</p>
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
  onSuccess: () => void;
}

function QuickExpenseDialog({
  open, onOpenChange, project, categories, defaultExpensedBy, onSuccess,
}: QuickExpenseDialogProps) {
  const { toast } = useToast();
  const { log } = useActivityLogger(MODULE);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    expenseCategory: '',
    expensedBy: defaultExpensedBy,
    expenseDate: new Date().toISOString().slice(0, 10),
    expenseAmount: '',
    paymentMode: 'Cash',
    vendorPartyName: '',
    billNo: '',
    remarks: '',
  });

  function setF(key: string, value: string) { setForm(f => ({ ...f, [key]: value })); }

  async function submit() {
    if (!form.expenseCategory) { toast({ title: 'Validation', description: 'Select expense category.', variant: 'destructive' }); return; }
    if (!form.expensedBy.trim()) { toast({ title: 'Validation', description: 'Expensed By is required.', variant: 'destructive' }); return; }
    if (!form.expenseDate)       { toast({ title: 'Validation', description: 'Date is required.',        variant: 'destructive' }); return; }
    const amount = Number(form.expenseAmount);
    if (!amount || amount <= 0) { toast({ title: 'Validation', description: 'Enter a valid amount.',     variant: 'destructive' }); return; }

    setSaving(true);
    try {
      await addDoc(collection(db, SAS_COLLECTIONS.expenses), {
        projectId:       project.id,
        projectName:     project.projectName,
        expenseCategory: form.expenseCategory,
        expensedBy:      form.expensedBy.trim(),
        expenseDate:     form.expenseDate,
        expenseAmount:   amount,
        paymentMode:     form.paymentMode,
        vendorPartyName: form.vendorPartyName.trim(),
        billNo:          form.billNo.trim(),
        remarks:         form.remarks.trim(),
        createdAt:       serverTimestamp(),
        updatedAt:       serverTimestamp(),
      });
      void log('Add SAS Expense (quick)', { project: project.projectName, amount });
      toast({ title: 'Expense recorded', description: `₹${amount.toLocaleString('en-IN')} saved for ${project.projectName}.` });
      setForm(f => ({ ...f, expenseCategory: '', expenseAmount: '', vendorPartyName: '', billNo: '', remarks: '' }));
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
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Expense — {project.projectName}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 py-1">
          <div className="col-span-2 space-y-1.5">
            <Label>Category <span className="text-destructive">*</span></Label>
            <Select value={form.expenseCategory || '_none_'} onValueChange={v => setF('expenseCategory', v === '_none_' ? '' : v)}>
              <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="_none_" disabled>Select category</SelectItem>
                {categories.map(c => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Expensed By <span className="text-destructive">*</span></Label>
            <Input value={form.expensedBy} onChange={e => setF('expensedBy', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Date <span className="text-destructive">*</span></Label>
            <Input type="date" value={form.expenseDate} onChange={e => setF('expenseDate', e.target.value)} />
          </div>
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
          <div className="space-y-1.5">
            <Label>Vendor / Party</Label>
            <Input value={form.vendorPartyName} onChange={e => setF('vendorPartyName', e.target.value)} placeholder="Optional" />
          </div>
          <div className="space-y-1.5">
            <Label>Bill No.</Label>
            <Input value={form.billNo} onChange={e => setF('billNo', e.target.value)} placeholder="Optional" />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label>Remarks</Label>
            <Textarea rows={2} value={form.remarks} onChange={e => setF('remarks', e.target.value)} placeholder="Details" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={saving} className="bg-rose-600 hover:bg-rose-700">
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />} Save Expense
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
  onRefresh: () => void;
}

function MyProjectCard({ project, payments, expenses, categories, currentUserName, onRefresh }: MyProjectCardProps) {
  const [expenseDialogOpen, setExpenseDialogOpen] = useState(false);

  const projPayments = useMemo(() => payments.filter(p => p.projectId === project.id), [payments, project.id]);
  const projExpenses = useMemo(() => expenses.filter(e => e.projectId === project.id), [expenses, project.id]);

  const totalReceived = useMemo(() => projPayments.reduce((s, p) => s + (p.receivedAmount || 0), 0), [projPayments]);
  const totalExpenses = useMemo(() => projExpenses.reduce((s, e) => s + (e.expenseAmount || 0), 0), [projExpenses]);
  const balance       = totalReceived - totalExpenses;

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

  const [projects,   setProjects]   = useState<SASProject[]>([]);
  const [payments,   setPayments]   = useState<SASPayment[]>([]);
  const [expenses,   setExpenses]   = useState<SASExpense[]>([]);
  const [categories, setCategories] = useState<SASCategory[]>([]);
  const [loading,    setLoading]    = useState(true);

  useEffect(() => {
    if (isAuthLoading || !canViewDashboard) return;
    void loadAll();
  }, [isAuthLoading, canViewDashboard]);

  async function loadAll() {
    setLoading(true);
    try {
      const [pSnap, paySnap, expSnap, catSnap] = await Promise.all([
        getDocs(query(collection(db, SAS_COLLECTIONS.projects))),
        getDocs(query(collection(db, SAS_COLLECTIONS.payments), orderBy('receiptDate', 'desc'))),
        getDocs(query(collection(db, SAS_COLLECTIONS.expenses), orderBy('expenseDate', 'desc'))),
        getDocs(query(collection(db, SAS_COLLECTIONS.categories), orderBy('name'))),
      ]);
      setProjects(pSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASProject)));
      setPayments(paySnap.docs.map(d => ({ id: d.id, ...d.data() } as SASPayment)));
      setExpenses(expSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASExpense)));
      setCategories(catSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASCategory)).filter(c => c.isActive !== false));
    } finally {
      setLoading(false);
    }
  }

  // Projects assigned to the current user
  const myProjects = useMemo(
    () => projects.filter(p => p.assignedPersonId === user?.id && p.enabledForSiteAccount && p.status === 'Active'),
    [projects, user?.id]
  );

  // All enabled projects for admin overview
  const enabledProjects = useMemo(
    () => projects.filter(p => p.enabledForSiteAccount && p.status === 'Active'),
    [projects]
  );

  // Admin summary numbers
  const totalReceived = useMemo(() => payments.reduce((s, p) => s + (p.receivedAmount || 0), 0), [payments]);
  const totalExpenses = useMemo(() => expenses.reduce((s, e) => s + (e.expenseAmount || 0), 0), [expenses]);
  const totalBalance  = totalReceived - totalExpenses;

  const projectStats = useMemo(() => enabledProjects.map(proj => ({
    id: proj.id,
    name: proj.projectName,
    received: payments.filter(p => p.projectId === proj.id).reduce((s, p) => s + (p.receivedAmount || 0), 0),
    expenses: expenses.filter(e => e.projectId === proj.id).reduce((s, e) => s + (e.expenseAmount || 0), 0),
  })).map(s => ({ ...s, balance: s.received - s.expenses }))
    .sort((a, b) => b.balance - a.balance), [enabledProjects, payments, expenses]);

  const highestExpense = useMemo(() => [...projectStats].sort((a, b) => b.expenses - a.expenses)[0], [projectStats]);
  const lowBalance     = useMemo(() => projectStats.filter(p => p.balance < 10000),                  [projectStats]);

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

  if (!canViewDashboard) {
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
            <StatCard icon={Building2}    label="Enabled Projects"      value={String(enabledProjects.length)} colorClass="text-emerald-600" />
            <StatCard icon={TrendingUp}   label="Total Received from HO" value={formatINR(totalReceived)}       colorClass="text-blue-600" />
            <StatCard icon={TrendingDown} label="Total Site Expenses"    value={formatINR(totalExpenses)}       colorClass="text-rose-600" />
            <StatCard
              icon={Wallet}
              label="Total Balance"
              value={formatINR(totalBalance)}
              colorClass={totalBalance >= 0 ? 'text-teal-600' : 'text-destructive'}
            />
          </div>

          {/* Alert tiles */}
          {(highestExpense || lowBalance.length > 0) && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 mb-4">
              {highestExpense && (
                <div className="flex items-start gap-3 rounded-xl border bg-orange-50 p-4 text-orange-700">
                  <BarChart3 className="mt-0.5 h-5 w-5 shrink-0" />
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide">Highest Expense Project</p>
                    <p className="font-semibold truncate">{highestExpense.name}</p>
                    <p className="text-sm">{formatINR(highestExpense.expenses)}</p>
                  </div>
                </div>
              )}
              {lowBalance.length > 0 && (
                <div className="flex items-start gap-3 rounded-xl border bg-rose-50 p-4 text-rose-700">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide">Low Balance Projects</p>
                    <p className="font-semibold">{lowBalance.length} project{lowBalance.length > 1 ? 's' : ''} below ₹10,000</p>
                    <p className="text-sm truncate">{lowBalance.map(p => p.name).join(', ')}</p>
                  </div>
                </div>
              )}
            </div>
          )}

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
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        <th className="px-4 py-2 text-left font-medium">Project</th>
                        <th className="px-4 py-2 text-right font-medium">Received</th>
                        <th className="px-4 py-2 text-right font-medium">Expenses</th>
                        <th className="px-4 py-2 text-right font-medium">Balance</th>
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
