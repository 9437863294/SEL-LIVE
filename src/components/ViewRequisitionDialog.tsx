
'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef, Fragment } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { db, storage } from '@/lib/firebase';
import {
  doc,
  updateDoc,
  Timestamp,
  writeBatch,
  runTransaction,
  getDoc,
  collection,
  query,
  arrayUnion,
  getDocs,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import type {
  Requisition,
  Project,
  Department,
  WorkflowStep,
  ActionLog,
  Attachment,
  User,
  ActionConfig,
  AccountHead,
  SubAccountHead,
  ExpenseRequest,
} from '@/lib/types';
import { format } from 'date-fns';
import { useAuth } from './auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Loader2, Printer, Paperclip, Download, Eye, FilePlus, ChevronDown } from 'lucide-react';
import { Separator } from './ui/separator';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from './ui/collapsible';
import { createExpenseRequest } from '@/ai';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import { Badge } from './ui/badge';
import {
  Tooltip,
  TooltipProvider,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { getAssigneeForStep, calculateDeadline } from '@/lib/workflow-utils';
import { ScrollArea } from './ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';

function isFsTimestamp(v: unknown): v is Timestamp {
  return !!v && typeof v === 'object' && typeof (v as any).toDate === 'function';
}

function toDateSafe(v: unknown): Date | null {
  if (!v) return null;
  if (isFsTimestamp(v)) return v.toDate();
  if (v instanceof Date) return v;
  const d = new Date(v as any);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDateSafe(v: unknown, fmt = 'dd MMM, yy HH:mm'): string {
  const d = toDateSafe(v);
  return d ? format(d, fmt) : '—';
}

function stepDisplay(
  step: Partial<WorkflowStep> & { id: string } | any
): string {
  return step?.name ?? step?.label ?? step?.title ?? step?.id ?? '—';
}

function hasDeptId(a: unknown): a is ActionConfig & { departmentId?: string } {
  return typeof a === 'object' && a !== null && 'departmentId' in (a as any);
}

type EnrichedStep = WorkflowStep & {
  assignedUserName?: string;
  completionDate?: string;
  deadline?: string;
  status: 'Pending' | 'Completed' | 'Current';
  name?: string;
};

interface ViewRequisitionDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  requisition: Requisition | null;
  projects: Project[];
  departments: Department[];
  onRequisitionUpdate: () => void;
}

export default function ViewRequisitionDialog({
  isOpen,
  onOpenChange,
  requisition,
  projects,
  departments,
  onRequisitionUpdate,
}: ViewRequisitionDialogProps) {
  const { user, users } = useAuth();
  const { toast } = useToast();
  const [workflow, setWorkflow] = useState<WorkflowStep[] | null>(null);
  const [enrichedSteps, setEnrichedSteps] = useState<EnrichedStep[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [actionComment, setActionComment] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [isWorkflowOpen, setIsWorkflowOpen] = useState(false);

  const [isConfirmExpenseOpen, setIsConfirmExpenseOpen] = useState(false);
  const [expenseToCreate, setExpenseToCreate] = useState<any>(null);
  const [isCreatingExpense, setIsCreatingExpense] = useState(false);
  const [accountHeads, setAccountHeads] = useState<AccountHead[]>([]);
  const [subAccountHeads, setSubAccountHeads] = useState<SubAccountHead[]>(
    []
  );

  const currentStep = useMemo(() => {
    if (!requisition || !workflow) return null;
    return workflow.find((s) => s.id === requisition.currentStepId) || null;
  }, [requisition, workflow]);

  useEffect(() => {
    const fetchWorkflowAndUsers = async () => {
      if (!requisition) return;
      setIsLoading(true);
      try {
        const [workflowSnap, headsSnap, subHeadsSnap] = await Promise.all([
          getDoc(doc(db, 'workflows', 'site-fund-requisition')),
          getDocs(collection(db, 'accountHeads')),
          getDocs(collection(db, 'subAccountHeads')),
        ]);

        if (workflowSnap.exists()) {
          const steps = (workflowSnap.data()?.steps || []) as WorkflowStep[];
          setWorkflow(Array.isArray(steps) ? steps : []);
        } else {
          toast({
            title: 'Error',
            description: 'Workflow configuration not found.',
            variant: 'destructive',
          });
          setWorkflow([]);
        }

        setAccountHeads(
          headsSnap.docs.map(
            (d) => ({ id: d.id, ...(d.data() as any) } as AccountHead)
          )
        );
        setSubAccountHeads(
          subHeadsSnap.docs.map(
            (d) => ({ id: d.id, ...(d.data() as any) } as SubAccountHead)
          )
        );
      } catch (error) {
        console.error('Error fetching workflow/users:', error);
        toast({
          title: 'Error',
          description: 'Could not load workflow or user data.',
          variant: 'destructive',
        });
      } finally {
        setIsLoading(false);
      }
    };

    if (isOpen && requisition) {
      fetchWorkflowAndUsers();
    } else {
      setWorkflow(null);
      setActionComment('');
      setFile(null);
      setEnrichedSteps([]);
      setIsWorkflowOpen(false);
      setExpenseToCreate(null);
    }
  }, [requisition, isOpen, toast]);

  useEffect(() => {
    if (requisition && workflow && users.length > 0) {
      const history = requisition.history || [];
      const currentStepIndex = workflow.findIndex(
        (s) => s.id === requisition.currentStepId
      );

      const allStepsWithDetails = workflow.map((wfStep, index) => {
        const wfStepLabel = stepDisplay(wfStep as any);
        const historyEntries = history.filter(
          (h) => h.stepName === wfStepLabel
        );
        const completionEntry = historyEntries.find((h) =>
          [
            'Complete',
            'Approve',
            'Verified',
            'Update Approved Amount',
            'Create Expense Request',
          ].includes(h.action)
        );

        let status: EnrichedStep['status'] = 'Pending';
        if (
          requisition.status === 'Completed' ||
          requisition.status === 'Rejected'
        ) {
          if (
            historyEntries.length > 0 ||
            (index <= currentStepIndex && currentStepIndex !== -1)
          ) {
            status = 'Completed';
          }
        } else if (wfStep.id === requisition.currentStepId) {
          status = 'Current';
        } else if (
          completionEntry ||
          (currentStepIndex > -1 && index < currentStepIndex)
        ) {
          status = 'Completed';
        }

        let assignedUserName = 'N/A';
        const completionUser = completionEntry ? completionEntry.userName : null;
        if (completionUser) {
          assignedUserName = completionUser;
        } else if (status === 'Current' && Array.isArray(requisition.assignees)) {
          assignedUserName = requisition.assignees
            .map((id) => users.find((u) => u.id === id)?.name || 'Unknown')
            .join(', ');
        } else {
          const lastEntry = historyEntries[historyEntries.length - 1];
          if (lastEntry?.userName) assignedUserName = lastEntry.userName;
        }

        return {
          ...wfStep,
          assignedUserName,
          completionDate: completionEntry
            ? formatDateSafe(completionEntry.timestamp)
            : '-',
          deadline:
            status === 'Current' && requisition.deadline
              ? formatDateSafe(requisition.deadline)
              : '-',
          status,
          name: (wfStep as any).name,
        } as EnrichedStep;
      });

      setEnrichedSteps(allStepsWithDetails);
    }
  }, [requisition, workflow, users, isOpen]);

  const handleAction = async (action: string | ActionConfig) => {
    if (!user || !requisition || !workflow || !currentStep) return;

    const actionName = typeof action === 'string' ? action : action.name;

    if (currentStep.upload === 'Required' && !file) {
      toast({
        title: 'Upload Required',
        description: `Please upload a document to complete the "${actionName}" action.`,
        variant: 'destructive',
      });
      return;
    }

    if (actionName === 'Create Expense Request') {
      const targetDepartmentId =
        typeof action !== 'string' && hasDeptId(action)
          ? action.departmentId
          : undefined;

      if (!targetDepartmentId) {
        toast({
          title: 'Configuration Error',
          description: 'Department not specified for expense request creation.',
          variant: 'destructive',
        });
        return;
      }

      const unsecuredLoanSubHead = subAccountHeads.find(
        (sh) => sh.name?.toLowerCase() === 'unsecured loan'
      );
      const defaultHead = unsecuredLoanSubHead
        ? accountHeads.find((h) => h.id === unsecuredLoanSubHead.headId)?.name
        : 'Liability';

      let previewRequestNo = 'Generating...';
      try {
        const configRef = doc(db, 'departmentSerialConfigs', targetDepartmentId);
        const configDoc = await getDoc(configRef);
        if (configDoc.exists()) {
          const configData = configDoc.data() as any;
          const newIndex = configData.startingIndex;
          const formattedIndex = String(newIndex).padStart(4, '0');
          previewRequestNo = `${configData.prefix || ''}${
            configData.format || ''
          }${formattedIndex}${configData.suffix || ''}`;
        } else {
          previewRequestNo = 'Config not found';
        }
      } catch {
        previewRequestNo = 'Error generating ID';
      }

      setExpenseToCreate({
        departmentId: targetDepartmentId || '',
        projectId: requisition.projectId || '',
        amount: requisition.amount || 0,
        partyName: requisition.partyName || '',
        description: requisition.description || '',
        headOfAccount: defaultHead || 'Liability',
        subHeadOfAccount: unsecuredLoanSubHead?.name || 'Unsecured Loan',
        remarks: `Generated from Site Fund Requisition ${requisition.requisitionId}` || '',
        requestNo: previewRequestNo,
      });
      setIsConfirmExpenseOpen(true);
      return;
    }

    setIsLoading(true);
    try {
      const requisitionRef = doc(db, 'requisitions', requisition.id);

      let attachmentData: Attachment | undefined = undefined;
      if (file) {
        const currStepName = stepDisplay(currentStep as any);
        const storagePath = `requisition-actions/${requisition.id}/${currStepName}/${file.name}`;
        const storageRef = ref(storage, storagePath);
        await uploadBytes(storageRef, file);
        const downloadURL = await getDownloadURL(storageRef);
        attachmentData = { name: file.name, url: downloadURL };
      }

      await runTransaction(db, async (transaction) => {
        const reqDoc = await transaction.get(requisitionRef);
        if (!reqDoc.exists()) throw new Error('Requisition document not found!');

        const currentRequisitionData = {
          ...reqDoc.data(),
          id: reqDoc.id,
        } as Requisition;

        const newActionLog: Partial<ActionLog> = {
          action: actionName,
          comment: actionComment,
          userId: user.id,
          userName: user.name,
          timestamp: Timestamp.now(),
          stepName: stepDisplay(currentStep as any),
        };
        if (attachmentData) {
          newActionLog.attachment = attachmentData;
        }

        const date = toDateSafe((currentRequisitionData as any).date);
        const createdAt = toDateSafe((currentRequisitionData as any).createdAt);
        const deadline = toDateSafe((currentRequisitionData as any).deadline);

        const tempReqForAssignment = {
          ...currentRequisitionData,
          date: date ? format(date, 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd'),
          createdAt: createdAt ? format(createdAt, 'yyyy-MM-dd') : undefined,
          deadline: deadline ? format(deadline, 'yyyy-MM-dd') : undefined,
          // Convert history timestamps to strings to make it serializable
          history: (currentRequisitionData.history || []).map((h) => ({
            ...h,
            timestamp:
              toDateSafe(h.timestamp)?.toISOString() || new Date().toISOString(),
          })),
        };

        let nextStep: WorkflowStep | undefined;
        let newStatus: Requisition['status'] = currentRequisitionData.status;
        let newStage = currentRequisitionData.stage;
        let newCurrentStepId: string | null =
          currentRequisitionData.currentStepId || null;
        let newAssignees: string[] = [];
        let newDeadline: Timestamp | null = null;

        const isCompletionAction = [
          'Approve',
          'Complete',
          'Verified',
          'Update Approved Amount',
          'Create Expense Request',
        ].includes(actionName);

        if (isCompletionAction) {
          const currentStepIndexTx = (workflow || []).findIndex(
            (s) => s.id === currentStep.id
          );
          nextStep =
            currentStepIndexTx >= 0
              ? workflow?.[currentStepIndexTx + 1]
              : undefined;

          if (nextStep) {
            newStage = stepDisplay(nextStep as any);
            newStatus = 'In Progress';
            newCurrentStepId = nextStep.id;

            const assignees = await getAssigneeForStep(
              nextStep,
              tempReqForAssignment as any
            );
            if (!Array.isArray(assignees) || assignees.length === 0) {
              throw new Error(
                `Could not determine assignee for step: ${stepDisplay(
                  nextStep as any
                )}`
              );
            }
            newAssignees = assignees;

            const deadlineDate = await calculateDeadline(
              new Date(),
              (nextStep as any).tat
            );
            newDeadline = Timestamp.fromDate(deadlineDate);
          } else {
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
          newAssignees = currentRequisitionData.assignees || [];
          newDeadline = currentRequisitionData.deadline || null;
        }

        const updatedData: any = {
          status: newStatus,
          stage: newStage,
          currentStepId: newCurrentStepId,
          assignees: newAssignees,
          deadline: newDeadline,
          history: arrayUnion(newActionLog),
        };

        transaction.update(requisitionRef, updatedData);
      });

      toast({
        title: 'Success',
        description: `Requisition has been successfully ${actionName.toLowerCase()}ed.`,
      });
      onRequisitionUpdate();
      onOpenChange(false);
    } catch (error: any) {
      console.error('Error processing action:', error);
      toast({
        title: 'Action Failed',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirmCreateExpense = async () => {
    if (!expenseToCreate || !requisition || !user || !workflow || !currentStep)
      return;
    setIsCreatingExpense(true);
    try {
      const { requestNo, ...dataToSave } = expenseToCreate;

      const result = await createExpenseRequest(dataToSave);
      if (!result?.success || !result?.requestNo) {
        throw new Error(result?.message || 'Failed to create expense request.');
      }

      const requisitionRef = doc(db, 'requisitions', requisition.id);

      await runTransaction(db, async (transaction) => {
        const reqDoc = await transaction.get(requisitionRef);
        if (!reqDoc.exists()) throw new Error('Requisition document not found!');

        const newActionLog: ActionLog = {
          action: 'Create Expense Request',
          comment: `Created Expense Request: ${result.requestNo}`,
          userId: user.id,
          userName: user.name,
          timestamp: Timestamp.now(),
          stepName: stepDisplay(currentStep as any),
        };

        const currentStepIndexTx = (workflow || []).findIndex(
          (s) => s.id === currentStep.id
        );
        const nextStep =
          currentStepIndexTx >= 0
            ? workflow?.[currentStepIndexTx + 1]
            : undefined;

        let newStatus: Requisition['status'];
        let newStage: string;
        let newCurrentStepId: string | null;
        let newAssignees: string[] = [];
        let newDeadline: Timestamp | null = null;

        if (nextStep) {
          newStage = stepDisplay(nextStep as any);
          newStatus = 'In Progress';
          newCurrentStepId = nextStep.id;

          const assignees = await getAssigneeForStep(nextStep, {
            ...requisition,
            ...dataToSave,
          });
          if (!Array.isArray(assignees) || assignees.length === 0) {
            throw new Error(
              `No assignee for step: ${stepDisplay(nextStep as any)}`
            );
          }
          newAssignees = assignees;

          const deadlineDate = await calculateDeadline(
            new Date(),
            (nextStep as any).tat
          );
          newDeadline = Timestamp.fromDate(deadlineDate);
        } else {
          newStage = 'Completed';
          newStatus = 'Completed';
          newCurrentStepId = null;
          newAssignees = [];
          newDeadline = null;
        }

        const requisitionUpdateData: any = {
          history: arrayUnion(newActionLog),
          expenseRequestNo: result.requestNo,
          status: newStatus,
          stage: newStage,
          currentStepId: newCurrentStepId,
          assignees: newAssignees,
          deadline: newDeadline,
        };

        transaction.update(requisitionRef, requisitionUpdateData);
      });

      toast({
        title: 'Expense Record Created & Workflow Advanced',
        description: `Request No: ${result.requestNo}`,
      });
      onRequisitionUpdate();
      onOpenChange(false);
    } catch (error: any) {
      toast({
        title: 'Error',
        description: `Failed to create expense record: ${error.message}`,
        variant: 'destructive',
      });
    } finally {
      setIsCreatingExpense(false);
      setIsConfirmExpenseOpen(false);
      setExpenseToCreate(null);
    }
  };

  const handleSubHeadChange = (subHeadName: string) => {
    if (!expenseToCreate) return;
    const selectedSubHead = subAccountHeads.find(
      (sh) => sh.name === subHeadName
    );
    const parentHead = accountHeads.find(
      (h) => h.id === selectedSubHead?.headId
    );

    setExpenseToCreate({
      ...expenseToCreate,
      subHeadOfAccount: subHeadName,
      headOfAccount: parentHead ? parentHead.name : '',
    });
  };

  const formatAsCurrency = (value: number | undefined) => {
    if (value === undefined || isNaN(value as any)) return '';
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  const isActionable =
    user &&
    requisition &&
    requisition.assignees?.includes(user.id) &&
    requisition.status !== 'Completed' &&
    requisition.status !== 'Rejected';
    
  const handlePrint = () => {
    if (!requisition) return;
    const projectSlug = projects.find(p => p.id === requisition.projectId)?.projectName.toLowerCase().replace(/\s+/g, '-');
    if (!projectSlug) {
      toast({title: 'Error', description: 'Cannot determine project for printing.', variant: 'destructive'});
      return;
    }
    const url = `/public/site-fund-requisition/${requisition.id}/print`;
    window.open(url, '_blank');
  }

  if (!requisition) {
    return null;
  }

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Details for {requisition.requisitionId}</DialogTitle>
          </DialogHeader>

          <ScrollArea className="max-h-[70vh] p-1 pr-4">
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <Label>Project</Label>
                  <p className="font-medium">
                    {projects.find((p) => p.id === requisition.projectId)
                      ?.projectName || 'N/A'}
                  </p>
                </div>
                <div>
                  <Label>Department</Label>
                  <p className="font-medium">
                    {departments.find((d) => d.id === requisition.departmentId)
                      ?.name || 'N/A'}
                  </p>
                </div>
                <div>
                  <Label>Amount</Label>
                  <p className="font-medium">
                    ₹ {requisition.amount.toLocaleString()}
                  </p>
                </div>
                <div>
                  <Label>Date</Label>
                  <p className="font-medium">
                    {formatDateSafe(requisition.date, 'dd MMM, yyyy')}
                  </p>
                </div>
                <div>
                  <Label>Raised By</Label>
                  <p className="font-medium">{requisition.raisedBy}</p>
                </div>
                <div>
                  <Label>Party Name</Label>
                  <p className="font-medium">{requisition.partyName}</p>
                </div>
                <div className="col-span-2">
                  <Label>Created At</Label>
                  <p className="font-medium">
                    {formatDateSafe(requisition.createdAt)}
                  </p>
                </div>
              </div>

              <div>
                <Label>Description</Label>
                <p className="text-sm p-2 bg-muted rounded-md min-h-[60px]">
                  {requisition.description || 'No description provided.'}
                </p>
              </div>

              {!!requisition.attachments?.length && (
                <div>
                  <Label>Attachments</Label>
                  <div className="mt-2 space-y-2">
                    {requisition.attachments.map((file, index) => (
                      <div
                        key={index}
                        className="flex items-center justify-between p-2 bg-muted rounded-md"
                      >
                        <div className="flex items-center gap-2 overflow-hidden">
                          <Paperclip className="h-4 w-4 shrink-0" />
                          <span className="text-sm font-medium truncate">
                            {file.name}
                          </span>
                        </div>
                        <div className="flex items-center shrink-0">
                          <Button asChild variant="outline" size="sm" className="mr-2 h-7">
                            <a
                              href={file.url}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <Eye className="mr-2 h-3 w-3" /> View
                            </a>
                          </Button>
                          <Button asChild variant="outline" size="sm" className="h-7">
                            <a href={file.url} download={file.name}>
                              <Download className="mr-2 h-3 w-3" /> Download
                            </a>
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {isActionable && (
                <div className="space-y-4 pt-4 border-t">
                  {currentStep?.upload === 'Required' && (
                    <div>
                      <Label
                        htmlFor="file-upload"
                        className="font-semibold text-destructive"
                      >
                        Upload Required Document
                      </Label>
                      <Input
                        id="file-upload"
                        type="file"
                        className="mt-1"
                        onChange={(e) => setFile(e.target.files?.[0] || null)}
                      />
                    </div>
                  )}

                  <div>
                    <Label>Action Comment</Label>
                    <Textarea
                      placeholder="Add a comment for your action (optional)"
                      value={actionComment}
                      onChange={(e) => setActionComment(e.target.value)}
                    />
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <TooltipProvider>
                      {(currentStep?.actions || []).map(
                        (action: string | ActionConfig) => {
                          const actionName =
                            typeof action === 'string' ? action : action.name;
                          const isCreateExpenseAction =
                            actionName === 'Create Expense Request';
                          const isDisabled =
                            isLoading ||
                            (isCreateExpenseAction &&
                              !!requisition.expenseRequestNo);

                          return (
                            <Tooltip key={actionName}>
                              <TooltipTrigger asChild>
                                <div className="inline-block">
                                  <Button
                                    onClick={() => handleAction(action)}
                                    disabled={isDisabled}
                                  >
                                    {isLoading && (
                                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    )}
                                    {actionName}
                                  </Button>
                                </div>
                              </TooltipTrigger>
                              {isDisabled && isCreateExpenseAction && (
                                <TooltipContent>
                                  <p>
                                    An expense request has already been created for
                                    this item.
                                  </p>
                                </TooltipContent>
                              )}
                            </Tooltip>
                          );
                        }
                      )}
                    </TooltipProvider>
                  </div>
                </div>
              )}

              <Collapsible
                open={isWorkflowOpen}
                onOpenChange={setIsWorkflowOpen}
              >
                <CollapsibleTrigger asChild>
                  <Button
                    variant="ghost"
                    className="w-full justify-between px-2"
                  >
                    Workflow Status
                    <ChevronDown className="h-4 w-4 transition-transform data-[state=open]:rotate-180" />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="mt-2 border rounded-md">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Stage</TableHead>
                          <TableHead>User</TableHead>
                          <TableHead>Deadline</TableHead>
                          <TableHead>Completed</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {enrichedSteps.length > 0 ? (
                          enrichedSteps.map((step, index) => (
                            <TableRow key={index}>
                              <TableCell className="font-medium">
                                {stepDisplay(step)}
                              </TableCell>
                              <TableCell>{step.assignedUserName}</TableCell>
                              <TableCell>{step.deadline}</TableCell>
                              <TableCell>{step.completionDate}</TableCell>
                              <TableCell>
                                <Badge
                                  variant={
                                    step.status === 'Completed'
                                      ? 'default'
                                      : step.status === 'Current'
                                      ? 'secondary'
                                      : 'outline'
                                  }
                                  className={
                                    step.status === 'Completed'
                                      ? 'bg-green-500 hover:bg-green-600'
                                      : ''
                                  }
                                >
                                  {step.status}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          ))
                        ) : (
                          <TableRow>
                            <TableCell
                              colSpan={5}
                              className="text-center h-24"
                            >
                              {isLoading
                                ? 'Loading workflow...'
                                : 'No workflow data.'}
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </div>
          </ScrollArea>

          <DialogFooter className="mt-4">
             <Button
                variant="outline"
                onClick={handlePrint}
            >
                <Printer className="mr-2 h-4 w-4" /> Print
            </Button>
            <DialogClose asChild>
              <Button variant="outline">Close</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {expenseToCreate && (
        <Dialog
          open={isConfirmExpenseOpen}
          onOpenChange={setIsConfirmExpenseOpen}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Confirm Expense Creation</DialogTitle>
              <DialogDescription>
                Review and edit the details below before creating the expense
                request.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>Request No.</Label>
                  <Input value={expenseToCreate.requestNo || ''} disabled />
                </div>
                <div className="space-y-1">
                  <Label>Project</Label>
                  <Input
                    value={
                      projects.find((p) => p.id === expenseToCreate.projectId)
                        ?.projectName || ''
                    }
                    disabled
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label>Party Name</Label>
                <Input
                  value={expenseToCreate.partyName || ''}
                  onChange={(e) =>
                    setExpenseToCreate({
                      ...expenseToCreate,
                      partyName: e.target.value,
                    })
                  }
                />
              </div>
              <div className="space-y-1">
                <Label>Amount</Label>
                <Input
                  type="text"
                  value={
                    expenseToCreate.amount
                      ? formatAsCurrency(expenseToCreate.amount)
                      : ''
                  }
                  onChange={(e) => {
                    const numericValue = Number(
                      e.target.value.replace(/[^0-9.-]+/g, '')
                    );
                    setExpenseToCreate({ ...expenseToCreate, amount: numericValue });
                  }}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>Head of A/c</Label>
                  <Select
                    value={expenseToCreate.headOfAccount || ''}
                    onValueChange={(value) =>
                      setExpenseToCreate({
                        ...expenseToCreate,
                        headOfAccount: value,
                      })
                    }
                    disabled
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {accountHeads.map((h) => (
                        <SelectItem key={h.id} value={h.name}>
                          {h.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Sub-Head of A/c</Label>
                  <Select
                    value={expenseToCreate.subHeadOfAccount || ''}
                    onValueChange={handleSubHeadChange}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select Sub-Head" />
                    </SelectTrigger>
                    <SelectContent>
                      {subAccountHeads.map((s) => (
                        <SelectItem key={s.id} value={s.name}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1">
                <Label>Description:</Label>
                <Textarea
                  value={expenseToCreate.description || ''}
                  onChange={(e) =>
                    setExpenseToCreate({
                      ...expenseToCreate,
                      description: e.target.value,
                    })
                  }
                />
              </div>
               <div className="space-y-1">
                  <Label>Remarks:</Label>
                  <Textarea value={expenseToCreate.remarks || ''} onChange={(e) => setExpenseToCreate({...expenseToCreate, remarks: e.target.value})} />
              </div>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">Cancel</Button>
              </DialogClose>
              <Button
                onClick={handleConfirmCreateExpense}
                disabled={isCreatingExpense}
              >
                {isCreatingExpense && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Confirm & Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
