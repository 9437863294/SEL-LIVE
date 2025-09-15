

'use client';

import Link from 'next/link';
import {
  Home,
  Building2,
  Receipt,
  ShieldAlert,
  Layers,
  BarChart3,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useEffect, useState } from 'react';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, where } from 'firebase/firestore';
import type { Department } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthorization } from '@/hooks/useAuthorization';

interface ExpensesCardProps {
  item: {
    icon: LucideIcon;
    text: string;
    href: string;
    description: string;
  };
}


function ExpensesCard({ item }: ExpensesCardProps) {
    const cardContent = (
         <Card
            className={cn(
                "flex flex-col h-full transition-all duration-300 ease-in-out hover:shadow-lg bg-background rounded-xl border-border/80 hover:border-primary/50",
                item.href === '#' ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
            )}
            >
            <CardHeader className="flex-row items-center gap-4 space-y-0 p-4">
                <div className="bg-primary/10 p-3 rounded-lg">
                <item.icon className="w-6 h-6 text-primary" />
                </div>
                <div className="flex-1">
                    <CardTitle className="text-base font-bold">{item.text}</CardTitle>
                    <CardDescription className="text-xs">{item.description}</CardDescription>
                </div>
            </CardHeader>
        </Card>
    )

    if (item.href === '#') {
        return <div className="h-full">{cardContent}</div>;
    }
    
    return (
       <Link href={item.href} className="no-underline h-full">
            {cardContent}
        </Link>
    )
}


export default function ExpensesPage() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const canViewModule = can('View Module', 'Expenses');
  const canViewAll = can('View All', 'Expenses.Expense Requests');

  useEffect(() => {
    if (isAuthLoading) return;
    if (!canViewModule) {
      setIsLoading(false);
      return;
    }

    const fetchDepartments = async () => {
        setIsLoading(true);
        try {
            const q = query(collection(db, 'departments'), where('status', '==', 'Active'));
            const querySnapshot = await getDocs(q);
            const depts = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Department));
            setDepartments(depts);
        } catch (error) {
            console.error("Error fetching active departments:", error);
        }
        setIsLoading(false);
    };
    fetchDepartments();
  }, [isAuthLoading, canViewModule]);

  const departmentItems = departments.map(dept => ({
      icon: Building2,
      text: dept.name,
      href: `/expenses/${dept.id}`,
      description: `Manage expenses for the ${dept.name} department.`
  }));

  const canViewSettings = can('View', 'Expenses.Settings');
  const settingsItem = { 
      icon: Receipt, 
      text: 'Settings', 
      href: canViewSettings ? '/settings/expenses' : '#',
      description: 'Configure settings for the expenses module.' 
  };
  
  const consolidatedItem = {
      icon: Layers,
      text: 'Consolidated View',
      href: canViewAll ? '/expenses/all' : '#',
      description: 'View a consolidated report of all expenses.'
  };
  
  const reportsItem = {
      icon: BarChart3,
      text: 'Reports',
      href: '/expenses/reports', // Assuming a new reports page
      description: 'View expense summaries and reports.'
  };

  const allItems = [consolidatedItem, reportsItem, ...departmentItems, settingsItem];

  if (isAuthLoading || (isLoading && canViewModule)) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <Skeleton className="h-10 w-64 mb-6" />
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
      </div>
    );
  }

  if (!canViewModule) {
    return (
        <div className="w-full px-4 sm:px-6 lg:px-8">
            <div className="mb-6 flex items-center gap-2">
                <Link href="/"><Button variant="ghost" size="icon"><Home className="h-6 w-6" /></Button></Link>
                <h1 className="text-2xl font-bold">Expenses Management</h1>
            </div>
             <Card>
                <CardHeader>
                    <CardTitle>Access Denied</CardTitle>
                    <CardDescription>You do not have permission to access this module.</CardDescription>
                </CardHeader>
                <CardContent className="flex justify-center p-8">
                    <ShieldAlert className="h-16 w-16 text-destructive" />
                </CardContent>
            </Card>
        </div>
    );
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center gap-2">
        <Link href="/">
            <Button variant="ghost" size="icon">
                <Home className="h-6 w-6" />
            </Button>
        </Link>
        <h1 className="text-2xl font-bold">Expenses Management</h1>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
        {allItems.length > 2 ? ( // Check for more than just reports and settings
            allItems.map((item) => (
              <ExpensesCard key={item.text} item={item} />
            ))
        ) : (
            <div className="col-span-full text-center py-10">
                <p className="text-muted-foreground">No active departments found.</p>
                <p className="text-sm text-muted-foreground">You can add departments in the settings.</p>
                <Link href="/settings/department" className="mt-4 inline-block">
                    <Button>Go to Department Settings</Button>
                </Link>
            </div>
        )}
      </div>
    </div>
  );
}
