
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Home, Plus, BarChart3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, where, orderBy, limit } from 'firebase/firestore';
import type { Loan, EMI } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { format } from 'date-fns';

interface LoanWithNextEmi extends Loan {
  nextEmiDate?: string;
}

export default function LoanDashboardPage() {
  const { toast } = useToast();
  const [loans, setLoans] = useState<LoanWithNextEmi[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchLoans = async () => {
      setIsLoading(true);
      try {
        const querySnapshot = await getDocs(collection(db, 'loans'));
        const loansData = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Loan));
        
        const loansWithEmi: LoanWithNextEmi[] = await Promise.all(
          loansData.map(async (loan) => {
            const emiQuery = query(
              collection(db, 'loans', loan.id, 'emis'), 
              where('status', '==', 'Pending')
            );
            const emiSnapshot = await getDocs(emiQuery);
            const pendingEmis = emiSnapshot.docs.map(doc => doc.data() as EMI);
            
            if (pendingEmis.length > 0) {
              pendingEmis.sort((a, b) => a.dueDate.toMillis() - b.dueDate.toMillis());
              const nextEmi = pendingEmis[0];
              return {
                ...loan,
                nextEmiDate: nextEmi ? format(nextEmi.dueDate.toDate(), 'dd MMM, yyyy') : 'N/A',
              };
            }
            
            return {
              ...loan,
              nextEmiDate: 'N/A',
            };
          })
        );
        
        setLoans(loansWithEmi);
      } catch (error) {
        console.error("Error fetching loans:", error);
        toast({ title: "Error", description: "Failed to fetch loans. A database index may be required.", variant: "destructive" });
      }
      setIsLoading(false);
    };
    fetchLoans();
  }, [toast]);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);
  };

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

      <Card>
        <CardHeader>
          <CardTitle>All Loans</CardTitle>
          <CardDescription>A list of all active and closed loans.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account No</TableHead>
                <TableHead>Lender</TableHead>
                <TableHead>Loan Amount</TableHead>
                <TableHead>EMI</TableHead>
                <TableHead>Next EMI Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={7}><Skeleton className="h-8" /></TableCell>
                  </TableRow>
                ))
              ) : loans.length > 0 ? (
                loans.map(loan => (
                  <TableRow key={loan.id}>
                    <TableCell className="font-medium">{loan.accountNo}</TableCell>
                    <TableCell>{loan.lenderName}</TableCell>
                    <TableCell>{formatCurrency(loan.loanAmount)}</TableCell>
                    <TableCell>{formatCurrency(loan.emiAmount)}</TableCell>
                    <TableCell>{loan.nextEmiDate}</TableCell>
                    <TableCell><Badge>{loan.status}</Badge></TableCell>
                    <TableCell>
                      <Link href={`/loan/${loan.id}`}>
                        <Button variant="outline" size="sm">View Details</Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={7} className="text-center h-24">No loans found.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
