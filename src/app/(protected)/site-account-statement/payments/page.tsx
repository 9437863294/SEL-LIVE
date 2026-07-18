'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  addDoc, collection, deleteDoc, doc, getDocs, orderBy, query, serverTimestamp, updateDoc,
} from 'firebase/firestore';
import { deleteObject, getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import { db, storage } from '@/lib/firebase';
import {
  formatINR, PAYMENT_MODES, SAS_COLLECTIONS,
  type SASAttachment, type SASExpense, type SASPayment, type SASProject,
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
import {
  Camera, Calendar, ChevronLeft, ChevronRight,
  Download, ExternalLink, File, FileText, Filter, Image, Loader2,
  Paperclip, Pencil, Plus, Receipt, TrendingDown, TrendingUp, Trash2, Upload, Wallet, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import ExcelJS from 'exceljs';
import { VehicleImportDialog, type ImportField } from '@/components/vehicle-management/import-dialog';

const MODULE   = 'Site Account Statement';
const RESOURCE = 'Payments';
const ACCEPT   = '.pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.txt';
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

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

function getMonthRange(fromDate?: string, offset = 0) {
  let y: number, m: number;
  if (fromDate) {
    const parts = fromDate.split('-').map(Number);
    y = parts[0]; m = parts[1] - 1 + offset;
  } else {
    const now = new Date();
    y = now.getFullYear(); m = now.getMonth() + offset;
  }
  const d = new Date(y, m, 1);
  y = d.getFullYear(); m = d.getMonth();
  const start = `${y}-${String(m + 1).padStart(2, '0')}-01`;
  const lastDay = new Date(y, m + 1, 0).getDate();
  const end   = `${y}-${String(m + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { start, end, year: y, month: m };
}

function formatSize(bytes: number): string {
  if (bytes < 1024)    return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function AttachmentIcon({ type }: { type: string }) {
  if (type.startsWith('image/')) return <Image className="h-4 w-4 text-sky-500 shrink-0" />;
  if (type === 'application/pdf')  return <FileText className="h-4 w-4 text-rose-500 shrink-0" />;
  return <File className="h-4 w-4 text-slate-400 shrink-0" />;
}

function formatTimestamp(ts: any): string {
  if (!ts) return '—';
  const d: Date | null = ts?.toDate?.() ?? (ts?.seconds ? new Date(ts.seconds * 1000) : null);
  if (!d || isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

export default function PaymentsPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { log } = useActivityLogger('Site Account Statement');
  const { toast } = useToast();
  const { user } = useAuth();
  const fileInputRef   = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const canViewAll = can('View', `${MODULE}.All Projects`);
  const canAdd     = can('Add',    `${MODULE}.${RESOURCE}`);
  const canEdit    = can('Edit',   `${MODULE}.${RESOURCE}`);
  const canDelete  = can('Delete', `${MODULE}.${RESOURCE}`);
  const canExport  = can('Export', `${MODULE}.${RESOURCE}`);
  const canImport  = canAdd;

  const [projects,  setProjects]  = useState<SASProject[]>([]);
  const [payments,  setPayments]  = useState<SASPayment[]>([]);
  const [expenses,  setExpenses]  = useState<SASExpense[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [saving,           setSaving]           = useState(false);
  const [uploading,        setUploading]        = useState(false);
  const [exporting,        setExporting]        = useState(false);
  const [dialogOpen,       setDialogOpen]       = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [editingRow,       setEditingRow]       = useState<SASPayment | null>(null);
  const [form,             setForm]             = useState<FormState>(blank());

  // Attachment state
  const [pendingFiles,        setPendingFiles]        = useState<File[]>([]);
  const [existingAttachments, setExistingAttachments] = useState<SASAttachment[]>([]);
  const [removedAttachments,  setRemovedAttachments]  = useState<SASAttachment[]>([]);
  const [viewPayment,         setViewPayment]         = useState<SASPayment | null>(null);

  // Filters — default to current month
  const [filterProject, setFilterProject] = useState('');
  const [filterFrom,    setFilterFrom]    = useState(() => getMonthRange().start);
  const [filterTo,      setFilterTo]      = useState(() => getMonthRange().end);
  const [search,        setSearch]        = useState('');
  const [showFilters,   setShowFilters]   = useState(false);

  useEffect(() => {
    if (!isAuthLoading) void loadAll();
  }, [isAuthLoading]);

  async function loadAll() {
    setLoading(true);
    try {
      const [pSnap, paySnap, expSnap] = await Promise.all([
        getDocs(query(collection(db, SAS_COLLECTIONS.projects), orderBy('projectName'))),
        getDocs(query(collection(db, SAS_COLLECTIONS.payments), orderBy('receiptDate', 'desc'))),
        getDocs(query(collection(db, SAS_COLLECTIONS.expenses))),
      ]);
      setProjects(pSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASProject)).filter(p => p.enabledForSiteAccount && p.status === 'Active'));
      setPayments(paySnap.docs.map(d => ({ id: d.id, ...d.data() } as SASPayment)));
      setExpenses(expSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASExpense)));
    } finally {
      setLoading(false);
    }
  }

  function openAdd() {
    setEditingRow(null);
    setForm(blank());
    setPendingFiles([]);
    setExistingAttachments([]);
    setRemovedAttachments([]);
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
    setPendingFiles([]);
    setExistingAttachments(row.attachments ? [...row.attachments] : []);
    setRemovedAttachments([]);
    setDialogOpen(true);
  }

  function setField(key: keyof FormState, value: string) {
    setForm(f => ({ ...f, [key]: value }));
  }

  function selectProject(id: string) {
    const proj = visibleProjects.find(p => p.id === id);
    setForm(f => ({ ...f, projectId: id, projectName: proj?.projectName || '' }));
  }

  // ── Projects visible to this user ──────────────────────────────────────────
  const visibleProjects = useMemo(
    () => canViewAll ? projects : projects.filter(p =>
      p.assignedPersonId === user?.id || p.altUserId === user?.id || p.viewerId === user?.id
    ),
    [projects, user?.id, canViewAll]
  );

  const userProjectIds = useMemo(
    () => canViewAll ? null : new Set(visibleProjects.map(p => p.id)),
    [visibleProjects, canViewAll]
  );

  const isAltUser = useMemo(
    () => !canViewAll && visibleProjects.some(p => p.altUserId === user?.id),
    [canViewAll, visibleProjects, user?.id]
  );
  const effectiveCanAdd    = canAdd    || isAltUser;
  const effectiveCanEdit   = canEdit   || isAltUser;
  const effectiveCanImport = canImport || isAltUser;

  // ── Month navigation ─────────────────────────────────────────────────────────
  function shiftMonth(offset: number) {
    const { start, end } = getMonthRange(filterFrom, offset);
    setFilterFrom(start);
    setFilterTo(end);
  }

  function goToCurrentMonth() {
    const { start, end } = getMonthRange();
    setFilterFrom(start);
    setFilterTo(end);
  }

  const monthLabel = useMemo(() => {
    if (!filterFrom) return 'All Time';
    const [y, m] = filterFrom.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  }, [filterFrom]);

  // ── Opening / closing balance ────────────────────────────────────────────────
  const openingBalance = useMemo(() => {
    if (!filterFrom) return null;
    const inScope = (id: string) => filterProject ? id === filterProject : (!userProjectIds || userProjectIds.has(id));
    const rec = payments.filter(p => inScope(p.projectId) && p.receiptDate < filterFrom)
      .reduce((s, p) => s + (p.receivedAmount || 0), 0);
    const exp = expenses.filter(e => inScope(e.projectId) && e.expenseDate < filterFrom)
      .reduce((s, e) => s + (e.expenseAmount || 0), 0);
    return rec - exp;
  }, [filterFrom, filterProject, payments, expenses, userProjectIds]);

  const periodExpenses = useMemo(() => expenses
    .filter(e => {
      if (filterProject && e.projectId !== filterProject) return false;
      if (userProjectIds && !userProjectIds.has(e.projectId)) return false;
      if (filterFrom && e.expenseDate < filterFrom) return false;
      if (filterTo   && e.expenseDate > filterTo)   return false;
      return true;
    })
    .reduce((s, e) => s + (e.expenseAmount || 0), 0),
  [filterFrom, filterTo, filterProject, expenses, userProjectIds]);

  // ── Import field definitions ──────────────────────────────────────────────────
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
      attachments:    [],
      createdAt:      serverTimestamp(),
      updatedAt:      serverTimestamp(),
    });
  }

  // ── Attachment helpers ────────────────────────────────────────────────────────
  async function uploadAttachments(paymentId: string, files: File[]): Promise<SASAttachment[]> {
    return Promise.all(files.map(async file => {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `siteAccountPayments/${paymentId}/${Date.now()}-${safeName}`;
      const sRef = storageRef(storage, path);
      await uploadBytes(sRef, file);
      const url = await getDownloadURL(sRef);
      return { name: file.name, url, storagePath: path, size: file.size, type: file.type || 'application/octet-stream' };
    }));
  }

  function addFiles(files: File[]) {
    const tooBig = files.filter(f => f.size > MAX_SIZE);
    const ok     = files.filter(f => f.size <= MAX_SIZE);
    if (tooBig.length > 0) {
      toast({
        title: 'File too large',
        description: `${tooBig.map(f => f.name).join(', ')} exceed${tooBig.length === 1 ? 's' : ''} the 5 MB limit and were skipped.`,
        variant: 'destructive',
      });
    }
    if (ok.length > 0) setPendingFiles(prev => [...prev, ...ok]);
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (files.length === 0) return;
    addFiles(files);
  }

  function handleCameraSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (cameraInputRef.current) cameraInputRef.current.value = '';
    if (files.length === 0) return;
    addFiles(files);
  }

  function handleRemovePending(idx: number) {
    setPendingFiles(prev => prev.filter((_, i) => i !== idx));
  }

  function handleRemoveExisting(idx: number) {
    const att = existingAttachments[idx];
    setExistingAttachments(prev => prev.filter((_, i) => i !== idx));
    setRemovedAttachments(prev => [...prev, att]);
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
    if (pendingFiles.length > 0) setUploading(true);
    try {
      const baseData = {
        projectId:      form.projectId,
        projectName:    form.projectName,
        receiptDate:    form.receiptDate,
        receivedAmount: amount,
        paymentMode:    form.paymentMode,
        referenceNo:    form.referenceNo.trim(),
        receivedBy:     form.receivedBy.trim(),
        remarks:        form.remarks.trim(),
        updatedAt:      serverTimestamp(),
      };
      if (editingRow) {
        await Promise.allSettled(
          removedAttachments.map(a => deleteObject(storageRef(storage, a.storagePath)))
        );
        const newAttachments = await uploadAttachments(editingRow.id, pendingFiles);
        const finalAttachments = [...existingAttachments, ...newAttachments];
        await updateDoc(doc(db, SAS_COLLECTIONS.payments, editingRow.id), {
          ...baseData, attachments: finalAttachments,
        });
        void log('Edit SAS Payment', { project: form.projectName, amount });
        toast({ title: 'Updated', description: 'Payment updated.' });
      } else {
        const docRef = await addDoc(collection(db, SAS_COLLECTIONS.payments), {
          ...baseData, attachments: [], createdAt: serverTimestamp(),
        });
        const attachments = await uploadAttachments(docRef.id, pendingFiles);
        if (attachments.length > 0) {
          await updateDoc(docRef, { attachments });
        }
        void log('Add SAS Payment', { project: form.projectName, amount });
        toast({ title: 'Added', description: `Payment recorded${attachments.length > 0 ? ` with ${attachments.length} attachment${attachments.length > 1 ? 's' : ''}` : ''}.` });
      }
      setDialogOpen(false);
      void loadAll();
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
      setUploading(false);
    }
  }

  async function handleDelete(row: SASPayment) {
    try {
      if (row.attachments?.length) {
        await Promise.allSettled(
          row.attachments.map(a => deleteObject(storageRef(storage, a.storagePath)))
        );
      }
      await deleteDoc(doc(db, SAS_COLLECTIONS.payments, row.id));
      void log('Delete SAS Payment', { project: row.projectName });
      toast({ title: 'Deleted', description: 'Payment and attachments deleted.' });
      void loadAll();
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
  }

  const filtered = useMemo(() => payments.filter(p => {
    if (userProjectIds && !userProjectIds.has(p.projectId))                             return false;
    if (filterProject && p.projectId !== filterProject)                                 return false;
    if (filterFrom && p.receiptDate < filterFrom)                                       return false;
    if (filterTo   && p.receiptDate > filterTo)                                         return false;
    if (search && !(p.projectName  || '').toLowerCase().includes(search.toLowerCase()) &&
                  !(p.receivedBy   || '').toLowerCase().includes(search.toLowerCase()) &&
                  !(p.referenceNo  || '').toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), [payments, userProjectIds, filterProject, filterFrom, filterTo, search]);

  const totalFiltered = useMemo(() => filtered.reduce((s, p) => s + (p.receivedAmount || 0), 0), [filtered]);

  const closingBalance = useMemo(
    () => openingBalance === null ? null : openingBalance + totalFiltered - periodExpenses,
    [openingBalance, totalFiltered, periodExpenses]
  );

  async function exportExcel() {
    setExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Payments Received');

      // Balance summary rows at top
      if (openingBalance !== null) {
        ws.addRow(['Period', filterFrom || '', 'to', filterTo || '']);
        ws.addRow(['Opening Balance', openingBalance]);
        ws.addRow(['Receipts (period)', totalFiltered]);
        ws.addRow(['Expenses (period)', periodExpenses]);
        ws.addRow(['Closing Balance', closingBalance ?? '']);
        ws.addRow([]);
      }

      const headerRow = ws.rowCount + 1;
      ws.columns = [
        { header: 'Project',       key: 'projectName',    width: 28 },
        { header: 'Receipt Date',  key: 'receiptDate',    width: 14 },
        { header: 'Amount (₹)',    key: 'receivedAmount', width: 14 },
        { header: 'Payment Mode',  key: 'paymentMode',    width: 14 },
        { header: 'Reference No.', key: 'referenceNo',    width: 20 },
        { header: 'Received By',   key: 'receivedBy',     width: 20 },
        { header: 'Remarks',       key: 'remarks',        width: 30 },
        { header: 'Recorded At',   key: 'createdAtStr',   width: 22 },
      ];
      ws.getRow(headerRow).font = { bold: true };
      filtered.forEach(p => ws.addRow({ ...p, createdAtStr: formatTimestamp(p.createdAt) }));
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
          {effectiveCanImport && (
            <Button variant="outline" size="sm" onClick={() => setImportDialogOpen(true)} className="gap-2">
              <Upload className="h-4 w-4" /> Import
            </Button>
          )}
          {effectiveCanAdd && (
            <Button size="sm" onClick={openAdd} className="gap-2 bg-emerald-600 hover:bg-emerald-700">
              <Plus className="h-4 w-4" /> Add Payment
            </Button>
          )}
        </div>
      </div>

      {/* Month navigation */}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" className="h-8 px-2.5 gap-1" onClick={() => shiftMonth(-1)}>
          <ChevronLeft className="h-3.5 w-3.5" /> Prev
        </Button>
        <div className="flex items-center gap-1.5 rounded-md border bg-white/80 px-3 py-1.5 text-sm font-medium min-w-[160px] justify-center">
          <Calendar className="h-3.5 w-3.5 text-emerald-500" />
          <span>{monthLabel}</span>
        </div>
        <Button variant="outline" size="sm" className="h-8 px-2.5 gap-1" onClick={() => shiftMonth(1)}>
          Next <ChevronRight className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground" onClick={goToCurrentMonth}>
          This Month
        </Button>
        <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground" onClick={() => { setFilterFrom(''); setFilterTo(''); }}>
          All Time
        </Button>
      </div>

      {/* Mobile filter toggle */}
      {(() => {
        const activeCount = [filterProject, search].filter(Boolean).length;
        return (
          <div className="flex items-center gap-2 sm:hidden">
            <Button variant="outline" size="sm" className="h-9 gap-2 flex-1 justify-center"
              onClick={() => setShowFilters(s => !s)}>
              <Filter className="h-3.5 w-3.5" />
              {showFilters ? 'Hide Filters' : 'Filters'}
              {activeCount > 0 && (
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-600 text-[9px] font-bold text-white">
                  {activeCount}
                </span>
              )}
            </Button>
          </div>
        );
      })()}

      {/* Filters (collapsible on mobile, always visible on sm+) */}
      <div className={cn('grid grid-cols-2 gap-2 sm:grid-cols-4', !showFilters && 'hidden sm:grid')}>
        <Select value={filterProject || '_all_'} onValueChange={v => setFilterProject(v === '_all_' ? '' : v)}>
          <SelectTrigger className="h-9 text-sm">
            <SelectValue placeholder="All Projects" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_all_">All Projects</SelectItem>
            {visibleProjects.map(p => <SelectItem key={p.id} value={p.id}>{p.projectName}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} className="h-9 text-sm" />
        <Input type="date" value={filterTo}   onChange={e => setFilterTo(e.target.value)}   className="h-9 text-sm" />
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..." className="h-9 text-sm" />
      </div>

      {/* Opening / Closing balance strip */}
      {openingBalance !== null && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="flex items-center gap-2.5 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2.5">
            <Wallet className="h-4 w-4 shrink-0 text-emerald-600" />
            <div className="min-w-0">
              <p className="text-[10px] font-medium text-emerald-600 uppercase tracking-wide">Opening Balance</p>
              <p className={`text-sm font-bold leading-tight ${openingBalance >= 0 ? 'text-emerald-700' : 'text-destructive'}`}>
                {formatINR(openingBalance)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2.5 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2.5">
            <TrendingUp className="h-4 w-4 shrink-0 text-blue-600" />
            <div className="min-w-0">
              <p className="text-[10px] font-medium text-blue-600 uppercase tracking-wide">Receipts ({filtered.length})</p>
              <p className="text-sm font-bold text-blue-700 leading-tight">{formatINR(totalFiltered)}</p>
            </div>
          </div>
          <div className="flex items-center gap-2.5 rounded-xl border border-rose-100 bg-rose-50 px-3 py-2.5">
            <TrendingDown className="h-4 w-4 shrink-0 text-rose-600" />
            <div className="min-w-0">
              <p className="text-[10px] font-medium text-rose-600 uppercase tracking-wide">Expenses</p>
              <p className="text-sm font-bold text-rose-700 leading-tight">{formatINR(periodExpenses)}</p>
            </div>
          </div>
          <div className="flex items-center gap-2.5 rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-2.5">
            <Receipt className="h-4 w-4 shrink-0 text-indigo-600" />
            <div className="min-w-0">
              <p className="text-[10px] font-medium text-indigo-600 uppercase tracking-wide">Closing Balance</p>
              <p className={`text-sm font-bold leading-tight ${(closingBalance ?? 0) >= 0 ? 'text-indigo-700' : 'text-destructive'}`}>
                {closingBalance !== null ? formatINR(closingBalance) : '—'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Summary bar */}
      <div className="flex items-center gap-3 rounded-lg border bg-blue-50 px-4 py-2.5 text-blue-700">
        <TrendingUp className="h-4 w-4 shrink-0" />
        <span className="text-sm font-medium">
          Total shown: <strong>{formatINR(totalFiltered)}</strong> across {filtered.length} record{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Table */}
      <Card className="bg-white/80 backdrop-blur-sm">
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <TrendingUp className="h-10 w-10 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                {payments.length === 0 ? 'No payments recorded yet.' : 'No payments match filters.'}
              </p>
            </div>
          ) : (
            <div className="overflow-auto max-h-[60vh]">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10">
                  <tr className="border-b bg-slate-100">
                    <th className="px-4 py-2.5 text-left font-medium">Project</th>
                    <th className="px-4 py-2.5 text-left font-medium">Date</th>
                    <th className="px-4 py-2.5 text-right font-medium">Amount</th>
                    <th className="px-4 py-2.5 text-left font-medium">Mode</th>
                    <th className="px-4 py-2.5 text-left font-medium">Reference No.</th>
                    <th className="px-4 py-2.5 text-left font-medium">Received By</th>
                    <th className="px-4 py-2.5 text-center font-medium">
                      <Paperclip className="h-3.5 w-3.5 inline" />
                    </th>
                    <th className="px-4 py-2.5 text-left font-medium">Remarks</th>
                    <th className="px-4 py-2.5 text-left font-medium whitespace-nowrap">Recorded At</th>
                    {(effectiveCanEdit || canDelete) && <th className="px-4 py-2.5 text-right font-medium">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(row => (
                    <tr key={row.id} className="border-b hover:bg-muted/20 transition-colors cursor-pointer" onClick={() => setViewPayment(row)}>
                      <td className="px-4 py-2.5 font-medium max-w-[160px] truncate">{row.projectName}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap">{row.receiptDate}</td>
                      <td className="px-4 py-2.5 text-right font-semibold text-blue-700">{formatINR(row.receivedAmount)}</td>
                      <td className="px-4 py-2.5"><Badge variant="secondary">{row.paymentMode}</Badge></td>
                      <td className="px-4 py-2.5 text-muted-foreground">{row.referenceNo || '—'}</td>
                      <td className="px-4 py-2.5">{row.receivedBy || '—'}</td>
                      <td className="px-4 py-2.5 text-center">
                        {row.attachments && row.attachments.length > 0 ? (
                          <button
                            onClick={e => { e.stopPropagation(); setViewPayment(row); }}
                            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-blue-600 hover:bg-blue-50 transition-colors"
                          >
                            <Paperclip className="h-3.5 w-3.5" />
                            <span className="text-xs font-medium">{row.attachments.length}</span>
                          </button>
                        ) : (
                          <Paperclip className="h-3.5 w-3.5 text-muted-foreground/25 mx-auto" />
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground max-w-[150px] truncate">{row.remarks || '—'}</td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{formatTimestamp(row.createdAt)}</td>
                      {(effectiveCanEdit || canDelete) && (
                        <td className="px-4 py-2.5 text-right">
                          <div className="flex justify-end gap-1" onClick={e => e.stopPropagation()}>
                            {effectiveCanEdit && (
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
                                    <AlertDialogDescription>
                                      Delete this payment record{row.attachments?.length ? ` and its ${row.attachments.length} attachment${row.attachments.length > 1 ? 's' : ''}` : ''}? This cannot be undone.
                                    </AlertDialogDescription>
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
                    <td colSpan={(effectiveCanEdit || canDelete) ? 7 : 6} />
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

      {/* Payment Detail Dialog */}
      <Dialog open={!!viewPayment} onOpenChange={() => setViewPayment(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-emerald-500" />
              Payment Details
            </DialogTitle>
          </DialogHeader>
          {viewPayment && (
            <div className="space-y-4 py-1">
              {/* Amount highlight */}
              <div className="rounded-xl border bg-emerald-50 px-4 py-3 text-center">
                <p className="text-xs font-medium uppercase tracking-wide text-emerald-500">Amount Received</p>
                <p className="text-2xl font-bold text-emerald-700">{formatINR(viewPayment.receivedAmount)}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{viewPayment.receiptDate} &bull; <Badge variant="secondary" className="text-xs">{viewPayment.paymentMode}</Badge></p>
              </div>

              {/* Fields grid */}
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Project</p>
                  <p className="font-medium mt-0.5">{viewPayment.projectName}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Received By</p>
                  <p className="mt-0.5">{viewPayment.receivedBy || '—'}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Reference No.</p>
                  <p className="mt-0.5">{viewPayment.referenceNo || '—'}</p>
                </div>
                {viewPayment.remarks && (
                  <div className="col-span-2">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Remarks</p>
                    <p className="mt-0.5">{viewPayment.remarks}</p>
                  </div>
                )}
                <div className="col-span-2 border-t pt-3">
                  <p className="text-xs text-muted-foreground">Recorded: {formatTimestamp(viewPayment.createdAt)}</p>
                </div>
              </div>

              {/* Attachments */}
              {viewPayment.attachments && viewPayment.attachments.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                    <Paperclip className="h-3.5 w-3.5" />
                    Attachments ({viewPayment.attachments.length})
                  </p>
                  {viewPayment.attachments.map((att, i) => (
                    <a
                      key={i}
                      href={att.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 rounded-lg border bg-muted/20 px-3 py-2.5 hover:bg-muted/50 transition-colors group"
                    >
                      <AttachmentIcon type={att.type} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{att.name}</p>
                        <p className="text-xs text-muted-foreground">{formatSize(att.size)}</p>
                      </div>
                      <ExternalLink className="h-3.5 w-3.5 text-muted-foreground group-hover:text-blue-500 shrink-0 transition-colors" />
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewPayment(null)}>Close</Button>
            {effectiveCanEdit && viewPayment && (
              <Button
                className="bg-emerald-600 hover:bg-emerald-700"
                onClick={() => { const p = viewPayment; setViewPayment(null); openEdit(p); }}
              >
                <Pencil className="h-3.5 w-3.5 mr-1.5" /> Edit
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={open => { if (!open && !saving) setDialogOpen(false); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
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

            {/* ── Attachments ─────────────────────────────────────────────────── */}
            <div className="col-span-2 space-y-2">
              <Label className="flex items-center gap-1.5">
                <Paperclip className="h-3.5 w-3.5" />
                Attachments
                <span className="text-muted-foreground text-xs font-normal">— PDF, images, Word, Excel</span>
              </Label>

              {/* Existing uploaded files */}
              {existingAttachments.map((att, i) => (
                <div key={i} className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
                  <AttachmentIcon type={att.type} />
                  <a
                    href={att.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 text-sm text-blue-600 hover:underline truncate"
                  >
                    {att.name}
                  </a>
                  <span className="text-xs text-muted-foreground shrink-0">{formatSize(att.size)}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-destructive hover:bg-destructive/10 shrink-0"
                    onClick={() => handleRemoveExisting(i)}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}

              {/* Pending files (not yet uploaded) */}
              {pendingFiles.map((file, i) => (
                <div key={i} className="flex items-center gap-2 rounded-lg border border-dashed border-blue-300 bg-blue-50/60 px-3 py-2">
                  <AttachmentIcon type={file.type} />
                  <span className="flex-1 text-sm truncate">{file.name}</span>
                  <span className="text-xs text-muted-foreground shrink-0">{formatSize(file.size)}</span>
                  <Badge variant="outline" className="text-xs text-blue-600 border-blue-300 shrink-0">Pending</Badge>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-destructive hover:bg-destructive/10 shrink-0"
                    onClick={() => handleRemovePending(i)}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}

              {/* File picker row */}
              <div className="flex gap-2">
                <label className="flex flex-1 cursor-pointer items-center gap-2 rounded-lg border border-dashed border-muted-foreground/25 px-4 py-2.5 text-sm text-muted-foreground hover:border-emerald-400 hover:bg-emerald-50/40 transition-colors">
                  <Upload className="h-4 w-4 shrink-0" />
                  <span>Attach files</span>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept={ACCEPT}
                    className="sr-only"
                    onChange={handleFileSelect}
                  />
                </label>
                <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-muted-foreground/25 px-4 py-2.5 text-sm text-muted-foreground hover:border-sky-400 hover:bg-sky-50/40 transition-colors">
                  <Camera className="h-4 w-4 shrink-0" />
                  <span className="whitespace-nowrap">Take Photo</span>
                  <input
                    ref={cameraInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="sr-only"
                    onChange={handleCameraSelect}
                  />
                </label>
              </div>

              {pendingFiles.length > 0 && (
                <p className="text-xs text-blue-600">
                  {pendingFiles.length} file{pendingFiles.length > 1 ? 's' : ''} will be uploaded when you save.
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700 min-w-[130px]">
              {saving && (
                uploading
                  ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Uploading…</>
                  : <><Loader2 className="h-4 w-4 animate-spin mr-2" />Saving…</>
              )}
              {!saving && (editingRow ? 'Save Changes' : 'Record Payment')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
