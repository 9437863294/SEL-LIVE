
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Save, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, addDoc, writeBatch, doc, Timestamp } from 'firebase/firestore';
import type { Loan, EMI } from '@/lib/types';
import { addMonths, format } from 'date-fns';

const initialLoanState = {
  accountNo: '',
  lenderName: '',
  loanAmount: '',
  tenure: '',
  interestRate: '',
  startDate: '',
  linkedBank: '',
  loanType: 'Loan' as 'Loan' | 'Investment',
};

type ScheduleEntry = Omit<EMI, 'id' | 'loanId'>;

export default function NewLoanPage() {
  const { toast } = useToast();
  const [loan, setLoan] = useState(initialLoanState);
  const [isSaving, setIsSaving] = useState(false);
  const [calculatedEmi, setCalculatedEmi] = useState<number | null>(null);
  const [emiSchedule, setEmiSchedule] = useState<ScheduleEntry[]>([]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setLoan(prev => ({ ...prev, [name]: value }));
    setEmiSchedule([]); // Reset schedule if loan details change
    setCalculatedEmi(null);
  };

  const generateSchedule = () => {
    const p = parseFloat(loan.loanAmount);
    const r = parseFloat(loan.interestRate) / 12 / 100;
    const n = parseFloat(loan.tenure);

    if (p > 0 && r > 0 && n > 0 && loan.startDate) {
      const emiAmount = (p * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
      setCalculatedEmi(emiAmount);

      const schedule: ScheduleEntry[] = [];
      let balance = p;
      for (let i = 1; i <= n; i++) {
        const interest = balance * r;
        const principal = emiAmount - interest;
        balance -= principal;

        schedule.push({
          emiNo: i,
          dueDate: Timestamp.fromDate(addMonths(new Date(loan.startDate), i)),
          emiAmount: emiAmount,
          principal: principal,
          interest: interest,
          paidAmount: 0,
          closingPrincipal: balance,
          status: 'Pending',
        });
      }
      setEmiSchedule(schedule);
    } else {
      toast({ title: "Missing Details", description: "Please fill in Loan Amount, Tenure, Interest Rate, and Start Date.", variant: "destructive" });
      setCalculatedEmi(null);
      setEmiSchedule([]);
    }
  };

  const handleEmiAmountChange = (index: number, newEmiAmount: number) => {
    const newSchedule = [...emiSchedule];
    const item = newSchedule[index];
    const monthlyRate = parseFloat(loan.interestRate) / 12 / 100;
    
    // Determine the opening balance for this specific EMI
    const openingBalance = index === 0 
      ? parseFloat(loan.loanAmount) 
      : newSchedule[index - 1].closingPrincipal;
      
    item.emiAmount = newEmiAmount;
    item.interest = openingBalance * monthlyRate;
    item.principal = newEmiAmount - item.interest;
    item.closingPrincipal = openingBalance - item.principal;
    
    // Recalculate subsequent EMIs
    for (let i = index + 1; i < newSchedule.length; i++) {
      const prevClosingPrincipal = newSchedule[i - 1].closingPrincipal;
      const currentItem = newSchedule[i];
      currentItem.interest = prevClosingPrincipal * monthlyRate;
      // Keep subsequent EMI amounts the same unless logic dictates otherwise
      currentItem.principal = currentItem.emiAmount - currentItem.interest;
      currentItem.closingPrincipal = prevClosingPrincipal - currentItem.principal;
    }
    
    setEmiSchedule(newSchedule);
  };


  const handleSave = async () => {
    if (emiSchedule.length === 0) {
        toast({ title: "Validation Error", description: "Please generate the EMI schedule before saving.", variant: "destructive" });
        return;
    }
    
    setIsSaving(true);
    
    const { loanAmount, tenure, interestRate, startDate, ...rest } = loan;

    const newLoanData: Omit<Loan, 'id'> = {
      ...rest,
      loanAmount: parseFloat(loanAmount),
      tenure: parseInt(tenure, 10),
      interestRate: parseFloat(interestRate),
      emiAmount: calculatedEmi || 0, // Store original calculated EMI
      startDate: startDate,
      endDate: format(addMonths(new Date(startDate), parseInt(tenure, 10)), 'yyyy-MM-dd'),
      totalPaid: 0,
      status: 'Active',
      createdAt: Timestamp.now(),
    };
    
    try {
        const loanCollection = collection(db, 'loans');
        const loanDocRef = await addDoc(loanCollection, newLoanData);

        const emiCollectionRef = collection(db, 'loans', loanDocRef.id, 'emis');
        const batch = writeBatch(db);

        emiSchedule.forEach(emiData => {
            const emiDocRef = doc(emiCollectionRef);
            batch.set(emiDocRef, emiData);
        });
        
        await batch.commit();

        toast({ title: "Success", description: "New loan and its EMI schedule have been created." });
        setLoan(initialLoanState);
        setCalculatedEmi(null);
        setEmiSchedule([]);

    } catch (error) {
        console.error("Error creating loan:", error);
        toast({ title: "Error", description: "Failed to create new loan.", variant: "destructive" });
    }
    setIsSaving(false);
  };
  
  const formatCurrency = (amount: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);
  const formatDate = (date: any) => format(date.toDate(), 'dd MMM, yyyy');


  return (
    <div className="w-full px-4 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/loan">
            <Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button>
          </Link>
          <h1 className="text-2xl font-bold">Add New Loan</h1>
        </div>
        <Button onClick={handleSave} disabled={isSaving || emiSchedule.length === 0}>
          {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Save Loan
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Loan Details</CardTitle>
          <CardDescription>Enter the details of the new loan.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div className="space-y-2"><Label htmlFor="accountNo">Account No</Label><Input id="accountNo" name="accountNo" value={loan.accountNo} onChange={handleInputChange} /></div>
            <div className="space-y-2"><Label htmlFor="lenderName">Lender Name</Label><Input id="lenderName" name="lenderName" value={loan.lenderName} onChange={handleInputChange} /></div>
            <div className="space-y-2"><Label htmlFor="loanAmount">Loan Amount</Label><Input id="loanAmount" name="loanAmount" type="number" value={loan.loanAmount} onChange={handleInputChange} /></div>
            <div className="space-y-2"><Label htmlFor="tenure">Tenure (months)</Label><Input id="tenure" name="tenure" type="number" value={loan.tenure} onChange={handleInputChange} /></div>
            <div className="space-y-2"><Label htmlFor="interestRate">Interest Rate (%)</Label><Input id="interestRate" name="interestRate" type="number" value={loan.interestRate} onChange={handleInputChange} /></div>
            <div className="space-y-2"><Label htmlFor="startDate">Start Date</Label><Input id="startDate" name="startDate" type="date" value={loan.startDate} onChange={handleInputChange} /></div>
            <div className="space-y-2"><Label htmlFor="linkedBank">Linked Bank</Label><Input id="linkedBank" name="linkedBank" value={loan.linkedBank} onChange={handleInputChange} /></div>
            <div className="space-y-2"><Label htmlFor="loanType">Loan Type</Label><Select name="loanType" value={loan.loanType} onValueChange={(v: 'Loan' | 'Investment') => setLoan(prev => ({...prev, loanType: v}))}><SelectTrigger id="loanType"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="Loan">Loan</SelectItem><SelectItem value="Investment">Investment</SelectItem></SelectContent></Select></div>
          </div>
          <div className="pt-6 flex items-end gap-4">
             <Button onClick={generateSchedule} variant="outline">
                <RefreshCw className="mr-2 h-4 w-4" /> Generate Repayment Schedule
             </Button>
            {calculatedEmi !== null && (
                <div className="text-left">
                    <p className="text-sm text-muted-foreground">Calculated EMI Amount</p>
                    <p className="text-2xl font-bold">
                       {formatCurrency(calculatedEmi)}
                    </p>
                </div>
            )}
          </div>
        </CardContent>
      </Card>
      
      {emiSchedule.length > 0 && (
        <Card className="mt-6">
            <CardHeader><CardTitle>Repayment Schedule</CardTitle></CardHeader>
            <CardContent>
                 <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>EMI No.</TableHead>
                            <TableHead>Due Date</TableHead>
                            <TableHead>EMI Amount</TableHead>
                            <TableHead>Principal</TableHead>
                            <TableHead>Interest</TableHead>
                            <TableHead>Closing Principal</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {emiSchedule.map((emi, index) => (
                            <TableRow key={emi.emiNo}>
                                <TableCell>{emi.emiNo}</TableCell>
                                <TableCell>{formatDate(emi.dueDate)}</TableCell>
                                <TableCell>
                                     <Input 
                                        type="number" 
                                        value={emi.emiAmount.toFixed(2)}
                                        onChange={(e) => handleEmiAmountChange(index, parseFloat(e.target.value) || 0)}
                                        className="w-32"
                                     />
                                </TableCell>
                                <TableCell>{formatCurrency(emi.principal)}</TableCell>
                                <TableCell>{formatCurrency(emi.interest)}</TableCell>
                                <TableCell>{formatCurrency(emi.closingPrincipal)}</TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </CardContent>
        </Card>
      )}
    </div>
  );
}
