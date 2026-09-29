'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Upload, Files, ShieldAlert, MoreHorizontal } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, orderBy, query, doc, updateDoc, Timestamp } from 'firebase/firestore';
import type { DailyRequisitionEntry, Project, User } from '@/lib/types';
import { withDesignations } from '@/lib/people-directory-client';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { RequisitionDocumentDialog } from '@/components/daily-requisition/RequisitionDocumentDialog';
import { format } from 'date-fns';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useAuth } from '@/components/auth/AuthProvider';
import {
  dailyPageContainerClass,
  dailySurfaceCardClass,
  dailyTabsListClass,
} from '@/components/daily-requisition/module-shell';
import { PageHeader } from '@/components/shared/page-header';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/shared/status-badge';
import { TableCard } from '@/components/shared/table-card';
import { SearchInput } from '@/components/shared/filter-bar';

type DocumentsTab = 'pending' | 'uploaded' | 'missing';

type EnrichedDailyRequisitionEntry = DailyRequisitionEntry & {
  id: string;
  projectName: string;
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
  // The whole-page skeleton is for the first load only; a refresh after an action shows skeleton
  // rows inside the table, so the chosen tab and search stay on screen.
  const [hasLoaded, setHasLoaded] = useState(false);
  const [activeTab, setActiveTab] = useState<DocumentsTab>('pending');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedRequisition, setSelectedRequisition] = useState<DailyRequisitionEntry | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const canViewPage = can('View', 'Daily Requisition.Manage Documents');
  const canUpload = can('Upload', 'Daily Requisition.Manage Documents');
  const canDownload = can('Download', 'Daily Requisition.Manage Documents');
  const canMarkMissing = can('Mark as Missing', 'Daily Requisition.Manage Documents');
  const canMarkNotRequired = can('Mark as Not Required', 'Daily Requisition.Manage Documents');
  const canMoveToPending = can('Move to Pending', 'Daily Requisition.Manage Documents');

  // Every state update here follows an await, so calling it from the effect below does not set
  // state synchronously inside the effect. `refreshRequisitions` is the one that shows the spinner.
  const fetchRequisitions = useCallback(async () => {
    try {
      const [qSnap, usersSnap, projectsSnap] = await Promise.all([
        getDocs(query(collection(db, 'dailyRequisitions'), orderBy('createdAt', 'desc'))),
        getDocs(collection(db, 'users')),
        getDocs(collection(db, 'projects')),
      ]);
      const projectNames = new Map(projectsSnap.docs.map((d) => [d.id, (d.data() as Project).projectName || '']));

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
          projectName: projectNames.get(data.projectId) || '',
          documentStatus,
          dateText: dateObj ? format(dateObj, 'dd MMM, yyyy') : data.date ? String(data.date) : '',
          createdAtText: createdAtObj ? format(createdAtObj, 'dd MMM, yyyy HH:mm') : data.createdAt ? String(data.createdAt) : '',
          documentStatusUpdatedAtText: docUpdatedAtObj ? format(docUpdatedAtObj, 'dd MMM, yy HH:mm') : undefined,
        };
      });

      setRequisitions(entries);
      setUsers(await withDesignations(usersSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() } as User))));
    } catch (error) {
      console.error('Error fetching requisitions:', error);
      toast({ title: 'Error', description: 'Failed to load requisition entries.', variant: 'destructive' });
    }
    setIsLoading(false);
    setHasLoaded(true);
  }, [toast]);

  const refreshRequisitions = useCallback(() => {
    setIsLoading(true);
    void fetchRequisitions();
  }, [fetchRequisitions]);

  // Without access the page renders its Access Denied card, whatever `isLoading` says.
  useEffect(() => {
    if (!isAuthLoading && canViewPage) void fetchRequisitions();
  }, [isAuthLoading, canViewPage, fetchRequisitions]);

  const { pendingUploads, uploadedList, missingList } = useMemo(() => {
    const pending: EnrichedDailyRequisitionEntry[] = [];
    const uploaded: EnrichedDailyRequisitionEntry[] = [];
    const missing: EnrichedDailyRequisitionEntry[] = [];
    const needle = searchTerm.trim().toLowerCase();

    requisitions.forEach((req) => {
      if (
        needle &&
        !(req.receptionNo || '').toLowerCase().includes(needle) &&
        !req.projectName.toLowerCase().includes(needle) &&
        !(req.partyName || '').toLowerCase().includes(needle)
      ) {
        return;
      }
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
  }, [requisitions, searchTerm]);

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
      refreshRequisitions();
    } catch (error) {
      console.error('Error updating status:', error);
      toast({ title: 'Error', description: 'Failed to update status.', variant: 'destructive' });
    }
  };

  const renderTable = (data: EnrichedDailyRequisitionEntry[], type: 'pending' | 'uploaded' | 'missing') => {
    const usersMap = new Map(users.map((u) => [u.id, u.name]));
    const columnCount = type === 'pending' ? 5 : type === 'uploaded' ? 7 : 8;

    return (
      <TableCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reception No.</TableHead>
                <TableHead>Project</TableHead>
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
                    <TableCell colSpan={columnCount}>
                      <Skeleton className="h-6 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : data.length > 0 ? (
                data.map((req) => (
                  <TableRow key={req.id}>
                    <TableCell className="whitespace-nowrap font-medium" onClick={() => openDialog(req)}>
                      {req.receptionNo}
                    </TableCell>
                    <TableCell onClick={() => openDialog(req)}>{req.projectName || '—'}</TableCell>
                    <TableCell onClick={() => openDialog(req)}>{req.partyName}</TableCell>
                    <TableCell className="whitespace-nowrap" onClick={() => openDialog(req)}>{req.dateText}</TableCell>
                    {type === 'uploaded' && <TableCell className="tabular-nums" onClick={() => openDialog(req)}>{req.attachments?.length || 0}</TableCell>}
                    {(type === 'missing' || type === 'uploaded') && (
                      <TableCell className="whitespace-nowrap" onClick={() => openDialog(req)}>{req.documentStatusUpdatedAtText ?? 'N/A'}</TableCell>
                    )}
                    {type === 'missing' && (
                      <TableCell className="whitespace-nowrap" onClick={() => openDialog(req)}>
                        {req.documentStatus ? <StatusBadge status={req.documentStatus}>{req.documentStatus}</StatusBadge> : null}
                      </TableCell>
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
                    colSpan={columnCount}
                    className="h-24 text-center"
                  >
                    No entries found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
      </TableCard>
    );
  };

  // Header, then the tabs-and-search row, then the register: the page's real layout.
  if (isAuthLoading || (canViewPage && !hasLoaded)) {
    return (
      <div className={dailyPageContainerClass}>
        <Skeleton className="mb-4 h-10 w-full max-w-80" />
        <div className="flex flex-col gap-3 lg:flex-row lg:justify-between">
          <Skeleton className="h-10 w-full rounded-xl lg:w-96" />
          <Skeleton className="h-10 w-full rounded-xl lg:w-96" />
        </div>
        <Skeleton className="mt-3 h-96 w-full rounded-2xl" />
      </div>
    );
  }

  if (!canViewPage) {
    return (
      <div className={dailyPageContainerClass}>
        <PageHeader backHref="/daily-requisition" eyebrow="Daily Requisition"
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
        <PageHeader backHref="/daily-requisition" eyebrow="Daily Requisition"
          title="Manage Documents"
          description="Keep attachments organized, highlight missing paperwork, and move resolved items back into the normal flow."
          badge={<Badge variant="neutral">Support workflow</Badge>}
        />

        {/* The counts live on the tabs; a card row repeating them only pushed the list down. */}
        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as DocumentsTab)}>
          {/* Tabs (with their counts) and search share one row, as on the workflow stage pages. On
              a phone the strip scrolls sideways instead of squeezing three labels into thirds. */}
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <TabsList className={`${dailyTabsListClass} flex w-full overflow-x-auto lg:inline-flex lg:w-auto`}>
              {(
                [
                  { value: 'pending', label: 'Pending', count: pendingUploads.length, hint: 'Documents still to upload' },
                  { value: 'uploaded', label: 'Uploaded', count: uploadedList.length, hint: 'Documents on file' },
                  { value: 'missing', label: 'Missing / N.R.', count: missingList.length, hint: 'Marked missing or not required' },
                ] as const
              ).map((tab) => (
                <TabsTrigger key={tab.value} value={tab.value} className="flex-1 whitespace-nowrap px-4 py-1.5 lg:flex-none" title={tab.hint}>
                  <span>{tab.label}</span>
                  <span className="ml-1.5 rounded-full bg-black/5 px-1.5 text-xs font-semibold tabular-nums">{tab.count}</span>
                </TabsTrigger>
              ))}
            </TabsList>
            <SearchInput
              className="w-full lg:w-96"
              placeholder="Search reception no., project, party…"
              value={searchTerm}
              onChange={setSearchTerm}
            />
          </div>
          <TabsContent value="pending" className="mt-3">
            {renderTable(pendingUploads, 'pending')}
          </TabsContent>
          <TabsContent value="uploaded" className="mt-3">
            {renderTable(uploadedList, 'uploaded')}
          </TabsContent>
          <TabsContent value="missing" className="mt-3">
            {renderTable(missingList, 'missing')}
          </TabsContent>
        </Tabs>
      </div>

      <RequisitionDocumentDialog
        isOpen={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        requisition={selectedRequisition}
        onUploadComplete={refreshRequisitions}
        canEdit={canUpload}
        canDownload={canDownload}
      />
    </>
  );
}
