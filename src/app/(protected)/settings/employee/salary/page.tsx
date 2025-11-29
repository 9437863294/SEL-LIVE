'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, RefreshCw, Loader2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, where, doc, getDoc } from 'firebase/firestore';
import type { Employee, SalaryDetail, SalarySyncLog, EmployeePosition } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthorization } from '@/hooks/useAuthorization';
import { syncSalary } from '@/ai';
import { format, getYear, startOfMonth } from 'date-fns';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';

interface EnrichedEmployee extends Employee {
    positions?: Record<string, string>;
}

export default function EmployeeSalaryPage() {
  const { toast } = useToast();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const [displayedEmployees, setDisplayedEmployees] = useState<EnrichedEmployee[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState<string | null>(null);

  const currentYear = getYear(new Date());
  const currentMonth = new Date().getMonth();

  const [selectedYear, setSelectedYear] = useState<number>(currentYear);
  const [selectedMonth, setSelectedMonth] = useState<number>(currentMonth);

  const [filters, setFilters] = useState({
    searchTerm: '',
    projectName: 'all',
    location: 'all',
    employeeType: 'all',
    designation: 'all',
    department: 'all',
  });

  const canView = can('View', 'Settings.Employee Management');
  const canSync = can('Sync from GreytHR', 'Settings.Employee Management');
  
  const fetchLastSyncedTime = useCallback(async (monthStr: string) => {
    try {
      const syncLogRef = doc(db, 'salarySyncLogs', monthStr);
      const docSnap = await getDoc(syncLogRef);
      if (docSnap.exists()) {
        const data = docSnap.data() as SalarySyncLog;
        setLastSynced(format(data.lastSynced.toDate(), 'dd MMM, yyyy HH:mm'));
      } else {
        setLastSynced(null);
      }
    } catch (error) {
        console.error("Could not fetch last sync time", error);
        setLastSynced(null);
    }
  }, []);

  const fetchSalariesAndPositions = useCallback(async (monthStr: string) => {
    setIsLoading(true);
    try {
        const salaryQuery = query(collection(db, 'employees'), where('salaryMonth', '==', monthStr));
        const positionsQuery = query(collection(db, 'employeePositions'));

        const [snapshot, positionsSnap] = await Promise.all([
          getDocs(salaryQuery),
          getDocs(positionsQuery)
        ]);
        
        const positionsMap = new Map<string, Record<string, string>>();
        positionsSnap.docs.forEach(doc => {
            const pos = doc.data() as EmployeePosition;
            const posRecord: Record<string, string> = {};
            pos.categoryList.forEach(cat => {
                posRecord[cat.category] = cat.value;
            });
            positionsMap.set(pos.employeeId, posRecord);
        });

        if(!snapshot.empty) {
            const employeesFromDb = snapshot.docs.map(doc => {
                const emp = doc.data() as Employee;
                return {
                    ...emp,
                    positions: positionsMap.get(emp.employeeNo || emp.employeeId),
                };
            });
            setDisplayedEmployees(employeesFromDb);
        } else {
            setDisplayedEmployees([]);
        }
        await fetchLastSyncedTime(monthStr);
    } catch (e) {
        console.error(e);
        setDisplayedEmployees([]);
    }
    setIsLoading(false);
  }, [fetchLastSyncedTime]);

  useEffect(() => {
    if (!isAuthLoading && canView) {
        const monthStr = format(new Date(selectedYear, selectedMonth), 'yyyy-MM');
        fetchSalariesAndPositions(monthStr);
    }
  }, [isAuthLoading, canView, selectedYear, selectedMonth, fetchSalariesAndPositions]);

  const handleSync = async () => {
    if (!canSync) {
        toast({ title: "Permission Denied", description: "You don't have permission to sync salaries.", variant: "destructive" });
        return;
    }
    setIsSyncing(true);
    
    try {
        const firstDayOfMonth = new Date(selectedYear, selectedMonth, 1);
        const monthString = format(firstDayOfMonth, 'yyyy-MM-dd');
        
        const result = await syncSalary({ month: monthString });
        if (result.success && result.employees) {
            toast({
                title: 'Sync Successful',
                description: result.message,
            });

            const positionsQuery = query(collection(db, 'employeePositions'));
            const positionsSnap = await getDocs(positionsQuery);
            const positionsMap = new Map<string, Record<string, string>>();
            positionsSnap.docs.forEach(doc => {
                const pos = doc.data() as EmployeePosition;
                const posRecord: Record<string, string> = {};
                pos.categoryList.forEach(cat => {
                    posRecord[cat.category] = cat.value;
                });
                positionsMap.set(pos.employeeId, posRecord);
            });

            const enrichedEmployees = result.employees.map(emp => ({
                ...emp,
                positions: positionsMap.get(emp.employeeId),
            }));

            setDisplayedEmployees(enrichedEmployees as EnrichedEmployee[]);
            await fetchLastSyncedTime(format(new Date(selectedYear, selectedMonth), 'yyyy-MM'));
        } else {
            throw new Error(result.message);
        }
    } catch (error: any) {
         toast({
            title: 'Sync Failed',
            description: error.message || 'An unknown error occurred.',
            variant: 'destructive',
        });
    } finally {
        setIsSyncing(false);
    }
  }

  const getSalaryComponentValue = (details: SalaryDetail[] | undefined, description: string): number => {
    if (!details) return 0;
    if (description === 'TOTAL DEDUCTIONS') {
        return details
            .filter(d => d.type === 'DEDUCT')
            .reduce((sum, item) => sum + item.amount, 0);
    }
    const item = details.find(d => d.description === description);
    return item ? item.amount : 0;
  };

  const formatCurrency = (amount: number | undefined) => {
    if (typeof amount !== 'number' || isNaN(amount)) return 'N/A';
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
    }).format(amount);
  };
  
  const yearOptions = useMemo(() => {
      const startYear = currentYear - 5;
      return Array.from({ length: 10 }, (_, i) => startYear + i).reverse();
  }, [currentYear]);

  const monthOptions = useMemo(() => {
      return Array.from({ length: 12 }, (_, i) => ({
          value: i,
          label: format(new Date(2000, i), 'MMMM'),
      }));
  }, []);

  const dynamicColumns = useMemo(() => {
    return ['Project Name', 'Location', 'EMPLOYEE TYPE', 'Designation', 'Department'];
  }, []);

  const filterOptions = useMemo(() => {
    const options: Record<string, Set<string>> = {};
    dynamicColumns.forEach(col => {
      options[col] = new Set();
    });

    displayedEmployees.forEach(emp => {
      dynamicColumns.forEach(col => {
        if (emp.positions?.[col]) {
          options[col].add(emp.positions[col]);
        }
      });
    });

    return {
      'Project Name': Array.from(options['Project Name']).sort(),
      'Location': Array.from(options['Location']).sort(),
      'EMPLOYEE TYPE': Array.from(options['EMPLOYEE TYPE']).sort(),
      'Designation': Array.from(options['Designation']).sort(),
      'Department': Array.from(options['Department']).sort(),
    };
  }, [displayedEmployees, dynamicColumns]);

  const filteredEmployees = useMemo(() => {
    const term = filters.searchTerm.toLowerCase();
    
    return displayedEmployees.filter(emp => {
        const searchMatch = !term || emp.name.toLowerCase().includes(term) || (emp.employeeNo || emp.employeeId).toLowerCase().includes(term);
        const projectMatch = filters.projectName === 'all' || emp.positions?.['Project Name'] === filters.projectName;
        const locationMatch = filters.location === 'all' || emp.positions?.['Location'] === filters.location;
        const employeeTypeMatch = filters.employeeType === 'all' || emp.positions?.['EMPLOYEE TYPE'] === filters.employeeType;
        const designationMatch = filters.designation === 'all' || emp.positions?.['Designation'] === filters.designation;
        const departmentMatch = filters.department === 'all' || emp.positions?.['Department'] === filters.department;
        
        return searchMatch && projectMatch && locationMatch && employeeTypeMatch && designationMatch && departmentMatch;
    })
  }, [displayedEmployees, filters]);

  const handleFilterChange = (filterName: string, value: string) => {
    setFilters(prev => ({ ...prev, [filterName]: value }));
  };

  return (
    <div className="w-full">
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
         <div className="flex items-center gap-2">
            <Select value={String(selectedYear)} onValueChange={(val) => setSelectedYear(Number(val))}>
                <SelectTrigger className="w-[120px]">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    {yearOptions.map(year => (
                        <SelectItem key={year} value={String(year)}>{year}</SelectItem>
                    ))}
                </SelectContent>
            </Select>
            <Select value={String(selectedMonth)} onValueChange={(val) => setSelectedMonth(Number(val))}>
                <SelectTrigger className="w-[150px]">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    {monthOptions.map(month => (
                        <SelectItem key={month.value} value={String(month.value)}>{month.label}</SelectItem>
                    ))}
                </SelectContent>
            </Select>
            <Button onClick={handleSync} disabled={isSyncing || !canSync}>
                {isSyncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <RefreshCw className="mr-2 h-4 w-4" />}
                Sync Salary
            </Button>
        </div>
      </div>
       <Card className="mb-4">
        <CardContent className="p-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by ID or Name..."
                value={filters.searchTerm}
                onChange={(e) => handleFilterChange('searchTerm', e.target.value)}
                className="pl-9"
              />
            </div>
             <Select value={filters.projectName} onValueChange={(v) => handleFilterChange('projectName', v)}>
              <SelectTrigger><SelectValue placeholder="All Projects"/></SelectTrigger>
              <SelectContent>
                  <SelectItem value="all">All Projects</SelectItem>
                  {filterOptions['Project Name'].map(opt => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}
              </SelectContent>
            </Select>
             <Select value={filters.department} onValueChange={(v) => handleFilterChange('department', v)}>
              <SelectTrigger><SelectValue placeholder="All Departments"/></SelectTrigger>
              <SelectContent>
                  <SelectItem value="all">All Departments</SelectItem>
                  {filterOptions['Department'].map(opt => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}
              </SelectContent>
            </Select>
             <Select value={filters.designation} onValueChange={(v) => handleFilterChange('designation', v)}>
              <SelectTrigger><SelectValue placeholder="All Designations"/></SelectTrigger>
              <SelectContent>
                  <SelectItem value="all">All Designations</SelectItem>
                  {filterOptions['Designation'].map(opt => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}
              </SelectContent>
            </Select>
        </CardContent>
       </Card>
      
      <Card>
        <CardContent className="p-0">
          <ScrollArea className="h-[calc(100vh-22rem)] w-full">
            <div className="min-w-[1200px]">
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow>
                    <TableHead className="w-[120px]">Employee ID</TableHead>
                    <TableHead>Name</TableHead>
                    {dynamicColumns.map(col => <TableHead key={col}>{col}</TableHead>)}
                    <TableHead>Gross Salary</TableHead>
                    <TableHead>TOTAL DEDUCTIONS</TableHead>
                    <TableHead>Net Salary</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading || isSyncing ? (
                    Array.from({length: 5}).map((_, i) => (
                        <TableRow key={i}>
                            <TableCell colSpan={5 + dynamicColumns.length}><Skeleton className="h-6 w-full" /></TableCell>
                        </TableRow>
                    ))
                  ) : filteredEmployees.length > 0 ? (
                    filteredEmployees.map(emp => (
                      <TableRow key={emp.employeeId}>
                        <TableCell>{emp.employeeNo || emp.employeeId}</TableCell>
                        <TableCell className="font-medium">{emp.name}</TableCell>
                        {dynamicColumns.map(col => (
                            <TableCell key={col}>{emp.positions?.[col] || '-'}</TableCell>
                        ))}
                        <TableCell>{formatCurrency(emp.grossSalary)}</TableCell>
                        <TableCell>{formatCurrency(getSalaryComponentValue(emp.salaryDetails, 'TOTAL DEDUCTIONS'))}</TableCell>
                        <TableCell>{formatCurrency(emp.netSalary)}</TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={5 + dynamicColumns.length} className="h-24 text-center">
                        No salary data to display. Please select a month and sync.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
