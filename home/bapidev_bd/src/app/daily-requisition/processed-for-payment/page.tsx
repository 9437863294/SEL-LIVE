
'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, Search, CheckCircle, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, where, orderBy } from 'firebase/firestore';
import type { DailyRequisitionEntry, Project } from '@/lib/types';
import { format } from 'date-fns';
import { useAuthorization } from '@/hooks/useAuthorization';

interface EnrichedEntry extends DailyRequisitionEntry {
  projectName: string;
}

export default function ProcessedForPaymentPage() {
  const { toast } = useToast();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  
  const [entries, setEntries] = useState<EnrichedEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  const canViewPage = can('View', 'Daily Requisition.Processed for Payment');

  useEffect(() => {
    if (!isAuthLoading) {
      if(canViewPage) {
        fetchData();
      } else {
        setIsLoading(false);
      }
    }
  }, [isAuthLoading, canViewPage]);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [reqsSnap, projectsSnap] = await Promise.all([
        getDocs(query(collection(db, 'dailyRequisitions'), where('status', '==', 'Verified'), orderBy('verifiedAt', 'desc'))),
        getDocs(collection(db, 'projects')),
      ]);

      const projectsMap = new Map(projectsSnap.docs.map(doc => [doc.id, (doc.data() as Project).projectName]));

      const data = reqsSnap.docs.map(doc => {
        const entry = doc.data() as DailyRequisitionEntry;
        return {
          ...entry,
          id: doc.id,
          date: entry.date && (entry.date as any).toDate ? format((entry.date as any).toDate(), 'dd MMM, yyyy') : String(entry.date),
          verifiedAt: entry.verifiedAt && (entry.verifiedAt as any).toDate ? format((entry.verifiedAt as any).toDate(), 'dd MMM, yyyy HH:mm') : undefined,
          projectName: projectsMap.get(entry.projectId) || 'N/A',
        };
      });
      
      setEntries(data);
    } catch (error: any) {
      console.error("Error fetching entries: ", error);
      toast({ title: 'Error', description: 'Failed to fetch verified entries.', variant: 'destructive' });
    }
    setIsLoading(false);
  };
  
  const filteredEntries = useMemo(() => {
      return entries.filter(entry => 
        entry.receptionNo.toLowerCase().includes(searchTerm.toLowerCase()) ||
        entry.projectName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        entry.partyName.toLowerCase().includes(searchTerm.toLowerCase())
      );
  }, [entries, searchTerm]);
  
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);
  };

  if(isAuthLoading || (isLoading && canViewPage)) {
    return (
        <div className="w-full">
            <Skeleton className="h-10 w-80 mb-6" />
            <Skeleton className="h-96 w-full" />
        </div>
    )
  }

  if (!canViewPage) {
    return (
      <div className="w-full">
        <div className="mb-6 flex items-center gap-2">
            <Link href="/daily-requisition"><Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button></Link>
            <h1 className="text-xl font-bold">Processed for Payment</h1>
        </div>
        <Card>
            <CardHeader><CardTitle>Access Denied</CardTitle><CardDescription>You do not have permission to view this page.</CardDescription></CardHeader>
            <CardContent className="flex justify-center p-8"><ShieldAlert className="h-16 w-16 text-destructive" /></CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="w-full">
        <div className="mb-6 flex items-center justify-between">
            <div className="flex items-center gap-2">
                <Link href="/daily-requisition"><Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button></Link>
                <div>
                    <h1 className="text-xl font-bold">Processed for Payment</h1>
                    <p className="text-sm text-muted-foreground">Requisitions verified and ready for payment processing.</p>
                </div>
            </div>
        </div>

        <Card>
            <CardHeader>
                <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input 
                        placeholder="Search by Reception No, Project, or Party Name..." 
                        className="pl-8"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
            </CardHeader>
            <CardContent>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Reception No.</TableHead>
                            <TableHead>Verified At</TableHead>
                            <TableHead>Project</TableHead>
                            <TableHead>Party Name</TableHead>
                            <TableHead className="text-right">Net Amount</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {isLoading ? (
                            Array.from({ length: 5 }).map((_, i) => (
                                <TableRow key={i}><TableCell colSpan={5}><Skeleton className="h-8" /></TableCell></TableRow>
                            ))
                        ) : filteredEntries.length > 0 ? (
                            filteredEntries.map(entry => (
                                <TableRow key={entry.id}>
                                    <TableCell className="font-medium">{entry.receptionNo}</TableCell>
                                    <TableCell>{entry.verifiedAt}</TableCell>
                                    <TableCell>{entry.projectName}</TableCell>
                                    <TableCell>{entry.partyName}</TableCell>
                                    <TableCell className="text-right">{formatCurrency(entry.netAmount)}</TableCell>
                                </TableRow>
                            ))
                        ) : (
                            <TableRow><TableCell colSpan={5} className="text-center h-24">No verified entries found.</TableCell></TableRow>
                        )}
                    </TableBody>
                </Table>
            </CardContent>
        </Card>
    </div>
  );
}
