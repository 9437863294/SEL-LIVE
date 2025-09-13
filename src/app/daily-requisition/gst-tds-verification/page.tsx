

'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, updateDoc, doc, query, where, orderBy } from 'firebase/firestore';
import type { DailyRequisitionEntry, Project, User } from '@/lib/types';
import { format } from 'date-fns';
import { GstTdsVerificationDialog } from '@/components/GstTdsVerificationDialog';


interface EnrichedEntry extends DailyRequisitionEntry {
  projectName: string;
  receivedBy?: string;
  receivedAt?: string;
}

export default function GstTdsVerificationPage() {
  const { toast } = useToast();
  const [entries, setEntries] = useState<EnrichedEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  
  const [isVerifyDialogOpen, setIsVerifyDialogOpen] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<EnrichedEntry | null>(null);


  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [reqsSnap, projectsSnap, usersSnap] = await Promise.all([
        getDocs(query(collection(db, 'dailyRequisitions'), where('status', 'in', ['Received', 'Verified']))),
        getDocs(collection(db, 'projects')),
        getDocs(collection(db, 'users')),
      ]);

      const projectsMap = new Map(projectsSnap.docs.map(doc => [doc.id, (doc.data() as Project).projectName]));
      const usersMap = new Map(usersSnap.docs.map(u => [u.id, u.email]));

      const data = reqsSnap.docs.map(doc => {
        const entry = doc.data() as DailyRequisitionEntry & { receivedById?: string, receivedAt?: any };
        return {
          ...entry,
          id: doc.id,
          date: entry.date && (entry.date as any).toDate ? format((entry.date as any).toDate(), 'dd MMM, yyyy') : String(entry.date),
          receivedAt: entry.receivedAt && (entry.receivedAt as any).toDate ? format((entry.receivedAt as any).toDate(), 'PPpp') : undefined,
          projectName: projectsMap.get(entry.projectId) || 'N/A',
          receivedBy: entry.receivedById ? usersMap.get(entry.receivedById) : 'N/A',
        };
      });

      // Sort client-side to avoid needing a composite index
      data.sort((a, b) => {
          const dateA = a.receivedAt ? new Date(a.receivedAt).getTime() : 0;
          const dateB = b.receivedAt ? new Date(b.receivedAt).getTime() : 0;
          return dateB - dateA;
      });
      
      setEntries(data);
    } catch (error: any) {
      console.error("Error fetching entries: ", error);
      if (error.code === 'failed-precondition') {
          toast({
              title: 'Database Index Required',
              description: "This query may require a composite index. Please check your Firebase console.",
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
    fetchData();
  }, []);

  const handleOpenVerifyDialog = (entry: EnrichedEntry) => {
    setSelectedEntry(entry);
    setIsVerifyDialogOpen(true);
  };

  const renderTable = (data: EnrichedEntry[], type: 'pending' | 'verified') => {
    const filteredData = data.filter(entry => 
      entry.receptionNo.toLowerCase().includes(searchTerm.toLowerCase()) ||
      entry.projectName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (entry.receivedBy || '').toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
      <Card>
        <CardHeader>
          <CardTitle>{type === 'pending' ? 'Pending Verification' : 'Verified Entries'}</CardTitle>
          <CardDescription>
            {type === 'pending'
                ? 'Entries received by finance and awaiting GST/TDS verification.'
                : 'Entries that have been successfully verified.'
            }
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-end mb-4">
            <div className="relative w-full max-w-sm">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search entries..."
                className="pl-8"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reception No.</TableHead>
                <TableHead>Received At</TableHead>
                <TableHead>Received By</TableHead>
                <TableHead>Project</TableHead>
                <TableHead className="text-right">Net Amount</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}><TableCell colSpan={6}><Skeleton className="h-8" /></TableCell></TableRow>
                ))
              ) : filteredData.length > 0 ? (
                filteredData.map(entry => (
                  <TableRow key={entry.id}>
                    <TableCell>{entry.receptionNo}</TableCell>
                    <TableCell>{entry.receivedAt}</TableCell>
                    <TableCell>{entry.receivedBy}</TableCell>
                    <TableCell>{entry.projectName}</TableCell>
                    <TableCell className="text-right">{new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(entry.netAmount)}</TableCell>
                    <TableCell className="text-right">
                      {type === 'pending' ? (
                          <Button size="sm" onClick={() => handleOpenVerifyDialog(entry)}>Verify</Button>
                      ) : (
                          <span className="text-sm text-green-600 font-semibold">Verified</span>
                      )}
                    </TableCell>
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
  
  const pendingEntries = useMemo(() => entries.filter(e => e.status === 'Received'), [entries]);
  const verifiedEntries = useMemo(() => entries.filter(e => e.status === 'Verified'), [entries]);

  return (
    <>
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center gap-2">
          <Link href="/daily-requisition">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-6 w-6" />
            </Button>
          </Link>
          <h1 className="text-2xl font-bold">GST & TDS Verification</h1>
        </div>

        <Tabs defaultValue="pending">
          <TabsList>
            <TabsTrigger value="pending">Pending Verification</TabsTrigger>
            <TabsTrigger value="verified">Verified</TabsTrigger>
          </TabsList>
          <TabsContent value="pending" className="mt-4">
            {renderTable(pendingEntries, 'pending')}
          </TabsContent>
          <TabsContent value="verified" className="mt-4">
            {renderTable(verifiedEntries, 'verified')}
          </TabsContent>
        </Tabs>
      </div>

      <GstTdsVerificationDialog
        isOpen={isVerifyDialogOpen}
        onOpenChange={setIsVerifyDialogOpen}
        entry={selectedEntry}
        onSuccess={fetchData}
      />
    </>
  );
}
