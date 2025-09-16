
'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, Upload, Files, Loader2, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import type { DailyRequisitionEntry } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { RequisitionDocumentDialog } from '@/components/RequisitionDocumentDialog';

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
      const entries = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as DailyRequisitionEntry));
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
  }, [isAuthLoading, canViewPage]);

  const { pendingUploads, uploadedList } = useMemo(() => {
    const pending: DailyRequisitionEntry[] = [];
    const uploaded: DailyRequisitionEntry[] = [];
    requisitions.forEach(req => {
      if (!req.attachments || req.attachments.length === 0) {
        pending.push(req);
      } else {
        uploaded.push(req);
      }
    });
    return { pendingUploads: pending, uploadedList: uploaded };
  }, [requisitions]);

  const openDialog = (req: DailyRequisitionEntry) => {
    setSelectedRequisition(req);
    setIsDialogOpen(true);
  };
  
  const renderTable = (data: DailyRequisitionEntry[], type: 'pending' | 'uploaded') => {
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
                                <TableRow key={req.id}>
                                    <TableCell className="font-medium">{req.receptionNo}</TableCell>
                                    <TableCell>{req.partyName}</TableCell>
                                    <TableCell>{req.date}</TableCell>
                                    {type === 'uploaded' && <TableCell>{req.attachments?.length || 0}</TableCell>}
                                    <TableCell className="text-right">
                                        <Button size="sm" variant="outline" onClick={() => openDialog(req)}>
                                            {type === 'pending' ? <Upload className="mr-2 h-4 w-4" /> : <Files className="mr-2 h-4 w-4" />}
                                            {type === 'pending' ? 'Upload' : 'Manage'}
                                        </Button>
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
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="pending">Pending for Upload ({pendingUploads.length})</TabsTrigger>
            <TabsTrigger value="uploaded">Uploaded List ({uploadedList.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="pending" className="mt-4">
            {renderTable(pendingUploads, 'pending')}
          </TabsContent>
          <TabsContent value="uploaded" className="mt-4">
            {renderTable(uploadedList, 'uploaded')}
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
