

'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus, Users, Search, Trash2, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription as CardDescriptionShad } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, addDoc, doc, updateDoc, deleteDoc, writeBatch } from 'firebase/firestore';
import type { Employee, Department } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { useAuthorization } from '@/hooks/useAuthorization';
import { ScrollArea } from '@/components/ui/scroll-area';

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
  const { can, isLoading: isAuthLoading } = useAuthorization();

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  const [newEmployee, setNewEmployee] = useState(initialNewEmployeeState);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);

  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<string[]>([]);

  const [filters, setFilters] = useState({
      employeeId: '',
      name: '',
      department: 'all',
      status: 'all',
  });

  const canView = can('View', 'Settings.Employee Management');
  const canAdd = can('Add', 'Settings.Employee Management');
  const canEdit = can('Edit', 'Settings.Employee Management');
  const canDelete = can('Delete', 'Settings.Employee Management');


  useEffect(() => {
    if (isAuthLoading) return;
    if (!canView) {
        setIsLoading(false);
        return;
    };
    fetchData();
  }, [isAuthLoading, canView]);

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

  const handleInputChange = (field: keyof typeof newEmployee, value: string) => {
    setNewEmployee(prev => ({ ...prev, [field]: value }));
  };

  const handleSelectChange = (field: keyof typeof newEmployee, value: string) => {
    setNewEmployee(prev => ({ ...prev, [field]: value as any }));
  };

  const resetAddDialog = () => {
    setNewEmployee(initialNewEmployeeState);
    setIsAddDialogOpen(false);
  };

  const handleAddEmployee = async () => {
    if (!newEmployee.employeeId.trim() || !newEmployee.name.trim()) {
      toast({
        title: 'Validation Error',
        description: 'Employee ID and Name cannot be empty.',
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

  const handleDeleteEmployee = async (id: string) => {
    try {
      await deleteDoc(doc(db, "employees", id));
      toast({
        title: "Success",
        description: "Employee deleted successfully.",
      });
      fetchData(); // Refresh the list
    } catch (error) {
      console.error("Error deleting employee: ", error);
      toast({
        title: "Error",
        description: "Failed to delete employee.",
        variant: "destructive",
      });
    }
  };
  
  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedEmployeeIds(filteredEmployees.map(emp => emp.id));
    } else {
      setSelectedEmployeeIds([]);
    }
  };
  
  const handleSelectEmployee = (id: string, checked: boolean) => {
    if (checked) {
      setSelectedEmployeeIds(prev => [...prev, id]);
    } else {
      setSelectedEmployeeIds(prev => prev.filter(empId => empId !== id));
    }
  };

  const handleDeleteSelected = async () => {
    const batch = writeBatch(db);
    selectedEmployeeIds.forEach(id => {
      batch.delete(doc(db, 'employees', id));
    });

    try {
      await batch.commit();
      toast({
        title: 'Success',
        description: `${selectedEmployeeIds.length} employee(s) deleted successfully.`,
      });
      setSelectedEmployeeIds([]);
      fetchData();
    } catch (error) {
      console.error('Error deleting selected employees: ', error);
      toast({
        title: 'Error',
        description: 'Failed to delete selected employees.',
        variant: 'destructive',
      });
    }
  };
  
  if (isAuthLoading) {
    return (
        <div className="w-full max-w-7xl mx-auto">
            <div className="mb-6 flex items-center justify-between">
                <Skeleton className="h-10 w-48" />
                <Skeleton className="h-10 w-32" />
            </div>
            <Card><CardContent className="p-0"><Skeleton className="h-96 w-full" /></CardContent></Card>
        </div>
    )
  }

  if (!canView) {
    return (
        <div className="w-full max-w-4xl mx-auto">
            <div className="mb-6 flex items-center gap-4">
              <Link href="/settings/employee">
                <Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button>
              </Link>
              <h1 className="text-2xl font-bold">Manage Employee</h1>
            </div>
            <Card>
                <CardHeader>
                    <CardTitle>Access Denied</CardTitle>
                    <CardDescriptionShad>You do not have permission to view this page.</CardDescriptionShad>
                </CardHeader>
                <CardContent className="flex justify-center p-8">
                    <ShieldAlert className="h-16 w-16 text-destructive" />
                </CardContent>
            </Card>
        </div>
    );
  }

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
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogTrigger asChild>
            <Button disabled={!canAdd}>
              <Plus className="mr-2 h-4 w-4" />
              Add Employee
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Add New Employee</DialogTitle>
              <DialogDescription>
                Fill in the details to add a new employee.
              </DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
                <div className="space-y-2">
                    <Label htmlFor="addEmployeeId">Employee ID</Label>
                    <Input id="addEmployeeId" value={newEmployee.employeeId} onChange={(e) => handleInputChange('employeeId', e.target.value)} />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="addName">Name</Label>
                    <Input id="addName" value={newEmployee.name} onChange={(e) => handleInputChange('name', e.target.value)} />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="addEmail">Email</Label>
                    <Input id="addEmail" type="email" value={newEmployee.email} onChange={(e) => handleInputChange('email', e.target.value)} />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="addPhone">Phone Number</Label>
                    <Input id="addPhone" value={newEmployee.phone} onChange={(e) => handleInputChange('phone', e.target.value)} />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="addDepartment">Department</Label>
                    <Select value={newEmployee.department} onValueChange={(value) => handleSelectChange('department', value)}>
                        <SelectTrigger id="addDepartment"><SelectValue placeholder="Select Department" /></SelectTrigger>
                        <SelectContent>
                            {departments.map(dept => (
                              <SelectItem key={dept.id} value={dept.name}>{dept.name}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <div className="space-y-2">
                    <Label htmlFor="addDesignation">Designation</Label>
                    <Input id="addDesignation" value={newEmployee.designation} onChange={(e) => handleInputChange('designation', e.target.value)} />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="addStatus">Status</Label>
                    <Select value={newEmployee.status} onValueChange={(value: 'Active' | 'Inactive') => handleSelectChange('status', value)}>
                        <SelectTrigger id="addStatus"><SelectValue/></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="Active">Active</SelectItem>
                            <SelectItem value="Inactive">Inactive</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </div>
            <DialogFooter>
              <DialogClose asChild><Button variant="outline" onClick={resetAddDialog}>Cancel</Button></DialogClose>
              <Button onClick={handleAddEmployee}>Add Employee</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

       <Card className="mb-6">
        <CardContent className="p-4 flex flex-col sm:flex-row items-center gap-4">
            <div className="w-full sm:w-auto flex flex-col sm:flex-row items-center gap-4">
              <div className="relative w-full sm:w-auto">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input placeholder="Search Employee ID..." className="pl-8 w-full sm:w-48" value={filters.employeeId} onChange={e => handleFilterChange('employeeId', e.target.value)} />
              </div>
              <div className="relative w-full sm:w-auto">
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
            </div>
            {selectedEmployeeIds.length > 0 && (
                <div className="sm:ml-auto mt-4 sm:mt-0">
                    <Button variant="destructive" onClick={handleDeleteSelected} disabled={!canDelete}>
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete ({selectedEmployeeIds.length})
                    </Button>
                </div>
            )}
        </CardContent>
       </Card>

      <Card>
        <CardContent className="p-0">
          <ScrollArea className="h-[calc(100vh-20rem)]">
            <Table>
              <TableHeader className="sticky top-0 bg-background z-10">
                <TableRow>
                  <TableHead className="w-[50px]">
                     <Checkbox
                          checked={selectedEmployeeIds.length > 0 && selectedEmployeeIds.length === filteredEmployees.length}
                          onCheckedChange={(checked) => handleSelectAll(!!checked)}
                          aria-label="Select all"
                          disabled={!canDelete}
                      />
                  </TableHead>
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
                      <TableCell><Skeleton className="h-5 w-5" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-48" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-28" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                      <TableCell className="text-right space-x-2">
                         <Skeleton className="h-8 w-16 inline-block" />
                         <Skeleton className="h-8 w-16 inline-block" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : filteredEmployees.length > 0 ? (
                  filteredEmployees.map((emp) => (
                    <TableRow key={emp.id} data-state={selectedEmployeeIds.includes(emp.id) && "selected"}>
                      <TableCell>
                        <Checkbox
                            checked={selectedEmployeeIds.includes(emp.id)}
                            onCheckedChange={(checked) => handleSelectEmployee(emp.id, !!checked)}
                            aria-label={`Select employee ${emp.name}`}
                            disabled={!canDelete}
                        />
                      </TableCell>
                      <TableCell className="font-medium">{emp.employeeId}</TableCell>
                      <TableCell>{emp.name}</TableCell>
                      <TableCell>{emp.email}</TableCell>
                      <TableCell>{emp.phone}</TableCell>
                      <TableCell>{emp.department || 'N/A'}</TableCell>
                      <TableCell>{emp.designation || 'N/A'}</TableCell>
                      <TableCell>{emp.status}</TableCell>
                      <TableCell className="text-right space-x-2">
                        <Button variant="outline" size="sm" onClick={() => openEditDialog(emp)} disabled={!canEdit}>Edit</Button>
                        <Button variant="destructive" size="sm" onClick={() => handleDeleteEmployee(emp.id)} disabled={!canDelete}><Trash2 className="h-4 w-4" /></Button>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center h-24">
                      No employees found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </ScrollArea>
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

    
