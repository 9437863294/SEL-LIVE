
'use client';

import { useState, useEffect, useMemo, useCallback, Fragment } from 'react';
import Link from 'next/link';
import { ArrowLeft, View, Download, Trash2, File as FileIcon, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { db } from '@/lib/firebase';
import { collection, getDocs, orderBy, query, deleteDoc, doc, getDoc, Timestamp, where, collectionGroup } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';
import { format } from 'date-fns';
import type { JmcEntry, WorkflowStep, ActionLog, BoqItem, Bill, Project, Attachment } from '@/lib/types';
import ViewJmcEntryDialog from '@/components/billing-recon/ViewJmcEntryDialog';
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

type EnrichedJmcEntry = JmcEntry & {
  stageDates: Record<string, string>;
  certifiedJmcAttachment?: Attachment;
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

export default function JmcLogPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const params = useParams();
  const projectSlug = params.project as string;
  const [jmcEntries, setJmcEntries] = useState<EnrichedJmcEntry[]>([]);
  const [workflowSteps, setWorkflowSteps] = useState<WorkflowStep[]>([]);
  const [boqItems, setBoqItems] = useState<BoqItem[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [selectedEntry, setSelectedEntry] = useState<EnrichedJmcEntry | null>(null);
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

  const getStageDetails = (steps: WorkflowStep[], history: ActionLog[] = []) => {
    const stageDates: Record<string, string> = {};
    let certifiedJmcAttachment: Attachment | undefined = undefined;

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
        stageDates[step.name] = d ? format(d, 'dd-MM-yyyy') : '-';

        // Specifically find the attachment for "Certified JMC"
        if (step.name === 'Certified JMC' && latest.attachment) {
            certifiedJmcAttachment = latest.attachment;
        }
      } else {
        stageDates[step.name] = '-';
      }
    }
    return { stageDates, certifiedJmcAttachment };
  };

  const fetchAll = useCallback(async () => {
    if (!projectSlug) return;
    setIsLoading(true);
    try {
      const projectsQuery = query(collection(db, 'projects'));
      const projectsSnapshot = await getDocs(projectsQuery);
      const slugify = (text: string) => text.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]+/g, '');
      const projectData = projectsSnapshot.docs
        .map((doc) => ({ id: doc.id, ...doc.data() } as Project))
        .find((p) => slugify(p.projectName) === projectSlug);

      if (!projectData) {
        throw new Error("Project not found");
      }
      const projectId = projectData.id;
      
      const workflowRef = doc(db, 'workflows', 'jmc-workflow');
      const [workflowSnap, boqSnap, billsSnap, jmcSnap] = await Promise.all([
        getDoc(workflowRef),
        getDocs(query(collection(db, 'projects', projectId, 'boqItems'))),
        getDocs(query(collection(db, 'projects', projectId, 'bills'))),
        getDocs(query(collection(db, 'projects', projectId, 'jmcEntries'), orderBy('createdAt', 'desc'))),
      ]);

      const steps = (workflowSnap.exists() ? (workflowSnap.data().steps as WorkflowStep[]) : []) ?? [];
      setWorkflowSteps(steps);

      setBoqItems(
        boqSnap.docs.map((d) => ({ id: d.id, ...(stripId(d.data() as any)) } as BoqItem))
      );
      setBills(
        billsSnap.docs.map((d) => ({ id: d.id, ...(stripId(d.data() as any)) } as Bill))
      );

      const entries: EnrichedJmcEntry[] = jmcSnap.docs.map((d) => {
        const raw = d.data() as JmcEntry & { createdAt?: any; id?: string };
        const data = stripId(raw);
        const { total, certified } = computeTotals((data as any).items);
        const { stageDates, certifiedJmcAttachment } = getStageDetails(steps, (data as any).history as ActionLog[]);

        return {
          id: d.id,
          ...(data as any),
          createdAt: (data as any).createdAt,
          totalAmount: total,
          certifiedValue: certified,
          stageDates,
          certifiedJmcAttachment,
        };
      });

      setJmcEntries(entries);
    } catch (err) {
      console.error('Error fetching JMC entries: ', err);
      toast({
        title: 'Error',
        description: 'Failed to fetch JMC entries for this project.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  }, [projectSlug, toast]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const handleViewDetails = (entry: EnrichedJmcEntry) => {
    setSelectedEntry(entry);
    setIsViewOpen(true);
  };

  const handleExportAll = () => {
    if (!jmcEntries.length) return;

    const rows = jmcEntries.map((e) => {
      const jmcDate = toDateSafe((e as any).jmcDate) ?? toDateSafe((e as any).createdAt);
      const row: Record<string, any> = {
        'JMC No.': e.jmcNo,
        'JMC Date': jmcDate ? format(jmcDate, 'dd MMM, yyyy') : '-',
      };
      for (const step of workflowSteps) {
        row[step.name] = e.stageDates[step.name] || '-';
      }
      row['JMC Value'] = e.totalAmount;
      row['Certified Value'] = e.certifiedValue;
      row['Stage'] = e.stage;
      row['Status'] = e.status;
      return row;
    });

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'JMC Workflow Log');

    // Autosize columns
    const keys = Object.keys(rows[0] || {});
    const colWidths = keys.map((k) => ({
      wch: Math.max(12, k.length, ...rows.map((r) => String(r[k] ?? '').length)),
    }));
    (ws as any)['!cols'] = colWidths;

    XLSX.writeFile(wb, `jmc_workflow_log_${projectSlug}.xlsx`);
  };

  const handleDelete = async (entry: EnrichedJmcEntry) => {
    if (!projectSlug) return;
    try {
      const projectsQuery = query(collection(db, 'projects'));
      const projectsSnapshot = await getDocs(projectsQuery);
      const slugify = (text: string) => text.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]+/g, '');
      const projectData = projectsSnapshot.docs
        .map((doc) => ({ id: doc.id, ...doc.data() } as Project))
        .find((p) => slugify(p.projectName) === projectSlug);

      if (!projectData) {
        throw new Error("Project not found");
      }

      await deleteDoc(doc(db, 'projects', projectData.id, 'jmcEntries', entry.id!));
      await logUserActivity({
        userId,
        action: 'Delete JMC Entry',
        details: { project: projectSlug, jmcNo: entry.jmcNo, entryId: entry.id },
      });
      toast({ title: 'Deleted', description: `JMC ${entry.jmcNo} removed.` });
      fetchAll();
    } catch (err) {
      console.error(err);
      toast({ title: 'Error', description: 'Failed to delete JMC entry.', variant: 'destructive' });
    }
  };

  const skeletonCols = 9 + (workflowSteps?.length || 0);

  return (
    <>
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link href={`/billing-recon/${projectSlug}/jmc`}>
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-6 w-6" />
              </Button>
            </Link>
            <h1 className="text-2xl font-bold">JMC Log</h1>
          </div>
          <Button onClick={handleExportAll} disabled={jmcEntries.length === 0}>
            <Download className="mr-2 h-4 w-4" /> Export All as Excel
          </Button>
        </div>

        <Card>
          {/* Make the wide table scroll horizontally inside the card */}
          <CardContent className="p-0 overflow-x-auto">
            {/* Give the table a sensible min width so columns don’t squish */}
            <Table className="min-w-[1200px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="whitespace-nowrap">JMC No.</TableHead>
                  <TableHead className="whitespace-nowrap">JMC Date</TableHead>
                  {workflowSteps.map((step) => (
                    <TableHead key={step.id} className="whitespace-nowrap">
                      {step.name}
                    </TableHead>
                  ))}
                  <TableHead className="whitespace-nowrap">JMC Value</TableHead>
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
                ) : jmcEntries.length > 0 ? (
                  jmcEntries.map((entry) => {
                    const jmcDate = toDateSafe((entry as any).jmcDate) ?? toDateSafe(entry.createdAt);
                    return (
                      <TableRow key={entry.id} onClick={() => handleViewDetails(entry)} className="cursor-pointer">
                        <TableCell className="font-medium">{entry.jmcNo ?? '-'}</TableCell>
                        <TableCell>{jmcDate ? format(jmcDate, 'dd MMM, yyyy') : '-'}</TableCell>

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
                                variant="outline"
                                size="sm"
                                className="h-8"
                                onClick={(e) => { 
                                  e.stopPropagation(); 
                                  if (entry.certifiedJmcAttachment?.url) {
                                    window.open(entry.certifiedJmcAttachment.url, '_blank');
                                  } else {
                                    handleViewDetails(entry);
                                  }
                                }}
                                aria-label="View"
                              >
                                {entry.certifiedJmcAttachment?.url ? (
                                    <>
                                        <FileIcon className="mr-2 h-4 w-4" /> View Doc
                                    </>
                                ) : (
                                     <>
                                        <Eye className="mr-2 h-4 w-4" /> View Details
                                    </>
                                )}
                              </Button>

                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="text-destructive h-8 w-8"
                                  aria-label="Delete"
                                  onClick={e => e.stopPropagation()}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent onClick={e => e.stopPropagation()}>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    This will permanently delete JMC {entry.jmcNo}. This action cannot be undone.
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
                      No JMC entries found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <ViewJmcEntryDialog
        isOpen={isViewOpen}
        onOpenChange={setIsViewOpen}
        jmcEntry={selectedEntry}
        boqItems={boqItems}
        bills={bills}
        isEditMode={false}
        isLoading={false}
      />
    </>
  );
}

    