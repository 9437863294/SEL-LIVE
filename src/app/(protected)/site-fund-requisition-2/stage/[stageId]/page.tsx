
'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Check,
  Clock,
  Loader2,
  MoreHorizontal,
  ShieldAlert,
  Eye,
  FilePlus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
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
  Requisition,
  WorkflowStep,
  ActionLog,
  Project,
  Department,
  ActionConfig,
  ExpenseRequest,
  AccountHead,
  SubAccountHead,
} from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { Skeleton } from '@/components/ui/skeleton';
import { format } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { getAssigneeForStep, calculateDeadline } from '@/lib/workflow-utils';
import ViewRequisitionDialog from '@/components/ViewRequisitionDialog';
import { useAuthorization } from '@/hooks/useAuthorization';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

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
    Revise: 'revised',
  };
  return map[action] ?? `${action.toLowerCase()}ed`;
}

function formatINR(n?: number) {
    const v = Number.isFinite(n as number) ? (n as number) : 0;
    try {
      return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(v);
    } catch {
      return `₹${v.toFixed(2)}`;
    }
}

function hasDeptId(a: unknown): a is ActionConfig & { departmentId?: string } {
    return typeof a === 'object' && a !== null && 'departmentId' in (a as any);
}

const slugify = (value: string): string =>
    value.toString().trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');


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

  const [tasks, setTasks] = useState<Requisition[]>([]);
  const [stage, setStage] = useState<WorkflowStep | null>(null);
  const [workflow, setWorkflow] = useState<WorkflowStep[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isActionLoading, setIsActionLoading] = useState<string | null>(null);
  const [selectedRequisition, setSelectedRequisition] = useState<Requisition | null>(null);
  const [isViewOpen, setIsViewOpen] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);

  const [isConfirmExpenseOpen, setIsConfirmExpenseOpen] = useState(false);
  const [expenseToCreate, setExpenseToCreate] = useState<any>(null);
  const [isCreatingExpense, setIsCreatingExpense] = useState(false);
  const [accountHeads, setAccountHeads] = useState<AccountHead[]>([]);
  const [subAccountHeads, setSubAccountHeads] = useState<SubAccountHead[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);

  const fetchTasks = useCallback(async () => {
    if (!userId || !stageId || !projectSlug) return;

    setIsLoading(true);
    try {
      const workflowRef = doc(db, 'workflows', 'site-fund-requisition-2-workflow');
      const workflowSnap = await getDoc(workflowRef);
      if (!workflowSnap.exists()) {
        toast({ title: 'Error', description: 'Workflow not found.', variant: 'destructive' });
        router.back();
        return;
      }
      const steps = (workflowSnap.data().steps || []) as WorkflowStep[];
      setWorkflow(steps);
      const currentStage = steps.find((s) => s.id === stageId);
      if (!currentStage) {
        toast({ title: 'Error', description: 'Workflow stage not found.', variant: 'destructive' });
        router.back();
        return;
      }
      setStage(currentStage);

      const projectsQueryRef = query(collection(db, 'projects'));
      const projectsSnapshot = await getDocs(projectsQueryRef);
      const projectData = projectsSnapshot.docs
        .map((d) => ({ id: d.id, ...d.data() } as Project))
        .find((p) => slugify(p.projectName) === projectSlug);

      if (!projectData) throw new Error('Project not found');
      const pid = projectData.id;
      setProjectId(pid);
      
      const deptsSnap = await getDocs(collection(db, 'departments'));
      setDepartments(deptsSnap.docs.map(d => ({id: d.id, ...d.data()} as Department)));
      
      const headsSnap = await getDocs(collection(db, 'accountHeads'));
      setAccountHeads(headsSnap.docs.map(d => ({id: d.id, ...d.data()} as AccountHead)));

      const subHeadsSnap = await getDocs(collection(db, 'subAccountHeads'));
      setSubAccountHeads(subHeadsSnap.docs.map(d => ({id: d.id, ...d.data()} as SubAccountHead)));

      const reqsQuery = query(
        collection(db, 'requisitions'),
        where('projectId', '==', pid),
        where('currentStepId', '==', stageId)
      );
      const reqsSnapshot = await getDocs(reqsQuery);
      const tasksData = reqsSnapshot.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as Requisition));
      setTasks(tasksData);
      
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      router.back();
    } finally {
      setIsLoading(false);
    }
  }, [projectSlug, stageId, toast, router, userId]);
  
  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const { pendingTasks, completedTasks } = useMemo(() => {
    if (!userId || !stage) return { pendingTasks: [], completedTasks: [] };
    const myPending = tasks.filter(t => (t.assignees ?? []).includes(userId) && t.status !== 'Completed' && t.status !== 'Rejected');
    const myCompleted = tasks.filter(t => !myPending.some(pt => pt.id === t.id) && (t.history ?? []).some(h => h.stepName === stage.name && h.userId === userId));
    return { pendingTasks: myPending, completedTasks: myCompleted };
  }, [tasks, userId, stage]);

  const handleAction = async (taskId: string, action: string | ActionConfig, comment: string = '') => {
    if (!workflow || !user || !userName || !stage || !projectSlug || !projectId) return;

    const actionName = typeof action === 'string' ? action : action.name;
    const currentTask = tasks.find(t => t.id === taskId);
    if(!currentTask) return;

    if (actionName === 'Create Expense Request') {
        const targetDepartmentId = typeof action !== 'string' && hasDeptId(action) ? action.departmentId : undefined;
        if (!targetDepartmentId) {
            toast({ title: 'Config Error', description: 'Department not specified for expense request.', variant: 'destructive' });
            return;
        }

        const subHead = subAccountHeads.find(sh => sh.name.toLowerCase() === 'unsecured loan');
        const parentHead = subHead ? accountHeads.find(h => h.id === subHead.headId) : undefined;
        let previewRequestNo = 'Generating...';

        try {
            const configRef = doc(db, 'departmentSerialConfigs', targetDepartmentId);
            const configDoc = await getDoc(configRef);
            if (configDoc.exists()) {
                const configData = configDoc.data() as any;
                const newIndex = configData.startingIndex;
                const formattedIndex = String(newIndex).padStart(4, '0');
                previewRequestNo = `${configData.prefix || ''}${configData.format || ''}${formattedIndex}${configData.suffix || ''}`;
            } else {
                previewRequestNo = 'Config not found';
            }
        } catch {
            previewRequestNo = 'Error';
        }

        setExpenseToCreate({
            departmentId: targetDepartmentId,
            projectId: currentTask.projectId,
            amount: currentTask.amount,
            partyName: currentTask.partyName,
            description: currentTask.description,
            headOfAccount: parentHead?.name || 'Liability',
            subHeadOfAccount: subHead?.name || 'Unsecured Loan',
            remarks: `From Site Fund Requisition ${currentTask.requisitionId}`,
            requestNo: previewRequestNo,
        });
        setIsConfirmExpenseOpen(true);
        return;
    }

    setIsActionLoading(taskId);
    try {
      const requisitionRef = doc(db, 'requisitions', taskId);

      await runTransaction(db, async (transaction) => {
        const reqDoc = await transaction.get(requisitionRef);
        if (!reqDoc.exists()) throw new Error('Requisition document not found!');
        const currentRequisitionData = reqDoc.data() as Requisition;
        
        const newActionLog: ActionLog = { action: actionName, comment, userId, userName, timestamp: Timestamp.now(), stepName: stage.name };
        
        let nextStep: WorkflowStep | undefined;
        let newStatus: Requisition['status'] = currentRequisitionData.status;
        let newStage = currentRequisitionData.stage;
        let newCurrentStepId: string | null = currentRequisitionData.currentStepId || null;
        let newAssignees: string[] = [];
        let newDeadline: Timestamp | null = null;
        
        const isCompletionAction = ['Approve', 'Complete', 'Verified', 'Update Approved Amount'].includes(actionName);

        if (isCompletionAction) {
          const currentStepIndexTx = workflow.findIndex(s => s.id === stage.id);
          nextStep = workflow?.[currentStepIndexTx + 1];
          if (nextStep) {
            newStage = nextStep.name;
            newStatus = 'In Progress';
            newCurrentStepId = nextStep.id;
            const assignees = await getAssigneeForStep(nextStep, currentRequisitionData);
            if (!assignees || assignees.length === 0) throw new Error(`No assignee for step: ${nextStep.name}`);
            newAssignees = assignees;
            newDeadline = Timestamp.fromDate(await calculateDeadline(new Date(), nextStep.tat));
          } else {
            newStage = 'Completed';
            newStatus = 'Completed';
            newCurrentStepId = null;
          }
        } else if (actionName === 'Reject') {
          newStage = 'Rejected';
          newStatus = 'Rejected';
          newCurrentStepId = null;
        }

        const updateData: any = {
          status: newStatus,
          stage: newStage,
          currentStepId: newCurrentStepId,
          assignees: newAssignees,
          deadline: newDeadline,
          history: arrayUnion(newActionLog),
        };
        transaction.update(requisitionRef, updateData);
      });

      toast({ title: 'Success', description: `Task has been ${pastTense(actionName)}.` });
      await fetchTasks();
    } catch (error: any) {
      toast({ title: 'Action Failed', description: error.message, variant: 'destructive' });
    } finally {
      setIsActionLoading(null);
    }
  };

  const renderTable = (data: Requisition[], type: 'pending' | 'completed') => (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Request ID</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <TableRow key={i}><TableCell colSpan={5}><Skeleton className="h-8" /></TableCell></TableRow>
              ))
            ) : data.length > 0 ? (
              data.map((task) => {
                const currentStep = workflow?.find((s) => s.id === task.currentStepId);
                const actions = Array.isArray(currentStep?.actions) ? (currentStep.actions) : [];
                return (
                  <TableRow key={task.id} onClick={() => { setSelectedRequisition(task); setIsViewOpen(true); }} className="cursor-pointer">
                    <TableCell>{task.requisitionId}</TableCell>
                    <TableCell>{humanDate(task.date)}</TableCell>
                    <TableCell>{formatINR(task.amount)}</TableCell>
                    <TableCell><Badge>{task.status}</Badge></TableCell>
                    <TableCell className="text-right">
                       {isActionLoading === task.id ? <Loader2 className="h-4 w-4 animate-spin ml-auto" /> : (
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                               <Button variant="ghost" size="icon" className="h-8 w-8" onClick={e => e.stopPropagation()}>
                                <MoreHorizontal className="h-4 w-4" />
                               </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuItem onSelect={() => { setSelectedRequisition(task); setIsViewOpen(true); }}>
                                    <Eye className="mr-2 h-4 w-4" /> View Details
                                </DropdownMenuItem>
                                {type === 'pending' && actions.map((action) => {
                                    const actionName = typeof action === 'string' ? action : action.name;
                                    return (
                                        <DropdownMenuItem key={actionName} onSelect={(e) => { e.preventDefault(); handleAction(task.id, action) }}>
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
                <TableCell colSpan={5} className="text-center h-24">No {type} tasks.</TableCell>
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
            <Link href="/site-fund-requisition-2">
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-6 w-6" />
              </Button>
            </Link>
            <h1 className="text-2xl font-bold">{stage?.name || 'Stage'}</h1>
          </div>
        </div>
        <Tabs defaultValue="pending">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="pending"><Clock className="mr-2 h-4 w-4" /> Pending ({pendingTasks.length})</TabsTrigger>
            <TabsTrigger value="completed"><Check className="mr-2 h-4 w-4" /> Completed ({completedTasks.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="pending" className="mt-4">{renderTable(pendingTasks, 'pending')}</TabsContent>
          <TabsContent value="completed" className="mt-4">{renderTable(completedTasks, 'completed')}</TabsContent>
        </Tabs>
      </div>

       <ViewRequisitionDialog
          isOpen={isViewOpen}
          onOpenChange={setIsViewOpen}
          requisition={selectedRequisition}
          projects={projects}
          departments={departments}
          onRequisitionUpdate={fetchTasks}
        />
    </>
  );
}

```
- src/hooks/use-local-storage.ts:
```ts
'use client';

import { useState, useEffect, useCallback } from 'react';

export function useLocalStorage<T>(key: string, initialValue: T) {
  const [storedValue, setStoredValue] = useState<T>(initialValue);

  // We need to use a useEffect to read from local storage only on the client side.
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      const item = window.localStorage.getItem(key);
      setStoredValue(item ? JSON.parse(item) : initialValue);
    } catch (error) {
      console.error(error);
      setStoredValue(initialValue);
    }
  }, [key, initialValue]);

  const setValue = useCallback((value: T | ((val: T) => T)) => {
    if (typeof window === 'undefined') {
        console.warn(`Tried setting localStorage key “${key}” even though environment is not a client`);
        return;
    }
    try {
      // Allow value to be a function so we have same API as useState
      const valueToStore = value instanceof Function ? value(storedValue) : value;
      setStoredValue(valueToStore);
      window.localStorage.setItem(key, JSON.stringify(valueToStore));
    } catch (error) {
      console.error(error);
    }
  }, [key, storedValue]);

  return [storedValue, setValue] as const;
}

```
- src/hooks/use-media-query.ts:
```ts
"use client"

import * as React from "react"

export function useMediaQuery(query: string) {
  const [value, setValue] = React.useState(false)

  React.useEffect(() => {
    function onChange(event: MediaQueryListEvent) {
      setValue(event.matches)
    }

    const result = matchMedia(query)
    result.addEventListener("change", onChange)
    setValue(result.matches)

    return () => result.removeEventListener("change", onChange)
  }, [query])

  return value
}

```
- tailwind.config.js:
```js
/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: [
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
	],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: 0 },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: 0 },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
}
```
- next-env.d.ts:
```ts
/// <reference types="next" />
/// <reference types="next/image-types/global" />

// NOTE: This file should not be edited
// see https://nextjs.org/docs/basic-features/typescript for more information.

```
- postcss.config.js:
```js
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
```
