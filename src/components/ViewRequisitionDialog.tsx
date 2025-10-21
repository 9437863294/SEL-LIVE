
'use client';

import { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import type { Requisition, Project, Department, WorkflowStep, ActionLog, User, ActionConfig, AccountHead, SubAccountHead } from '@/lib/types';
import { db } from '@/lib/firebase';
import { doc, getDoc, runTransaction, Timestamp, arrayUnion, collection, getDocs, updateDoc } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from './auth/AuthProvider';
import { getAssigneeForStep, calculateDeadline } from '@/lib/workflow-utils';
import { Loader2, ChevronDown, Paperclip, Download, Eye } from 'lucide-react';
import { format } from 'date-fns';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { ScrollArea } from './ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';
import Link from 'next/link';
import { createExpenseRequest } from '@/ai';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Badge } from './ui/badge';

interface ViewRequisitionDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  requisition: Requisition | null;
  projects: Project[];
  departments: Department[];
  onRequisitionUpdate: () => void;
}

interface EnrichedStep extends WorkflowStep {
    assignedUserName?: string;
    completionDate?: string;
    deadline?: string;
    status: 'Pending' | 'Completed' | 'Current';
}

export default function ViewRequisitionDialog({ isOpen, onOpenChange, requisition, projects, departments, onRequisitionUpdate }: ViewRequisitionDialogProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [workflow, setWorkflow] = useState<WorkflowStep[] | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [enrichedSteps, setEnrichedSteps] = useState<EnrichedStep[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [actionComment, setActionComment] = useState('');
  const [isWorkflowOpen, setIsWorkflowOpen] = useState(false);
  
  const [isConfirmExpenseOpen, setIsConfirmExpenseOpen] = useState(false);
  const [expenseToCreate, setExpenseToCreate] = useState<any>(null);
  const [isCreatingExpense, setIsCreatingExpense] = useState(false);
  const [accountHeads, setAccountHeads] = useState<AccountHead[]>([]);
  const [subAccountHeads, setSubAccountHeads] = useState<SubAccountHead[]>([]);

  const currentStep = useMemo(() => {
    if (!requisition || !workflow) return null;
    return workflow.find(s => s.id === requisition.currentStepId) || null;
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
          const steps = workflowSnap.data().steps as WorkflowStep[];
          setWorkflow(steps);
        } else {
           toast({ title: 'Error', description: 'Workflow configuration not found.', variant: 'destructive' });
        }
        
        const usersData = usersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as User));
        setUsers(usersData);
        setAccountHeads(headsSnap.docs.map(d => ({id: d.id, ...d.data()} as AccountHead)));
        setSubAccountHeads(subHeadsSnap.docs.map(d => ({id: d.id, ...d.data()} as SubAccountHead)));

      } catch (error) {
        console.error("Error fetching workflow/users:", error);
        toast({ title: 'Error', description: 'Could not load workflow or user data.', variant: 'destructive' });
      } finally {
        setIsLoading(false);
      }
    };
    
    if (isOpen && requisition) {
        fetchWorkflowAndUsers();
    } else {
        setWorkflow(null);
        setActionComment('');
        setEnrichedSteps([]);
        setIsWorkflowOpen(false);
        setExpenseToCreate(null);
    }
  }, [requisition, isOpen, toast]);

   useEffect(() => {
    if (requisition && workflow && users.length > 0) {
      
      const getStepAssigneeName = (step: WorkflowStep): string => {
        if (step.assignmentType === 'User-based' && Array.isArray(step.assignedTo) && step.assignedTo.length > 0) {
            return users.find(u => u.id === step.assignedTo[0])?.name || 'N/A';
        }
        // Simplified for brevity, add other assignment types if needed
        return 'N/A';
      };

      const history = requisition.history || [];
      const currentStepIndex = workflow.findIndex(s => s.id === requisition.currentStepId);
      
      const allStepsWithDetails = workflow.map((wfStep, index) => {
          const historyEntries = history.filter(h => h.stepName === wfStep.name);
          const completionEntry = historyEntries.find(h => ['Complete', 'Approve', 'Verified', 'Update Approved Amount'].includes(h.action));
          
          let status: EnrichedStep['status'] = 'Pending';
          if (wfStep.id === requisition.currentStepId) {
            status = 'Current';
          } else if (completionEntry) {
            status = 'Completed';
          } else if (currentStepIndex > -1 && index < currentStepIndex) {
            // Steps before the current one must be completed.
            status = 'Completed';
          }

          let assignedUserName = 'N/A';
          if (status === 'Current' || status === 'Pending') {
            // Simplified: This logic needs to be robust like getAssigneeForStep
             assignedUserName = getStepAssigneeName(wfStep);
          } else if (completionEntry) {
              assignedUserName = completionEntry.userName;
          } else {
            // Fallback for completed steps without a clear completion action in history
            const lastEntry = historyEntries[historyEntries.length -1];
            if(lastEntry) assignedUserName = lastEntry.userName;
          }

          return {
              ...wfStep,
              assignedUserName,
              completionDate: completionEntry ? format(completionEntry.timestamp.toDate(), 'dd MMM, yy HH:mm') : '-',
              deadline: (status === 'Current' && requisition.deadline) ? format(requisition.deadline.toDate(), 'dd MMM, yy HH:mm') : '-',
              status: status,
          };
      });
      setEnrichedSteps(allStepsWithDetails);
    }
   }, [requisition, workflow, users, isOpen]);
  
  const handleAction = async (action: string | ActionConfig) => {
    if (!user || !requisition || !workflow || !currentStep) return;
    
    const actionName = typeof action === 'string' ? action : action.name;
    
    if (actionName === 'Create Expense Request') {
        const targetDepartmentId = (action as ActionConfig).departmentId;
        if (!targetDepartmentId) {
            toast({ title: "Configuration Error", description: "Department not specified for expense request creation.", variant: "destructive" });
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
        } catch (error) {
            previewRequestNo = 'Error generating ID';
        }

        setExpenseToCreate({
            departmentId: targetDepartmentId,
            projectId: requisition.projectId,
            amount: requisition.amount,
            description: requisition.description,
            headOfAccount: defaultHead,
            subHeadOfAccount: '',
            remarks: `Generated from Site Fund Requisition ${requisition.requisitionId}`,
            partyName: requisition.partyName,
            requestNo: previewRequestNo,
        });
        setIsConfirmExpenseOpen(true);
        return;
    }
    
    setIsLoading(true);
    try {
        const requisitionRef = doc(db, 'requisitions', requisition.id);
        
        const newActionLog: ActionLog = {
            action: actionName,
            comment: actionComment,
            userId: user.id,
            userName: user.name,
            timestamp: Timestamp.now(),
            stepName: currentStep.name,
        };

        await runTransaction(db, async (transaction) => {
            const reqDoc = await transaction.get(requisitionRef);
            if (!reqDoc.exists()) throw new Error("Requisition document not found!");

            const currentRequisitionData = { ...reqDoc.data(), id: reqDoc.id } as Requisition;
            
            const tempReqForAssignment = {
              ...currentRequisitionData,
              date: format(new Date(currentRequisitionData.date), 'yyyy-MM-dd'),
            };

            let nextStep: WorkflowStep | undefined;
            let newStatus: Requisition['status'] = currentRequisitionData.status;
            let newStage = currentRequisitionData.stage;
            let newCurrentStepId: string | null = currentRequisitionData.currentStepId || null;
            let newAssignees: string[] = [];
            let newDeadline: Timestamp | null = null;

            if (actionName === 'Approve' || actionName === 'Complete' || actionName === 'Verified' || actionName === 'Update Approved Amount') {
                const currentStepIndex = workflow.findIndex(s => s.id === currentStep.id);
                nextStep = workflow[currentStepIndex + 1];

                if (nextStep) {
                    newStage = nextStep.name;
                    newStatus = 'In Progress';
                    newCurrentStepId = nextStep.id;
                    newAssignees = await getAssigneeForStep(nextStep, tempReqForAssignment);
                    if (newAssignees.length === 0) throw new Error(`Could not determine assignee for step: ${nextStep.name}`);
                    const deadlineDate = await calculateDeadline(new Date(), nextStep.tat);
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
                newDeadline = currentRequisitionData.deadline;
            }

            const updatedData = {
                status: newStatus,
                stage: newStage,
                currentStepId: newCurrentStepId,
                assignees: newAssignees,
                deadline: newDeadline,
                history: arrayUnion(newActionLog),
            };

            transaction.update(requisitionRef, updatedData);
        });
        
        toast({ title: 'Success', description: `Requisition has been successfully ${actionName.toLowerCase()}ed.` });
        onRequisitionUpdate();
        onOpenChange(false);

    } catch (error: any) {
        console.error("Error processing action:", error);
        toast({ title: 'Action Failed', description: error.message, variant: 'destructive' });
    } finally {
        setIsLoading(false);
    }
  };

  const handleConfirmCreateExpense = async () => {
    if (!expenseToCreate || !requisition || !user || !currentStep) return;
    setIsCreatingExpense(true);
    try {
        const { requestNo, ...dataToSave } = expenseToCreate;

        const result = await createExpenseRequest(dataToSave);
        if (result.success && result.requestNo) {
            const newActionLog: ActionLog = {
                action: 'Create Expense Request',
                comment: `Created Expense Request: ${result.requestNo}`,
                userId: user.id,
                userName: user.name,
                timestamp: Timestamp.now(),
                stepName: currentStep.name,
            };
            const requisitionRef = doc(db, 'requisitions', requisition.id);
            await updateDoc(requisitionRef, {
                history: arrayUnion(newActionLog)
            });

            toast({ title: 'Expense Record Created', description: `Request No: ${result.requestNo}` });
            onRequisitionUpdate();
        } else {
            throw new Error(result.message);
        }
    } catch (error: any) {
        toast({ title: 'Error', description: `Failed to create expense record: ${error.message}`, variant: 'destructive' });
    } finally {
        setIsCreatingExpense(false);
        setIsConfirmExpenseOpen(false);
        setExpenseToCreate(null);
    }
  };
  
  const handleSubHeadChange = (subHeadName: string) => {
    if(!expenseToCreate) return;
    const selectedSubHead = subAccountHeads.find(sh => sh.name === subHeadName);
    const parentHead = accountHeads.find(h => h.id === selectedSubHead?.headId);
  
    setExpenseToCreate({
      ...expenseToCreate,
      subHeadOfAccount: subHeadName,
      headOfAccount: parentHead ? parentHead.name : '',
    });
  };


  if (!requisition) return null;

  const getProjectName = (id: string) => projects.find(p => p.id === id)?.projectName || 'N/A';
  const getDepartmentName = (id: string) => departments.find(d => d.id === id)?.name || 'N/A';
  
  const isActionAllowed = user && requisition.assignees?.includes(user.id) && requisition.status !== 'Completed' && requisition.status !== 'Rejected';

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
                  <div><Label>Project</Label><p className="font-medium">{getProjectName(requisition.projectId)}</p></div>
                  <div><Label>Department</Label><p className="font-medium">{getDepartmentName(requisition.departmentId)}</p></div>
                  <div><Label>Amount</Label><p className="font-medium">₹ {requisition.amount.toLocaleString()}</p></div>
                  <div><Label>Date</Label><p className="font-medium">{format(new Date(requisition.date), 'dd MMM, yyyy')}</p></div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label>Party Name</Label>
                    <p className="font-medium">{requisition.partyName}</p>
                  </div>
              </div>
              <div>
                  <Label>Description</Label>
                  <p className="text-sm p-2 bg-muted rounded-md min-h-[60px]">{requisition.description || 'No description provided.'}</p>
              </div>

              {requisition.attachments && requisition.attachments.length > 0 && (
                <div>
                  <Label>Attachments</Label>
                  <div className="mt-2 space-y-2">
                    {requisition.attachments.map((file, index) => (
                      <div key={index} className="flex items-center justify-between p-2 bg-muted rounded-md">
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

              {isActionAllowed && (
                  <div className="space-y-4 pt-4 border-t">
                      <div>
                          <Label>Action Comment</Label>
                          <Textarea 
                              placeholder="Add a comment for your action (optional)" 
                              value={actionComment}
                              onChange={(e) => setActionComment(e.target.value)}
                          />
                      </div>
                      <div className="flex flex-wrap gap-2">
                          {currentStep?.actions.map(action => (
                              <Button key={(typeof action === 'string' ? action : action.name)} onClick={() => handleAction(action)} disabled={isLoading}>
                                  {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                  {typeof action === 'string' ? action : action.name}
                              </Button>
                          ))}
                      </div>
                  </div>
              )}

             <Collapsible open={isWorkflowOpen} onOpenChange={setIsWorkflowOpen} className="border-t pt-2">
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
                                      <TableCell className="font-medium">{step.name}</TableCell>
                                      <TableCell>{step.assignedUserName}</TableCell>
                                      <TableCell>{step.deadline}</TableCell>
                                      <TableCell>{step.completionDate}</TableCell>
                                      <TableCell>
                                        <Badge 
                                          variant={
                                            step.status === 'Completed' ? 'default' : 
                                            step.status === 'Current' ? 'secondary' : 'outline'
                                          }
                                          className={step.status === 'Completed' ? 'bg-green-500 hover:bg-green-600' : ''}
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
                  <DialogDescription>Review and edit the details below before creating the expense request.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                        <Label>Request No.</Label>
                        <Input value={expenseToCreate.requestNo} disabled />
                    </div>
                    <div className="space-y-1">
                        <Label>Project</Label>
                        <Input value={getProjectName(expenseToCreate.projectId)} disabled />
                    </div>
                  </div>
                   <div className="space-y-1">
                      <Label>Party Name</Label>
                      <Input value={expenseToCreate.partyName} onChange={(e) => setExpenseToCreate({...expenseToCreate, partyName: e.target.value})} />
                  </div>
                  <div className="space-y-1">
                      <Label>Amount</Label>
                      <Input type="number" value={expenseToCreate.amount} onChange={(e) => setExpenseToCreate({...expenseToCreate, amount: e.target.valueAsNumber || 0})} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                        <Label>Head of A/c</Label>
                         <Select value={expenseToCreate.headOfAccount} onValueChange={(value) => setExpenseToCreate({...expenseToCreate, headOfAccount: value })} disabled>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                             <SelectContent>
                                {accountHeads.map(h => <SelectItem key={h.id} value={h.name}>{h.name}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-1">
                        <Label>Sub-Head of A/c</Label>
                         <Select value={expenseToCreate.subHeadOfAccount} onValueChange={handleSubHeadChange}>
                            <SelectTrigger><SelectValue placeholder="Select Sub-Head"/></SelectTrigger>
                            <SelectContent>{subAccountHeads.map(s => <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>)}</SelectContent>
                        </Select>
                    </div>
                  </div>
                  <div className="space-y-1">
                      <Label>Description:</Label>
                      <Textarea value={expenseToCreate.description} onChange={(e) => setExpenseToCreate({...expenseToCreate, description: e.target.value})} />
                  </div>
              </div>
              <DialogFooter>
                  <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
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
