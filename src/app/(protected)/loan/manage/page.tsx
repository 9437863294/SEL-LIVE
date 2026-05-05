
'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  Briefcase,
  CheckCircle2,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  TrendingDown,
  X,
  XCircle,
} from 'lucide-react';
import { format } from 'date-fns';
import { collection, doc, getDocs, orderBy, query, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import type { EMI, Loan } from '@/lib/types';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

// ─── helpers ─────────────────────────────────────────────────────────────────

const fmtCur = (n: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n || 0);

const fmtDate = (d: string) => { try { return format(new Date(d), 'dd MMM yyyy'); } catch { return d || '—'; } };

const STATUS_CFG: Record<string, { cls: string; dot: string }> = {
  Active:                { cls: 'bg-emerald-100 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
  Closed:                { cls: 'bg-slate-100 text-slate-600 border-slate-200',       dot: 'bg-slate-400' },
  'Pre-closure Pending': { cls: 'bg-amber-100 text-amber-700 border-amber-200',       dot: 'bg-amber-400' },
};

interface LoanWithDetails extends Loan {
  totalInterest: number;
  totalAmountToBePaid: number;
  areAllEmisPaid: boolean;
  outstandingPrincipal: number;
  paidCount: number;
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function ManageLoanPage() {
  const { toast } = useToast();
  const router = useRouter();

  const [loans, setLoans] = useState<LoanWithDetails[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');

  const [preClosureOpen, setPreClosureOpen] = useState(false);
  const [loanToClose, setLoanToClose] = useState<LoanWithDetails | null>(null);
  const [finalInterest, setFinalInterest] = useState(0);
  const [otherCharges, setOtherCharges] = useState(0);
  const [isClosing, setIsClosing] = useState(false);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const snap = await getDocs(query(collection(db, 'loans'), orderBy('createdAt', 'desc')));
      const loansData = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Loan));

      const enhanced = await Promise.all(loansData.map(async (loan) => {
        const emisSnap = await getDocs(collection(db, 'loans', loan.id, 'emis'));
        const emis = emisSnap.docs.map((d) => d.data() as EMI);
        const totalInterest = emis.reduce((s, e) => s + (e.interest || 0), 0);
        const paidEmis = emis.filter((e) => e.status === 'Paid');
        const paidPrincipal = paidEmis.reduce((s, e) => s + (e.principal || 0), 0);
        return {
          ...loan,
          totalInterest,
          totalAmountToBePaid: loan.loanAmount + totalInterest,
          areAllEmisPaid: emis.length > 0 && emis.every((e) => e.status === 'Paid'),
          outstandingPrincipal: loan.loanAmount - paidPrincipal,
          paidCount: paidEmis.length,
        };
      }));
      setLoans(enhanced);
    } catch {
      toast({ title: 'Error', description: 'Failed to fetch loan data.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []); // eslint-disable-line

  const handleSimpleClose = async () => {
    if (!loanToClose) return;
    try {
      await updateDoc(doc(db, 'loans', loanToClose.id), { status: 'Closed', endDate: format(new Date(), 'yyyy-MM-dd') });
      toast({ title: 'Loan Closed', description: `${loanToClose.accountNo} has been closed.` });
      fetchData();
    } catch {
      toast({ title: 'Error', description: 'Failed to close the loan.', variant: 'destructive' });
    }
  };

  const handlePreClosure = async () => {
    if (!loanToClose) return;
    setIsClosing(true);
    try {
      await updateDoc(doc(db, 'loans', loanToClose.id), {
        status: 'Pre-closure Pending',
        finalInterestOnClosure: finalInterest,
        otherChargesOnClosure: otherCharges,
      });
      toast({ title: 'Saved', description: 'Pre-closure details saved. Pending expense creation.' });
      fetchData();
      setPreClosureOpen(false);
    } catch {
      toast({ title: 'Error', description: 'Failed to save pre-closure details.', variant: 'destructive' });
    } finally {
      setIsClosing(false);
    }
  };

  const filtered = useMemo(() => {
    if (!search.trim()) return loans;
    const q = search.toLowerCase();
    return loans.filter(
      (l) =>
        l.lenderName.toLowerCase().includes(q) ||
        l.accountNo.toLowerCase().includes(q) ||
        (l.linkedBank ?? '').toLowerCase().includes(q)
    );
  }, [loans, search]);

  const totals = useMemo(() => ({
    active:   loans.filter((l) => l.status === 'Active').length,
    closed:   loans.filter((l) => l.status === 'Closed').length,
    pending:  loans.filter((l) => l.status === 'Pre-closure Pending').length,
  }), [loans]);

  // ─── loading ──────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-28 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card className="overflow-hidden border-border/60">
        <div className="h-1 w-full bg-gradient-to-r from-blue-500 via-indigo-500 to-violet-500" />
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 ring-1 ring-blue-100">
              <Briefcase className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <CardTitle className="tracking-tight">Manage Loans</CardTitle>
              <CardDescription>Add, view, and close loan facilities</CardDescription>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={fetchData} className="gap-1.5">
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
            <Link href="/loan/new">
              <Button size="sm" className="gap-1.5 bg-blue-600 hover:bg-blue-700 text-white">
                <Plus className="h-3.5 w-3.5" /> Add Loan
              </Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-3 gap-2 border-t pt-4">
          {[
            { label: 'Active',           value: totals.active,  color: 'text-emerald-600' },
            { label: 'Closed',           value: totals.closed,  color: 'text-slate-500' },
            { label: 'Pre-closure',      value: totals.pending, color: 'text-amber-600' },
          ].map((s) => (
            <div key={s.label} className="flex flex-col items-center rounded-lg py-2">
              <span className={cn('text-2xl font-bold', s.color)}>{s.value}</span>
              <span className="text-[11px] text-muted-foreground">{s.label}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Search */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search lender, account no…" className="pl-8 h-9 text-sm" />
          {search && <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>}
        </div>
        <span className="text-xs text-muted-foreground">{filtered.length} loans</span>
      </div>

      {/* Mobile cards */}
      <div className="space-y-2 sm:hidden">
        {filtered.map((loan) => {
          const cfg = STATUS_CFG[loan.status] ?? { cls: '', dot: 'bg-slate-400' };
          const pctPaid = loan.tenure > 0 ? Math.round((loan.paidCount / loan.tenure) * 100) : 0;
          return (
            <Card key={loan.id} className="border-border/60 cursor-pointer" onClick={() => router.push(`/loan/${loan.id}`)}>
              <CardContent className="p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-sm">{loan.lenderName}</p>
                    <p className="text-xs text-muted-foreground font-mono">{loan.accountNo}</p>
                  </div>
                  <Badge variant="outline" className={cn('text-[10px] shrink-0', cfg.cls)}>{loan.status}</Badge>
                </div>
                <div className="grid grid-cols-2 gap-1 text-xs">
                  <div><span className="text-muted-foreground">Principal: </span>{fmtCur(loan.loanAmount)}</div>
                  <div><span className="text-muted-foreground">EMI: </span>{fmtCur(loan.emiAmount)}</div>
                  <div><span className="text-muted-foreground">Paid: </span>{fmtCur(loan.totalPaid || 0)}</div>
                  <div><span className="text-muted-foreground">Outstanding: </span>{fmtCur(loan.outstandingPrincipal)}</div>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-teal-500" style={{ width: `${pctPaid}%` }} />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Desktop table */}
      <Card className="hidden sm:block overflow-hidden border-border/60">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="w-6" />
                <TableHead>Lender</TableHead>
                <TableHead>A/C No</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Principal</TableHead>
                <TableHead className="text-right">Interest</TableHead>
                <TableHead className="text-right">EMI/mo</TableHead>
                <TableHead className="text-center">Tenure</TableHead>
                <TableHead>Start</TableHead>
                <TableHead>End</TableHead>
                <TableHead>Bank</TableHead>
                <TableHead className="text-right">Total Payable</TableHead>
                <TableHead className="text-right">Paid</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={15} className="h-32 text-center text-muted-foreground">No loans found.</TableCell>
                </TableRow>
              ) : filtered.map((loan) => {
                const cfg = STATUS_CFG[loan.status] ?? { cls: '', dot: 'bg-slate-400' };
                return (
                  <TableRow
                    key={loan.id}
                    className="cursor-pointer transition-colors hover:bg-muted/20"
                    onClick={() => router.push(`/loan/${loan.id}`)}
                  >
                    <TableCell className="pr-0"><div className={cn('h-2 w-2 rounded-full mx-auto', cfg.dot)} /></TableCell>
                    <TableCell className="font-medium">{loan.lenderName}</TableCell>
                    <TableCell className="font-mono text-xs">{loan.accountNo}</TableCell>
                    <TableCell><Badge variant="outline" className="text-[10px]">{loan.loanType || 'Loan'}</Badge></TableCell>
                    <TableCell className="text-right">{fmtCur(loan.loanAmount)}</TableCell>
                    <TableCell className="text-right">{fmtCur(loan.totalInterest)}</TableCell>
                    <TableCell className="text-right">{fmtCur(loan.emiAmount)}</TableCell>
                    <TableCell className="text-center">{loan.tenure}m</TableCell>
                    <TableCell className="text-sm">{fmtDate(loan.startDate)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{fmtDate(loan.endDate)}</TableCell>
                    <TableCell className="text-sm">{loan.linkedBank}</TableCell>
                    <TableCell className="text-right">{fmtCur(loan.totalAmountToBePaid)}</TableCell>
                    <TableCell className="text-right text-emerald-600 font-medium">{fmtCur(loan.totalPaid || 0)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cn('text-[10px]', cfg.cls)}>{loan.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      {loan.status === 'Active' && (
                        loan.areAllEmisPaid ? (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs text-rose-600 hover:bg-rose-50" onClick={(e) => { e.stopPropagation(); setLoanToClose(loan); }}>
                                <CheckCircle2 className="h-3 w-3" /> Close
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent className="max-w-sm">
                              <AlertDialogHeader>
                                <AlertDialogTitle>Close Loan?</AlertDialogTitle>
                                <AlertDialogDescription>All EMIs are paid. This will mark <strong>{loan.accountNo}</strong> as Closed.</AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={handleSimpleClose} className="bg-emerald-600 hover:bg-emerald-700 text-white">Confirm Closure</AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        ) : (
                          <Button
                            variant="ghost" size="sm"
                            className="h-7 gap-1 text-xs text-amber-600 hover:bg-amber-50"
                            onClick={(e) => { e.stopPropagation(); setLoanToClose(loan); setFinalInterest(0); setOtherCharges(0); setPreClosureOpen(true); }}
                          >
                            <XCircle className="h-3 w-3" /> Pre-close
                          </Button>
                        )
                      )}
                      {loan.status === 'Pre-closure Pending' && (
                        <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200">Pending</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </Card>

      {/* Pre-closure dialog */}
      {loanToClose && (
        <Dialog open={preClosureOpen} onOpenChange={setPreClosureOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Pre-closure — {loanToClose.accountNo}</DialogTitle>
              <DialogDescription>Enter final amounts to initiate pre-closure of this loan.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 space-y-1">
                <p className="text-xs text-muted-foreground">Outstanding Principal</p>
                <p className="text-xl font-bold">{fmtCur(loanToClose.outstandingPrincipal)}</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Final Interest Amount</Label>
                <Input type="number" min="0" value={finalInterest} onChange={(e) => setFinalInterest(Number(e.target.value))} className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Pre-closure / Other Charges</Label>
                <Input type="number" min="0" value={otherCharges} onChange={(e) => setOtherCharges(Number(e.target.value))} className="h-9" />
              </div>
              <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 flex items-center justify-between">
                <p className="text-sm font-medium text-amber-800">Total Payable</p>
                <p className="text-lg font-bold text-amber-700">{fmtCur(loanToClose.outstandingPrincipal + finalInterest + otherCharges)}</p>
              </div>
              <div className="flex items-start gap-2 rounded-lg border border-blue-100 bg-blue-50 p-3 text-xs text-blue-700">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                Upload the final statement and NOC from the lender after making the payment.
              </div>
            </div>
            <DialogFooter>
              <DialogClose asChild><Button variant="outline" size="sm">Cancel</Button></DialogClose>
              <Button size="sm" onClick={handlePreClosure} disabled={isClosing} className="bg-amber-600 hover:bg-amber-700 text-white">
                {isClosing && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                Save Pre-closure Details
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
