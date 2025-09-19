
'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { Home, Plus, BarChart3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, where } from 'firebase/firestore';
import type { Loan, EMI } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { format } from 'date-fns';

interface LoanSummary {
    totalLoans: number;
    totalInterest: number;
    totalAmountToBePaid: number;
    totalPaid: number;
    totalEmiPerMonth: number;
    totalOutstanding: number;
    activeLoans: number;
    closedLoans: number;
}

export default function LoanDashboardPage() {
  const { toast } = useToast();
  const [loans, setLoans] = useState<Loan[]>([]);
  const [allEmis, setAllEmis] = useState<EMI[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      try {
        const loansSnapshot = await getDocs(collection(db, 'loans'));
        const loansData = loansSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Loan));
        setLoans(loansData);

        const emisPromises = loansData.map(loan => getDocs(collection(db, 'loans', loan.id, 'emis')));
        const emisSnapshots = await Promise.all(emisPromises);
        const allEmisData = emisSnapshots.flatMap(snapshot => snapshot.docs.map(doc => doc.data() as EMI));
        setAllEmis(allEmisData);

      } catch (error) {
        console.error("Error fetching loan data:", error);
        toast({ title: "Error", description: "Failed to fetch loan data.", variant: "destructive" });
      }
      setIsLoading(false);
    };
    fetchData();
  }, [toast]);

  const summary: LoanSummary = useMemo(() => {
    const initialSummary: LoanSummary = {
        totalLoans: 0,
        totalInterest: 0,
        totalAmountToBePaid: 0,
        totalPaid: 0,
        totalEmiPerMonth: 0,
        totalOutstanding: 0,
        activeLoans: 0,
        closedLoans: 0,
    };
    
    if (isLoading) return initialSummary;

    return loans.reduce((acc, loan) => {
      const loanEmis = allEmis.filter(emi => emi.loanId === loan.id);
      const totalInterestForLoan = loanEmis.reduce((sum, emi) => sum + emi.interest, 0);

      acc.totalLoans += loan.loanAmount;
      acc.totalInterest += totalInterestForLoan;
      acc.totalPaid += loan.totalPaid || 0;
      
      if (loan.status === 'Active') {
          acc.activeLoans += 1;
          acc.totalEmiPerMonth += loan.emiAmount;
      }
      if (loan.status === 'Closed') {
          acc.closedLoans += 1;
      }
      
      return acc;
    }, initialSummary);

  }, [loans, allEmis, isLoading]);
  
  summary.totalAmountToBePaid = summary.totalLoans + summary.totalInterest;
  summary.totalOutstanding = summary.totalAmountToBePaid - summary.totalPaid;

  const loansWithDetails = useMemo(() => {
    return loans.map(loan => {
      const loanEmis = allEmis.filter(emi => emi.loanId === loan.id);
      const totalInterest = loanEmis.reduce((sum, emi) => sum + emi.interest, 0);
      const paidEmis = loanEmis.filter(emi => emi.status === 'Paid').length;
      const remainingMonths = loan.tenure - paidEmis;
      const dueDate = loanEmis.length > 0 ? format(loanEmis[0].dueDate.toDate(), 'dd') : 'N/A';
      const balance = (loan.loanAmount + totalInterest) - (loan.totalPaid || 0);

      return {
        ...loan,
        totalInterest,
        remainingMonths,
        dueDate,
        balance,
      };
    });
  }, [loans, allEmis]);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
  };
  
  const StatCard = ({ title, value }: { title: string, value: string | number }) => (
    <Card className="shadow-md">
      <CardHeader className="p-2 text-center bg-blue-200 rounded-t-lg">
        <CardTitle className="text-sm font-medium text-blue-900">{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-3 text-center">
        <p className="text-lg font-bold">{typeof value === 'number' ? formatCurrency(value) : value}</p>
      </CardContent>
    </Card>
  );

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/">
            <Button variant="ghost" size="icon"><Home className="h-6 w-6" /></Button>
          </Link>
          <h1 className="text-2xl font-bold">Loan Dashboard</h1>
        </div>
        <div className="flex items-center gap-2">
            <Link href="/loan/emi-summary">
              <Button variant="outline">
                  <BarChart3 className="mr-2 h-4 w-4" />
                  EMI Monthly Summary
              </Button>
            </Link>
            <Link href="/loan/new">
              <Button><Plus className="mr-2 h-4 w-4" /> Add New Loan</Button>
            </Link>
        </div>
      </div>

      <Card className="mb-6">
        <CardContent className="p-4">
          {isLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {Array.from({length: 8}).map((_, i) => <Skeleton key={i} className="h-20" />)}
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard title="Total Loans" value={summary.totalLoans} />
                <StatCard title="Total Interest" value={summary.totalInterest} />
                <StatCard title="Total Amount to be Paid" value={summary.totalAmountToBePaid} />
                <StatCard title="Total Paid" value={summary.totalPaid} />
                <StatCard title="Total EMI per Month" value={summary.totalEmiPerMonth} />
                <StatCard title="Total Outstanding" value={summary.totalOutstanding} />
                <StatCard title="Number of Active Loans" value={loans.filter(l => l.status === 'Active').length} />
                <StatCard title="Number of Closed Loans" value={loans.filter(l => l.status === 'Closed').length} />
            </div>
          )}
        </CardContent>
      </Card>
      

      <Card>
        <CardHeader className="bg-yellow-100 p-3">
          <CardTitle className="text-center text-sm font-semibold">LIST OF LENDERS WITH DETAILS</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Start Date</TableHead>
                <TableHead>A/C No</TableHead>
                <TableHead>Lender Name</TableHead>
                <TableHead>Principal Amount</TableHead>
                <TableHead>Interest Amount</TableHead>
                <TableHead>EMI Amount</TableHead>
                <TableHead>Total Months</TableHead>
                <TableHead>Remaining Months</TableHead>
                <TableHead>Due Day</TableHead>
                <TableHead>Balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={10}><Skeleton className="h-8" /></TableCell>
                  </TableRow>
                ))
              ) : loansWithDetails.length > 0 ? (
                loansWithDetails.map(loan => (
                  <TableRow key={loan.id}>
                    <TableCell>{format(new Date(loan.startDate), 'dd/MM/yyyy')}</TableCell>
                    <TableCell>{loan.accountNo}</TableCell>
                    <TableCell>{loan.lenderName}</TableCell>
                    <TableCell>{formatCurrency(loan.loanAmount)}</TableCell>
                    <TableCell>{formatCurrency(loan.totalInterest)}</TableCell>
                    <TableCell>{formatCurrency(loan.emiAmount)}</TableCell>
                    <TableCell>{loan.tenure}</TableCell>
                    <TableCell>{loan.remainingMonths}</TableCell>
                    <TableCell>{loan.dueDate}</TableCell>
                    <TableCell>{formatCurrency(loan.balance)}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={10} className="text-center h-24">No loans found.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
