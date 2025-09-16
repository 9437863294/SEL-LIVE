
'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, Upload, Files, Loader2, ShieldAlert, MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, orderBy, query, doc, updateDoc } from 'firebase/firestore';
import type { DailyRequisitionEntry } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { RequisitionDocumentDialog } from '@/components/RequisitionDocumentDialog';
import { format } from 'date-fns';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';


export default function ManageDocumentsPage() {
  const { toast } = useToast();
  const { can, isLoading: isAuthLoading } = useAuthorization();

  const [requisitions, setRequisitions] = useState<DailyRequisitionEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedRequisition, setSelectedRequisition] = useState<DailyRequisitionEntry | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  
  const canViewPage = can('View', 'Daily Requisition.Entry Sheet');
  const canUpload = can('Edit', 'Daily Requisition.Entry Sheet');

  const fetchRequisitions = async () => {
    setIsLoading(true);
    try {
      const q = query(collection(db, 'dailyRequisitions'), orderBy('createdAt', 'desc'));
      const querySnapshot = await getDocs(q);
      const entries = querySnapshot.docs.map(doc => {
          const data = doc.data() as Omit<DailyRequisitionEntry, 'id'>;
          // Set default documentStatus if it's missing
          if (!data.documentStatus) {
            data.documentStatus = (data.attachments && data.attachments.length > 0) ? 'Uploaded' : 'Pending';
          }
          return { 
              id: doc.id, 
              ...data,
              date: data.date && (data.date as any).toDate ? format((data.date as any).toDate(), 'dd MMM, yyyy') : data.date,
              createdAt: data.createdAt && (data.createdAt as any).toDate ? format((data.createdAt as any).toDate(), 'dd MMM, yyyy') : data.createdAt,
          } as DailyRequisitionEntry
      });
      setRequisitions(entries);
    } catch (error) {
      console.error("Error fetching requisitions:", error);
      toast({ title: "Error", description: "Failed to load requisition entries.", variant: "destructive" });
    }
    setIsLoading(false);
  };

  useEffect(() => {
    if (!isAuthLoading) {
      if (canViewPage) {
        fetchRequisitions();
      } else {
        setIsLoading(false);
      }
    }
  }, [isAuthLoading, canViewPage, toast]);

  const { pendingUploads, uploadedList, missingList } = useMemo(() => {
    const pending: DailyRequisitionEntry[] = [];
    const uploaded: DailyRequisitionEntry[] = [];
    const missing: DailyRequisitionEntry[] = [];

    requisitions.forEach(req => {
      switch(req.documentStatus) {
        case 'Uploaded':
          uploaded.push(req);
          break;
        case 'Missing':
        case 'Not Required':
          missing.push(req);
          break;
        case 'Pending':
        default:
          pending.push(req);
          break;
      }
    });
    return { pendingUploads: pending, uploadedList: uploaded, missingList: missing };
  }, [requisitions]);

  const openDialog = (req: DailyRequisitionEntry) => {
    setSelectedRequisition(req);
    setIsDialogOpen(true);
  };
  
  const handleUpdateStatus = async (id: string, status: 'Missing' | 'Not Required' | 'Pending') => {
    try {
        const reqRef = doc(db, 'dailyRequisitions', id);
        await updateDoc(reqRef, { documentStatus: status });
        toast({ title: 'Status Updated', description: `Entry marked as ${status}.`});
        fetchRequisitions(); // Refresh data
    } catch (error) {
        console.error("Error updating status:", error);
        toast({ title: 'Error', description: 'Failed to update status.', variant: 'destructive'});
    }
  }

  const renderTable = (data: DailyRequisitionEntry[], type: 'pending' | 'uploaded' | 'missing') => {
    return (
        <Card>
            <CardContent className="p-0">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Reception No.</TableHead>
                            <TableHead>Party Name</TableHead>
                            <TableHead>Date</TableHead>
                            {type === 'uploaded' && <TableHead>Attachments</TableHead>}
                            {type === 'missing' && <TableHead>Status</TableHead>}
                            <TableHead className="text-right">Action</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {isLoading ? (
                            Array.from({ length: 5 }).map((_, i) => (
                                <TableRow key={i}>
                                    <TableCell colSpan={type === 'pending' ? 4 : 5}>
                                        <Skeleton className="h-6 w-full" />
                                    </TableCell>
                                </TableRow>
                            ))
                        ) : data.length > 0 ? (
                            data.map(req => (
                                <TableRow key={req.id} onClick={() => openDialog(req)} className="cursor-pointer">
                                    <TableCell className="font-medium">{req.receptionNo}</TableCell>
                                    <TableCell>{req.partyName}</TableCell>
                                    <TableCell>{req.date}</TableCell>
                                    {type === 'uploaded' && <TableCell>{req.attachments?.length || 0}</TableCell>}
                                    {type === 'missing' && <TableCell>{req.documentStatus}</TableCell>}
                                    <TableCell className="text-right">
                                        {type === 'pending' ? (
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button variant="ghost" className="h-8 w-8 p-0" onClick={(e) => e.stopPropagation()}>
                                                        <span className="sr-only">Open menu</span>
                                                        <MoreHorizontal className="h-4 w-4" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end">
                                                    <DropdownMenuItem onSelect={() => openDialog(req)}>
                                                        <Upload className="mr-2 h-4 w-4" /> Upload
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem onSelect={() => handleUpdateStatus(req.id, 'Missing')}>
                                                        Mark as Missing
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem onSelect={() => handleUpdateStatus(req.id, 'Not Required')}>
                                                        Mark as Not Required
                                                    </DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        ) : type === 'missing' ? (
                                             <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); handleUpdateStatus(req.id, 'Pending'); }}>
                                                Move to Pending
                                            </Button>
                                        ) : (
                                            <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); openDialog(req); }}>
                                                <Files className="mr-2 h-4 w-4" /> Manage
                                            </Button>
                                        )}
                                    </TableCell>
                                </TableRow>
                            ))
                        ) : (
                             <TableRow>
                                <TableCell colSpan={type === 'pending' ? 4 : 5} className="h-24 text-center">
                                    No entries found.
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </CardContent>
        </Card>
    );
  }

  if (isAuthLoading || (isLoading && canViewPage)) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <Skeleton className="h-10 w-80 mb-6" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!canViewPage) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center gap-2">
          <Link href="/daily-requisition"><Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button></Link>
          <h1 className="text-2xl font-bold">Manage Documents</h1>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>You do not have permission to manage documents.</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center p-8">
            <ShieldAlert className="h-16 w-16 text-destructive" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <>
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link href="/daily-requisition"><Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button></Link>
            <h1 className="text-2xl font-bold">Manage Documents</h1>
          </div>
        </div>
        
        <Tabs defaultValue="pending">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="pending">Pending for Upload ({pendingUploads.length})</TabsTrigger>
            <TabsTrigger value="uploaded">Uploaded List ({uploadedList.length})</TabsTrigger>
            <TabsTrigger value="missing">Missing / Not Required ({missingList.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="pending" className="mt-4">
            {renderTable(pendingUploads, 'pending')}
          </TabsContent>
          <TabsContent value="uploaded" className="mt-4">
            {renderTable(uploadedList, 'uploaded')}
          </TabsContent>
          <TabsContent value="missing" className="mt-4">
            {renderTable(missingList, 'missing')}
          </TabsContent>
        </Tabs>
      </div>

      <RequisitionDocumentDialog
        isOpen={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        requisition={selectedRequisition}
        onUploadComplete={fetchRequisitions}
        canEdit={canUpload}
      />
    </>
  );
}
