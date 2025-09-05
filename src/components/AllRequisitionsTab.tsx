
'use client';

import { useState } from 'react';
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
  DialogTrigger,
  DialogFooter,
  DialogClose,
  DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { MoreHorizontal } from 'lucide-react';
import { Textarea } from './ui/textarea';

const requisitions = [
  {
    id: 'SEL\\SFR\\2025-26\\0017',
    date: '01/09/2025',
    time: '4:19 PM',
    deadlineDate: '01/09/2025',
    deadlineTime: '6:19 PM',
    project: 'Head Office',
    department: 'HR',
    raisedBy: 'ashish',
    description: 'kjfhehf',
    amount: '₹4,654.00',
    stage: 'Request Receiving',
    status: 'Pending',
    attachments: 0,
  },
  {
    id: 'SEL\\SFR\\2025-26\\0016',
    date: '30/08/2025',
    time: '11:14 PM',
    deadlineDate: 'N/A',
    deadlineTime: '',
    project: 'TPSODL',
    department: 'HR',
    raisedBy: 'Ashish',
    description: 'gdfgd',
    amount: '₹4,64,646.00',
    stage: 'Completed',
    status: 'Completed',
    attachments: 0,
  },
  {
    id: 'SEL\\SFR\\2025-26\\0015',
    date: '30/08/2025',
    time: '9:57 PM',
    deadlineDate: '01/09/2025',
    deadlineTime: '11:30 AM',
    project: 'Head Office',
    department: 'HR',
    raisedBy: 'Ashish',
    description: 'gfeagsdg',
    amount: '₹10,00,000.00',
    stage: 'Request Receiving',
    status: 'Pending',
    attachments: 0,
  },
];

export default function AllRequisitionsTab() {
  const [isNewRequestOpen, setIsNewRequestOpen] = useState(false);

  return (
    <div className="w-full">
        <div className="flex justify-end items-center gap-4 mb-4">
             <Select>
                <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="All Statuses" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="rejected">Rejected</SelectItem>
                </SelectContent>
            </Select>
            <Dialog open={isNewRequestOpen} onOpenChange={setIsNewRequestOpen}>
                <DialogTrigger asChild>
                    <Button>New Request</Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-4xl">
                    <DialogHeader>
                        <DialogTitle>New Site Fund Requisition</DialogTitle>
                        <DialogDescription>
                            Fill out the form to create a new fund request.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 py-4">
                        <div className="space-y-2">
                            <Label htmlFor="project">Project</Label>
                            <Select>
                                <SelectTrigger id="project">
                                    <SelectValue placeholder="Select Project" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="head-office">Head Office</SelectItem>
                                    <SelectItem value="tpsodl">TPSODL</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                         <div className="space-y-2">
                            <Label htmlFor="department">Department</Label>
                             <Select>
                                <SelectTrigger id="department">
                                    <SelectValue placeholder="Select Department" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="hr">HR</SelectItem>
                                    <SelectItem value="it">IT</SelectItem>
                                    <SelectItem value="finance">Finance</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="amount">Amount</Label>
                            <Input id="amount" type="number" placeholder="Enter Amount" />
                        </div>
                         <div className="md:col-span-2 lg:col-span-3 space-y-2">
                            <Label htmlFor="description">Description</Label>
                            <Textarea id="description" placeholder="Enter a brief description" />
                        </div>
                         <div className="space-y-2">
                            <Label htmlFor="deadline">Deadline</Label>
                            <Input id="deadline" type="datetime-local" />
                        </div>
                        <div className="space-y-2">
                           <Label htmlFor="attachments">Attachments</Label>
                           <Input id="attachments" type="file" multiple />
                        </div>
                    </div>
                    <DialogFooter>
                        <DialogClose asChild>
                            <Button variant="outline">Cancel</Button>
                        </DialogClose>
                        <Button onClick={() => setIsNewRequestOpen(false)}>Create Request</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead>Request ID</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Deadline</TableHead>
              <TableHead>Project</TableHead>
              <TableHead>Department</TableHead>
              <TableHead>Raised By</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Stage</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Attachments</TableHead>
              <TableHead className="text-center">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {requisitions.map((req) => (
              <TableRow key={req.id}>
                <TableCell className="font-medium">{req.id}</TableCell>
                <TableCell>
                  <div>{req.date}</div>
                  <div className="text-xs text-muted-foreground">{req.time}</div>
                </TableCell>
                <TableCell>
                  <div>{req.deadlineDate}</div>
                   {req.deadlineTime && <div className="text-xs text-muted-foreground">{req.deadlineTime}</div>}
                </TableCell>
                <TableCell>{req.project}</TableCell>
                <TableCell>{req.department}</TableCell>
                <TableCell>{req.raisedBy}</TableCell>
                <TableCell>{req.description}</TableCell>
                <TableCell>{req.amount}</TableCell>
                <TableCell>{req.stage}</TableCell>
                <TableCell>{req.status}</TableCell>
                <TableCell>{req.attachments}</TableCell>
                <TableCell className="text-center">
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreHorizontal className="h-4 w-4" />
                    </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
