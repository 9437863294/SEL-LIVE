
'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Check,
  Clock,
  Loader2,
  MoreHorizontal,
  Calendar as CalendarIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { db } from '@/lib/firebase';
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
  Timestamp,
  runTransaction,
  arrayUnion,
} from 'firebase/firestore';
import type {
  JmcEntry,
  WorkflowStep,
  ActionLog,
  BoqItem,
  Bill,
  ActionConfig,
  Project,
  JmcItem,
} from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { Skeleton } from '@/components/ui/skeleton';
import ViewJmcEntryDialog from '@/components/billing-recon/ViewJmcEntryDialog';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { getAssigneeForStep, calculateDeadline } from '@/lib/workflow-utils';
import { UpdateCertifiedQtyDialog } from '@/components/billing-recon/UpdateCertifiedQtyDialog';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { format, subDays } from 'date-fns';
import { cn } from '@/lib/utils';

/* -------- helpers -------- */
function toDateSafe(value: any): Date | null {
  if (!value) return null;
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return value;
  if (typeof value === 'number') return new Date(value);
  if (typeof value === 'string') {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  if (value?.seconds) return new Date(value.seconds * 1000);
  return null;
}

function humanDate(value: any) {
  const d = toDateSafe(value);
  if (!d) return '—';
  return d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function pastTense(action: string) {
  const map: Record<string, string> = {
    Approve: 'approved',
    Verify: 'verified',
    Complete: 'completed',
    Reject: 'rejected',
    Revert: 'reverted',
  };
  return map[action] ?? `${action.toLowerCase()}ed`;
}

function formatINR(n?: number) {
  const v = Number.isFinite(n as number) ? (n as number) : 0;
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 2,
    }).format(v);
  } catch {
    return `₹${v.toFixed(2)}`;
  }
}

function computeTotalAmount(entry: JmcEntry | undefined): number {
  if (!entry) return 0;
  const explicit = (entry as any).totalAmount;
  if (Number.isFinite(explicit)) return explicit as number;
  const items = entry.items ?? [];
  let total = 0;
  for (const it of items) {
    const qty = Number(it.certifiedQty ?? it.executedQty ?? 0);
    const rate = Number(it.rate ?? 0);
    if (Number.isFinite(qty) && Number.isFinite(rate)) total += qty * rate;
  }
  return total;
}

/* -------- component -------- */
export default function StagePage() {
  const { project: projectSlug, stageId } = useParams() as {
    project: string;
    stageId: string;
  };
  const { user } = useAuth();
  const userId = (user as any)?.id ?? (user as any)?.uid ?? '';
  const userName = (user as any)?.name ?? (user as any)?.displayName ?? 'User';

  const { toast } = useToast();
  const router = useRouter();

  const [tasks, setTasks] = useState<JmcEntry[]>([]);
  const [stage, setStage] = useState<WorkflowStep | null>(null);
  const [workflow, setWorkflow] = useState<WorkflowStep[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isActionLoading, setIsActionLoading] = useState<string | null>(null);
  const [selectedJmc, setSelectedJmc] = useState<JmcEntry | null>(null);
  const [isViewOpen, setIsViewOpen] = useState(false);
  const [isUpdateQtyOpen, setIsUpdateQtyOpen] = useState(false);
  const [isVerifyOpen, setIsVerifyOpen] = useState(false);
  const [boqItems, setBoqItems] = useState<BoqItem[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);

  const [isCompleteDialogOpen, setIsCompleteDialogOpen] = useState(false);
  const [completionDate, setCompletionDate] = useState<Date | undefined>(new Date());

  const fetchTasks = useCallback(async () => {
    if (!userId || !stageId || !projectSlug) return;

    setIsLoading(true);
    try {
      // 1) workflow + stage
      const workflowRef = doc(db, 'workflows', 'jmc-workflow');
      const workflowSnap = await getDoc(workflowRef);
      if (!workflowSnap.exists()) {
        toast({
          title: 'Error',
          description: 'Workflow not found.',
          variant: 'destructive',
        });
        router.back();
        return;
      }
      const steps = (workflowSnap.data().steps || []) as WorkflowStep[];
      setWorkflow(steps);
      const currentStage = steps.find((s) => s.id === stageId);
      if (!currentStage) {
        toast({
          title: 'Error',
          description: 'Workflow stage not found.',
          variant: 'destructive',
        });
        router.back();
        return;
      }
      setStage(currentStage);

      // 2) project by slug (cache id)
      const projectsQueryRef = query(collection(db, 'projects'));
      const projectsSnapshot = await getDocs(projectsQueryRef);
      const slugify = (text: string) =>
        text.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]+/g, '');
      const projectData = projectsSnapshot.docs
        .map((d) => ({ id: d.id, ...d.data() } as Project))
        .find((p) => slugify((p as any).projectName || '') === projectSlug);

      if (!projectData) throw new Error('Project not found');
      const pid = projectData.id;
      setProjectId(pid);

      // 3) stage tasks + BOQ + bills (for cached project id)
      const [stageTasksSnap, boqSnap, billsSnap] = await Promise.all([
        getDocs(
          query(
            collection(db, 'projects', pid, 'jmcEntries'),
            where('currentStepId', '==', stageId)
          )
        ),
        getDocs(query(collection(db, 'projects', pid, 'boqItems'))),
        getDocs(query(collection(db, 'projects', pid, 'bills'))),
      ]);

      setTasks(
        stageTasksSnap.docs.map(
          (d) => ({ id: d.id, ...(d.data() as any) } as JmcEntry)
        )
      );
      setBoqItems(
        boqSnap.docs.map(
          (d) => ({ id: d.id, ...(d.data() as any) } as BoqItem)
        )
      );
      setBills(
        billsSnap.docs.map(
          (d) => ({ id: d.id, ...(d.data() as any) } as Bill)
        )
      );
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
      router.back();
    } finally {
      setIsLoading(false);
    }
  }, [projectSlug, stageId, toast, router, userId]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const { pendingTasks, completedTasks } = useMemo(() => {
    if (!userId || !stage)
      return { pendingTasks: [] as JmcEntry[], completedTasks: [] as JmcEntry[] };

    const myPending = tasks.filter(
      (t) =>
        (t.assignees ?? []).includes(userId) &&
        t.status !== 'Completed' &&
        t.status !== 'Rejected'
    );

    const myCompleted = tasks.filter(
      (t) =>
        !myPending.some((pt) => pt.id === t.id) &&
        (t.history ?? []).some(
          (h) => h.stepName === stage.name && h.userId === userId
        )
    );

    return { pendingTasks: myPending, completedTasks: myCompleted };
  }, [tasks, userId, stage]);

  // Dialog visibility
  const handleDialogOpenChange = (open: boolean) => {
    if (!open) {
      setIsViewOpen(false);
      setIsVerifyOpen(false);
      setIsUpdateQtyOpen(false);
      setSelectedJmc(null);
    }
  };

  const handleUpdateQtyClick = (entry: JmcEntry) => {
    setSelectedJmc(entry);
    setIsUpdateQtyOpen(true);
  };

  const handleViewDetails = (entry: JmcEntry) => {
    setSelectedJmc(entry);
    setIsViewOpen(true);
  };

  const handleVerifyClick = (entry: JmcEntry) => {
    setSelectedJmc(entry);
    setIsVerifyOpen(true);
  };

  const openCompleteDialog = (task: JmcEntry) => {
    setSelectedJmc(task);
    setCompletionDate(new Date());
    setIsCompleteDialogOpen(true);
  };

  /* ---------- handleAction with overloads ---------- */

  // Overload for ViewJmcEntryDialog.onVerify
  async function handleAction(
    taskId: string,
    action: string,
    comment: string,
    updatedItems: JmcItem[]
  ): Promise<void>;

  // General overload (internal usage, including completion date)
  async function handleAction(
    taskId: string,
    action: string | ActionConfig,
    comment?: string,
    extra?: JmcItem[] | Date
  ): Promise<void>;

  async function handleAction(
    taskId: string,
    action: string | ActionConfig,
    comment: string = '',
    extra?: JmcItem[] | Date
  ): Promise<void> {
    if (!workflow || !userId || !userName || !stage || !projectSlug || !projectId)
      return;

    const actionName = typeof action === 'string' ? action : action.name;
    setIsActionLoading(taskId);

    // interpret extra
    const updatedItems = Array.isArray(extra) ? (extra as JmcItem[]) : undefined;
    const completionDateOverride =
      extra instanceof Date ? (extra as Date) : undefined;

    try {
      const taskRef = doc(db, 'projects', projectId, 'jmcEntries', taskId);

      await runTransaction(db, async (transaction) => {
        const preSnap = await transaction.get(taskRef);
        if (!preSnap.exists()) throw new Error('Task document not found!');
        const preData = preSnap.data() as JmcEntry;

        let nextStep: WorkflowStep | undefined;
        let newStatus: JmcEntry['status'] = preData.status;
        let newStage = preData.stage;
        let newCurrentStepId: string | null = preData.currentStepId || null;
        let newAssignees: string[] = preData.assignees || [];
        let newDeadline: Timestamp | null = preData.deadline ?? null;

        const isCompletionAction = [
          'Approve',
          'Complete',
          'Verified',
          'Verify',
        ].includes(actionName);

        if (isCompletionAction) {
          const idx = workflow.findIndex((s) => s.id === stage.id);
          nextStep = workflow[idx + 1];

          if (nextStep) {
            const serializableData = {
              ...preData,
              createdAt:
                toDateSafe(preData.createdAt)?.toISOString() ??
                new Date().toISOString(),
              deadline:
                toDateSafe(preData.deadline)?.toISOString() ?? null,
              jmcDate:
                toDateSafe(preData.jmcDate)?.toISOString() ??
                new Date().toISOString(),
              history: (preData.history || []).map((h) => ({
                ...h,
                timestamp:
                  toDateSafe(h.timestamp)?.toISOString() ??
                  new Date().toISOString(),
              })),
            };
            const computedAssignees = await getAssigneeForStep(
              nextStep,
              serializableData as any
            );
            if (!computedAssignees || computedAssignees.length === 0) {
              throw new Error(
                `Could not determine assignee for step: ${nextStep.name}`
              );
            }
            const deadlineDate = await calculateDeadline(
              new Date(),
              nextStep.tat
            );
            newAssignees = computedAssignees;
            newDeadline = Timestamp.fromDate(deadlineDate);
            newStage = nextStep.name;
            newStatus = 'In Progress';
            newCurrentStepId = nextStep.id;
          } else {
            // End of workflow
            newStage = 'Completed';
            newStatus = 'Completed';
            newCurrentStepId = null;
            newAssignees = [];
            newDeadline = null;
          }
        } else if (actionName === 'Reject') {
          newStage = 'Rejected';
          newStatus = 'Rejected';
          newCurrentStepId = null;
          newAssignees = [];
          newDeadline = null;
        } else {
          newAssignees = preData.assignees || [];
          newDeadline = preData.deadline ?? null;
        }

        const newActionLog: ActionLog = {
          action: actionName,
          comment,
          userId,
          userName,
          timestamp: completionDateOverride
            ? Timestamp.fromDate(completionDateOverride)
            : Timestamp.now(),
          stepName: stage.name,
        };

        const updateData: any = {
          status: newStatus,
          stage: newStage,
          currentStepId: newCurrentStepId,
          assignees: newAssignees,
          deadline: newDeadline,
          history: arrayUnion(newActionLog),
          version: (preData as any).version
            ? (preData as any).version + 1
            : 1,
        };

        // if verify dialog passed updatedItems, persist them
        if (updatedItems) {
          updateData.items = updatedItems;
        }

        transaction.update(taskRef, updateData);
      });

      toast({
        title: 'Success',
        description: `Task has been ${pastTense(actionName)}.`,
      });
      await fetchTasks();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error?.message || 'Failed to perform action.',
        variant: 'destructive',
      });
    } finally {
      setIsActionLoading(null);
      setIsVerifyOpen(false);
      setIsCompleteDialogOpen(false);
    }
  }

  const renderTable = (data: JmcEntry[], type: 'pending' | 'completed') => (
    <Card>
      <CardContent className="p-0 overflow-x-auto">
        <Table className="min-w-[880px]">
          <TableHeader>
            <TableRow>
              <TableHead className="whitespace-nowrap">JMC No.</TableHead>
              <TableHead className="whitespace-nowrap">JMC Date</TableHead>
              <TableHead className="text-right whitespace-nowrap">
                Total Amount
              </TableHead>
              <TableHead className="whitespace-nowrap">Status</TableHead>
              <TableHead className="text-right whitespace-nowrap">
                Actions
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={5}>
                    <Skeleton className="h-8" />
                  </TableCell>
                </TableRow>
              ))
            ) : data.length > 0 ? (
              data.map((entry) => {
                const currentStep = workflow?.find(
                  (s) => s.id === entry.currentStepId
                );
                const actions = Array.isArray(currentStep?.actions)
                  ? (currentStep!.actions as (string | ActionConfig)[])
                  : [];
                const total = computeTotalAmount(entry);

                return (
                  <TableRow
                    key={entry.id}
                    onClick={() => handleViewDetails(entry)}
                    className="cursor-pointer"
                  >
                    <TableCell className="whitespace-nowrap">
                      {entry.jmcNo ?? '-'}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {humanDate(entry.jmcDate)}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {formatINR(total)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <Badge
                        variant={
                          entry.status === 'Completed' ? 'default' : 'secondary'
                        }
                      >
                        {entry.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {isActionLoading === entry.id ? (
                        <Loader2 className="h-4 w-4 animate-spin ml-auto" />
                      ) : (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={(e) => e.stopPropagation()}
                              aria-label="Actions"
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            align="end"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {type === 'pending' &&
                              actions.map((action) => {
                                const actionName =
                                  typeof action === 'string'
                                    ? action
                                    : action.name;
                                const isVerify = actionName
                                  .toLowerCase()
                                  .includes('verify');
                                const isUpdateQty =
                                  actionName === 'Update Certified Qty';
                                const isComplete = actionName === 'Complete';

                                return (
                                  <DropdownMenuItem
                                    key={actionName}
                                    onSelect={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      if (isVerify) {
                                        handleVerifyClick(entry);
                                      } else if (isUpdateQty) {
                                        handleUpdateQtyClick(entry);
                                      } else if (isComplete) {
                                        openCompleteDialog(entry);
                                      } else {
                                        handleAction(entry.id!, action);
                                      }
                                    }}
                                  >
                                    {actionName}
                                  </DropdownMenuItem>
                                );
                              })}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            ) : (
              <TableRow>
                <TableCell colSpan={5} className="text-center h-24">
                  No {type} tasks found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );

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
            <h1 className="text-2xl font-bold">{stage?.name || 'JMC Stage'}</h1>
          </div>
        </div>
        <Tabs defaultValue="pending">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="pending">
              <Clock className="mr-2 h-4 w-4" /> Pending ({pendingTasks.length})
            </TabsTrigger>
            <TabsTrigger value="completed">
              <Check className="mr-2 h-4 w-4" /> Completed ({completedTasks.length})
            </TabsTrigger>
          </TabsList>
          <TabsContent value="pending" className="mt-4">
            {renderTable(pendingTasks, 'pending')}
          </TabsContent>
          <TabsContent value="completed" className="mt-4">
            {renderTable(completedTasks, 'completed')}
          </TabsContent>
        </Tabs>
      </div>

      {/* Complete dialog with custom date */}
      <Dialog open={isCompleteDialogOpen} onOpenChange={setIsCompleteDialogOpen}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle>Confirm Completion</DialogTitle>
            <DialogDescription>
              Please select the date this task was completed.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-start font-normal">
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {completionDate ? format(completionDate, 'PPP') : 'Select date'}
                </Button>
              </PopoverTrigger>
              <PopoverContent>
                <Calendar
                  mode="single"
                  selected={completionDate}
                  onSelect={setCompletionDate}
                  disabled={{
                    after: new Date(),
                    before: subDays(new Date(), 7),
                  }}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button
              onClick={() =>
                selectedJmc &&
                handleAction(
                  selectedJmc.id,
                  'Complete',
                  'Task marked as complete.',
                  completionDate
                )
              }
              disabled={!completionDate}
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ViewJmcEntryDialog
        isOpen={isViewOpen || isVerifyOpen}
        onOpenChange={handleDialogOpenChange}
        jmcEntry={selectedJmc}
        boqItems={boqItems}
        bills={bills}
        isEditMode={isVerifyOpen}
        onVerify={handleAction as any} // Cast to satisfy the stricter overload
        isLoading={selectedJmc ? isActionLoading === selectedJmc.id : false}
      />

      {selectedJmc && (
        <UpdateCertifiedQtyDialog
          isOpen={isUpdateQtyOpen}
          onOpenChange={setIsUpdateQtyOpen}
          jmcEntry={selectedJmc}
          projectSlug={projectSlug}
          onSaveSuccess={fetchTasks}
        />
      )}
    </>
  );
}

```
- src/components/ui/textarea.tsx:
```tsx
import * as React from 'react';

import {cn} from '@/lib/utils';

const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<'textarea'>>(
  ({className, ...props}, ref) => {
    return (
      <textarea
        className={cn(
          'flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Textarea.displayName = 'Textarea';

export {Textarea};

```
- src/hooks/use-auth.ts:
```ts
"use client"
import { useEffect, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth } from '@/lib/firebase';

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  return { user, loading };
}

```
- src/hooks/use-hotkey.ts:
```tsx
"use client"

import * as React from "react"

export function useHotkey(
  key: string,
  callback: (event: KeyboardEvent) => void
) {
  const callbackRef = React.useRef(callback)

  React.useEffect(() => {
    callbackRef.current = callback
  })

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === key) {
        callbackRef.current(event)
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [key])
}

```
- src/lib/permission-utils.ts:
```ts

import type { Role, Department } from '@/lib/types';
import { permissionModules } from '@/lib/types';


// This function should ideally fetch departments from Firestore if they are dynamic.
// For now, if you have a static or smaller list, you can pass them in.
// If departments are managed in Firestore, this would need to be async.
export const getTotalPermissionsForModule = (moduleName: string, departments: Department[] = []): number => {
    const moduleConfig = permissionModules[moduleName as keyof typeof permissionModules];
    if (!moduleConfig) return 0;
    
    if (Array.isArray(moduleConfig)) {
      return moduleConfig.length;
    }
    
    let total = 0;
    for (const key in moduleConfig) {
      const perms = moduleConfig[key as keyof typeof moduleConfig];
       if (key === 'View Module') {
        total += 1;
        continue;
      }
      if (Array.isArray(perms)) {
        if(key === 'Departments' && departments.length > 0) {
          total += perms.length * departments.length;
        } else {
          total += perms.length;
        }
      }
    }
    return total;
  };
  
export const getGrantedPermissionsForModule = (permissions: Record<string, string[]> | undefined, moduleName: string): number => {
    if (!permissions) return 0;
    let count = 0;

    const moduleConfig = permissionModules[moduleName as keyof typeof permissionModules];

    if (Array.isArray(moduleConfig)) {
        // Simple module structure
        if (permissions[moduleName] && Array.isArray(permissions[moduleName])) {
            count += permissions[moduleName].length;
        }
    } else {
        // Complex module structure
        // Count 'View Module' permission if it exists
        if (permissions[moduleName]?.includes('View Module')) {
             count++;
        }
        
        // Count permissions for sub-modules
        Object.keys(moduleConfig).forEach(subModuleKey => {
            if (subModuleKey === 'View Module') return;
            const fullKey = `${moduleName}.${subModuleKey}`;
            
            if (subModuleKey === 'Departments') {
                // Special handling for dynamic department keys
                Object.keys(permissions).forEach(permissionKey => {
                    if (permissionKey.startsWith(fullKey)) { // e.g., 'Expenses.Departments.dept_id_123'
                        if (Array.isArray(permissions[permissionKey])) {
                            count += permissions[permissionKey].length;
                        }
                    }
                });
            } else {
                 if (permissions[fullKey] && Array.isArray(permissions[fullKey])) {
                    count += permissions[fullKey].length;
                }
            }
        });
    }

    return count;
};

```
- src/lib/types.ts:
```ts

import { Timestamp } from 'firebase/firestore';
import { z } from 'zod';

/** ---------- Shared small types used below ---------- **/

export type UploadRequirement = 'Required' | 'Optional' | 'Not Required';

export interface AssignedTo {
  primary: string;
  alternative?: string;
}

/** Allow richer per-step action config */
export type ActionConfig = {
  name: string;
  requiresComment?: boolean;
  requiresAttachment?: boolean;
  nextStatus?: string;
  departmentId?: string; // Specific for 'Create Expense Request'
};

/** ---------- Core app types ---------- **/

export interface Module {
  id: string;
  title: string;
  content: string;
  tags: string[];
  icon: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  mobile: string;
  role: string;
  status: 'Active' | 'Inactive';
  photoURL?: string;
  isOnline?: boolean;
  lastSeen?: Timestamp;
  theme?: {
    color?: string;
    font?: string;
    sessionDuration?: number;
  };
}

export interface SavedUser {
  id: string;
  name: string;
  email: string;
  photoURL: string;
  pin?: string;        // 4-digit PIN for quick device sign-in
  password?: string;   // Base64-encoded password (not secure - consider alternatives)
}

export interface Department {
  id: string;
  name: string;
  head: string;
  status: 'Active' | 'Inactive';
}

export interface Signature {
  id: string;
  designation: string;
  name: string;
}

export interface Project {
  id: string;
  projectName: string;
  siteCode: string;
  projectSite: string;
  projectDivision: string;
  location: string;
  siteInCharge: string;
  status: 'Active' | 'Inactive';
  billingRequired?: boolean;
  stockManagementRequired?: boolean;
  woNo?: string;
  signatures?: Signature[];
  projectDescription?: string;
};

export interface Site {
  id: string;
  name: string;
  location: string;
}

export interface Role {
  id: string;
  name: string;
  permissions: Record<string, string[]>;
}

export const permissionModules = {
  'Module Hub': ['View Module', 'Create', 'Edit', 'Delete'],
  'Site Fund Requisition': [
    'View Module', 'Create Requisition', 'Edit Requisition', 'Delete Requisition',
    'Approve Request', 'Reject Request', 'View Dashboard', 'View History',
    'Revise Request', 'View Settings', 'View Summary', 'View Planned vs Actual',
    'View All'
  ],
  'Daily Requisition': {
    'View Module': [],
    'Entry Sheet': ['View', 'Add', 'Edit', 'Delete', 'View Checklist'],
    'Receiving at Finance': ['View', 'Mark as Received', 'Return to Pending', 'Reject'],
    'GST & TDS Verification': ['View', 'Verify', 'Re-verify', 'Return to Pending'],
    'Processed for Payment': ['View', 'Mark as Received for Payment'],
    'Manage Documents': ['View', 'Upload', 'Download', 'Mark as Missing', 'Not Required', 'Move to Pending'],
    'Settings': ['View', 'Edit Serial Nos', 'Edit User Rights'],
  },
  'Billing Recon': {
    'View Module': [],
    'BOQ': ['View', 'Import', 'Add Manual', 'Clear BOQ', 'Delete Items'],
    'JMC': ['View', 'Create Work Order', 'Create JMC Entry', 'View Log', 'Delete JMC', 'View Certified JMC', 'View Settings', 'Edit Settings', 'Edit Serial Nos',"View Reports"],
    'MVAC': ['View', 'Create Work Order', 'Create MVAC Entry', 'View Log', 'Delete MVAC', 'View Certified MVAC', 'View Settings', 'Edit Settings', 'Edit Serial Nos',"View Reports"],
    'Billing': ['View', 'Create Bill', 'Proforma/Advance Bill', 'Edit Bill', 'Delete Bill', 'View Settings', 'Edit Settings'],
    'Combined Log': ['View'],
  },
  'Subcontractors Management': {
    'View Module': [],
    'Manage Subcontractors': ['View', 'Add', 'Edit', 'Delete'],
    'Work Order': ['View', 'Create', 'Edit', 'Delete'],
    'Billing': [
      'View',
      'Create Bill',
      'Proforma/Advance Bill',
      'View Log',
      'Edit Bill',
      'Delete Bill',
      'View Settings',
      'Edit Settings'
    ],
    'Reports': {
        'View': [],
        'Work Order Progress': ['View'],
        'Billing Summary': ['View'],
    },
  },
  'Bank Balance': {
    'View Module': [],
    'Accounts': ['View', 'Add', 'Edit', 'Delete'],
    'DP Management': ['View', 'Add', 'Delete'],
    'Opening Utilization': ['View', 'Edit'],
    'Daily Log': ['View'],
    'Interest Rate': ['View', 'Add', 'Delete'],
    'Monthly Interest': ['View', 'Edit'],
    'Expenses': ['View', 'Add', 'Delete'],
    'Receipts': ['View', 'Add', 'Delete'],
    'Internal Transaction': ['View', 'Add', 'Delete'],
    'Reports': ['View'],
  },
  'Expenses': {
    'View Module': [],
    'Departments': ['View', 'Create', 'Edit'],
    'Expense Requests': ['View All'],
    'Reports': ['View'],
    'Settings': ['View', 'Edit Serial Nos', 'Manage Accounts'],
  },
  'Loan': {
    'View Module': [],
    'Dashboard': ['View'],
    'Add Loan': ['Create'],
    'Loan Details': ['View', 'Update EMI'],
    'Reports': ['View'],
  },
  'LC Module': {
    'View Module': [],
    'Dashboard': ['View', 'Create'],
    'LC Details': ['View', 'Edit', 'Track Payments'],
  },
  'Store & Stock Management': {
    'View Module': true,
    'Settings': ['View', 'Manage Projects', 'Manage Units', 'Manage GRN Entry'],
    'Projects': [
      'View Dashboard',
      'View Inventory',
      'View Transactions',
      'Stock In',
      'Stock Out',
      'Edit Transaction',
      'Delete Transaction',
      'View Conversions',
      'Manage Conversions',
      'View BOM',
      'Manage BOM',
      'View BOQ',
      'Import BOQ',
      'Add BOQ Item',
      'View Reports',
      'View Ageing Report',
      'View AI Forecast',
    ]
  },
  'Insurance': {
    'View Module': [],
    'Personal Insurance': ['View', 'Add', 'Edit', 'Delete', 'Renew', 'View History'],
    'Project Insurance': ['View', 'Add', 'Edit', 'Delete', 'Renew', 'View History', 'Mark as Not Required'],
    'Premium Due': ['View'],
    'Maturity Due': ['View'],
    'My Tasks': ['View'],
    'Reports': ['View Reports'],
    'Settings': ['View'],
    'Settings.Holders': ['View', 'Add', 'Edit', 'Delete'],
    'Settings.Companies': ['View', 'Add', 'Edit', 'Delete'],
    'Settings.Categories': ['View', 'Add', 'Edit', 'Delete'],
    'Settings.Assets': ['View', 'Add', 'Edit', 'Delete'],
  },
   'Employee': {
    'View Module': [],
    'Manage': ['View', 'Add', 'Edit', 'Delete'],
    'Sync': ['Sync from GreytHR'],
    'Categories': ['View'],
    'Position Details': ['View'],
    'Salary': ['View', 'Sync'],
  },
  'Settings': {
    'View Module': [],
    'Manage Department': ['View', 'Add', 'Edit', 'Delete'],
    'Manage Project': ['View', 'Add', 'Edit', 'Delete'],
    'Employee Management': ['View', 'Add', 'Edit', 'Delete', 'Sync from GreytHR'],
    'User Management': ['View', 'Add', 'Edit', 'Delete', 'Switch User'],
    'Role Management': ['View', 'Add', 'Edit', 'Delete'],
    'Working Hrs': ['View', 'Edit'],
    'Serial No. Config': ['View', 'Edit'],
    'Appearance': ['View', 'Edit'],
    'Email Authorization': ['View', 'Send Request', 'Revoke'],
    'Login Expiry': ['View', 'Edit'],
  },
};

/** ---------- Requisition & workflow-related ---------- **/

export interface Requisition {
  id: string;
  requisitionId: string;
  projectId: string;
  departmentId: string;
  amount: number;
  partyName: string;
  description: string;
  date: string; // ISO
  raisedBy: string;
  raisedById: string;
  createdAt: Timestamp;
  status: 'Pending' | 'In Progress' | 'Completed' | 'Rejected' | 'Needs Review';
  stage: string;
  currentStepId: string | null;
  assignees: string[];
  deadline: Timestamp | null;
  history: ActionLog[];
  attachments?: Attachment[];
  expenseRequestNo?: string;
}

export interface Attachment {
  name: string;
  url: string;
}

export interface ActionLog {
  action: string;
  comment: string;
  userId: string;
  userName: string;
  timestamp: Timestamp;
  stepName: string;
  attachment?: { name: string; url: string };
}

/**
 * WORKFLOW STEP (Discriminated Union)
 * - User-based => assignedTo: string[] ([primary, alternative?])
 * - Role/Project/Department-based => assignedTo: Record<id, AssignedTo>
 */
export type WorkflowAssignmentType =
  | 'User-based'
  | 'Role-based'
  | 'Project-based'
  | 'Department-based'
  | 'Amount-based';

export interface WorkflowStepBase {
  id: string;
  name: string;
  tat: number; // in hours
  actions: (string | ActionConfig)[];   // <-- widened
  upload: UploadRequirement;
}

export interface WorkflowStepUser extends WorkflowStepBase {
  assignmentType: 'User-based';
  assignedTo: string[]; // [primary, alternative?]
}

export interface WorkflowStepMapped extends WorkflowStepBase {
  assignmentType: 'Role-based' | 'Project-based' | 'Department-based';
  assignedTo: Record<string, AssignedTo>;
}

export interface AmountBasedCondition {
    id: string;
    type: 'Below' | 'Between' | 'Above';
    amount1: number;
    amount2?: number;
    userId: string;
    alternativeUserId?: string;
}


export type WorkflowStep = WorkflowStepUser | WorkflowStepMapped | (WorkflowStepBase & { assignmentType: 'Amount-based', assignedTo: AmountBasedCondition[] });

/** ---------- Serial number config ---------- **/

export interface SerialNumberConfig {
  prefix: string;
  format: string; // e.g., YYYYMMDD
  suffix: string;
  startingIndex: number;
}

/** ---------- Expenses ---------- **/

export interface ExpenseRequest {
  id: string;
  requestNo: string;
  departmentId: string;
  projectId: string;
  amount: number;
  description: string;
  headOfAccount: string;
  subHeadOfAccount: string;
  remarks: string;
  partyName: string;
  generatedByDepartment: string;
  generatedByUser: string;
  generatedByUserId: string;
  receptionNo: string;
  receptionDate: string;
  createdAt: string;
}

export interface AccountHead {
  id: string;
  name: string;
}

export interface SubAccountHead {
  id: string;
  name: string;
  headId: string;
}

/** ---------- Daily Requisition ---------- **/

export interface DailyRequisitionEntry {
  id: string;
  receptionNo: string;
  depNo: string;
  date: string | Timestamp;
  projectId: string;
  departmentId: string;
  description: string;
  partyName: string;
  grossAmount: number;
  netAmount: number;
  createdAt: Timestamp;
  // GST/TDS Fields
  status: 'Pending' | 'Received' | 'Verified' | 'Cancelled' | 'Needs Review' | 'Received for Payment' | 'Paid';
  receivedAt?: Timestamp;
  receivedById?: string;
  verifiedAt?: Timestamp;
  igstAmount?: number;
  tdsAmount?: number;
  cgstAmount?: number;
  sgstAmount?: number;
  retentionAmount?: number;
  otherDeduction?: number;
  verificationNotes?: string;
  gstNo?: string;
  // Document Status
  documentStatus: 'Pending' | 'Uploaded' | 'Missing' | 'Not Required';
  documentStatusUpdatedAt?: Timestamp;
  documentStatusUpdatedById?: string;
  attachments?: Attachment[];
  paidAt?: Timestamp;
}

/** ---------- User settings ---------- **/

export interface ColumnPref {
  order: string[];
  visibility: Record<string, boolean>;
  names: Record<string, string>;
  sort: {
    key: string;
    direction: 'asc' | 'desc';
  };
}

export interface UserSettings {
  columnPreferences?: {
    [pageKey: string]: ColumnPref | undefined;
  },
  pivotPreferences?: {
    [pageKey: string]: PivotConfig
  }
}

export interface PivotConfig {
  rows: string[];
  columns: string[];
  value: string;
}

/** ---------- Billing / JMC / MVAC / Subcontractors ---------- **/

export interface ContactPerson {
  id: string;
  type: 'Project' | 'Billing' | 'Accounts' | 'Other';
  name: string;
  title: string;
  mobile: string;
  email: string;
}

export interface Subcontractor {
  id: string;
  status: 'Active' | 'Inactive';
  projectId: string;
  legalName: string;
  dbaName: string;
  registeredAddress: string;
  operatingAddress: string;
  gstNumber: string;
  panNumber: string;
  bankName: string;
  bankBranch: string;
  accountNumber: string;
  ifscCode: string;
  contacts: ContactPerson[];
}


export interface BoqItem {
  id: string;
  [key: string]: any;
  bom?: FabricationBomItem[];
  conversions?: Conversion[];
}

export interface MvacItem {
  boqSlNo: string;
  description: string;
  unit: string;
  rate: number;
  executedQty: number;
  certifiedQty?: number;
  totalAmount: number;
}

export interface MvacEntry {
  id: string;
  projectSlug: string;
  projectId?: string;
  mvacNo: string;
  woNo: string;
  mvacDate: string;
  items: MvacItem[];
  createdAt: Timestamp;
  status: 'Pending' | 'In Progress' | 'Completed' | 'Rejected' | 'Certified' | 'Cancelled';
  stage: string;
  currentStepId: string | null;
  assignees: string[];
  deadline: Timestamp | null;
  history: ActionLog[];
}

export interface JmcItem {
  boqSlNo: string;
  description: string;
  unit: string;
  rate: number;
  executedQty: number;
  certifiedQty?: number;
  totalAmount: number;
}

export interface JmcEntry {
  id: string;
  projectSlug: string;
  projectId?: string;
  jmcNo: string;
  woNo: string;
  jmcDate: string;
  items: JmcItem[];
  createdAt: Timestamp;
  status: 'Pending' | 'In Progress' | 'Completed' | 'Rejected' | 'Certified' | 'Cancelled';
  stage: string;
  currentStepId: string | null;
  assignees: string[];
  deadline: Timestamp | null;
  history: ActionLog[];
}

export interface BillItem {
  jmcItemId: string; // e.g., `${jmcEntryId}-${jmcItemIndex}`
  jmcEntryId: string;
  jmcNo: string;
  boqSlNo: string;
  description: string;
  unit: string;
  rate: string;
  executedQty: string;
  billedQty: string;
  totalAmount: string;
}

export interface Bill {
  id: string;
  projectId: string;
  projectName?: string;
  billNo: string;
  billDate: string;
  workOrderId: string;
  workOrderNo: string;
  subcontractorId: string;
  subcontractorName?: string;
  items: BillItem[];
  subtotal: number;
  gstType: 'percentage' | 'manual';
  gstPercentage: number | null;
  gstAmount: number;
  grossAmount: number;
  retentionType: 'percentage' | 'manual';
  retentionPercentage: number | null;
  retentionAmount: number;
  otherDeduction: number;
  advanceDeductions: { id: string; reference: string; amount: number; deductionType: 'amount' | 'percentage'; deductionValue: number }[];
  totalDeductions: number;
  netPayable: number;
  totalAmount: number;
  createdAt: any;
  status: 'Pending' | 'In Progress' | 'Completed' | 'Rejected';
  stage: string;
  currentStepId: string | null;
  assignees: string[];
  history: ActionLog[];
  deadline?: Timestamp | null;
  isRetentionBill?: boolean;
  claimedBillIds?: string[];
  retentionClaimed?: boolean;
}


export interface ProformaBill {
    id: string;
    proformaNo: string;
    date: string;
    workOrderId: string;
    workOrderNo: string;
    subcontractorId: string;
    subcontractorName: string;
    items: (Omit<BillItem, 'billedQty'> & { billedQty: number })[];
    subtotal: number;
    payablePercentage: number;
    payableAmount: number;
    createdAt: any;
    projectId: string;
    projectName?: string;
    approvalCopyUrl?: string;

    // Workflow fields
    status?: 'Pending' | 'In Progress' | 'Completed' | 'Rejected';
    stage?: string;
    currentStepId?: string | null;
    assignees?: string[];
    history?: ActionLog[];
    deadline?: Timestamp | null;
}

/** ---------- Insurance ---------- **/

export interface PolicyHolder {
  id: string;
  name: string;
  date_of_birth: Date | null;
  contact?: string;
  email?: string;
  address?: string;
}

export interface InsuranceCompany {
  id: string;
  name: string;
  status: 'Active' | 'Inactive';
}

export interface PolicyCategory {
  id: string;
  name: string;
  status: 'Active' | 'Inactive';
}

export interface InsurancePolicy {
  id: string;
  insured_person: string;
  policy_no: string;
  insurance_company: string;
  policy_category: string;
  policy_name: string;
  premium: number;
  sum_insured: number;
  date_of_comm: Timestamp | null;
  date_of_maturity: Timestamp | null;
  last_premium_date: Timestamp | null;
  payment_type: 'Monthly' | 'Quarterly' | 'Yearly' | 'One-Time';
  auto_debit: boolean;
  due_date: Timestamp | null;
  last_renewed_at?: Timestamp;
  last_payment_type?: string;
  tenure: number;
  policy_issue_date?: Timestamp;
  attachments?: Attachment[];
}

export interface PolicyRenewal {
  id: string;
  policyId: string;
  renewalDate: Timestamp;
  paymentDate: Timestamp;
  receiptDate: Timestamp;
  paymentType: string;
  remarks: string;
  renewalCopyUrl?: string;
  renewedBy: string;
}

/** ---------- Email Auth ---------- **/

export interface Email {
  id: string;
  sender: string;
  initials: string;
  subject: string;
  body: string;
  date: string;
  read: boolean;
}

export interface EmailAuthorization {
  id: string;
  email: string;
  status: 'Pending' | 'Authorized';
  createdAt: string;
}

/** ---------- Bank / Finance ---------- **/

export interface BankAccount {
  id: string;
  bankName: string;
  shortName: string;
  accountNumber: string;
  accountType: 'Current Account' | 'Cash Credit';
  status: 'Active' | 'Inactive';
  branch: string;
  ifsc: string;
  openingBalance?: number;
  openingUtilization?: number;
  openingDate: string; // YYYY-MM-DD
  currentBalance: number;
  drawingPower: DpLogEntry[];
  interestRateLog: InterestRateLogEntry[];
}

export interface DpLogEntry {
  id: string;
  fromDate: string;
  toDate: string | null;
  amount: number;
}

export interface InterestRateLogEntry {
  id: string;
  fromDate: string;
  toDate: string | null;
  rate: number; // percentage
}

export interface BankExpense {
  id: string;
  date: Timestamp;
  accountId: string;
  description: string;
  amount: number;
  type: 'Debit' | 'Credit';
  isContra: boolean;
  contraId?: string;
  paymentRequestRefNo?: string;
  utrNumber?: string;
  paymentMethod?: string;
  paymentRefNo?: string;
  approvalCopyUrl?: string;
  bankTransferCopyUrl?: string;
  createdAt: Timestamp;
}

export interface BankDailyLog {
  id: string;
  date: string;
  accountId: string;
  accountName: string;
  openingBalance: number;
  totalExpenses: number;
  totalReceipts: number;
  totalContra: number;
  closingBalance: number;
}

export interface MonthlyInterestData {
  [accountId: string]: {
    projected: number;
    actual: number;
  }
}

/** ---------- Calendar / Schedule ---------- **/

export interface Holiday {
  id: string;
  name: string;
  date: string; // YYYY-MM-DD
}

export interface WorkingHours {
  [day: string]: {
    isWorkDay: boolean;
    startTime: string; // HH:mm
    endTime: string; // HH:mm
  };
}

/** ---------- LC / Loans ---------- **/

export interface LcEntry {
  id: string;
  vendor: string;
  projectId: string;
  bank: string;
  lcNo: string;
  lcAmount: number;
  selCalculation: number;
  bankCalculation: number;
  difference: number;
  fdMargin: number;
  status: 'Opened' | 'Closed' | 'Amended';
  createdAt: any;
  poUrl?: string;
  applicationUrl?: string;
  lcCopyUrl?: string;
}

export type SalaryDetail = {
  itemName: string;
  description: string;
  amount: number;
  type: 'INCOME' | 'DEDUCT' | 'Others';
};

export interface Employee {
  id: string;
  employeeId: string;
  name: string;
  email: string;
  phone: string;
  department: string;
  designation: string;
  status: 'Active' | 'Inactive';
  grossSalary?: number;
  netSalary?: number;
  salaryDetails?: SalaryDetail[];
  dateOfJoin?: string | null;
  leavingDate?: string | null;
  dateOfBirth?: string | null;
  gender?: string;
  employeeNo?: string;
}

export interface EmployeePosition {
  employeeId: string; // Changed to string
  categoryList: PositionDetail[];
}

export interface PositionDetail {
  id: number;
  category: string;
  value: number;
  effectiveFrom: string;
  effectiveTo: string | null;
}

/** ---------- Expense request schema ---------- **/

export interface CreateExpenseRequestInput {
  departmentId: string;
  projectId: string;
  amount: number;
  description: string;
  headOfAccount: string;
  subHeadOfAccount: string;
  remarks: string;
  partyName: string;
}

const CreateExpenseRequestInputSchema = z.object({
  departmentId: z.string(),
  projectId: z.string(),
  amount: z.number(),
  description: z.string(),
  headOfAccount: z.string(),
  subHeadOfAccount: z.string(),
  remarks: z.string().optional(),
  partyName: z.string(),
});

export interface CreateExpenseRequestOutput {
  success: boolean;
  message: string;
  requestNo?: string;
}

const CreateExpenseRequestOutputSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  requestNo: z.string().optional(),
});

export { CreateExpenseRequestInputSchema, CreateExpenseRequestOutputSchema };

/** ---------- Chat ---------- **/

export interface Chat {
  id: string;
  type: 'one-to-one' | 'group';
  members: string[];
  memberDetails: { id: string; name: string; photoURL: string; }[];
  groupName?: string;
  groupDescription?: string;
  groupPhotoURL?: string;
  createdBy?: string;
  groupAdmins?: string[];
  lastMessage: {
    text: string;
    senderId: string;
    timestamp: any;
  };
  createdAt: any;
}

export interface Message {
  id: string;
  senderId: string;
  timestamp: Timestamp;
  readBy: string[];
  type: 'text' | 'image' | 'video' | 'audio' | 'document' | 'event';
  content?: string;
  mediaUrl?: string;
  fileName?: string;
  eventDetails?: EventDetails;
}

export interface EventDetails {
  eventName: string;
  description?: string;
  startDate: string;
  location?: string;
  isWhatsappCall?: boolean;
}

/** ---------- Insurance project assets ---------- **/

export interface InsuredAsset {
  id: string;
  name: string;
  type: 'Project' | 'Property';
  projectId?: string;
  location: string;
  description: string;
  status: 'Active' | 'Inactive';
}

export interface ProjectInsurancePolicy {
  id: string;
  assetId: string;
  assetName: string;
  assetType: 'Project' | 'Property';
  policy_no: string;
  insurance_company: string;
  policy_category: string;
  premium: number;
  sum_insured: number;
  insurance_start_date: Timestamp | null;
  insured_until: Timestamp | null;
  tenure_years: number;
  tenure_months: number;
  status: 'Active' | 'Close' | 'Not Required' | 'Expired';
  attachments?: Attachment[];
}

export interface ProjectPolicyRenewal {
  id: string;
  policyNo: string;
  premium: number;
  sumInsured: number;
  startDate: Timestamp;
  endDate: Timestamp;
  renewalDate: Timestamp;
  renewedBy: string;
  renewalCopyUrl?: string;
}

/** ---------- Insurance tasks ---------- **/

export interface InsuranceTask {
  id: string;
  uniqueCheckId: string;
  policyId: string;
  policyNo: string;
  insuredPerson: string;
  dueDate: Timestamp;
  status: 'Pending' | 'In Progress' | 'Completed' | 'Rejected' | 'Needs Review';
  assignees: string[];
  createdAt: Timestamp;
  taskType: 'Premium Due' | 'Maturity Due';
  currentStepId: string | null;
  currentStage: string;
  deadline: Timestamp | null;
  projectId?: string;
  history: ActionLog[];
}

/** ---------- Loans ---------- **/

export interface EMI {
  id: string;
  loanId: string;
  emiNo: number;
  dueDate: Timestamp;
  emiAmount: number;
  principal: number;
  interest: number;
  paidAmount: number;
  closingPrincipal: number;
  status: 'Paid' | 'Pending' | 'Overdue';
  paidAt?: Timestamp;
  paidById?: string;
  expenseRequestNo?: string;
}

export interface Loan {
  id: string;
  accountNo: string;
  lenderName: string;
  loanAmount: number;
  tenure: number;
  interestRate: number;
  emiAmount: number;
  startDate: string;
  endDate: string;
  linkedBank: string;
  loanType: 'Loan' | 'Investment';
  totalPaid: number;
  status: 'Active' | 'Closed' | 'Pre-closure Pending';
  createdAt: Timestamp;
  finalInterestOnClosure?: number;
  otherChargesOnClosure?: number;
}

/** ---------- Store & Stock ---------- **/

export interface FabricationBomItem {
  id: string;
  markNo: string;
  section: string;
  grade: string;
  length: number;
  width: number;
  unitWt: number;
  wtPerPc: number;
  totalWtPerSet: number;
  qtyPerSet: number;
  totalWtKg: number;
}

export interface Conversion {
  id: string;
  fromUnit: string;
  fromQty: number;
  toUnit: string;
  toQty: number;
}

export interface InventoryLog {
  id: string;
  date: Timestamp;
  itemId: string;
  itemName: string;
  itemType: 'Main' | 'Sub';
  transactionType: 'Goods Receipt' | 'Goods Issue' | 'Return' | 'Transfer' | 'Adjustment' | 'Conversion';
  quantity: number;
  availableQuantity: number;
  unit: string;
  cost?: number;
  projectId: string;
  projectSlug?: string;
  batch?: string;
  description?: string;
  details?: {
    grnNo?: string;
    boqSlNo?: string;
    supplier?: string;
    poNumber?: string;
    poDate?: string | null;
    invoiceNumber?: string;
    invoiceDate?: string | null;
    invoiceAmount?: number | null;
    invoiceFileUrls?: { name: string, url: string }[];
    transporterDocUrls?: { name: string, url: string }[];
    vehicleNo?: string;
    waybillNo?: string;
    lrNo?: string;
    lrDate?: string | null;
    notes?: string;
    issuedTo?: string;
    destinationProjectId?: string;
    sourceGrn?: string;
  };
}

export interface EnrichedLogItem extends InventoryLog {
  originalQuantity: number;
  issuedQuantity: number;
  balanceQuantity: number;
}

export interface WorkOrder {
  id: string;
  projectId: string;
  workOrderNo: string;
  date: string;
  subcontractorId: string;
  subcontractorName: string;
  items: WorkOrderItem[];
  totalAmount: number;
  createdAt: Timestamp;
  createdBy: string;
}

export interface WorkOrderItem {
  id: string;
  boqItemId: string;
  description: string;
  unit: string;
  orderQty: number;
  rate: number;
  totalAmount: number;
  boqSlNo?: string;
}

```
- src/lib/utils.ts:
```ts
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

```
- tailwind.config.ts:
```ts
import type { Config } from 'tailwindcss';

export default {
  darkMode: ['class'],
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      fontFamily: {
        body: ['var(--font-body)', 'sans-serif'],
        inter: ['var(--font-inter)', 'sans-serif'],
        roboto: ['var(--font-roboto)', 'sans-serif'],
        headline: ['var(--font-inter)', 'sans-serif'],
        code: ['monospace'],
      },
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        chart: {
          '1': 'hsl(var(--chart-1))',
          '2': 'hsl(var(--chart-2))',
          '3': 'hsl(var(--chart-3))',
          '4': 'hsl(var(--chart-4))',
          '5': 'hsl(var(--chart-5))',
        },
        sidebar: {
          DEFAULT: 'hsl(var(--sidebar-background))',
          foreground: 'hsl(var(--sidebar-foreground))',
          primary: 'hsl(var(--sidebar-primary))',
          'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
          accent: 'hsl(var(--sidebar-accent))',
          'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
          border: 'hsl(var(--sidebar-border))',
          ring: 'hsl(var(--sidebar-ring))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      keyframes: {
        'accordion-down': {
          from: {
            height: '0',
          },
          to: {
            height: 'var(--radix-accordion-content-height)',
          },
        },
        'accordion-up': {
          from: {
            height: 'var(--radix-accordion-content-height)',
          },
          to: {
            height: '0',
          },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [
    require('tailwindcss-animate'),
  ],
} satisfies Config;

```
- src/app/(protected)/settings/role-management/add/page.tsx:
```tsx

'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Save, Loader2, Plus, Edit, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle as CardTitleShad, CardDescription as CardDescriptionShad } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, addDoc, getDocs, query, where } from 'firebase/firestore';
import type { Role, Department, Project } from '@/lib/types';
import { permissionModules } from '@/lib/types';
import { useAuth } from '@/components/auth/AuthProvider';
import { logUserActivity } from '@/lib/activity-logger';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';

const initialNewRoleState = {
  name: '',
  permissions: Object.keys(permissionModules).reduce((acc, module) => {
    const sub = permissionModules[module as keyof typeof permissionModules];
    if(Array.isArray(sub)){
      const key = module;
       if (!acc[key]) {
        acc[key] = [];
      }
    } else {
      if(sub['View Module'] !== undefined){
        acc[module] = [];
      }
      Object.keys(sub).forEach(subModule => {
        if (subModule === 'View Module') return;
        const key = `${module}.${subModule}`;
        if (!acc[key]) {
          acc[key] = [];
        }
      });
    }
    return acc;
  }, {} as Record<string, string[]>),
};

export default function AddRolePage() {
    const { toast } = useToast();
    const router = useRouter();
    const { user } = useAuth();

    const [newRole, setNewRole] = useState<{name: string, permissions: Record<string, string[]>}>(JSON.parse(JSON.stringify(initialNewRoleState)));
    const [departments, setDepartments] = useState<Department[]>([]);
    const [projects, setProjects] = useState<Project[]>([]);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        const fetchDeptsAndProjects = async () => {
            const deptsSnap = await getDocs(query(collection(db, 'departments'), where('status', '==', 'Active')));
            setDepartments(deptsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Department)));

            const projectsSnap = await getDocs(query(collection(db, 'projects'), where('stockManagementRequired', '==', true)));
            setProjects(projectsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project)));
        };
        fetchDeptsAndProjects();
    }, []);

    const handlePermissionChange = (moduleKey: string, permission: string, isChecked: boolean) => {
        setNewRole((prevState) => {
            const newPermissions = { ...prevState.permissions };
            const currentPermissions = newPermissions[moduleKey] || [];
            if (isChecked) {
                if (!currentPermissions.includes(permission)) {
                    newPermissions[moduleKey] = [...currentPermissions, permission];
                }
            } else {
                newPermissions[moduleKey] = currentPermissions.filter((p: string) => p !== permission);
            }
            return { ...prevState, permissions: newPermissions };
        });
    };
      
    const handleSelectAllForGroup = (groupKey: string, allPermissionsInGroup: string[], isChecked: boolean) => {
        setNewRole((prevState) => {
            const newPermissions = { ...prevState.permissions };
            newPermissions[groupKey] = isChecked ? allPermissionsInGroup : [];
            return { ...prevState, permissions: newPermissions };
        });
    };

    const handleAddRole = async () => {
        if (!newRole.name.trim()) {
          toast({
            title: 'Validation Error',
            description: 'Role Name cannot be empty.',
            variant: 'destructive',
          });
          return;
        }
        if (!user) return;

        setIsSaving(true);
        try {
          await addDoc(collection(db, 'roles'), newRole);
          await logUserActivity({
            userId: user.id,
            action: 'Create Role',
            details: { roleName: newRole.name }
          });
          toast({
            title: 'Success',
            description: `Role "${newRole.name}" created successfully.`,
          });
          router.push('/settings/role-management');
        } catch (error) {
          console.error("Error adding role: ", error);
          toast({
            title: 'Error',
            description: 'Failed to add role.',
            variant: 'destructive',
          });
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                <Link href="/settings/role-management">
                    <Button variant="ghost" size="icon">
                    <ArrowLeft className="h-6 w-6" />
                    </Button>
                </Link>
                <h1 className="text-xl font-bold">Add New Role</h1>
                </div>
                <Button onClick={handleAddRole} disabled={isSaving}>
                    {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                    Save Role
                </Button>
            </div>

            <div className="space-y-4">
                <div className="flex items-center gap-4">
                    <Label htmlFor="roleName" className="text-base min-w-[100px]">Role Name</Label>
                    <Input 
                    id="roleName" 
                    value={newRole.name} 
                    onChange={(e) => setNewRole({ ...newRole, name: e.target.value })} 
                    className="max-w-sm"
                    />
                </div>
                <div>
                    <Label className="text-base">Permissions</Label>
                    <p className="text-sm text-muted-foreground">Select the actions this role can perform for each module.</p>
                    <ScrollArea className="mt-2 h-[calc(100vh-19rem)]">
                        <Accordion type="single" collapsible className="w-full pr-4">
                            {Object.entries(permissionModules).map(([moduleName, moduleValue]) => {
                                const isViewModuleOnly = typeof moduleValue === 'object' && !Array.isArray(moduleValue) && Object.keys(moduleValue).length === 1 && 'View Module' in moduleValue;
                                const isViewModulePermission = (newRole.permissions?.[moduleName] || []).includes('View Module') || (moduleValue as any)['View Module'] === true;

                                return (
                                <AccordionItem value={moduleName} key={moduleName}>
                                    <AccordionTrigger>{moduleName}</AccordionTrigger>
                                    <AccordionContent>
                                        <Card>
                                            <CardContent className="p-3 space-y-3">
                                            {Array.isArray(moduleValue) ? (
                                                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                                    {moduleValue.map(permission => (
                                                        <div key={permission} className="flex items-center space-x-2">
                                                            <Checkbox
                                                                id={`new-${moduleName}-${permission}`}
                                                                checked={(newRole.permissions?.[moduleName] || []).includes(permission)}
                                                                onCheckedChange={(checked) => handlePermissionChange(moduleName, permission, !!checked)}
                                                            />
                                                            <Label htmlFor={`new-${moduleName}-${permission}`} className="text-sm font-normal leading-tight">{permission}</Label>
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : (
                                            <>
                                                { 'View Module' in moduleValue && (
                                                    <div className="p-3 border rounded-md">
                                                        <div className="flex justify-between items-center">
                                                            <h4 className="font-semibold text-sm">View Module</h4>
                                                            <div className="flex items-center space-x-2">
                                                                <Checkbox
                                                                    id={`select-all-group-new-${moduleName}-view`}
                                                                    checked={isViewModulePermission}
                                                                    onCheckedChange={(checked) => handlePermissionChange(moduleName, 'View Module', !!checked)}
                                                                />
                                                                <Label htmlFor={`select-all-group-new-${moduleName}-view`} className="text-xs font-medium">Allow</Label>
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}
                                                <div className={!isViewModulePermission ? 'opacity-50 pointer-events-none' : ''}>
                                                    {Object.entries(moduleValue).map(([subModuleKey, permissions]) => {
                                                        if (subModuleKey === 'View Module') return null;

                                                        const fullKey = `${moduleName}.${subModuleKey}`;
                                                        
                                                        if (subModuleKey === 'Departments') {
                                                            return (
                                                                <div key={fullKey} className="p-3 border rounded-md mt-2">
                                                                    <h4 className="font-semibold text-sm mb-3">{subModuleKey}-specific Permissions</h4>
                                                                    {departments.map(dept => {
                                                                        const deptKey = `Expenses.Departments.${dept.id}`;
                                                                        const deptPermissions = permissions as string[];
                                                                        const grantedInDept = newRole.permissions?.[deptKey] || [];
                                                                        const isAllInDeptSelected = deptPermissions.length > 0 && grantedInDept.length === deptPermissions.length;
                                                                        return (
                                                                            <div key={dept.id} className="p-2 border-t mt-2 first:mt-0 first:border-t-0">
                                                                                <div className="flex justify-between items-center mb-2">
                                                                                    <p className="text-sm font-medium">{dept.name}</p>
                                                                                    <div className="flex items-center space-x-2">
                                                                                        <Checkbox
                                                                                            id={`select-all-dept-${dept.id}`}
                                                                                            checked={isAllInDeptSelected}
                                                                                            onCheckedChange={(checked) => handleSelectAllForGroup(deptKey, deptPermissions, !!checked)}
                                                                                            disabled={!isViewModulePermission}
                                                                                        />
                                                                                        <Label htmlFor={`select-all-dept-${dept.id}`} className="text-xs font-medium">All</Label>
                                                                                    </div>
                                                                                </div>
                                                                                <div className="grid grid-cols-3 gap-2">
                                                                                    {deptPermissions.map((permission: string) => (
                                                                                        <div key={permission} className="flex items-center space-x-2">
                                                                                            <Checkbox
                                                                                                id={`new-${deptKey}-${permission}`}
                                                                                                checked={grantedInDept.includes(permission)}
                                                                                                onCheckedChange={(checked) => handlePermissionChange(deptKey, permission, !!checked)}
                                                                                                disabled={!isViewModulePermission}
                                                                                            />
                                                                                            <Label htmlFor={`new-${deptKey}-${permission}`} className="text-xs font-normal">{permission}</Label>
                                                                                        </div>
                                                                                    ))}
                                                                                </div>
                                                                            </div>
                                                                        )
                                                                    })}
                                                                </div>
                                                            )
                                                        }
                                                        if (subModuleKey === 'Projects' && moduleName === 'Store & Stock Management') {
                                                            const projectPermissions = permissions as string[];
                                                            return (
                                                              <div key={fullKey} className="p-3 border rounded-md mt-2">
                                                                <h4 className="font-semibold text-sm mb-3">Project-specific Permissions</h4>
                                                                {projects.map(proj => {
                                                                  const projectKey = `Store & Stock Management.Projects.${proj.id}`;
                                                                  const grantedInProject = newRole.permissions?.[projectKey] || [];
                                                                  const isAllInProjectSelected = projectPermissions.length > 0 && grantedInProject.length === projectPermissions.length;
                                                                  return (
                                                                    <div key={proj.id} className="p-2 border-t mt-2 first:mt-0 first:border-t-0">
                                                                      <div className="flex justify-between items-center mb-2">
                                                                        <p className="text-sm font-medium">{proj.projectName}</p>
                                                                        <div className="flex items-center space-x-2">
                                                                          <Checkbox
                                                                            id={`select-all-project-${proj.id}`}
                                                                            checked={isAllInProjectSelected}
                                                                            onCheckedChange={(checked) => handleSelectAllForGroup(projectKey, projectPermissions, !!checked)}
                                                                            disabled={!isViewModulePermission}
                                                                          />
                                                                          <Label htmlFor={`select-all-project-${proj.id}`} className="text-xs font-medium">All</Label>
                                                                        </div>
                                                                      </div>
                                                                      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                                                                        {projectPermissions.map(permission => (
                                                                          <div key={permission} className="flex items-center space-x-2">
                                                                            <Checkbox
                                                                              id={`new-${projectKey}-${permission}`}
                                                                              checked={grantedInProject.includes(permission)}
                                                                              onCheckedChange={(checked) => handlePermissionChange(projectKey, permission, !!checked)}
                                                                              disabled={!isViewModulePermission}
                                                                            />
                                                                            <Label htmlFor={`new-${projectKey}-${permission}`} className="text-xs font-normal">{permission}</Label>
                                                                          </div>
                                                                        ))}
                                                                      </div>
                                                                    </div>
                                                                  );
                                                                })}
                                                              </div>
                                                            );
                                                          }

                                                          if (Array.isArray(permissions) && permissions.length > 0) {
                                                                const resourcePermissions = permissions;
                                                                const grantedInGroup = newRole.permissions?.[fullKey] || [];
                                                                const isAllInGroupSelected = Array.isArray(permissions) && permissions.length > 0 && grantedInGroup.length === permissions.length;

                                                                return (
                                                                    <div key={fullKey} className="p-3 border rounded-md mt-2">
                                                                        <div className="flex justify-between items-center mb-3">
                                                                        <h4 className="font-semibold text-sm">{subModuleKey}</h4>
                                                                        <div className="flex items-center space-x-2">
                                                                            <Checkbox
                                                                                id={`select-all-group-new-${fullKey}`}
                                                                                checked={isAllInGroupSelected}
                                                                                onCheckedChange={(checked) => handleSelectAllForGroup(fullKey, permissions as string[], !!checked)}
                                                                                disabled={!isViewModulePermission || !Array.isArray(permissions)}
                                                                            />
                                                                            <Label htmlFor={`select-all-group-new-${fullKey}`} className="text-xs font-medium">All</Label>
                                                                        </div>
                                                                        </div>
                                                                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                                                            {Array.isArray(permissions) && permissions.map(permission => (
                                                                                <div key={permission} className="flex items-center space-x-2">
                                                                                    <Checkbox
                                                                                        id={`new-${fullKey}-${permission}`}
                                                                                        checked={grantedInGroup.includes(permission)}
                                                                                        onCheckedChange={(checked) => handlePermissionChange(fullKey, permission, !!checked)}
                                                                                        disabled={!isViewModulePermission}
                                                                                    />
                                                                                    <Label htmlFor={`new-${fullKey}-${permission}`} className="text-xs font-normal leading-tight">{permission}</Label>
                                                                                </div>
                                                                            ))}
                                                                        </div>
                                                                    </div>
                                                                )
                                                            }
                                                            
                                                            // Handle nested objects of permissions (like Reports)
                                                            if (typeof permissions === 'object' && !Array.isArray(permissions)) {
                                                              return (
                                                                  <div key={fullKey} className="p-3 border rounded-md mt-2">
                                                                      <h4 className="font-semibold text-sm mb-2">{subModuleKey}</h4>
                                                                      {Object.entries(permissions).map(([nestedKey, nestedPerms]) => {
                                                                          if (!Array.isArray(nestedPerms)) return null;
                                                                          const nestedFullKey = `${fullKey}.${nestedKey}`;
                                                                          const grantedInNestedGroup = newRole.permissions?.[nestedFullKey] || [];
                                                                          const isAllInNestedSelected = nestedPerms.length > 0 && grantedInNestedGroup.length === nestedPerms.length;
                                                                          
                                                                          // Special case for 'View' with an empty array
                                                                          if (nestedPerms.length === 0) {
                                                                            return (
                                                                              <div key={nestedFullKey} className="p-2 border-t mt-2 first:mt-0 first:border-t-0">
                                                                                <div className="flex items-center space-x-2">
                                                                                  <Checkbox
                                                                                    id={`new-${nestedFullKey}-View`}
                                                                                    checked={grantedInNestedGroup.includes('View')}
                                                                                    onCheckedChange={(checked) => handlePermissionChange(nestedFullKey, 'View', !!checked)}
                                                                                    disabled={!isViewModulePermission}
                                                                                  />
                                                                                  <Label htmlFor={`new-${nestedFullKey}-View`} className="text-sm font-normal">{nestedKey}</Label>
                                                                                </div>
                                                                              </div>
                                                                            );
                                                                          }
                                                                          
                                                                          return (
                                                                              <div key={nestedFullKey} className="p-2 border-t mt-2 first:mt-0 first:border-t-0">
                                                                                  <div className="flex justify-between items-center mb-2">
                                                                                      <p className="text-sm font-medium">{nestedKey}</p>
                                                                                      {nestedPerms.length > 1 && (
                                                                                          <div className="flex items-center space-x-2">
                                                                                              <Checkbox
                                                                                                  id={`select-all-nested-${nestedFullKey}`}
                                                                                                  checked={isAllInNestedSelected}
                                                                                                  onCheckedChange={(checked) => handleSelectAllForGroup(nestedFullKey, nestedPerms, !!checked)}
                                                                                                  disabled={!isViewModulePermission}
                                                                                              />
                                                                                              <Label htmlFor={`select-all-nested-${nestedFullKey}`} className="text-xs font-medium">All</Label>
                                                                                          </div>
                                                                                      )}
                                                                                  </div>
                                                                                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                                                                                      {nestedPerms.map(p => (
                                                                                          <div key={p} className="flex items-center space-x-2">
                                                                                              <Checkbox
                                                                                                  id={`new-${nestedFullKey}-${p}`}
                                                                                                  checked={grantedInNestedGroup.includes(p)}
                                                                                                  onCheckedChange={(checked) => handlePermissionChange(nestedFullKey, p, !!checked)}
                                                                                                  disabled={!isViewModulePermission}
                                                                                              />
                                                                                              <Label htmlFor={`new-${nestedFullKey}-${p}`} className="text-xs font-normal">{p}</Label>
                                                                                          </div>
                                                                                      ))}
                                                                                  </div>
                                                                              </div>
                                                                          )
                                                                      })}
                                                                  </div>
                                                              )
                                                            }
                                                        })}
                                                    </div>
                                                </>
                                            )}
                                            </CardContent>
                                        </Card>
                                    </AccordionContent>
                                </AccordionItem>
                                )
                            })}
                        </Accordion>
                    </ScrollArea>
                </div>
            </div>
        </div>
    );
}

```