
'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs } from 'firebase/firestore';
import type { Loan, EMI } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { format, getYear, getMonth, eachYearOfInterval, startOfYear, endOfYear } from 'date-fns';

interface EnrichedEmi extends EMI {
  loan: Loan;
}

export default function EmiSummaryPage() {
  const { toast } = useToast();
  const [allEmis, setAllEmis] = useState<EnrichedEmi[]>([]);
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
        const flattenedEmis = allEmisNested.flat();
        
        setAllEmis(flattenedEmis);
      } catch (error) {
        console.error("Error fetching EMI data:", error);
        toast({ title: "Error", description: "Failed to fetch EMI data.", variant: "destructive" });
      }
      setIsLoading(false);
    };
    fetchAllData();
  }, [toast]);

  const filteredEmis = useMemo(() => {
    const monthIndex = new Date(Date.parse(selectedMonth +" 1, 2012")).getMonth();
    return allEmis.filter(emi => {
      const emiDate = emi.dueDate.toDate();
      return getMonth(emiDate) === monthIndex && getYear(emiDate).toString() === selectedYear;
    }).sort((a,b) => a.dueDate.toMillis() - b.dueDate.toMillis());
  }, [allEmis, selectedMonth, selectedYear]);
  
  const yearOptions = useMemo(() => {
    if (allEmis.length === 0) return [currentYear];
    const firstEmiDate = allEmis.reduce((earliest, emi) => emi.dueDate.toDate() < earliest ? emi.dueDate.toDate() : earliest, new Date());
    const lastEmiDate = allEmis.reduce((latest, emi) => emi.dueDate.toDate() > latest ? emi.dueDate.toDate() : latest, new Date(1970, 0, 1));
    return eachYearOfInterval({ start: firstEmiDate, end: lastEmiDate }).map(d => getYear(d).toString()).reverse();
  }, [allEmis, currentYear]);

  const monthOptions = [
    'January', 'February', 'March', 'April', 'May', 'June', 
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  
  const summary = useMemo(() => {
      const thisMonthDue = filteredEmis.reduce((sum, emi) => sum + emi.emiAmount, 0);
      return { thisMonthDue };
  }, [filteredEmis]);
  
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);
  };
  
  const formatDate = (date: any) => {
    if (!date) return 'N/A';
    return format(date.toDate ? date.toDate() : new Date(date), 'dd/MM/yyyy');
  };

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/loan">
            <Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button>
          </Link>
          <h1 className="text-2xl font-bold">EMI Monthly Summary</h1>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Today</CardTitle></CardHeader>
            <CardContent><p className="text-xl font-bold">{format(new Date(), 'dd/MM/yyyy')}</p></CardContent>
        </Card>
         <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">This Month Due</CardTitle></CardHeader>
            <CardContent><p className="text-xl font-bold">{formatCurrency(summary.thisMonthDue)}</p></CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
            <div className="flex items-center gap-4">
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
                <TableHead>Start Date</TableHead>
                <TableHead>A/C No</TableHead>
                <TableHead>Lender Name</TableHead>
                <TableHead>Linked Bank</TableHead>
                <TableHead>Due Date</TableHead>
                <TableHead className="text-right">EMI Amount</TableHead>
                <TableHead className="text-right">Principal</TableHead>
                <TableHead className="text-right">Interest</TableHead>
                <TableHead className="text-right">Paid Amount</TableHead>
                <TableHead className="text-center">EMI No</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={10}><Skeleton className="h-8" /></TableCell>
                  </TableRow>
                ))
              ) : filteredEmis.length > 0 ? (
                filteredEmis.map(emi => (
                  <TableRow key={emi.id}>
                    <TableCell>{formatDate(emi.loan.startDate)}</TableCell>
                    <TableCell>{emi.loan.accountNo}</TableCell>
                    <TableCell>{emi.loan.lenderName}</TableCell>
                    <TableCell>{emi.loan.linkedBank}</TableCell>
                    <TableCell>{formatDate(emi.dueDate)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(emi.emiAmount)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(emi.principal)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(emi.interest)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(emi.paidAmount)}</TableCell>
                    <TableCell className="text-center">{emi.emiNo}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={10} className="text-center h-24">
                    No EMIs due for {selectedMonth}, {selectedYear}.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
             <TableFooter>
                <TableRow className="font-bold">
                    <TableCell colSpan={5} className="text-right">Total</TableCell>
                    <TableCell className="text-right">{formatCurrency(filteredEmis.reduce((s, e) => s + e.emiAmount, 0))}</TableCell>
                    <TableCell className="text-right">{formatCurrency(filteredEmis.reduce((s, e) => s + e.principal, 0))}</TableCell>
                    <TableCell className="text-right">{formatCurrency(filteredEmis.reduce((s, e) => s + e.interest, 0))}</TableCell>
                    <TableCell className="text-right">{formatCurrency(filteredEmis.reduce((s, e) => s + e.paidAmount, 0))}</TableCell>
                    <TableCell></TableCell>
                </TableRow>
            </TableFooter>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

