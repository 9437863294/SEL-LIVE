
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Home, Banknote, Plus, Settings, DollarSign, Scale, ArrowDown, ArrowUp, ArrowRightLeft, BarChart3, ShieldAlert } from 'lucide-react';
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
import { ScrollArea } from '@/components/ui/scroll-area';

export default function BankBalanceDashboard() {
    const { toast } = useToast();
    const { can, isLoading: authLoading } = useAuthorization();
    const [accounts, setAccounts] = useState<BankAccount[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isDailyEntryOpen, setIsDailyEntryOpen] = useState(false);

    const canView = can('View Module', 'Bank Balance');

    useEffect(() => {
        if (authLoading) return;
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
    }, [canView, toast, authLoading]);
    
    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 }).format(amount);
    };
    
    const getLatestDp = (account: BankAccount) => {
        if (!account.drawingPower || account.drawingPower.length === 0) return 0;
        // The array is sorted on write, so the first element is the latest.
        return account.drawingPower[0].amount || 0;
    };
    
    const { totalDrawingPower, totalCurrentBalance, utilization } = (() => {
        const ccAccounts = accounts.filter(acc => acc.accountType === 'Cash Credit');
        
        const totalDP = ccAccounts.reduce((sum, acc) => sum + getLatestDp(acc), 0);

        const totalCCBalance = ccAccounts.reduce((sum, acc) => sum + acc.currentBalance, 0);

        const util = totalDP > 0 ? (totalCCBalance / totalDP) * 100 : 0;
        
        return { 
            totalDrawingPower: totalDP,
            totalCurrentBalance: totalCCBalance,
            utilization: util,
        };
    })();

    if (authLoading || (isLoading && canView)) {
        return (
            <div className="w-full h-full flex flex-col px-4 sm:px-6 lg:px-8">
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
        return (
            <div className="w-full px-4 sm:px-6 lg:px-8">
                 <div className="mb-6 flex items-center gap-2">
                    <Link href="/"><Button variant="ghost" size="icon"><Home className="h-6 w-6" /></Button></Link>
                    <h1 className="text-2xl font-bold">Bank Balance Dashboard</h1>
                </div>
                <Card>
                    <CardHeader><CardTitle>Access Denied</CardTitle><CardDescription>You do not have permission to view this module.</CardDescription></CardHeader>
                    <CardContent className="flex justify-center items-center p-8 flex-col gap-4">
                        <ShieldAlert className="h-16 w-16 text-destructive" />
                        <p>Contact your administrator for access.</p>
                    </CardContent>
                </Card>
            </div>
        );
    }

    return (
        <>
            <div className="w-full h-full flex flex-col px-4 sm:px-6 lg:px-8">
                <div className="mb-4 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Link href="/"><Button variant="ghost" size="icon"><Home className="h-5 w-5" /></Button></Link>
                        <h1 className="text-xl font-bold">Bank Balance Dashboard</h1>
                    </div>
                     <div className="flex items-center gap-2">
                        <Link href="/bank-balance/reports">
                           <Button variant="outline" size="sm" disabled={!can('View', 'Bank Balance.Reports')}>
                                <BarChart3 className="mr-2 h-4 w-4"/>
                                Reports
                            </Button>
                        </Link>
                        <Button size="sm" onClick={() => setIsDailyEntryOpen(true)}>
                            <Plus className="mr-2 h-4 w-4"/>
                            Daily Entry
                        </Button>
                        <Link href="/bank-balance/settings">
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                                <Settings className="h-4 w-4"/>
                            </Button>
                        </Link>
                    </div>
                </div>
                
                <Card className="mb-4 bg-blue-50 border-blue-200">
                    <CardHeader className="p-4">
                        <div className="flex justify-between items-start">
                             <CardTitle className="flex items-center gap-2 text-md text-blue-800"><Scale className="h-5 w-5" /> Available Fund</CardTitle>
                             <div className="text-right">
                                <p className="text-xs text-blue-600">Total Drawing Power</p>
                                <p className="font-bold text-blue-900 text-sm">{formatCurrency(totalDrawingPower)}</p>
                            </div>
                        </div>
                         <CardDescription className="text-xs pt-1">
                            Total available drawing power as of {format(new Date(), 'MMMM do, yyyy')}.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                         <div className="flex justify-between items-end">
                            <div>
                                <p className="text-3xl font-bold text-blue-900">{formatCurrency(totalDrawingPower - totalCurrentBalance)}</p>
                                <p className="text-xs text-muted-foreground">{formatCurrency(totalCurrentBalance)} utilized</p>
                            </div>
                            <div className="w-1/3">
                               <p className="text-right text-xs font-medium">{utilization.toFixed(2)}%</p>
                               <div className="w-full bg-blue-200 rounded-full h-2">
                                 <div className="bg-blue-600 h-2 rounded-full" style={{width: `${utilization}%`}}></div>
                               </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                 <ScrollArea className="flex-grow">
                     <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {accounts.map(account => {
                            const isCC = account.accountType === 'Cash Credit';
                            let displayBalance = account.currentBalance;
                            if(isCC) {
                                const latestDp = getLatestDp(account);
                                displayBalance = latestDp - account.currentBalance;
                            }

                            return (
                                <Card key={account.id} className={
                                  account.bankName.includes('Punjab') ? 'bg-orange-50 border-orange-200' :
                                  account.bankName.includes('State Bank') ? 'bg-blue-50 border-blue-200' : ''
                                }>
                                    <CardHeader className="p-4">
                                        <div className="flex justify-between items-start">
                                            <CardTitle className="text-base">{account.shortName}</CardTitle>
                                            <Banknote className="h-5 w-5 text-muted-foreground" />
                                        </div>
                                        <CardDescription className="text-xs">
                                            {isCC ? "Available Balance" : "Closing Balance"}
                                        </CardDescription>
                                    </CardHeader>
                                    <CardContent className="p-4 pt-0">
                                        <p className="text-2xl font-bold mb-2">{formatCurrency(displayBalance)}</p>
                                    </CardContent>
                                </Card>
                            );
                        })}
                         <Link href="/bank-balance/accounts">
                             <Card className="h-full border-2 border-dashed flex flex-col items-center justify-center text-muted-foreground hover:border-primary hover:text-primary transition-colors">
                                <Plus className="h-6 w-6 mb-1" />
                                <p className="text-sm font-medium">Add New Account</p>
                            </Card>
                        </Link>
                    </div>
                 </ScrollArea>
            </div>
            <Dialog open={isDailyEntryOpen} onOpenChange={setIsDailyEntryOpen}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader className="text-center">
                        <DialogTitle>Daily Entry</DialogTitle>
                        <DialogDescription>Select an entry type to proceed.</DialogDescription>
                    </DialogHeader>
                    <div className="grid grid-cols-3 gap-4 pt-4">
                        <Link href="/bank-balance/expenses/new" onClick={() => setIsDailyEntryOpen(false)}>
                            <Card className="h-full flex flex-col items-center justify-center p-4 cursor-pointer hover:shadow-lg transition-shadow bg-red-50 hover:bg-red-100 border-red-200">
                                <ArrowDown className="h-8 w-8 text-red-600 mb-2" />
                                <p className="font-semibold text-red-800 text-center">Payment</p>
                            </Card>
                        </Link>
                         <Link href="/bank-balance/receipts/new" onClick={() => setIsDailyEntryOpen(false)}>
                            <Card className="h-full flex flex-col items-center justify-center p-4 cursor-pointer hover:shadow-lg transition-shadow bg-green-50 hover:bg-green-100 border-green-200">
                                <ArrowUp className="h-8 w-8 text-green-600 mb-2" />
                                <p className="font-semibold text-green-800 text-center">Receipts</p>
                            </Card>
                        </Link>
                        <Link href="/bank-balance/internal-transaction" onClick={() => setIsDailyEntryOpen(false)}>
                            <Card className="h-full flex flex-col items-center justify-center p-4 cursor-pointer hover:shadow-lg transition-shadow bg-blue-50 hover:bg-blue-100 border-blue-200">
                                <ArrowRightLeft className="h-8 w-8 text-blue-600 mb-2" />
                                <p className="font-semibold text-blue-800 text-center">Internal Transaction</p>
                            </Card>
                        </Link>
                    </div>
                </DialogContent>
            </Dialog>
        </>
    );
}
