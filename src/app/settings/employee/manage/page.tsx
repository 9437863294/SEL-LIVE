
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus, Users } from 'lucide-react';
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
  
  const [newEmployee, setNewEmployee] = useState(initialNewEmployeeState);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);

  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);

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

  const handleInputChange = (field: keyof typeof newEmployee, value: string) => {
    setNewEmployee(prev => ({ ...prev, [field]: value }));
  };
  
  const handleSelectChange = (field: keyof typeof newEmployee, value: string) => {
    setNewEmployee(prev => ({ ...prev, [field]: value as any }));
  };
  
  const resetAddDialog = () => {
    setNewEmployee(initialNewEmployeeState);
    setIsAddDialogOpen(false);
  }

  const handleAddEmployee = async () => {
    if (!newEmployee.name.trim() || !newEmployee.email.trim() || !newEmployee.employeeId.trim()) {
      toast({
        title: 'Validation Error',
        description: 'Employee ID, Name, and Email cannot be empty.',
        variant: 'destructive',
      });
      return;
    }
    try {
      await addDoc(collection(db, 'employees'), newEmployee);
      toast({
        title: 'Success',
        description: `Employee "${newEmployee.name}" added.`,
      });
      resetAddDialog();
      fetchData(); 
    } catch (error) {
      console.error("Error adding employee: ", error);
      toast({
        title: 'Error',
        description: 'Failed to add employee.',
        variant: 'destructive',
      });
    }
  };
  
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

  const getDepartmentName = (id: string) => {
    return departments.find(d => d.id === id)?.name || 'N/A';
  }


  return (
    <div className="w-full max-w-6xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/settings/employee">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-6 w-6" />
            </Button>
          </Link>
          <h1 className="text-2xl font-bold">Manage Employee</h1>
        </div>
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Add Employee
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-2xl" onPointerDownOutside={(e) => e.preventDefault()}>
            <DialogHeader>
              <DialogTitle>Add New Employee</DialogTitle>
              <DialogDescription>
                Fill in the details for the new employee.
              </DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
                <div className="space-y-2">
                    <Label htmlFor="employeeId">Employee ID</Label>
                    <Input id="employeeId" placeholder="e.g. SEL-EMP-001" value={newEmployee.employeeId} onChange={(e) => handleInputChange('employeeId', e.target.value)} />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="name">Name</Label>
                    <Input id="name" placeholder="e.g. Jane Smith" value={newEmployee.name} onChange={(e) => handleInputChange('name', e.target.value)} />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input id="email" type="email" placeholder="e.g. jane@example.com" value={newEmployee.email} onChange={(e) => handleInputChange('email', e.target.value)} />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="phone">Phone Number</Label>
                    <Input id="phone" placeholder="e.g. 9876543210" value={newEmployee.phone} onChange={(e) => handleInputChange('phone', e.target.value)} />
                </div>
                 <div className="space-y-2">
                    <Label htmlFor="department">Department</Label>
                    <Select value={newEmployee.department} onValueChange={(value) => handleSelectChange('department', value)}>
                        <SelectTrigger id="department"><SelectValue placeholder="Select a department" /></SelectTrigger>
                        <SelectContent>
                          {departments.map(dept => (
                            <SelectItem key={dept.id} value={dept.id}>{dept.name}</SelectItem>
                          ))}
                        </SelectContent>
                    </Select>
                </div>
                <div className="space-y-2">
                    <Label htmlFor="designation">Designation</Label>
                    <Input id="designation" placeholder="e.g. Project Manager" value={newEmployee.designation} onChange={(e) => handleInputChange('designation', e.target.value)} />
                </div>
                 <div className="space-y-2">
                    <Label htmlFor="status">Status</Label>
                    <Select value={newEmployee.status} onValueChange={(value) => handleSelectChange('status', value)}>
                        <SelectTrigger id="status"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="Active">Active</SelectItem>
                            <SelectItem value="Inactive">Inactive</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline" onClick={resetAddDialog}>Cancel</Button>
              </DialogClose>
              <Button onClick={handleAddEmployee}>Add Employee</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

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
                Array.from({ length: 5 }).map((_, i) => (
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
              ) : employees.length > 0 ? (
                employees.map((emp) => (
                  <TableRow key={emp.id}>
                    <TableCell className="font-medium">{emp.employeeId}</TableCell>
                    <TableCell>{emp.name}</TableCell>
                    <TableCell>{emp.email}</TableCell>
                    <TableCell>{emp.phone}</TableCell>
                    <TableCell>{getDepartmentName(emp.department)}</TableCell>
                    <TableCell>{emp.designation}</TableCell>
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
                        <SelectTrigger id="editDepartment"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            {departments.map(dept => (
                              <SelectItem key={dept.id} value={dept.id}>{dept.name}</SelectItem>
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
