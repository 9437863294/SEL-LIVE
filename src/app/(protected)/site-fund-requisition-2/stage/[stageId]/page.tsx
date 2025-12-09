
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
  collectionGroup,
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
    const currentRequisition = tasks.find(t => t.id === taskId);
    if (!user || !userName || !currentRequisition || !workflow || !currentStep || !projectSlug || !projectId) return;

    const actionName = typeof action === 'string' ? action : action.name;

    if (actionName === 'Create Expense Request') {
        const targetDepartmentId = typeof action !== 'string' && hasDeptId(action) ? action.departmentId : undefined;
        if (!targetDepartmentId) {
            toast({ title: 'Config Error', description: 'Department not specified for expense request.', variant: 'destructive' });
            return;
        }

        const unsecuredLoanSubHead = subAccountHeads.find(sh => sh.name.toLowerCase() === 'unsecured loan');
        const defaultHead = unsecuredLoanSubHead ? accountHeads.find(h => h.id === unsecuredLoanSubHead.headId)?.name : 'Liability';
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
            departmentId: targetDepartmentId || '',
            projectId: currentRequisition.projectId || '',
            amount: currentRequisition.amount || 0,
            partyName: currentRequisition.partyName || '',
            description: currentRequisition.description || '',
            headOfAccount: defaultHead || 'Liability',
            subHeadOfAccount: unsecuredLoanSubHead?.name || 'Unsecured Loan',
            remarks: `Generated from Site Fund Requisition ${currentRequisition.requisitionId}` || '',
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
        
        const newActionLog: ActionLog = { action: actionName, comment, userId, userName, timestamp: Timestamp.now(), stepName: currentStep.name };
        
        let nextStep: WorkflowStep | undefined;
        let newStatus: Requisition['status'] = currentRequisitionData.status;
        let newStage = currentRequisitionData.stage;
        let newCurrentStepId: string | null = currentRequisitionData.currentStepId || null;
        let newAssignees: string[] = [];
        let newDeadline: Timestamp | null = null;
        
        const isCompletionAction = ['Approve', 'Complete', 'Verified', 'Update Approved Amount', 'Create Expense Request'].includes(actionName);

        if (isCompletionAction) {
          const currentStepIndexTx = workflow.findIndex(s => s.id === currentStep.id);
          nextStep = workflow?.[currentStepIndexTx + 1];
          if (nextStep) {
            newStage = nextStep.name;
            newStatus = 'In Progress';
            newCurrentStepId = nextStep.id;
            const assignees = await getAssigneeForStep(nextStep, currentRequisitionData as any);
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
              <TableRow><TableCell colSpan={5} className="text-center h-24">No {type} tasks.</TableCell></TableRow>
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
            <Link href={`/site-fund-requisition-2`}>
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
          projects={[]}
          departments={departments}
          onRequisitionUpdate={fetchTasks}
        />
    </>
  );
}

```
- src/app/api/print-auth/route.ts:
```ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PRINT_PASSCODE = process.env.PRINT_PASSCODE || '1234';
const COOKIE_NAME = 'print_token';
const MAX_AGE = 60 * 60 * 24 * 7; // 1 week in seconds

export async function POST(req: NextRequest) {
  try {
    const { code } = await req.json();

    if (code === PRINT_PASSCODE) {
      const response = NextResponse.json({ success: true });
      // Set a cookie to remember auth status
      response.cookies.set(COOKIE_NAME, 'true', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: MAX_AGE,
        path: '/',
      });
      return response;
    } else {
      return NextResponse.json(
        { message: 'Invalid passcode.' },
        { status: 401 }
      );
    }
  } catch {
    return NextResponse.json(
      { message: 'Invalid request body.' },
      { status: 400 }
    );
  }
}

```
- src/app/print-auth/page.tsx:
```tsx

'use client';

import { Suspense } from 'react';
import { PrintAuthPageContent } from '@/components/auth/PrintAuthPageContent';

export default function PrintAuthPage() {
  return (
    <Suspense>
      <PrintAuthPageContent />
    </Suspense>
  );
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
- tsconfig.json:
```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": [
      "dom",
      "dom.iterable",
      "esnext"
    ],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "react-jsx",
    "incremental": true,
    "plugins": [
      {
        "name": "next"
      }
    ],
    "paths": {
      "@/*": [
        "./src/*"
      ]
    }
  },
  "include": [
    "next-env.d.ts",
    "**/*.ts",
    "**/*.tsx",
    ".next/types/**/*.ts"
  ],
  "exclude": [
    "node_modules"
  ]
}

```
- package.json:
```json
{
  "name": "nextn",
  "version": "0.1.0",
  "private": "true",
  "scripts": {
    "dev": "next dev --turbopack",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@genkit-ai/google-genai": "1.18.0",
    "@genkit-ai/next": "1.18.0",
    "@hello-pangea/dnd": "^16.6.0",
    "@hookform/resolvers": "^3.9.0",
    "@radix-ui/react-accordion": "^1.2.0",
    "@radix-ui/react-alert-dialog": "^1.1.1",
    "@radix-ui/react-avatar": "^1.1.0",
    "@radix-ui/react-checkbox": "^1.1.1",
    "@radix-ui/react-collapsible": "^1.1.0",
    "@radix-ui/react-dialog": "^1.1.1",
    "@radix-ui/react-dropdown-menu": "^2.1.1",
    "@radix-ui/react-icons": "^1.3.0",
    "@radix-ui/react-label": "^2.1.0",
    "@radix-ui/react-menubar": "^1.1.1",
    "@radix-ui/react-popover": "^1.1.1",
    "@radix-ui/react-progress": "^1.1.0",
    "@radix-ui/react-radio-group": "^1.2.0",
    "@radix-ui/react-scroll-area": "^1.2.0",
    "@radix-ui/react-select": "^2.1.1",
    "@radix-ui/react-separator": "^1.1.0",
    "@radix-ui/react-slider": "^1.2.0",
    "@radix-ui/react-slot": "^1.1.0",
    "@radix-ui/react-switch": "^1.1.0",
    "@radix-ui/react-tabs": "^1.1.0",
    "@radix-ui/react-toast": "^1.2.1",
    "@radix-ui/react-tooltip": "^1.1.2",
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.1.1",
    "cmdk": "^1.0.0",
    "date-fns": "^3.6.0",
    "embla-carousel-react": "^8.1.6",
    "firebase": "^12.5.0",
    "genkit": "1.18.0",
    "lucide-react": "^0.417.0",

    "next": "15.5.7",
    "react": "18.3.1",
    "react-dom": "18.3.1",

    "openai": "^6.9.1",
    "patch-package": "^8.0.0",
    "react-beautiful-dnd": "^13.1.1",
    "react-day-picker": "^8.10.1",
    "react-hook-form": "^7.52.1",
    "react-resizable-panels": "^2.0.22",
    "react-to-print": "^2.15.1",
    "recharts": "^2.12.7",
    "server-only": "^0.0.1",
    "tailwind-merge": "^2.4.0",
    "tailwindcss-animate": "^1.0.7",
    "wav": "^1.0.2",
    "xlsx": "^0.18.5",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/dotenv": "^6.1.1",
    "@types/node": "^20.14.12",


    "@types/react": "^18.3.3",
    "@types/react-beautiful-dnd": "^13.1.8",
    "@types/react-dom": "^18.3.0",

    "autoprefixer": "^10.4.21",
    "dotenv": "^17.2.3",
    "genkit-cli": "^1.18.0",
    "postcss": "^8.5.6",
    "tailwindcss": "^3.4.18",
    "typescript": "^5.5.4"
  }
}
