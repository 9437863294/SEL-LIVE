
'use client';

import Link from 'next/link';
import {
  Home,
  Building2,
  Receipt,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useEffect, useState } from 'react';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, where } from 'firebase/firestore';
import type { Department } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';

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

  useEffect(() => {
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
  }, []);

  const departmentItems = departments.map(dept => ({
      icon: Building2,
      text: dept.name,
      href: '#', // Placeholder link
      description: `Manage expenses for the ${dept.name} department.`
  }));

  const settingsItem = { 
      icon: Receipt, 
      text: 'Settings', 
      href: '/settings/expenses', 
      description: 'Configure settings for the expenses module.' 
  };
  
  const allItems = [...departmentItems, settingsItem];

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
        {isLoading ? (
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)
        ) : allItems.length > 1 ? (
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
