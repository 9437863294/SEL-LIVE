
'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, orderBy, query, doc, updateDoc } from 'firebase/firestore';
import type { Loan, EMI } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { format } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { useRouter } from 'next/navigation';
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
} from "@/components/ui/alert-dialog";

interface LoanWithDetails extends Loan {
  totalInterest: number;
  totalAmountToBePaid: number;
}

export default function ManageLoanPage() {
  const { toast } = useToast();
  const router = useRouter();
  const [loansWithDetails, setLoansWithDetails] = useState<LoanWithDetails[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const loansSnapshot = await getDocs(query(collection(db, 'loans'), orderBy('createdAt', 'desc')));
      const loansData = loansSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Loan));
      
      const enhancedLoansPromises = loansData.map(async loan => {
        const emisSnapshot = await getDocs(collection(db, 'loans', loan.id, 'emis'));
        const totalInterest = emisSnapshot.docs.reduce((sum, doc) => sum + (doc.data() as EMI).interest, 0);
        const totalAmountToBePaid = loan.loanAmount + totalInterest;

        return {
          ...loan,
          totalInterest,
          totalAmountToBePaid,
        };
      });

      const enhancedLoans = await Promise.all(enhancedLoansPromises);
      setLoansWithDetails(enhancedLoans);

    } catch (error) {
      console.error("Error fetching loan data:", error);
      toast({ title: "Error", description: "Failed to fetch loan data.", variant: "destructive" });
    }
    setIsLoading(false);
  };
  
  useEffect(() => {
    fetchData();
  }, [toast]);
  
  const handleRowClick = (loanId: string) => {
    router.push(`/loan/${loanId}`);
  };
  
  const handleCloseLoan = async (e: React.MouseEvent, loan: Loan) => {
    e.stopPropagation();
    try {
        await updateDoc(doc(db, 'loans', loan.id), {
            status: 'Closed',
            endDate: format(new Date(), 'yyyy-MM-dd'),
        });
        toast({ title: 'Success', description: `Loan ${loan.accountNo} has been closed.` });
        fetchData();
    } catch(error) {
        console.error("Error closing loan:", error);
        toast({ title: 'Error', description: 'Failed to close the loan.', variant: 'destructive' });
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
  };
  
  const formatDate = (dateString: string) => {
    if (!dateString) return 'N/A';
    try {
        return format(new Date(dateString), 'dd/MM/yyyy');
    } catch (e) {
        return dateString;
    }
  };

  return (
    <div className="w-full">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/loan">
            <Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button>
          </Link>
          <h1 className="text-2xl font-bold">Manage Loans</h1>
        </div>
        <Link href="/loan/new">
            <Button>
                <Plus className="mr-2 h-4 w-4" />
                Add New Loan
            </Button>
        </Link>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-muted">
                <TableRow>
                  <TableHead className="text-center">Date</TableHead>
                  <TableHead className="text-center">A/C No</TableHead>
                  <TableHead className="text-left">Lender</TableHead>
                  <TableHead className="text-center">Principal</TableHead>
                  <TableHead className="text-center">Interest</TableHead>
                  <TableHead className="text-center">EMI</TableHead>
                  <TableHead className="text-center">Tenure</TableHead>
                  <TableHead className="text-center">Start Date</TableHead>
                  <TableHead className="text-center">End Date</TableHead>
                  <TableHead className="text-center">Linked Bank</TableHead>
                  <TableHead className="text-center">Total Payable</TableHead>
                  <TableHead className="text-center">Paid</TableHead>
                  <TableHead className="text-center">status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={14}><Skeleton className="h-8" /></TableCell>
                    </TableRow>
                  ))
                ) : loansWithDetails.length > 0 ? (
                  loansWithDetails.map(loan => (
                    <TableRow key={loan.id} className="cursor-pointer hover:bg-muted/50" onClick={() => handleRowClick(loan.id)}>
                      <TableCell className="text-center">{formatDate(loan.startDate)}</TableCell>
                      <TableCell className="text-center">{loan.accountNo}</TableCell>
                      <TableCell className="text-left">{loan.lenderName}</TableCell>
                      <TableCell className="text-right">{formatCurrency(loan.loanAmount)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(loan.totalInterest)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(loan.emiAmount)}</TableCell>
                      <TableCell className="text-center">{loan.tenure}</TableCell>
                      <TableCell className="text-center">{formatDate(loan.startDate)}</TableCell>
                      <TableCell className="text-center">{formatDate(loan.endDate)}</TableCell>
                      <TableCell className="text-center">{loan.linkedBank}</TableCell>
                      <TableCell className="text-right">{formatCurrency(loan.totalAmountToBePaid)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(loan.totalPaid)}</TableCell>
                      <TableCell className="text-center">
                        <Badge variant={loan.status === 'Active' ? 'default' : (loan.status === 'Closed' ? 'secondary' : 'destructive')}>
                            {loan.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {loan.status === 'Active' && (
                            <AlertDialog>
                                <AlertDialogTrigger asChild>
                                    <Button variant="outline" size="sm" onClick={(e) => e.stopPropagation()}>
                                        <XCircle className="mr-2 h-4 w-4" /> Close
                                    </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                    <AlertDialogHeader>
                                        <AlertDialogTitle>Are you sure you want to close this loan?</AlertDialogTitle>
                                        <AlertDialogDescription>This will mark the loan as "Closed" and set today's date as the end date. This action cannot be undone easily.</AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                        <AlertDialogCancel onClick={(e) => e.stopPropagation()}>Cancel</AlertDialogCancel>
                                        <AlertDialogAction onClick={(e) => handleCloseLoan(e, loan)}>Confirm Close</AlertDialogAction>
                                    </AlertDialogFooter>
                                </AlertDialogContent>
                            </AlertDialog>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={14} className="text-center h-24">No loans found.</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
