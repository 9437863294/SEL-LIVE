'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, Upload, Files, ShieldAlert, MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, orderBy, query, doc, updateDoc, Timestamp } from 'firebase/firestore';
import type { DailyRequisitionEntry, User } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { RequisitionDocumentDialog } from '@/components/RequisitionDocumentDialog';
import { format } from 'date-fns';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useAuth } from '@/components/auth/AuthProvider';

/** Keep Firestore field types intact and add display-only fields */
type EnrichedDailyRequisitionEntry = DailyRequisitionEntry & {
  id: string;
  dateText?: string;
  createdAtText?: string;
  documentStatusUpdatedAtText?: string;
};

export default function ManageDocumentsPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { can, isLoading: isAuthLoading } = useAuthorization();

  const [requisitions, setRequisitions] = useState<EnrichedDailyRequisitionEntry[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedRequisition, setSelectedRequisition] = useState<DailyRequisitionEntry | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const canViewPage = can('View', 'Daily Requisition.Manage Documents');
  const canUpload = can('Upload', 'Daily Requisition.Manage Documents');
  const canDownload = can('Download', 'Daily Requisition.Manage Documents');
  const canMarkMissing = can('Mark as Missing', 'Daily Requisition.Manage Documents');
  const canMarkNotRequired = can('Mark as Not Required', 'Daily Requisition.Manage Documents');
  const canMoveToPending = can('Move to Pending', 'Daily Requisition.Manage Documents');

  const fetchRequisitions = async () => {
    setIsLoading(true);
    try {
      const [qSnap, usersSnap] = await Promise.all([
        getDocs(query(collection(db, 'dailyRequisitions'), orderBy('createdAt', 'desc'))),
        getDocs(collection(db, 'users')),
      ]);

      const entries: EnrichedDailyRequisitionEntry[] = qSnap.docs.map((d) => {
        const data = d.data() as Omit<DailyRequisitionEntry, 'id'> & {
          date?: any;
          createdAt?: any;
          documentStatusUpdatedAt?: any;
        };

        // derive documentStatus if missing
        let documentStatus = data.documentStatus;
        if (!documentStatus) {
          documentStatus = data.attachments && data.attachments.length > 0 ? 'Uploaded' : 'Pending';
        }

        const dateObj: Date | undefined = data.date?.toDate ? data.date.toDate() : undefined;
        const createdAtObj: Date | undefined = data.createdAt?.toDate ? data.createdAt.toDate() : undefined;
        const docUpdatedAtObj: Date | undefined = data.documentStatusUpdatedAt?.toDate
          ? data.documentStatusUpdatedAt.toDate()
          : undefined;

        return {
          ...(data as DailyRequisitionEntry),
          id: d.id,
          documentStatus,
          dateText: dateObj ? format(dateObj, 'dd MMM, yyyy') : (data.date ? String(data.date) : ''),
          createdAtText: createdAtObj ? format(createdAtObj, 'dd MMM, yyyy HH:mm') : (data.createdAt ? String(data.createdAt) : ''),
          documentStatusUpdatedAtText: docUpdatedAtObj ? format(docUpdatedAtObj, 'dd MMM, yy HH:mm') : undefined,
        };
      });

      setRequisitions(entries);
      setUsers(usersSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() } as User)));
    } catch (error) {
      console.error('Error fetching requisitions:', error);
      toast({ title: 'Error', description: 'Failed to load requisition entries.', variant: 'destructive' });
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
    const pending: EnrichedDailyRequisitionEntry[] = [];
    const uploaded: EnrichedDailyRequisitionEntry[] = [];
    const missing: EnrichedDailyRequisitionEntry[] = [];

    requisitions.forEach((req) => {
      switch (req.documentStatus) {
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
    if (!user) {
      toast({ title: 'Error', description: 'You must be logged in.', variant: 'destructive' });
      return;
    }
    try {
      const reqRef = doc(db, 'dailyRequisitions', id);
      await updateDoc(reqRef, {
        documentStatus: status,
        documentStatusUpdatedById: user.id,
        documentStatusUpdatedAt: Timestamp.now(), // keep Firestore type
      });
      toast({ title: 'Status Updated', description: `Entry marked as ${status}.` });
      fetchRequisitions();
    } catch (error) {
      console.error('Error updating status:', error);
      toast({ title: 'Error', description: 'Failed to update status.', variant: 'destructive' });
    }
  };

  const renderTable = (data: EnrichedDailyRequisitionEntry[], type: 'pending' | 'uploaded' | 'missing') => {
    const usersMap = new Map(users.map((u) => [u.id, u.name]));

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
                {(type === 'missing' || type === 'uploaded') && <TableHead>Timestamp</TableHead>}
                {type === 'missing' && <TableHead>Status</TableHead>}
                {type === 'missing' && <TableHead>Action Taken By</TableHead>}
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={type === 'pending' ? 4 : type === 'missing' ? 8 : 7}>
                      <Skeleton className="h-6 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : data.length > 0 ? (
                data.map((req) => (
                  <TableRow key={req.id}>
                    <TableCell className="font-medium" onClick={() => openDialog(req)}>
                      {req.receptionNo}
                    </TableCell>
                    <TableCell onClick={() => openDialog(req)}>{req.partyName}</TableCell>
                    <TableCell onClick={() => openDialog(req)}>{req.dateText}</TableCell>
                    {type === 'uploaded' && (
                      <TableCell onClick={() => openDialog(req)}>{req.attachments?.length || 0}</TableCell>
                    )}
                    {(type === 'missing' || type === 'uploaded') && (
                      <TableCell onClick={() => openDialog(req)}>
                        {req.documentStatusUpdatedAtText ?? 'N/A'}
                      </TableCell>
                    )}
                    {type === 'missing' && (
                      <TableCell onClick={() => openDialog(req)}>{req.documentStatus}</TableCell>
                    )}
                    {type === 'missing' && (
                      <TableCell onClick={() => openDialog(req)}>
                        {req.documentStatusUpdatedById ? usersMap.get(req.documentStatusUpdatedById) : 'N/A'}
                      </TableCell>
                    )}
                    <TableCell className="text-right">
                      {type === 'pending' ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              className="h-8 w-8 p-0"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <span className="sr-only">Open menu</span>
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => openDialog(req)} disabled={!canUpload}>
                              <Upload className="mr-2 h-4 w-4" /> Upload
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={(e) => {
                                e.stopPropagation();
                                handleUpdateStatus(req.id, 'Missing');
                              }}
                              disabled={!canMarkMissing}
                            >
                              Mark as Missing
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={(e) => {
                                e.stopPropagation();
                                handleUpdateStatus(req.id, 'Not Required');
                              }}
                              disabled={!canMarkNotRequired}
                            >
                              Mark as Not Required
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : type === 'missing' ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleUpdateStatus(req.id, 'Pending');
                          }}
                          disabled={!canMoveToPending}
                        >
                          Move to Pending
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(e) => {
                            e.stopPropagation();
                            openDialog(req);
                          }}
                        >
                          <Files className="mr-2 h-4 w-4" /> Manage
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={type === 'pending' ? 4 : type === 'missing' ? 8 : 7}
                    className="h-24 text-center"
                  >
                    No entries found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    );
  };

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
          <Link href="/daily-requisition">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-6 w-6" />
            </Button>
          </Link>
          <h1 className="text-xl font-bold">Manage Documents</h1>
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
            <Link href="/daily-requisition">
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-6 w-6" />
              </Button>
            </Link>
            <h1 className="text-xl font-bold">Manage Documents</h1>
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
        canDownload={canDownload}
      />
    </>
  );
}
