
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus, Edit, CalendarClock, ShieldCheck, ShieldAlert, History, Users, HardHat, Car } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs } from 'firebase/firestore';
import type { InsurancePolicy } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { format } from 'date-fns';
import { useRouter } from 'next/navigation';
import { useAuthorization } from '@/hooks/useAuthorization';
import { AddPolicyDialog } from './AddPolicyDialog';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CategoryCardProps {
    item: {
        icon: LucideIcon;
        title: string;
        description: string;
        href: string;
        disabled?: boolean;
    };
}

const insuranceCategories = [
    { 
        icon: Users, 
        title: 'Personal Insurance', 
        description: 'Manage personal health and life insurance policies.', 
        href: '/insurance/personal' 
    },
    { 
        icon: HardHat, 
        title: 'Project Insurance', 
        description: 'Handle insurance policies related to specific projects.', 
        href: '/insurance/project' 
    },
    { 
        icon: Car, 
        title: 'Vehicle Insurance', 
        description: 'Track vehicle insurance policies and renewals.', 
        href: '#' 
    },
];

function CategoryCard({ item }: CategoryCardProps) {
    const cardContent = (
        <Card
            className={cn(
                "flex flex-col h-full transition-all duration-300 ease-in-out hover:shadow-lg bg-background rounded-xl border-border/80 hover:border-primary/50",
                (item.href === '#' || item.disabled) ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
            )}
        >
            <CardHeader className="items-center text-center p-4">
                <div className="bg-primary/10 p-3 rounded-full mb-2">
                  <item.icon className="w-6 h-6 text-primary" />
                </div>
                <CardTitle className="text-base font-semibold">{item.title}</CardTitle>
            </CardHeader>
            <CardContent className="text-center p-4 pt-0">
                <CardDescription className="text-xs">{item.description}</CardDescription>
            </CardContent>
        </Card>
    );

    if (item.href === '#' || item.disabled) {
        return <div className="h-full">{cardContent}</div>;
    }
    
    return (
       <Link href={item.href} className="no-underline h-full">
            {cardContent}
        </Link>
    );
}

export default function AllPoliciesTab() {
  const { can, isLoading: authLoading } = useAuthorization();

  if (authLoading) {
    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
            <Skeleton className="h-48" />
            <Skeleton className="h-48" />
            <Skeleton className="h-48" />
        </div>
    );
  }

  const itemsToDisplay = insuranceCategories.map(item => ({
    ...item,
    disabled: !can('View', `Insurance.${item.title}`),
  }));

  return (
    <div className="w-full">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
            {itemsToDisplay.map((item) => (
                <CategoryCard key={item.title} item={item} />
            ))}
        </div>
    </div>
  );
}
