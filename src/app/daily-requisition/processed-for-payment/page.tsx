
'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, Search, Check, CheckCircle, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, where, writeBatch, doc, Timestamp } from 'firebase/firestore';
import type { DailyRequisitionEntry, Project } from '@/lib/types';
import { format } from 'date-fns';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';


interface EnrichedEntry extends DailyRequisitionEntry {
  projectName: string;
}

export default function ProcessedForPaymentPage() {
  const { toast } = useToast();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  
  const [entries, setEntries] = useState<EnrichedEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const canViewPage = can('View', 'Daily Requisition.Processed for Payment');
  const canMarkAsPaid = can('Mark as Received for Payment', 'Daily Requisition.Processed for Payment'); // Permission is reused

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [reqsSnap, projectsSnap] = await Promise.all([
        getDocs(query(collection(db, 'dailyRequisitions'), where('status', 'in', ['Received for Payment', 'Paid']))),
        getDocs(collection(db, 'projects')),
      ]);

      const projectsMap = new Map(projectsSnap.docs.map(doc => [doc.id, (doc.data() as Project).projectName]));

      const data: EnrichedEntry[] = reqsSnap.docs.map(doc => {
        const entry = doc.data() as DailyRequisitionEntry;
        return {
          ...entry,
          id: doc.id,
          projectName: projectsMap.get(entry.projectId) || 'N/A',
          date: entry.date && (entry.date as any).toDate ? format((entry.date as any).toDate(), 'dd MMM, yyyy') : String(entry.date),
          verifiedAt: entry.verifiedAt && (entry.verifiedAt as any).toDate ? format(entry.verifiedAt.toDate(), 'dd MMM, yyyy HH:mm') : 'N/A',
          receivedAt: entry.receivedAt && (entry.receivedAt as any).toDate ? format(entry.receivedAt.toDate(), 'dd MMM, yyyy HH:mm') : 'N/A',
          paidAt: entry.paidAt && (entry.paidAt as any).toDate ? format(entry.paidAt.toDate(), 'dd MMM, yyyy HH:mm') : 'N/A',
        };
      });
      
      data.sort((a, b) => {
        const dateA = a.paidAt && a.paidAt !== 'N/A' ? new Date(a.paidAt).getTime() : (a.verifiedAt && a.verifiedAt !== 'N/A' ? new Date(a.verifiedAt).getTime() : 0);
        const dateB = b.paidAt && b.paidAt !== 'N/A' ? new Date(b.paidAt).getTime() : (b.verifiedAt && b.verifiedAt !== 'N/A' ? new Date(b.verifiedAt).getTime() : 0);
        return dateB - dateA;
      });

      setEntries(data);
    } catch (error: any) {
      console.error("Error fetching entries: ", error);
      toast({ title: 'Error', description: 'Failed to fetch entries.', variant: 'destructive' });
    }
    setIsLoading(false);
  };
  
  useEffect(() => {
    if (!isAuthLoading) {
      if(canViewPage) {
        fetchData();
      } else {
        setIsLoading(false);
      }
    }
  }, [isAuthLoading, canViewPage]);

  
  const pendingForPaymentEntries = useMemo(() => {
      return entries.filter(entry => 
        entry.status === 'Received for Payment' &&
        (entry.receptionNo.toLowerCase().includes(searchTerm.toLowerCase()) ||
        entry.projectName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        entry.partyName.toLowerCase().includes(searchTerm.toLowerCase()))
      );
  }, [entries, searchTerm]);
  
  const paidEntries = useMemo(() => {
      return entries.filter(entry => 
        entry.status === 'Paid' &&
        (entry.receptionNo.toLowerCase().includes(searchTerm.toLowerCase()) ||
        entry.projectName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        entry.partyName.toLowerCase().includes(searchTerm.toLowerCase()))
      );
  }, [entries, searchTerm]);
  
  const handleMarkAsPaid = async () => {
    if (selectedIds.length === 0) return;

    try {
      const batch = writeBatch(db);
      selectedIds.forEach(id => {
        const docRef = doc(db, 'dailyRequisitions', id);
        batch.update(docRef, { status: 'Paid', paidAt: Timestamp.now() });
      });
      await batch.commit();
      toast({
        title: 'Success',
        description: `${selectedIds.length} entries marked as paid.`,
      });
      setSelectedIds([]);
      fetchData(); // Refresh data
    } catch (error) {
      console.error("Error marking entries:", error);
      toast({ title: 'Error', description: 'Failed to update entries.', variant: 'destructive' });
    }
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(pendingForPaymentEntries.map(e => e.id));
    } else {
      setSelectedIds([]);
    }
  };

  const handleSelectRow = (id: string, checked: boolean) => {
    setSelectedIds(prev => 
      checked ? [...prev, id] : prev.filter(rowId => rowId !== id)
    );
  };
  
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
                    <p className="text-sm text-muted-foreground">Manage entries that have been received for final payment.</p>
                </div>
            </div>
             <Button onClick={handleMarkAsPaid} disabled={selectedIds.length === 0 || !canMarkAsPaid}>
                <Check className="mr-2 h-4 w-4" />
                Mark as Paid ({selectedIds.length})
            </Button>
        </div>
        
        <div className="mb-4">
             <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input 
                    placeholder="Search by Reception No, Project, or Party Name..." 
                    className="pl-8"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                />
            </div>
        </div>

        <Tabs defaultValue="pending">
          <TabsList>
            <TabsTrigger value="pending">Pending for Payment ({pendingForPaymentEntries.length})</TabsTrigger>
            <TabsTrigger value="paid">Paid ({paidEntries.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="pending" className="mt-4">
            <Card>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-[50px]">
                                  <Checkbox 
                                    checked={selectedIds.length > 0 && selectedIds.length === pendingForPaymentEntries.length}
                                    onCheckedChange={(checked) => handleSelectAll(!!checked)}
                                    disabled={!canMarkAsPaid}
                                  />
                                </TableHead>
                                <TableHead>Reception No.</TableHead>
                                <TableHead>Received For Payment</TableHead>
                                <TableHead>Project</TableHead>
                                <TableHead>Party Name</TableHead>
                                <TableHead className="text-right">Net Amount</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                           {pendingForPaymentEntries.map(entry => (
                                <TableRow key={entry.id} data-state={selectedIds.includes(entry.id) && 'selected'}>
                                    <TableCell>
                                      <Checkbox 
                                        checked={selectedIds.includes(entry.id)}
                                        onCheckedChange={(checked) => handleSelectRow(entry.id, !!checked)}
                                        disabled={!canMarkAsPaid}
                                      />
                                    </TableCell>
                                    <TableCell className="font-medium">{entry.receptionNo}</TableCell>
                                    <TableCell>{entry.receivedAt || 'N/A'}</TableCell>
                                    <TableCell>{entry.projectName}</TableCell>
                                    <TableCell>{entry.partyName}</TableCell>
                                    <TableCell className="text-right">{formatCurrency(entry.netAmount)}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="paid" className="mt-4">
             <Card>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Reception No.</TableHead>
                                <TableHead>Paid At</TableHead>
                                <TableHead>Project</TableHead>
                                <TableHead>Party Name</TableHead>
                                <TableHead className="text-right">Net Amount</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                           {paidEntries.map(entry => (
                                <TableRow key={entry.id}>
                                    <TableCell className="font-medium">{entry.receptionNo}</TableCell>
                                    <TableCell>{entry.paidAt}</TableCell>
                                    <TableCell>{entry.projectName}</TableCell>
                                    <TableCell>{entry.partyName}</TableCell>
                                    <TableCell className="text-right">{formatCurrency(entry.netAmount)}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
    </div>
  );
}
