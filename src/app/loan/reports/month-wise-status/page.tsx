
'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
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
  
  return (
    <div className="w-full">
      <div className="mb-6 flex items-center gap-4">
        <Link href="/loan/reports">
          <Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button>
        </Link>
        <div>
            <h1 className="text-2xl font-bold">Month-wise EMI Status Report</h1>
            <CardDescription>Review the status of all EMIs for a selected financial year.</CardDescription>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-4">
            <Select value={selectedYear} onValueChange={setSelectedYear}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                {yearOptions.map(year => <SelectItem key={year} value={year}>{`${year}-${(parseInt(year) + 1).toString().slice(-2)}`}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
            {isLoading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-px bg-border border">
                     {financialYearMonths.map(month => (
                        <div key={month} className="bg-background"><Skeleton className="h-32"/></div>
                     ))}
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-px bg-border border">
                    {financialYearMonths.map(month => {
                        const data = yearlySummary[month];
                        return (
                            <div key={month} className="bg-background">
                                <h3 className="p-2 text-center font-bold bg-yellow-200 text-yellow-900 border-b">{month.toUpperCase()}</h3>
                                <Table>
                                    <TableBody>
                                        <TableRow>
                                            <TableCell className="font-medium">TOTAL DUE</TableCell>
                                            <TableCell className="text-right">{formatCurrency(data.totalDue)}</TableCell>
                                        </TableRow>
                                        <TableRow>
                                            <TableCell className="font-medium">ALREADY PAID</TableCell>
                                            <TableCell className="text-right">{formatCurrency(data.alreadyPaid)}</TableCell>
                                        </TableRow>
                                        <TableRow>
                                            <TableCell className="font-medium">TO BE PAID</TableCell>
                                            <TableCell className="text-right">{formatCurrency(data.toBePaid)}</TableCell>
                                        </TableRow>
                                    </TableBody>
                                </Table>
                            </div>
                        )
                    })}
                </div>
            )}
        </CardContent>
      </Card>
    </div>
  );
}
