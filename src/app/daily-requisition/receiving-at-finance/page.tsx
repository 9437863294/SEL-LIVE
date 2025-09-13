
'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, Search, MoreHorizontal, RotateCcw, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, updateDoc, doc } from 'firebase/firestore';
import type { DailyRequisitionEntry, Project, User } from '@/lib/types';
import { format } from 'date-fns';
import { useAuth } from '@/components/auth/AuthProvider';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";

interface EnrichedEntry extends DailyRequisitionEntry {
  projectName: string;
  receivedBy?: string;
}

export default function ReceivingAtFinancePage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [entries, setEntries] = useState<EnrichedEntry[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [reqsSnap, projectsSnap, usersSnap] = await Promise.all([
        getDocs(collection(db, 'dailyRequisitions')),
        getDocs(collection(db, 'projects')),
        getDocs(collection(db, 'users')),
      ]);

      const projects = new Map(projectsSnap.docs.map(doc => [doc.id, (doc.data() as Project).projectName]));
      const fetchedUsers = usersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as User));
      const usersMap = new Map(fetchedUsers.map(u => [u.id, u.email]));
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
    } catch (error) {
      console.error("Error fetching finance entries: ", error);
      toast({ title: 'Error', description: 'Failed to fetch entries.', variant: 'destructive' });
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleStatusUpdate = async (ids: string[], newStatus: 'Pending' | 'Received' | 'Cancelled') => {
      if (ids.length === 0) return;
      try {
        await Promise.all(
          ids.map(id => {
            const updateData: any = { status: newStatus };
            if (newStatus === 'Received') {
              updateData.receivedAt = new Date();
              updateData.receivedById = user?.id;
            }
            if(newStatus === 'Pending') {
              updateData.receivedAt = null;
              updateData.receivedById = null;
            }
            return updateDoc(doc(db, 'dailyRequisitions', id), updateData);
          })
        );
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

  const renderTable = (data: EnrichedEntry[], type: 'pending' | 'received' | 'cancelled') => {
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
                <Button onClick={() => handleStatusUpdate(Array.from(selectedIds), 'Received')} disabled={selectedIds.size === 0}>
                    Mark as Received
                </Button>
            )}
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                {type === 'pending' && <TableHead className="w-[50px]"><Checkbox checked={selectedIds.size === filteredData.length && filteredData.length > 0} onCheckedChange={handleSelectAll} /></TableHead>}
                <TableHead>Reception No.</TableHead>
                {type === 'pending' ? <TableHead>Date</TableHead> : <TableHead>Received At</TableHead>}
                {type !== 'pending' && <TableHead>Received By</TableHead>}
                <TableHead>Project</TableHead>
                <TableHead>Narration</TableHead>
                <TableHead className="text-right">Net Amount</TableHead>
                {type !== 'pending' && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}><TableCell colSpan={7}><Skeleton className="h-8" /></TableCell></TableRow>
                ))
              ) : filteredData.length > 0 ? (
                filteredData.map(entry => (
                  <TableRow key={entry.id}>
                    {type === 'pending' && <TableCell><Checkbox checked={selectedIds.has(entry.id)} onCheckedChange={(checked) => { const newIds = new Set(selectedIds); if (checked) newIds.add(entry.id); else newIds.delete(entry.id); setSelectedIds(newIds); }} /></TableCell>}
                    <TableCell>{entry.receptionNo}</TableCell>
                    <TableCell>{type === 'pending' ? entry.date : entry.receivedAt}</TableCell>
                    {type !== 'pending' && <TableCell>{entry.receivedBy || 'N/A'}</TableCell>}
                    <TableCell>{entry.projectName}</TableCell>
                    <TableCell>{entry.partyName}</TableCell>
                    <TableCell className="text-right">{new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(entry.netAmount)}</TableCell>
                    {type !== 'pending' && (
                      <TableCell className="text-right">
                          <AlertDialog>
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                    <DropdownMenuItem onSelect={() => handleStatusUpdate([entry.id], 'Pending')}>
                                        <RotateCcw className="mr-2 h-4 w-4" /> Return
                                    </DropdownMenuItem>
                                    {type === 'received' && (
                                      <AlertDialogTrigger asChild>
                                          <DropdownMenuItem className="text-destructive">
                                              <XCircle className="mr-2 h-4 w-4" /> Cancel
                                          </DropdownMenuItem>
                                      </AlertDialogTrigger>
                                    )}
                                </DropdownMenuContent>
                            </DropdownMenu>
                             <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                                    <AlertDialogDescription>This will cancel the entry. This action can be undone later.</AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>Close</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => handleStatusUpdate([entry.id], 'Cancelled')}>Confirm</AlertDialogAction>
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
  
  const pendingEntries = useMemo(() => entries.filter(e => e.status !== 'Received' && e.status !== 'Cancelled'), [entries]);
  const receivedEntries = useMemo(() => entries.filter(e => e.status === 'Received'), [entries]);
  const cancelledEntries = useMemo(() => entries.filter(e => e.status === 'Cancelled'), [entries]);

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
          <TabsTrigger value="cancelled">Cancelled</TabsTrigger>
        </TabsList>
        <TabsContent value="pending" className="mt-4">
          {renderTable(pendingEntries, 'pending')}
        </TabsContent>
        <TabsContent value="received" className="mt-4">
          {renderTable(receivedEntries, 'received')}
        </TabsContent>
        <TabsContent value="cancelled" className="mt-4">
          {renderTable(cancelledEntries, 'cancelled')}
        </TabsContent>
      </Tabs>
    </div>
  );
}
