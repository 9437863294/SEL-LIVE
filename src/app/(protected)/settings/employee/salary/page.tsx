
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Edit } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, query } from 'firebase/firestore';
import type { Employee } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthorization } from '@/hooks/useAuthorization';

export default function EmployeeSalaryPage() {
  const { toast } = useToast();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const canView = can('View', 'Settings.Employee Management');

  useEffect(() => {
    if (isAuthLoading) return;
    if (canView) {
      fetchEmployees();
    } else {
      setIsLoading(false);
    }
  }, [isAuthLoading, canView]);

  const fetchEmployees = async () => {
    setIsLoading(true);
    try {
      const q = query(collection(db, 'employees'));
      const querySnapshot = await getDocs(q);
      const employeesData = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Employee));
      setEmployees(employeesData);
    } catch (error) {
      console.error("Error fetching employees:", error);
      toast({
        title: 'Error',
        description: 'Failed to fetch employees.',
        variant: 'destructive',
      });
    }
    setIsLoading(false);
  };
  
  const formatCurrency = (amount: number | undefined) => {
    if (typeof amount !== 'number') return 'N/A';
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
    }).format(amount);
  };

  if (isAuthLoading || (isLoading && canView)) {
      return (
        <div className="w-full max-w-6xl mx-auto">
            <div className="mb-6"><Skeleton className="h-10 w-80" /></div>
            <Card><CardContent><Skeleton className="h-96" /></CardContent></Card>
        </div>
      )
  }

  if (!canView) {
    return <div>Access Denied</div>;
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
          <div>
            <h1 className="text-2xl font-bold">Employee Salary</h1>
            <p className="text-muted-foreground">View and manage salary details for all employees.</p>
          </div>
        </div>
      </div>
      
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee ID</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Designation</TableHead>
                <TableHead>Gross Salary</TableHead>
                <TableHead>Net Salary</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {employees.length > 0 ? (
                employees.map(emp => (
                  <TableRow key={emp.id}>
                    <TableCell>{emp.employeeId}</TableCell>
                    <TableCell>{emp.name}</TableCell>
                    <TableCell>{emp.department}</TableCell>
                    <TableCell>{emp.designation}</TableCell>
                    <TableCell>{formatCurrency((emp as any).grossSalary)}</TableCell>
                    <TableCell>{formatCurrency((emp as any).netSalary)}</TableCell>
                    <TableCell className="text-right">
                        <Button variant="outline" size="sm">
                            <Edit className="mr-2 h-4 w-4" /> Edit
                        </Button>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center">No employees found.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
