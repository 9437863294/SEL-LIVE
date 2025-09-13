
'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, Search } from 'lucide-react';
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
import type { DailyRequisitionEntry, Project } from '@/lib/types';
import { format } from 'date-fns';

interface EnrichedEntry extends DailyRequisitionEntry {
  projectName: string;
}

export default function ReceivingAtFinancePage() {
  const { toast } = useToast();
  const [entries, setEntries] = useState<EnrichedEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [reqsSnap, projectsSnap] = await Promise.all([
        getDocs(collection(db, 'dailyRequisitions')),
        getDocs(collection(db, 'projects')),
      ]);

      const projects = new Map(projectsSnap.docs.map(doc => [doc.id, (doc.data() as Project).projectName]));

      const data = reqsSnap.docs.map(doc => {
        const entry = doc.data() as DailyRequisitionEntry;
        // Convert Firestore timestamp to a formatted string
        const date = entry.date && (entry.date as any).toDate ? format((entry.date as any).toDate(), 'dd MMM, yyyy') : String(entry.date);
        return {
          ...entry,
          id: doc.id,
          date: date,
          projectName: projects.get(entry.projectId) || 'N/A',
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

  const handleMarkAsReceived = async () => {
    if (selectedIds.size === 0) return;
    try {
      await Promise.all(
        Array.from(selectedIds).map(id => 
          updateDoc(doc(db, 'dailyRequisitions', id), { status: 'Received' })
        )
      );
      toast({
        title: 'Success',
        description: `${selectedIds.size} entries marked as received.`,
      });
      setSelectedIds(new Set());
      fetchData();
    } catch (error) {
      console.error("Error updating entries: ", error);
      toast({ title: 'Error', description: 'Failed to mark entries as received.', variant: 'destructive' });
    }
  };

  const renderTable = (data: EnrichedEntry[]) => {
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
          <CardTitle>Pending Entries</CardTitle>
          <CardDescription>Select entries to mark them as received by the finance department.</CardDescription>
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
            <Button onClick={handleMarkAsReceived} disabled={selectedIds.size === 0}>
              Mark as Received
            </Button>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[50px]">
                  <Checkbox
                    checked={selectedIds.size === filteredData.length && filteredData.length > 0}
                    onCheckedChange={handleSelectAll}
                  />
                </TableHead>
                <TableHead>Reception No.</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Narration</TableHead>
                <TableHead className="text-right">Net Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}><TableCell colSpan={6}><Skeleton className="h-8" /></TableCell></TableRow>
                ))
              ) : filteredData.length > 0 ? (
                filteredData.map(entry => (
                  <TableRow key={entry.id}>
                    <TableCell>
                      <Checkbox
                        checked={selectedIds.has(entry.id)}
                        onCheckedChange={(checked) => {
                          const newIds = new Set(selectedIds);
                          if (checked) newIds.add(entry.id);
                          else newIds.delete(entry.id);
                          setSelectedIds(newIds);
                        }}
                      />
                    </TableCell>
                    <TableCell>{entry.receptionNo}</TableCell>
                    <TableCell>{entry.date}</TableCell>
                    <TableCell>{entry.projectName}</TableCell>
                    <TableCell>{entry.partyName}</TableCell>
                    <TableCell className="text-right">{new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(entry.netAmount)}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow><TableCell colSpan={6} className="text-center h-24">No entries found.</TableCell></TableRow>
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
          {renderTable(pendingEntries)}
        </TabsContent>
        <TabsContent value="received" className="mt-4">
          {renderTable(receivedEntries)}
        </TabsContent>
        <TabsContent value="cancelled" className="mt-4">
          {renderTable(cancelledEntries)}
        </TabsContent>
      </Tabs>
    </div>
  );
}
