


'use client';

import { useState, useEffect, useMemo, useRef, type ReactNode } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, ShieldAlert, Calendar as CalendarIcon, Table as TableIcon,
  BarChart3, Settings2, Hash, IndianRupee,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, doc, setDoc, getDoc } from 'firebase/firestore';
import type { ExpenseRequest, Project, Department, UserSettings, PivotConfig } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { DateRange } from 'react-day-picker';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/label';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/components/auth/AuthProvider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';


const pivotOptions = [
  { value: 'projectName', label: 'Project' },
  { value: 'departmentName', label: 'Department' },
  { value: 'headOfAccount', label: 'Head of Account' },
  { value: 'subHeadOfAccount', label: 'Sub-Head of Account' },
];

const valueOptions = [
  { value: 'amount', label: 'Total Amount' },
  { value: 'count', label: 'Number of Requests' },
];

interface EnrichedExpense extends ExpenseRequest {
  projectName: string;
  departmentName: string;
  month: string;
}

interface PivotRow {
  type: 'data' | 'total';
  level: number;
  label: string;
  path: string[];
  isExpanded?: boolean;
  subRows?: PivotRow[];
  data: Record<string, number | string>;
}


export default function ExpenseReportsPage() {
  const { toast } = useToast();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { user } = useAuth();
  const settingsKey = 'expenses_reports_pivot';
  const isInitialMount = useRef(true);

  const [allExpenses, setAllExpenses] = useState<EnrichedExpense[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [filters, setFilters] = useState({
    dateRange: {
      from: startOfMonth(new Date()),
      to: endOfMonth(new Date()),
    } as DateRange | undefined,
  });

  const [pivotConfig, setPivotConfig] = useState<PivotConfig>({
    rows: ['projectName'],
    columns: ['month'],
    value: 'amount',
  });

  const canViewPage = can('View', 'Expenses.Reports');

  useEffect(() => {
    if (!user || isAuthLoading) return;
    const fetchSettings = async () => {
      const settingsRef = doc(db, 'userSettings', user.id);
      const settingsSnap = await getDoc(settingsRef);
      if (settingsSnap.exists()) {
        const settings = settingsSnap.data() as UserSettings;
        if (settings.pivotPreferences?.[settingsKey]) {
          setPivotConfig(settings.pivotPreferences[settingsKey]);
        }
      }
    };
    fetchSettings();
  }, [user, isAuthLoading]);

  const savePivotConfig = async (config: PivotConfig) => {
    if (!user) return;
    try {
      const settingsRef = doc(db, 'userSettings', user.id);
      await setDoc(settingsRef, { pivotPreferences: { [settingsKey]: config } }, { merge: true });
    } catch (e) {
      console.error('Failed to save pivot config:', e);
    }
  };

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
    } else {
      savePivotConfig(pivotConfig);
    }
  }, [pivotConfig]);

  useEffect(() => {
    if (isAuthLoading) return;
    if (!canViewPage) { setIsLoading(false); return; }

    const fetchInitialData = async () => {
      setIsLoading(true);
      try {
        const [expensesSnap, projectsSnap, deptsSnap] = await Promise.all([
          getDocs(collection(db, 'expenseRequests')),
          getDocs(collection(db, 'projects')),
          getDocs(collection(db, 'departments')),
        ]);

        const projectsMap = new Map(projectsSnap.docs.map(doc => [doc.id, (doc.data() as Project).projectName]));
        const deptsMap = new Map(deptsSnap.docs.map(doc => [doc.id, (doc.data() as Department).name]));

        const enrichedExpenses = expensesSnap.docs.map(doc => {
          const data = doc.data() as ExpenseRequest;
          return {
            ...data,
            projectName: projectsMap.get(data.projectId) || 'Unknown Project',
            departmentName: deptsMap.get(data.departmentId) || 'Unknown Department',
            month: format(new Date(data.createdAt), 'yyyy-MM'),
          } as EnrichedExpense;
        });

        setAllExpenses(enrichedExpenses);
      } catch (error) {
        console.error('Error fetching initial data:', error);
        toast({ title: 'Error', description: 'Failed to fetch initial data.', variant: 'destructive' });
      }
      setIsLoading(false);
    };

    fetchInitialData();
  }, [isAuthLoading, canViewPage, toast]);

  const filteredExpenses = useMemo(() => {
    if (isLoading) return [];
    return allExpenses.filter(exp => {
      const expDate = new Date(exp.createdAt);
      const isDateMatch = filters.dateRange?.from && filters.dateRange?.to
        ? expDate >= filters.dateRange.from && expDate <= filters.dateRange.to
        : true;
      return isDateMatch;
    });
  }, [filters, allExpenses, isLoading]);

  const pivotData = useMemo(() => {
    const { rows: rowFields, columns: colFields, value: valueField } = pivotConfig;

    if (filteredExpenses.length === 0) {
      return { rows: [], columns: [], grandTotalRow: {}, grandTotal: 0, columnHierarchy: [] };
    }

    const getColumnHierarchy = (data: EnrichedExpense[], fields: string[]): any[] => {
      if (!fields || fields.length === 0) return [];
      const field = fields[0];
      const uniqueValues = Array.from(new Set(data.map(item => String(item[field as keyof EnrichedExpense] || 'N/A')))).sort();
      return uniqueValues.map(value => {
        const filtered = data.filter(item => String(item[field as keyof EnrichedExpense] || 'N/A') === value);
        return { key: value, subColumns: getColumnHierarchy(filtered, fields.slice(1)) };
      });
    };

    const finalFlattenedCols = (cols: any[], path: string[] = []): { key: string; path: string[] }[] => {
      let result: { key: string; path: string[] }[] = [];
      cols.forEach(col => {
        const newPath = [...path, col.key];
        if (col.subColumns && col.subColumns.length > 0) {
          result.push(...finalFlattenedCols(col.subColumns, newPath));
        } else {
          result.push({ key: col.key, path: newPath });
        }
      });
      return result;
    };

    const columnHierarchy = getColumnHierarchy(filteredExpenses, colFields);
    const flatCols = colFields.length > 0 ? finalFlattenedCols(columnHierarchy) : [{ key: 'Grand Total', path: [] }];

    const groupData = (data: EnrichedExpense[], level: number, path: string[] = []): PivotRow[] => {
      if (level >= rowFields.length) return [];
      const rowField = rowFields[level];
      const grouped = new Map<string, EnrichedExpense[]>();
      data.forEach(item => {
        const key = String(item[rowField as keyof EnrichedExpense] || 'N/A');
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key)!.push(item);
      });

      return Array.from(grouped.keys()).sort().map(key => {
        const items = grouped.get(key)!;
        const newPath = [...path, key];
        const rowData: Record<string, number> = {};
        let rowTotal = 0;
        flatCols.forEach(col => {
          const colKey = col.path.join('_');
          const filteredItems = items.filter(item => col.path.every((p, i) => String(item[colFields[i] as keyof EnrichedExpense]) === p));
          const cellValue = filteredItems.reduce((acc, curr) => acc + (valueField === 'amount' ? curr.amount : 1), 0);
          rowData[colKey] = cellValue;
          rowTotal += cellValue;
        });
        rowData['__rowTotal'] = rowTotal;
        const subRows = groupData(items, level + 1, newPath);
        return { type: 'data', level, label: key, data: rowData, subRows: subRows.length > 0 ? subRows : undefined, path: newPath };
      });
    };

    const finalRows: PivotRow[] = rowFields.length > 0 ? groupData(filteredExpenses, 0) : [];
    const grandTotalRow: Record<string, number> = {};
    flatCols.forEach(col => {
      const colKey = col.path.join('_');
      const filteredForCol = filteredExpenses.filter(item => col.path.every((p, i) => String(item[colFields[i] as keyof EnrichedExpense]) === p));
      grandTotalRow[colKey] = filteredForCol.reduce((acc, curr) => acc + (valueField === 'amount' ? curr.amount : 1), 0);
    });
    const grandTotal = filteredExpenses.reduce((acc, curr) => acc + (valueField === 'amount' ? curr.amount : 1), 0);
    grandTotalRow['__grandTotal'] = grandTotal;

    return { rows: finalRows, columns: flatCols, grandTotalRow, grandTotal, columnHierarchy };
  }, [filteredExpenses, pivotConfig]);

  const handleRowConfigChange = (field: string) => {
    setPivotConfig(prev => ({
      ...prev,
      rows: prev.rows.includes(field) ? prev.rows.filter(r => r !== field) : [...prev.rows, field],
    }));
  };

  const handleColConfigChange = (field: string) => {
    setPivotConfig(prev => ({
      ...prev,
      columns: prev.columns.includes(field) ? prev.columns.filter(c => c !== field) : [...prev.columns, field],
    }));
  };

  const formatValue = (val: number) =>
    pivotConfig.value === 'amount'
      ? val.toLocaleString('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0 })
      : val.toLocaleString();

  if (isAuthLoading) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8 space-y-4">
        <Skeleton className="h-10 w-80" />
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }

  if (!canViewPage) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center gap-2">
          <Link href="/expenses"><Button variant="ghost" size="icon"><ArrowLeft className="h-5 w-5" /></Button></Link>
          <h1 className="text-xl font-bold">Expense Reports</h1>
        </div>
        <Card className="border-destructive/30">
          <CardHeader className="text-center pb-2">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
              <ShieldAlert className="h-7 w-7 text-destructive" />
            </div>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>You do not have permission to view reports.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const renderRows = (rows: PivotRow[]): ReactNode[] => {
    return rows.flatMap((row) => {
      const uniqueKey = row.path.join('-');
      const rowElement = (
        <TableRow
          key={uniqueKey}
          className={cn(
            row.level === 0 ? 'bg-muted/40 font-semibold' : 'hover:bg-muted/20',
            'transition-colors duration-150'
          )}
        >
          <TableCell style={{ paddingLeft: `${(row.level * 1.5) + 1}rem` }} className="whitespace-nowrap">
            {row.label}
          </TableCell>
          {pivotData.columns.length > 0 && pivotData.columns.map(col => (
            <TableCell key={col.path.join('_')} className="text-right tabular-nums">
              {formatValue(Number(row.data[col.path.join('_')] || 0))}
            </TableCell>
          ))}
          {pivotData.columns.length > 1 && (
            <TableCell className="text-right font-bold tabular-nums text-primary">
              {formatValue(Number(row.data.__rowTotal || 0))}
            </TableCell>
          )}
        </TableRow>
      );
      const subRowElements = row.subRows ? renderRows(row.subRows) : [];
      return [rowElement, ...subRowElements];
    });
  };

  const renderColumnHeaders = () => {
    if (pivotConfig.columns.length === 0) {
      return (
        <TableRow className="bg-muted/40">
          <TableHead>{pivotConfig.rows.join(' / ') || 'Summary'}</TableHead>
          <TableHead className="text-right">Grand Total</TableHead>
        </TableRow>
      );
    }
    const maxDepth = pivotConfig.columns.length;
    const headerRows: ReactNode[] = [];
    for (let i = 0; i < maxDepth; i++) {
      let cells: { key: string; label: string; colspan: number }[] = [];
      const processLevel = (cols: any[], level: number) => {
        cols.forEach(col => {
          if (level === i) {
            const subLeafCount = (c: any): number => {
              if (!c.subColumns || c.subColumns.length === 0) return 1;
              return c.subColumns.reduce((sum: number, sc: any) => sum + subLeafCount(sc), 0);
            };
            cells.push({ key: col.key, label: col.key, colspan: subLeafCount(col) });
          } else if (level < i && col.subColumns) {
            processLevel(col.subColumns, level + 1);
          }
        });
      };
      processLevel(pivotData.columnHierarchy, 0);
      headerRows.push(
        <TableRow key={`header-row-${i}`} className="bg-muted/40">
          {i === 0 && (
            <TableHead rowSpan={maxDepth} className="align-bottom font-bold text-xs uppercase tracking-wide">
              {pivotConfig.rows.join(' / ') || 'Summary'}
            </TableHead>
          )}
          {cells.map(c => (
            <TableHead key={c.key} colSpan={c.colspan} className="text-center border-l text-xs font-semibold">
              {c.label}
            </TableHead>
          ))}
          {i === 0 && pivotData.columns.length > 1 && (
            <TableHead rowSpan={maxDepth} className="text-right align-bottom border-l font-bold text-primary text-xs uppercase tracking-wide">
              Row Total
            </TableHead>
          )}
        </TableRow>
      );
    }
    return headerRows;
  };

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/expenses">
          <Button variant="ghost" size="icon" className="h-9 w-9"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <div>
          <div className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" />
            <h1 className="text-xl font-bold tracking-tight">Expense Pivot Report</h1>
          </div>
          <p className="text-xs text-muted-foreground">Analyze expense data with customizable dimensions</p>
        </div>
      </div>

      {/* Config Card */}
      <Card className="border-border/60 bg-card/60 backdrop-blur-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Settings2 className="h-4 w-4 text-muted-foreground" />
            Report Configuration
          </CardTitle>
          <CardDescription className="text-xs">Choose dimensions and date range to configure the pivot table.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Rows</Label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="w-full justify-between h-9 text-sm">
                  <span>{pivotConfig.rows.length > 0 ? `${pivotConfig.rows.length} selected` : 'Select Rows'}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56">
                <DropdownMenuLabel>Group Rows By</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {pivotOptions.map(opt => (
                  <DropdownMenuCheckboxItem
                    key={opt.value}
                    checked={pivotConfig.rows.includes(opt.value)}
                    onCheckedChange={() => handleRowConfigChange(opt.value)}
                    onSelect={e => e.preventDefault()}
                  >
                    {opt.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Columns</Label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="w-full justify-between h-9 text-sm">
                  <span>{pivotConfig.columns.length > 0 ? `${pivotConfig.columns.length} selected` : 'Select Columns'}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56">
                <DropdownMenuLabel>Group Columns By</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {[...pivotOptions, { value: 'month', label: 'Month' }].map(opt => (
                  <DropdownMenuCheckboxItem
                    key={opt.value}
                    checked={pivotConfig.columns.includes(opt.value)}
                    onCheckedChange={() => handleColConfigChange(opt.value)}
                    onSelect={e => e.preventDefault()}
                  >
                    {opt.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Values (Measure)</Label>
            <Select value={pivotConfig.value} onValueChange={value => setPivotConfig(prev => ({ ...prev, value }))}>
              <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {valueOptions.map(opt => <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Date Range</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn('w-full justify-start text-left font-normal h-9 text-sm', !filters.dateRange && 'text-muted-foreground')}
                >
                  <CalendarIcon className="mr-2 h-3.5 w-3.5" />
                  {filters.dateRange?.from
                    ? filters.dateRange.to
                      ? <>{format(filters.dateRange.from, 'LLL dd, y')} – {format(filters.dateRange.to, 'LLL dd, y')}</>
                      : format(filters.dateRange.from, 'LLL dd, y')
                    : <span>Pick a date</span>}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  initialFocus
                  mode="range"
                  defaultMonth={filters.dateRange?.from}
                  selected={filters.dateRange}
                  onSelect={range => setFilters(prev => ({ ...prev, dateRange: range }))}
                  numberOfMonths={2}
                />
              </PopoverContent>
            </Popover>
          </div>
        </CardContent>
      </Card>

      {/* Grand Total Summary strip */}
      <div className="flex gap-3 flex-wrap">
        <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-lg border border-emerald-500/20 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400">
          <IndianRupee className="h-4 w-4 flex-shrink-0" />
          <div>
            <span className="text-xs text-muted-foreground block leading-tight">Grand Total</span>
            <span className="font-bold leading-tight">{formatValue(pivotData.grandTotal)}</span>
          </div>
        </div>
        <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-lg border border-blue-500/20 bg-blue-500/5 text-blue-600 dark:text-blue-400">
          <Hash className="h-4 w-4 flex-shrink-0" />
          <div>
            <span className="text-xs text-muted-foreground block leading-tight">Matching Records</span>
            <span className="font-bold leading-tight">{filteredExpenses.length}</span>
          </div>
        </div>
      </div>

      {/* Pivot Table */}
      {pivotConfig.rows.length === 0 && pivotConfig.columns.length === 0 ? (
        <Card className="border-border/60 bg-card/60 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm"><TableIcon className="h-4 w-4 text-muted-foreground" />Grand Total</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-primary">{formatValue(pivotData.grandTotal)}</p>
            <p className="text-xs text-muted-foreground mt-1">Select at least one row or column dimension to see the pivot breakdown above.</p>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-border/60 bg-card/60 backdrop-blur-sm overflow-hidden">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <TableIcon className="h-4 w-4 text-muted-foreground" />
              Pivot Summary
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-6"><Skeleton className="h-80 w-full" /></div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    {renderColumnHeaders()}
                  </TableHeader>
                  <TableBody>
                    {pivotData.rows.length > 0 ? (
                      renderRows(pivotData.rows)
                    ) : (
                      <TableRow>
                        <TableCell colSpan={(pivotData.columns.length || 1) + 2} className="h-24 text-center text-muted-foreground">
                          Select at least one field for rows.
                        </TableCell>
                      </TableRow>
                    )}

                    {/* Grand Total Row */}
                    <TableRow className="bg-primary/5 border-t-2 border-primary/20 font-bold">
                      <TableCell className="text-primary font-bold">Grand Total</TableCell>
                      {pivotData.columns.map(col => {
                        const colKey = col.path.join('_');
                        return (
                          <TableCell key={`total-${colKey}`} className="text-right tabular-nums text-primary font-bold">
                            {formatValue(Number(pivotData.grandTotalRow[colKey] || 0))}
                          </TableCell>
                        );
                      })}
                      {pivotData.columns.length > 1 && (
                        <TableCell className="text-right text-primary font-bold tabular-nums">
                          {formatValue(pivotData.grandTotal)}
                        </TableCell>
                      )}
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
