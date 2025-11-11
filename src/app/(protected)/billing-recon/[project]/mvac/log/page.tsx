
'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeft, Eye, Download, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { db } from '@/lib/firebase';
import {
  collection,
  getDocs,
  orderBy,
  query as fsQuery,
  deleteDoc,
  doc,
  getDoc,
  Timestamp,
  where,
} from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';
import { format } from 'date-fns';
import type { MvacEntry, WorkflowStep, ActionLog, BoqItem, Bill, Project } from '@/lib/types';
import ViewMvacEntryDialog from '@/components/billing-recon/ViewMvacEntryDialog';
import { useParams } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { logUserActivity } from '@/lib/activity-logger';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import * as XLSX from 'xlsx';
import { Badge } from '@/components/ui/badge';

/* ---------- helpers ---------- */
function toDateSafe(value: any): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (value instanceof Timestamp) return value.toDate();
  if (typeof value === 'number') return new Date(value);
  if (typeof value === 'string') {
    const d = new Date(value);
    return isNaN(+d) ? null : d;
  }
  if (value?.seconds) return new Date(value.seconds * 1000);
  return null;
}

function formatCurrency(amount: number) {
  const n = Number.isFinite(amount) ? amount : 0;
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(n);
  } catch {
    return `₹${n.toFixed(2)}`;
  }
}

type EnrichedMvacEntry = MvacEntry & {
  stageDates: Record<string, string>;
  totalAmount: number;
  certifiedValue: number;
};

/* pick the latest approving action per step */
const APPROVE_ACTIONS = new Set(['Approve', 'Complete', 'Verified']);

/* remove any id field coming from Firestore doc data to avoid TS2783 (duplicate keys) */
function stripId<T extends object>(obj: T & { id?: any }): Omit<T, 'id'> {
  const { id: _ignored, ...rest } = obj as any;
  return rest as Omit<T, 'id'>;
}

export default function MvacLogPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const params = useParams();
  const projectSlug = params.project as string;

  const [mvacEntries, setMvacEntries] = useState<EnrichedMvacEntry[]>([]);
  const [workflowSteps, setWorkflowSteps] = useState<WorkflowStep[]>([]);
  const [boqItems, setBoqItems] = useState<BoqItem[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [selectedEntry, setSelectedEntry] = useState<EnrichedMvacEntry | null>(null);
  const [isViewOpen, setIsViewOpen] = useState(false);

  const userId = (user as any)?.id ?? (user as any)?.uid ?? 'unknown';

  const computeTotals = (items: any[] = []) => {
    let total = 0;
    let certified = 0;
    for (const it of items) {
      const rate = Number(it?.rate ?? 0);
      const explicit = Number(it?.totalAmount ?? NaN);
      const qtyForTotal = Number.isFinite(explicit)
        ? null
        : Number(it?.certifiedQty ?? it?.executedQty ?? 0);
      total += Number.isFinite(explicit)
        ? explicit
        : Number.isFinite(qtyForTotal) && Number.isFinite(rate)
        ? (qtyForTotal as number) * rate
        : 0;

      const certQty = Number(it?.certifiedQty ?? 0);
      certified += Number.isFinite(certQty) && Number.isFinite(rate) ? certQty * rate : 0;
    }
    return { total, certified };
  };

  const buildStageDates = (steps: WorkflowStep[], history: ActionLog[] = []) => {
    const map: Record<string, string> = {};
    for (const step of steps) {
      const logsForStep = history.filter(
        (h) => h.stepName === step.name && APPROVE_ACTIONS.has(h.action)
      );
      if (logsForStep.length) {
        // latest completion for the step
        const latest = logsForStep.reduce((a, b) => {
          const da = toDateSafe(a.timestamp) ?? new Date(0);
          const db = toDateSafe(b.timestamp) ?? new Date(0);
          return db > da ? b : a;
        });
        const d = toDateSafe(latest.timestamp);
        map[step.name] = d ? format(d, 'dd-MM-yyyy') : '-';
      } else {
        map[step.name] = '-';
      }
    }
    return map;
  };

  const fetchAll = useCallback(async () => {
    if (!projectSlug) return;
    setIsLoading(true);
    try {
      const projectsQuery = fsQuery(collection(db, 'projects'));
      const projectsSnapshot = await getDocs(projectsQuery);
      const slugify = (text: string) => text.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]+/g, '');
      const projectData = projectsSnapshot.docs
        .map((doc) => ({ id: doc.id, ...doc.data() } as Project))
        .find((p) => slugify(p.projectName) === projectSlug);

      if (!projectData) {
        throw new Error("Project not found");
      }
      const projectId = projectData.id;
      
      const workflowRef = doc(db, 'workflows', 'mvac-workflow');
      const [workflowSnap, boqSnap, billsSnap, mvacSnap] = await Promise.all([
        getDoc(workflowRef),
        getDocs(fsQuery(collection(db, 'projects', projectId, 'boqItems'))),
        getDocs(fsQuery(collection(db, 'projects', projectId, 'bills'))),
        getDocs(fsQuery(collection(db, 'projects', projectId, 'mvacEntries'), orderBy('createdAt', 'desc'))),
      ]);

      const steps = (workflowSnap.exists() ? (workflowSnap.data().steps as WorkflowStep[]) : []) ?? [];
      setWorkflowSteps(steps);

      setBoqItems(
        boqSnap.docs.map((d) => ({ id: d.id, ...(stripId(d.data() as any)) } as BoqItem))
      );
      setBills(
        billsSnap.docs.map((d) => ({ id: d.id, ...(stripId(d.data() as any)) } as Bill))
      );

      const entries: EnrichedMvacEntry[] = mvacSnap.docs.map((d) => {
        const raw = d.data() as MvacEntry & { createdAt?: any; id?: string };
        const data = stripId(raw);
        const { total, certified } = computeTotals((data as any).items);
        const stageDates = buildStageDates(steps, (data as any).history as ActionLog[]);

        return {
          id: d.id,
          ...(data as any),
          createdAt: (data as any).createdAt,
          totalAmount: total,
          certifiedValue: certified,
          stageDates,
        };
      });

      setMvacEntries(entries);
    } catch (err) {
      console.error('Error fetching MVAC entries: ', err);
      toast({
        title: 'Error',
        description: 'Failed to fetch MVAC entries for this project.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  }, [projectSlug, toast]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const handleViewDetails = (entry: EnrichedMvacEntry) => {
    setSelectedEntry(entry);
    setIsViewOpen(true);
  };

  const handleExportAll = () => {
    if (!mvacEntries.length) return;

    const rows = mvacEntries.map((e) => {
      const mvacDate = toDateSafe((e as any).mvacDate) ?? toDateSafe((e as any).createdAt);
      const row: Record<string, any> = {
        'MVAC No.': e.mvacNo,
        'MVAC Date': mvacDate ? format(mvacDate, 'dd MMM, yyyy') : '-',
      };
      for (const step of workflowSteps) {
        row[step.name] = e.stageDates[step.name] || '-';
      }
      row['MVAC Value'] = e.totalAmount;
      row['Certified Value'] = e.certifiedValue;
      row['Stage'] = e.stage;
      row['Status'] = e.status;
      return row;
    });

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'MVAC Workflow Log');

    // Autosize columns
    const keys = Object.keys(rows[0] || {});
    const colWidths = keys.map((k) => ({
      wch: Math.max(12, k.length, ...rows.map((r) => String(r[k] ?? '').length)),
    }));
    (ws as any)['!cols'] = colWidths;

    XLSX.writeFile(wb, `mvac_workflow_log_${projectSlug}.xlsx`);
  };

  const handleDelete = async (entry: EnrichedMvacEntry) => {
    if (!projectSlug) return;
    try {
      const projectsQuery = fsQuery(collection(db, 'projects'));
      const projectsSnapshot = await getDocs(projectsQuery);
      const slugify = (text: string) => text.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]+/g, '');
      const projectData = projectsSnapshot.docs
        .map((doc) => ({ id: doc.id, ...doc.data() } as Project))
        .find((p) => slugify(p.projectName) === projectSlug);

      if (!projectData) {
        throw new Error("Project not found");
      }

      await deleteDoc(doc(db, 'projects', projectData.id, 'mvacEntries', entry.id!));
      await logUserActivity({
        userId,
        action: 'Delete MVAC Entry',
        details: { project: projectSlug, mvacNo: entry.mvacNo, entryId: entry.id },
      });
      toast({ title: 'Deleted', description: `MVAC ${entry.mvacNo} removed.` });
      fetchAll();
    } catch (err) {
      console.error(err);
      toast({ title: 'Error', description: 'Failed to delete MVAC entry.', variant: 'destructive' });
    }
  };

  const skeletonCols = 8 + (workflowSteps?.length || 0);

  return (
    <>
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link href={`/billing-recon/${projectSlug}/mvac`}>
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-6 w-6" />
              </Button>
            </Link>
            <h1 className="text-2xl font-bold">MVAC Log</h1>
          </div>
          <Button onClick={handleExportAll} disabled={mvacEntries.length === 0}>
            <Download className="mr-2 h-4 w-4" /> Export All as Excel
          </Button>
        </div>

        <Card>
          {/* Make the wide table scroll horizontally inside the card */}
          <CardContent className="p-0 overflow-x-auto">
            {/* Give the table a sensible min width so columns don’t squish */}
            <Table className="min-w-[1000px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="whitespace-nowrap">MVAC No.</TableHead>
                  <TableHead className="whitespace-nowrap">MVAC Date</TableHead>
                  {workflowSteps.map((step) => (
                    <TableHead key={step.id} className="whitespace-nowrap">
                      {step.name}
                    </TableHead>
                  ))}
                  <TableHead className="whitespace-nowrap">MVAC Value</TableHead>
                  <TableHead className="whitespace-nowrap">Certified Value</TableHead>
                  <TableHead className="whitespace-nowrap">Stage</TableHead>
                  <TableHead className="whitespace-nowrap">Stage Status</TableHead>
                  <TableHead className="text-right whitespace-nowrap">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      {/* one skeleton cell spanning the visible columns */}
                      <TableCell colSpan={skeletonCols}>
                        <Skeleton className="h-5" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : mvacEntries.length > 0 ? (
                  mvacEntries.map((entry) => {
                    const mvacDate = toDateSafe((entry as any).mvacDate) ?? toDateSafe(entry.createdAt);
                    return (
                      <TableRow key={entry.id}>
                        <TableCell className="font-medium">{entry.mvacNo ?? '-'}</TableCell>
                        <TableCell>{mvacDate ? format(mvacDate, 'dd MMM, yyyy') : '-'}</TableCell>

                        {workflowSteps.map((step) => (
                          <TableCell key={step.id}>{entry.stageDates[step.name] ?? '-'}</TableCell>
                        ))}

                        <TableCell>{formatCurrency(entry.totalAmount)}</TableCell>
                        <TableCell>{formatCurrency(entry.certifiedValue)}</TableCell>
                        <TableCell>{entry.stage ?? '-'}</TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              entry.status === 'Completed'
                                ? 'default'
                                : entry.status === 'Rejected' || entry.status === 'Cancelled'
                                ? 'destructive'
                                : 'secondary'
                            }
                          >
                            {entry.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex gap-1 justify-end">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => handleViewDetails(entry)}
                              aria-label="View"
                            >
                              <Eye className="h-4 w-4" />
                            </Button>

                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="text-destructive h-8 w-8"
                                  aria-label="Delete"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Delete MVAC entry?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    This will permanently delete MVAC {entry.mvacNo}. This action cannot be undone.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => handleDelete(entry)}>
                                    Delete
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={skeletonCols} className="text-center h-24">
                      No MVAC entries found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <ViewMvacEntryDialog
        isOpen={isViewOpen}
        onOpenChange={setIsViewOpen}
        MvacEntry={selectedEntry as any}
        boqItems={boqItems}
        bills={bills}
        isEditMode={false}
        isLoading={false}
      />
    </>
  );
}
