
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
import type { Employee, SalaryDetail, SalarySyncLog } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthorization } from '@/hooks/useAuthorization';
import { syncSalary } from '@/ai';
import { format, getYear, startOfMonth } from 'date-fns';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';

const salaryComponents = [
    'GROSS',
    'NET PAY',
    'BASIC',
    'HRA',
    'CONVEYANCE',
    'TOTAL DEDUCTIONS',
    'PF',
    'PROF TAX',
    'INSURANCE_DEDUCTION',
    'SALARY MASTER',
];

export default function EmployeeSalaryPage() {
  const { toast } = useToast();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const [displayedEmployees, setDisplayedEmployees] = useState<Employee[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const currentYear = getYear(new Date());
  const currentMonth = new Date().getMonth();

  const [selectedYear, setSelectedYear] = useState<number>(currentYear);
  const [selectedMonth, setSelectedMonth] = useState<number>(currentMonth);

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

  const fetchSalariesForMonth = useCallback(async (monthStr: string) => {
    setIsLoading(true);
    try {
        const salaryQuery = query(collection(db, 'employees'), where('salaryMonth', '==', monthStr));
        const snapshot = await getDocs(salaryQuery);
        if(!snapshot.empty) {
            const employeesFromDb = snapshot.docs.map(doc => doc.data() as Employee);
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
        fetchSalariesForMonth(monthStr);
    }
  }, [isAuthLoading, canView, selectedYear, selectedMonth, fetchSalariesForMonth]);

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
        if (result.success) {
            toast({
                title: 'Sync Successful',
                description: result.message,
            });
            setDisplayedEmployees(result.employees || []);
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

  const filteredEmployees = useMemo(() => {
    const term = searchTerm.toLowerCase();
    if (!term) return displayedEmployees;

    return displayedEmployees.filter(emp => {
        return emp.name.toLowerCase().includes(term) || emp.employeeId.toLowerCase().includes(term);
    })
  }, [displayedEmployees, searchTerm]);

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
        <CardContent className="p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            Last synced on: <span className="font-semibold">{lastSynced || 'Never'}</span>
          </p>
          <div className="relative w-full sm:w-1/3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by Employee ID or Name..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
          </div>
        </CardContent>
       </Card>
      
      <Card>
        <CardContent className="p-0">
          <ScrollArea className="h-[calc(100vh-22rem)] w-full">
            <Table>
              <TableHeader className="sticky top-0 bg-background z-10">
                <TableRow>
                  <TableHead className="w-[200px] sticky left-0 bg-background z-20">Employee</TableHead>
                  <TableHead>Gross Salary</TableHead>
                  <TableHead>Net Salary</TableHead>
                  {salaryComponents.map(comp => <TableHead key={comp}>{comp}</TableHead>)}
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading || isSyncing ? (
                  Array.from({length: 5}).map((_, i) => (
                      <TableRow key={i}>
                          <TableCell colSpan={salaryComponents.length + 3}><Skeleton className="h-6 w-full" /></TableCell>
                      </TableRow>
                  ))
                ) : filteredEmployees.length > 0 ? (
                  filteredEmployees.map(emp => (
                    <TableRow key={emp.employeeId}>
                      <TableCell className="font-medium sticky left-0 bg-background z-20">
                          <div className="font-bold">{emp.name}</div>
                          <div className="text-xs text-muted-foreground">{emp.employeeId}</div>
                      </TableCell>
                      <TableCell>{formatCurrency(emp.grossSalary)}</TableCell>
                      <TableCell>{formatCurrency(emp.netSalary)}</TableCell>
                      {salaryComponents.map(comp => (
                        <TableCell key={comp}>{formatCurrency(getSalaryComponentValue(emp.salaryDetails, comp))}</TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={salaryComponents.length + 3} className="h-24 text-center">
                      No salary data to display. Please select a month and sync.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
