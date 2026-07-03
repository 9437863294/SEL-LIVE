'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  addDoc, collection, deleteDoc, doc, getDocs, orderBy, query, serverTimestamp, updateDoc,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  formatINR, PAYMENT_MODES, SAS_COLLECTIONS,
  type SASCategory, type SASExpense, type SASProject,
} from '@/lib/site-account-statement';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useActivityLogger } from '@/hooks/useActivityLogger';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Download, Loader2, Pencil, Plus, Receipt, Trash2, Upload } from 'lucide-react';
import ExcelJS from 'exceljs';
import { VehicleImportDialog, type ImportField } from '@/components/vehicle-management/import-dialog';

const MODULE   = 'Site Account Statement';
const RESOURCE = 'Expenses';

interface FormState {
  projectId: string;
  projectName: string;
  expenseCategory: string;
  expensedBy: string;
  expenseDate: string;
  expenseAmount: string;
  paymentMode: string;
  vendorPartyName: string;
  billNo: string;
  remarks: string;
}

const blank = (): FormState => ({
  projectId: '', projectName: '', expenseCategory: '',
  expensedBy: '', expenseDate: '', expenseAmount: '',
  paymentMode: 'Cash', vendorPartyName: '', billNo: '', remarks: '',
});

export default function SiteExpensesPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { log } = useActivityLogger('Site Account Statement');
  const { toast } = useToast();

  const canView   = can('View',   `${MODULE}.${RESOURCE}`) || can('View Module', MODULE);
  const canAdd    = can('Add',    `${MODULE}.${RESOURCE}`);
  const canEdit   = can('Edit',   `${MODULE}.${RESOURCE}`);
  const canDelete = can('Delete', `${MODULE}.${RESOURCE}`);
  const canExport = can('Export', `${MODULE}.${RESOURCE}`);
  const canImport = canAdd;

  const [projects,    setProjects]    = useState<SASProject[]>([]);
  const [categories,  setCategories]  = useState<SASCategory[]>([]);
  const [expenses,    setExpenses]    = useState<SASExpense[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [saving,           setSaving]           = useState(false);
  const [exporting,        setExporting]        = useState(false);
  const [dialogOpen,       setDialogOpen]       = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [editingRow,  setEditingRow]  = useState<SASExpense | null>(null);
  const [form,        setForm]        = useState<FormState>(blank());

  // Filters
  const [filterProject,  setFilterProject]  = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterMode,     setFilterMode]     = useState('');
  const [filterFrom,     setFilterFrom]     = useState('');
  const [filterTo,       setFilterTo]       = useState('');
  const [search,         setSearch]         = useState('');

  useEffect(() => {
    if (!isAuthLoading && canView) void loadAll();
  }, [isAuthLoading, canView]);

  async function loadAll() {
    setLoading(true);
    try {
      const [pSnap, catSnap, expSnap] = await Promise.all([
        getDocs(query(collection(db, SAS_COLLECTIONS.projects), orderBy('projectName'))),
        getDocs(query(collection(db, SAS_COLLECTIONS.categories), orderBy('name'))),
        getDocs(query(collection(db, SAS_COLLECTIONS.expenses), orderBy('expenseDate', 'desc'))),
      ]);
      setProjects(pSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASProject)).filter(p => p.enabledForSiteAccount && p.status === 'Active'));
      setCategories(catSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASCategory)).filter(c => c.isActive !== false));
      setExpenses(expSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASExpense)));
    } finally {
      setLoading(false);
    }
  }

  // ── Derived category names list for import validation ───────────────────────
  const categoryNames = useMemo(() => categories.map(c => c.name), [categories]);

  // ── Import field definitions (validate against live projects + categories) ──
  const expenseImportFields = useMemo<ImportField[]>(() => [
    {
      key: 'projectName',
      label: 'Project Name',
      required: true,
      hint: 'Must exactly match an enabled project name',
      validate: (v) => {
        const match = projects.find(p => p.projectName.toLowerCase() === v.trim().toLowerCase());
        return match ? null : `Project "${v}" not found — check enabled projects`;
      },
    },
    {
      key: 'expenseCategory',
      label: 'Expense Category',
      required: true,
      hint: 'Must match a configured category (see Expense Categories)',
      validate: (v) => {
        const match = categoryNames.find(c => c.toLowerCase() === v.trim().toLowerCase());
        return match ? null : `Category "${v}" not found — add it in Expense Categories first`;
      },
    },
    {
      key: 'expensedBy',
      label: 'Expensed By',
      required: true,
      hint: 'Name of person who spent the amount',
    },
    {
      key: 'expenseDate',
      label: 'Expense Date',
      required: true,
      hint: 'YYYY-MM-DD  e.g. 2024-07-15',
      validate: (v) => /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? null : 'Date must be in YYYY-MM-DD format',
    },
    {
      key: 'expenseAmount',
      label: 'Amount (₹)',
      required: true,
      type: 'number',
      hint: 'Positive number without commas',
      validate: (v) => Number(v) > 0 ? null : 'Amount must be greater than 0',
    },
    {
      key: 'paymentMode',
      label: 'Payment Mode',
      hint: `Cash | Bank | UPI | Other  (defaults to Cash if blank)`,
      validate: (v) => !v || PAYMENT_MODES.includes(v as any) ? null : `Must be one of: ${PAYMENT_MODES.join(', ')}`,
    },
    { key: 'vendorPartyName', label: 'Vendor / Party Name', hint: 'Optional vendor or party name' },
    { key: 'billNo',          label: 'Bill No.',            hint: 'Bill or voucher number' },
    { key: 'remarks',         label: 'Remarks' },
  ], [projects, categoryNames]);

  async function saveExpenseRow(row: Record<string, any>) {
    const projName = String(row.projectName || '').trim();
    const proj = projects.find(p => p.projectName.toLowerCase() === projName.toLowerCase());
    if (!proj) throw new Error(`Project "${projName}" not found`);

    const catRaw  = String(row.expenseCategory || '').trim();
    const catName = categoryNames.find(c => c.toLowerCase() === catRaw.toLowerCase());
    if (!catName) throw new Error(`Category "${catRaw}" not found`);

    const amount = Number(row.expenseAmount);
    if (!amount || amount <= 0) throw new Error('Amount must be > 0');

    const mode = PAYMENT_MODES.includes(row.paymentMode as any) ? row.paymentMode : 'Cash';

    await addDoc(collection(db, SAS_COLLECTIONS.expenses), {
      projectId:       proj.id,
      projectName:     proj.projectName,
      expenseCategory: catName,
      expensedBy:      String(row.expensedBy      || '').trim(),
      expenseDate:     String(row.expenseDate      || '').trim(),
      expenseAmount:   amount,
      paymentMode:     mode,
      vendorPartyName: String(row.vendorPartyName  || '').trim(),
      billNo:          String(row.billNo           || '').trim(),
      remarks:         String(row.remarks          || '').trim(),
      createdAt:       serverTimestamp(),
      updatedAt:       serverTimestamp(),
    });
  }

  function openAdd() { setEditingRow(null); setForm(blank()); setDialogOpen(true); }

  function openEdit(row: SASExpense) {
    setEditingRow(row);
    setForm({
      projectId: row.projectId, projectName: row.projectName,
      expenseCategory: row.expenseCategory, expensedBy: row.expensedBy,
      expenseDate: row.expenseDate, expenseAmount: String(row.expenseAmount),
      paymentMode: row.paymentMode, vendorPartyName: row.vendorPartyName || '',
      billNo: row.billNo || '', remarks: row.remarks || '',
    });
    setDialogOpen(true);
  }

  function setField(key: keyof FormState, value: string) { setForm(f => ({ ...f, [key]: value })); }

  function selectProject(id: string) {
    const proj = projects.find(p => p.id === id);
    setForm(f => ({ ...f, projectId: id, projectName: proj?.projectName || '' }));
  }

  async function handleSubmit() {
    if (!form.projectId)       { toast({ title: 'Validation', description: 'Select a project.',         variant: 'destructive' }); return; }
    if (!form.expenseCategory) { toast({ title: 'Validation', description: 'Select expense category.',  variant: 'destructive' }); return; }
    if (!form.expensedBy.trim()){ toast({ title: 'Validation', description: 'Expensed By is required.', variant: 'destructive' }); return; }
    if (!form.expenseDate)     { toast({ title: 'Validation', description: 'Expense date is required.', variant: 'destructive' }); return; }
    const amount = Number(form.expenseAmount);
    if (!amount || amount <= 0){ toast({ title: 'Validation', description: 'Enter a valid amount.',     variant: 'destructive' }); return; }

    setSaving(true);
    try {
      const data = {
        projectId: form.projectId, projectName: form.projectName,
        expenseCategory: form.expenseCategory, expensedBy: form.expensedBy.trim(),
        expenseDate: form.expenseDate, expenseAmount: amount,
        paymentMode: form.paymentMode, vendorPartyName: form.vendorPartyName.trim(),
        billNo: form.billNo.trim(), remarks: form.remarks.trim(),
        updatedAt: serverTimestamp(),
      };
      if (editingRow) {
        await updateDoc(doc(db, SAS_COLLECTIONS.expenses, editingRow.id), data);
        void log('Edit SAS Expense', { project: form.projectName, category: form.expenseCategory, amount });
        toast({ title: 'Updated', description: 'Expense updated.' });
      } else {
        await addDoc(collection(db, SAS_COLLECTIONS.expenses), { ...data, createdAt: serverTimestamp() });
        void log('Add SAS Expense', { project: form.projectName, category: form.expenseCategory, amount });
        toast({ title: 'Added', description: 'Expense recorded.' });
      }
      setDialogOpen(false);
      void loadAll();
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(row: SASExpense) {
    try {
      await deleteDoc(doc(db, SAS_COLLECTIONS.expenses, row.id));
      void log('Delete SAS Expense', { project: row.projectName });
      toast({ title: 'Deleted', description: 'Expense deleted.' });
      void loadAll();
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
  }

  const filtered = useMemo(() => expenses.filter(e => {
    if (filterProject  && e.projectId !== filterProject)                                    return false;
    if (filterCategory && e.expenseCategory !== filterCategory)                             return false;
    if (filterMode     && e.paymentMode !== filterMode)                                     return false;
    if (filterFrom     && e.expenseDate < filterFrom)                                       return false;
    if (filterTo       && e.expenseDate > filterTo)                                         return false;
    if (search && !e.projectName.toLowerCase().includes(search.toLowerCase()) &&
        !e.expensedBy.toLowerCase().includes(search.toLowerCase()) &&
        !e.expenseCategory.toLowerCase().includes(search.toLowerCase()) &&
        !(e.billNo || '').toLowerCase().includes(search.toLowerCase()))                     return false;
    return true;
  }), [expenses, filterProject, filterCategory, filterMode, filterFrom, filterTo, search]);

  const totalFiltered = useMemo(() => filtered.reduce((s, e) => s + (e.expenseAmount || 0), 0), [filtered]);

  async function exportExcel() {
    setExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Site Expenses');
      ws.columns = [
        { header: 'Project',          key: 'projectName',     width: 28 },
        { header: 'Expense Category', key: 'expenseCategory', width: 22 },
        { header: 'Expensed By',      key: 'expensedBy',      width: 20 },
        { header: 'Expense Date',     key: 'expenseDate',     width: 14 },
        { header: 'Amount (₹)',       key: 'expenseAmount',   width: 14 },
        { header: 'Payment Mode',     key: 'paymentMode',     width: 14 },
        { header: 'Vendor / Party',   key: 'vendorPartyName', width: 22 },
        { header: 'Bill No.',         key: 'billNo',          width: 16 },
        { header: 'Remarks',          key: 'remarks',         width: 30 },
      ];
      ws.getRow(1).font = { bold: true };
      filtered.forEach(e => ws.addRow({ ...e }));
      const buf = await wb.xlsx.writeBuffer();
      const url = URL.createObjectURL(new Blob([buf]));
      const a = document.createElement('a'); a.href = url; a.download = 'site-expenses.xlsx'; a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  if (isAuthLoading || loading) {
    return <div className="space-y-3">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-bold text-slate-800">Site Expenses</h1>
          <p className="text-sm text-muted-foreground">All expenses incurred at project sites</p>
        </div>
        <div className="flex gap-2">
          {canExport && (
            <Button variant="outline" size="sm" onClick={exportExcel} disabled={exporting} className="gap-2">
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Export
            </Button>
          )}
          {canImport && (
            <Button variant="outline" size="sm" onClick={() => setImportDialogOpen(true)} className="gap-2">
              <Upload className="h-4 w-4" /> Import
            </Button>
          )}
          {canAdd && (
            <Button size="sm" onClick={openAdd} className="gap-2 bg-rose-600 hover:bg-rose-700">
              <Plus className="h-4 w-4" /> Add Expense
            </Button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Select value={filterProject || '_all_'} onValueChange={v => setFilterProject(v === '_all_' ? '' : v)}>
          <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="All Projects" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="_all_">All Projects</SelectItem>
            {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.projectName}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterCategory || '_all_'} onValueChange={v => setFilterCategory(v === '_all_' ? '' : v)}>
          <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="All Categories" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="_all_">All Categories</SelectItem>
            {categories.map(c => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterMode || '_all_'} onValueChange={v => setFilterMode(v === '_all_' ? '' : v)}>
          <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="All Modes" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="_all_">All Modes</SelectItem>
            {PAYMENT_MODES.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} className="h-9 text-sm" />
        <Input type="date" value={filterTo}   onChange={e => setFilterTo(e.target.value)}   className="h-9 text-sm" />
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..." className="h-9 text-sm" />
      </div>

      {/* Summary bar */}
      <div className="flex items-center gap-3 rounded-lg border bg-rose-50 px-4 py-2.5 text-rose-700">
        <Receipt className="h-4 w-4 shrink-0" />
        <span className="text-sm font-medium">Total shown: <strong>{formatINR(totalFiltered)}</strong> across {filtered.length} record{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Table */}
      <Card className="bg-white/80 backdrop-blur-sm">
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <Receipt className="h-10 w-10 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">{expenses.length === 0 ? 'No expenses recorded yet.' : 'No expenses match filters.'}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="px-4 py-2.5 text-left font-medium">Project</th>
                    <th className="px-4 py-2.5 text-left font-medium">Category</th>
                    <th className="px-4 py-2.5 text-left font-medium">Expensed By</th>
                    <th className="px-4 py-2.5 text-left font-medium">Date</th>
                    <th className="px-4 py-2.5 text-right font-medium">Amount</th>
                    <th className="px-4 py-2.5 text-left font-medium">Mode</th>
                    <th className="px-4 py-2.5 text-left font-medium">Vendor / Party</th>
                    <th className="px-4 py-2.5 text-left font-medium">Bill No.</th>
                    <th className="px-4 py-2.5 text-left font-medium">Remarks</th>
                    {(canEdit || canDelete) && <th className="px-4 py-2.5 text-right font-medium">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(row => (
                    <tr key={row.id} className="border-b hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-2.5 font-medium max-w-[140px] truncate">{row.projectName}</td>
                      <td className="px-4 py-2.5"><Badge variant="outline" className="text-xs">{row.expenseCategory}</Badge></td>
                      <td className="px-4 py-2.5">{row.expensedBy}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap">{row.expenseDate}</td>
                      <td className="px-4 py-2.5 text-right font-semibold text-rose-700">{formatINR(row.expenseAmount)}</td>
                      <td className="px-4 py-2.5"><Badge variant="secondary">{row.paymentMode}</Badge></td>
                      <td className="px-4 py-2.5 max-w-[120px] truncate">{row.vendorPartyName || '—'}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{row.billNo || '—'}</td>
                      <td className="px-4 py-2.5 text-muted-foreground max-w-[120px] truncate">{row.remarks || '—'}</td>
                      {(canEdit || canDelete) && (
                        <td className="px-4 py-2.5 text-right">
                          <div className="flex justify-end gap-1">
                            {canEdit && (
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(row)}>
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            {canDelete && (
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:bg-destructive/10">
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Delete Expense</AlertDialogTitle>
                                    <AlertDialogDescription>Delete this expense record? This cannot be undone.</AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => handleDelete(row)} className="bg-destructive hover:bg-destructive/90">Delete</AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-muted/30 font-semibold">
                    <td colSpan={4} className="px-4 py-2.5">Total</td>
                    <td className="px-4 py-2.5 text-right text-rose-700">{formatINR(totalFiltered)}</td>
                    <td colSpan={(canEdit || canDelete) ? 5 : 4} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Import Dialog */}
      <VehicleImportDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        title="Import Site Expenses"
        fields={expenseImportFields}
        onSaveRow={saveExpenseRow}
        onImportComplete={() => { void log('Import SAS Expenses', {}); void loadAll(); }}
      />

      {/* Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{editingRow ? 'Edit Expense' : 'Record Site Expense'}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="col-span-2 space-y-1.5">
              <Label>Project <span className="text-destructive">*</span></Label>
              <Select value={form.projectId} onValueChange={selectProject}>
                <SelectTrigger><SelectValue placeholder="Select project" /></SelectTrigger>
                <SelectContent>
                  {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.projectName}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Expense Category <span className="text-destructive">*</span></Label>
              <Select value={form.expenseCategory} onValueChange={v => setField('expenseCategory', v)}>
                <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>
                  {categories.map(c => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Expensed By <span className="text-destructive">*</span></Label>
              <Input value={form.expensedBy} onChange={e => setField('expensedBy', e.target.value)} placeholder="Person who spent" />
            </div>
            <div className="space-y-1.5">
              <Label>Expense Date <span className="text-destructive">*</span></Label>
              <Input type="date" value={form.expenseDate} onChange={e => setField('expenseDate', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Amount (₹) <span className="text-destructive">*</span></Label>
              <Input type="number" min="0" value={form.expenseAmount} onChange={e => setField('expenseAmount', e.target.value)} placeholder="0" />
            </div>
            <div className="space-y-1.5">
              <Label>Payment Mode</Label>
              <Select value={form.paymentMode} onValueChange={v => setField('paymentMode', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAYMENT_MODES.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Vendor / Party Name</Label>
              <Input value={form.vendorPartyName} onChange={e => setField('vendorPartyName', e.target.value)} placeholder="Vendor or party name" />
            </div>
            <div className="space-y-1.5">
              <Label>Bill No.</Label>
              <Input value={form.billNo} onChange={e => setField('billNo', e.target.value)} placeholder="Bill / voucher number" />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label>Remarks</Label>
              <Textarea rows={2} value={form.remarks} onChange={e => setField('remarks', e.target.value)} placeholder="Expense details" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={saving} className="bg-rose-600 hover:bg-rose-700">
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {editingRow ? 'Save Changes' : 'Record Expense'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
