
'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, TrendingUp, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useAuthorization } from '@/hooks/useAuthorization';
import { db } from '@/lib/firebase';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import type { Loan, EMI } from '@/lib/types';
import { format } from 'date-fns';

const fmt = (n: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n || 0);

const statusStyle: Record<EMI['status'], string> = {
  Paid: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Pending: 'bg-slate-50 text-slate-600 border-slate-200',
  Overdue: 'bg-rose-50 text-rose-700 border-rose-200',
};

export default function AmortizationReportPage() {
  const { can, isLoading: authLoading } = useAuthorization();
  const { toast } = useToast();

  const [loans, setLoans] = useState<Loan[]>([]);
  const [emis, setEmis] = useState<EMI[]>([]);
  const [selectedLoanId, setSelectedLoanId] = useState<string>('all');
  const [loadingLoans, setLoadingLoans] = useState(true);
  const [loadingEmis, setLoadingEmis] = useState(false);

  // All-loans EMI data for aggregate view
  const [allEmisMap, setAllEmisMap] = useState<Record<string, EMI[]>>({});
  const [allEmisLoaded, setAllEmisLoaded] = useState(false);

  // ── Fetch all loans once ──────────────────────────────────────────────────
  useEffect(() => {
    const fetchLoans = async () => {
      setLoadingLoans(true);
      try {
        const snap = await getDocs(collection(db, 'loans'));
        setLoans(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Loan)));
      } catch {
        toast({ title: 'Error', description: 'Failed to fetch loans.', variant: 'destructive' });
      } finally {
        setLoadingLoans(false);
      }
    };
    fetchLoans();
  }, [toast]);

  // ── Fetch EMIs for selected loan ──────────────────────────────────────────
  useEffect(() => {
    if (selectedLoanId === 'all') {
      setEmis([]);
      return;
    }
    const fetchEmis = async () => {
      setLoadingEmis(true);
      try {
        const q = query(
          collection(db, 'loans', selectedLoanId, 'emis'),
          orderBy('emiNo', 'asc'),
        );
        const snap = await getDocs(q);
        setEmis(snap.docs.map((d) => ({ id: d.id, ...d.data() } as EMI)));
      } catch {
        toast({ title: 'Error', description: 'Failed to fetch EMI schedule.', variant: 'destructive' });
      } finally {
        setLoadingEmis(false);
      }
    };
    fetchEmis();
  }, [selectedLoanId, toast]);

  // ── Fetch ALL emis for aggregate view ────────────────────────────────────
  useEffect(() => {
    if (selectedLoanId !== 'all' || allEmisLoaded || loans.length === 0) return;
    const fetchAll = async () => {
      setLoadingEmis(true);
      try {
        const results: Record<string, EMI[]> = {};
        await Promise.all(
          loans.map(async (loan) => {
            const q = query(
              collection(db, 'loans', loan.id, 'emis'),
              orderBy('emiNo', 'asc'),
            );
            const snap = await getDocs(q);
            results[loan.id] = snap.docs.map((d) => ({ id: d.id, ...d.data() } as EMI));
          }),
        );
        setAllEmisMap(results);
        setAllEmisLoaded(true);
      } catch {
        toast({ title: 'Error', description: 'Failed to fetch EMI data.', variant: 'destructive' });
      } finally {
        setLoadingEmis(false);
      }
    };
    fetchAll();
  }, [selectedLoanId, loans, allEmisLoaded, toast]);

  // ── Stats for single-loan view ────────────────────────────────────────────
  const singleStats = useMemo(() => {
    if (selectedLoanId === 'all' || emis.length === 0)
      return { totalEmi: 0, totalPrincipal: 0, totalInterest: 0, totalPaid: 0 };
    return {
      totalEmi: emis.reduce((s, e) => s + e.emiAmount, 0),
      totalPrincipal: emis.reduce((s, e) => s + e.principal, 0),
      totalInterest: emis.reduce((s, e) => s + e.interest, 0),
      totalPaid: emis.reduce((s, e) => s + e.paidAmount, 0),
    };
  }, [emis, selectedLoanId]);

  // ── Aggregate stats for "All Loans" view ─────────────────────────────────
  const aggregateStats = useMemo(() => {
    if (selectedLoanId !== 'all') return null;
    let totalEmi = 0, totalPrincipal = 0, totalInterest = 0, totalPaid = 0;
    Object.values(allEmisMap).forEach((list) => {
      list.forEach((e) => {
        totalEmi += e.emiAmount;
        totalPrincipal += e.principal;
        totalInterest += e.interest;
        totalPaid += e.paidAmount;
      });
    });
    return { totalEmi, totalPrincipal, totalInterest, totalPaid };
  }, [allEmisMap, selectedLoanId]);

  // ── Per-loan summary rows for aggregate table ─────────────────────────────
  const loanSummaryRows = useMemo(() => {
    return loans.map((loan) => {
      const list = allEmisMap[loan.id] ?? [];
      return {
        loan,
        totalPrincipal: list.reduce((s, e) => s + e.principal, 0),
        totalInterest: list.reduce((s, e) => s + e.interest, 0),
        totalPaid: list.reduce((s, e) => s + e.paidAmount, 0),
        remaining:
          list.length > 0
            ? list[list.length - 1].closingPrincipal
            : loan.loanAmount - (loan.totalPaid ?? 0),
      };
    });
  }, [loans, allEmisMap]);

  // ── Excel export ──────────────────────────────────────────────────────────
  const handleExport = async () => {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();

    if (selectedLoanId === 'all') {
      // Summary sheet
      const ws = wb.addWorksheet('Loan Summary');
      ws.columns = [
        { header: 'Loan (Account No)', key: 'loan', width: 28 },
        { header: 'Lender', key: 'lender', width: 22 },
        { header: 'Total Principal', key: 'principal', width: 18 },
        { header: 'Total Interest', key: 'interest', width: 18 },
        { header: 'Total Paid', key: 'paid', width: 18 },
        { header: 'Remaining', key: 'remaining', width: 18 },
      ];
      ws.getRow(1).font = { bold: true };
      loanSummaryRows.forEach((r) => {
        ws.addRow({
          loan: `${r.loan.lenderName} (${r.loan.accountNo})`,
          lender: r.loan.lenderName,
          principal: r.totalPrincipal,
          interest: r.totalInterest,
          paid: r.totalPaid,
          remaining: r.remaining,
        });
      });
    } else {
      const selectedLoan = loans.find((l) => l.id === selectedLoanId);
      const ws = wb.addWorksheet('Amortization Schedule');
      ws.columns = [
        { header: 'EMI No', key: 'emiNo', width: 10 },
        { header: 'Due Date', key: 'dueDate', width: 16 },
        { header: 'EMI Amount', key: 'emiAmount', width: 16 },
        { header: 'Principal', key: 'principal', width: 16 },
        { header: 'Interest', key: 'interest', width: 16 },
        { header: 'Paid Amount', key: 'paidAmount', width: 16 },
        { header: 'Closing Principal', key: 'closingPrincipal', width: 20 },
        { header: 'Status', key: 'status', width: 14 },
      ];
      ws.getRow(1).font = { bold: true };
      emis.forEach((e) => {
        ws.addRow({
          emiNo: e.emiNo,
          dueDate: format(e.dueDate.toDate(), 'dd-MMM-yyyy'),
          emiAmount: e.emiAmount,
          principal: e.principal,
          interest: e.interest,
          paidAmount: e.paidAmount,
          closingPrincipal: e.closingPrincipal,
          status: e.status,
        });
      });

      // Summary row
      ws.addRow({});
      const summaryRow = ws.addRow({
        emiNo: 'TOTAL',
        emiAmount: singleStats.totalEmi,
        principal: singleStats.totalPrincipal,
        interest: singleStats.totalInterest,
        paidAmount: singleStats.totalPaid,
      });
      summaryRow.font = { bold: true };
      ws.getCell(`A${summaryRow.number}`).font = { bold: true };

      // Info sheet
      if (selectedLoan) {
        const info = wb.addWorksheet('Loan Info');
        [
          ['Account No', selectedLoan.accountNo],
          ['Lender', selectedLoan.lenderName],
          ['Loan Amount', fmt(selectedLoan.loanAmount)],
          ['Tenure (months)', selectedLoan.tenure],
          ['Interest Rate', `${selectedLoan.interestRate}%`],
          ['EMI Amount', fmt(selectedLoan.emiAmount)],
          ['Start Date', selectedLoan.startDate],
          ['End Date', selectedLoan.endDate],
          ['Status', selectedLoan.status],
        ].forEach(([k, v]) => info.addRow([k, v]));
        info.getColumn(1).width = 20;
        info.getColumn(2).width = 25;
      }
    }

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download =
      selectedLoanId === 'all'
        ? 'loan-amortization-all.xlsx'
        : `amortization-${selectedLoanId}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Auth guard ────────────────────────────────────────────────────────────
  if (authLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full rounded-xl" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (!can('View', 'Loan.Reports')) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Access Denied</CardTitle>
          <CardDescription>You do not have permission to view loan reports.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const stats =
    selectedLoanId === 'all'
      ? aggregateStats ?? { totalEmi: 0, totalPrincipal: 0, totalInterest: 0, totalPaid: 0 }
      : singleStats;

  const isLoading = loadingLoans || loadingEmis;

  return (
    <div className="space-y-4">
      {/* ── Header card ─────────────────────────────────────────────────── */}
      <Card className="overflow-hidden border-border/60">
        <div className="h-1 w-full bg-gradient-to-r from-blue-500 via-indigo-500 to-violet-500" />
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Link href="/loan/reports">
              <Button variant="ghost" size="sm" className="gap-1.5 text-xs">
                <ArrowLeft className="h-3.5 w-3.5" /> Back
              </Button>
            </Link>
            <div className="flex items-center gap-2">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 ring-1 ring-blue-100">
                <TrendingUp className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <CardTitle className="text-base tracking-tight">Loan Amortization Schedule</CardTitle>
                <CardDescription>
                  Full EMI-by-EMI breakdown of principal vs interest
                </CardDescription>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Loan selector */}
            {loadingLoans ? (
              <Skeleton className="h-9 w-52" />
            ) : (
              <Select value={selectedLoanId} onValueChange={setSelectedLoanId}>
                <SelectTrigger className="h-9 w-52 text-sm">
                  <SelectValue placeholder="Select a loan…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Loans (Aggregate)</SelectItem>
                  {loans.map((loan) => (
                    <SelectItem key={loan.id} value={loan.id}>
                      {loan.lenderName} — {loan.accountNo}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-1.5 text-xs"
              onClick={handleExport}
              disabled={isLoading || (selectedLoanId !== 'all' && emis.length === 0)}
            >
              <Download className="h-3.5 w-3.5" /> Export
            </Button>
          </div>
        </CardHeader>
      </Card>

      {/* ── Stat cards ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Total EMI Amount', value: stats.totalEmi, color: 'text-slate-700' },
          { label: 'Total Principal', value: stats.totalPrincipal, color: 'text-blue-600' },
          { label: 'Total Interest', value: stats.totalInterest, color: 'text-indigo-600' },
          { label: 'Total Paid', value: stats.totalPaid, color: 'text-emerald-600' },
        ].map((s) => (
          <Card key={s.label} className="border-border/60">
            <CardContent className="pt-4 pb-4">
              {isLoading ? (
                <Skeleton className="h-12 w-full" />
              ) : (
                <div className="flex flex-col">
                  <span className={`text-lg font-bold leading-tight ${s.color}`}>
                    {fmt(s.value)}
                  </span>
                  <span className="text-[11px] text-muted-foreground mt-0.5">{s.label}</span>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── Content ─────────────────────────────────────────────────────── */}
      {selectedLoanId === 'all' ? (
        /* Aggregate: loan-by-loan summary table */
        <Card className="overflow-hidden border-border/60">
          <CardHeader className="py-3 px-4 border-b">
            <CardTitle className="text-sm font-semibold">Loan-by-Loan Summary</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="space-y-2 p-4">
                {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            ) : loans.length === 0 ? (
              <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                No loans found.
              </div>
            ) : (
              <div className="overflow-auto h-[calc(100vh-420px)]">
                <table className="w-full caption-bottom text-sm [&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-slate-50">
                  <thead>
                    <tr className="border-b">
                      <th className="py-2 px-4 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap">Loan</th>
                      <th className="py-2 px-4 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap">Lender</th>
                      <th className="py-2 px-4 text-right text-xs font-semibold text-muted-foreground whitespace-nowrap">Total Principal</th>
                      <th className="py-2 px-4 text-right text-xs font-semibold text-muted-foreground whitespace-nowrap">Total Interest</th>
                      <th className="py-2 px-4 text-right text-xs font-semibold text-muted-foreground whitespace-nowrap">Paid</th>
                      <th className="py-2 px-4 text-right text-xs font-semibold text-muted-foreground whitespace-nowrap">Remaining</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loanSummaryRows.map((r) => (
                      <tr key={r.loan.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                        <td className="py-2.5 px-4 font-medium text-xs">{r.loan.accountNo}</td>
                        <td className="py-2.5 px-4 text-xs text-muted-foreground">{r.loan.lenderName}</td>
                        <td className="py-2.5 px-4 text-xs text-right text-blue-700">{fmt(r.totalPrincipal)}</td>
                        <td className="py-2.5 px-4 text-xs text-right text-indigo-700">{fmt(r.totalInterest)}</td>
                        <td className="py-2.5 px-4 text-xs text-right text-emerald-700">{fmt(r.totalPaid)}</td>
                        <td className="py-2.5 px-4 text-xs text-right text-slate-700">{fmt(r.remaining)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        /* Single loan: full EMI schedule table */
        <Card className="overflow-hidden border-border/60">
          <CardHeader className="py-3 px-4 border-b">
            <CardTitle className="text-sm font-semibold">EMI Schedule</CardTitle>
            {loans.find((l) => l.id === selectedLoanId) && (
              <CardDescription className="text-xs">
                {loans.find((l) => l.id === selectedLoanId)?.lenderName} —{' '}
                {loans.find((l) => l.id === selectedLoanId)?.accountNo}
              </CardDescription>
            )}
          </CardHeader>
          <CardContent className="p-0">
            {loadingEmis ? (
              <div className="space-y-2 p-4">
                {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            ) : emis.length === 0 ? (
              <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                {selectedLoanId === 'all'
                  ? 'Select a loan to view its EMI schedule.'
                  : 'No EMI schedule found for this loan.'}
              </div>
            ) : (
              <div className="overflow-auto h-[calc(100vh-380px)]">
                <table className="w-full caption-bottom text-sm [&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-slate-50">
                  <thead>
                    <tr className="border-b">
                      {[
                        { label: 'EMI No', align: 'text-center' },
                        { label: 'Due Date', align: 'text-left' },
                        { label: 'EMI Amount', align: 'text-right' },
                        { label: 'Principal', align: 'text-right' },
                        { label: 'Interest', align: 'text-right' },
                        { label: 'Paid Amount', align: 'text-right' },
                        { label: 'Closing Principal', align: 'text-right' },
                        { label: 'Status', align: 'text-center' },
                      ].map((h) => (
                        <th
                          key={h.label}
                          className={`py-2 px-3 ${h.align} text-xs font-semibold text-muted-foreground whitespace-nowrap border-b`}
                        >
                          {h.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {emis.map((emi) => (
                      <tr
                        key={emi.id}
                        className="border-b last:border-0 hover:bg-muted/30 transition-colors"
                      >
                        <td className="py-2.5 px-3 text-center text-xs font-medium text-slate-700">
                          {emi.emiNo}
                        </td>
                        <td className="py-2.5 px-3 text-xs text-muted-foreground whitespace-nowrap">
                          {format(emi.dueDate.toDate(), 'dd MMM yyyy')}
                        </td>
                        <td className="py-2.5 px-3 text-right text-xs">{fmt(emi.emiAmount)}</td>
                        <td className="py-2.5 px-3 text-right text-xs text-blue-700">
                          {fmt(emi.principal)}
                        </td>
                        <td className="py-2.5 px-3 text-right text-xs text-indigo-700">
                          {fmt(emi.interest)}
                        </td>
                        <td className="py-2.5 px-3 text-right text-xs text-emerald-700">
                          {fmt(emi.paidAmount)}
                        </td>
                        <td className="py-2.5 px-3 text-right text-xs text-slate-600">
                          {fmt(emi.closingPrincipal)}
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <span
                            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${statusStyle[emi.status]}`}
                          >
                            {emi.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
