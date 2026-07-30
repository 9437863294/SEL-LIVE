'use client';

import Link from 'next/link';
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
import { compareCreatedAtDesc, computeRenewalMeta, formatVehicleTimestamp, getVehicleDateRangeError, normalizeVehicleRegistration, VEHICLE_COLLECTIONS } from '@/lib/vehicle-management';
import { syncVehicleComplianceStatus } from '@/components/vehicle-management/compliance-sync';
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import ExcelJS from 'exceljs';
import { Check, ChevronsUpDown, Download, ExternalLink, FileCheck2, FileUp, History, Loader2, RefreshCw, Search, Upload } from 'lucide-react';
import { VehicleImportDialog, type ImportField } from '@/components/vehicle-management/import-dialog';
import { VehicleTablePagination, useVehicleTablePagination } from '@/components/vehicle-management/table-pagination';

type PucRow = Record<string, any>;
type PucForm = Record<string, string>;

const buildInitialState = (): PucForm => ({
  vehicleId: '',
  pucCertificateNumber: '',
  issueDate: '',
  expiryDate: '',
  testingCenterName: '',
  amountPaid: '',
  certificateDocumentUrl: '',
  remarks: '',
});

const mapRowToState = (row: PucRow): PucForm => ({
  vehicleId: String(row.vehicleId || ''),
  pucCertificateNumber: String(row.pucCertificateNumber || ''),
  issueDate: String(row.issueDate || ''),
  expiryDate: String(row.expiryDate || ''),
  testingCenterName: String(row.testingCenterName || ''),
  amountPaid: String(row.amountPaid || ''),
  certificateDocumentUrl: String(row.certificateDocumentUrl || ''),
  remarks: String(row.remarks || ''),
});

export default function PucManagementPage() {
  const { toast } = useToast();
  const { can } = useAuthorization();
  const { rows: vehicleRows, options: vehicleOptions, map: vehicleMap } = useVehicleOptions();
  const { prefill, renewingFromId } = useRenewalPrefill();

  const canView = can('View', 'Vehicle Management.PUC Management');
  const canAdd = can('Add', 'Vehicle Management.PUC Management');
  const canEdit = can('Edit', 'Vehicle Management.PUC Management');
  const canDelete = can('Delete', 'Vehicle Management.PUC Management');
  const canExport = can('Export', 'Vehicle Management.PUC Management') || canView;
  const canImport = can('Import', 'Vehicle Management.PUC Management') || canAdd;

  const [rows, setRows] = useState<PucRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'current' | 'history'>('current');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<PucRow | null>(null);
  const [deleteRow, setDeleteRow] = useState<PucRow | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [form, setForm] = useState<PucForm>(buildInitialState());
  const [file, setFile] = useState<File | null>(null);
  const [isRenewalMode, setIsRenewalMode] = useState(false);
  const prefillApplied = useRef(false);
  const importedVehicleIdsRef = useRef(new Set<string>());

  const loadRows = async () => {
    setIsLoading(true);
    try {
      const snap = await getDocs(collection(db, VEHICLE_COLLECTIONS.puc));
      const data = snap.docs
        .map((entry): PucRow => {
          const row: PucRow = { id: entry.id, ...(entry.data() as Record<string, any>) };
          const meta = computeRenewalMeta(String(row.expiryDate || ''));
          return {
            ...row,
            alertStage: meta.alertStage,
            complianceStatus: meta.complianceStatus,
            pucStatus: meta.complianceStatus === 'Missing' ? 'Expired' : meta.complianceStatus,
          };
        })
        .sort(compareCreatedAtDesc);
      setRows(data);
    } catch (error) {
      console.error('Failed to load puc rows', error);
      toast({ title: 'Error', description: 'Unable to load PUC records.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('tab') === 'history') setActiveTab('history');
  }, []);

  useEffect(() => {
    if (!prefill || prefillApplied.current || !canAdd) return;
    if (renewingFromId && isLoading) return;
    const renewalSource = renewingFromId
      ? rows.find((row) => String(row.id) === String(renewingFromId)) || null
      : null;
    if (renewingFromId && !renewalSource) {
      prefillApplied.current = true;
      toast({ title: 'Renewal Record Not Found', description: 'The original PUC certificate could not be loaded.', variant: 'destructive' });
      return;
    }
    prefillApplied.current = true;
    const next = renewalSource ? mapRowToState(renewalSource) : buildInitialState();
    next.certificateDocumentUrl = '';
    Object.entries(prefill).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') next[key] = String(value);
    });
    setEditingRow(null);
    setForm(next);
    setFile(null);
    setIsRenewalMode(true);
    setDialogOpen(true);
  }, [canAdd, isLoading, prefill, renewingFromId, rows, toast]);

  const filteredRows = useMemo(() => {
    const base = rows.filter((row) => activeTab === 'history' ? row.isArchived === true : row.isArchived !== true);
    const term = query.trim().toLowerCase();
    if (!term) return base;
    return base.filter((row) =>
      [
        row.vehicleNumber,
        row.pucCertificateNumber,
        row.testingCenterName,
        row.expiryDate,
        row.alertStage,
        row.pucStatus,
        row.complianceStatus,
      ]
        .map((value) => String(value || '').toLowerCase())
        .some((value) => value.includes(term))
    );
  }, [activeTab, query, rows]);
  const pucPagination = useVehicleTablePagination(filteredRows);

  const currentCount = useMemo(() => rows.filter((row) => row.isArchived !== true).length, [rows]);
  const historyCount = rows.length - currentCount;

  const getRenewalHref = (row: PucRow) => {
    const params = new URLSearchParams({
      renew: String(row.id || ''),
      vid: String(row.vehicleId || ''),
      vnum: String(row.vehicleNumber || ''),
    });
    return `/vehicle-management/puc?${params.toString()}`;
  };

  const exportExcel = async () => {
    if (!canExport || isExporting) return;
    setIsExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('PUC');
      ws.columns = [
        { header: 'Vehicle Number', key: 'vehicleNumber', width: 18 },
        { header: 'PUC Certificate Number', key: 'pucCertificateNumber', width: 26 },
        { header: 'Testing Center Name', key: 'testingCenterName', width: 26 },
        { header: 'Issue Date', key: 'issueDate', width: 14 },
        { header: 'Expiry Date', key: 'expiryDate', width: 14 },
        { header: 'Amount Paid', key: 'amountPaid', width: 16 },
        { header: 'Alert Stage', key: 'alertStage', width: 14 },
        { header: 'PUC Status', key: 'pucStatus', width: 14 },
      ];
      filteredRows.forEach(row => {
        ws.addRow({
          vehicleNumber: row.vehicleNumber || '',
          pucCertificateNumber: row.pucCertificateNumber || '',
          testingCenterName: row.testingCenterName || '',
          issueDate: row.issueDate || '',
          expiryDate: row.expiryDate || '',
          amountPaid: row.amountPaid || '',
          alertStage: row.alertStage || '',
          pucStatus: row.pucStatus || '',
        });
      });
      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `puc-records.xlsx`;
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

  const PUC_IMPORT_FIELDS: ImportField[] = [
    { key: 'vehicleNumber', label: 'Vehicle Number', required: true, hint: 'e.g. MH12AB1234' },
    { key: 'pucCertificateNumber', label: 'PUC Certificate Number', required: true },
    { key: 'testingCenterName', label: 'Testing Center Name', required: true },
    { key: 'issueDate', label: 'Issue Date', required: true, hint: 'YYYY-MM-DD', validate: (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) ? null : 'Format must be YYYY-MM-DD' },
    { key: 'expiryDate', label: 'Expiry Date', required: true, hint: 'YYYY-MM-DD', validate: (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) ? null : 'Format must be YYYY-MM-DD' },
    { key: 'amountPaid', label: 'Amount Paid', required: true, type: 'number', validate: (v) => Number(v) > 0 ? null : 'Amount must be greater than 0' },
  ];

  const savePucRow = async (row: Record<string, any>) => {
    const importedVehicleNumber = normalizeVehicleRegistration(row.vehicleNumber);
    const matchedVehicle = vehicleRows.find((vehicle) =>
      normalizeVehicleRegistration(vehicle.vehicleNumber || vehicle.registrationNo) === importedVehicleNumber
    );
    if (!matchedVehicle) throw new Error(`Vehicle ${row.vehicleNumber || ''} was not found in Vehicle Master.`);
    const dateError = getVehicleDateRangeError(row.issueDate, row.expiryDate, 'Issue date', 'Expiry date');
    if (dateError) throw new Error(dateError);
    const meta = computeRenewalMeta(String(row.expiryDate || ''));
    await addDoc(collection(db, VEHICLE_COLLECTIONS.puc), {
      vehicleId: matchedVehicle.id,
      vehicleNumber: String(row.vehicleNumber || '').trim(),
      pucCertificateNumber: String(row.pucCertificateNumber || '').trim(),
      testingCenterName: String(row.testingCenterName || '').trim(),
      issueDate: String(row.issueDate || '').trim(),
      expiryDate: String(row.expiryDate || '').trim(),
      amountPaid: Number(row.amountPaid || 0),
      alertStage: meta.alertStage,
      complianceStatus: meta.complianceStatus,
      pucStatus: meta.complianceStatus === 'Missing' ? 'Expired' : meta.complianceStatus,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    importedVehicleIdsRef.current.add(String(matchedVehicle.id));
  };

  const openAdd = () => {
    if (!canAdd) return;
    setEditingRow(null);
    setForm(buildInitialState());
    setFile(null);
    setIsRenewalMode(false);
    setDialogOpen(true);
  };

  const openEdit = (row: PucRow) => {
    if (!canEdit) return;
    setEditingRow(row);
    setForm(mapRowToState(row));
    setFile(null);
    setIsRenewalMode(false);
    setDialogOpen(true);
  };

  const setField = (key: keyof PucForm, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const submit = async () => {
    if (isSaving) return;
    const required = [
      ['vehicleId', 'Vehicle Number'],
      ['pucCertificateNumber', 'PUC Certificate Number'],
      ['issueDate', 'Issue Date'],
      ['expiryDate', 'Expiry Date'],
      ['testingCenterName', 'Testing Center Name'],
      ['amountPaid', 'Amount Paid'],
    ] as const;

    for (const [key, label] of required) {
      if (!String(form[key] || '').trim()) {
        toast({ title: 'Validation Error', description: `${label} is required.`, variant: 'destructive' });
        return;
      }
    }

    if (!editingRow && !file) {
      toast({ title: 'Validation Error', description: 'Certificate Upload is required.', variant: 'destructive' });
      return;
    }

    const amountPaid = Number(form.amountPaid || 0);
    if (!Number.isFinite(amountPaid) || amountPaid <= 0) {
      toast({ title: 'Validation Error', description: 'Amount Paid is invalid.', variant: 'destructive' });
      return;
    }
    const dateError = getVehicleDateRangeError(form.issueDate, form.expiryDate, 'Issue date', 'Expiry date');
    if (dateError) {
      toast({ title: 'Validation Error', description: dateError, variant: 'destructive' });
      return;
    }
    if (file && file.size > 10 * 1024 * 1024) {
      toast({ title: 'Validation Error', description: 'PUC certificate must be smaller than 10 MB.', variant: 'destructive' });
      return;
    }

    try {
      setIsSaving(true);
      let certificateDocumentUrl = form.certificateDocumentUrl || '';
      if (file) {
        const safeName = file.name.replace(/\s+/g, '-');
        const rowKey = editingRow?.id || `new-${Date.now()}`;
        const uploadRef = ref(
          storage,
          `vehicle-management/${VEHICLE_COLLECTIONS.puc}/${rowKey}/${Date.now()}-${safeName}`
        );
        await uploadBytes(uploadRef, file);
        certificateDocumentUrl = await getDownloadURL(uploadRef);
      }

      const vehicle = vehicleMap[String(form.vehicleId || '')];
      const meta = computeRenewalMeta(String(form.expiryDate || ''));
      const pucStatus = meta.complianceStatus === 'Missing' ? 'Expired' : meta.complianceStatus;

      const payload: Record<string, any> = {
        vehicleId: form.vehicleId,
        vehicleNumber: vehicle?.vehicleNumber || vehicle?.registrationNo || '',
        pucCertificateNumber: form.pucCertificateNumber.trim(),
        issueDate: form.issueDate,
        expiryDate: form.expiryDate,
        testingCenterName: form.testingCenterName.trim(),
        amountPaid,
        certificateDocumentUrl,
        remarks: form.remarks || '',
        pucStatus,
        alertStage: meta.alertStage,
        complianceStatus: meta.complianceStatus,
      };

      let savedId = '';
      if (editingRow) {
        savedId = String(editingRow.id);
        await updateDoc(doc(db, VEHICLE_COLLECTIONS.puc, String(editingRow.id)), {
          ...payload,
          updatedAt: serverTimestamp(),
        });
      } else {
        const created = await addDoc(collection(db, VEHICLE_COLLECTIONS.puc), {
          ...payload,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        savedId = created.id;
      }

      if (form.vehicleId) await syncVehicleComplianceStatus(String(form.vehicleId));

      if (!editingRow && isRenewalMode && renewingFromId) {
        try {
          await updateDoc(doc(db, VEHICLE_COLLECTIONS.puc, renewingFromId), {
            renewalStatus: 'Renewed',
            renewedById: savedId,
            renewedAt: serverTimestamp(),
            isArchived: true,
          });
        } catch (error) {
          console.error('Unable to archive renewed puc row', error);
        }
      }

      toast({
        title: editingRow ? 'Updated' : 'Created',
        description: `PUC record ${editingRow ? 'updated' : 'created'} successfully.`,
      });
      setDialogOpen(false);
      setEditingRow(null);
      setIsRenewalMode(false);
      setFile(null);
      setForm(buildInitialState());
      await loadRows();
    } catch (error) {
      console.error('Failed to save PUC', error);
      toast({ title: 'Error', description: 'Unable to save PUC record.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteRow) return;
    try {
      await deleteDoc(doc(db, VEHICLE_COLLECTIONS.puc, String(deleteRow.id)));
      if (deleteRow.vehicleId) await syncVehicleComplianceStatus(String(deleteRow.vehicleId));
      toast({ title: 'Deleted', description: 'PUC record deleted.' });
      setDeleteRow(null);
      await loadRows();
    } catch (error) {
      console.error('Failed to delete PUC', error);
      toast({ title: 'Error', description: 'Unable to delete PUC record.', variant: 'destructive' });
    }
  };

  if (!canView) {
    return (
      <Card className="vm-panel-strong">
        <CardHeader>
          <CardTitle>Access Restricted</CardTitle>
          <CardDescription>You do not have permission to view PUC Management.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="vm-panel-strong overflow-hidden">
        <div className="h-1 w-full bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-600 animate-bb-gradient" />
        <CardHeader className="flex flex-col gap-3 px-3 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-6">
          <div>
            <CardTitle>PUC Management</CardTitle>
            <CardDescription>Track pollution certificate validity and renewal compliance.</CardDescription>
          </div>
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:justify-end">
            <Badge variant="outline" className="col-span-2 w-fit bg-white/70 sm:col-span-1">
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
              Add PUC
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 px-3 pb-4 sm:px-6 sm:pb-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full sm:max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Vehicle, certificate or testing center..."
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="h-11 w-full border-slate-200 bg-white pl-9 focus-visible:ring-emerald-400/40 sm:h-10"
              />
            </div>
            <div className="grid w-full grid-cols-2 items-center gap-1 rounded-lg border border-slate-200 bg-slate-100 p-1 sm:w-fit">
              <button type="button" onClick={() => setActiveTab('current')} className={cn('flex min-h-10 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all', activeTab === 'current' ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-500 hover:text-slate-700')}>
                <FileCheck2 className="h-3.5 w-3.5" />Current <span className="text-[10px] opacity-70">{currentCount}</span>
              </button>
              <button type="button" onClick={() => setActiveTab('history')} className={cn('flex min-h-10 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all', activeTab === 'history' ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-500 hover:text-slate-700')}>
                <History className="h-3.5 w-3.5" />History <span className="text-[10px] opacity-70">{historyCount}</span>
              </button>
            </div>
          </div>
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
              pucPagination.paginatedRows.map((row) => (
                <div key={row.id} className="rounded-xl border border-white/70 bg-white/85 p-4 shadow-sm active:scale-[0.99] transition-transform">
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">{row.vehicleNumber || '-'}</p>
                      <p className="text-xs text-muted-foreground">{row.pucCertificateNumber || '-'}</p>
                    </div>
                    {row.alertStage && (
                      <Badge
                        variant="outline"
                        className={cn(
                          'shrink-0 text-[10px]',
                          row.alertStage === 'Expired'
                            ? 'border-rose-300 bg-rose-50 text-rose-700'
                            : row.alertStage === 'Due Today'
                            ? 'border-orange-300 bg-orange-50 text-orange-700'
                            : ['7d', '15d', '30d'].includes(String(row.alertStage))
                            ? 'border-yellow-300 bg-yellow-50 text-yellow-700'
                            : 'border-emerald-300 bg-emerald-50 text-emerald-700'
                        )}
                      >
                        {row.alertStage}
                      </Badge>
                    )}
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between gap-2">
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Testing Center</span>
                      <span className="text-right text-xs max-w-[60%]">{row.testingCenterName || '-'}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Issue Date</span>
                      <span className="text-xs">{row.issueDate || '-'}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Expiry</span>
                      <span className="text-xs font-medium">{row.expiryDate || '-'}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Amount Paid</span>
                      <span className="text-xs">{row.amountPaid ? `₹${row.amountPaid}` : '-'}</span>
                    </div>
                  </div>
                  <div className="mt-3 flex gap-2 border-t border-slate-100 pt-3">
                    {activeTab === 'current' && canAdd && <Link href={getRenewalHref(row)} className="flex-1"><Button size="sm" className="h-10 w-full bg-amber-500 hover:bg-amber-600"><RefreshCw className="mr-1 h-3.5 w-3.5" />Renew</Button></Link>}
                    {canEdit && <button onClick={() => openEdit(row)} className="h-10 flex-1 rounded-md border border-slate-200 bg-white/80 text-sm font-medium text-slate-700">Edit</button>}
                    {canDelete && <button onClick={() => setDeleteRow(row)} className="h-10 flex-1 rounded-md bg-rose-500 text-sm font-medium text-white">Delete</button>}
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
                  <TableHead>Certificate Number</TableHead>
                  <TableHead>Testing Center</TableHead>
                  <TableHead>Expiry Date</TableHead>
                  <TableHead>Alert</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Compliance</TableHead>
                  <TableHead>Created Time</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 4 }).map((_, index) => (
                    <TableRow key={index}>
                      <TableCell colSpan={9}>
                        <Skeleton className="h-8 w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  pucPagination.paginatedRows.map((row) => (
                    <TableRow key={String(row.id)} className="hover:bg-emerald-50/70">
                      <TableCell>{row.vehicleNumber || '-'}</TableCell>
                      <TableCell>{row.pucCertificateNumber || '-'}</TableCell>
                      <TableCell>{row.testingCenterName || '-'}</TableCell>
                      <TableCell>{row.expiryDate || '-'}</TableCell>
                      <TableCell>{row.alertStage || '-'}</TableCell>
                      <TableCell>{row.pucStatus || '-'}</TableCell>
                      <TableCell>{row.complianceStatus || '-'}</TableCell>
                      <TableCell className="whitespace-nowrap">{formatVehicleTimestamp(row.createdAt)}</TableCell>
                      <TableCell className="w-[160px] text-right">
                        <div className="flex items-center justify-end gap-2">
                          {activeTab === 'current' && canAdd && <Link href={getRenewalHref(row)}><Button size="sm" className="h-8 bg-amber-500 px-3 hover:bg-amber-600"><RefreshCw className="mr-1 h-3.5 w-3.5" />Renew</Button></Link>}
                          {canEdit && <Button size="sm" variant="outline" onClick={() => openEdit(row)} className="h-8 px-3">
                            Edit
                          </Button>}
                          {canDelete && <Button size="sm" variant="destructive" onClick={() => setDeleteRow(row)} className="h-8 px-3">
                            Delete
                          </Button>}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </table>
          </div>
          )}
          </div>
          <VehicleTablePagination
            currentPage={pucPagination.currentPage}
            totalPages={pucPagination.totalPages}
            totalRows={filteredRows.length}
            pageSize={pucPagination.pageSize}
            onPageChange={pucPagination.setCurrentPage}
          />
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) setIsRenewalMode(false); }}>
        <DialogContent className="vm-mobile-dialog flex max-h-[92vh] w-[calc(100vw-2rem)] max-w-5xl flex-col gap-0 overflow-hidden rounded-2xl border-slate-200 bg-slate-50 p-0 shadow-2xl">
          <div className="vm-dialog-header shrink-0 border-b border-emerald-100 bg-gradient-to-r from-emerald-50 via-white to-cyan-50 px-4 py-4 pr-12 sm:px-6 sm:py-5">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-500/20"><FileCheck2 className="h-5 w-5" /></div>
              <div className="min-w-0 flex-1">
                {isRenewalMode && renewingFromId && !editingRow && <span className="mb-1 inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">Renewing Existing Certificate</span>}
                <DialogTitle className="text-lg text-slate-900">{editingRow ? 'Edit PUC Certificate' : isRenewalMode && renewingFromId ? 'Renew PUC Certificate' : 'Add PUC Certificate'}</DialogTitle>
                <DialogDescription className="mt-0.5">Certificate number, testing details, validity, readings, and document.</DialogDescription>
              </div>
              <div className="hidden items-center gap-1.5 sm:flex"><span className="rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-emerald-700">Certificate</span><span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600">Document</span></div>
            </div>
          </div>
          <div className="vm-dialog-body min-h-0 flex-1 overflow-y-auto bg-slate-50/80 px-3 py-3 sm:px-6 sm:py-5">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
              <div className="mb-4 flex items-center justify-between border-b border-slate-100 pb-3">
                <div><p className="text-sm font-semibold text-slate-800">Certificate Information</p><p className="text-xs text-muted-foreground">Select the vehicle and enter the latest emission certificate details.</p></div>
                <span className="rounded-full bg-rose-50 px-2.5 py-1 text-[11px] font-medium text-rose-600">* Required</span>
              </div>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
                <SelectField label="Vehicle Number *" value={form.vehicleId} onValueChange={(v) => setField('vehicleId', v)} options={vehicleOptions} />
                <Field label="PUC Certificate Number *">
                  <Input value={form.pucCertificateNumber} onChange={(e) => setField('pucCertificateNumber', e.target.value)} className="h-9" />
                </Field>
                <Field label="Issue Date *">
                  <Input type="date" value={form.issueDate} onChange={(e) => setField('issueDate', e.target.value)} className="h-9" />
                </Field>
                <Field label="Expiry Date *">
                  <Input type="date" value={form.expiryDate} onChange={(e) => setField('expiryDate', e.target.value)} className="h-9" />
                </Field>
                <Field label="Testing Center Name *">
                  <Input value={form.testingCenterName} onChange={(e) => setField('testingCenterName', e.target.value)} className="h-9" />
                </Field>
                <Field label="Amount Paid *">
                  <Input type="number" value={form.amountPaid} onChange={(e) => setField('amountPaid', e.target.value)} className="h-9" />
                </Field>
                <Field label="Certificate Upload *" className="md:col-span-2 xl:col-span-3">
                  <div className="space-y-1.5">
                    <label
                      htmlFor="puc-file"
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
                      id="puc-file"
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png,.webp"
                      className="sr-only"
                      onChange={(event) => setFile(event.target.files?.[0] || null)}
                    />
                    {!file && form.certificateDocumentUrl && (
                      <a
                        href={form.certificateDocumentUrl}
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
          <DialogFooter className="vm-dialog-footer shrink-0 border-t border-slate-200 bg-white px-3 py-3 shadow-[0_-10px_30px_-25px_rgba(15,23,42,0.5)] sm:px-6 sm:py-4 sm:justify-between">
            <p className="hidden text-xs text-muted-foreground sm:block">Review certificate dates and vehicle before saving.</p>
            <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
            <Button variant="outline" onClick={() => { setDialogOpen(false); setIsRenewalMode(false); }} className="h-10 bg-white">
              Cancel
            </Button>
            <Button onClick={() => void submit()} disabled={isSaving} className="h-10 bg-gradient-to-r from-emerald-500 to-teal-600 px-5 text-white shadow-sm hover:from-emerald-600 hover:to-teal-700">
              {isSaving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              {editingRow ? 'Update' : 'Save'}
            </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteRow} onOpenChange={(open) => (!open ? setDeleteRow(null) : null)}>
        <AlertDialogContent className="vm-panel-strong">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete PUC Record</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. Certificate <b>{deleteRow?.pucCertificateNumber || ''}</b> will be deleted.
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
        title="Import PUC Records"
        fields={PUC_IMPORT_FIELDS}
        onSaveRow={savePucRow}
        onImportComplete={() => {
          const vehicleIds = Array.from(importedVehicleIdsRef.current);
          importedVehicleIdsRef.current.clear();
          void Promise.all(vehicleIds.map((vehicleId) => syncVehicleComplianceStatus(vehicleId)));
          void loadRows();
        }}
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
        'space-y-1.5 rounded-xl border border-slate-200 bg-slate-50/40 px-3 py-2.5 transition-all hover:border-emerald-200 hover:bg-white focus-within:border-emerald-400 focus-within:bg-white focus-within:ring-2 focus-within:ring-emerald-100',
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
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);
  return (
    <Field label={label} className={className}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" role="combobox" aria-expanded={open} className="h-9 w-full justify-between border-slate-200 bg-white px-3 text-[13px] font-normal">
            <span className={cn('truncate text-left', !selected && 'text-muted-foreground')}>{selected?.label || `Select ${label.toLowerCase()}`}</span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
          <Command>
            <CommandInput placeholder="Type vehicle number to search..." />
            <CommandList>
              <CommandEmpty>No vehicle found.</CommandEmpty>
              <CommandGroup>
                {options.map((option) => (
                  <CommandItem key={option.value} value={`${option.label} ${option.value}`} onSelect={() => { onValueChange(option.value); setOpen(false); }}>
                    <Check className={cn('mr-2 h-4 w-4', value === option.value ? 'opacity-100' : 'opacity-0')} />
                    <span className="truncate">{option.label}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </Field>
  );
}
