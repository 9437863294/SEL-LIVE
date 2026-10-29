'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Upload, Files, ShieldAlert } from 'lucide-react';

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
import { useAuth } from '@/components/auth/AuthProvider';
import {
  dailyPageContainerClass,
  dailyQueueStatClass,
  dailyQueueTabClass,
  dailyQueueTabListClass,
  dailySurfaceCardClass,
} from '@/components/daily-requisition/module-shell';
import { formatINRCompact } from '@/lib/bill-tracking/money';
import { PageHeader } from '@/components/shared/page-header';
import { StatusBadge } from '@/components/shared/status-badge';
import { TableCard } from '@/components/shared/table-card';
import { BtToolbar, ToolbarSearch, ToolbarSelect } from '@/components/bill-tracking/bt-toolbar';
import { DR_DATE_PRESETS, resolveDatePreset, type DRDatePreset } from '@/lib/daily-requisition-settings';
import { useActivityLogger } from '@/hooks/useActivityLogger';
import { ACTIVITY_MODULES } from '@/lib/activity-modules';

type DocumentsTab = 'pending' | 'uploaded' | 'missing';

/** A row of the lists: tight and striped, like the module's other registers. A click opens its documents. */
const STRIPED_ROW = 'cursor-pointer border-slate-100 even:bg-slate-50 hover:bg-emerald-50';

const DAY_MS = 24 * 60 * 60 * 1000;
const formatCurrency = (amount: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);

type EnrichedDailyRequisitionEntry = DailyRequisitionEntry & {
  id: string;
  projectName: string;
  dateText?: string;
  /** Its date as a local yyyy-MM-dd, for the Period filter; '' without one. */
  dateKey?: string;
  createdAtText?: string;
  documentStatusUpdatedAtText?: string;
  /** When its document status last changed, as a local yyyy-MM-dd; '' if never. */
  documentStatusUpdatedKey?: string;
};

export default function ManageDocumentsPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { log } = useActivityLogger(ACTIVITY_MODULES.DAILY_REQUISITION);

  const [requisitions, setRequisitions] = useState<EnrichedDailyRequisitionEntry[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // The whole-page skeleton is for the first load only; a refresh after an action shows skeleton
  // rows inside the table, so the chosen tab and search stay on screen.
  const [hasLoaded, setHasLoaded] = useState(false);
  const [activeTab, setActiveTab] = useState<DocumentsTab>('pending');
  const [searchTerm, setSearchTerm] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const [rangePreset, setRangePreset] = useState<DRDatePreset>('all');
  const [todayKey] = useState(() => format(new Date(), 'yyyy-MM-dd'));
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
          dateKey: dateObj ? format(dateObj, 'yyyy-MM-dd') : '',
          createdAtText: createdAtObj ? format(createdAtObj, 'dd MMM, yyyy HH:mm') : data.createdAt ? String(data.createdAt) : '',
          documentStatusUpdatedAtText: docUpdatedAtObj ? format(docUpdatedAtObj, 'dd MMM, yy HH:mm') : undefined,
          documentStatusUpdatedKey: docUpdatedAtObj ? format(docUpdatedAtObj, 'yyyy-MM-dd') : '',
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

  /** The projects the requisitions belong to, for the Project filter. */
  const projectOptions = useMemo(
    () =>
      [...new Map(requisitions.filter((req) => req.projectId).map((req) => [req.projectId, req.projectName || req.projectId])).entries()]
        .map(([value, label]) => ({ value, label }))
        .sort((a, b) => a.label.localeCompare(b.label, 'en-IN')),
    [requisitions],
  );

  const { pendingUploads, uploadedList, missingList } = useMemo(() => {
    const pending: EnrichedDailyRequisitionEntry[] = [];
    const uploaded: EnrichedDailyRequisitionEntry[] = [];
    const missing: EnrichedDailyRequisitionEntry[] = [];
    const needle = searchTerm.trim().toLowerCase();
    // The period as an inclusive yyyy-MM-dd range on the requisition's date; none for all time.
    const range = resolveDatePreset(rangePreset);
    const from = range ? format(range.from, 'yyyy-MM-dd') : '';
    const to = range ? format(range.to, 'yyyy-MM-dd') : '';

    requisitions.forEach((req) => {
      if (
        needle &&
        !(req.receptionNo || '').toLowerCase().includes(needle) &&
        !req.projectName.toLowerCase().includes(needle) &&
        !(req.partyName || '').toLowerCase().includes(needle)
      ) {
        return;
      }
      if (projectFilter && req.projectId !== projectFilter) return;
      if (range && (!req.dateKey || req.dateKey < from || req.dateKey > to)) return;
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
  }, [requisitions, searchTerm, projectFilter, rangePreset]);
  const activeFilterCount = [searchTerm.trim(), projectFilter, rangePreset !== 'all'].filter(Boolean).length;

  const openDialog = (req: DailyRequisitionEntry) => {
    setSelectedRequisition(req);
    setIsDialogOpen(true);
  };

  const handleUpdateStatus = async (id: string, status: 'Missing' | 'Not Required' | 'Pending') => {
    if (!user) {
      toast({ title: 'Error', description: 'You must be logged in.', variant: 'destructive' });
      return;
    }
    const before = requisitions.find((r) => r.id === id);
    try {
      const reqRef = doc(db, 'dailyRequisitions', id);
      await updateDoc(reqRef, {
        documentStatus: status,
        documentStatusUpdatedById: user.id,
        documentStatusUpdatedAt: Timestamp.now(),
      });
      void log(
        'Update Requisition Document Status',
        {
          receptionNo: before?.receptionNo ?? null,
          partyName: before?.partyName ?? null,
          from: before?.documentStatus ?? null,
          to: status,
          attachmentCount: before?.attachments?.length ?? 0,
        },
        { recordId: id, recordRef: before?.receptionNo || undefined },
      );
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
          {/* Tight rows, one line each: the app's compact table density, whatever the Table rows setting. */}
          <Table className="[--table-cell-py:0.375rem] [--table-head-h:2.25rem]">
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
                  <TableRow key={req.id} className={STRIPED_ROW}>
                    <TableCell className="whitespace-nowrap font-medium" onClick={() => openDialog(req)}>
                      {req.receptionNo}
                    </TableCell>
                    <TableCell onClick={() => openDialog(req)}>
                      <span className="block max-w-[220px] truncate" title={req.projectName || undefined}>
                        {req.projectName || '—'}
                      </span>
                    </TableCell>
                    <TableCell onClick={() => openDialog(req)}>
                      <span className="block max-w-[240px] truncate" title={req.partyName || undefined}>
                        {req.partyName}
                      </span>
                    </TableCell>
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
                      <TableCell className="whitespace-nowrap" onClick={() => openDialog(req)}>
                        {req.documentStatusUpdatedById ? usersMap.get(req.documentStatusUpdatedById) : 'N/A'}
                      </TableCell>
                    )}
                    <TableCell className="text-right">
                      {type === 'pending' ? (
                        // The three actions in the row itself, one click each. Short labels keep the
                        // row on one line; the full wording is on hover. One the user may not take
                        // stays in place, greyed, so every row lines up.
                        <div className="inline-flex items-center justify-end gap-1.5 whitespace-nowrap">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2.5 text-xs"
                            title={canUpload ? 'Upload documents' : 'You do not have permission to upload'}
                            onClick={(e) => {
                              e.stopPropagation();
                              openDialog(req);
                            }}
                            disabled={!canUpload}
                          >
                            <Upload className="mr-1.5 h-3.5 w-3.5" /> Upload
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2.5 text-xs"
                            title={canMarkMissing ? 'Mark as Missing' : 'You do not have permission to mark as missing'}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleUpdateStatus(req.id, 'Missing');
                            }}
                            disabled={!canMarkMissing}
                          >
                            Missing
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2.5 text-xs"
                            title={canMarkNotRequired ? 'Mark as Not Required' : 'You do not have permission to mark as not required'}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleUpdateStatus(req.id, 'Not Required');
                            }}
                            disabled={!canMarkNotRequired}
                          >
                            Not required
                          </Button>
                        </div>
                      ) : type === 'missing' ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2.5 text-xs"
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
                          className="h-7 px-2.5 text-xs"
                          onClick={(e) => {
                            e.stopPropagation();
                            openDialog(req);
                          }}
                        >
                          <Files className="mr-1.5 h-3.5 w-3.5" /> Manage
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
      <div className={`${dailyPageContainerClass} space-y-3`}>
        <Skeleton className="h-44 w-full rounded-xl" />
        <Skeleton className="h-96 w-full rounded-xl" />
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

  // The figures beside the tabs read what the tabs show, filters applied.
  const shown = [...pendingUploads, ...uploadedList, ...missingList];
  const updatedToday = shown.filter((req) => req.documentStatusUpdatedKey === todayKey).length;
  const todayMs = new Date(`${todayKey}T00:00`).getTime();
  const oldestPendingDays = pendingUploads.reduce<number | null>((oldest, req) => {
    if (!req.dateKey) return oldest;
    const days = Math.max(0, Math.round((todayMs - new Date(`${req.dateKey}T00:00`).getTime()) / DAY_MS));
    return oldest === null || days > oldest ? days : oldest;
  }, null);
  const filesOnRecord = uploadedList.reduce((sum, req) => sum + (req.attachments?.length || 0), 0);

  const documentTabs = [
    { value: 'pending', label: 'Pending', list: pendingUploads, hint: 'Documents still to upload' },
    { value: 'uploaded', label: 'Uploaded', list: uploadedList, hint: 'Documents on file' },
    { value: 'missing', label: 'Missing / N.R.', list: missingList, hint: 'Marked missing or not required' },
  ] as const;

  return (
    <>
      <div className={dailyPageContainerClass}>
        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as DocumentsTab)} className="space-y-3">
          {/* One card, as on the workflow stages: the page; its tabs and figures as one row of cells;
              then Bill Tracking's filter toolbar, as on the Bill Register. */}
          <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
            {/* A `space-y-*` parent: globals.css then drops the header's own bottom margin. */}
            <div className="space-y-0 px-4 pb-1 pt-3 sm:px-5 sm:pt-4">
              <PageHeader
                backHref="/daily-requisition"
                breadcrumbs={[{ label: 'Daily Requisition', href: '/daily-requisition' }, { label: 'Manage Documents' }]}
                title="Manage Documents"
              />
            </div>

            <div className="grid gap-px border-y bg-border lg:grid-cols-[3fr_2fr]">
              <TabsList
                indicator={false}
                className={dailyQueueTabListClass}
                style={{ gridTemplateColumns: `repeat(${documentTabs.length}, minmax(0, 1fr))` }}
              >
                {documentTabs.map((tab) => {
                  const amount = tab.list.reduce((sum, req) => sum + (Number(req.netAmount) || 0), 0);
                  return (
                    <TabsTrigger key={tab.value} value={tab.value} className={dailyQueueTabClass} title={tab.hint}>
                      <span className="flex max-w-full items-center gap-2">
                        <span className="truncate text-sm font-medium text-muted-foreground group-data-[state=active]/tab:text-primary">{tab.label}</span>
                        <span className="shrink-0 rounded-full bg-muted px-2 text-xs font-semibold leading-5 tabular-nums text-foreground group-data-[state=active]/tab:bg-[image:var(--sel-tab-gradient)] group-data-[state=active]/tab:text-[color:var(--sel-tab-on)]">
                          {tab.list.length.toLocaleString('en-IN')}
                        </span>
                      </span>
                      {/* To the paisa from `sm`; shortened on a phone, where a third of the width can't hold it. */}
                      <span
                        className="max-w-full truncate font-mono text-base font-semibold leading-tight tabular-nums text-muted-foreground group-data-[state=active]/tab:text-foreground"
                        title={formatCurrency(amount)}
                      >
                        <span className="sm:hidden">{formatINRCompact(amount)}</span>
                        <span className="hidden sm:inline">{formatCurrency(amount)}</span>
                      </span>
                    </TabsTrigger>
                  );
                })}
              </TabsList>
              <dl className="grid grid-cols-3 gap-px">
                {[
                  { label: 'Updated today', value: updatedToday.toLocaleString('en-IN') },
                  { label: 'Oldest pending', value: oldestPendingDays === null ? '—' : `${oldestPendingDays} d` },
                  { label: 'Files on record', value: filesOnRecord.toLocaleString('en-IN') },
                ].map((stat) => (
                  <div key={stat.label} className={dailyQueueStatClass}>
                    <dt className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{stat.label}</dt>
                    <dd className="mt-1 truncate font-mono text-base font-semibold leading-tight tabular-nums text-foreground">{stat.value}</dd>
                  </div>
                ))}
              </dl>
            </div>

            <div className="bg-muted/40 px-4 py-2.5 sm:px-5">
            <BtToolbar
              framed={false}
              search={
                <ToolbarSearch
                  className="flex-1 sm:w-72 sm:flex-none"
                  placeholder="Search reception no., project, party…"
                  value={searchTerm}
                  onChange={setSearchTerm}
                />
              }
              controls={
                <>
                  <ToolbarSelect
                    label="Period"
                    value={rangePreset === 'all' ? '' : rangePreset}
                    onChange={(value) => setRangePreset((value || 'all') as DRDatePreset)}
                    options={DR_DATE_PRESETS.filter((preset) => preset.value !== 'all')}
                    allLabel="All time"
                  />
                  <ToolbarSelect label="Project" value={projectFilter} onChange={setProjectFilter} options={projectOptions} allLabel="All projects" />
                </>
              }
              activeCount={activeFilterCount}
              onClear={() => {
                setSearchTerm('');
                setProjectFilter('');
                setRangePreset('all');
              }}
            />
            </div>
          </section>
          <TabsContent value="pending" className="mt-0">
            {renderTable(pendingUploads, 'pending')}
          </TabsContent>
          <TabsContent value="uploaded" className="mt-0">
            {renderTable(uploadedList, 'uploaded')}
          </TabsContent>
          <TabsContent value="missing" className="mt-0">
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
