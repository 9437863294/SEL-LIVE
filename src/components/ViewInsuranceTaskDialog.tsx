
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

interface ViewInsuranceTaskDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  task: InsuranceTask | null;
  workflow: WorkflowStep[] | null;
}

interface EnrichedStep extends WorkflowStep {
    assignedUserName?: string;
    completionDate?: string;
    deadline?: string;
    status: 'Pending' | 'Completed' | 'Current';
}

export default function ViewInsuranceTaskDialog({ isOpen, onOpenChange, task, workflow }: ViewInsuranceTaskDialogProps) {
  const { users } = useAuth();
  
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
        } else if (status === 'Current' && task.assignedTo) {
            assignedUserName = userMap.get(task.assignedTo) || 'N/A';
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
          </div>
        </ScrollArea>
        <DialogFooter className="mt-4 pr-4">
          <DialogClose asChild>
            <Button variant="outline">Close</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
