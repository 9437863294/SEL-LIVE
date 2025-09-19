
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Home, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs } from 'firebase/firestore';
import type { Loan } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';

export default function LoanDashboardPage() {
  const { toast } = useToast();
  const [loans, setLoans] = useState<Loan[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchLoans = async () => {
      setIsLoading(true);
      try {
        const querySnapshot = await getDocs(collection(db, 'loans'));
        const loansData = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Loan));
        setLoans(loansData);
      } catch (error) {
        console.error("Error fetching loans:", error);
        toast({ title: "Error", description: "Failed to fetch loans.", variant: "destructive" });
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
        <Link href="/loan/new">
          <Button><Plus className="mr-2 h-4 w-4" /> Add New Loan</Button>
        </Link>
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
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={6}><Skeleton className="h-8" /></TableCell>
                  </TableRow>
                ))
              ) : loans.length > 0 ? (
                loans.map(loan => (
                  <TableRow key={loan.id}>
                    <TableCell className="font-medium">{loan.accountNo}</TableCell>
                    <TableCell>{loan.lenderName}</TableCell>
                    <TableCell>{formatCurrency(loan.loanAmount)}</TableCell>
                    <TableCell>{formatCurrency(loan.emiAmount)}</TableCell>
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
                  <TableCell colSpan={6} className="text-center h-24">No loans found.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
