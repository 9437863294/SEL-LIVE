
'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus, Users, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, addDoc, doc, updateDoc, deleteDoc } from 'firebase/firestore';
import type { Employee, Department } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

const initialNewEmployeeState = {
  employeeId: '',
  name: '',
  email: '',
  phone: '',
  department: '',
  designation: '',
  status: 'Active' as 'Active' | 'Inactive',
};

export default function ManageEmployeePage() {
  const { toast } = useToast();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);

  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  
  const [filters, setFilters] = useState({
      employeeId: '',
      name: '',
      department: 'all',
      status: 'all',
  });

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [employeesSnap, deptsSnap] = await Promise.all([
        getDocs(collection(db, 'employees')),
        getDocs(collection(db, 'departments')),
      ]);

      const employeesData: Employee[] = employeesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Employee));
      setEmployees(employeesData);

      const deptsData: Department[] = deptsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Department));
      setDepartments(deptsData);
      
    } catch (error) {
      console.error("Error fetching data: ", error);
      toast({
        title: 'Error',
        description: 'Failed to fetch employees or departments.',
        variant: 'destructive',
      });
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleFilterChange = (field: keyof typeof filters, value: string) => {
    setFilters(prev => ({ ...prev, [field]: value }));
  };
  
  const filteredEmployees = useMemo(() => {
    return employees.filter(emp => {
      const departmentFilter = filters.department === 'unassigned' ? !emp.department : emp.department === filters.department;
      return (
        (filters.employeeId === '' || emp.employeeId.toLowerCase().includes(filters.employeeId.toLowerCase())) &&
        (filters.name === '' || emp.name.toLowerCase().includes(filters.name.toLowerCase())) &&
        (filters.department === 'all' || departmentFilter) &&
        (filters.status === 'all' || emp.status === filters.status)
      );
    });
  }, [employees, filters]);
  
  const openEditDialog = (employee: Employee) => {
    setEditingEmployee(employee);
    setIsEditDialogOpen(true);
  };
  
  const handleUpdateEmployee = async () => {
    if (!editingEmployee) return;
  
    try {
      const employeeRef = doc(db, 'employees', editingEmployee.id);
      const { id, ...dataToUpdate } = editingEmployee;
      await updateDoc(employeeRef, dataToUpdate);
      toast({
        title: 'Success',
        description: 'Employee updated successfully.',
      });
      setIsEditDialogOpen(false);
      setEditingEmployee(null);
      fetchData();
    } catch (error) {
      console.error('Error updating employee: ', error);
      toast({
        title: 'Error',
        description: 'Failed to update employee.',
        variant: 'destructive',
      });
    }
  };


  return (
    <div className="w-full max-w-7xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/settings/employee">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-6 w-6" />
            </Button>
          </Link>
          <h1 className="text-2xl font-bold">Manage Employee</h1>
        </div>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
                <div className="inline-block">
                    <Button disabled>
                        <Plus className="mr-2 h-4 w-4" />
                        Add Employee
                    </Button>
                </div>
            </TooltipTrigger>
            <TooltipContent>
                <p>Employee data is synced from GreytHR.</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

       <Card className="mb-6">
        <CardContent className="p-4 flex flex-wrap items-center gap-4">
            <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search Employee ID..." className="pl-8 w-full sm:w-48" value={filters.employeeId} onChange={e => handleFilterChange('employeeId', e.target.value)} />
            </div>
            <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search Name..." className="pl-8 w-full sm:w-48" value={filters.name} onChange={e => handleFilterChange('name', e.target.value)} />
            </div>
            <Select value={filters.department} onValueChange={value => handleFilterChange('department', value)}>
                <SelectTrigger className="w-full sm:w-48">
                    <SelectValue placeholder="All Departments" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="all">All Departments</SelectItem>
                    {departments.map(dept => <SelectItem key={dept.id} value={dept.name}>{dept.name}</SelectItem>)}
                    <SelectItem value="unassigned">Unassigned</SelectItem>
                </SelectContent>
            </Select>
            <Select value={filters.status} onValueChange={value => handleFilterChange('status', value)}>
                <SelectTrigger className="w-full sm:w-48">
                    <SelectValue placeholder="All Statuses" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="Active">Active</SelectItem>
                    <SelectItem value="Inactive">Inactive</SelectItem>
                </SelectContent>
            </Select>
        </CardContent>
       </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee ID</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Designation</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 10 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-48" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-28" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                    <TableCell className="text-right">
                       <Skeleton className="h-8 w-16 inline-block" />
                    </TableCell>
                  </TableRow>
                ))
              ) : filteredEmployees.length > 0 ? (
                filteredEmployees.map((emp) => (
                  <TableRow key={emp.id}>
                    <TableCell className="font-medium">{emp.employeeId}</TableCell>
                    <TableCell>{emp.name}</TableCell>
                    <TableCell>{emp.email}</TableCell>
                    <TableCell>{emp.phone}</TableCell>
                    <TableCell>{emp.department || 'N/A'}</TableCell>
                    <TableCell>{emp.designation || 'N/A'}</TableCell>
                    <TableCell>{emp.status}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" onClick={() => openEditDialog(emp)}>Edit</Button>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={8} className="text-center h-24">
                    No employees found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit Employee</DialogTitle>
            <DialogDescription>
              Update the details of the employee.
            </DialogDescription>
          </DialogHeader>
          {editingEmployee && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
                 <div className="space-y-2">
                    <Label htmlFor="editEmployeeId">Employee ID</Label>
                    <Input id="editEmployeeId" value={editingEmployee.employeeId} onChange={(e) => setEditingEmployee({...editingEmployee, employeeId: e.target.value})} />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="editName">Name</Label>
                    <Input id="editName" value={editingEmployee.name} onChange={(e) => setEditingEmployee({...editingEmployee, name: e.target.value})} />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="editEmail">Email</Label>
                    <Input id="editEmail" type="email" value={editingEmployee.email} onChange={(e) => setEditingEmployee({...editingEmployee, email: e.target.value})} />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="editPhone">Phone Number</Label>
                    <Input id="editPhone" value={editingEmployee.phone} onChange={(e) => setEditingEmployee({...editingEmployee, phone: e.target.value})} />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="editDepartment">Department</Label>
                    <Select value={editingEmployee.department} onValueChange={(value) => setEditingEmployee({...editingEmployee, department: value})}>
                        <SelectTrigger id="editDepartment"><SelectValue placeholder="Select Department" /></SelectTrigger>
                        <SelectContent>
                            {departments.map(dept => (
                              <SelectItem key={dept.id} value={dept.name}>{dept.name}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <div className="space-y-2">
                    <Label htmlFor="editDesignation">Designation</Label>
                    <Input id="editDesignation" value={editingEmployee.designation} onChange={(e) => setEditingEmployee({...editingEmployee, designation: e.target.value})} />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="editStatus">Status</Label>
                    <Select value={editingEmployee.status} onValueChange={(value: 'Active' | 'Inactive') => setEditingEmployee({...editingEmployee, status: value})}>
                        <SelectTrigger id="editStatus"><SelectValue/></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="Active">Active</SelectItem>
                            <SelectItem value="Inactive">Inactive</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </div>
          )}
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
            <Button onClick={handleUpdateEmployee}>Update Employee</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
