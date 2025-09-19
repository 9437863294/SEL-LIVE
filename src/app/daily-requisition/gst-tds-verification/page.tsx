

'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, Search, MoreHorizontal, RotateCcw, ShieldAlert } from 'lucide-react';
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useAuthorization } from '@/hooks/useAuthorization';


interface EnrichedEntry extends DailyRequisitionEntry {
  projectName: string;
  receivedBy?: string;
  receivedAt?: string;
}

export default function GstTdsVerificationPage() {
  const { toast } = useToast();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  
  const [entries, setEntries] = useState<EnrichedEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  
  const [isVerifyDialogOpen, setIsVerifyDialogOpen] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<EnrichedEntry | null>(null);

  const canViewPage = can('View', 'Daily Requisition.GST & TDS Verification');
  const canVerify = can('Verify', 'Daily Requisition.GST & TDS Verification');
  const canReverify = can('Re-verify', 'Daily Requisition.GST & TDS Verification');
  const canReturnToPending = can('Return to Pending', 'Daily Requisition.GST & TDS Verification');


  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [reqsSnap, projectsSnap, usersSnap] = await Promise.all([
        getDocs(query(collection(db, 'dailyRequisitions'), where('status', 'in', ['Received', 'Verified', 'Needs Review']))),
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
    if(!isAuthLoading) {
        if(canViewPage) {
            fetchData();
        } else {
            setIsLoading(false);
        }
    }
  }, [isAuthLoading, canViewPage]);

  const handleOpenVerifyDialog = (entry: EnrichedEntry) => {
    setSelectedEntry(entry);
    setIsVerifyDialogOpen(true);
  };
  
  const handleReturnToPending = async (entry: EnrichedEntry) => {
    try {
        await updateDoc(doc(db, 'dailyRequisitions', entry.id), {
            status: 'Received',
            verifiedAt: null,
            igstAmount: 0,
            tdsAmount: 0,
            cgstAmount: 0,
            sgstAmount: 0,
            retentionAmount: 0,
            otherDeduction: 0,
            verificationNotes: '',
            gstNo: '',
        });
        toast({ title: 'Success', description: `${entry.receptionNo} returned to pending verification.` });
        fetchData();
    } catch (error) {
        console.error("Error returning entry:", error);
        toast({ title: 'Error', description: 'Failed to return the entry.', variant: 'destructive' });
    }
  }

  const renderTable = (data: EnrichedEntry[], type: 'pending' | 'verified' | 'needs-review') => {
    const filteredData = data.filter(entry => 
      entry.receptionNo.toLowerCase().includes(searchTerm.toLowerCase()) ||
      entry.projectName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (entry.receivedBy || '').toLowerCase().includes(searchTerm.toLowerCase())
    );

    const titleMap = {
        pending: 'Pending Verification',
        verified: 'Verified Entries',
        'needs-review': 'Needs Review',
    };
    const descriptionMap = {
        pending: 'Entries received by finance and awaiting GST/TDS verification.',
        verified: 'Entries that have been successfully verified.',
        'needs-review': 'Entries where the calculated amount mismatches the original. Please review and re-verify.',
    }

    return (
      <Card>
        <CardHeader>
          <CardTitle>{titleMap[type]}</CardTitle>
          <CardDescription>{descriptionMap[type]}</CardDescription>
        </CardHeader>
        <CardContent>
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
                          <Button size="sm" onClick={() => handleOpenVerifyDialog(entry)} disabled={!canVerify}>Verify</Button>
                      ) : (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8">
                                    <MoreHorizontal className="h-4 w-4" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                {canReverify && (
                                    <DropdownMenuItem onSelect={() => handleOpenVerifyDialog(entry)}>
                                        {type === 'verified' ? 'Re-verify' : 'Review & Verify'}
                                    </DropdownMenuItem>
                                )}
                                {canReturnToPending && (
                                    <DropdownMenuItem onSelect={() => handleReturnToPending(entry)} className="text-destructive">
                                        <RotateCcw className="mr-2 h-4 w-4" />
                                        Return to Pending
                                    </DropdownMenuItem>
                                )}
                            </DropdownMenuContent>
                          </DropdownMenu>
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
  const needsReviewEntries = useMemo(() => entries.filter(e => e.status === 'Needs Review'), [entries]);

  if(isAuthLoading || (isLoading && canViewPage)) {
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
            <h1 className="text-xl font-bold">GST & TDS Verification</h1>
        </div>
        <Card>
            <CardHeader><CardTitle>Access Denied</CardTitle><CardDescription>You do not have permission to view this page.</CardDescription></CardHeader>
            <CardContent className="flex justify-center p-8"><ShieldAlert className="h-16 w-16 text-destructive" /></CardContent>
        </Card>
      </div>
    );
  }


  return (
    <>
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center gap-2">
          <Link href="/daily-requisition">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-6 w-6" />
            </Button>
          </Link>
          <h1 className="text-xl font-bold">GST & TDS Verification</h1>
        </div>

        <Tabs defaultValue="pending">
          <TabsList>
            <TabsTrigger value="pending">Pending Verification</TabsTrigger>
            <TabsTrigger value="needs-review">Needs Review</TabsTrigger>
            <TabsTrigger value="verified">Verified</TabsTrigger>
          </TabsList>
          <TabsContent value="pending" className="mt-4">
            {renderTable(pendingEntries, 'pending')}
          </TabsContent>
          <TabsContent value="needs-review" className="mt-4">
            {renderTable(needsReviewEntries, 'needs-review')}
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
