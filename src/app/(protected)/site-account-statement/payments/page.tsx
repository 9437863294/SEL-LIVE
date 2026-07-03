'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  addDoc, collection, deleteDoc, doc, getDocs, orderBy, query, serverTimestamp, updateDoc,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  formatINR, PAYMENT_MODES, SAS_COLLECTIONS,
  type SASPayment, type SASProject,
} from '@/lib/site-account-statement';
import { useAuth } from '@/components/auth/AuthProvider';
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
import { Download, Loader2, Pencil, Plus, TrendingUp, Trash2, Upload } from 'lucide-react';
import ExcelJS from 'exceljs';
import { VehicleImportDialog, type ImportField } from '@/components/vehicle-management/import-dialog';

const MODULE   = 'Site Account Statement';
const RESOURCE = 'Payments';

interface FormState {
  projectId: string;
  projectName: string;
  receiptDate: string;
  receivedAmount: string;
  paymentMode: string;
  referenceNo: string;
  receivedBy: string;
  remarks: string;
}

const blank = (): FormState => ({
  projectId: '', projectName: '', receiptDate: '',
  receivedAmount: '', paymentMode: 'Cash', referenceNo: '',
  receivedBy: '', remarks: '',
});

export default function PaymentsPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { log } = useActivityLogger('Site Account Statement');
  const { toast } = useToast();
  const { user } = useAuth();

  const canViewAll   = can('View', `${MODULE}.All Projects`);
  const canView      = can('View',   `${MODULE}.${RESOURCE}`) || canViewAll;
  const canAdd       = can('Add',    `${MODULE}.${RESOURCE}`);
  const canEdit      = can('Edit',   `${MODULE}.${RESOURCE}`);
  const canDelete    = can('Delete', `${MODULE}.${RESOURCE}`);
  const canExport    = can('Export', `${MODULE}.${RESOURCE}`);
  const canImport    = canAdd;

  const [projects,  setProjects]  = useState<SASProject[]>([]);
  const [payments,  setPayments]  = useState<SASPayment[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [saving,           setSaving]           = useState(false);
  const [exporting,        setExporting]        = useState(false);
  const [dialogOpen,       setDialogOpen]       = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<SASPayment | null>(null);
  const [form,      setForm]      = useState<FormState>(blank());

  // Filters
  const [filterProject, setFilterProject] = useState('');
  const [filterFrom,    setFilterFrom]    = useState('');
  const [filterTo,      setFilterTo]      = useState('');
  const [search,        setSearch]        = useState('');

  useEffect(() => {
    if (!isAuthLoading && canView) void loadAll();
  }, [isAuthLoading, canView]);

  async function loadAll() {
    setLoading(true);
    try {
      const [pSnap, paySnap] = await Promise.all([
        getDocs(query(collection(db, SAS_COLLECTIONS.projects), orderBy('projectName'))),
        getDocs(query(collection(db, SAS_COLLECTIONS.payments), orderBy('receiptDate', 'desc'))),
      ]);
      setProjects(pSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASProject)).filter(p => p.enabledForSiteAccount && p.status === 'Active'));
      setPayments(paySnap.docs.map(d => ({ id: d.id, ...d.data() } as SASPayment)));
    } finally {
      setLoading(false);
    }
  }

  function openAdd() {
    setEditingRow(null);
    setForm(blank());
    setDialogOpen(true);
  }

  function openEdit(row: SASPayment) {
    setEditingRow(row);
    setForm({
      projectId: row.projectId,
      projectName: row.projectName,
      receiptDate: row.receiptDate,
      receivedAmount: String(row.receivedAmount),
      paymentMode: row.paymentMode,
      referenceNo: row.referenceNo || '',
      receivedBy: row.receivedBy || '',
      remarks: row.remarks || '',
    });
    setDialogOpen(true);
  }

  function setField(key: keyof FormState, value: string) {
    setForm(f => ({ ...f, [key]: value }));
  }

  function selectProject(id: string) {
    const proj = visibleProjects.find(p => p.id === id);
    setForm(f => ({ ...f, projectId: id, projectName: proj?.projectName || '' }));
  }

  // ── Projects visible to this user (admins see all, others see only assigned) ─
  const visibleProjects = useMemo(
    () => canViewAll ? projects : projects.filter(p => p.assignedPersonId === user?.id),
    [projects, user?.id, canViewAll]
  );

  const userProjectIds = useMemo(
    () => canViewAll ? null : new Set(visibleProjects.map(p => p.id)),
    [visibleProjects, canViewAll]
  );

  // ── Import field definitions (validate against visible projects) ─────────────
  const paymentImportFields = useMemo<ImportField[]>(() => [
    {
      key: 'projectName',
      label: 'Project Name',
      required: true,
      hint: 'Must exactly match an enabled project name',
      validate: (v) => {
        const match = visibleProjects.find(p => p.projectName.toLowerCase() === v.trim().toLowerCase());
        return match ? null : `Project "${v}" not found — check enabled projects`;
      },
    },
    {
      key: 'receiptDate',
      label: 'Receipt Date',
      required: true,
      hint: 'YYYY-MM-DD  e.g. 2024-07-15',
      validate: (v) => /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? null : 'Date must be in YYYY-MM-DD format',
    },
    {
      key: 'receivedAmount',
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
    { key: 'referenceNo', label: 'Reference No.',  hint: 'Transaction / UTR / Cheque number' },
    { key: 'receivedBy',  label: 'Received By',    hint: 'Name of person who received' },
    { key: 'remarks',     label: 'Remarks' },
  ], [visibleProjects]);

  async function savePaymentRow(row: Record<string, any>) {
    const projName = String(row.projectName || '').trim();
    const proj = visibleProjects.find(p => p.projectName.toLowerCase() === projName.toLowerCase());
    if (!proj) throw new Error(`Project "${projName}" not found`);

    const amount = Number(row.receivedAmount);
    if (!amount || amount <= 0) throw new Error('Amount must be > 0');

    const mode = PAYMENT_MODES.includes(row.paymentMode as any) ? row.paymentMode : 'Cash';

    await addDoc(collection(db, SAS_COLLECTIONS.payments), {
      projectId:      proj.id,
      projectName:    proj.projectName,
      receiptDate:    String(row.receiptDate || '').trim(),
      receivedAmount: amount,
      paymentMode:    mode,
      referenceNo:    String(row.referenceNo    || '').trim(),
      receivedBy:     String(row.receivedBy     || '').trim(),
      remarks:        String(row.remarks        || '').trim(),
      createdAt:      serverTimestamp(),
      updatedAt:      serverTimestamp(),
    });
  }

  async function handleSubmit() {
    if (!form.projectId) {
      toast({ title: 'Validation', description: 'Select a project.', variant: 'destructive' });
      return;
    }
    if (!form.receiptDate) {
      toast({ title: 'Validation', description: 'Receipt date is required.', variant: 'destructive' });
      return;
    }
    const amount = Number(form.receivedAmount);
    if (!amount || amount <= 0) {
      toast({ title: 'Validation', description: 'Enter a valid amount.', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      const data = {
        projectId: form.projectId,
        projectName: form.projectName,
        receiptDate: form.receiptDate,
        receivedAmount: amount,
        paymentMode: form.paymentMode,
        referenceNo: form.referenceNo.trim(),
        receivedBy: form.receivedBy.trim(),
        remarks: form.remarks.trim(),
        updatedAt: serverTimestamp(),
      };
      if (editingRow) {
        await updateDoc(doc(db, SAS_COLLECTIONS.payments, editingRow.id), data);
        void log('Edit SAS Payment', { project: form.projectName, amount });
        toast({ title: 'Updated', description: 'Payment updated.' });
      } else {
        await addDoc(collection(db, SAS_COLLECTIONS.payments), { ...data, createdAt: serverTimestamp() });
        void log('Add SAS Payment', { project: form.projectName, amount });
        toast({ title: 'Added', description: 'Payment recorded.' });
      }
      setDialogOpen(false);
      void loadAll();
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(row: SASPayment) {
    try {
      await deleteDoc(doc(db, SAS_COLLECTIONS.payments, row.id));
      void log('Delete SAS Payment', { project: row.projectName });
      toast({ title: 'Deleted', description: 'Payment deleted.' });
      void loadAll();
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
  }

  const filtered = useMemo(() => payments.filter(p => {
    if (userProjectIds && !userProjectIds.has(p.projectId))                                      return false;
    if (filterProject && p.projectId !== filterProject)                                          return false;
    if (filterFrom && p.receiptDate < filterFrom)                                                return false;
    if (filterTo   && p.receiptDate > filterTo)                                                  return false;
    if (search && !(p.projectName  || '').toLowerCase().includes(search.toLowerCase()) &&
                  !(p.receivedBy   || '').toLowerCase().includes(search.toLowerCase()) &&
                  !(p.referenceNo  || '').toLowerCase().includes(search.toLowerCase()))          return false;
    return true;
  }), [payments, userProjectIds, filterProject, filterFrom, filterTo, search]);

  const totalFiltered = useMemo(() => filtered.reduce((s, p) => s + (p.receivedAmount || 0), 0), [filtered]);

  async function exportExcel() {
    setExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Payments Received');
      ws.columns = [
        { header: 'Project', key: 'projectName', width: 28 },
        { header: 'Receipt Date', key: 'receiptDate', width: 14 },
        { header: 'Amount (₹)', key: 'receivedAmount', width: 14 },
        { header: 'Payment Mode', key: 'paymentMode', width: 14 },
        { header: 'Reference No.', key: 'referenceNo', width: 20 },
        { header: 'Received By', key: 'receivedBy', width: 20 },
        { header: 'Remarks', key: 'remarks', width: 30 },
      ];
      ws.getRow(1).font = { bold: true };
      filtered.forEach(p => ws.addRow({ ...p }));
      const buf = await wb.xlsx.writeBuffer();
      const url = URL.createObjectURL(new Blob([buf]));
      const a = document.createElement('a');
      a.href = url; a.download = 'payments-received.xlsx'; a.click();
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
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-bold text-slate-800">Payments Received</h1>
          <p className="text-sm text-muted-foreground">Payments received from Head Office per project</p>
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
            <Button size="sm" onClick={openAdd} className="gap-2 bg-emerald-600 hover:bg-emerald-700">
              <Plus className="h-4 w-4" /> Add Payment
            </Button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Select value={filterProject || '_all_'} onValueChange={v => setFilterProject(v === '_all_' ? '' : v)}>
          <SelectTrigger className="h-9 text-sm">
            <SelectValue placeholder="All Projects" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_all_">All Projects</SelectItem>
            {visibleProjects.map(p => <SelectItem key={p.id} value={p.id}>{p.projectName}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} className="h-9 text-sm" placeholder="From" />
        <Input type="date" value={filterTo}   onChange={e => setFilterTo(e.target.value)}   className="h-9 text-sm" placeholder="To" />
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..." className="h-9 text-sm" />
      </div>

      {/* Summary */}
      <div className="flex items-center gap-3 rounded-lg border bg-blue-50 px-4 py-2.5 text-blue-700">
        <TrendingUp className="h-4 w-4 shrink-0" />
        <span className="text-sm font-medium">Total shown: <strong>{formatINR(totalFiltered)}</strong> across {filtered.length} record{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Table */}
      <Card className="bg-white/80 backdrop-blur-sm">
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <TrendingUp className="h-10 w-10 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">{payments.length === 0 ? 'No payments recorded yet.' : 'No payments match filters.'}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="px-4 py-2.5 text-left font-medium">Project</th>
                    <th className="px-4 py-2.5 text-left font-medium">Date</th>
                    <th className="px-4 py-2.5 text-right font-medium">Amount</th>
                    <th className="px-4 py-2.5 text-left font-medium">Mode</th>
                    <th className="px-4 py-2.5 text-left font-medium">Reference No.</th>
                    <th className="px-4 py-2.5 text-left font-medium">Received By</th>
                    <th className="px-4 py-2.5 text-left font-medium">Remarks</th>
                    {(canEdit || canDelete) && <th className="px-4 py-2.5 text-right font-medium">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(row => (
                    <tr key={row.id} className="border-b hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-2.5 font-medium max-w-[160px] truncate">{row.projectName}</td>
                      <td className="px-4 py-2.5">{row.receiptDate}</td>
                      <td className="px-4 py-2.5 text-right font-semibold text-blue-700">{formatINR(row.receivedAmount)}</td>
                      <td className="px-4 py-2.5"><Badge variant="secondary">{row.paymentMode}</Badge></td>
                      <td className="px-4 py-2.5 text-muted-foreground">{row.referenceNo || '—'}</td>
                      <td className="px-4 py-2.5">{row.receivedBy || '—'}</td>
                      <td className="px-4 py-2.5 text-muted-foreground max-w-[150px] truncate">{row.remarks || '—'}</td>
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
                                    <AlertDialogTitle>Delete Payment</AlertDialogTitle>
                                    <AlertDialogDescription>Delete this payment record? This cannot be undone.</AlertDialogDescription>
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
                    <td colSpan={2} className="px-4 py-2.5">Total</td>
                    <td className="px-4 py-2.5 text-right text-blue-700">{formatINR(totalFiltered)}</td>
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
        title="Import Payments Received"
        fields={paymentImportFields}
        onSaveRow={savePaymentRow}
        onImportComplete={() => { void log('Import SAS Payments', {}); void loadAll(); }}
      />

      {/* Add / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingRow ? 'Edit Payment' : 'Record Payment Received'}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="col-span-2 space-y-1.5">
              <Label>Project <span className="text-destructive">*</span></Label>
              <Select value={form.projectId} onValueChange={selectProject}>
                <SelectTrigger><SelectValue placeholder="Select project" /></SelectTrigger>
                <SelectContent>
                  {visibleProjects.map(p => <SelectItem key={p.id} value={p.id}>{p.projectName}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Receipt Date <span className="text-destructive">*</span></Label>
              <Input type="date" value={form.receiptDate} onChange={e => setField('receiptDate', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Amount (₹) <span className="text-destructive">*</span></Label>
              <Input type="number" min="0" value={form.receivedAmount} onChange={e => setField('receivedAmount', e.target.value)} placeholder="0" />
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
              <Label>Reference No.</Label>
              <Input value={form.referenceNo} onChange={e => setField('referenceNo', e.target.value)} placeholder="Txn / UTR / Cheque No." />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label>Received By</Label>
              <Input value={form.receivedBy} onChange={e => setField('receivedBy', e.target.value)} placeholder="Person who received the amount" />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label>Remarks</Label>
              <Textarea rows={2} value={form.remarks} onChange={e => setField('remarks', e.target.value)} placeholder="Additional notes" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700">
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {editingRow ? 'Save Changes' : 'Record Payment'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
