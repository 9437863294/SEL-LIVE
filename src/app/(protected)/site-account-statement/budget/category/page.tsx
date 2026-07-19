'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  addDoc, collection, deleteDoc, doc, getDocs, query, serverTimestamp, updateDoc, where,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  formatINR,
  SAS_COLLECTIONS,
  type SASCategory,
  type SASCategoryBudget,
  type SASExpense,
  type SASProject,
} from '@/lib/site-account-statement';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useAuth } from '@/components/auth/AuthProvider';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import {
  ChevronLeft, ChevronRight, Download, Edit2, Loader2, Plus,
  ShieldAlert, Target, Trash2,
} from 'lucide-react';
import ExcelJS from 'exceljs';

const MODULE = 'Site Account Statement';

function ym(date: Date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(ymStr: string) {
  const [y, m] = ymStr.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

function shiftMonth(ymStr: string, delta: number) {
  const [y, m] = ymStr.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return ym(d);
}

export default function CategoryBudgetPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { user } = useAuth();
  const { toast } = useToast();

  const canViewAll = can('View', `${MODULE}.All Projects`);
  const canView    = can('View', `${MODULE}.Budget`) || canViewAll;
  const canEdit    = can('Edit', `${MODULE}.Budget`) || canViewAll;

  const [projects,     setProjects]     = useState<SASProject[]>([]);
  const [categories,   setCategories]   = useState<SASCategory[]>([]);
  const [expenses,     setExpenses]     = useState<SASExpense[]>([]);
  const [catBudgets,   setCatBudgets]   = useState<SASCategoryBudget[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [saving,       setSaving]       = useState(false);
  const [exporting,    setExporting]    = useState(false);

  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [currentMonth,      setCurrentMonth]      = useState(ym());
  const todayMonth = ym();

  // Dialog
  const [dialogOpen,    setDialogOpen]    = useState(false);
  const [editingBudget, setEditingBudget] = useState<SASCategoryBudget | null>(null);
  const [dlgCategory,   setDlgCategory]   = useState('');
  const [dlgAmount,     setDlgAmount]     = useState('');
  const [dlgNotes,      setDlgNotes]      = useState('');

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<SASCategoryBudget | null>(null);

  useEffect(() => {
    if (!isAuthLoading) void loadAll();
  }, [isAuthLoading]);

  async function loadAll() {
    setLoading(true);
    try {
      const [pSnap, cSnap, eSnap, cbSnap] = await Promise.all([
        getDocs(query(collection(db, SAS_COLLECTIONS.projects))),
        getDocs(query(collection(db, SAS_COLLECTIONS.categories))),
        getDocs(query(collection(db, SAS_COLLECTIONS.expenses))),
        getDocs(collection(db, SAS_COLLECTIONS.categoryBudgets)),
      ]);
      const allProjects = pSnap.docs
        .map(d => ({ id: d.id, ...d.data() } as SASProject))
        .filter(p => p.enabledForSiteAccount && p.status === 'Active')
        .sort((a, b) => a.projectName.localeCompare(b.projectName));
      setProjects(allProjects);
      setCategories(
        cSnap.docs
          .map(d => ({ id: d.id, ...d.data() } as SASCategory))
          .filter(c => c.isActive !== false)
          .sort((a, b) => a.name.localeCompare(b.name))
      );
      setExpenses(eSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASExpense)));
      setCatBudgets(cbSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASCategoryBudget)));

      setSelectedProjectId(prev => {
        if (prev) return prev;
        if (!canViewAll) {
          const mine = allProjects.find(p =>
            p.assignedPersonId === user?.id || p.altUserId === user?.id || p.viewerId === user?.id
          );
          return mine?.id || allProjects[0]?.id || '';
        }
        return allProjects[0]?.id || '';
      });
    } finally {
      setLoading(false);
    }
  }

  const visibleProjects = useMemo(
    () => canViewAll
      ? projects
      : projects.filter(p =>
          p.assignedPersonId === user?.id || p.altUserId === user?.id || p.viewerId === user?.id
        ),
    [projects, user?.id, canViewAll]
  );

  const prevM = shiftMonth(currentMonth, -1);

  const categoryRows = useMemo(() => {
    if (!selectedProjectId) return [];
    const names = new Set<string>();
    categories.forEach(c => { if (c.name) names.add(c.name); });
    catBudgets
      .filter(b => b.projectId === selectedProjectId && (b.period === currentMonth || b.period === prevM))
      .forEach(b => names.add(b.categoryName));
    expenses
      .filter(e => e.projectId === selectedProjectId &&
        (e.expenseDate?.startsWith(currentMonth) || e.expenseDate?.startsWith(prevM)))
      .forEach(e => { if (e.expenseCategory) names.add(e.expenseCategory); });
    return [...names].sort();
  }, [selectedProjectId, categories, catBudgets, expenses, currentMonth, prevM]);

  function getBudget(categoryName: string, period: string) {
    return catBudgets.find(
      b => b.projectId === selectedProjectId && b.categoryName === categoryName && b.period === period
    );
  }

  function getActual(categoryName: string, period: string) {
    return expenses
      .filter(e =>
        e.projectId === selectedProjectId &&
        e.expenseCategory === categoryName &&
        e.expenseDate?.startsWith(period)
      )
      .reduce((s, e) => s + (e.expenseAmount || 0), 0);
  }

  function openSetBudget(categoryName: string, existing?: SASCategoryBudget) {
    setEditingBudget(existing || null);
    setDlgCategory(categoryName);
    setDlgAmount(existing ? String(existing.budgetAmount) : '');
    setDlgNotes(existing?.notes || '');
    setDialogOpen(true);
  }

  async function handleSave() {
    const amount = Number(dlgAmount);
    if (!amount || amount <= 0) {
      toast({ title: 'Validation', description: 'Enter a valid budget amount.', variant: 'destructive' });
      return;
    }
    const project = projects.find(p => p.id === selectedProjectId);
    const catDoc  = categories.find(c => c.name === dlgCategory);

    setSaving(true);
    try {
      if (editingBudget) {
        await updateDoc(doc(db, SAS_COLLECTIONS.categoryBudgets, editingBudget.id), {
          budgetAmount: amount,
          notes: dlgNotes.trim(),
          updatedAt: serverTimestamp(),
        });
        toast({ title: 'Updated', description: `Budget updated for ${dlgCategory}.` });
      } else {
        await addDoc(collection(db, SAS_COLLECTIONS.categoryBudgets), {
          projectId:    selectedProjectId,
          projectName:  project?.projectName || '',
          period:       currentMonth,
          categoryId:   catDoc?.id || '',
          categoryName: dlgCategory,
          budgetAmount: amount,
          notes:        dlgNotes.trim(),
          createdAt:    serverTimestamp(),
          updatedAt:    serverTimestamp(),
        });
        toast({ title: 'Budget Set', description: `${dlgCategory} budget set for ${monthLabel(currentMonth)}.` });
      }
      setDialogOpen(false);
      void loadAll();
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(budget: SASCategoryBudget) {
    try {
      await deleteDoc(doc(db, SAS_COLLECTIONS.categoryBudgets, budget.id));
      toast({ title: 'Removed', description: 'Category budget removed.' });
      setDeleteTarget(null);
      void loadAll();
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
  }

  async function exportExcel() {
    if (!selectedProjectId || categoryRows.length === 0) return;
    setExporting(true);
    try {
      const project = projects.find(p => p.id === selectedProjectId);
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Category Budgets');
      ws.columns = [
        { header: 'Category',                         key: 'cat',  width: 28 },
        { header: `${monthLabel(prevM)} Budget`,      key: 'pb',   width: 20 },
        { header: `${monthLabel(prevM)} Actual`,      key: 'pa',   width: 20 },
        { header: `${monthLabel(currentMonth)} Budget`, key: 'cb', width: 20 },
        { header: `${monthLabel(currentMonth)} Actual`, key: 'ca', width: 20 },
        { header: 'Status',                           key: 'st',   width: 14 },
      ];
      ws.getRow(1).font = { bold: true };
      categoryRows.forEach(cat => {
        const pb = getBudget(cat, prevM);
        const cb = getBudget(cat, currentMonth);
        const pa = getActual(cat, prevM);
        const ca = getActual(cat, currentMonth);
        const pct = cb && cb.budgetAmount > 0 ? (ca / cb.budgetAmount) * 100 : null;
        const status = pct === null ? 'No Budget' : pct >= 100 ? 'Over Budget' : pct >= 80 ? 'Near Limit' : 'On Track';
        ws.addRow({ cat, pb: pb?.budgetAmount ?? '—', pa: pa || 0, cb: cb?.budgetAmount ?? '—', ca: ca || 0, st: status });
      });
      const buf = await wb.xlsx.writeBuffer();
      const url = URL.createObjectURL(new Blob([buf]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `category-budget-${(project?.projectName || 'project').replace(/\s+/g, '-')}-${currentMonth}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  if (isAuthLoading || loading) {
    return <div className="space-y-3">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)}</div>;
  }

  if (!canView) {
    return (
      <Card className="p-8 text-center">
        <ShieldAlert className="h-10 w-10 text-destructive mx-auto mb-3" />
        <p className="font-semibold">Access Denied</p>
        <p className="text-sm text-muted-foreground mt-1">You don&apos;t have permission to view budgets.</p>
      </Card>
    );
  }

  const selectedProject = projects.find(p => p.id === selectedProjectId);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-base sm:text-lg font-bold text-slate-800 flex items-center gap-2">
            <Target className="h-5 w-5 text-emerald-600" />
            Category-wise Monthly Budgets
          </h1>
          <p className="text-sm text-muted-foreground">
            Compare previous vs current month budget and actual per category.
          </p>
        </div>
        <Button
          variant="outline" size="sm" onClick={exportExcel}
          disabled={exporting || !selectedProjectId || categoryRows.length === 0}
          className="gap-2"
        >
          {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          Export
        </Button>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Label className="text-sm font-medium shrink-0">Project</Label>
          <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
            <SelectTrigger className="h-9 text-sm w-full sm:w-[220px] min-w-[160px]">
              <SelectValue placeholder="Select project..." />
            </SelectTrigger>
            <SelectContent>
              {visibleProjects.map(p => (
                <SelectItem key={p.id} value={p.id}>{p.projectName}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Month navigator */}
        <div className="flex items-center gap-1 ml-auto">
          <Button
            variant="outline" size="icon" className="h-8 w-8"
            onClick={() => setCurrentMonth(m => shiftMonth(m, -1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="px-3 py-1 rounded-md bg-slate-100 text-sm font-medium min-w-[155px] text-center flex items-center justify-center gap-1.5">
            {monthLabel(currentMonth)}
            {currentMonth === todayMonth && (
              <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full leading-none">
                Current
              </span>
            )}
          </div>
          <Button
            variant="outline" size="icon" className="h-8 w-8"
            onClick={() => setCurrentMonth(m => shiftMonth(m, 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {!selectedProjectId ? (
        <Card className="bg-white/80">
          <CardContent className="flex flex-col items-center gap-3 py-12">
            <Target className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">Select a project to view category budgets.</p>
          </CardContent>
        </Card>
      ) : (
        <Card className="bg-white/80 backdrop-blur-sm">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[700px]">
                <thead>
                  <tr className="border-b">
                    <th className="px-4 py-2 text-left font-medium text-xs bg-slate-50" rowSpan={2}>
                      Category
                    </th>
                    <th colSpan={2} className="px-4 py-2 text-center font-medium text-xs bg-slate-100/80 border-l border-r text-slate-500">
                      {monthLabel(prevM)} — Previous
                    </th>
                    <th colSpan={2} className="px-4 py-2 text-center font-medium text-xs bg-emerald-50/80 border-r text-emerald-700">
                      {monthLabel(currentMonth)} — Current
                    </th>
                    <th className="px-4 py-2 text-center font-medium text-xs bg-slate-50" rowSpan={2}>Status</th>
                    {canEdit && (
                      <th className="px-4 py-2 text-center font-medium text-xs bg-slate-50" rowSpan={2}>Actions</th>
                    )}
                  </tr>
                  <tr className="border-b">
                    <th className="px-4 py-2 text-right font-medium text-xs bg-slate-100/60 border-l text-slate-500">Budget</th>
                    <th className="px-4 py-2 text-right font-medium text-xs bg-slate-100/60 border-r text-slate-500">Actual</th>
                    <th className="px-4 py-2 text-right font-medium text-xs bg-emerald-50/60 text-emerald-700">Budget</th>
                    <th className="px-4 py-2 text-right font-medium text-xs bg-emerald-50/60 border-r text-emerald-700">Actual</th>
                  </tr>
                </thead>
                <tbody>
                  {categoryRows.length === 0 ? (
                    <tr>
                      <td colSpan={canEdit ? 7 : 6} className="px-4 py-10 text-center text-sm text-muted-foreground">
                        No categories found for this project in the selected period.
                      </td>
                    </tr>
                  ) : categoryRows.map(cat => {
                    const prevBudget = getBudget(cat, prevM);
                    const currBudget = getBudget(cat, currentMonth);
                    const prevActual = getActual(cat, prevM);
                    const currActual = getActual(cat, currentMonth);
                    const pct = currBudget && currBudget.budgetAmount > 0
                      ? (currActual / currBudget.budgetAmount) * 100 : null;
                    const isOver = pct !== null && pct >= 100;
                    const isNear = pct !== null && pct >= 80 && pct < 100;

                    return (
                      <tr key={cat} className="border-b hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-2.5 font-medium text-slate-800">{cat}</td>

                        {/* Prev budget */}
                        <td className="px-4 py-2.5 text-right border-l text-muted-foreground">
                          {prevBudget
                            ? <span className="font-medium">{formatINR(prevBudget.budgetAmount)}</span>
                            : <span className="text-slate-400 text-xs">—</span>}
                        </td>

                        {/* Prev actual */}
                        <td className={cn('px-4 py-2.5 text-right border-r',
                          prevActual > 0 ? 'text-rose-600' : 'text-slate-400 text-xs')}>
                          {prevActual > 0 ? formatINR(prevActual) : '—'}
                        </td>

                        {/* Curr budget */}
                        <td className={cn('px-4 py-2.5 text-right',
                          currBudget ? 'text-emerald-700 font-semibold' : 'text-slate-400 text-xs')}>
                          {currBudget ? formatINR(currBudget.budgetAmount) : '—'}
                        </td>

                        {/* Curr actual */}
                        <td className={cn('px-4 py-2.5 text-right border-r font-medium',
                          isOver ? 'text-destructive' : isNear ? 'text-amber-600' : currActual > 0 ? 'text-rose-600' : 'text-slate-400 text-xs font-normal')}>
                          {currActual > 0 ? formatINR(currActual) : '—'}
                        </td>

                        {/* Status */}
                        <td className="px-4 py-2.5 text-center">
                          {pct !== null ? (
                            <div className="flex flex-col items-center gap-0.5">
                              <span className={cn('text-xs font-semibold',
                                isOver ? 'text-destructive' : isNear ? 'text-amber-600' : 'text-emerald-600')}>
                                {isOver ? 'Over Budget' : isNear ? 'Near Limit' : 'On Track'}
                              </span>
                              <span className="text-[10px] text-muted-foreground">
                                {pct.toFixed(0)}% used
                              </span>
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400">No Budget</span>
                          )}
                        </td>

                        {/* Actions */}
                        {canEdit && (
                          <td className="px-4 py-2.5 text-center">
                            <div className="flex items-center justify-center gap-1">
                              {currBudget ? (
                                <>
                                  <Button
                                    variant="ghost" size="icon" className="h-7 w-7"
                                    title="Edit budget"
                                    onClick={() => openSetBudget(cat, currBudget)}
                                  >
                                    <Edit2 className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button
                                    variant="ghost" size="icon"
                                    className="h-7 w-7 text-destructive hover:text-destructive"
                                    title="Remove budget"
                                    onClick={() => setDeleteTarget(currBudget)}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </>
                              ) : (
                                <Button
                                  variant="ghost" size="sm"
                                  className="h-7 text-xs gap-1 text-emerald-700 hover:text-emerald-900"
                                  onClick={() => openSetBudget(cat)}
                                >
                                  <Plus className="h-3 w-3" /> Set
                                </Button>
                              )}
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Set / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-[95vw] sm:max-w-sm overflow-y-auto max-h-[90vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Target className="h-4 w-4 text-emerald-600" />
              {editingBudget ? 'Edit Category Budget' : 'Set Category Budget'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-lg bg-slate-50 border px-3 py-2.5 text-sm space-y-1">
              <p className="text-muted-foreground">
                <span className="font-medium text-slate-700">Project:</span> {selectedProject?.projectName}
              </p>
              <p className="text-muted-foreground">
                <span className="font-medium text-slate-700">Month:</span> {monthLabel(currentMonth)}
              </p>
              <p className="text-muted-foreground">
                <span className="font-medium text-slate-700">Category:</span> {dlgCategory}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Budget Amount (₹) *</Label>
              <Input
                type="number"
                value={dlgAmount}
                onChange={e => setDlgAmount(e.target.value)}
                placeholder="e.g. 50000"
                min={1}
                className="h-9"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label>Notes (optional)</Label>
              <Input
                value={dlgNotes}
                onChange={e => setDlgNotes(e.target.value)}
                placeholder="Optional notes..."
                className="h-9"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving} className="gap-2">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {editingBudget ? 'Update' : 'Set Budget'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={open => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Budget?</AlertDialogTitle>
          </AlertDialogHeader>
          <p className="text-sm text-muted-foreground px-6 pb-2">
            This will remove the {monthLabel(currentMonth)} budget for &ldquo;{deleteTarget?.categoryName}&rdquo;.
            Past expense data is not affected.
          </p>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => deleteTarget && void handleDelete(deleteTarget)}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
