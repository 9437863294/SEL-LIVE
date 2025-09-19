
'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Loader2, CheckCircle, Clock, Edit, Save, X, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { doc, getDoc, collection, getDocs, updateDoc, writeBatch, Timestamp } from 'firebase/firestore';
import type { Loan, EMI } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { format, addMonths } from 'date-fns';
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
  const [dialogPaidAmount, setDialogPaidAmount] = useState(0);
  const [dialogPrincipal, setDialogPrincipal] = useState(0);
  const [dialogInterest, setDialogInterest] = useState(0);
  const [isConfirmingPayment, setIsConfirmingPayment] = useState(false);
  
  const [isEditing, setIsEditing] = useState(false);
  const [editedLoan, setEditedLoan] = useState<Loan | null>(null);
  const [regeneratedEmis, setRegeneratedEmis] = useState<EMI[]>([]);
  const [isSaving, setIsSaving] = useState(false);


  const fetchLoanData = async () => {
    if (!loanId) return;
    setIsLoading(true);
    try {
      const loanDocRef = doc(db, 'loans', loanId);
      const loanDocSnap = await getDoc(loanDocRef);

      if (loanDocSnap.exists()) {
        const loanData = { id: loanDocSnap.id, ...loanDocSnap.data() } as Loan
        setLoan(loanData);
        setEditedLoan(loanData);
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
    setDialogPaidAmount(emi.emiAmount);
    setDialogPrincipal(emi.principal);
    setDialogInterest(emi.interest);
    setIsPayDialogOpen(true);
  };
  
  const handleEditEmiClick = (emi: EMI) => {
    setSelectedEmi(emi);
    setDialogPaidAmount(emi.paidAmount);
    setDialogPrincipal(emi.principal);
    setDialogInterest(emi.interest);
    setIsPayDialogOpen(true);
  };

  const handleConfirmPayment = async () => {
    if(!loan || !selectedEmi) return;
    
    setIsConfirmingPayment(true);
    try {
        const emiDocRef = doc(db, 'loans', loanId, 'emis', selectedEmi.id);
        const loanDocRef = doc(db, 'loans', loanId);

        const batch = writeBatch(db);
        
        batch.update(emiDocRef, { 
            status: selectedEmi.status === 'Paid' ? 'Paid' : 'Paid', // Keep as paid if already paid
            paidAmount: dialogPaidAmount,
            principal: dialogPrincipal,
            interest: dialogInterest,
            emiAmount: dialogPrincipal + dialogInterest,
        });
        
        const originalEmi = emis.find(e => e.id === selectedEmi.id);
        const paidAmountDifference = dialogPaidAmount - (originalEmi?.paidAmount || 0);

        batch.update(loanDocRef, { totalPaid: loan.totalPaid + paidAmountDifference });

        await batch.commit();

        toast({ title: "Success", description: `EMI #${selectedEmi.emiNo} has been updated.`});
        
        fetchLoanData(); // Refetch all data to ensure consistency

        setIsPayDialogOpen(false);
        setSelectedEmi(null);

    } catch (error) {
        console.error("Error confirming payment:", error);
        toast({ title: "Error", description: "Failed to update EMI status.", variant: "destructive" });
    } finally {
        setIsConfirmingPayment(false);
    }
  }

  const round = (num: number) => Math.round(num);

  const handleRegenerateSchedule = () => {
    if (!editedLoan) return;

    const p = Number(editedLoan.loanAmount);
    const r = Number(editedLoan.interestRate) / 12 / 100;
    const n = Number(editedLoan.tenure);

    if (p > 0 && r > 0 && n > 0 && editedLoan.startDate) {
        const rawEmi = (p * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
        const emiAmount = round(rawEmi);

        const schedule: EMI[] = [];
        let balance = p;
        for (let i = 1; i <= n; i++) {
            const interest = round(balance * r);
            let principal = round(emiAmount - interest);

            if (i === n) {
                principal = balance;
            } else if (principal > balance) {
                principal = balance;
            }
            
            balance = round(balance - principal);

            schedule.push({
                id: `temp-${i}`, // Temporary ID
                loanId: loanId,
                emiNo: i,
                dueDate: Timestamp.fromDate(addMonths(new Date(editedLoan.startDate), i)),
                emiAmount: i === n ? round(principal + interest) : emiAmount,
                principal: principal,
                interest: interest,
                paidAmount: 0,
                closingPrincipal: balance,
                status: 'Pending',
            });
        }
        setRegeneratedEmis(schedule);
    } else {
        toast({ title: "Missing Details", description: "Loan Amount, Tenure, Rate, and Start Date are required.", variant: "destructive" });
    }
  };
  
  const handleEmiScheduleChange = (index: number, field: 'principal' | 'interest', value: number) => {
    if (!isEditing) return;

    const scheduleSource = regeneratedEmis.length > 0 ? regeneratedEmis : emis;
    const setScheduleSource = regeneratedEmis.length > 0 ? setRegeneratedEmis : setEmis;

    const newSchedule = [...scheduleSource];
    const item = newSchedule[index];

    if (field === 'principal') {
        item.principal = round(value);
    } else if (field === 'interest') {
        item.interest = round(value);
    }

    item.emiAmount = round(item.principal + item.interest);
    
    let currentBalance = index > 0 ? newSchedule[index - 1].closingPrincipal : (editedLoan?.loanAmount || 0);

    if (item.principal > currentBalance) {
        item.principal = round(currentBalance);
    }

    item.closingPrincipal = round(currentBalance - item.principal);

    for (let i = index + 1; i < newSchedule.length; i++) {
        const prevClosingPrincipal = newSchedule[i - 1].closingPrincipal;
        const currentItem = newSchedule[i];

        // Assuming interest for subsequent months is not automatically recalculated
        // but principal and closing balance are.
        currentItem.principal = round(currentItem.emiAmount - currentItem.interest);

        if (currentItem.principal > prevClosingPrincipal) {
            currentItem.principal = prevClosingPrincipal;
        }

        currentItem.closingPrincipal = round(prevClosingPrincipal - currentItem.principal);
    }

    setScheduleSource(newSchedule as any);
  };
  
  const handleSaveChanges = async () => {
    if (!editedLoan || !loan) return;
    setIsSaving(true);
    try {
        const batch = writeBatch(db);
        const loanRef = doc(db, 'loans', loan.id);
        
        const scheduleToSave = regeneratedEmis.length > 0 ? regeneratedEmis : emis;

        batch.update(loanRef, {
            loanAmount: Number(editedLoan.loanAmount),
            interestRate: Number(editedLoan.interestRate),
            tenure: Number(editedLoan.tenure),
            emiAmount: scheduleToSave[0]?.emiAmount || editedLoan.emiAmount,
            startDate: editedLoan.startDate,
            endDate: format(addMonths(new Date(editedLoan.startDate), Number(editedLoan.tenure)), 'yyyy-MM-dd'),
            totalPaid: 0, 
        });
        
        const oldEmisSnapshot = await getDocs(collection(db, 'loans', loan.id, 'emis'));
        oldEmisSnapshot.forEach(doc => batch.delete(doc.ref));

        scheduleToSave.forEach(emi => {
            const { id, loanId, ...emiData } = emi;
            const newEmiRef = doc(collection(db, 'loans', loan.id, 'emis'));
            batch.set(newEmiRef, emiData);
        });

        await batch.commit();
        toast({ title: 'Success', description: 'Loan details and EMI schedule updated.' });
        setIsEditing(false);
        setRegeneratedEmis([]);
        fetchLoanData(); 

    } catch (e) {
        console.error("Error saving changes:", e);
        toast({ title: "Save Failed", description: "Could not save loan changes.", variant: "destructive" });
    } finally {
        setIsSaving(false);
    }
  };


  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(round(amount));
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
  
  if(!loan || !editedLoan) {
      return (
           <div className="w-full px-4 sm:px-6 lg:px-8">
                <h1 className="text-2xl font-bold">Loan Not Found</h1>
           </div>
      )
  }

  const paidEmisCount = emis.filter(e => e.status === 'Paid').length;
  const remainingMonths = loan.tenure - paidEmisCount;
  const scheduleToDisplay = isEditing && regeneratedEmis.length > 0 ? regeneratedEmis : emis;

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
           <div className="flex items-center gap-2">
            {isEditing ? (
              <>
                <Button variant="outline" onClick={() => { setIsEditing(false); setRegeneratedEmis([]); fetchLoanData(); }}>
                  <X className="mr-2 h-4 w-4" /> Cancel
                </Button>
                <Button onClick={handleSaveChanges} disabled={isSaving}>
                  {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  <Save className="mr-2 h-4 w-4" /> Save Changes
                </Button>
              </>
            ) : (
              <Button variant="outline" onClick={() => setIsEditing(true)}>
                <Edit className="mr-2 h-4 w-4" /> Edit Loan
              </Button>
            )}
          </div>
        </div>

        <Card className="mb-6">
            <CardHeader>
               <CardTitle>Summary</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
              <div className="space-y-1"><Label>Loan Amount</Label>{isEditing ? <Input type="number" value={editedLoan.loanAmount} onChange={e => setEditedLoan({...editedLoan, loanAmount: Number(e.target.value)})} /> : <p className="font-semibold">{formatCurrency(loan.loanAmount)}</p>}</div>
              <div className="space-y-1"><Label>Interest Rate</Label>{isEditing ? <Input type="number" value={editedLoan.interestRate} onChange={e => setEditedLoan({...editedLoan, interestRate: Number(e.target.value)})} /> : <p className="font-semibold">{loan.interestRate}%</p>}</div>
              <div className="space-y-1"><Label>Tenure (months)</Label>{isEditing ? <Input type="number" value={editedLoan.tenure} onChange={e => setEditedLoan({...editedLoan, tenure: Number(e.target.value)})} /> : <p className="font-semibold">{loan.tenure} months</p>}</div>
              <div className="space-y-1"><Label>Start Date</Label>{isEditing ? <Input type="date" value={editedLoan.startDate} onChange={e => setEditedLoan({...editedLoan, startDate: e.target.value})} /> : <p className="font-semibold">{formatDate(loan.startDate)}</p>}</div>
              <div className="space-y-1"><Label>EMI</Label><p className="font-semibold">{formatCurrency(loan.emiAmount)}</p></div>
              <div className="space-y-1"><Label>Remaining Months</Label><p className="font-semibold">{remainingMonths} months</p></div>
              <div className="space-y-1"><Label>Total Paid</Label><p className="font-semibold">{formatCurrency(loan.totalPaid)}</p></div>
              <div className="space-y-1"><Label>Outstanding</Label><p className="font-semibold">{formatCurrency(loan.loanAmount - loan.totalPaid)}</p></div>
            </CardContent>
            {isEditing && (
              <CardContent>
                <Button onClick={handleRegenerateSchedule}>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Regenerate Schedule
                </Button>
              </CardContent>
            )}
        </Card>
        
         <Card>
          <CardHeader>
            <CardTitle>Repayment Schedule</CardTitle>
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
                {scheduleToDisplay.map((emi, index) => (
                    <TableRow key={emi.id}>
                      <TableCell>{emi.emiNo}</TableCell>
                      <TableCell>{formatDate(emi.dueDate)}</TableCell>
                      <TableCell>
                        {isEditing ? (
                          <Input type="number" value={round(emi.principal)} onChange={e => handleEmiScheduleChange(index, 'principal', Number(e.target.value))} className="w-32" />
                        ) : (
                          formatCurrency(emi.principal)
                        )}
                      </TableCell>
                      <TableCell>
                         {isEditing ? (
                          <Input type="number" value={round(emi.interest)} onChange={e => handleEmiScheduleChange(index, 'interest', Number(e.target.value))} className="w-28" />
                        ) : (
                          formatCurrency(emi.interest)
                        )}
                      </TableCell>
                      <TableCell>{formatCurrency(emi.emiAmount)}</TableCell>
                      <TableCell>{formatCurrency(emi.closingPrincipal)}</TableCell>
                      <TableCell><Badge variant={emi.status === 'Paid' ? 'default' : 'secondary'}>{emi.status}</Badge></TableCell>
                      <TableCell>
                        {!isEditing && (
                          emi.status === 'Pending' ? (
                            <Button size="sm" onClick={() => handleMarkAsPaidClick(emi)}>Mark as Paid</Button>
                          ) : (
                            <Button size="sm" variant="outline" onClick={() => handleEditEmiClick(emi)}>Edit</Button>
                          )
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
                  <DialogTitle>{selectedEmi?.status === 'Paid' ? 'Edit' : 'Confirm'} Payment for EMI #{selectedEmi?.emiNo}</DialogTitle>
                  <DialogDescription>
                      Review the details and confirm the amount paid.
                  </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                  <div className="space-y-2">
                      <Label htmlFor="dialog-emi">EMI Amount</Label>
                      <Input id="dialog-emi" type="text" value={formatCurrency(dialogPrincipal + dialogInterest)} readOnly className="font-semibold" />
                  </div>
                   <div className="space-y-2">
                      <Label htmlFor="dialog-principal">Principal</Label>
                      <Input id="dialog-principal" type="number" value={dialogPrincipal} onChange={(e) => setDialogPrincipal(Number(e.target.value) || 0)} />
                  </div>
                   <div className="space-y-2">
                      <Label htmlFor="dialog-interest">Interest</Label>
                      <Input id="dialog-interest" type="number" value={dialogInterest} onChange={(e) => setDialogInterest(Number(e.target.value) || 0)} />
                  </div>
                  <div className="space-y-2 pt-4">
                      <Label htmlFor="paidAmount" className="text-lg">Paid Amount</Label>
                      <Input
                        id="paidAmount"
                        type="number"
                        value={dialogPaidAmount}
                        onChange={(e) => setDialogPaidAmount(parseFloat(e.target.value) || 0)}
                        className="text-lg font-bold h-12"
                      />
                  </div>
              </div>
              <DialogFooter>
                  <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
                  <Button onClick={handleConfirmPayment} disabled={isConfirmingPayment}>
                    {isConfirmingPayment && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {selectedEmi?.status === 'Paid' ? 'Save Changes' : 'Confirm Payment'}
                  </Button>
              </DialogFooter>
          </DialogContent>
      </Dialog>
    </>
  );
}
