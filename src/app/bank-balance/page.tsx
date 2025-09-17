
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Home, Banknote, Plus, Settings, DollarSign, Scale, ArrowDown, ArrowUp, ArrowRightLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs } from 'firebase/firestore';
import type { BankAccount } from '@/lib/types';
import { useAuthorization } from '@/hooks/useAuthorization';
import { format } from 'date-fns';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose, DialogDescription } from '@/components/ui/dialog';

export default function BankBalanceDashboard() {
    const { toast } = useToast();
    const { can, isLoading: authLoading } = useAuthorization();
    const [accounts, setAccounts] = useState<BankAccount[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isDailyEntryOpen, setIsDailyEntryOpen] = useState(false);

    const canView = can('View Module', 'Bank Balance');

    useEffect(() => {
        if (!canView) {
            setIsLoading(false);
            return;
        };

        const fetchAccounts = async () => {
            setIsLoading(true);
            try {
                const querySnapshot = await getDocs(collection(db, 'bankAccounts'));
                const accountsData = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as BankAccount));
                setAccounts(accountsData);
            } catch (error) {
                console.error("Error fetching bank accounts:", error);
                toast({ title: "Error", description: "Failed to fetch bank accounts.", variant: "destructive" });
            }
            setIsLoading(false);
        };
        
        fetchAccounts();
    }, [canView, toast]);
    
    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 }).format(amount);
    };

    const totalDrawingPower = accounts
        .filter(acc => acc.accountType === 'Cash Credit')
        .reduce((sum, acc) => sum + (acc.drawingPower || 0), 0);

    const totalClosingUtilization = accounts.reduce((sum, acc) => sum + acc.currentBalance, 0);

    const availableFund = totalDrawingPower - totalClosingUtilization;

    if (authLoading || (isLoading && canView)) {
        return (
            <div className="w-full px-4 sm:px-6 lg:px-8">
                <Skeleton className="h-10 w-80 mb-6" />
                <Skeleton className="h-48 mb-6" />
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    <Skeleton className="h-48" />
                    <Skeleton className="h-48" />
                    <Skeleton className="h-48" />
                </div>
            </div>
        );
    }
    
    if (!canView) {
        return <div className="p-4">Access Denied</div>;
    }

    return (
        <>
            <div className="w-full px-4 sm:px-6 lg:px-8">
                <div className="mb-6 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Link href="/"><Button variant="ghost" size="icon"><Home className="h-6 w-6" /></Button></Link>
                        <h1 className="text-2xl font-bold">Bank Balance Dashboard</h1>
                    </div>
                     <div className="flex items-center gap-2">
                        <Button onClick={() => setIsDailyEntryOpen(true)}>
                            <Plus className="mr-2 h-4 w-4"/>
                            Daily Entry
                        </Button>
                        <Link href="/bank-balance/settings">
                            <Button variant="ghost" size="icon">
                                <Settings className="h-5 w-5"/>
                            </Button>
                        </Link>
                    </div>
                </div>
                
                <Card className="mb-6 bg-blue-50 border-blue-200">
                    <CardHeader>
                        <div className="flex justify-between items-start">
                            <CardTitle className="flex items-center gap-2 text-blue-800"><Banknote />Available Fund</CardTitle>
                        </div>
                         <CardDescription>
                            Available fund as of {format(new Date(), 'MMMM do, yyyy')}. (Today's DP - Today's Closing Utilization)
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="flex justify-between items-end">
                            <div>
                                <p className="text-4xl font-bold text-blue-900">{formatCurrency(availableFund)}</p>
                                <p className="text-sm text-muted-foreground">Total DP: {formatCurrency(totalDrawingPower)}</p>
                            </div>
                             <p className="text-sm text-muted-foreground">Total Closing Utilization: {formatCurrency(totalClosingUtilization)}</p>
                        </div>
                    </CardContent>
                </Card>

                 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {accounts.map(account => {
                        const isCC = account.accountType === 'Cash Credit';
                        const utilization = account.drawingPower ? account.currentBalance : 0;
                        return (
                            <Card key={account.id} className={
                              account.bankName.includes('Punjab') ? 'bg-orange-50 border-orange-200' :
                              account.bankName.includes('State Bank') ? 'bg-blue-50 border-blue-200' : ''
                            }>
                                <CardHeader>
                                    <div className="flex justify-between items-start">
                                        <CardTitle>{account.shortName}</CardTitle>
                                        <Banknote className="h-6 w-6 text-muted-foreground" />
                                    </div>
                                    <CardDescription>
                                        {isCC ? "Today's Available Balance" : "Today's Closing Balance"}
                                    </CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <p className="text-3xl font-bold mb-2">{formatCurrency(account.currentBalance)}</p>
                                    {isCC && (
                                        <div className="flex justify-between text-sm text-muted-foreground">
                                            <span>DP: {formatCurrency(account.drawingPower || 0)}</span>
                                            <span>Utilization: {formatCurrency(utilization)}</span>
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        );
                    })}
                     <Link href="/bank-balance/accounts">
                         <Card className="h-full border-2 border-dashed flex flex-col items-center justify-center text-muted-foreground hover:border-primary hover:text-primary transition-colors">
                            <Plus className="h-8 w-8 mb-2" />
                            <p className="font-medium">Add New Account</p>
                        </Card>
                    </Link>
                </div>
            </div>
            <Dialog open={isDailyEntryOpen} onOpenChange={setIsDailyEntryOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Daily Entry</DialogTitle>
                        <DialogDescription>Select an entry type to proceed.</DialogDescription>
                    </DialogHeader>
                    <div className="grid grid-cols-3 gap-4 pt-4">
                        <Link href="/bank-balance/expenses" onClick={() => setIsDailyEntryOpen(false)}>
                            <Card className="flex flex-col items-center justify-center p-4 cursor-pointer hover:shadow-lg transition-shadow bg-red-50 hover:bg-red-100 border-red-200">
                                <ArrowDown className="h-8 w-8 text-red-600 mb-2" />
                                <p className="font-semibold text-red-800">Expenses</p>
                            </Card>
                        </Link>
                        <Card className="flex flex-col items-center justify-center p-4 cursor-pointer hover:shadow-lg transition-shadow bg-green-50 hover:bg-green-100 border-green-200">
                            <ArrowUp className="h-8 w-8 text-green-600 mb-2" />
                            <p className="font-semibold text-green-800">Receipts</p>
                        </Card>
                        <Card className="flex flex-col items-center justify-center p-4 cursor-pointer hover:shadow-lg transition-shadow bg-blue-50 hover:bg-blue-100 border-blue-200">
                            <ArrowRightLeft className="h-8 w-8 text-blue-600 mb-2" />
                            <p className="font-semibold text-blue-800">Internal Transaction</p>
                        </Card>
                    </div>
                </DialogContent>
            </Dialog>
        </>
    );
}
