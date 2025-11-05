
'use client';

import React, { Fragment, useRef, useState, useEffect, useMemo, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
  DialogDescription,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { db, storage } from '@/lib/firebase';
import { doc, getDoc, runTransaction, Timestamp, arrayUnion, collection, getDocs, updateDoc, query, where } from 'firebase/firestore';
import type { Requisition, Project, Department, WorkflowStep, ActionLog, Attachment, User, ActionConfig, AccountHead, SubAccountHead, ExpenseRequest } from '@/lib/types';
import { format } from 'date-fns';
import { useAuth } from './auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Loader2, ChevronDown, Paperclip, Download, Eye, FilePlus } from 'lucide-react';
import { Separator } from './ui/separator';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';
import { createExpenseRequest } from '@/ai';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Badge } from './ui/badge';
import { Tooltip, TooltipProvider, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { getAssigneeForStep, calculateDeadline } from '@/lib/workflow-utils';
import { ScrollArea } from './ui/scroll-area';

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

function stepDisplay(step: Partial<WorkflowStep> & { id: string } | any): string {
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
  const { user } = useAuth();
  const { toast } = useToast();
  const [workflow, setWorkflow] = useState<WorkflowStep[] | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [enrichedSteps, setEnrichedSteps] = useState<EnrichedStep[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [actionComment, setActionComment] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [isWorkflowOpen, setIsWorkflowOpen] = useState(false);

  const [isConfirmExpenseOpen, setIsConfirmExpenseOpen] = useState(false);
  const [expenseToCreate, setExpenseToCreate] = useState<any>(null);
  const [isCreatingExpense, setIsCreatingExpense] = useState(false);
  const [accountHeads, setAccountHeads] = useState<AccountHead[]>([]);
  const [subAccountHeads, setSubAccountHeads] = useState<SubAccountHead[]>([]);

  const currentStep = useMemo(() => {
    if (!requisition || !workflow) return null;
    return workflow.find((s) => s.id === requisition.currentStepId) || null;
  }, [requisition, workflow]);

  useEffect(() => {
    const fetchWorkflowAndUsers = async () => {
      if (!requisition) return;
      setIsLoading(true);
      try {
        const [workflowSnap, usersSnap, headsSnap, subHeadsSnap] = await Promise.all([
          getDoc(doc(db, 'workflows', 'site-fund-requisition')),
          getDocs(collection(db, 'users')),
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

        const usersData =
          usersSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as User)) || [];
        setUsers(usersData);

        setAccountHeads(
          headsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as AccountHead)),
        );
        setSubAccountHeads(
          subHeadsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as SubAccountHead)),
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
      const currentStepIndex = workflow.findIndex((s) => s.id === requisition.currentStepId);

      const allStepsWithDetails = workflow.map((wfStep, index) => {
        const wfStepLabel = stepDisplay(wfStep);
        const historyEntries = history.filter((h) => h.stepName === wfStepLabel);
        const completionEntry = historyEntries.find((h) =>
          ['Complete', 'Approve', 'Verified', 'Update Approved Amount', 'Create Expense Request'].includes(
            h.action,
          ),
        );

        let status: EnrichedStep['status'] = 'Pending';
        if (requisition.status === 'Completed' || requisition.status === 'Rejected') {
          if (historyEntries.length > 0 || (index <= currentStepIndex && currentStepIndex !== -1)) {
            status = 'Completed';
          }
        } else if (wfStep.id === requisition.currentStepId) {
          status = 'Current';
        } else if (completionEntry || (currentStepIndex > -1 && index < currentStepIndex)) {
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
          completionDate: completionEntry ? formatDateSafe(completionEntry.timestamp) : '-',
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

    if (actionName === 'Create Expense Request') {
      const targetDepartmentId = typeof action !== 'string' && hasDeptId(action)
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
        (sh) => sh.name?.toLowerCase() === 'unsecured loan',
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
          previewRequestNo = `${configData.prefix || ''}${configData.format || ''}${formattedIndex}${
            configData.suffix || ''
          }`;
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

        const currentRequisitionData = { ...reqDoc.data(), id: reqDoc.id } as Requisition;
        
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

        const currentDate = toDateSafe((currentRequisitionData as any).date) || new Date();
        const tempReqForAssignment = {
          ...currentRequisitionData,
          date: format(currentDate, 'yyyy-MM-dd'),
        };

        let nextStep: WorkflowStep | undefined;
        let newStatus: Requisition['status'] = currentRequisitionData.status;
        let newStage = currentRequisitionData.stage;
        let newCurrentStepId: string | null = currentRequisitionData.currentStepId || null;
        let newAssignees: string[] = [];
        let newDeadline: Timestamp | null = null;

        const isCompletionAction = ['Approve', 'Complete', 'Verified', 'Update Approved Amount', 'Create Expense Request'].includes(actionName);

        if (isCompletionAction) {
          const currentStepIndexTx = (workflow || []).findIndex((s) => s.id === currentStep.id);
          nextStep = currentStepIndexTx >= 0 ? workflow?.[currentStepIndexTx + 1] : undefined;

          if (nextStep) {
            newStage = stepDisplay(nextStep as any);
            newStatus = 'In Progress';
            newCurrentStepId = nextStep.id;

            const assignees = await getAssigneeForStep(nextStep, tempReqForAssignment);
            if (!Array.isArray(assignees) || assignees.length === 0) {
              throw new Error(`Could not determine assignee for step: ${stepDisplay(nextStep as any)}`);
            }
            newAssignees = assignees;

            const deadlineDate = await calculateDeadline(new Date(), (nextStep as any).tat);
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
      toast({ title: 'Action Failed', description: error.message, variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirmCreateExpense = async () => {
    if (!expenseToCreate || !requisition || !user || !workflow || !currentStep) return;
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

        const currentStepIndexTx = (workflow || []).findIndex((s) => s.id === currentStep.id);
        const nextStep = currentStepIndexTx >= 0 ? workflow?.[currentStepIndexTx + 1] : undefined;

        let newStatus: Requisition['status'];
        let newStage: string;
        let newCurrentStepId: string | null;
        let newAssignees: string[] = [];
        let newDeadline: Timestamp | null = null;

        if (nextStep) {
          newStage = stepDisplay(nextStep as any);
          newStatus = 'In Progress';
          newCurrentStepId = nextStep.id;

          const assignees = await getAssigneeForStep(nextStep, { ...requisition, ...dataToSave });
          if (!Array.isArray(assignees) || assignees.length === 0) {
            throw new Error(`No assignee for step: ${stepDisplay(nextStep as any)}`);
          }
          newAssignees = assignees;

          const deadlineDate = await calculateDeadline(new Date(), (nextStep as any).tat);
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
    const selectedSubHead = subAccountHeads.find((sh) => sh.name === subHeadName);
    const parentHead = accountHeads.find((h) => h.id === selectedSubHead?.headId);

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

  const getProjectName = (id: string) =>
    projects.find((p) => p.id === id)?.projectName || 'N/A';
  const getDepartmentName = (id: string) =>
    departments.find((d) => d.id === id)?.name || 'N/A';
    
  const isActionable = user && requisition?.assignees?.includes(user.id) && requisition.status !== 'Completed' && requisition.status !== 'Rejected';

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Requisition Details: {requisition.requisitionId}</DialogTitle>
          </DialogHeader>

          <div className="max-h-[75vh] overflow-y-auto p-1 pr-4">
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <Label>Project</Label>
                  <p className="font-medium">{getProjectName(requisition.projectId)}</p>
                </div>
                <div>
                  <Label>Department</Label>
                  <p className="font-medium">{getDepartmentName(requisition.departmentId)}</p>
                </div>
                <div>
                  <Label>Amount</Label>
                  <p className="font-medium">₹ {requisition.amount.toLocaleString()}</p>
                </div>
                <div>
                  <Label>Date</Label>
                  <p className="font-medium">
                    {formatDateSafe((requisition as any).date, 'dd MMM, yyyy')}
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
                          <span className="text-sm font-medium truncate">{file.name}</span>
                        </div>
                        <div className="flex items-center shrink-0">
                          <Button asChild variant="outline" size="sm" className="mr-2 h-7">
                            <a href={file.url} target="_blank" rel="noopener noreferrer">
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
                  {((currentStep as any)?.upload === 'Required') && (
                    <div>
                      <Label htmlFor="file-upload" className="font-semibold text-destructive">
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
                      {(currentStep as any)?.actions?.map((action: string | ActionConfig) => {
                        const actionName = typeof action === 'string' ? action : action.name;
                        const isCreateExpenseAction = actionName === 'Create Expense Request';
                        const isDisabled =
                          isLoading || (isCreateExpenseAction && !!requisition.expenseRequestNo);

                        return (
                          <Tooltip key={actionName}>
                            <TooltipTrigger asChild>
                              <div className="inline-block">
                                <Button onClick={() => handleAction(action)} disabled={isDisabled}>
                                  {isLoading && (
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                  )}
                                  {actionName}
                                </Button>
                              </div>
                            </TooltipTrigger>
                            {isDisabled && isCreateExpenseAction && (
                              <TooltipContent>
                                <p>An expense request has already been created for this item.</p>
                              </TooltipContent>
                            )}
                          </Tooltip>
                        );
                      })}
                    </TooltipProvider>
                  </div>
                </div>
              )}

              <Collapsible open={isWorkflowOpen} onOpenChange={setIsWorkflowOpen}>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" className="w-full justify-between px-2">
                    Workflow Status
                    <ChevronDown className="h-4 w-4 transition-transform data-[state=open]:rotate-180" />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <ScrollArea className="h-72 mt-2 border rounded-md">
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
                              <TableCell className="font-medium">{stepDisplay(step)}</TableCell>
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
                            <TableCell colSpan={5} className="text-center h-24">
                              {isLoading ? 'Loading workflow...' : 'No workflow data.'}
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </CollapsibleContent>
              </Collapsible>
            </div>
          </div>

          <DialogFooter className="mt-4">
            <DialogClose asChild>
              <Button variant="outline">Close</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
       {expenseToCreate && (
        <Dialog open={isConfirmExpenseOpen} onOpenChange={setIsConfirmExpenseOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Confirm Expense Creation</DialogTitle>
              <DialogDescription>
                Review and edit the details below before creating the expense request.
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
                  <Input value={projects.find(p => p.id === expenseToCreate.projectId)?.projectName || ''} disabled />
                </div>
              </div>

              <div className="space-y-1">
                <Label>Party Name</Label>
                <Input
                  value={expenseToCreate.partyName || ''}
                  onChange={(e) =>
                    setExpenseToCreate({ ...expenseToCreate, partyName: e.target.value })
                  }
                />
              </div>

              <div className="space-y-1">
                <Label>Amount</Label>
                <Input
                  type="text"
                  value={formatAsCurrency(expenseToCreate.amount || 0)}
                  onChange={(e) => {
                    const numericValue = Number(e.target.value.replace(/[^0-9.-]+/g, ''));
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
                      setExpenseToCreate({ ...expenseToCreate, headOfAccount: value })
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
                    setExpenseToCreate({ ...expenseToCreate, description: e.target.value })
                  }
                />
              </div>

              <div className="space-y-1">
                <Label>Remarks:</Label>
                <Textarea
                  value={expenseToCreate.remarks || ''}
                  onChange={(e) =>
                    setExpenseToCreate({ ...expenseToCreate, remarks: e.target.value })
                  }
                />
              </div>
            </div>

            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">Cancel</Button>
              </DialogClose>
              <Button onClick={handleConfirmCreateExpense} disabled={isCreatingExpense}>
                {isCreatingExpense && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Confirm & Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

```
- src/hooks/use-onclick-outside.ts:
```ts

import { useEffect, type RefObject } from "react"

export function useOnClickOutside(
  ref: RefObject<HTMLElement>,
  handler: (e: MouseEvent | TouchEvent) => void
) {
  useEffect(() => {
    const listener = (event: MouseEvent | TouchEvent) => {
      // Do nothing if clicking ref's element or descendent elements
      if (!ref.current || ref.current.contains(event.target as Node)) {
        return
      }

      handler(event)
    }

    document.addEventListener("mousedown", listener)
    document.addEventListener("touchstart", listener)

    return () => {
      document.removeEventListener("mousedown", listener)
      document.removeEventListener("touchstart", listener)
    }
  }, [ref, handler])
}

```
- src/hooks/use-toast.ts:
```ts

"use client"

// Inspired by react-hot-toast library
import * as React from "react"

import type {
  ToastActionElement,
  ToastProps,
} from "@/components/ui/toast"

const TOAST_LIMIT = 3 // Increased limit for chat notifications
const TOAST_REMOVE_DELAY = 1000000

type ToasterToast = ToastProps & {
  id: string
  title?: React.ReactNode
  description?: React.ReactNode
  action?: ToastActionElement
  component?: React.ReactNode
}

const actionTypes = {
  ADD_TOAST: "ADD_TOAST",
  UPDATE_TOAST: "UPDATE_TOAST",
  DISMISS_TOAST: "DISMISS_TOAST",
  REMOVE_TOAST: "REMOVE_TOAST",
} as const

let count = 0

function genId() {
  count = (count + 1) % Number.MAX_SAFE_INTEGER
  return count.toString()
}

type ActionType = typeof actionTypes

type Action =
  | {
      type: ActionType["ADD_TOAST"]
      toast: ToasterToast
    }
  | {
      type: ActionType["UPDATE_TOAST"]
      toast: Partial<ToasterToast>
    }
  | {
      type: ActionType["DISMISS_TOAST"]
      toastId?: ToasterToast["id"]
    }
  | {
      type: ActionType["REMOVE_TOAST"]
      toastId?: ToasterToast["id"]
    }

interface State {
  toasts: ToasterToast[]
}

const toastTimeouts = new Map<string, ReturnType<typeof setTimeout>>()

const addToRemoveQueue = (toastId: string) => {
  if (toastTimeouts.has(toastId)) {
    return
  }

  const timeout = setTimeout(() => {
    toastTimeouts.delete(toastId)
    dispatch({
      type: "REMOVE_TOAST",
      toastId: toastId,
    })
  }, TOAST_REMOVE_DELAY)

  toastTimeouts.set(toastId, timeout)
}

export const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case "ADD_TOAST":
      return {
        ...state,
        toasts: [action.toast, ...state.toasts].slice(0, TOAST_LIMIT),
      }

    case "UPDATE_TOAST":
      return {
        ...state,
        toasts: state.toasts.map((t) =>
          t.id === action.toast.id ? { ...t, ...action.toast } : t
        ),
      }

    case "DISMISS_TOAST": {
      const { toastId } = action

      // ! Side effects ! - This could be extracted into a dismissToast() action,
      // but I'll keep it here for simplicity
      if (toastId) {
        addToRemoveQueue(toastId)
      } else {
        state.toasts.forEach((toast) => {
          addToRemoveQueue(toast.id)
        })
      }

      return {
        ...state,
        toasts: state.toasts.map((t) =>
          t.id === toastId || toastId === undefined
            ? {
                ...t,
                open: false,
              }
            : t
        ),
      }
    }
    case "REMOVE_TOAST":
      if (action.toastId === undefined) {
        return {
          ...state,
          toasts: [],
        }
      }
      return {
        ...state,
        toasts: state.toasts.filter((t) => t.id !== action.toastId),
      }
  }
}

const listeners: Array<(state: State) => void> = []

let memoryState: State = { toasts: [] }

function dispatch(action: Action) {
  memoryState = reducer(memoryState, action)
  listeners.forEach((listener) => {
    listener(memoryState)
  })
}

type Toast = Omit<ToasterToast, "id">

function toast({ ...props }: Toast) {
  const id = genId()

  const update = (props: ToasterToast) =>
    dispatch({
      type: "UPDATE_TOAST",
      toast: { ...props, id },
    })
  const dismiss = () => dispatch({ type: "DISMISS_TOAST", toastId: id })

  dispatch({
    type: "ADD_TOAST",
    toast: {
      ...props,
      id,
      open: true,
      onOpenChange: (open) => {
        if (!open) dismiss()
      },
    },
  })

  return {
    id: id,
    dismiss,
    update,
  }
}

function useToast() {
  const [state, setState] = React.useState<State>(memoryState)

  React.useEffect(() => {
    listeners.push(setState)
    return () => {
      const index = listeners.indexOf(setState)
      if (index > -1) {
        listeners.splice(index, 1)
      }
    }
  }, [state])

  return {
    ...state,
    toast,
    dismiss: (toastId?: string) => dispatch({ type: "DISMISS_TOAST", toastId }),
  }
}

export { useToast, toast }

```
- src/lib/permission-utils.ts:
```ts

import type { Role, Department, Project } from '@/lib/types';
import { permissionModules } from '@/lib/types';


// This function should ideally fetch departments from Firestore if they are dynamic.
// For now, if you have a static or smaller list, you can pass them in.
// If departments are managed in Firestore, this would need to be async.
export const getTotalPermissionsForModule = (moduleName: string, departments: Department[] = [], projects: Project[] = []): number => {
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
        } else if (key === 'Projects' && projects.length > 0) {
           total += perms.length * projects.length;
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
            const fullKeyPrefix = `${moduleName}.${subModuleKey}`;
            
            if (subModuleKey === 'Departments' || subModuleKey === 'Projects') {
                // Special handling for dynamic department/project keys
                Object.keys(permissions).forEach(permissionKey => {
                    if (permissionKey.startsWith(fullKeyPrefix)) {
                        if (Array.isArray(permissions[permissionKey])) {
                            count += permissions[permissionKey].length;
                        }
                    }
                });
            } else {
                 if (permissions[fullKeyPrefix] && Array.isArray(permissions[fullKeyPrefix])) {
                    count += permissions[fullKeyPrefix].length;
                }
            }
        });
    }

    return count;
};

```
- src/lib/utils.ts:
```ts
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

```
- src/lib/workflow-utils.ts:
```ts

'use server';

import { db } from './firebase';
import { doc, getDoc, collection, getDocs } from 'firebase/firestore';
import type { 
    WorkflowStep, 
    Requisition, 
    AmountBasedCondition, 
    WorkingHours, 
    Holiday,
    AssignedTo
} from '@/lib/types';
import { add, setHours, setMinutes, setSeconds, isSameDay, parse, formatISO } from 'date-fns';

// Caching for settings to avoid repeated Firestore reads within a single operation
let workingHoursCache: WorkingHours | null = null;
let holidaysCache: Holiday[] | null = null;

async function getWorkingHours(): Promise<WorkingHours> {
    if (workingHoursCache) return workingHoursCache;
    const docRef = doc(db, 'settings', 'workingHours');
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
        const data = docSnap.data();
        // Handle both the new structure { schedule: {...} } and the old flat structure
        const schedule = data.schedule || data;
        if (schedule && typeof schedule === 'object' && 'Monday' in schedule) {
            workingHoursCache = schedule as WorkingHours;
            return workingHoursCache;
        }
    }
    throw new Error("Working hours not configured or in the wrong format.");
}


async function getHolidays(): Promise<Holiday[]> {
    if (holidaysCache) return holidaysCache;
    const querySnapshot = await getDocs(collection(db, 'holidays'));
    holidaysCache = querySnapshot.docs.map(doc => doc.data() as Holiday);
    return holidaysCache;
}

export async function calculateDeadline(startDate: Date, tatHours: number): Promise<Date> {
    const workingHours = await getWorkingHours();
    const holidays = await getHolidays();
    const holidayDates = holidays.map(h => parse(h.date, 'yyyy-MM-dd', new Date()));

    let remainingHours = tatHours;
    let currentDate = new Date(startDate);

    while (remainingHours > 0) {
        const dayOfWeek = currentDate.toLocaleDateString('en-US', { weekday: 'long' });
        const dayConfig = workingHours[dayOfWeek];

        const isHoliday = holidayDates.some(holidayDate => isSameDay(currentDate, holidayDate));

        if (dayConfig && dayConfig.isWorkDay && !isHoliday) {
            const [startHour, startMinute] = dayConfig.startTime.split(':').map(Number);
            const [endHour, endMinute] = dayConfig.endTime.split(':').map(Number);

            let dayStartTime = setSeconds(setMinutes(setHours(currentDate, startHour), startMinute), 0);
            let dayEndTime = setSeconds(setMinutes(setHours(currentDate, endHour), endMinute), 0);
            
            // If the start date is before working hours, advance it to the start of the working day
            if(currentDate < dayStartTime) {
                currentDate = dayStartTime;
            }

            // If the start date is after working hours, move to the next day and continue
            if (currentDate >= dayEndTime) {
                currentDate = add(currentDate, { days: 1 });
                currentDate = setSeconds(setMinutes(setHours(currentDate, 0), 0), 0);
                continue;
            }

            const remainingWorkHoursToday = (dayEndTime.getTime() - currentDate.getTime()) / (1000 * 60 * 60);

            if (remainingHours <= remainingWorkHoursToday) {
                currentDate = add(currentDate, { hours: remainingHours });
                remainingHours = 0;
            } else {
                remainingHours -= remainingWorkHoursToday;
                currentDate = add(currentDate, { days: 1 });
                currentDate = setSeconds(setMinutes(setHours(currentDate, 0), 0), 0);
            }
        } else {
            // It's a weekend or holiday, move to the next day
            currentDate = add(currentDate, { days: 1 });
            currentDate = setSeconds(setMinutes(setHours(currentDate, 0), 0), 0);
        }
    }
    return currentDate;
}


export async function getAssigneeForStep(step: WorkflowStep, requisition: Omit<Requisition, 'id' | 'createdAt'> | Record<string, any>): Promise<string[]> {
    const assignees: (string | undefined)[] = [];

    switch (step.assignmentType) {
        case 'User-based':
            if (Array.isArray(step.assignedTo)) {
                return step.assignedTo.filter((id): id is string => !!id);
            }
            break;

        case 'Project-based': {
            if (typeof step.assignedTo === 'object' && !Array.isArray(step.assignedTo) && requisition.projectId) {
                const assignmentMap = step.assignedTo as Record<string, { primary: string; alternative?: string }>;
                const assignment = assignmentMap[requisition.projectId];
                if (assignment) {
                    assignees.push(assignment.primary, assignment.alternative);
                }
            }
            break;
        }

        case 'Department-based': {
             if (typeof step.assignedTo === 'object' && !Array.isArray(step.assignedTo) && requisition.departmentId) {
                const assignmentMap = step.assignedTo as Record<string, { primary: string; alternative?: string }>;
                const assignment = assignmentMap[requisition.departmentId];
                 if (assignment) {
                    assignees.push(assignment.primary, assignment.alternative);
                }
            }
            break;
        }
        
        case 'Amount-based': {
            const conditions = step.assignedTo as AmountBasedCondition[];
            const amount = requisition.amount;
            
            for (const condition of conditions) {
                let match = false;
                if (condition.type === 'Below' && amount < condition.amount1) match = true;
                if (condition.type === 'Between' && amount >= condition.amount1 && amount <= (condition.amount2 ?? Infinity)) match = true;
                if (condition.type === 'Above' && amount > condition.amount1) match = true;
                
                if (match) {
                    assignees.push(condition.userId, condition.alternativeUserId);
                    break; // Stop at the first matching condition
                }
            }
            break;
        }
    }
    
    return assignees.filter((id): id is string => !!id);
}

```
```json
[
  {
    "resource": "/home/user/studio/src/components/ViewRequisitionDialog.tsx",
    "owner": "typescript",
    "code": "2322",
    "severity": 8,
    "message": "Type 'Requisition' is not assignable to type 'PendingTask'.\n  Types of property 'taskType' are incompatible.\n    Type 'undefined' is not assignable to type '\"requisition\" | \"jmc\"'.",
    "source": "ts",
    "startLineNumber": 117,
    "startColumn": 34,
    "endLineNumber": 117,
    "endColumn": 53
  },
  {
    "resource": "/home/user/studio/src/components/AllRequisitionsTab.tsx",
    "owner": "typescript",
    "code": "2339",
    "severity": 8,
    "message": "Property 'onRequisitionUpdate' does not exist on type 'IntrinsicAttributes & { isOpen: boolean; onOpenChange: (isOpen: boolean) => void; requisition: Requisition | null; projects: Project[]; departments: Department[]; }'.",
    "source": "ts",
    "startLineNumber": 980,
    "startColumn": 13,
    "endLineNumber": 980,
    "endColumn": 33
  }
]
```