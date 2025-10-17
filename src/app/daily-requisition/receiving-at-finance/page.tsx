

'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, Search, MoreHorizontal, RotateCcw, XCircle, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, updateDoc, doc, query, where, writeBatch } from 'firebase/firestore';
import type { DailyRequisitionEntry, Project, User } from '@/lib/types';
import { format } from 'date-fns';
import { useAuth } from '@/components/auth/AuthProvider';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useAuthorization } from '@/hooks/useAuthorization';

interface EnrichedEntry extends DailyRequisitionEntry {
  projectName: string;
  receivedBy?: string;
}

export default function ReceivingAtFinancePage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { can, isLoading: isAuthLoading } = useAuthorization();

  const [entries, setEntries] = useState<EnrichedEntry[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  
  const canViewPage = can('View', 'Daily Requisition.Receiving at Finance');
  const canMarkAsReceived = can('Mark as Received', 'Daily Requisition.Receiving at Finance');
  const canReturnToPending = can('Return to Pending', 'Daily Requisition.Receiving at Finance');
  const canCancel = can('Cancel', 'Daily Requisition.Receiving at Finance');

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [reqsSnap, projectsSnap, usersSnap] = await Promise.all([
        getDocs(query(collection(db, 'dailyRequisitions'), where('status', 'in', ['Pending', 'Received', 'Rejected']))),
        getDocs(collection(db, 'projects')),
        getDocs(collection(db, 'users')),
      ]);

      const projects = new Map(projectsSnap.docs.map(doc => [doc.id, (doc.data() as Project).projectName]));
      const fetchedUsers = usersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as User));
      const usersMap = new Map(fetchedUsers.map(u => [u.id, u.name]));
      setUsers(fetchedUsers);

      const data = reqsSnap.docs.map(doc => {
        const entry = doc.data() as DailyRequisitionEntry;
        return {
          ...entry,
          id: doc.id,
          date: entry.date && (entry.date as any).toDate ? format((entry.date as any).toDate(), 'dd MMM, yyyy') : String(entry.date),
          receivedAt: entry.receivedAt && (entry.receivedAt as any).toDate ? format((entry.receivedAt as any).toDate(), 'PPpp') : undefined,
          projectName: projects.get(entry.projectId) || 'N/A',
          receivedBy: entry.receivedById ? usersMap.get(entry.receivedById) : undefined,
        };
      });

      setEntries(data);
    } catch (error: any) {
      console.error("Error fetching finance entries: ", error);
       if (error.code === 'failed-precondition') {
             toast({
                title: 'Database Index Required',
                description: "This query requires a custom index. Please check the Firebase console for instructions.",
                variant: 'destructive',
                duration: 10000,
             });
        } else {
            toast({ title: 'Error', description: 'Failed to fetch entries.', variant: 'destructive' });
        }
    }
    setIsLoading(false);
  };

  useEffect(() => {
    if (!isAuthLoading && canViewPage) {
        fetchData();
    } else if (!isAuthLoading && !canViewPage) {
        setIsLoading(false);
    }
  }, [isAuthLoading, canViewPage]);

  const handleStatusUpdate = async (ids: string[], newStatus: 'Pending' | 'Received' | 'Rejected') => {
      if (ids.length === 0) return;
      try {
        const batch = writeBatch(db);
        ids.forEach(id => {
            const docRef = doc(db, 'dailyRequisitions', id);
            const updateData: any = { status: newStatus };
            if (newStatus === 'Received') {
              updateData.receivedAt = new Date();
              updateData.receivedById = user?.id;
            }
            if(newStatus === 'Pending') {
              updateData.receivedAt = null;
              updateData.receivedById = null;
            }
            batch.update(docRef, updateData);
        });

        await batch.commit();

        toast({
          title: 'Success',
          description: `${ids.length} entries marked as ${newStatus.toLowerCase()}.`,
        });
        setSelectedIds(new Set());
        fetchData();
      } catch (error) {
        console.error("Error updating entries: ", error);
        toast({ title: 'Error', description: `Failed to mark entries as ${newStatus.toLowerCase()}.`, variant: 'destructive' });
      }
  };

  const renderTable = (data: EnrichedEntry[], type: 'pending' | 'received' | 'rejected') => {
    const filteredData = data.filter(entry => 
      entry.receptionNo.toLowerCase().includes(searchTerm.toLowerCase()) ||
      entry.projectName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (entry.partyName || '').toLowerCase().includes(searchTerm.toLowerCase())
    );

    const handleSelectAll = (checked: boolean) => {
        setSelectedIds(checked ? new Set(filteredData.map(item => item.id)) : new Set());
    };

    return (
      <Card>
        <CardHeader>
          <CardTitle>{type.charAt(0).toUpperCase() + type.slice(1)} Entries</CardTitle>
          <CardDescription>
            {type === 'pending'
                ? 'Select entries to mark them as received by the finance department.'
                : `List of entries that have been ${type}.`
            }
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between mb-4">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search entries..."
                className="pl-8"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            {type === 'pending' && (
                <Button onClick={() => handleStatusUpdate(Array.from(selectedIds), 'Received')} disabled={selectedIds.size === 0 || !canMarkAsReceived}>
                    Mark as Received
                </Button>
            )}
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                {type === 'pending' && <TableHead className="w-[50px]"><Checkbox disabled={!canMarkAsReceived} checked={selectedIds.size === filteredData.length && filteredData.length > 0} onCheckedChange={handleSelectAll} /></TableHead>}
                <TableHead>Reception No.</TableHead>
                {type === 'pending' ? <TableHead>Date</TableHead> : <TableHead>Received At</TableHead>}
                <TableHead>Project</TableHead>
                <TableHead>Party Name</TableHead>
                {type !== 'pending' && <TableHead>Action Taken By</TableHead>}
                <TableHead className="text-right">Net Amount</TableHead>
                {type !== 'pending' && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}><TableCell colSpan={8}><Skeleton className="h-8" /></TableCell></TableRow>
                ))
              ) : filteredData.length > 0 ? (
                filteredData.map(entry => (
                  <TableRow key={entry.id}>
                    {type === 'pending' && <TableCell><Checkbox disabled={!canMarkAsReceived} checked={selectedIds.has(entry.id)} onCheckedChange={(checked) => { const newIds = new Set(selectedIds); if (checked) newIds.add(entry.id); else newIds.delete(entry.id); setSelectedIds(newIds); }} /></TableCell>}
                    <TableCell>{entry.receptionNo}</TableCell>
                    <TableCell>{type === 'pending' ? entry.date : entry.receivedAt}</TableCell>
                    <TableCell>{entry.projectName}</TableCell>
                    <TableCell>{entry.partyName}</TableCell>
                    {type !== 'pending' && <TableCell>{entry.receivedBy || 'N/A'}</TableCell>}
                    <TableCell className="text-right">{new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(entry.netAmount)}</TableCell>
                    {type !== 'pending' && (
                      <TableCell className="text-right">
                          <AlertDialog>
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                    {canReturnToPending && (
                                        <DropdownMenuItem onSelect={() => handleStatusUpdate([entry.id], 'Pending')}>
                                            <RotateCcw className="mr-2 h-4 w-4" /> Return
                                        </DropdownMenuItem>
                                    )}
                                    {type === 'received' && canCancel && (
                                      <AlertDialogTrigger asChild>
                                          <DropdownMenuItem className="text-destructive">
                                              <XCircle className="mr-2 h-4 w-4" /> Reject
                                          </DropdownMenuItem>
                                      </AlertDialogTrigger>
                                    )}
                                </DropdownMenuContent>
                            </DropdownMenu>
                             <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                                    <AlertDialogDescription>This will reject the entry. This action can be undone later.</AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>Close</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => handleStatusUpdate([entry.id], 'Rejected')}>Confirm</AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                      </TableCell>
                    )}
                  </TableRow>
                ))
              ) : (
                <TableRow><TableCell colSpan={8} className="text-center h-24">No entries found.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    );
  };
  
  const pendingEntries = useMemo(() => entries.filter(e => e.status === 'Pending'), [entries]);
  const receivedEntries = useMemo(() => entries.filter(e => e.status === 'Received'), [entries]);
  const rejectedEntries = useMemo(() => entries.filter(e => e.status === 'Rejected'), [entries]);

  if (isAuthLoading || (isLoading && canViewPage)) {
    return (
        <div className="w-full px-4 sm:px-6 lg:px-8">
            <Skeleton className="h-10 w-80 mb-6" />
            <Skeleton className="h-96 w-full" />
        </div>
    )
  }

  if (!canViewPage) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center gap-2">
            <Link href="/daily-requisition"><Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button></Link>
            <h1 className="text-2xl font-bold">Receiving at Finance</h1>
        </div>
        <Card>
            <CardHeader><CardTitle>Access Denied</CardTitle><CardDescription>You do not have permission to view this page.</CardDescription></CardHeader>
            <CardContent className="flex justify-center p-8"><ShieldAlert className="h-16 w-16 text-destructive" /></CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center gap-2">
        <Link href="/daily-requisition">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-6 w-6" />
          </Button>
        </Link>
        <h1 className="text-2xl font-bold">Receiving at Finance</h1>
      </div>

      <Tabs defaultValue="pending">
        <TabsList>
          <TabsTrigger value="pending">Pending</TabsTrigger>
          <TabsTrigger value="received">Received</TabsTrigger>
          <TabsTrigger value="rejected">Rejected</TabsTrigger>
        </TabsList>
        <TabsContent value="pending" className="mt-4">
          {renderTable(pendingEntries, 'pending')}
        </TabsContent>
        <TabsContent value="received" className="mt-4">
          {renderTable(receivedEntries, 'received')}
        </TabsContent>
        <TabsContent value="rejected" className="mt-4">
          {renderTable(rejectedEntries, 'rejected')}
        </TabsContent>
      </Tabs>
    </div>
  );
}
