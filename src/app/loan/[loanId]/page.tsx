

'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Loader2, CheckCircle, Clock, Edit, Save, X, RefreshCw, Eye, FilePlus, RotateCcw, MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { doc, getDoc, collection, getDocs, updateDoc, writeBatch, Timestamp, query, where, runTransaction } from 'firebase/firestore';
import type { Loan, EMI, AccountHead, SubAccountHead, Department, SerialNumberConfig, ExpenseRequest } from '@/lib/types';
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
import { useAuth } from '@/components/auth/AuthProvider';
import { createExpenseRequest } from '@/ai';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

export default function LoanDetailsPage({ params }: { params: { loanId: string } }) {
  const { loanId } = params;
  const { toast } = useToast();
  const router = useRouter();
  const { user, users } = useAuth();
  const [loan, setLoan] = useState<Loan | null>(null);
  const [emis, setEmis] = useState<EMI[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [accountHeads, setAccountHeads] = useState<AccountHead[]>([]);
  const [subAccountHeads, setSubAccountHeads] = useState<SubAccountHead[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [expenseRequests, setExpenseRequests] = useState<ExpenseRequest[]>([]);


  const [isPayDialogOpen, setIsPayDialogOpen] = useState(false);
  const [isViewDetailsOpen, setIsViewDetailsOpen] = useState(false);
  const [isConfirmExpenseOpen, setIsConfirmExpenseOpen] = useState(false);
  const [expenseToCreate, setExpenseToCreate] = useState<any>(null);

  const [selectedEmi, setSelectedEmi] = useState<EMI | null>(null);
  const [dialogPaidAmount, setDialogPaidAmount] = useState(0);
  const [dialogPrincipal, setDialogPrincipal] = useState(0);
  const [dialogInterest, setDialogInterest] = useState(0);
  const [isConfirmingPayment, setIsConfirmingPayment] = useState(false);
  
  const [isEditing, setIsEditing] = useState(false);
  const [editedLoan, setEditedLoan] = useState<Loan | null>(null);
  const [regeneratedEmis, setRegeneratedEmis] = useState<EMI[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isCreatingExpense, setIsCreatingExpense] = useState(false);
  const [isUpdatingEmi, setIsUpdatingEmi] = useState<string | null>(null);


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

      const headsSnap = await getDocs(collection(db, 'accountHeads'));
      setAccountHeads(headsSnap.docs.map(d => ({id: d.id, ...d.data()} as AccountHead)));
      
      const subHeadsSnap = await getDocs(collection(db, 'subAccountHeads'));
      setSubAccountHeads(subHeadsSnap.docs.map(d => ({id: d.id, ...d.data()} as SubAccountHead)));

      const deptsSnap = await getDocs(collection(db, 'departments'));
      setDepartments(deptsSnap.docs.map(d => ({id: d.id, ...d.data()} as Department)));
      
      const expenseReqsSnap = await getDocs(collection(db, 'expenseRequests'));
      setExpenseRequests(expenseReqsSnap.docs.map(doc => doc.data() as ExpenseRequest));


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
    if (emi.expenseRequestNo) {
        toast({
            title: "Cannot Edit",
            description: "This EMI is linked to an expense request and cannot be edited.",
            variant: "destructive"
        });
        return;
    }
    setSelectedEmi(emi);
    setDialogPaidAmount(emi.paidAmount);
    setDialogPrincipal(emi.principal);
    setDialogInterest(emi.interest);
    setIsPayDialogOpen(true);
  };

  const handleViewDetailsClick = (emi: EMI) => {
    setSelectedEmi(emi);
    setIsViewDetailsOpen(true);
  }

  const handleConfirmPayment = async () => {
    if(!loan || !selectedEmi || !user) return;
    
    setIsConfirmingPayment(true);
    try {
        const emiDocRef = doc(db, 'loans', loanId, 'emis', selectedEmi.id);
        const loanDocRef = doc(db, 'loans', loanId);

        await runTransaction(db, async (transaction) => {
            const loanDoc = await transaction.get(loanDocRef);
            if (!loanDoc.exists()) {
                throw "Loan document does not exist!";
            }
            
            const currentLoanData = loanDoc.data() as Loan;
            const originalEmi = emis.find(e => e.id === selectedEmi.id);
            const paidAmountDifference = dialogPaidAmount - (originalEmi?.paidAmount || 0);
            
            transaction.update(emiDocRef, { 
                status: 'Paid',
                paidAmount: dialogPaidAmount,
                principal: dialogPrincipal,
                interest: dialogInterest,
                emiAmount: dialogPrincipal + dialogInterest,
                paidAt: Timestamp.now(),
                paidById: user.id,
            });

            transaction.update(loanDocRef, { totalPaid: currentLoanData.totalPaid + paidAmountDifference });
        });

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

  const handleMarkAsUnpaid = async (emi: EMI) => {
    if (!loan) return;
    setIsUpdatingEmi(emi.id);
    try {
        const emiDocRef = doc(db, 'loans', emi.loan.id, 'emis', emi.id);
        const loanDocRef = doc(db, 'loans', emi.loan.id);

        await runTransaction(db, async (transaction) => {
            const loanDoc = await transaction.get(loanDocRef);
            const emiDoc = await transaction.get(emiDocRef);

            if (!loanDoc.exists() || !emiDoc.exists()) {
                throw "Loan or EMI document does not exist!";
            }
            const currentLoanData = loanDoc.data() as Loan;
            const currentEmiData = emiDoc.data() as EMI;
            
            const amountToReverse = currentEmiData.paidAmount || 0;

            transaction.update(emiDocRef, {
                status: 'Pending',
                paidAmount: 0,
                paidAt: null,
                paidById: null,
                expenseRequestNo: null,
            });

            transaction.update(loanDocRef, {
                totalPaid: currentLoanData.totalPaid - amountToReverse,
            });
        });

        toast({ title: 'Success', description: 'EMI has been marked as unpaid.' });
        if (isViewDetailsOpen) setIsViewDetailsOpen(false);
        fetchLoanData();
    } catch (error) {
        console.error("Error marking as unpaid:", error);
        toast({ title: 'Error', description: 'Could not update EMI status.', variant: 'destructive' });
    } finally {
        setIsUpdatingEmi(null);
    }
  };


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
        for (let i = 0; i < n; i++) {
            const interest = round(balance * r);
            let principal = round(emiAmount - interest);

            if (i === n - 1) {
                principal = balance;
            } else if (principal > balance) {
                principal = balance;
            }
            
            balance = round(balance - principal);

            schedule.push({
                id: `temp-${i + 1}`, // Temporary ID
                loanId: loanId,
                emiNo: i + 1,
                dueDate: Timestamp.fromDate(addMonths(new Date(editedLoan.startDate), i)),
                emiAmount: i === n - 1 ? round(principal + interest) : emiAmount,
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

    const openCreateExpenseDialog = async (emi: EMI) => {
        if (!loan) return;
        const emiMonth = format(emi.dueDate.toDate(), 'MMMM yyyy');
        const financeDept = departments.find(d => d.name.toLowerCase() === 'finance');
        if (!financeDept) {
            toast({ title: "Configuration Error", description: "Finance department not found.", variant: "destructive" });
            return;
        }

        const unsecuredLoanSubHead = subAccountHeads.find(sh => sh.name.toLowerCase() === 'unsecured loan');
        const defaultHead = unsecuredLoanSubHead ? accountHeads.find(h => h.id === unsecuredLoanSubHead.headId)?.name : 'Liability';
        
        let previewRequestNo = 'Generating...';
        try {
            const configRef = doc(db, 'departmentSerialConfigs', financeDept.id);
            const configDoc = await getDoc(configRef);
            if (configDoc.exists()) {
                const configData = configDoc.data() as SerialNumberConfig;
                const newIndex = configData.startingIndex;
                const formattedIndex = String(newIndex).padStart(4, '0');
                previewRequestNo = `${configData.prefix || ''}${configData.format || ''}${formattedIndex}${configData.suffix || ''}`;
            } else {
                previewRequestNo = 'Config not found';
            }
        } catch (error) {
            previewRequestNo = 'Error generating ID';
        }

        const expensePayload = {
            departmentId: financeDept.id,
            projectId: 'zSOFw2y3jwYStbA3EaL1', // Hardcoded HEAD OFFICE project
            amount: emi.paidAmount,
            partyName: loan.lenderName,
            description: `Being EMI paid to ${loan.lenderName} for A/c no ${loan.accountNo} for ${emiMonth} EMI No. ${emi.emiNo}`,
            headOfAccount: defaultHead,
            subHeadOfAccount: unsecuredLoanSubHead?.name || 'Unsecured Loan',
            remarks: `Auto-generated from Loan EMI payment`,
            requestNo: previewRequestNo,
        };
        setExpenseToCreate(expensePayload);
        setSelectedEmi(emi);
        setIsConfirmExpenseOpen(true);
    };

    const handleConfirmCreateExpense = async () => {
        if (!expenseToCreate || !selectedEmi) return;
        setIsCreatingExpense(true);
        try {
            const { requestNo, ...dataToSave } = expenseToCreate;

            const result = await createExpenseRequest(dataToSave);
            if (result.success && result.requestNo) {
                const emiRef = doc(db, 'loans', loanId, 'emis', selectedEmi.id);
                await updateDoc(emiRef, { expenseRequestNo: result.requestNo });

                toast({
                    title: 'Expense Record Created',
                    description: `Request No: ${result.requestNo}`,
                });
                fetchLoanData();
            } else {
                throw new Error(result.message);
            }
        } catch (error: any) {
            toast({
                title: 'Error',
                description: `Failed to create expense record: ${error.message}`,
                variant: 'destructive',
            });
        } finally {
            setIsCreatingExpense(false);
            setIsConfirmExpenseOpen(false);
            setExpenseToCreate(null);
            setSelectedEmi(null);
        }
    };


  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(round(amount));
  };

  const formatAsCurrency = (value: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };
  
  const parseCurrency = (value: string): number => {
    return Number(value.replace(/[^0-9.-]+/g, ''));
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

  const handleSubHeadChange = (subHeadName: string) => {
    if(!expenseToCreate) return;
    const selectedSubHead = subAccountHeads.find(sh => sh.name === subHeadName);
    const parentHead = accountHeads.find(h => h.id === selectedSubHead?.headId);
  
    setExpenseToCreate({
      ...expenseToCreate,
      subHeadOfAccount: subHeadName,
      headOfAccount: parentHead ? parentHead.name : '',
    });
  };

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
            <CardContent className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
              <div className="space-y-1"><Label>Loan Amount</Label>{isEditing ? <Input type="number" value={editedLoan.loanAmount} onChange={e => setEditedLoan({...editedLoan, loanAmount: Number(e.target.value)})} /> : <p className="font-semibold">{formatCurrency(loan.loanAmount)}</p>}</div>
              <div className="space-y-1"><Label>Interest Rate</Label>{isEditing ? <Input type="number" value={editedLoan.interestRate} onChange={e => setEditedLoan({...editedLoan, interestRate: Number(e.target.value)})} /> : <p className="font-semibold">{loan.interestRate}%</p>}</div>
              <div className="space-y-1"><Label>Tenure (months)</Label>{isEditing ? <Input type="number" value={editedLoan.tenure} onChange={e => setEditedLoan({...editedLoan, tenure: Number(e.target.value)})} /> : <p className="font-semibold">{loan.tenure} months</p>}</div>
              <div className="space-y-1"><Label>Start Date</Label>{isEditing ? <Input type="date" value={editedLoan.startDate} onChange={e => setEditedLoan({...editedLoan, startDate: e.target.value})} /> : <p className="font-semibold">{formatDate(loan.startDate)}</p>}</div>
              <div className="space-y-1"><Label>Linked Bank</Label><p className="font-semibold">{loan.linkedBank || 'N/A'}</p></div>
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
                            <DropdownMenu>
                               <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
                               </DropdownMenuTrigger>
                               <DropdownMenuContent align="end">
                                  <DropdownMenuItem onSelect={() => handleViewDetailsClick(emi)}><Eye className="mr-2 h-4 w-4" />View Details</DropdownMenuItem>
                                  <TooltipProvider>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <div className="w-full">
                                                <DropdownMenuItem onSelect={(e) => { e.stopPropagation(); handleEditEmiClick(emi); }} disabled={!!emi.expenseRequestNo}>
                                                    <Edit className="mr-2 h-4 w-4" />Edit Payment
                                                </DropdownMenuItem>
                                            </div>
                                        </TooltipTrigger>
                                        {!!emi.expenseRequestNo && (
                                            <TooltipContent>
                                                <p>Cannot edit. Expense request has been generated.</p>
                                            </TooltipContent>
                                        )}
                                    </Tooltip>
                                  </TooltipProvider>
                                  <DropdownMenuItem onSelect={() => openCreateExpenseDialog(emi)} disabled={!!emi.expenseRequestNo}>
                                    <FilePlus className="mr-2 h-4 w-4" /> Create Expense
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onSelect={() => handleMarkAsUnpaid(emi)} disabled={isUpdatingEmi === emi.id || !!emi.expenseRequestNo} className="text-destructive">
                                    <RotateCcw className="mr-2 h-4 w-4" />Mark as Unpaid
                                  </DropdownMenuItem>
                               </DropdownMenuContent>
                            </DropdownMenu>
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
        <DialogContent className="sm:max-w-md text-left">
            <DialogHeader>
                <DialogTitle>{selectedEmi?.status === 'Paid' ? 'Edit' : 'Confirm'} Payment for EMI #{selectedEmi?.emiNo}</DialogTitle>
                <DialogDescription>
                    Review the details and confirm the amount paid.
                </DialogDescription>
            </DialogHeader>
             <div className="space-y-4 py-4">
                <div className="space-y-2">
                    <Label htmlFor="dialog-emi">EMI Amount</Label>
                    <Input id="dialog-emi" type="text" value={formatCurrency(dialogPrincipal + dialogInterest)} readOnly className="font-semibold text-left" />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="dialog-principal">Principal</Label>
                    <Input id="dialog-principal" type="text" value={formatAsCurrency(dialogPrincipal)} onChange={(e) => setDialogPrincipal(parseCurrency(e.target.value))} className="text-left" />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="dialog-interest">Interest</Label>
                    <Input id="dialog-interest" type="text" value={formatAsCurrency(dialogInterest)} onChange={(e) => setDialogInterest(parseCurrency(e.target.value))} className="text-left" />
                </div>
                <div className="space-y-2 pt-4">
                    <Label htmlFor="paidAmount" className="text-lg">Paid Amount</Label>
                    <Input
                      id="paidAmount"
                      type="text"
                      value={formatAsCurrency(dialogPaidAmount)}
                      onChange={(e) => setDialogPaidAmount(parseCurrency(e.target.value))}
                      className="text-lg font-bold h-12 text-left"
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
      
      {selectedEmi && isViewDetailsOpen && (
        <Dialog open={isViewDetailsOpen} onOpenChange={setIsViewDetailsOpen}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Payment Details for EMI #{selectedEmi.emiNo}</DialogTitle>
                </DialogHeader>
                <Table>
                  <TableBody>
                    <TableRow>
                      <TableCell className="font-medium">Mark as Paid By</TableCell>
                      <TableCell>{users.find(u => u.id === selectedEmi.paidById)?.name || 'N/A'}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-medium">Paid On</TableCell>
                      <TableCell>{selectedEmi.paidAt ? formatDate(selectedEmi.paidAt) : 'N/A'}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-medium">Paid Amount</TableCell>
                      <TableCell>{formatCurrency(selectedEmi.paidAmount)}</TableCell>
                    </TableRow>
                     <TableRow>
                      <TableCell className="font-medium">Principal</TableCell>
                      <TableCell>{formatCurrency(selectedEmi.principal)}</TableCell>
                    </TableRow>
                     <TableRow>
                      <TableCell className="font-medium">Interest</TableCell>
                      <TableCell>{formatCurrency(selectedEmi.interest)}</TableCell>
                    </TableRow>
                    {selectedEmi.expenseRequestNo && (
                      <TableRow>
                        <TableCell className="font-medium">Expense Request</TableCell>
                        <TableCell>{selectedEmi.expenseRequestNo}</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
                <DialogFooter>
                    <Button variant="secondary" onClick={() => openCreateExpenseDialog(selectedEmi)} disabled={isCreatingExpense || !!selectedEmi.expenseRequestNo}>
                      {isCreatingExpense && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      <FilePlus className="mr-2 h-4 w-4" />
                      Create Expense
                    </Button>
                    <DialogClose asChild>
                        <Button>Close</Button>
                    </DialogClose>
                </DialogFooter>
            </DialogContent>
        </Dialog>
      )}

      {expenseToCreate && (
        <Dialog open={isConfirmExpenseOpen} onOpenChange={setIsConfirmExpenseOpen}>
          <DialogContent>
              <DialogHeader>
                  <DialogTitle>Confirm Expense Creation</DialogTitle>
                  <DialogDescription>Review and edit the details below before creating the expense request.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                        <Label>Request No.</Label>
                        <Input value={expenseToCreate.requestNo} disabled />
                    </div>
                    <div className="space-y-1">
                        <Label>Project</Label>
                        <Input value="HEAD OFFICE" disabled />
                    </div>
                  </div>
                   <div className="space-y-1">
                      <Label>Party Name</Label>
                      <Input value={expenseToCreate.partyName} onChange={(e) => setExpenseToCreate({...expenseToCreate, partyName: e.target.value})} />
                  </div>
                  <div className="space-y-1">
                      <Label>Amount</Label>
                      <Input
                        type="text"
                        value={expenseToCreate.amount ? formatAsCurrency(expenseToCreate.amount) : ''}
                        onChange={(e) => {
                          const numericValue = parseCurrency(e.target.value);
                          setExpenseToCreate({...expenseToCreate, amount: numericValue });
                        }}
                      />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                        <Label>Head of A/c</Label>
                         <Select value={expenseToCreate.headOfAccount} onValueChange={(value) => setExpenseToCreate({...expenseToCreate, headOfAccount: value })} disabled>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                             <SelectContent>
                                {accountHeads.map(h => <SelectItem key={h.id} value={h.name}>{h.name}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-1">
                        <Label>Sub-Head of A/c</Label>
                         <Select value={expenseToCreate.subHeadOfAccount} onValueChange={handleSubHeadChange}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>{subAccountHeads.map(s => <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>)}</SelectContent>
                        </Select>
                    </div>
                  </div>
                  <div className="space-y-1">
                      <Label>Description:</Label>
                      <Textarea value={expenseToCreate.description} onChange={(e) => setExpenseToCreate({...expenseToCreate, description: e.target.value})} />
                  </div>
              </div>
              <DialogFooter>
                  <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
                  <Button onClick={handleConfirmCreateExpense} disabled={isCreatingExpense}>
                      {isCreatingExpense && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Confirm & Create
                  </Button>
              </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
