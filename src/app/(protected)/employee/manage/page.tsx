

'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
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
import type { Employee, Department, EmployeePosition } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { useAuthorization } from '@/hooks/useAuthorization';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';

// A simple debounce hook
function useDebounce(value: string, delay: number) {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);
    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);
  return debouncedValue;
}

const initialNewEmployeeState = {
  employeeId: '',
  employeeNo: '',
  name: '',
  email: '',
  phone: '',
  department: '',
  designation: '',
  status: 'Active' as 'Active' | 'Inactive',
  dateOfJoin: '',
  dateOfBirth: '',
  gender: '',
};

type EnrichedEmployee = Employee & {
  positions?: Record<string, string>;
};

const filterHierarchy: (keyof typeof initialFilters)[] = [
    'Project Name',
    'Project Division',
    'Department',
    'Location',
    'Cost Center',
    'Designation',
    'EMPLOYEE TYPE',
    'Grade',
    'Shift',
    'COST CENTER CODE',
];

const initialFilters = {
    employeeId: '',
    name: '',
    status: 'all',
    'Project Name': 'all',
    'Project Division': 'all',
    'Department': 'all',
    'Location': 'all',
    'Cost Center': 'all',
    'Designation': 'all',
    'EMPLOYEE TYPE': 'all',
    'Grade': 'all',
    'Shift': 'all',
    'COST CENTER CODE': 'all',
  };

export default function ManageEmployeePage() {
  const { toast } = useToast();
  const { can, isLoading: isAuthLoading } = useAuthorization();

  const [employees, setEmployees] = useState<EnrichedEmployee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [newEmployee, setNewEmployee] = useState(initialNewEmployeeState);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);

  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);

  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<string[]>([]);
  const [filters, setFilters] = useState(initialFilters);

  const debouncedEmployeeId = useDebounce(filters.employeeId, 300);
  const debouncedName = useDebounce(filters.name, 300);

  const canView = can('View', 'Settings.Employee Management');
  const canAdd = can('Add', 'Settings.Employee Management');
  const canEdit = can('Edit', 'Settings.Employee Management');
  const canDelete = can('Delete', 'Settings.Employee Management');

  useEffect(() => {
    if (isAuthLoading) return;
    if (!canView) {
      setIsLoading(false);
      return;
    }
    fetchData();
  }, [isAuthLoading, canView]);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [employeesSnap, deptsSnap, positionsSnap] = await Promise.all([
        getDocs(collection(db, 'employees')),
        getDocs(collection(db, 'departments')),
        getDocs(collection(db, 'employeePositions')),
      ]);

      const employeesData: Employee[] = employeesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Employee));
      const positionsData = positionsSnap.docs.map(doc => doc.data() as EmployeePosition);

      const positionsMap = new Map<string, Record<string, string>>();
      positionsData.forEach(pos => {
        const posRecord: Record<string, string> = {};
        pos.categoryList.forEach(cat => {
          posRecord[cat.category] = cat.value;
        });
        positionsMap.set(pos.employeeId, posRecord);
      });

      const enrichedEmployees: EnrichedEmployee[] = employeesData.map(emp => ({
        ...emp,
        positions: positionsMap.get(emp.employeeNo || emp.employeeId),
      }));
      setEmployees(enrichedEmployees);

      const deptsData: Department[] = deptsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Department));
      setDepartments(deptsData);
    } catch (error) {
      console.error('Error fetching data: ', error);
      toast({
        title: 'Error',
        description: 'Failed to fetch employees or departments.',
        variant: 'destructive',
      });
    }
    setIsLoading(false);
  }, [toast]);

  const dynamicColumns = useMemo(() => {
    const columns = new Set<string>();
    employees.forEach(emp => {
      if (emp.positions) {
        Object.keys(emp.positions).forEach(key => columns.add(key));
      }
    });
    return Array.from(columns).sort();
  }, [employees]);

  const handleFilterChange = (field: keyof typeof filters, value: string) => {
    setFilters(prev => {
      const newState = { ...prev, [field]: value };
      const fieldIndex = filterHierarchy.indexOf(field as any);
      
      if (fieldIndex > -1) {
        // Reset all subsequent (child) filters in the hierarchy
        for (let i = fieldIndex + 1; i < filterHierarchy.length; i++) {
          const childField = filterHierarchy[i];
          newState[childField] = 'all';
        }
      }
      return newState;
    });
  };
  
  const clearFilters = () => {
    setFilters(initialFilters);
  };
  
  const filteredEmployees = useMemo(() => {
    return employees.filter(emp => {
      const idMatch = (debouncedEmployeeId === '' ||
          emp.employeeId?.toLowerCase().includes(debouncedEmployeeId.toLowerCase()) ||
          emp.employeeNo?.toLowerCase().includes(debouncedEmployeeId.toLowerCase()));
      const nameMatch = (debouncedName === '' ||
          emp.name.toLowerCase().includes(debouncedName.toLowerCase()));
      const statusMatch = (filters.status === 'all' || emp.status === filters.status);
      
      const positionFiltersMatch = filterHierarchy.every(col => {
          const filterValue = filters[col as keyof typeof filters];
          if(filterValue === 'all') return true;
          return emp.positions?.[col] === filterValue;
      });

      return idMatch && nameMatch && statusMatch && positionFiltersMatch;
    });
  }, [employees, debouncedEmployeeId, debouncedName, filters]);
  
  const filterOptions = useMemo(() => {
      let dataForOptions = employees;
      const options: Record<string, string[]> = {};

      for (const field of filterHierarchy) {
          const filterValue = filters[field as keyof typeof filters];
          const uniqueValues = new Set<string>();
          
          dataForOptions.forEach(emp => {
              if (emp.positions?.[field]) {
                  uniqueValues.add(emp.positions[field]);
              }
          });
          
          options[field] = Array.from(uniqueValues).sort();

          if(filterValue !== 'all') {
              dataForOptions = dataForOptions.filter(emp => emp.positions?.[field] === filterValue);
          }
      }

      return options;

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
    if (!newEmployee.employeeNo.trim() || !newEmployee.name.trim()) {
      toast({
        title: 'Validation Error',
        description: 'Employee No and Name cannot be empty.',
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
      console.error('Error adding employee: ', error);
      toast({
        title: 'Error',
        description: 'Failed to add employee.',
        variant: 'destructive',
      });
    }
  };

  const handleDeleteEmployee = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'employees', id));
      toast({
        title: 'Success',
        description: 'Employee deleted successfully.',
      });
      fetchData();
    } catch (error) {
      console.error('Error deleting employee: ', error);
      toast({
        title: 'Error',
        description: 'Failed to delete employee.',
        variant: 'destructive',
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
      <div className="w-full px-4">
        <div className="mb-6 flex items-center justify-between">
          <Skeleton className="h-10 w-48" />
          <Skeleton className="h-10 w-32" />
        </div>
        <Card>
          <CardContent className="p-0">
            <Skeleton className="h-96 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="w-full max-w-4xl mx-auto px-4">
        <div className="mb-6 flex items-center gap-4">
          <Link href="/employee">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-6 w-6" />
            </Button>
          </Link>
          <h1 className="text-2xl font-bold">Manage Employee</h1>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescriptionShad>
              You do not have permission to view this page. Please contact an administrator.
            </CardDescriptionShad>
          </CardHeader>
          <CardContent className="flex justify-center p-8">
            <ShieldAlert className="h-16 w-16 text-destructive" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/employee">
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
          <DialogContent
            className="sm:max-w-2xl"
            onPointerDownOutside={e => e.preventDefault()}
          >
            <DialogHeader>
              <DialogTitle>Add New Employee</DialogTitle>
              <DialogDescription>
                Fill in the details to add a new employee.
              </DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="addEmployeeNo">Employee No</Label>
                <Input
                  id="addEmployeeNo"
                  value={newEmployee.employeeNo}
                  onChange={e => handleInputChange('employeeNo', e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="addName">Name</Label>
                <Input
                  id="addName"
                  value={newEmployee.name}
                  onChange={e => handleInputChange('name', e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="addDateOfJoin">Date of Join</Label>
                <Input
                  id="addDateOfJoin"
                  type="date"
                  value={newEmployee.dateOfJoin}
                  onChange={e =>
                    handleInputChange('dateOfJoin', e.target.value)
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="addStatus">Status</Label>
                <Select
                  value={newEmployee.status}
                  onValueChange={(value: 'Active' | 'Inactive') =>
                    handleSelectChange('status', value)
                  }
                >
                  <SelectTrigger id="addStatus">
                    <SelectValue />
                  </SelectTrigger>
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

      <Card className="mb-6">
        <CardContent className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 gap-4 items-end">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search Employee No..."
                className="pl-8"
                value={filters.employeeId}
                onChange={e => handleFilterChange('employeeId', e.target.value)}
              />
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search Name..."
                className="pl-8"
                value={filters.name}
                onChange={e => handleFilterChange('name', e.target.value)}
              />
            </div>
            <Select
              value={filters.status}
              onValueChange={value => handleFilterChange('status', value)}
            >
              <SelectTrigger><SelectValue placeholder="All Statuses" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="Active">Active</SelectItem>
                <SelectItem value="Inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>

            {filterHierarchy.map(col => {
                if (!dynamicColumns.includes(col)) return null;
                const options = filterOptions[col];
                if (!options || options.length === 0) return null;
                return (
                    <Select key={col} value={filters[col as keyof typeof filters]} onValueChange={(value) => handleFilterChange(col as keyof typeof filters, value)}>
                        <SelectTrigger><SelectValue placeholder={`All ${col}s`} /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All {col}s</SelectItem>
                            {options.map(opt => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}
                        </SelectContent>
                    </Select>
                );
            })}
            <Button variant="secondary" onClick={clearFilters} className="w-full xl:w-auto">Clear Filters</Button>

          {selectedEmployeeIds.length > 0 && (
            <div className="sm:ml-auto mt-4 sm:mt-0 xl:col-start-7">
              <Button
                variant="destructive"
                onClick={handleDeleteSelected}
                disabled={!canDelete}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete ({selectedEmployeeIds.length})
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <ScrollArea className="h-[calc(100vh-20rem)] w-full">
            <div className="relative">
              <Table style={{ tableLayout: 'auto' }}>
                <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow>
                    <TableHead className="w-[50px]">
                      <Checkbox
                        checked={
                          filteredEmployees.length > 0 &&
                          selectedEmployeeIds.length ===
                            filteredEmployees.length
                        }
                        onCheckedChange={checked =>
                          handleSelectAll(!!checked)
                        }
                        aria-label="Select all"
                        disabled={!canDelete}
                      />
                    </TableHead>
                    <TableHead>Employee ID</TableHead>
                    <TableHead>Employee No</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Date of Join</TableHead>
                    <TableHead>Status</TableHead>
                    {dynamicColumns.map(col => (
                      <TableHead key={col}>{col}</TableHead>
                    ))}
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    Array.from({ length: 10 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell
                          colSpan={7 + dynamicColumns.length}
                        >
                          <Skeleton className="h-6 w-full" />
                        </TableCell>
                      </TableRow>
                    ))
                  ) : filteredEmployees.length > 0 ? (
                    filteredEmployees.map(emp => (
                      <TableRow
                        key={emp.id}
                        data-state={
                          selectedEmployeeIds.includes(emp.id) &&
                          'selected'
                        }
                      >
                        <TableCell>
                          <Checkbox
                            checked={selectedEmployeeIds.includes(emp.id)}
                            onCheckedChange={checked =>
                              handleSelectEmployee(emp.id, !!checked)
                            }
                            aria-label={`Select employee ${emp.name}`}
                            disabled={!canDelete}
                          />
                        </TableCell>
                        <TableCell>{emp.employeeId}</TableCell>
                        <TableCell>{emp.employeeNo}</TableCell>
                        <TableCell className="font-medium whitespace-nowrap">
                          {emp.name}
                        </TableCell>
                        <TableCell>{emp.dateOfJoin}</TableCell>
                        <TableCell>{emp.status}</TableCell>
                        {dynamicColumns.map(col => (
                          <TableCell key={col}>
                            {emp.positions?.[col] || '-'}
                          </TableCell>
                        ))}
                        <TableCell className="text-right space-x-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openEditDialog(emp)}
                            disabled={!canEdit}
                          >
                            Edit
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => handleDeleteEmployee(emp.id)}
                            disabled={!canDelete}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell
                        colSpan={7 + dynamicColumns.length}
                        className="text-center h-24"
                      >
                        No employees found.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
             <ScrollBar orientation="horizontal" />
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
                <Input
                  id="editEmployeeId"
                  value={editingEmployee.employeeId}
                  onChange={e =>
                    setEditingEmployee({
                      ...editingEmployee,
                      employeeId: e.target.value,
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="editEmployeeNo">Employee No</Label>
                <Input
                  id="editEmployeeNo"
                  value={editingEmployee.employeeNo}
                  onChange={e =>
                    setEditingEmployee({
                      ...editingEmployee,
                      employeeNo: e.target.value,
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="editName">Name</Label>
                <Input
                  id="editName"
                  value={editingEmployee.name}
                  onChange={e =>
                    setEditingEmployee({
                      ...editingEmployee,
                      name: e.target.value,
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="editDateOfJoin">Date of Join</Label>
                <Input
                  id="editDateOfJoin"
                  type="date"
                  value={editingEmployee.dateOfJoin || ''}
                  onChange={e =>
                    setEditingEmployee({
                      ...editingEmployee,
                      dateOfJoin: e.target.value,
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="editStatus">Status</Label>
                <Select
                  value={editingEmployee.status}
                  onValueChange={(value: 'Active' | 'Inactive') =>
                    setEditingEmployee({
                      ...editingEmployee,
                      status: value,
                    })
                  }
                >
                  <SelectTrigger id="editStatus">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Active">Active</SelectItem>
                    <SelectItem value="Inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button onClick={handleUpdateEmployee}>Update Employee</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

    

    
