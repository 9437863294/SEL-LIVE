
'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { Timeline } from '@/components/ui/timeline';
import { Badge } from '@/components/ui/badge';
import type { Requisition, Project, Department, WorkflowStep, ActionLog } from '@/lib/types';
import { db } from '@/lib/firebase';
import { doc, getDoc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from './auth/AuthProvider';
import { getAssigneeForStep, calculateDeadline } from '@/lib/workflow-utils';
import { Loader2 } from 'lucide-react';
import { format } from 'date-fns';

interface ViewRequisitionDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  requisition: Requisition | null;
  projects: Project[];
  departments: Department[];
  onRequisitionUpdate: () => void;
}

export default function ViewRequisitionDialog({ isOpen, onOpenChange, requisition, projects, departments, onRequisitionUpdate }: ViewRequisitionDialogProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [workflow, setWorkflow] = useState<WorkflowStep[] | null>(null);
  const [currentStep, setCurrentStep] = useState<WorkflowStep | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [actionComment, setActionComment] = useState('');

  useEffect(() => {
    const fetchWorkflow = async () => {
      if (!requisition) return;
      try {
        const workflowRef = doc(db, 'workflows', 'site-fund-requisition');
        const workflowSnap = await getDoc(workflowRef);
        if (workflowSnap.exists()) {
          const steps = workflowSnap.data().steps as WorkflowStep[];
          setWorkflow(steps);
          const step = steps.find(s => s.id === requisition.currentStepId) || null;
          setCurrentStep(step);
        }
      } catch (error) {
        console.error("Error fetching workflow:", error);
        toast({ title: 'Error', description: 'Could not load workflow configuration.', variant: 'destructive' });
      }
    };
    fetchWorkflow();
  }, [requisition, toast]);
  
  const handleAction = async (action: string) => {
    if (!user || !requisition || !workflow || !currentStep) return;
    
    setIsLoading(true);
    
    try {
        await runTransaction(db, async (transaction) => {
            const requisitionRef = doc(db, 'requisitions', requisition.id);
            const reqDoc = await transaction.get(requisitionRef);
            if (!reqDoc.exists()) throw new Error("Requisition document not found!");

            const currentRequisitionData = reqDoc.data() as Requisition;
            
            // Log the current action
            const newActionLog: ActionLog = {
                action,
                comment: actionComment,
                userId: user.id,
                userName: user.name,
                timestamp: serverTimestamp(),
                stepName: currentStep.name,
            };
            const updatedHistory = [...(currentRequisitionData.history || []), newActionLog];

            let nextStep: WorkflowStep | undefined;
            let newStatus = currentRequisitionData.status;
            let newStage = currentRequisitionData.stage;
            let newAssignedToId: string | null = null;
            let newDeadline: Date | null = null;

            if (action === 'Approve' || action === 'Complete' || action === 'Verified') {
                const currentStepIndex = workflow.findIndex(s => s.id === currentStep.id);
                nextStep = workflow[currentStepIndex + 1];

                if (nextStep) {
                    newStage = nextStep.name;
                    newStatus = 'In Progress';
                    newAssignedToId = await getAssigneeForStep(nextStep, currentRequisitionData);
                    if (!newAssignedToId) throw new Error(`Could not determine assignee for step: ${nextStep.name}`);
                    newDeadline = await calculateDeadline(new Date(), nextStep.tat);
                } else {
                    newStage = 'Completed';
                    newStatus = 'Completed';
                    newAssignedToId = null;
                    newDeadline = null;
                }
            } else if (action === 'Reject') {
                 newStage = 'Rejected';
                 newStatus = 'Rejected';
                 newAssignedToId = null;
                 newDeadline = null;
            } else {
                // For other actions like 'Edit', 'Revise', etc., keep current assignment
                newAssignedToId = currentRequisitionData.assignedToId || null;
                newDeadline = currentRequisitionData.deadline ? currentRequisitionData.deadline.toDate() : null;
            }

            transaction.update(requisitionRef, {
                status: newStatus,
                stage: newStage,
                currentStepId: nextStep?.id || null,
                assignedToId: newAssignedToId,
                deadline: newDeadline,
                history: updatedHistory,
            });
        });
        
        toast({ title: 'Success', description: `Requisition has been successfully ${action.toLowerCase()}ed.` });
        onRequisitionUpdate();
        onOpenChange(false);
        setActionComment('');

    } catch (error: any) {
        console.error("Error processing action:", error);
        toast({ title: 'Action Failed', description: error.message, variant: 'destructive' });
    } finally {
        setIsLoading(false);
    }
  };


  if (!requisition) return null;

  const projectName = projects.find(p => p.id === requisition.projectId)?.projectName || 'N/A';
  const departmentName = departments.find(d => d.id === requisition.departmentId)?.name || 'N/A';

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Requisition Details: {requisition.requisitionId}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-6 max-h-[70vh] overflow-y-auto p-4">
            <div className="md:col-span-3 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                    <div><Label>Project</Label><p className="font-medium">{projectName}</p></div>
                    <div><Label>Department</Label><p className="font-medium">{departmentName}</p></div>
                    <div><Label>Amount</Label><p className="font-medium">₹ {requisition.amount.toLocaleString()}</p></div>
                    <div><Label>Date</Label><p className="font-medium">{requisition.date}</p></div>
                </div>
                <div>
                    <Label>Description</Label>
                    <p className="text-sm p-2 bg-muted rounded-md min-h-[60px]">{requisition.description || 'No description provided.'}</p>
                </div>
                <Separator />
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
                        <Button key={action} onClick={() => handleAction(action)} disabled={isLoading}>
                            {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                            {action}
                        </Button>
                    ))}
                </div>
            </div>
            <div className="md:col-span-2">
                <h3 className="font-semibold mb-2">History</h3>
                <Timeline>
                  {requisition.history?.map((log, index) => (
                      <div key={index} className="flex items-start gap-4">
                          <div className="flex flex-col items-center">
                              <div className="w-3 h-3 bg-primary rounded-full" />
                              {index < requisition.history.length - 1 && <div className="w-px h-full bg-border grow" />}
                          </div>
                          <div className="pb-4">
                              <p className="font-medium">{log.userName} <Badge variant="secondary">{log.action}</Badge></p>
                              <p className="text-xs text-muted-foreground">{log.timestamp ? format(log.timestamp.toDate(), 'dd MMM, yy HH:mm') : ''}</p>
                              <p className="text-sm mt-1">{log.comment}</p>
                          </div>
                      </div>
                  ))}
                  {!requisition.history && (
                    <p className="text-sm text-muted-foreground">No history yet.</p>
                  )}
                </Timeline>
            </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Close</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

