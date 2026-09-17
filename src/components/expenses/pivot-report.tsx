'use client';

/**
 * The custom pivot, lifted out of the reports page so the report centre can offer it alongside the
 * fixed reports in the catalogue.
 *
 * Rows come in already filtered and enriched — the centre owns the scope and date controls, so the
 * pivot no longer fetches, no longer gates on permission, and no longer carries a date picker of
 * its own that could disagree with the one above it. What stayed is the pivot itself: the row and
 * column dimension pickers, the measure, the nested grouping and the saved layout.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Settings2, Table as TableIcon } from 'lucide-react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { PivotConfig } from '@/lib/types';
import { monthKeyOf, type EnrichedExpense as ReportExpense } from '@/lib/expenses-reports';
import { cn } from '@/lib/utils';

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

/** The pivot indexes rows by field name, so the month bucket has to be a field on the row. */
interface EnrichedExpense extends ReportExpense {
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

export function PivotReport({ expenses, isLoading }: { expenses: ReportExpense[]; isLoading?: boolean }) {
  const { user } = useAuth();
  const settingsKey = 'expenses_reports_pivot';
  const isInitialMount = useRef(true);

  const [pivotConfig, setPivotConfig] = useState<PivotConfig>({
    rows: ['projectName'],
    columns: ['month'],
    value: 'amount',
  });

  const filteredExpenses: EnrichedExpense[] = useMemo(
    () => expenses.map((row) => ({ ...row, month: monthKeyOf(row.createdAt) })),
    [expenses],
  );

  useEffect(() => {
    if (!user) return;
    const fetchSettings = async () => {
      const settingsRef = doc(db, 'userSettings', user.id);
      const settingsSnap = await getDoc(settingsRef);
      if (settingsSnap.exists()) {
        const saved = settingsSnap.data()?.pivotPreferences?.[settingsKey];
        if (saved) setPivotConfig(saved);
      }
    };
    void fetchSettings();
  }, [user]);

  const savePivotConfig = async (config: PivotConfig) => {
    if (!user) return;
    try {
      await setDoc(
        doc(db, 'userSettings', user.id),
        { pivotPreferences: { [settingsKey]: config } },
        { merge: true },
      );
    } catch (error) {
      console.error('Failed to save pivot config:', error);
    }
  };

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
    } else {
      void savePivotConfig(pivotConfig);
    }
  }, [pivotConfig]);

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
    <div className="space-y-4">
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

          {/* No date picker here — the report centre above owns scope and period for every
              report, and a second one on this card could only ever disagree with it. */}
        </CardContent>
      </Card>

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
