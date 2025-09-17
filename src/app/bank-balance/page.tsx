
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Home, Banknote, DollarSign, Plus, Settings, ArrowUpRight, ArrowDownLeft, Scale } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs } from 'firebase/firestore';
import type { BankAccount } from '@/lib/types';
import { useAuthorization } from '@/hooks/useAuthorization';


export default function BankBalanceDashboard() {
    const { toast } = useToast();
    const { can, isLoading: authLoading } = useAuthorization();
    const [accounts, setAccounts] = useState<BankAccount[]>([]);
    const [isLoading, setIsLoading] = useState(true);

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

    if (authLoading || (isLoading && canView)) {
        return (
            <div className="w-full px-4 sm:px-6 lg:px-8">
                <Skeleton className="h-10 w-80 mb-6" />
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
        <div className="w-full px-4 sm:px-6 lg:px-8">
            <div className="mb-6 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Link href="/"><Button variant="ghost" size="icon"><Home className="h-6 w-6" /></Button></Link>
                    <h1 className="text-2xl font-bold">Bank Balance Dashboard</h1>
                </div>
                 <div className="flex items-center gap-2">
                    <Link href="/bank-balance/accounts">
                        <Button>
                            <Scale className="mr-2 h-4 w-4"/>
                            Manage Accounts
                        </Button>
                    </Link>
                    <Button variant="outline">
                        <DollarSign className="mr-2 h-4 w-4"/>
                        New Transaction
                    </Button>
                </div>
            </div>
            
             <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {accounts.map(account => {
                    const utilization = account.accountType === 'CC' && account.drawingPower 
                        ? (account.currentBalance / account.drawingPower) * 100 
                        : 0;
                    return (
                        <Card key={account.id}>
                            <CardHeader>
                                <div className="flex justify-between items-start">
                                    <CardTitle>{account.accountName}</CardTitle>
                                    <Banknote className="h-6 w-6 text-muted-foreground" />
                                </div>
                                <CardDescription>{account.bankName} - {account.accountNumber}</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <p className="text-3xl font-bold mb-2">{formatCurrency(account.currentBalance)}</p>
                                {account.accountType === 'CC' && account.drawingPower && (
                                    <div>
                                        <div className="flex justify-between text-sm text-muted-foreground">
                                            <span>Drawing Power</span>
                                            <span>{formatCurrency(account.drawingPower)}</span>
                                        </div>
                                        <Progress value={utilization} className="mt-2" />
                                        <p className="text-right text-sm text-muted-foreground mt-1">{utilization.toFixed(2)}% Utilized</p>
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
    );
}
