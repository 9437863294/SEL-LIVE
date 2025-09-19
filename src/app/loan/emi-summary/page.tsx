
'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, CheckCircle, Clock, Edit, Save, X, RefreshCw, Eye, FilePlus, RotateCcw, MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, doc, updateDoc, runTransaction, Timestamp, getDoc } from 'firebase/firestore';
import type { Loan, EMI, AccountHead, SubAccountHead, Department, ExpenseRequest, User } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { format, getYear, getMonth, eachYearOfInterval, startOfYear, endOfYear } from 'date-fns';
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

interface EnrichedEmi extends EMI {
  loan: Loan;
}

export default function EmiSummaryPage() {
  const { toast } = useToast();
  const { user, users } = useAuth();
  const [allEmis, setAllEmis] = useState<EnrichedEmi[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  const currentMonth = new Date().toLocaleString('default', { month: 'long' });
  const currentYear = getYear(new Date()).toString();

  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const [selectedYear, setSelectedYear] = useState(currentYear);
  
  const [accountHeads, setAccountHeads] = useState<AccountHead[]>([]);
  const [subAccountHeads, setSubAccountHeads] = useState<SubAccountHead[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);

  const [isPayDialogOpen, setIsPayDialogOpen] = useState(false);
  const [isViewDetailsOpen, setIsViewDetailsOpen] = useState(false);
  const [selectedEmi, setSelectedEmi] = useState<EnrichedEmi | null>(null);
  const [dialogPaidAmount, setDialogPaidAmount] = useState(0);
  const [dialogPrincipal, setDialogPrincipal] = useState(0);
  const [dialogInterest, setDialogInterest] = useState(0);
  const [isConfirmingPayment, setIsConfirmingPayment] = useState(false);
  
  const [isConfirmExpenseOpen, setIsConfirmExpenseOpen] = useState(false);
  const [expenseToCreate, setExpenseToCreate] = useState<any>(null);
  const [isCreatingExpense, setIsCreatingExpense] = useState(false);
  const [isUpdatingEmi, setIsUpdatingEmi] = useState<string | null>(null);
  

  const fetchAllData = async () => {
    setIsLoading(true);
    try {
      const [loansSnapshot, headsSnap, subHeadsSnap, deptsSnap] = await Promise.all([
          getDocs(collection(db, 'loans')),
          getDocs(collection(db, 'accountHeads')),
          getDocs(collection(db, 'subAccountHeads')),
          getDocs(collection(db, 'departments'))
      ]);

      setAccountHeads(headsSnap.docs.map(d => ({id: d.id, ...d.data()} as AccountHead)));
      setSubAccountHeads(subHeadsSnap.docs.map(d => ({id: d.id, ...d.data()} as SubAccountHead)));
      setDepartments(deptsSnap.docs.map(d => ({id: d.id, ...d.data()} as Department)));

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

  useEffect(() => {
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
      const totalPaid = filteredEmis.filter(emi => emi.status === 'Paid').reduce((sum, emi) => sum + emi.paidAmount, 0);
      return { thisMonthDue, totalPaid };
  }, [filteredEmis]);
  
  const handleMarkAsPaidClick = (emi: EnrichedEmi) => {
    setSelectedEmi(emi);
    setDialogPaidAmount(emi.paidAmount > 0 ? emi.paidAmount : emi.emiAmount);
    setDialogPrincipal(emi.principal);
    setDialogInterest(emi.interest);
    setIsPayDialogOpen(true);
  };

  const handleConfirmPayment = async () => {
    if(!selectedEmi || !user) return;
    
    setIsConfirmingPayment(true);
    try {
        const emiDocRef = doc(db, 'loans', selectedEmi.loan.id, 'emis', selectedEmi.id);
        const loanDocRef = doc(db, 'loans', selectedEmi.loan.id);

        await runTransaction(db, async (transaction) => {
            const loanDoc = await transaction.get(loanDocRef);
            if (!loanDoc.exists()) {
                throw "Loan document does not exist!";
            }
            
            const currentLoanData = loanDoc.data() as Loan;
            const originalEmi = allEmis.find(e => e.id === selectedEmi.id);
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
        fetchAllData();
        setIsPayDialogOpen(false);
        setSelectedEmi(null);
    } catch (error) {
        console.error("Error confirming payment:", error);
        toast({ title: "Error", description: "Failed to update EMI status.", variant: "destructive" });
    } finally {
        setIsConfirmingPayment(false);
    }
  }

  const handleMarkAsUnpaid = async (emi: EnrichedEmi) => {
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
        fetchAllData();
    } catch (error) {
        console.error("Error marking as unpaid:", error);
        toast({ title: 'Error', description: 'Could not update EMI status.', variant: 'destructive' });
    } finally {
        setIsUpdatingEmi(null);
    }
  };

  const openCreateExpenseDialog = async (emi: EnrichedEmi) => {
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
                const configData = configDoc.data() as any;
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
            projectId: 'zSOFw2y3jwYStbA3EaL1',
            amount: emi.paidAmount,
            partyName: emi.loan.lenderName,
            description: `Being EMI paid to ${emi.loan.lenderName} for A/c no ${emi.loan.accountNo} for ${emiMonth} EMI No. ${emi.emiNo}`,
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
                const emiRef = doc(db, 'loans', selectedEmi.loan.id, 'emis', selectedEmi.id);
                await updateDoc(emiRef, { expenseRequestNo: result.requestNo });

                toast({
                    title: 'Expense Record Created',
                    description: `Request No: ${result.requestNo}`,
                });
                fetchAllData();
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

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);
  };
  
  const formatDate = (date: any) => {
    if (!date) return 'N/A';
    return format(date.toDate ? date.toDate() : new Date(date), 'dd/MM/yyyy');
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

  return (
    <>
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/loan">
              <Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button>
            </Link>
            <h1 className="text-2xl font-bold">Monthly EMI</h1>
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
           <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Total Paid</CardTitle></CardHeader>
              <CardContent><p className="text-xl font-bold">{formatCurrency(summary.totalPaid)}</p></CardContent>
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
                  <TableHead>Lender</TableHead>
                  <TableHead>Due Date</TableHead>
                  <TableHead>EMI Amount</TableHead>
                  <TableHead>Principal</TableHead>
                  <TableHead>Interest</TableHead>
                  <TableHead>Paid Amount</TableHead>
                  <TableHead>EMI No</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
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
                      <TableCell>{formatDate(emi.dueDate)}</TableCell>
                      <TableCell>{formatCurrency(emi.emiAmount)}</TableCell>
                      <TableCell>{formatCurrency(emi.principal)}</TableCell>
                      <TableCell>{formatCurrency(emi.interest)}</TableCell>
                      <TableCell>{formatCurrency(emi.paidAmount)}</TableCell>
                      <TableCell>{emi.emiNo}</TableCell>
                      <TableCell className="text-right">
                          {emi.status === 'Pending' ? (
                            <Button size="sm" onClick={() => handleMarkAsPaidClick(emi)}>Mark as Paid</Button>
                          ) : (
                             <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                    <DropdownMenuItem onSelect={() => { setSelectedEmi(emi); setIsViewDetailsOpen(true); }}>
                                        <Eye className="mr-2 h-4 w-4" /> View
                                    </DropdownMenuItem>
                                     <DropdownMenuItem onSelect={() => handleMarkAsPaidClick(emi)}>
                                        <Edit className="mr-2 h-4 w-4" /> Edit Payment
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onSelect={() => openCreateExpenseDialog(emi)} disabled={!!emi.expenseRequestNo}>
                                        <FilePlus className="mr-2 h-4 w-4" /> Create Expense
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onSelect={() => handleMarkAsUnpaid(emi)} disabled={isUpdatingEmi === emi.id} className="text-destructive">
                                        <RotateCcw className="mr-2 h-4 w-4" /> Mark as Unpaid
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                             </DropdownMenu>
                          )}
                      </TableCell>
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
             <div className="space-y-4 py-4 text-left">
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
                    <DialogClose asChild><Button>Close</Button></DialogClose>
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
