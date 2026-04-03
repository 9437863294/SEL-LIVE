


'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import Link from 'next/link';
import {
  ArrowLeft, Plus, View, ArrowUp, ArrowDown, Shuffle, ShieldAlert,
  Search, FileText, IndianRupee, Building2, TrendingUp, Filter,
  Receipt, Layers,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { db } from '@/lib/firebase';
import { doc, getDoc, collection, getDocs, setDoc } from 'firebase/firestore';
import type { Department, ExpenseRequest, Project, UserSettings } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
  DialogDescription,
} from '@/components/ui/dialog';
import { format } from 'date-fns';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';


const baseTableHeaders = [
  'Request No',
  'Timestamp',
  'Department',
  'Project Name',
  'Amount',
  'Head of A/c',
  'Sub-Head of A/c',
  'Remarks',
  'Description',
  'Name of the party',
  'Reception No',
  'Reception Date',
];

export default function AllExpensesPage() {
  const { toast } = useToast();
  const { user, loading: isAuthLoading } = useAuth();
  const { can } = useAuthorization();
  const settingsKey = `expenses_all`;

  const isInitialMount = useRef(true);
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedPrefsRef = useRef<string>('');
  const loadedPrefRef = useRef<any>(null);
  const latestPrefsRef = useRef<{ order: string[]; visibility: Record<string, boolean> } | null>(null);

  const [projects, setProjects] = useState<Project[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSequenceDialogOpen, setIsSequenceDialogOpen] = useState(false);

  const [columnOrder, setColumnOrder] = useState<string[]>(baseTableHeaders);
  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>(
    baseTableHeaders.reduce((acc, header) => ({ ...acc, [header]: true }), {})
  );

  const [filters, setFilters] = useState({
    requestNo: '',
    projectName: 'all',
    departmentName: 'all',
    partyName: '',
  });

  const canViewPage = can('View All', 'Expenses.Expense Requests');

  const handleFilterChange = (field: keyof typeof filters, value: string) => {
    setFilters(prev => ({ ...prev, [field]: value }));
  };

  const filteredExpenses = useMemo(() => {
    return expenses.filter(exp => {
      const project = projects.find(p => p.id === exp.projectId);
      return (
        (filters.requestNo === '' || exp.requestNo.toLowerCase().includes(filters.requestNo.toLowerCase())) &&
        (filters.partyName === '' || exp.partyName.toLowerCase().includes(filters.partyName.toLowerCase())) &&
        (filters.projectName === 'all' || project?.projectName === filters.projectName) &&
        (filters.departmentName === 'all' || exp.generatedByDepartment === filters.departmentName)
      );
    });
  }, [expenses, filters, projects]);

  const totalAmount = useMemo(() =>
    filteredExpenses.reduce((sum, e) => sum + (e.amount || 0), 0),
    [filteredExpenses]
  );

  const uniqueDepts = useMemo(() =>
    new Set(filteredExpenses.map(e => e.departmentId)).size,
    [filteredExpenses]
  );

  useEffect(() => {
    if (!user || isAuthLoading) return;
    const fetchSettings = async () => {
      const settingsRef = doc(db, 'userSettings', user.id);
      const settingsSnap = await getDoc(settingsRef);
      if (settingsSnap.exists()) {
        const settings = settingsSnap.data() as UserSettings;
        const pageSettings = settings.columnPreferences?.[settingsKey];
        if (pageSettings) {
          loadedPrefRef.current = pageSettings;
          const mergedVisibility = {
            ...baseTableHeaders.reduce((acc, h) => ({ ...acc, [h]: true }), {}),
            ...pageSettings.visibility,
          };
          const mergedOrder = [
            ...pageSettings.order,
            ...baseTableHeaders.filter(h => !pageSettings.order.includes(h)),
          ];
          lastSavedPrefsRef.current = JSON.stringify({ order: mergedOrder, visibility: mergedVisibility });
          setColumnVisibility(mergedVisibility);
          setColumnOrder(mergedOrder);
        }
      }
    };
    fetchSettings();
  }, [user, settingsKey, isAuthLoading]);

  const saveColumnSettings = async (order: string[], visibility: Record<string, boolean>) => {
    if (!user) return;
    try {
      const settingsRef = doc(db, 'userSettings', user.id);
      const existing = loadedPrefRef.current ?? {};
      const payload = { ...existing, order, visibility };
      await setDoc(settingsRef, { columnPreferences: { [settingsKey]: payload } }, { mergeFields: [`columnPreferences.${settingsKey}`] });
      loadedPrefRef.current = payload;
    } catch (e) {
      console.error('Failed to save column settings to Firestore', e);
      toast({ title: 'Error', description: 'Could not save your column preferences.', variant: 'destructive' });
    }
  };

  useEffect(() => {
    latestPrefsRef.current = { order: columnOrder, visibility: columnVisibility };
  }, [columnOrder, columnVisibility]);

  useEffect(() => {
    if (isInitialMount.current) { isInitialMount.current = false; return; }
    if (!user) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const prefs = { order: columnOrder, visibility: columnVisibility };
      const key = JSON.stringify(prefs);
      saveTimerRef.current = null;
      if (key === lastSavedPrefsRef.current) return;
      lastSavedPrefsRef.current = key;
      void saveColumnSettings(columnOrder, columnVisibility);
    }, 700);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [columnOrder, columnVisibility, user]);

  useEffect(() => {
    return () => {
      if (!user || !saveTimerRef.current) return;
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      const prefs = latestPrefsRef.current;
      if (!prefs) return;
      const key = JSON.stringify(prefs);
      if (key === lastSavedPrefsRef.current) return;
      lastSavedPrefsRef.current = key;
      void saveColumnSettings(prefs.order, prefs.visibility);
    };
  }, [user]);

  useEffect(() => {
    if (isAuthLoading) return;
    if (!canViewPage) { setIsLoading(false); return; }

    const fetchData = async () => {
      setIsLoading(true);
      try {
        const [projectsSnap, expensesSnap, deptsSnap] = await Promise.all([
          getDocs(collection(db, 'projects')),
          getDocs(collection(db, 'expenseRequests')),
          getDocs(collection(db, 'departments')),
        ]);
        setProjects(projectsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project)));
        setDepartments(deptsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Department)));
        const fetchedExpenses = expensesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as ExpenseRequest));
        fetchedExpenses.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        setExpenses(fetchedExpenses);
      } catch (error: any) {
        console.error('Error fetching data:', error);
        toast({ title: 'Error', description: 'Failed to fetch consolidated expenses.', variant: 'destructive' });
      }
      setIsLoading(false);
    };
    fetchData();
  }, [toast, isAuthLoading, canViewPage]);

  const getProjectName = (projectId: string) =>
    projects.find(p => p.id === projectId)?.projectName || 'Unknown Project';

  const visibleHeaders = columnOrder.filter(header => columnVisibility[header]);

  const moveColumn = (index: number, direction: 'up' | 'down') => {
    const newOrder = [...columnOrder];
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex >= 0 && newIndex < newOrder.length) {
      [newOrder[index], newOrder[newIndex]] = [newOrder[newIndex], newOrder[index]];
      setColumnOrder(newOrder);
    }
  };

  const getCellContent = (header: string, expense: ExpenseRequest) => {
    const formatCurrency = (amount: number) =>
      new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 }).format(amount);

    switch (header) {
      case 'Request No': return expense.requestNo;
      case 'Timestamp': return expense.createdAt ? format(new Date(expense.createdAt), 'dd MMM yyyy, HH:mm') : 'N/A';
      case 'Department': return expense.generatedByDepartment;
      case 'Project Name': return getProjectName(expense.projectId);
      case 'Amount':
        return (
          <span className="font-semibold text-emerald-600 dark:text-emerald-400">
            {formatCurrency(expense.amount || 0)}
          </span>
        );
      case 'Head of A/c': return expense.headOfAccount;
      case 'Sub-Head of A/c': return expense.subHeadOfAccount;
      case 'Remarks': return expense.remarks;
      case 'Description':
        return (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger>
                <p className="truncate max-w-[200px]">{expense.description}</p>
              </TooltipTrigger>
              <TooltipContent><p className="max-w-md">{expense.description}</p></TooltipContent>
            </Tooltip>
          </TooltipProvider>
        );
      case 'Name of the party': return expense.partyName;
      case 'Reception No': return expense.receptionNo || 'N/A';
      case 'Reception Date': return expense.receptionDate ? format(new Date(expense.receptionDate), 'dd MMM, yyyy') : 'N/A';
      default: return '';
    }
  };

  if (isLoading || isAuthLoading) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2"><Skeleton className="h-9 w-9" /><Skeleton className="h-8 w-56" /></div>
          <Skeleton className="h-9 w-36" />
        </div>
        <div className="flex gap-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 flex-1 rounded-lg" />)}
        </div>
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }

  if (!canViewPage) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center gap-2">
          <Link href="/expenses"><Button variant="ghost" size="icon"><ArrowLeft className="h-5 w-5" /></Button></Link>
          <h1 className="text-xl font-bold">Consolidated Expenses</h1>
        </div>
        <Card className="border-destructive/30">
          <CardHeader className="text-center pb-2">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
              <ShieldAlert className="h-7 w-7 text-destructive" />
            </div>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>You do not have permission to view this page.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Link href="/expenses">
            <Button variant="ghost" size="icon" className="h-9 w-9"><ArrowLeft className="h-4 w-4" /></Button>
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <Layers className="h-5 w-5 text-primary" />
              <h1 className="text-xl font-bold tracking-tight">Consolidated Expenses</h1>
            </div>
            <p className="text-xs text-muted-foreground">All departments combined view</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Dialog open={isSequenceDialogOpen} onOpenChange={setIsSequenceDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2"><Shuffle className="h-3.5 w-3.5" /> Reorder</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Edit Column Sequence</DialogTitle>
                <DialogDescription>Use the arrows to reorder columns.</DialogDescription>
              </DialogHeader>
              <div className="py-4 space-y-2">
                {columnOrder.map((header, index) => (
                  <div key={header} className="flex items-center justify-between p-2.5 border rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors">
                    <span className="text-sm font-medium">
                      <span className="text-muted-foreground mr-2 text-xs">{index + 1}.</span>{header}
                    </span>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" disabled={index === 0} onClick={() => moveColumn(index, 'up')}>
                        <ArrowUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" disabled={index === columnOrder.length - 1} onClick={() => moveColumn(index, 'down')}>
                        <ArrowDown className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
              <DialogFooter>
                <DialogClose asChild><Button>Done</Button></DialogClose>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2"><View className="h-3.5 w-3.5" /> Columns</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {baseTableHeaders.map(header => (
                <DropdownMenuCheckboxItem
                  key={header}
                  checked={columnVisibility[header] !== false}
                  onCheckedChange={value => setColumnVisibility(prev => ({ ...prev, [header]: !!value }))}
                >
                  {header}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Stats ribbon */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-lg border border-blue-500/20 bg-blue-500/5 text-blue-600 dark:text-blue-400">
          <FileText className="h-4 w-4 flex-shrink-0" />
          <div>
            <span className="text-xs text-muted-foreground block leading-tight">Total Requests</span>
            <span className="font-bold leading-tight">{filteredExpenses.length}</span>
          </div>
        </div>
        <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-lg border border-emerald-500/20 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400">
          <IndianRupee className="h-4 w-4 flex-shrink-0" />
          <div>
            <span className="text-xs text-muted-foreground block leading-tight">Total Amount</span>
            <span className="font-bold leading-tight text-sm">₹{totalAmount.toLocaleString('en-IN')}</span>
          </div>
        </div>
        <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-lg border border-purple-500/20 bg-purple-500/5 text-purple-600 dark:text-purple-400">
          <Building2 className="h-4 w-4 flex-shrink-0" />
          <div>
            <span className="text-xs text-muted-foreground block leading-tight">Departments</span>
            <span className="font-bold leading-tight">{uniqueDepts}</span>
          </div>
        </div>
        <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-lg border border-amber-500/20 bg-amber-500/5 text-amber-600 dark:text-amber-400">
          <TrendingUp className="h-4 w-4 flex-shrink-0" />
          <div>
            <span className="text-xs text-muted-foreground block leading-tight">Avg per Request</span>
            <span className="font-bold leading-tight text-sm">
              {filteredExpenses.length > 0 ? `₹${Math.round(totalAmount / filteredExpenses.length).toLocaleString('en-IN')}` : '—'}
            </span>
          </div>
        </div>
      </div>

      {/* Filter Panel */}
      <Card className="border-border/60 bg-card/60 backdrop-blur-sm">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Filter className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Filters</span>
          </div>
          <div className="w-full grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search Request No..."
                className="pl-8 h-9 text-sm"
                value={filters.requestNo}
                onChange={e => handleFilterChange('requestNo', e.target.value)}
              />
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search Party Name..."
                className="pl-8 h-9 text-sm"
                value={filters.partyName}
                onChange={e => handleFilterChange('partyName', e.target.value)}
              />
            </div>
            <Select value={filters.projectName} onValueChange={value => handleFilterChange('projectName', value)}>
              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="All Projects" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Projects</SelectItem>
                {projects.map(p => <SelectItem key={p.id} value={p.projectName}>{p.projectName}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filters.departmentName} onValueChange={value => handleFilterChange('departmentName', value)}>
              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="All Departments" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Departments</SelectItem>
                {departments.map(d => <SelectItem key={d.id} value={d.name}>{d.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Data Table */}
      <Card className="border-border/60 bg-card/60 backdrop-blur-sm overflow-hidden">
        <CardContent className="p-0">
          <ScrollArea className="h-[calc(100vh-22rem)]">
            <Table>
              <TableHeader className="sticky top-0 bg-background z-10">
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  {visibleHeaders.map(header => (
                    <TableHead key={header} className="whitespace-nowrap px-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {header}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <TableRow key={i}>
                      {visibleHeaders.map(header => (
                        <TableCell key={header}><Skeleton className="h-4 w-full" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : filteredExpenses.length > 0 ? (
                  filteredExpenses.map(expense => (
                    <TableRow key={expense.id} className="hover:bg-primary/5 transition-colors duration-150">
                      {visibleHeaders.map(header => (
                        <TableCell key={header} className="whitespace-nowrap text-sm px-4">
                          {getCellContent(header, expense)}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={visibleHeaders.length}>
                      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                        <Receipt className="h-10 w-10 mb-3 opacity-30" />
                        <p className="font-medium">No expense requests found</p>
                        <p className="text-sm mt-1">Try adjusting your filters</p>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
