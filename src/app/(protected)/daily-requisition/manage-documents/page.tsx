'use client';

import { useState, useEffect, useMemo } from 'react';
import { Upload, Files, ShieldAlert, MoreHorizontal } from 'lucide-react';

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
import {
  DailyMetricCard,
  DailyPageHeader,
  dailyPageContainerClass,
  dailySurfaceCardClass,
  dailyTableHeaderClass,
  dailyTabsListClass,
} from '@/components/daily-requisition/module-shell';

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
          dateText: dateObj ? format(dateObj, 'dd MMM, yyyy') : data.date ? String(data.date) : '',
          createdAtText: createdAtObj ? format(createdAtObj, 'dd MMM, yyyy HH:mm') : data.createdAt ? String(data.createdAt) : '',
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
        documentStatusUpdatedAt: Timestamp.now(),
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
      <Card className={dailySurfaceCardClass}>
        <div className="h-1.5 w-full bg-gradient-to-r from-cyan-400 via-fuchsia-400 to-amber-300 opacity-70" />
        <CardContent className="p-0">
          <Table>
            <TableHeader className={dailyTableHeaderClass}>
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
                  <TableRow key={req.id} className="hover:bg-slate-50/70">
                    <TableCell className="font-medium" onClick={() => openDialog(req)}>
                      {req.receptionNo}
                    </TableCell>
                    <TableCell onClick={() => openDialog(req)}>{req.partyName}</TableCell>
                    <TableCell onClick={() => openDialog(req)}>{req.dateText}</TableCell>
                    {type === 'uploaded' && <TableCell onClick={() => openDialog(req)}>{req.attachments?.length || 0}</TableCell>}
                    {(type === 'missing' || type === 'uploaded') && (
                      <TableCell onClick={() => openDialog(req)}>{req.documentStatusUpdatedAtText ?? 'N/A'}</TableCell>
                    )}
                    {type === 'missing' && <TableCell onClick={() => openDialog(req)}>{req.documentStatus}</TableCell>}
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
      <div className={dailyPageContainerClass}>
        <Skeleton className="mb-6 h-10 w-80" />
        <div className="grid gap-4 md:grid-cols-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
        <Skeleton className="mt-6 h-96 w-full rounded-2xl" />
      </div>
    );
  }

  if (!canViewPage) {
    return (
      <div className={dailyPageContainerClass}>
        <DailyPageHeader
          title="Manage Documents"
          description="Track uploads, document exceptions, and recovery steps."
        />
        <Card className={dailySurfaceCardClass}>
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
      <div className={dailyPageContainerClass}>
        <DailyPageHeader
          title="Manage Documents"
          description="Keep attachments organized, highlight missing paperwork, and move resolved items back into the normal flow."
          meta={
            <>
              <span className="rounded-full border border-white/70 bg-white/70 px-3 py-1 text-xs text-slate-600 backdrop-blur">
                Support workflow
              </span>
              <span className="rounded-full border border-emerald-200/80 bg-emerald-50 px-3 py-1 text-xs text-emerald-700">
                {uploadedList.length} uploaded entries
              </span>
            </>
          }
        />

        <div className="mb-6 grid gap-4 md:grid-cols-3">
          <DailyMetricCard label="Pending Uploads" value={pendingUploads.length} hint="Need attachment action" />
          <DailyMetricCard label="Uploaded" value={uploadedList.length} hint="Documents already attached" />
          <DailyMetricCard label="Missing / N.R." value={missingList.length} hint="Exceptions and follow-up" />
        </div>

        <Tabs defaultValue="pending">
          <TabsList className={`${dailyTabsListClass} grid-cols-3`}>
            <TabsTrigger value="pending">Pending ({pendingUploads.length})</TabsTrigger>
            <TabsTrigger value="uploaded">Uploaded ({uploadedList.length})</TabsTrigger>
            <TabsTrigger value="missing">Missing / N.R. ({missingList.length})</TabsTrigger>
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
