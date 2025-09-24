

'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import type { InsuranceTask, WorkflowStep, ActionLog } from '@/lib/types';
import { format } from 'date-fns';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { ScrollArea } from './ui/scroll-area';
import { useAuth } from './auth/AuthProvider';
import { Textarea } from './ui/textarea';
import { useState, useMemo } from 'react';
import { Loader2, Upload } from 'lucide-react';
import { Input } from './ui/input';

interface ViewInsuranceTaskDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  task: InsuranceTask | null;
  workflow: WorkflowStep[] | null;
  onAction?: (taskId: string, action: string, comment: string, file?: File) => Promise<void>;
  isActionLoading?: boolean;
}

interface EnrichedStep extends WorkflowStep {
    assignedUserName?: string;
    completionDate?: string;
    deadline?: string;
    status: 'Pending' | 'Completed' | 'Current';
}

export default function ViewInsuranceTaskDialog({ isOpen, onOpenChange, task, workflow, onAction, isActionLoading }: ViewInsuranceTaskDialogProps) {
  const { user, users } = useAuth();
  const [actionComment, setActionComment] = useState('');
  const [file, setFile] = useState<File | null>(null);
  
  const currentStep = useMemo(() => {
    if (!task || !workflow) return null;
    return workflow.find(s => s.id === task.currentStepId) || null;
  }, [task, workflow]);

  const isActionAllowed = user && task?.assignees?.includes(user.id) && task.status !== 'Completed' && task.status !== 'Rejected';

  if (!task || !workflow) return null;

  const getEnrichedSteps = (): EnrichedStep[] => {
    const history: ActionLog[] = (task as any).history || [];
    const currentStepIndex = workflow.findIndex(s => s.id === task.currentStepId);
    const userMap = new Map(users.map(u => [u.id, u.name]));

    const allStepsWithDetails = workflow.map((wfStep, index) => {
        const historyEntries = history.filter(h => h.stepName === wfStep.name);
        const completionEntry = historyEntries.find(h => ['Complete', 'Approve', 'Verified'].includes(h.action));
        
        let status: EnrichedStep['status'] = 'Pending';
        if (wfStep.id === task.currentStepId) {
          status = 'Current';
        } else if (completionEntry) {
          status = 'Completed';
        } else if (currentStepIndex > -1 && index < currentStepIndex) {
          status = 'Completed';
        }

        let assignedUserName = 'N/A';
        const completionUser = completionEntry ? userMap.get(completionEntry.userId) : null;
        if(completionUser) {
            assignedUserName = completionUser;
        } else if (status === 'Current' && task.assignees) {
            assignedUserName = task.assignees.map(id => userMap.get(id) || 'Unknown').join(', ');
        }
        
        return {
            ...wfStep,
            assignedUserName,
            completionDate: completionEntry ? format(completionEntry.timestamp.toDate(), 'dd MMM, yy HH:mm') : '-',
            deadline: (status === 'Current' && task.deadline) ? format(task.deadline.toDate(), 'dd MMM, yy HH:mm') : '-',
            status,
        };
    });
    return allStepsWithDetails;
  }
  
  const enrichedSteps = getEnrichedSteps();
  const isUploadRequired = currentStep?.upload === 'Required';
  
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Task Details: {task.policyNo}</DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-[70vh] p-1 pr-4">
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div><Label>Policy No</Label><p className="font-medium">{task.policyNo}</p></div>
                <div><Label>Insured</Label><p className="font-medium">{task.insuredPerson}</p></div>
                <div><Label>Due Date</Label><p className="font-medium">{format(task.dueDate.toDate(), 'dd MMM, yyyy')}</p></div>
            </div>
            
            <Separator />

            <div>
              <h3 className="text-lg font-semibold mb-2">Workflow Status</h3>
              <div className="border rounded-md">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Stage</TableHead>
                            <TableHead>Assigned User</TableHead>
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
                                    No workflow data to display.
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
              </div>
            </div>
             {isActionAllowed && (
                  <div className="space-y-4 pt-4 border-t">
                      {isUploadRequired && (
                        <div>
                            <Label htmlFor="file-upload" className="font-semibold text-destructive">Upload Required Document</Label>
                            <Input id="file-upload" type="file" className="mt-1" onChange={(e) => setFile(e.target.files?.[0] || null)} />
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
                  </div>
              )}
          </div>
        </ScrollArea>
        <DialogFooter className="mt-4 pr-4">
           {isActionAllowed && (
            <div className="flex flex-wrap gap-2">
                {currentStep?.actions.map(action => (
                    <Button key={action} onClick={() => onAction?.(task.id, action, actionComment, file || undefined)} disabled={isActionLoading || (isUploadRequired && !file)}>
                        {isActionLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        {action}
                    </Button>
                ))}
            </div>
           )}
          <DialogClose asChild>
            <Button variant="outline">Close</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
