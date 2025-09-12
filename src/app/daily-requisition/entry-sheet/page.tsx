
'use client';

import { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Upload, Plus, ArrowUpDown, MoreHorizontal, Calendar as CalendarIcon, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import type { DailyRequisitionEntry, Project, Department, SerialNumberConfig, ExpenseRequest } from '@/lib/types';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, doc, getDoc } from 'firebase/firestore';
import { format } from 'date-fns';

// Mock Data
const mockData: DailyRequisitionEntry[] = [];

const initialFormState = {
  receptionNo: '',
  depNo: '',
  date: new Date(),
  description: '',
  partyName: '',
  projectId: '',
  departmentId: '',
  grossAmount: '',
  netAmount: '',
};

type SortKey = keyof DailyRequisitionEntry | '';

export default function EntrySheetPage() {
  const { toast } = useToast();
  const [entries, setEntries] = useState<DailyRequisitionEntry[]>(mockData);
  const [sortKey, setSortKey] = useState<SortKey>('createdAt');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [filterText, setFilterText] = useState('');
  const [dateFilter, setDateFilter] = useState<Date>();
  
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [formState, setFormState] = useState(initialFormState);
  const [projects, setProjects] = useState<Project[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [expenseRequests, setExpenseRequests] = useState<ExpenseRequest[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      try {
        const [projectsSnap, deptsSnap, configSnap, expensesSnap] = await Promise.all([
          getDocs(collection(db, 'projects')),
          getDocs(collection(db, 'departments')),
          getDoc(doc(db, 'serialNumberConfigs', 'daily-requisition')),
          getDocs(collection(db, 'expenseRequests'))
        ]);

        setProjects(projectsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project)));
        setDepartments(deptsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Department)));
        setExpenseRequests(expensesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as ExpenseRequest)));


        if (configSnap.exists()) {
          const config = configSnap.data() as SerialNumberConfig;
          const receptionNo = `${config.prefix}${config.format}${config.startingIndex}${config.suffix}`;
          setFormState(prev => ({ ...prev, receptionNo }));
        } else {
          setFormState(prev => ({ ...prev, receptionNo: 'SEL\\REC\\2025-26\\7340' })); // Fallback
        }

      } catch (error) {
        toast({ title: 'Error', description: 'Failed to load necessary data.', variant: 'destructive' });
      }
      setIsLoading(false);
    };
    fetchData();
  }, [toast]);
  
  const unassignedExpenseRequests = useMemo(() => {
    return expenseRequests.filter(req => !req.receptionNo);
  }, [expenseRequests]);


  const handleFormChange = (field: keyof typeof formState, value: any) => {
    setFormState(prev => ({ ...prev, [field]: value }));
  };

  const handleDepNoChange = (value: string) => {
    const selectedRequest = expenseRequests.find(req => req.requestNo === value);
    if (selectedRequest) {
        setFormState(prev => ({
            ...prev,
            depNo: value,
            description: selectedRequest.description || '',
            partyName: selectedRequest.partyName || '',
            projectId: selectedRequest.projectId || '',
            departmentId: selectedRequest.departmentId || '',
            grossAmount: String(selectedRequest.amount || ''),
            netAmount: String(selectedRequest.amount || ''), // Pre-fill net amount as well
        }));
    } else {
        handleFormChange('depNo', value);
    }
  };


  const handleAddEntry = () => {
    // In a real app, this would save to Firestore and update serial number config
    const newEntry: DailyRequisitionEntry = {
      id: String(entries.length + 1),
      createdAt: new Date().toLocaleString(),
      receptionNo: formState.receptionNo,
      depNo: formState.depNo,
      date: format(formState.date, 'MMMM do, yyyy'),
      project: projects.find(p => p.id === formState.projectId)?.projectName || '',
      department: departments.find(d => d.id === formState.departmentId)?.name || '',
      description: formState.description,
      partyName: formState.partyName,
      grossAmount: parseFloat(formState.grossAmount) || 0,
      netAmount: parseFloat(formState.netAmount) || 0,
    };
    setEntries(prev => [newEntry, ...prev]);
    toast({ title: 'Success', description: 'New entry added.' });
    setIsAddDialogOpen(false);
    setFormState(initialFormState); // Reset form
  };

  const sortedEntries = useMemo(() => {
    let sortableEntries = [...entries];
    if (sortKey) {
      sortableEntries.sort((a, b) => {
        const valA = a[sortKey];
        const valB = b[sortKey];
        if (typeof valA === 'number' && typeof valB === 'number') {
          return sortDirection === 'asc' ? valA - valB : valB - a;
        }
        if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
        if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return sortableEntries.filter(entry => 
      Object.values(entry).some(value => 
        String(value).toLowerCase().includes(filterText.toLowerCase())
      ) &&
      (!dateFilter || new Date(entry.date).toDateString() === dateFilter.toDateString())
    );
  }, [entries, sortKey, sortDirection, filterText, dateFilter]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDirection('asc');
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);
  };
  
  const headers: { key: SortKey; label: string }[] = [
    { key: 'createdAt', label: 'Created At' },
    { key: 'receptionNo', label: 'Reception No.' },
    { key: 'date', label: 'Date' },
    { key: 'project', label: 'Project' },
    { key: 'department', label: 'Department' },
    { key: 'partyName', label: 'Party Name' },
    { key: 'description', label: 'Description' },
    { key: 'grossAmount', label: 'Gross Amount' },
    { key: 'netAmount', label: 'Net Amount' },
  ];

  return (
    <>
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link href="/daily-requisition">
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-6 w-6" />
              </Button>
            </Link>
            <h1 className="text-2xl font-bold">Entry Sheet</h1>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline">
              <Upload className="mr-2 h-4 w-4" />
              Import from Excel
            </Button>
            <Button onClick={() => setIsAddDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add New Entry
            </Button>
          </div>
        </div>
        
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Total Entries: {entries.length}</h2>
          <div className="flex items-center gap-2">
              <Popover>
                  <PopoverTrigger asChild>
                  <Button
                      variant={"outline"}
                      className={cn(
                      "w-[240px] justify-start text-left font-normal",
                      !dateFilter && "text-muted-foreground"
                      )}
                  >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {dateFilter ? format(dateFilter, "PPP") : "Filter by date"}
                  </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                      mode="single"
                      selected={dateFilter}
                      onSelect={setDateFilter}
                      initialFocus
                  />
                  </PopoverContent>
              </Popover>
            <Input 
                  placeholder="Filter entries..." 
                  className="w-64"
                  value={filterText}
                  onChange={(e) => setFilterText(e.target.value)}
              />
          </div>
        </div>

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {headers.map(header => (
                      <TableHead key={header.key} onClick={() => handleSort(header.key)}>
                          <div className="flex items-center cursor-pointer">
                              {header.label}
                              {sortKey === header.key && <ArrowUpDown className="ml-2 h-4 w-4" />}
                          </div>
                      </TableHead>
                    ))}
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedEntries.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell>{entry.createdAt}</TableCell>
                      <TableCell>{entry.receptionNo}</TableCell>
                      <TableCell>{entry.date}</TableCell>
                      <TableCell>{entry.project}</TableCell>
                      <TableCell>{entry.department}</TableCell>
                      <TableCell>{entry.partyName}</TableCell>
                      <TableCell>{entry.description}</TableCell>
                      <TableCell>{formatCurrency(entry.grossAmount)}</TableCell>
                      <TableCell>{formatCurrency(entry.netAmount)}</TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem>View</DropdownMenuItem>
                            <DropdownMenuItem>Edit</DropdownMenuItem>
                            <DropdownMenuItem className="text-destructive">Delete</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
        
        <div className="flex items-center justify-between space-x-2 py-4">
          <p className="text-sm text-muted-foreground">Page 1 of 164</p>
          <div className="space-x-2">
              <Button variant="outline" size="sm">Previous</Button>
              <Button variant="outline" size="sm">Next</Button>
          </div>
        </div>
      </div>
      
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Add New Entry</DialogTitle>
            <DialogDescription>Fill in the details for the new requisition entry.</DialogDescription>
          </DialogHeader>
          {isLoading ? <Loader2 className="mx-auto my-12 h-8 w-8 animate-spin" /> : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 py-4">
                  <div className="space-y-2">
                      <Label htmlFor="reception-no">Reception No.</Label>
                      <Input id="reception-no" value={formState.receptionNo} readOnly />
                  </div>
                  <div className="space-y-2">
                      <Label htmlFor="dep-no">DEP No. (Expense Request)</Label>
                      <Select value={formState.depNo} onValueChange={handleDepNoChange}>
                        <SelectTrigger><SelectValue placeholder="Select Expense Request No." /></SelectTrigger>
                        <SelectContent>
                            {unassignedExpenseRequests.length > 0 ? (
                                unassignedExpenseRequests.map(req => <SelectItem key={req.id} value={req.requestNo}>{req.requestNo}</SelectItem>)
                            ) : (
                                <SelectItem value="none" disabled>No available requests</SelectItem>
                            )}
                        </SelectContent>
                      </Select>
                  </div>
                  <div className="space-y-2">
                      <Label htmlFor="date">Reception Date</Label>
                       <Popover>
                          <PopoverTrigger asChild>
                          <Button
                              variant={"outline"}
                              className={cn("w-full justify-start text-left font-normal", !formState.date && "text-muted-foreground")}
                          >
                              <CalendarIcon className="mr-2 h-4 w-4" />
                              {formState.date ? format(formState.date, "PPP") : <span>Pick a date</span>}
                          </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                              mode="single"
                              selected={formState.date}
                              onSelect={(date) => handleFormChange('date', date)}
                              initialFocus
                          />
                          </PopoverContent>
                      </Popover>
                  </div>
                   <div className="md:col-span-3 grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <Label htmlFor="partyName">Party Name</Label>
                        <Input id="partyName" placeholder="Enter party name..." value={formState.partyName} onChange={(e) => handleFormChange('partyName', e.target.value)} />
                      </div>
                      <div className="space-y-2">
                          <Label htmlFor="project">Project Name</Label>
                          <Select value={formState.projectId} onValueChange={(value) => handleFormChange('projectId', value)}>
                              <SelectTrigger><SelectValue placeholder="Select a project" /></SelectTrigger>
                              <SelectContent>
                                  {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.projectName}</SelectItem>)}
                              </SelectContent>
                          </Select>
                      </div>
                  </div>
                  <div className="col-span-1 md:col-span-3 space-y-2">
                      <Label htmlFor="description">Description</Label>
                      <Textarea id="description" placeholder="Enter description..." value={formState.description} onChange={(e) => handleFormChange('description', e.target.value)} />
                  </div>
                  <div className="space-y-2">
                      <Label htmlFor="department">Department</Label>
                      <Select value={formState.departmentId} onValueChange={(value) => handleFormChange('departmentId', value)}>
                          <SelectTrigger><SelectValue placeholder="Select a department" /></SelectTrigger>
                          <SelectContent>
                              {departments.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                          </SelectContent>
                      </Select>
                  </div>
                  <div className="space-y-2">
                      <Label htmlFor="grossAmount">Gross Amount</Label>
                      <Input id="grossAmount" type="number" value={formState.grossAmount} onChange={(e) => handleFormChange('grossAmount', e.target.value)} />
                  </div>
                  <div className="space-y-2">
                      <Label htmlFor="netAmount">Net Amount</Label>
                      <Input id="netAmount" type="number" value={formState.netAmount} onChange={(e) => handleFormChange('netAmount', e.target.value)} />
                  </div>
              </div>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline">Cancel</Button>
                </DialogClose>
                <Button onClick={handleAddEntry}>Add Entry</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
