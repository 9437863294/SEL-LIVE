
'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, DownloadCloud, Loader2, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { syncAllGreytHR } from '@/ai';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Skeleton } from '@/components/ui/skeleton';

export default function SyncEmployeePage() {
  const { toast } = useToast();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  
  const [isSyncingAll, setIsSyncingAll] = useState(false);

  const canSync = can('Sync from GreytHR', 'Settings.Employee Management');

  const handleSyncAll = async () => {
    setIsSyncingAll(true);
    try {
        const result = await syncAllGreytHR();
         if (result.success) {
            toast({
              title: 'Full Sync Complete',
              description: result.message,
            });
            window.dispatchEvent(new CustomEvent('greytHRSyncSuccess'));
        } else {
            throw new Error(result.message);
        }
    } catch (error: any) {
        toast({
            title: 'Full Sync Failed',
            description: error.message,
            variant: 'destructive',
        });
    } finally {
        setIsSyncingAll(false);
    }
  };
  
  if (isAuthLoading) {
      return (
         <div className="w-full max-w-5xl mx-auto">
            <div className="mb-6"><Skeleton className="h-10 w-96" /></div>
            <Skeleton className="h-64 w-full" />
        </div>
      )
  }

  if (!canSync) {
    return (
        <div className="w-full max-w-4xl mx-auto">
            <div className="mb-6 flex items-center gap-4">
              <Link href="/settings/employee">
                <Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button>
              </Link>
              <h1 className="text-2xl font-bold">Sync & Import from GreytHR</h1>
            </div>
            <Card>
                <CardHeader>
                    <CardTitle>Access Denied</CardTitle>
                    <CardDescription>You do not have permission to sync employees from GreytHR.</CardDescription>
                </CardHeader>
                <CardContent className="flex justify-center p-8">
                    <ShieldAlert className="h-16 w-16 text-destructive" />
                </CardContent>
            </Card>
        </div>
    );
  }

  return (
    <div className="w-full max-w-5xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/settings/employee">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-6 w-6" />
            </Button>
          </Link>
          <h1 className="text-2xl font-bold">Sync & Import from GreytHR</h1>
        </div>
      </div>
      
      <Card className="text-center">
          <CardHeader>
              <CardTitle>Start Synchronization</CardTitle>
              <CardDescription>Fetch the latest employee data from GreytHR. This will update all employee records in the database.</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center items-center gap-4">
              <Button onClick={handleSyncAll} disabled={isSyncingAll} size="lg">
                   {isSyncingAll ? (
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  ) : (
                      <DownloadCloud className="mr-2 h-5 w-5" />
                  )}
                  Sync All Employees
              </Button>
          </CardContent>
      </Card>
    </div>
  );
}
