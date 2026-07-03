'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { db, storage } from '@/lib/firebase';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useVehicleOptions } from '@/components/vehicle-management/hooks';
import { useRenewalPrefill } from '@/components/vehicle-management/use-renewal-prefill';
import { computeRenewalMeta, VEHICLE_COLLECTIONS } from '@/lib/vehicle-management';
import { syncVehicleComplianceStatus } from '@/components/vehicle-management/compliance-sync';
import { useActivityLogger } from '@/hooks/useActivityLogger';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import ExcelJS from 'exceljs';
import { Download, ExternalLink, FileUp, Loader2, Upload } from 'lucide-react';
import { VehicleImportDialog, type ImportField } from '@/components/vehicle-management/import-dialog';

type InsuranceRow = Record<string, any>;
type InsuranceForm = Record<string, string>;

const policyTypeOptions = [
  { value: 'Comprehensive', label: 'Comprehensive' },
  { value: 'Third-Party', label: 'Third-Party' },
  { value: 'Own-Damage', label: 'Own-Damage' },
  { value: 'Zero-Dep', label: 'Zero-Dep' },
  { value: 'Commercial Package', label: 'Commercial Package' },
];

const buildInitialState = (): InsuranceForm => ({
  vehicleId: '',
  insuranceCompany: '',
  policyNumber: '',
  policyType: 'Comprehensive',
  startDate: '',
  expiryDate: '',
  premiumAmount: '',
  idvValue: '',
  agentName: '',
  agentContact: '',
  policyDocumentUrl: '',
  remarks: '',
});

const mapRowToState = (row: InsuranceRow): InsuranceForm => ({
  vehicleId: String(row.vehicleId || ''),
  insuranceCompany: String(row.insuranceCompany || ''),
  policyNumber: String(row.policyNumber || ''),
  policyType: String(row.policyType || 'Comprehensive'),
  startDate: String(row.startDate || ''),
  expiryDate: String(row.expiryDate || ''),
  premiumAmount: String(row.premiumAmount || ''),
  idvValue: String(row.idvValue || ''),
  agentName: String(row.agentName || ''),
  agentContact: String(row.agentContact || ''),
  policyDocumentUrl: String(row.policyDocumentUrl || ''),
  remarks: String(row.remarks || ''),
});

export default function InsuranceManagementPage() {
  const { toast } = useToast();
  const { log } = useActivityLogger('Vehicle Management');
  const { can } = useAuthorization();
  const { options: vehicleOptions, map: vehicleMap } = useVehicleOptions();
  const { prefill, renewingFromId } = useRenewalPrefill();

  const canView = can('View', 'Vehicle Management.Insurance Management');
  const canAdd = can('Add', 'Vehicle Management.Insurance Management');
  const canEdit = can('Edit', 'Vehicle Management.Insurance Management');
  const canDelete = can('Delete', 'Vehicle Management.Insurance Management');
  const canExport = can('Export', 'Vehicle Management.Insurance Management') || canView;
  const canImport = can('Import', 'Vehicle Management.Insurance Management') || canAdd;

  const [rows, setRows] = useState<InsuranceRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<InsuranceRow | null>(null);
  const [deleteRow, setDeleteRow] = useState<InsuranceRow | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [form, setForm] = useState<InsuranceForm>(buildInitialState());
  const [file, setFile] = useState<File | null>(null);
  const prefillApplied = useRef(false);

  const loadRows = async () => {
    setIsLoading(true);
    try {
      const snap = await getDocs(collection(db, VEHICLE_COLLECTIONS.insurance));
      const data = snap.docs
        .map((entry): InsuranceRow => ({ id: entry.id, ...(entry.data() as Record<string, any>) }))
        .sort((a, b) => String(a.expiryDate || '').localeCompare(String(b.expiryDate || '')));
      setRows(data);
    } catch (error) {
      console.error('Failed to load insurance rows', error);
      toast({ title: 'Error', description: 'Unable to load insurance records.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!prefill || prefillApplied.current || !canAdd) return;
    prefillApplied.current = true;
    const next = buildInitialState();
    Object.entries(prefill).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') next[key] = String(value);
    });
    setEditingRow(null);
    setForm(next);
    setFile(null);
    setDialogOpen(true);
  }, [canAdd, prefill]);

  const filteredRows = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((row) =>
      [
        row.vehicleNumber,
        row.insuranceCompany,
        row.policyNumber,
        row.expiryDate,
        row.alertStage,
        row.renewalStatus,
        row.complianceStatus,
      ]
        .map((value) => String(value || '').toLowerCase())
        .some((value) => value.includes(term))
    );
  }, [query, rows]);

  const exportExcel = async () => {
    if (!canExport || isExporting) return;
    setIsExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Insurance');
      ws.columns = [
        { header: 'Vehicle Number', key: 'vehicleNumber', width: 18 },
        { header: 'Insurance Company', key: 'insuranceCompany', width: 24 },
        { header: 'Policy Number', key: 'policyNumber', width: 22 },
        { header: 'Policy Type', key: 'policyType', width: 20 },
        { header: 'Start Date', key: 'startDate', width: 14 },
        { header: 'Expiry Date', key: 'expiryDate', width: 14 },
        { header: 'Premium Amount', key: 'premiumAmount', width: 18 },
        { header: 'IDV Value', key: 'idvValue', width: 16 },
        { header: 'Agent Name', key: 'agentName', width: 20 },
        { header: 'Agent Contact', key: 'agentContact', width: 18 },
        { header: 'Alert Stage', key: 'alertStage', width: 14 },
        { header: 'Renewal Status', key: 'renewalStatus', width: 16 },
      ];
      filteredRows.forEach(row => {
        ws.addRow({
          vehicleNumber: row.vehicleNumber || '',
          insuranceCompany: row.insuranceCompany || '',
          policyNumber: row.policyNumber || '',
          policyType: row.policyType || '',
          startDate: row.startDate || '',
          expiryDate: row.expiryDate || '',
          premiumAmount: row.premiumAmount || '',
          idvValue: row.idvValue || '',
          agentName: row.agentName || '',
          agentContact: row.agentContact || '',
          alertStage: row.alertStage || '',
          renewalStatus: row.renewalStatus || '',
        });
      });
      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `insurance-records.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: 'Exported', description: `${filteredRows.length} records exported.` });
    } catch (err) {
      console.error('Export failed', err);
      toast({ title: 'Export Failed', description: 'Unable to export records.', variant: 'destructive' });
    } finally {
      setIsExporting(false);
    }
  };

  const INSURANCE_IMPORT_FIELDS: ImportField[] = [
    { key: 'vehicleNumber', label: 'Vehicle Number', required: true, hint: 'e.g. MH12AB1234' },
    { key: 'insuranceCompany', label: 'Insurance Company', required: true },
    { key: 'policyNumber', label: 'Policy Number', required: true },
    { key: 'policyType', label: 'Policy Type', required: true, hint: 'Comprehensive / Third-Party / Own-Damage …' },
    { key: 'startDate', label: 'Start Date', required: true, hint: 'YYYY-MM-DD', validate: (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) ? null : 'Format must be YYYY-MM-DD' },
    { key: 'expiryDate', label: 'Expiry Date', required: true, hint: 'YYYY-MM-DD', validate: (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) ? null : 'Format must be YYYY-MM-DD' },
    { key: 'premiumAmount', label: 'Premium Amount', required: true, type: 'number', validate: (v) => Number(v) > 0 ? null : 'Premium must be greater than 0' },
    { key: 'idvValue', label: 'IDV Value', type: 'number' },
    { key: 'agentName', label: 'Agent Name' },
    { key: 'agentContact', label: 'Agent Contact' },
  ];

  const saveInsuranceRow = async (row: Record<string, any>) => {
    const meta = computeRenewalMeta(String(row.expiryDate || ''));
    await addDoc(collection(db, VEHICLE_COLLECTIONS.insurance), {
      vehicleNumber: String(row.vehicleNumber || '').trim(),
      insuranceCompany: String(row.insuranceCompany || '').trim(),
      policyNumber: String(row.policyNumber || '').trim(),
      policyType: String(row.policyType || 'Comprehensive').trim(),
      startDate: String(row.startDate || '').trim(),
      expiryDate: String(row.expiryDate || '').trim(),
      premiumAmount: Number(row.premiumAmount || 0),
      idvValue: row.idvValue ? Number(row.idvValue) : '',
      agentName: String(row.agentName || '').trim(),
      agentContact: String(row.agentContact || '').trim(),
      alertStage: meta.alertStage,
      complianceStatus: meta.complianceStatus,
      renewalStatus: meta.alertStage === 'Expired' ? 'Overdue' : ['Due Today', '7d', '15d', '30d'].includes(meta.alertStage) ? 'Due Soon' : 'Not Due',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  };

  const openAdd = () => {
    if (!canAdd) return;
    setEditingRow(null);
    setForm(buildInitialState());
    setFile(null);
    setDialogOpen(true);
  };

  const openEdit = (row: InsuranceRow) => {
    if (!canEdit) return;
    setEditingRow(row);
    setForm(mapRowToState(row));
    setFile(null);
    setDialogOpen(true);
  };

  const setField = (key: keyof InsuranceForm, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const submit = async () => {
    if (isSaving) return;
    const required = [
      ['vehicleId', 'Vehicle Number'],
      ['insuranceCompany', 'Insurance Company'],
      ['policyNumber', 'Policy Number'],
      ['policyType', 'Policy Type'],
      ['startDate', 'Start Date'],
      ['expiryDate', 'Expiry Date'],
      ['premiumAmount', 'Premium Amount'],
    ] as const;

    for (const [key, label] of required) {
      if (!String(form[key] || '').trim()) {
        toast({ title: 'Validation Error', description: `${label} is required.`, variant: 'destructive' });
        return;
      }
    }

    if (!editingRow && !file) {
      toast({ title: 'Validation Error', description: 'Document Upload is required.', variant: 'destructive' });
      return;
    }

    const premium = Number(form.premiumAmount || 0);
    if (!Number.isFinite(premium) || premium <= 0) {
      toast({ title: 'Validation Error', description: 'Premium Amount is invalid.', variant: 'destructive' });
      return;
    }

    try {
      setIsSaving(true);
      let policyDocumentUrl = form.policyDocumentUrl || '';
      if (file) {
        const safeName = file.name.replace(/\s+/g, '-');
        const rowKey = editingRow?.id || `new-${Date.now()}`;
        const uploadRef = ref(
          storage,
          `vehicle-management/${VEHICLE_COLLECTIONS.insurance}/${rowKey}/${Date.now()}-${safeName}`
        );
        await uploadBytes(uploadRef, file);
        policyDocumentUrl = await getDownloadURL(uploadRef);
      }

      const vehicle = vehicleMap[String(form.vehicleId || '')];
      const meta = computeRenewalMeta(String(form.expiryDate || ''));
      const renewalStatus =
        meta.alertStage === 'Expired'
          ? 'Overdue'
          : ['Due Today', '7d', '15d', '30d'].includes(meta.alertStage)
          ? 'Due Soon'
          : 'Not Due';

      const payload: Record<string, any> = {
        vehicleId: form.vehicleId,
        vehicleNumber: vehicle?.vehicleNumber || vehicle?.registrationNo || '',
        insuranceCompany: form.insuranceCompany.trim(),
        policyNumber: form.policyNumber.trim(),
        policyType: form.policyType,
        startDate: form.startDate,
        expiryDate: form.expiryDate,
        premiumAmount: premium,
        idvValue: form.idvValue ? Number(form.idvValue) : '',
        agentName: form.agentName.trim(),
        agentContact: form.agentContact.trim(),
        policyDocumentUrl,
        remarks: form.remarks || '',
        renewalStatus,
        alertStage: meta.alertStage,
        complianceStatus: meta.complianceStatus,
      };

      if (editingRow) {
        await updateDoc(doc(db, VEHICLE_COLLECTIONS.insurance, String(editingRow.id)), {
          ...payload,
          updatedAt: serverTimestamp(),
        });
      } else {
        await addDoc(collection(db, VEHICLE_COLLECTIONS.insurance), {
          ...payload,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      if (form.vehicleId) await syncVehicleComplianceStatus(String(form.vehicleId));

      if (!editingRow && renewingFromId) {
        try {
          await updateDoc(doc(db, VEHICLE_COLLECTIONS.insurance, renewingFromId), {
            renewalStatus: 'Renewed',
            renewedAt: serverTimestamp(),
            isArchived: true,
          });
        } catch (error) {
          console.error('Unable to archive renewed insurance row', error);
        }
      }

      const vehicleNumber = vehicleMap[String(form.vehicleId || '')]?.vehicleNumber || '';
      if (editingRow) {
        await log('Edit Insurance', { vehicleNumber, policyNumber: form.policyNumber });
      } else {
        await log('Add Insurance', { vehicleNumber, policyNumber: form.policyNumber });
      }
      toast({
        title: editingRow ? 'Updated' : 'Created',
        description: `Insurance record ${editingRow ? 'updated' : 'created'} successfully.`,
      });
      setDialogOpen(false);
      setEditingRow(null);
      setFile(null);
      setForm(buildInitialState());
      await loadRows();
    } catch (error) {
      console.error('Failed to save insurance', error);
      toast({ title: 'Error', description: 'Unable to save insurance record.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteRow) return;
    try {
      await deleteDoc(doc(db, VEHICLE_COLLECTIONS.insurance, String(deleteRow.id)));
      if (deleteRow.vehicleId) await syncVehicleComplianceStatus(String(deleteRow.vehicleId));
      await log('Delete Insurance', { vehicleNumber: deleteRow?.vehicleNumber });
      toast({ title: 'Deleted', description: 'Insurance record deleted.' });
      setDeleteRow(null);
      await loadRows();
    } catch (error) {
      console.error('Failed to delete insurance', error);
      toast({ title: 'Error', description: 'Unable to delete insurance record.', variant: 'destructive' });
    }
  };

  if (!canView) {
    return (
      <Card className="vm-panel-strong">
        <CardHeader>
          <CardTitle>Access Restricted</CardTitle>
          <CardDescription>You do not have permission to view Insurance Management.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="vm-panel-strong overflow-hidden">
        <div className="h-1 w-full bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-600 animate-bb-gradient" />
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Insurance Management</CardTitle>
            <CardDescription>Track policy details, expiry, and renewal status.</CardDescription>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
            <Badge variant="outline" className="bg-white/70">
              {rows.length} records
            </Badge>
            <Button variant="outline" onClick={() => void loadRows()} className="bg-white/80 hover:bg-white">
              Refresh
            </Button>
            {canExport && (
              <Button variant="outline" onClick={() => void exportExcel()} disabled={isExporting} className="bg-white/80 hover:bg-white">
                {isExporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                {isExporting ? 'Exporting…' : 'Export'}
              </Button>
            )}
            {canImport && (
              <Button variant="outline" onClick={() => setImportDialogOpen(true)} className="bg-white/80 hover:bg-white">
                <FileUp className="mr-2 h-4 w-4" /> Import
              </Button>
            )}
            <Button
              onClick={openAdd}
              disabled={!canAdd}
              className="bg-gradient-to-r from-emerald-500 to-teal-600 text-white hover:from-emerald-600 hover:to-teal-700"
            >
              Add Insurance
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            placeholder="Search insurance..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="max-w-xs border-slate-200 bg-white focus-visible:ring-emerald-400/40"
          />
          {/* Mobile card list — visible only on small screens */}
          <div className="space-y-2.5 sm:hidden">
            {isLoading ? (
              Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-36 w-full rounded-xl" />
              ))
            ) : filteredRows.length === 0 ? (
              <div className="rounded-lg border border-white/70 bg-white/80 px-4 py-10 text-center text-muted-foreground">
                No records found.
              </div>
            ) : (
              filteredRows.map((row) => (
                <div key={row.id} className="rounded-xl border border-white/70 bg-white/85 p-4 shadow-sm active:scale-[0.99] transition-transform">
                  {/* Top: vehicle number + alert badge */}
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">{row.vehicleNumber || '-'}</p>
                      <p className="text-xs text-muted-foreground">{row.insuranceCompany || '-'}</p>
                    </div>
                    <Badge variant="outline" className="shrink-0 text-xs bg-white/70">
                      {row.alertStage || '-'}
                    </Badge>
                  </div>
                  {/* Key fields grid */}
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between gap-2">
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Policy No.</span>
                      <span className="text-right text-xs font-medium max-w-[60%] break-all">{row.policyNumber || '-'}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Expiry</span>
                      <span className="text-right text-xs">{row.expiryDate || '-'}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Policy Type</span>
                      <span className="text-right text-xs">{row.policyType || '-'}</span>
                    </div>
                  </div>
                  {/* Action buttons */}
                  <div className="mt-3 flex gap-2 border-t border-slate-100 pt-3">
                    <button onClick={() => openEdit(row)} disabled={!canEdit} className="flex-1 h-10 rounded-md border border-slate-200 bg-white/80 text-sm font-medium text-slate-700 disabled:opacity-50 active:bg-slate-50">Edit</button>
                    <button onClick={() => setDeleteRow(row)} disabled={!canDelete} className="flex-1 h-10 rounded-md bg-rose-500 text-sm font-medium text-white disabled:opacity-50 active:bg-rose-600">Delete</button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Desktop table — hidden on small screens */}
          <div className="hidden sm:block">
          {!isLoading && filteredRows.length === 0 ? (
            <div className="rounded-lg border border-white/70 bg-white/80 px-4 py-10 text-center text-muted-foreground">
              No records found.
            </div>
          ) : (
          <div className="overflow-auto rounded-lg border border-white/70 bg-white/80 h-[calc(100vh-230px)]">
            <table className="w-full caption-bottom text-sm">
              <TableHeader className="sticky top-0 z-10 bg-slate-50 shadow-sm">
                <TableRow>
                  <TableHead>Vehicle Number</TableHead>
                  <TableHead>Insurance Company</TableHead>
                  <TableHead>Policy Number</TableHead>
                  <TableHead>Expiry Date</TableHead>
                  <TableHead>Alert</TableHead>
                  <TableHead>Renewal Status</TableHead>
                  <TableHead>Compliance</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 4 }).map((_, index) => (
                    <TableRow key={index}>
                      <TableCell colSpan={8}>
                        <Skeleton className="h-8 w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  filteredRows.map((row) => (
                    <TableRow key={String(row.id)} className="hover:bg-emerald-50/70">
                      <TableCell>{row.vehicleNumber || '-'}</TableCell>
                      <TableCell>{row.insuranceCompany || '-'}</TableCell>
                      <TableCell>{row.policyNumber || '-'}</TableCell>
                      <TableCell>{row.expiryDate || '-'}</TableCell>
                      <TableCell>{row.alertStage || '-'}</TableCell>
                      <TableCell>{row.renewalStatus || '-'}</TableCell>
                      <TableCell>{row.complianceStatus || '-'}</TableCell>
                      <TableCell className="space-x-2 text-right">
                        <Button size="sm" variant="outline" onClick={() => openEdit(row)} disabled={!canEdit}>
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => setDeleteRow(row)}
                          disabled={!canDelete}
                        >
                          Delete
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </table>
          </div>
          )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="flex max-h-[90vh] w-[calc(100vw-2rem)] max-w-4xl flex-col gap-0 overflow-hidden p-0 vm-panel-strong">
          <div className="shrink-0 border-b border-slate-100 bg-gradient-to-r from-emerald-500/5 to-teal-500/5 px-6 pb-4 pt-5 pr-12">
            <DialogTitle>{editingRow ? 'Edit Insurance' : 'Add Insurance'}</DialogTitle>
            <DialogDescription>Enter policy details and upload the policy file.</DialogDescription>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
              <div className="mb-3 rounded-md border border-slate-200 bg-slate-100/90 px-3 py-1.5 text-xs font-semibold text-slate-700">
                General Info
              </div>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
                <SelectField label="Vehicle Number *" value={form.vehicleId} onValueChange={(v) => setField('vehicleId', v)} options={vehicleOptions} />
                <Field label="Insurance Company *">
                  <Input value={form.insuranceCompany} onChange={(e) => setField('insuranceCompany', e.target.value)} className="h-9" />
                </Field>
                <Field label="Policy Number *">
                  <Input value={form.policyNumber} onChange={(e) => setField('policyNumber', e.target.value)} className="h-9" />
                </Field>
                <SelectField label="Policy Type *" value={form.policyType} onValueChange={(v) => setField('policyType', v)} options={policyTypeOptions} />
                <Field label="Start Date *">
                  <Input type="date" value={form.startDate} onChange={(e) => setField('startDate', e.target.value)} className="h-9" />
                </Field>
                <Field label="Expiry Date *">
                  <Input type="date" value={form.expiryDate} onChange={(e) => setField('expiryDate', e.target.value)} className="h-9" />
                </Field>
                <Field label="Premium Amount *">
                  <Input type="number" value={form.premiumAmount} onChange={(e) => setField('premiumAmount', e.target.value)} className="h-9" />
                </Field>
                <Field label="IDV Value">
                  <Input type="number" value={form.idvValue} onChange={(e) => setField('idvValue', e.target.value)} className="h-9" />
                </Field>
                <Field label="Agent Name">
                  <Input value={form.agentName} onChange={(e) => setField('agentName', e.target.value)} className="h-9" />
                </Field>
                <Field label="Agent Contact">
                  <Input value={form.agentContact} onChange={(e) => setField('agentContact', e.target.value)} className="h-9" />
                </Field>
                <Field label="Document Upload *" className="md:col-span-2 xl:col-span-3">
                  <div className="space-y-1.5">
                    <label
                      htmlFor="insurance-policy-file"
                      className={cn(
                        'flex h-9 w-full cursor-pointer items-center gap-2 rounded-md border px-2.5 text-sm transition-colors',
                        file
                          ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                          : 'border-dashed border-slate-300 bg-slate-50 text-muted-foreground hover:border-emerald-400 hover:bg-emerald-50/60'
                      )}
                    >
                      <Upload className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate text-xs">{file?.name || 'Choose or drop a file…'}</span>
                    </label>
                    <input
                      id="insurance-policy-file"
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png,.webp"
                      className="sr-only"
                      onChange={(event) => setFile(event.target.files?.[0] || null)}
                    />
                    {!file && form.policyDocumentUrl && (
                      <a
                        href={form.policyDocumentUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 underline underline-offset-2 hover:text-emerald-800"
                      >
                        <ExternalLink className="h-3 w-3" />
                        View current file
                      </a>
                    )}
                  </div>
                </Field>
                <Field label="Remarks" className="md:col-span-2 xl:col-span-3">
                  <Textarea value={form.remarks} onChange={(e) => setField('remarks', e.target.value)} className="min-h-[84px]" />
                </Field>
              </div>
            </div>
          </div>
          <DialogFooter className="shrink-0 border-t border-slate-100 bg-slate-50/70 px-6 py-3.5">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void submit()} disabled={isSaving} className="bg-gradient-to-r from-emerald-500 to-teal-600 text-white hover:from-emerald-600 hover:to-teal-700">
              {isSaving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              {editingRow ? 'Update' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteRow} onOpenChange={(open) => (!open ? setDeleteRow(null) : null)}>
        <AlertDialogContent className="vm-panel-strong">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Insurance Record</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. Policy <b>{deleteRow?.policyNumber || ''}</b> will be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-rose-600 hover:bg-rose-700" onClick={() => void confirmDelete()}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <VehicleImportDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        title="Import Insurance Records"
        fields={INSURANCE_IMPORT_FIELDS}
        onSaveRow={saveInsuranceRow}
        onImportComplete={() => { void loadRows(); void log('Import Insurance', {}); }}
      />
    </div>
  );
}

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'space-y-1 rounded-md border border-slate-200 bg-white px-2.5 py-2 transition-all hover:border-emerald-200 focus-within:border-emerald-300 focus-within:ring-1 focus-within:ring-emerald-200/70',
        className
      )}
    >
      <Label className="text-[11px] font-semibold tracking-wide text-slate-700">{label}</Label>
      {children}
    </div>
  );
}

function SelectField({
  label,
  value,
  onValueChange,
  options,
  className,
}: {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  className?: string;
}) {
  return (
    <Field label={label} className={className}>
      <Select value={value || undefined} onValueChange={onValueChange}>
        <SelectTrigger className="h-9 border-slate-200 bg-white text-[13px] transition-colors focus:ring-1 focus:ring-emerald-400/50 data-[state=open]:border-emerald-400">
          <SelectValue placeholder={`Select ${label.toLowerCase()}`} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}


