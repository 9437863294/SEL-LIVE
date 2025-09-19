
'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, CheckCircle, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs } from 'firebase/firestore';
import type { Loan, EMI } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { format, getYear, getMonth, eachYearOfInterval, isSameMonth, isSameYear } from 'date-fns';
import { Badge } from '@/components/ui/badge';

interface EmiWithLoan extends EMI {
  loan: Loan;
}

export default function MonthWiseStatusReportPage() {
  const { toast } = useToast();
  const [allEmis, setAllEmis] = useState<EmiWithLoan[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const currentMonth = new Date().toLocaleString('default', { month: 'long' });
  const currentYear = getYear(new Date()).toString();

  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const [selectedYear, setSelectedYear] = useState(currentYear);

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

  const yearOptions = useMemo(() => {
    if (allEmis.length === 0) return [currentYear];
    const firstEmiDate = allEmis.reduce((earliest, emi) => (emi.dueDate.toDate() < earliest ? emi.dueDate.toDate() : earliest), new Date());
    const lastEmiDate = allEmis.reduce((latest, emi) => (emi.dueDate.toDate() > latest ? emi.dueDate.toDate() : latest), new Date(1970, 0, 1));
    return eachYearOfInterval({ start: firstEmiDate, end: lastEmiDate }).map(d => getYear(d).toString()).reverse();
  }, [allEmis, currentYear]);

  const monthOptions = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  const filteredEmis = useMemo(() => {
    const monthIndex = monthOptions.indexOf(selectedMonth);
    return allEmis.filter(emi => {
      const emiDate = emi.dueDate.toDate();
      return getMonth(emiDate) === monthIndex && getYear(emiDate).toString() === selectedYear;
    });
  }, [allEmis, selectedMonth, selectedYear, monthOptions]);

  const summary = useMemo(() => {
    const totalDue = filteredEmis.reduce((sum, emi) => sum + emi.emiAmount, 0);
    const totalPaid = filteredEmis.filter(e => e.status === 'Paid').reduce((sum, emi) => sum + emi.paidAmount, 0);
    const totalUnpaid = filteredEmis.filter(e => e.status !== 'Paid').reduce((sum, emi) => sum + emi.emiAmount, 0);
    return { totalDue, totalPaid, totalUnpaid };
  }, [filteredEmis]);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);
  };
  
  return (
    <div className="w-full">
      <div className="mb-6 flex items-center gap-4">
        <Link href="/loan/reports">
          <Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button>
        </Link>
        <div>
            <h1 className="text-2xl font-bold">Month-wise EMI Status Report</h1>
            <CardDescription>Review the status of all EMIs for a selected month and year.</CardDescription>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-4">
            <Select value={selectedMonth} onValueChange={setSelectedMonth}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                {monthOptions.map(month => <SelectItem key={month} value={month}>{month}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={selectedYear} onValueChange={setSelectedYear}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                {yearOptions.map(year => <SelectItem key={year} value={year}>{year}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Lender</TableHead>
                <TableHead>Account No</TableHead>
                <TableHead>Due Date</TableHead>
                <TableHead>EMI Amount</TableHead>
                <TableHead>Paid Amount</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={6}><Skeleton className="h-8" /></TableCell>
                  </TableRow>
                ))
              ) : filteredEmis.length > 0 ? (
                filteredEmis.map(emi => (
                  <TableRow key={emi.id}>
                    <TableCell>{emi.loan.lenderName}</TableCell>
                    <TableCell>{emi.loan.accountNo}</TableCell>
                    <TableCell>{format(emi.dueDate.toDate(), 'dd/MM/yyyy')}</TableCell>
                    <TableCell>{formatCurrency(emi.emiAmount)}</TableCell>
                    <TableCell>{formatCurrency(emi.paidAmount)}</TableCell>
                    <TableCell>
                      <Badge variant={emi.status === 'Paid' ? 'default' : 'destructive'} className={emi.status === 'Paid' ? 'bg-green-600' : ''}>
                        {emi.status === 'Paid' ? <CheckCircle className="mr-1 h-3 w-3" /> : <Clock className="mr-1 h-3 w-3" />}
                        {emi.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={6} className="text-center h-24">No EMIs for {selectedMonth} {selectedYear}.</TableCell>
                </TableRow>
              )}
            </TableBody>
            <TableFooter>
                <TableRow className="bg-muted/50 font-bold">
                    <TableCell colSpan={3}>Totals</TableCell>
                    <TableCell>{formatCurrency(summary.totalDue)}</TableCell>
                    <TableCell>{formatCurrency(summary.totalPaid)}</TableCell>
                    <TableCell>{formatCurrency(summary.totalUnpaid)}</TableCell>
                </TableRow>
            </TableFooter>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
