
'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Loader2, CheckCircle, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { doc, getDoc, collection, getDocs, updateDoc, writeBatch } from 'firebase/firestore';
import type { Loan, EMI } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { format } from 'date-fns';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function LoanDetailsPage() {
  const { loanId } = useParams() as { loanId: string };
  const { toast } = useToast();
  const [loan, setLoan] = useState<Loan | null>(null);
  const [emis, setEmis] = useState<EMI[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [isPayDialogOpen, setIsPayDialogOpen] = useState(false);
  const [selectedEmi, setSelectedEmi] = useState<EMI | null>(null);
  const [paidAmount, setPaidAmount] = useState<number>(0);
  const [isConfirmingPayment, setIsConfirmingPayment] = useState(false);


  const fetchLoanData = async () => {
    if (!loanId) return;
    setIsLoading(true);
    try {
      const loanDocRef = doc(db, 'loans', loanId);
      const loanDocSnap = await getDoc(loanDocRef);

      if (loanDocSnap.exists()) {
        setLoan({ id: loanDocSnap.id, ...loanDocSnap.data() } as Loan);
      } else {
        toast({ title: "Error", description: "Loan not found.", variant: "destructive" });
      }

      const emiCollectionRef = collection(db, 'loans', loanId, 'emis');
      const emiSnapshot = await getDocs(emiCollectionRef);
      const emisData = emiSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as EMI));
      emisData.sort((a,b) => a.emiNo - b.emiNo);
      setEmis(emisData);

    } catch (error) {
      console.error("Error fetching loan data:", error);
      toast({ title: "Error", description: "Failed to fetch loan details.", variant: "destructive" });
    }
    setIsLoading(false);
  };
  
  useEffect(() => {
    fetchLoanData();
  }, [loanId, toast]);
  
  const handleMarkAsPaidClick = (emi: EMI) => {
    setSelectedEmi(emi);
    setPaidAmount(emi.emiAmount);
    setIsPayDialogOpen(true);
  };

  const handleConfirmPayment = async () => {
    if(!loan || !selectedEmi) return;
    
    setIsConfirmingPayment(true);
    try {
        const emiDocRef = doc(db, 'loans', loanId, 'emis', selectedEmi.id);
        const loanDocRef = doc(db, 'loans', loanId);

        const batch = writeBatch(db);
        
        batch.update(emiDocRef, { status: 'Paid', paidAmount: paidAmount });
        batch.update(loanDocRef, { totalPaid: loan.totalPaid + paidAmount });

        await batch.commit();

        toast({ title: "Success", description: `EMI #${selectedEmi.emiNo} marked as paid.`});
        
        // Refresh local state to avoid re-fetching
        setEmis(prev => prev.map(e => e.id === selectedEmi.id ? {...e, status: 'Paid', paidAmount: paidAmount} : e));
        setLoan(prev => prev ? {...prev, totalPaid: prev.totalPaid + paidAmount} : null);

        setIsPayDialogOpen(false);
        setSelectedEmi(null);

    } catch (error) {
        console.error("Error confirming payment:", error);
        toast({ title: "Error", description: "Failed to update EMI status.", variant: "destructive" });
    } finally {
        setIsConfirmingPayment(false);
    }
  }


  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(Math.round(amount));
  };
  
  const formatDate = (date: any) => {
      if (typeof date === 'string') {
          return format(new Date(date), 'dd MMM, yyyy');
      }
      if (date && typeof date.toDate === 'function') {
          return format(date.toDate(), 'dd MMM, yyyy');
      }
      return 'N/A';
  }

  if (isLoading) {
    return (
        <div className="w-full px-4 sm:px-6 lg:px-8">
            <Skeleton className="h-10 w-64 mb-6" />
            <Skeleton className="h-48 mb-6" />
            <Skeleton className="h-96" />
        </div>
    );
  }
  
  if(!loan) {
      return (
           <div className="w-full px-4 sm:px-6 lg:px-8">
                <h1 className="text-2xl font-bold">Loan Not Found</h1>
           </div>
      )
  }

  const paidEmisCount = emis.filter(e => e.status === 'Paid').length;
  const remainingMonths = loan.tenure - paidEmisCount;

  return (
    <>
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/loan">
              <Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold">Loan Details</h1>
              <p className="text-muted-foreground">{loan.lenderName} - {loan.accountNo}</p>
            </div>
          </div>
        </div>

        <Card className="mb-6">
            <CardHeader>
               <CardTitle>Summary</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div><p className="text-sm text-muted-foreground">Loan Amount</p><p className="font-semibold">{formatCurrency(loan.loanAmount)}</p></div>
              <div><p className="text-sm text-muted-foreground">Interest Rate</p><p className="font-semibold">{loan.interestRate}%</p></div>
              <div><p className="text-sm text-muted-foreground">Tenure</p><p className="font-semibold">{loan.tenure} months</p></div>
              <div><p className="text-sm text-muted-foreground">Remaining Months</p><p className="font-semibold">{remainingMonths} months</p></div>
              <div><p className="text-sm text-muted-foreground">EMI</p><p className="font-semibold">{formatCurrency(loan.emiAmount)}</p></div>
              <div><p className="text-sm text-muted-foreground">Total Paid</p><p className="font-semibold">{formatCurrency(loan.totalPaid)}</p></div>
               <div><p className="text-sm text-muted-foreground">Outstanding</p><p className="font-semibold">{formatCurrency(loan.loanAmount - loan.totalPaid)}</p></div>
              <div><p className="text-sm text-muted-foreground">Start Date</p><p className="font-semibold">{formatDate(loan.startDate)}</p></div>
              <div><p className="text-sm text-muted-foreground">End Date</p><p className="font-semibold">{formatDate(loan.endDate)}</p></div>
            </CardContent>
        </Card>
        
         <Card>
          <CardHeader>
            <CardTitle>EMI Schedule</CardTitle>
            <CardDescription>Detailed schedule of Equated Monthly Installments.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>EMI No.</TableHead>
                  <TableHead>Due Date</TableHead>
                  <TableHead>Principal</TableHead>
                  <TableHead>Interest</TableHead>
                  <TableHead>EMI Amount</TableHead>
                  <TableHead>Closing Principal</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {emis.map(emi => (
                    <TableRow key={emi.id}>
                      <TableCell>{emi.emiNo}</TableCell>
                      <TableCell>{formatDate(emi.dueDate)}</TableCell>
                      <TableCell>{formatCurrency(emi.principal)}</TableCell>
                      <TableCell>{formatCurrency(emi.interest)}</TableCell>
                      <TableCell>{formatCurrency(emi.emiAmount)}</TableCell>
                      <TableCell>{formatCurrency(emi.closingPrincipal)}</TableCell>
                      <TableCell><Badge variant={emi.status === 'Paid' ? 'default' : 'secondary'}>{emi.status}</Badge></TableCell>
                      <TableCell>
                        {emi.status === 'Pending' && (
                          <Button size="sm" onClick={() => handleMarkAsPaidClick(emi)}>Mark as Paid</Button>
                        )}
                      </TableCell>
                    </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Dialog open={isPayDialogOpen} onOpenChange={setIsPayDialogOpen}>
          <DialogContent className="sm:max-w-md">
              <DialogHeader>
                  <DialogTitle>Confirm Payment for EMI #{selectedEmi?.emiNo}</DialogTitle>
                  <DialogDescription>
                      Review the details and confirm the amount paid.
                  </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                  <div className="flex justify-between items-center text-sm">
                      <span className="text-muted-foreground">EMI Amount</span>
                      <span className="font-medium">{formatCurrency(selectedEmi?.emiAmount || 0)}</span>
                  </div>
                   <div className="flex justify-between items-center text-sm">
                      <span className="text-muted-foreground">Principal</span>
                      <span className="font-medium">{formatCurrency(selectedEmi?.principal || 0)}</span>
                  </div>
                   <div className="flex justify-between items-center text-sm">
                      <span className="text-muted-foreground">Interest</span>
                      <span className="font-medium">{formatCurrency(selectedEmi?.interest || 0)}</span>
                  </div>
                  <div className="space-y-2 pt-4">
                      <Label htmlFor="paidAmount">Paid Amount</Label>
                      <Input
                        id="paidAmount"
                        type="number"
                        value={paidAmount}
                        onChange={(e) => setPaidAmount(parseFloat(e.target.value) || 0)}
                        className="text-lg font-bold h-12"
                      />
                  </div>
              </div>
              <DialogFooter>
                  <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
                  <Button onClick={handleConfirmPayment} disabled={isConfirmingPayment}>
                    {isConfirmingPayment && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Confirm Payment
                  </Button>
              </DialogFooter>
          </DialogContent>
      </Dialog>
    </>
  );
}
