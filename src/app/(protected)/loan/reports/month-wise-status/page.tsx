
'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, CalendarCheck, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableRow,
} from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs } from 'firebase/firestore';
import type { Loan, EMI } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { getYear } from 'date-fns';

interface EmiWithLoan extends EMI {
  loan: Loan;
}

interface MonthlySummary {
  totalDue: number;
  alreadyPaid: number;
  toBePaid: number;
}

export default function MonthWiseStatusReportPage() {
  const { toast } = useToast();
  const [allEmis, setAllEmis] = useState<EmiWithLoan[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const getFinancialYear = (date: Date) => {
    return date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;
  };
  
  const currentFinancialYear = getFinancialYear(new Date());

  const [selectedYear, setSelectedYear] = useState(currentFinancialYear.toString());

  useEffect(() => {
    const fetchAllData = async () => {
      setIsLoading(true);
      try {
        const loansSnapshot = await getDocs(collection(db, 'loans'));
        const loans = loansSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Loan));
        
        const emisPromises = loans.map(async (loan) => {
          const emisSnapshot = await getDocs(collection(db, 'loans', loan.id, 'emis'));
          return emisSnapshot.docs.map(doc => ({ ...(doc.data() as EMI), id: doc.id, loan }));
        });

        const allEmisNested = await Promise.all(emisPromises);
        setAllEmis(allEmisNested.flat());
      } catch (error) {
        console.error("Error fetching data:", error);
        toast({ title: "Error", description: "Failed to fetch loan or EMI data.", variant: "destructive" });
      }
      setIsLoading(false);
    };
    fetchAllData();
  }, [toast]);
  
  const financialYearMonths = [
    'April', 'May', 'June', 'July', 'August', 'September', 
    'October', 'November', 'December', 'January', 'February', 'March'
  ];

  const yearOptions = useMemo(() => {
    if (allEmis.length === 0) return [currentFinancialYear.toString()];
    const firstYear = allEmis.reduce((earliest, emi) => {
        const year = getFinancialYear(emi.dueDate.toDate());
        return year < earliest ? year : earliest;
    }, currentFinancialYear);
    const lastYear = allEmis.reduce((latest, emi) => {
        const year = getFinancialYear(emi.dueDate.toDate());
        return year > latest ? year : latest;
    }, currentFinancialYear);
    
    const years = [];
    for (let y = lastYear; y >= firstYear; y--) {
        years.push(y.toString());
    }
    return years;
  }, [allEmis, currentFinancialYear]);


  const yearlySummary = useMemo(() => {
    const summary: Record<string, MonthlySummary> = {};

    financialYearMonths.forEach(month => {
        summary[month] = { totalDue: 0, alreadyPaid: 0, toBePaid: 0 };
    });

    allEmis.forEach(emi => {
        const emiDate = emi.dueDate.toDate();
        const emiFinancialYear = getFinancialYear(emiDate);

        if (emiFinancialYear.toString() === selectedYear) {
            const monthName = financialYearMonths[emiDate.getMonth() - (emiDate.getMonth() >=3 ? 3 : -9)]; // Adjust index for financial year start in April
            
            if (summary[monthName]) {
                summary[monthName].totalDue += emi.emiAmount;
                if(emi.status === 'Paid') {
                    summary[monthName].alreadyPaid += emi.paidAmount;
                }
            }
        }
    });
    
    financialYearMonths.forEach(month => {
        summary[month].toBePaid = summary[month].totalDue - summary[month].alreadyPaid;
    });

    return summary;
  }, [allEmis, selectedYear, financialYearMonths]);

  const formatCurrency = (amount: number) => {
    if (amount === 0) return '-';
    return new Intl.NumberFormat('en-IN', { 
        style: 'currency', 
        currency: 'INR',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(amount);
  };
  
  const yearlyTotals = useMemo(() => {
    const vals = Object.values(yearlySummary);
    return {
      totalDue: vals.reduce((s, v) => s + v.totalDue, 0),
      alreadyPaid: vals.reduce((s, v) => s + v.alreadyPaid, 0),
      toBePaid: vals.reduce((s, v) => s + v.toBePaid, 0),
    };
  }, [yearlySummary]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card className="overflow-hidden border-border/60">
        <div className="h-1 w-full bg-gradient-to-r from-violet-500 via-indigo-500 to-blue-500" />
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Link href="/loan/reports">
              <Button variant="ghost" size="sm" className="gap-1.5 text-xs">
                <ArrowLeft className="h-3.5 w-3.5" /> Back
              </Button>
            </Link>
            <div className="flex items-center gap-2">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-50 ring-1 ring-violet-100">
                <CalendarCheck className="h-5 w-5 text-violet-600" />
              </div>
              <div>
                <CardTitle className="tracking-tight text-base">Month-wise EMI Status</CardTitle>
                <CardDescription>Financial year EMI breakdown — {selectedYear}–{(parseInt(selectedYear) + 1).toString().slice(-2)}</CardDescription>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Select value={selectedYear} onValueChange={setSelectedYear}>
              <SelectTrigger className="h-9 w-36 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {yearOptions.map(year => (
                  <SelectItem key={year} value={year}>{`FY ${year}–${(parseInt(year) + 1).toString().slice(-2)}`}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>

        {/* FY totals strip */}
        {!isLoading && (
          <CardContent className="grid grid-cols-3 gap-2 border-t pt-4">
            {[
              { label: 'FY Total Due',   value: formatCurrency(yearlyTotals.totalDue),    color: 'text-slate-700' },
              { label: 'Already Paid',   value: formatCurrency(yearlyTotals.alreadyPaid), color: 'text-emerald-600' },
              { label: 'Yet to Pay',     value: formatCurrency(yearlyTotals.toBePaid),    color: yearlyTotals.toBePaid > 0 ? 'text-amber-600' : 'text-slate-400' },
            ].map((s) => (
              <div key={s.label} className="flex flex-col items-center rounded-lg py-2">
                <span className={`text-base font-bold leading-tight ${s.color}`}>{s.value}</span>
                <span className="text-[11px] text-muted-foreground">{s.label}</span>
              </div>
            ))}
          </CardContent>
        )}
      </Card>

      {/* Monthly grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {financialYearMonths.map((m) => <Skeleton key={m} className="h-36 rounded-xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {financialYearMonths.map((month) => {
            const data = yearlySummary[month];
            const pctPaid = data.totalDue > 0 ? Math.round((data.alreadyPaid / data.totalDue) * 100) : 0;
            const allPaid = data.toBePaid === 0 && data.totalDue > 0;
            const hasBalance = data.toBePaid > 0;

            return (
              <Card key={month} className={`overflow-hidden border-border/60 ${allPaid ? 'ring-1 ring-emerald-200' : hasBalance ? 'ring-1 ring-amber-100' : ''}`}>
                <div className={`h-1 w-full ${allPaid ? 'bg-gradient-to-r from-emerald-400 to-teal-500' : hasBalance ? 'bg-gradient-to-r from-amber-400 to-orange-400' : 'bg-slate-200'}`} />
                <div className="p-3">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-bold text-slate-700">{month}</p>
                    {allPaid && <span className="text-[10px] font-medium text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-full px-1.5 py-0.5">Paid</span>}
                    {data.totalDue === 0 && <span className="text-[10px] text-muted-foreground">No EMIs</span>}
                  </div>

                  {data.totalDue > 0 && (
                    <>
                      <div className="space-y-1.5 text-xs">
                        <div className="flex justify-between text-muted-foreground">
                          <span>Total Due</span>
                          <span className="font-medium text-slate-700">{formatCurrency(data.totalDue)}</span>
                        </div>
                        <div className="flex justify-between text-muted-foreground">
                          <span>Paid</span>
                          <span className="font-medium text-emerald-600">{formatCurrency(data.alreadyPaid)}</span>
                        </div>
                        <div className="flex justify-between text-muted-foreground">
                          <span>Balance</span>
                          <span className={`font-medium ${hasBalance ? 'text-amber-600' : 'text-slate-400'}`}>{formatCurrency(data.toBePaid)}</span>
                        </div>
                      </div>

                      {/* Progress bar */}
                      <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                        <div
                          className={`h-full rounded-full transition-all ${allPaid ? 'bg-gradient-to-r from-emerald-400 to-teal-500' : 'bg-gradient-to-r from-amber-400 to-orange-400'}`}
                          style={{ width: `${pctPaid}%` }}
                        />
                      </div>
                      <p className="mt-1 text-[10px] text-right text-muted-foreground">{pctPaid}% paid</p>
                    </>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
