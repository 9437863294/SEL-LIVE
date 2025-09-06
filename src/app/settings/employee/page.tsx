
'use client';

import Link from 'next/link';
import {
  Home,
  Users,
  Upload,
  FileText,
  ArrowLeft,
  RefreshCw,
  Loader2,
  Tags,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useState, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { syncGreytHR } from '@/ai';
import { db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { formatDistanceToNow } from 'date-fns';


interface EmployeeSettingsCardProps {
  item: {
    icon: LucideIcon;
    text: string;
    description: string;
    href: string;
    action?: () => void;
    isLoading?: boolean;
    lastSynced?: string | null;
  };
}

const employeeSettingsItemsBase = [
  { 
    icon: Users, 
    text: 'Manage Employee', 
    description: 'View, filter, and edit employee details.',
    href: '/settings/employee/manage' 
  },
  { 
    icon: RefreshCw, 
    text: 'Sync with GreytHR',
    description: 'Sync employee data from GreytHR.',
    href: '#' 
  },
  { 
    icon: Tags, 
    text: 'Manage Category', 
    description: 'View synced departments and designations.',
    href: '/settings/employee/category' 
  },
  { 
    icon: FileText, 
    text: 'Pay Slip Config', 
    description: 'Configure settings for generating pay slips.',
    href: '#' 
  },
];

function EmployeeSettingsCard({ item }: EmployeeSettingsCardProps) {
    const cardContent = (
         <Card
            onClick={item.action}
            className={cn(
                "flex flex-col h-full transition-all duration-300 ease-in-out hover:shadow-lg bg-background rounded-xl border-border/80 hover:border-primary/50",
                item.href === '#' ? (item.action ? 'cursor-pointer' : 'cursor-not-allowed opacity-60') : 'cursor-pointer'
            )}
            >
            <CardHeader className="flex-row items-start gap-4 space-y-0 p-4">
                <div className="bg-primary/10 p-3 rounded-lg">
                  {item.isLoading ? (
                    <Loader2 className="w-6 h-6 text-primary animate-spin" />
                  ) : (
                    <item.icon className="w-6 h-6 text-primary" />
                  )}
                </div>
                <div className="flex-1">
                    <CardTitle className="text-base font-bold">{item.text}</CardTitle>
                    <CardDescription className="mt-1 text-sm">{item.description}</CardDescription>
                     {item.lastSynced && (
                        <p className="text-xs text-muted-foreground mt-2">
                            Last synced: {item.lastSynced}
                        </p>
                    )}
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


export default function EmployeeSettingsPage() {
  const { toast } = useToast();
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState<string | null>(null);

  const fetchLastSynced = async () => {
      try {
        const docRef = doc(db, 'settings', 'employeeSync');
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            const data = docSnap.data();
            if (data.lastSynced) {
                setLastSynced(formatDistanceToNow(new Date(data.lastSynced), { addSuffix: true }));
            }
        }
      } catch (error) {
        console.error("Failed to fetch last sync time:", error);
      }
  };
  
  useEffect(() => {
    fetchLastSynced();
  }, []);

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      const result = await syncGreytHR();
      if(result.success) {
        toast({
            title: 'Sync Successful',
            description: result.message,
        });
        fetchLastSynced(); // Refresh the last synced time
      } else {
        throw new Error(result.message);
      }
    } catch(error: any) {
        console.error("Error syncing with GreytHR: ", error);
        toast({
            title: 'Sync Failed',
            description: error.message || 'An unexpected error occurred.',
            variant: 'destructive',
        });
    } finally {
        setIsSyncing(false);
    }
  };

  const employeeSettingsItems = employeeSettingsItemsBase.map(item => {
    if (item.text === 'Sync with GreytHR') {
      return { ...item, action: handleSync, isLoading: isSyncing, lastSynced: lastSynced };
    }
    return item;
  });

  return (
    <div className="w-full max-w-6xl mx-auto">
      <div className="mb-6 flex items-center gap-2">
        <Link href="/settings">
            <Button variant="ghost" size="icon">
                <ArrowLeft className="h-6 w-6" />
            </Button>
        </Link>
        <h1 className="text-2xl font-bold">Employee Management</h1>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
        {employeeSettingsItems.map((item) => (
          <EmployeeSettingsCard key={item.text} item={item} />
        ))}
      </div>
    </div>
  );
}

    