'use client';

/**
 * Employee salary for one payroll month, read from the synced `employees` mirror.
 *
 * The month is the whole screen: every figure, filter option and total below belongs to the month in
 * the header, and switching it re-reads Firestore rather than filtering client-side. Because a month
 * only holds rows once it has been synced from greytHR — and the month a user lands on is the current
 * one, which normally has not been run yet — the empty case says exactly that instead of the generic
 * "no data", which otherwise reads as "these people have no salary".
 *
 * Styled to match `employee/current`: KPI row, a dense scrolling `<table>` with a sticky header, and
 * a `<tfoot>` carrying the gross / deductions / net totals for whatever the filters currently show.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, Download, IndianRupee, Loader2, RefreshCw, Search, TrendingDown, Users, Wallet, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AuroraBackdrop } from '@/components/effects/AuroraBackdrop';
import {
  HrAccessDenied,
  HrEmptyState,
  HrFilterCard,
  HrKpiCard,
  HrLoader,
  HrPageHeader,
  SensitiveMoney,
  hrDialog,
} from '@/components/hr/hr-ui';
import { useHrPermissions } from '@/components/hr/use-hr-config';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, where, doc, getDoc } from 'firebase/firestore';
import type { Employee, SalaryDetail, SalarySyncLog, EmployeePosition } from '@/lib/types';
import { useAuthorization } from '@/hooks/useAuthorization';
import { syncSalary } from '@/ai';
import { cn } from '@/lib/utils';
import { exportRowsToExcel } from '@/lib/report-excel';
import { format, getYear } from 'date-fns';

interface EnrichedEmployee extends Employee {
  positions?: Record<string, string>;
}

/**
 * A figure that is genuinely absent reads as a dash — not as ₹0, which is a different statement.
 * Present figures route through `SensitiveMoney` (control rule 63.12): the dash is fine to show
 * anyone, because "nothing was synced" is not a salary figure.
 */
function MoneyCell({ value, canView }: { value: number | undefined | null; canView: boolean }) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return <span className="text-muted-foreground">—</span>;
  }
  return <SensitiveMoney value={value} canView={canView} exact />;
}

/** One block of the payslip dialog: a component list with its amounts, hidden when empty. */
function PayslipSection({
  title,
  items,
  canView,
  amountClassName,
}: {
  title: string;
  items: SalaryDetail[];
  canView: boolean;
  amountClassName?: string;
}) {
  if (!items.length) return null;
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
      <div className="mt-1 divide-y divide-slate-100 rounded-lg border border-slate-100 bg-white/70">
        {items.map((item, index) => (
          // Index in the key: greytHR can emit two components with the same description.
          <div key={`${item.description}-${index}`} className="flex items-center justify-between gap-3 px-3 py-1.5 text-xs">
            <span className="min-w-0 truncate text-slate-700">{item.description || item.itemName}</span>
            <SensitiveMoney value={item.amount} canView={canView} exact className={cn('shrink-0', amountClassName)} />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function EmployeeSalaryPage() {
  const { toast } = useToast();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  // Control rule 63.12 — the same gate `SensitiveMoney` callers use everywhere else. Viewing this
  // page (Settings.Employee Management) and viewing the figures on it are separate permissions.
  const { canViewSalary } = useHrPermissions();
  const [displayedEmployees, setDisplayedEmployees] = useState<EnrichedEmployee[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  // `isLoading` starts false, so without this the "not synced yet" empty state would flash on first
  // paint before the fetch has even been issued — an answer shown before the question was asked.
  const [hasLoaded, setHasLoaded] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [payslipFor, setPayslipFor] = useState<EnrichedEmployee | null>(null);

  const currentYear = getYear(new Date());
  const currentMonth = new Date().getMonth();

  const [selectedYear, setSelectedYear] = useState<string>(currentYear.toString());
  const [selectedMonth, setSelectedMonth] = useState<string>(currentMonth.toString());

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

  /** The one month everything on this page is about, in the two shapes it is needed in. */
  const selectedDate = useMemo(
    () => new Date(parseInt(selectedYear, 10), parseInt(selectedMonth, 10), 1),
    [selectedYear, selectedMonth],
  );
  const monthKey = useMemo(() => format(selectedDate, 'yyyy-MM'), [selectedDate]);
  const monthLabel = useMemo(() => format(selectedDate, 'MMMM yyyy'), [selectedDate]);

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
    setError(null);
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

      if (!snapshot.empty) {
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
      // Previously this only reached the console, so a failed read looked identical to a month with
      // no salary data — the reader was told to sync a month that had already been synced.
      console.error(e);
      setDisplayedEmployees([]);
      setError(e instanceof Error ? e.message : 'Could not load salary records for this month.');
    }
    setHasLoaded(true);
    setIsLoading(false);
  }, [fetchLastSyncedTime]);

  useEffect(() => {
    if (!isAuthLoading && canView) {
      fetchSalariesAndPositions(monthKey);
    }
  }, [isAuthLoading, canView, monthKey, fetchSalariesAndPositions]);

  const handleSync = async () => {
    if (!canSync) {
      toast({ title: "Permission Denied", description: "You don't have permission to sync salaries.", variant: "destructive" });
      return;
    }
    setIsSyncing(true);

    try {
      const monthString = format(selectedDate, 'yyyy-MM-dd');

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

        setError(null);
        setDisplayedEmployees(enrichedEmployees as EnrichedEmployee[]);
        setHasLoaded(true);
        await fetchLastSyncedTime(monthKey);
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

  const yearOptions = useMemo(() => {
    const startYear = currentYear - 5;
    return Array.from({ length: 10 }, (_, i) => startYear + i).reverse();
  }, [currentYear]);

  const monthOptions = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => ({
      value: i.toString(),
      label: format(new Date(2000, i), 'MMMM'),
    }));
  }, []);

  const dynamicColumns = useMemo(() => {
    return ['Project Name', 'Location', 'EMPLOYEE TYPE', 'Designation', 'Department'];
  }, []);

  const filterOptions = useMemo(() => {
    const opts: Record<string, string[]> = {
      'Project Name': [],
      'Location': [],
      'EMPLOYEE TYPE': [],
      'Designation': [],
      'Department': [],
    };
    const sets: Record<string, Set<string>> = {
      'Project Name': new Set(),
      'Location': new Set(),
      'EMPLOYEE TYPE': new Set(),
      'Designation': new Set(),
      'Department': new Set(),
    };

    let baseData = displayedEmployees;

    if (filters.projectName !== 'all') {
      baseData = baseData.filter(e => e.positions?.['Project Name'] === filters.projectName);
    }
    if (filters.location !== 'all') {
      baseData = baseData.filter(e => e.positions?.['Location'] === filters.location);
    }
    if (filters.employeeType !== 'all') {
      baseData = baseData.filter(e => e.positions?.['EMPLOYEE TYPE'] === filters.employeeType);
    }
    if (filters.department !== 'all') {
        baseData = baseData.filter(e => e.positions?.['Department'] === filters.department);
    }
     if (filters.designation !== 'all') {
        baseData = baseData.filter(e => e.positions?.['Designation'] === filters.designation);
    }

    baseData.forEach(e => {
      if (e.positions) {
        dynamicColumns.forEach(col => {
          const val = e.positions?.[col];
          if (val) sets[col].add(val);
        });
      }
    });

    dynamicColumns.forEach(col => {
      opts[col] = Array.from(sets[col]).sort();
    });

    return opts;
  }, [displayedEmployees, dynamicColumns, filters]);


  const filteredEmployees = useMemo(() => {
    const term = filters.searchTerm.trim().toLowerCase();

    return displayedEmployees.filter(emp => {
      const idOrNo = (emp.employeeNo || emp.employeeId || '').toLowerCase();
      const name = (emp.name || '').toLowerCase();
      if (term && !idOrNo.includes(term) && !name.includes(term)) {
        return false;
      }
      if (filters.projectName !== 'all' && emp.positions?.['Project Name'] !== filters.projectName) {
        return false;
      }
      if (filters.location !== 'all' && emp.positions?.['Location'] !== filters.location) {
        return false;
      }
      if (filters.employeeType !== 'all' && emp.positions?.['EMPLOYEE TYPE'] !== filters.employeeType) {
        return false;
      }
      if (filters.designation !== 'all' && emp.positions?.['Designation'] !== filters.designation) {
        return false;
      }
      if (filters.department !== 'all' && emp.positions?.['Department'] !== filters.department) {
        return false;
      }
      return true;
    });
  }, [displayedEmployees, filters]);

  /**
   * Totals for what is on screen, not for the month — a payroll figure that ignores the filters above
   * it would be read as the month's payroll and quietly disagree with the rows it sits under.
   */
  const totals = useMemo(() => {
    return filteredEmployees.reduce(
      (acc, emp) => {
        acc.gross += emp.grossSalary || 0;
        acc.deductions += getSalaryComponentValue(emp.salaryDetails, 'TOTAL DEDUCTIONS');
        acc.net += emp.netSalary || 0;
        return acc;
      },
      { gross: 0, deductions: 0, net: 0 },
    );
  }, [filteredEmployees]);

  const handleFilterChange = (filterName: keyof typeof filters, value: string) => {
    setFilters(prev => ({ ...prev, [filterName]: value }));
  };

  const clearFilters = () => {
    setFilters({
      searchTerm: '',
      projectName: 'all',
      location: 'all',
      employeeType: 'all',
      designation: 'all',
      department: 'all',
    });
  };

  const activeFilterCount = useMemo(
    () =>
      Object.entries(filters).filter(([key, value]) =>
        key === 'searchTerm' ? value.trim() !== '' : value !== 'all',
      ).length,
    [filters],
  );

  // `!hasLoaded` counts as busy so the first paint shows the loader, not zeros and "not synced yet".
  const isBusy = isLoading || isSyncing || !hasLoaded;

  const handleExport = async () => {
    if (!filteredEmployees.length) return;
    try {
      await exportRowsToExcel(
        `Salary ${monthLabel}`,
        filteredEmployees.map(emp => ({
          'Employee ID': emp.employeeNo || emp.employeeId,
          Name: emp.name,
          ...Object.fromEntries(dynamicColumns.map(col => [col, emp.positions?.[col] ?? ''])),
          'Gross Salary': emp.grossSalary ?? '',
          'Total Deductions': getSalaryComponentValue(emp.salaryDetails, 'TOTAL DEDUCTIONS'),
          'Net Salary': emp.netSalary ?? '',
        })),
        { filename: `employee-salary-${monthKey}.xlsx` },
      );
    } catch (error) {
      toast({
        title: 'Export failed',
        description: error instanceof Error ? error.message : 'Unexpected error.',
        variant: 'destructive',
      });
    }
  };

  const syncButton = (
    <Button
      onClick={handleSync}
      disabled={isSyncing || !canSync}
      title={canSync ? undefined : 'You do not have permission to sync salaries.'}
    >
      {isSyncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
      Sync Salary
    </Button>
  );

  return (
    <div className="relative min-h-[calc(100dvh-4rem)] overflow-hidden px-4 py-3 sm:px-5">
      <AuroraBackdrop />

      <div className="mb-1 flex flex-wrap items-center gap-2">
        <Link href="/employee">
          <Button variant="ghost" size="icon" className="rounded-full bg-white/70 shadow-sm backdrop-blur">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        {!isAuthLoading && canView && (
          lastSynced ? (
            <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-[10px] text-emerald-700">
              {monthLabel} · synced {lastSynced}
            </Badge>
          ) : (
            <Badge variant="outline" className="border-amber-200 bg-amber-50 text-[10px] text-amber-800">
              {monthLabel} · not synced yet
            </Badge>
          )
        )}
      </div>

      <HrPageHeader
        title="Employee Salary"
        description={`Gross, deductions and net pay for ${monthLabel}, as last synced from greytHR.`}
        actions={
          !isAuthLoading && canView ? (
            <>
              <Select value={selectedYear} onValueChange={(val) => setSelectedYear(val)}>
                <SelectTrigger className="w-[110px] bg-white/80">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {yearOptions.map(year => (
                    <SelectItem key={year} value={String(year)}>{year}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={selectedMonth} onValueChange={(val) => setSelectedMonth(val)}>
                <SelectTrigger className="w-[140px] bg-white/80">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {monthOptions.map(month => (
                    <SelectItem key={month.value} value={String(month.value)}>{month.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {/*
                The workbook carries the very figures `SensitiveMoney` masks on screen, so the button
                follows the same 63.12 permission — an ungated export would reopen the hole the mask
                closes.
              */}
              {canViewSalary && (
                <Button
                  variant="outline"
                  className="bg-white/80"
                  onClick={() => void handleExport()}
                  disabled={isBusy || filteredEmployees.length === 0}
                >
                  <Download className="mr-2 h-4 w-4" />
                  Export
                </Button>
              )}
              {syncButton}
            </>
          ) : undefined
        }
      />

      {isAuthLoading ? (
        <HrLoader label="Checking your access…" />
      ) : !canView ? (
        <HrAccessDenied what="employee salary details" />
      ) : error ? (
        <Card className="border-white/60 bg-white/80 shadow-sm">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <IndianRupee className="h-10 w-10 text-muted-foreground/40" />
            <div>
              <p className="font-medium text-slate-700">Could not load salary for {monthLabel}</p>
              <p className="mt-0.5 text-sm text-muted-foreground">{error}</p>
            </div>
            <Button size="sm" onClick={() => void fetchSalariesAndPositions(monthKey)} disabled={isBusy}>
              Try again
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {/* ── KPIs: the month's money, before anyone scrolls a 10-column table ── */}
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <HrKpiCard
              label="Employees"
              value={isBusy ? '—' : filteredEmployees.length}
              hint={activeFilterCount > 0 ? `of ${displayedEmployees.length} in ${monthLabel}` : monthLabel}
              icon={Users}
              tone="blue"
            />
            <HrKpiCard
              label="Gross salary"
              value={isBusy ? '—' : <SensitiveMoney value={totals.gross} canView={canViewSalary} />}
              hint="Sum of gross pay shown"
              icon={Wallet}
              tone="indigo"
            />
            <HrKpiCard
              label="Total deductions"
              value={isBusy ? '—' : <SensitiveMoney value={totals.deductions} canView={canViewSalary} />}
              hint="All DEDUCT components"
              icon={TrendingDown}
              tone="rose"
            />
            <HrKpiCard
              label="Net payable"
              value={isBusy ? '—' : <SensitiveMoney value={totals.net} canView={canViewSalary} />}
              hint="Gross less deductions"
              icon={IndianRupee}
              tone="emerald"
            />
          </div>

          {/* ── Filters: one card, collapsed on a phone, three columns at most ── */}
          <HrFilterCard
            summary={
              activeFilterCount > 0
                ? `${activeFilterCount} filter(s) active · ${filteredEmployees.length} of ${displayedEmployees.length} shown`
                : `${displayedEmployees.length} salary record(s) for ${monthLabel}`
            }
            actions={
              activeFilterCount > 0 ? (
                <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={clearFilters}>
                  <X className="h-3.5 w-3.5" />
                  Clear
                </Button>
              ) : undefined
            }
          >
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              <div className="relative sm:col-span-2 lg:col-span-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search by ID or name…"
                  value={filters.searchTerm}
                  onChange={(e) => handleFilterChange('searchTerm', e.target.value)}
                  className="pl-9"
                />
              </div>
              <Select value={filters.projectName} onValueChange={(value) => handleFilterChange('projectName', value)}>
                <SelectTrigger><SelectValue placeholder="All Projects" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Projects</SelectItem>
                  {filterOptions['Project Name'].map(opt => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={filters.location} onValueChange={(value) => handleFilterChange('location', value)}>
                <SelectTrigger><SelectValue placeholder="All Locations" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Locations</SelectItem>
                  {filterOptions['Location'].map(opt => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={filters.employeeType} onValueChange={(value) => handleFilterChange('employeeType', value)}>
                <SelectTrigger><SelectValue placeholder="All Types" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  {filterOptions['EMPLOYEE TYPE'].map(opt => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={filters.designation} onValueChange={(value) => handleFilterChange('designation', value)}>
                <SelectTrigger><SelectValue placeholder="All Designations" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Designations</SelectItem>
                  {filterOptions['Designation'].map(opt => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={filters.department} onValueChange={(value) => handleFilterChange('department', value)}>
                <SelectTrigger><SelectValue placeholder="All Departments" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Departments</SelectItem>
                  {filterOptions['Department'].map(opt => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </HrFilterCard>

          {isBusy ? (
            <HrLoader label={isSyncing ? `Syncing ${monthLabel} from greytHR…` : `Loading salary for ${monthLabel}…`} />
          ) : filteredEmployees.length === 0 ? (
            displayedEmployees.length > 0 ? (
              <HrEmptyState
                icon={Search}
                title="No employees match these filters"
                description={`${displayedEmployees.length} salary record(s) exist for ${monthLabel}, but none match what you have selected.`}
                action={
                  <Button variant="outline" size="sm" onClick={clearFilters}>
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <HrEmptyState
                icon={IndianRupee}
                title={`${monthLabel} has not been synced yet`}
                description={
                  canSync
                    ? `No salary records are stored for ${monthLabel}. Press Sync Salary above to fetch them from greytHR — a month usually has nothing until its payroll has been processed and synced.`
                    : `No salary records are stored for ${monthLabel}. A month holds nothing until it has been synced from greytHR; ask someone with sync permission to run it, or pick an earlier month.`
                }
                action={canSync ? syncButton : undefined}
              />
            )
          ) : (
            <Card className="bg-white/80 backdrop-blur-sm">
              <CardContent className="p-0">
                <div className="max-h-[62vh] overflow-auto">
                  <table className="w-full min-w-[1000px] text-sm">
                    <thead className="sticky top-0 z-10">
                      <tr className="border-b bg-slate-100">
                        <th className="whitespace-nowrap px-4 py-2.5 text-left font-medium">Employee ID</th>
                        <th className="px-4 py-2.5 text-left font-medium">Name</th>
                        {dynamicColumns.map(col => (
                          <th key={col} className="px-4 py-2.5 text-left font-medium">{col}</th>
                        ))}
                        <th className="whitespace-nowrap px-4 py-2.5 text-right font-medium">Gross Salary</th>
                        <th className="whitespace-nowrap px-4 py-2.5 text-right font-medium">Total Deductions</th>
                        <th className="whitespace-nowrap px-4 py-2.5 text-right font-medium">Net Salary</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredEmployees.map(emp => (
                        // Clickable only for 63.12 holders — the breakdown behind the click is the
                        // very data the masked cells withhold.
                        <tr
                          key={emp.employeeId}
                          className={cn('border-b transition-colors hover:bg-muted/20', canViewSalary && 'cursor-pointer')}
                          onClick={canViewSalary ? () => setPayslipFor(emp) : undefined}
                        >
                          <td className="whitespace-nowrap px-4 py-2.5">{emp.employeeNo || emp.employeeId}</td>
                          <td className="max-w-[180px] truncate px-4 py-2.5 font-medium text-slate-800">{emp.name}</td>
                          {dynamicColumns.map(col => (
                            <td key={col} className="max-w-[150px] truncate px-4 py-2.5">
                              {emp.positions?.[col] || '—'}
                            </td>
                          ))}
                          <td className="whitespace-nowrap px-4 py-2.5 text-right">
                            <MoneyCell value={emp.grossSalary} canView={canViewSalary} />
                          </td>
                          <td className="whitespace-nowrap px-4 py-2.5 text-right text-rose-700">
                            <MoneyCell value={getSalaryComponentValue(emp.salaryDetails, 'TOTAL DEDUCTIONS')} canView={canViewSalary} />
                          </td>
                          <td className="whitespace-nowrap px-4 py-2.5 text-right font-medium">
                            <MoneyCell value={emp.netSalary} canView={canViewSalary} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-muted/30 font-semibold">
                        <td className="px-4 py-2.5" colSpan={2 + dynamicColumns.length}>
                          Total · {filteredEmployees.length} employee{filteredEmployees.length === 1 ? '' : 's'}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-right">
                          <SensitiveMoney value={totals.gross} canView={canViewSalary} exact />
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-right text-rose-700">
                          <SensitiveMoney value={totals.deductions} canView={canViewSalary} exact />
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-right text-emerald-700">
                          <SensitiveMoney value={totals.net} canView={canViewSalary} exact />
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {!isBusy && filteredEmployees.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Showing <span className="font-medium text-slate-700">{filteredEmployees.length}</span>
              {activeFilterCount > 0 ? <> of {displayedEmployees.length}</> : null} salary record
              {filteredEmployees.length === 1 ? '' : 's'} for {monthLabel}
            </p>
          )}
        </div>
      )}

      {/* ── Payslip breakdown ── */}
      {/*
        Not rendered at all without the 63.12 permission — the rows are not clickable then either, so
        there is no trigger pointing at a dialog full of masked figures.
      */}
      {canViewSalary && (
        <Dialog open={!!payslipFor} onOpenChange={(open) => !open && setPayslipFor(null)}>
          <DialogContent className={hrDialog.content}>
            <DialogHeader className={hrDialog.header}>
              <DialogTitle>Payslip breakdown</DialogTitle>
              <DialogDescription>
                {payslipFor?.name} · {payslipFor?.employeeNo || payslipFor?.employeeId} · {monthLabel}
              </DialogDescription>
            </DialogHeader>
            {payslipFor && (
              <div className={hrDialog.body}>
                {(payslipFor.salaryDetails?.length ?? 0) === 0 ? (
                  <p className="py-4 text-center text-sm text-muted-foreground">
                    No component breakdown was synced for this employee — only the totals below.
                  </p>
                ) : (
                  <>
                    <PayslipSection
                      title="Earnings"
                      items={(payslipFor.salaryDetails ?? []).filter(d => d.type === 'INCOME')}
                      canView={canViewSalary}
                    />
                    <PayslipSection
                      title="Deductions"
                      items={(payslipFor.salaryDetails ?? []).filter(d => d.type === 'DEDUCT')}
                      canView={canViewSalary}
                      amountClassName="text-rose-700"
                    />
                    <PayslipSection
                      title="Other components"
                      items={(payslipFor.salaryDetails ?? []).filter(d => d.type !== 'INCOME' && d.type !== 'DEDUCT')}
                      canView={canViewSalary}
                    />
                  </>
                )}
                <div className="space-y-1 rounded-lg bg-slate-50 px-3 py-2 text-xs">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-slate-600">Gross salary</span>
                    <MoneyCell value={payslipFor.grossSalary} canView={canViewSalary} />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-slate-600">Total deductions</span>
                    <span className="text-rose-700">
                      <MoneyCell
                        value={getSalaryComponentValue(payslipFor.salaryDetails, 'TOTAL DEDUCTIONS')}
                        canView={canViewSalary}
                      />
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3 border-t border-slate-200 pt-1 font-semibold">
                    <span className="text-slate-700">Net salary</span>
                    <span className="text-emerald-700">
                      <MoneyCell value={payslipFor.netSalary} canView={canViewSalary} />
                    </span>
                  </div>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
