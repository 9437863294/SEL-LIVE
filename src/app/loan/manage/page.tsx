
'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus, XCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, orderBy, query, doc, updateDoc, writeBatch } from 'firebase/firestore';
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
import {
  Dialog,
  DialogContent as RegularDialogContent,
  DialogHeader as RegularDialogHeader,
  DialogTitle as RegularDialogTitle,
  DialogDescription as RegularDialogDescription,
  DialogFooter as RegularDialogFooter,
  DialogClose as RegularDialogClose,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';


interface LoanWithDetails extends Loan {
  totalInterest: number;
  totalAmountToBePaid: number;
  areAllEmisPaid: boolean;
  outstandingPrincipal: number;
}

export default function ManageLoanPage() {
  const { toast } = useToast();
  const router = useRouter();
  const [loansWithDetails, setLoansWithDetails] = useState<LoanWithDetails[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // State for pre-closure dialog
  const [isPreClosureDialogOpen, setIsPreClosureDialogOpen] = useState(false);
  const [loanToClose, setLoanToClose] = useState<LoanWithDetails | null>(null);
  const [finalInterest, setFinalInterest] = useState(0);
  const [otherCharges, setOtherCharges] = useState(0);
  const [isClosing, setIsClosing] = useState(false);
  

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const loansSnapshot = await getDocs(query(collection(db, 'loans'), orderBy('createdAt', 'desc')));
      const loansData = loansSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Loan));
      
      const enhancedLoansPromises = loansData.map(async loan => {
        const emisSnapshot = await getDocs(collection(db, 'loans', loan.id, 'emis'));
        const emis = emisSnapshot.docs.map(doc => doc.data() as EMI);

        const totalInterest = emis.reduce((sum, emi) => sum + emi.interest, 0);
        const totalAmountToBePaid = loan.loanAmount + totalInterest;
        const areAllEmisPaid = emis.every(emi => emi.status === 'Paid');
        
        const paidPrincipal = emis
            .filter(emi => emi.status === 'Paid')
            .reduce((sum, emi) => sum + emi.principal, 0);
        const outstandingPrincipal = loan.loanAmount - paidPrincipal;


        return {
          ...loan,
          totalInterest,
          totalAmountToBePaid,
          areAllEmisPaid,
          outstandingPrincipal,
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
  
  const handleOpenClosureDialog = (e: React.MouseEvent, loan: LoanWithDetails) => {
    e.stopPropagation();
    setLoanToClose(loan);
    setFinalInterest(0);
    setOtherCharges(0);
    // If all EMIs are paid, the AlertDialog will open via its trigger.
    // If not, we open the pre-closure Dialog here.
    if (!loan.areAllEmisPaid) {
      setIsPreClosureDialogOpen(true);
    }
  };

  const handleConfirmSimpleClosure = async () => {
    if (!loanToClose) return;
    try {
      await updateDoc(doc(db, 'loans', loanToClose.id), {
        status: 'Closed',
        endDate: format(new Date(), 'yyyy-MM-dd'),
      });
      toast({ title: 'Success', description: `Loan ${loanToClose.accountNo} has been closed.` });
      fetchData();
    } catch (error) {
      console.error("Error closing loan:", error);
      toast({ title: 'Error', description: 'Failed to close the loan.', variant: 'destructive' });
    }
  };
  
  const handleConfirmPreClosure = async () => {
      if (!loanToClose) return;
      setIsClosing(true);
      try {
          // In a real app, you would process the payment here.
          // For now, we'll just update the loan status.
          await updateDoc(doc(db, 'loans', loanToClose.id), {
              status: 'Closed',
              endDate: format(new Date(), 'yyyy-MM-dd'),
              totalPaid: loanToClose.totalPaid + loanToClose.outstandingPrincipal + finalInterest + otherCharges,
              finalInterestOnClosure: finalInterest,
              otherChargesOnClosure: otherCharges,
          });
           toast({ title: 'Success', description: `Loan ${loanToClose.accountNo} has been pre-closed.` });
           fetchData();
           setIsPreClosureDialogOpen(false);
      } catch (error) {
          console.error("Error during pre-closure:", error);
          toast({ title: 'Error', description: 'Failed to pre-close the loan.', variant: 'destructive' });
      } finally {
          setIsClosing(false);
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
    <>
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
                            loan.areAllEmisPaid ? (
                                <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                        <Button variant="outline" size="sm" onClick={(e) => handleOpenClosureDialog(e, loan)}>
                                            <XCircle className="mr-2 h-4 w-4" /> Close
                                        </Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                        <AlertDialogHeader>
                                            <AlertDialogTitle>Are you sure you want to close this loan?</AlertDialogTitle>
                                            <AlertDialogDescription>
                                                Make the final payment: The lender will provide the total outstanding amount, which includes the principal, applicable interest, and any pre-payment charges. This action cannot be undone easily.
                                            </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                            <AlertDialogCancel onClick={(e) => e.stopPropagation()}>Cancel</AlertDialogCancel>
                                            <AlertDialogAction onClick={(e) => { e.stopPropagation(); handleConfirmSimpleClosure(); }}>Confirm Closure</AlertDialogAction>
                                        </AlertDialogFooter>
                                    </AlertDialogContent>
                                </AlertDialog>
                            ) : (
                                <Button variant="outline" size="sm" onClick={(e) => handleOpenClosureDialog(e, loan)}>
                                    <XCircle className="mr-2 h-4 w-4" /> Close
                                </Button>
                            )
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

    {loanToClose && (
        <Dialog open={isPreClosureDialogOpen} onOpenChange={setIsPreClosureDialogOpen}>
            <RegularDialogContent>
                <RegularDialogHeader>
                    <RegularDialogTitle>Pre-closure for Loan: {loanToClose.accountNo}</RegularDialogTitle>
                    <RegularDialogDescription>
                        Confirm the final amounts to close this loan before all EMIs are paid.
                    </RegularDialogDescription>
                </RegularDialogHeader>
                <div className="py-4 space-y-4">
                    <div>
                        <Label>Outstanding Principal</Label>
                        <Input value={formatCurrency(loanToClose.outstandingPrincipal)} readOnly />
                    </div>
                     <div>
                        <Label htmlFor="finalInterest">Final Interest Amount</Label>
                        <Input id="finalInterest" type="number" value={finalInterest} onChange={(e) => setFinalInterest(Number(e.target.value))} />
                    </div>
                     <div>
                        <Label htmlFor="otherCharges">Pre-closure / Other Charges</Label>
                        <Input id="otherCharges" type="number" value={otherCharges} onChange={(e) => setOtherCharges(Number(e.target.value))} />
                    </div>
                    <div className="font-bold text-lg border-t pt-4 mt-4">
                        Total Payable: {formatCurrency(loanToClose.outstandingPrincipal + finalInterest + otherCharges)}
                    </div>
                    <div>
                        <Label>Please upload the final statement and No Objection Certificate (NOC) after payment.</Label>
                        {/* Future: Add file upload component here */}
                    </div>
                </div>
                <RegularDialogFooter>
                    <RegularDialogClose asChild><Button variant="outline">Cancel</Button></RegularDialogClose>
                    <Button onClick={handleConfirmPreClosure} disabled={isClosing}>
                        {isClosing && <Loader2 className="mr-2 h-4 w-4 animate-spin"/>}
                        Confirm & Close Loan
                    </Button>
                </RegularDialogFooter>
            </RegularDialogContent>
        </Dialog>
    )}
    </>
  );
}
