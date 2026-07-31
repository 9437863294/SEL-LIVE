'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import {
  addDoc,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { db, storage } from '@/lib/firebase';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useVehicleOptions } from '@/components/vehicle-management/hooks';
import { useRenewalPrefill } from '@/components/vehicle-management/use-renewal-prefill';
import { useAuth } from '@/components/auth/AuthProvider';
import { createUserNotification } from '@/lib/notifications';
import { compareCreatedAtDesc, computeRenewalMeta, formatVehicleTimestamp, getVehicleDateRangeError, normalizeVehicleRegistration, VEHICLE_COLLECTIONS } from '@/lib/vehicle-management';
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
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import ExcelJS from 'exceljs';
import { Check, ChevronsUpDown, Download, ExternalLink, Eye, FileUp, History, Loader2, Pencil, RefreshCw, RotateCcw, Search, ShieldCheck, Trash2, Upload } from 'lucide-react';
import { VehicleImportDialog, type ImportField } from '@/components/vehicle-management/import-dialog';
import { VehicleTablePagination, useVehicleTablePagination } from '@/components/vehicle-management/table-pagination';

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

const insuranceAlertClass = (stage: string) =>
  cn(
    'whitespace-nowrap border text-xs font-semibold',
    stage === 'Expired' && 'border-rose-200 bg-rose-50 text-rose-700',
    ['Due Today', '7d', '15d', '30d'].includes(stage) && 'border-amber-200 bg-amber-50 text-amber-700',
    stage === 'Not Due' && 'border-emerald-200 bg-emerald-50 text-emerald-700',
    stage === 'Missing' && 'border-slate-200 bg-slate-100 text-slate-600'
  );

export default function InsuranceManagementPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { log } = useActivityLogger('Vehicle Management');
  const { can } = useAuthorization();
  const { rows: vehicleRows, options: vehicleOptions, map: vehicleMap } = useVehicleOptions();
  const { prefill, renewingFromId, workflowCaseId } = useRenewalPrefill();

  const canView = can('View', 'Vehicle Management.Insurance Management');
  const canAdd = can('Add', 'Vehicle Management.Insurance Management');
  const canEdit = can('Edit', 'Vehicle Management.Insurance Management');
  const canDelete = can('Delete', 'Vehicle Management.Insurance Management');
  const canExport = can('Export', 'Vehicle Management.Insurance Management') || canView;
  const canImport = can('Import', 'Vehicle Management.Insurance Management') || canAdd;

  const [rows, setRows] = useState<InsuranceRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'current' | 'history'>('current');
  const [policyTypeFilter, setPolicyTypeFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [expiryFilter, setExpiryFilter] = useState('All');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<InsuranceRow | null>(null);
  const [viewRow, setViewRow] = useState<InsuranceRow | null>(null);
  const [deleteRow, setDeleteRow] = useState<InsuranceRow | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [form, setForm] = useState<InsuranceForm>(buildInitialState());
  const [file, setFile] = useState<File | null>(null);
  const [isRenewalMode, setIsRenewalMode] = useState(false);
  const prefillApplied = useRef(false);
  const importedVehicleIdsRef = useRef(new Set<string>());

  const loadRows = async () => {
    setIsLoading(true);
    try {
      const snap = await getDocs(collection(db, VEHICLE_COLLECTIONS.insurance));
      const data = snap.docs
        .map((entry): InsuranceRow => {
          const row: InsuranceRow = { id: entry.id, ...(entry.data() as Record<string, any>) };
          const meta = computeRenewalMeta(String(row.expiryDate || ''));
          return {
            ...row,
            alertStage: meta.alertStage,
            complianceStatus: meta.complianceStatus,
            renewalStatus: row.isArchived || row.renewalStatus === 'Renewed'
              ? 'Renewed'
              : meta.alertStage === 'Expired'
                ? 'Overdue'
                : ['Due Today', '7d', '15d', '30d'].includes(meta.alertStage)
                  ? 'Due Soon'
                  : 'Not Due',
          };
        })
        .sort(compareCreatedAtDesc);
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
      toast({ title: 'Renewal Record Not Found', description: 'The original insurance policy could not be loaded.', variant: 'destructive' });
      return;
    }
    prefillApplied.current = true;
    const next = renewalSource ? mapRowToState(renewalSource) : buildInitialState();
    next.policyDocumentUrl = '';
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
    const term = query.trim().toLowerCase();
    const base = rows.filter((row) => activeTab === 'history' ? row.isArchived === true : row.isArchived !== true);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return base.filter((row) => {
      if (policyTypeFilter !== 'All' && String(row.policyType || '') !== policyTypeFilter) return false;
      const alert = String(row.alertStage || '');
      if (statusFilter === 'Valid' && !['Not Due'].includes(alert)) return false;
      if (statusFilter === 'Due Soon' && !['Due Today', '7d', '15d', '30d'].includes(alert)) return false;
      if (statusFilter === 'Expired' && alert !== 'Expired') return false;
      if (statusFilter === 'Missing' && alert !== 'Missing') return false;

      if (expiryFilter !== 'All') {
        const expiry = row.expiryDate ? new Date(`${row.expiryDate}T00:00:00`) : null;
        if (!expiry || Number.isNaN(expiry.getTime())) return false;
        const days = Math.ceil((expiry.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
        if (expiryFilter === 'This Month' && (expiry.getMonth() !== today.getMonth() || expiry.getFullYear() !== today.getFullYear())) return false;
        if (expiryFilter === 'Next 30 Days' && (days < 0 || days > 30)) return false;
        if (expiryFilter === 'Next 90 Days' && (days < 0 || days > 90)) return false;
        if (expiryFilter === 'This Year' && expiry.getFullYear() !== today.getFullYear()) return false;
      }

      if (!term) return true;
      return [
        row.vehicleNumber,
        row.insuranceCompany,
        row.policyNumber,
        row.expiryDate,
        row.alertStage,
        row.renewalStatus,
        row.complianceStatus,
      ]
        .map((value) => String(value || '').toLowerCase())
        .some((value) => value.includes(term));
    });
  }, [activeTab, expiryFilter, policyTypeFilter, query, rows, statusFilter]);
  const insurancePagination = useVehicleTablePagination(filteredRows);

  const currentCount = useMemo(() => rows.filter((row) => row.isArchived !== true).length, [rows]);
  const historyCount = useMemo(() => rows.filter((row) => row.isArchived === true).length, [rows]);
  const attentionCount = useMemo(() => rows.filter((row) => row.isArchived !== true && ['Expired', 'Due Today', '7d', '15d', '30d'].includes(String(row.alertStage || ''))).length, [rows]);

  const resetFilters = () => {
    setQuery('');
    setPolicyTypeFilter('All');
    setStatusFilter('All');
    setExpiryFilter('All');
  };

  const getRenewalHref = (row: InsuranceRow) => {
    return `/vehicle-management/insurance/workflow?insuranceId=${encodeURIComponent(String(row.id))}`;
  };

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
    const importedVehicleNumber = normalizeVehicleRegistration(row.vehicleNumber);
    const matchedVehicle = vehicleRows.find((vehicle) =>
      normalizeVehicleRegistration(vehicle.vehicleNumber || vehicle.registrationNo) === importedVehicleNumber
    );
    if (!matchedVehicle) throw new Error(`Vehicle ${row.vehicleNumber || ''} was not found in Vehicle Master.`);
    const dateError = getVehicleDateRangeError(row.startDate, row.expiryDate, 'Start date', 'Expiry date');
    if (dateError) throw new Error(dateError);
    const meta = computeRenewalMeta(String(row.expiryDate || ''));
    await addDoc(collection(db, VEHICLE_COLLECTIONS.insurance), {
      vehicleId: matchedVehicle.id,
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

  const openEdit = (row: InsuranceRow) => {
    if (!canEdit) return;
    setEditingRow(row);
    setForm(mapRowToState(row));
    setFile(null);
    setIsRenewalMode(false);
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
    const dateError = getVehicleDateRangeError(form.startDate, form.expiryDate, 'Start date', 'Expiry date');
    if (dateError) {
      toast({ title: 'Validation Error', description: dateError, variant: 'destructive' });
      return;
    }
    if (form.idvValue && (!Number.isFinite(Number(form.idvValue)) || Number(form.idvValue) < 0)) {
      toast({ title: 'Validation Error', description: 'IDV Value must be a valid positive amount.', variant: 'destructive' });
      return;
    }
    if (file && file.size > 10 * 1024 * 1024) {
      toast({ title: 'Validation Error', description: 'Insurance document must be smaller than 10 MB.', variant: 'destructive' });
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

      let savedId = '';
      if (editingRow) {
        savedId = String(editingRow.id);
        await updateDoc(doc(db, VEHICLE_COLLECTIONS.insurance, String(editingRow.id)), {
          ...payload,
          updatedAt: serverTimestamp(),
        });
      } else {
        const created = await addDoc(collection(db, VEHICLE_COLLECTIONS.insurance), {
          ...payload,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        savedId = created.id;
      }

      if (form.vehicleId) await syncVehicleComplianceStatus(String(form.vehicleId));

      if (!editingRow && isRenewalMode && renewingFromId) {
        try {
          await updateDoc(doc(db, VEHICLE_COLLECTIONS.insurance, renewingFromId), {
            renewalStatus: 'Renewed',
            renewedById: savedId,
            renewedAt: serverTimestamp(),
            isArchived: true,
          });
        } catch (error) {
          console.error('Unable to archive renewed insurance row', error);
        }
      }

      if (!editingRow && workflowCaseId) {
        try {
          const caseRef = doc(db, VEHICLE_COLLECTIONS.insuranceWorkflowCases, workflowCaseId);
          const caseSnapshot = await getDoc(caseRef);
          if (caseSnapshot.exists()) {
            const caseData = caseSnapshot.data() as Record<string, any>;
            const completedAt = Timestamp.now();
            const historyEntry = {
              action: 'Policy Activated',
              comment: `Renewed policy ${form.policyNumber.trim()} saved and activated.`,
              userId: user?.id || '',
              userName: user?.name || user?.email || 'User',
              stepId: 'activation',
              stepName: 'Policy Activation',
              timestamp: completedAt,
            };
            await updateDoc(caseRef, {
              status: 'Completed',
              currentStepName: 'Completed',
              currentStepIndex: Number(caseData.totalSteps || 0),
              renewedInsuranceId: savedId,
              workflowDeadline: null,
              completedAt,
              updatedAt: completedAt,
              history: arrayUnion(historyEntry),
            });
            await addDoc(collection(db, VEHICLE_COLLECTIONS.insuranceWorkflowActivities), {
              caseId: workflowCaseId,
              insuranceId: renewingFromId || '',
              vehicleId: form.vehicleId,
              vehicleNumber: vehicle?.vehicleNumber || vehicle?.registrationNo || '',
              action: historyEntry.action,
              comment: historyEntry.comment,
              userId: historyEntry.userId,
              userName: historyEntry.userName,
              stepId: historyEntry.stepId,
              stepName: historyEntry.stepName,
              createdAt: serverTimestamp(),
            });
            await Promise.all((Array.isArray(caseData.assigneeIds) ? caseData.assigneeIds : []).map((userId: string) => createUserNotification(userId, {
              type: 'workflow_complete',
              title: 'Insurance renewal completed',
              body: `${vehicle?.vehicleNumber || form.policyNumber} policy is active`,
              module: 'insurance',
              itemId: workflowCaseId,
              itemRef: form.policyNumber,
              stepName: 'Policy Activation',
              link: `/vehicle-management/insurance/workflow?case=${workflowCaseId}`,
            }).catch(() => undefined)));
          }
        } catch (error) {
          console.error('Unable to close insurance workflow case', error);
          toast({ title: 'Policy saved', description: 'The policy was saved, but the workflow case could not be closed. Open the workflow and retry.', variant: 'destructive' });
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
      setIsRenewalMode(false);
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
        <CardHeader className="flex flex-col gap-3 px-3 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-6">
          <div className="flex items-start gap-3">
            <div className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 sm:flex">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <div>
              <CardTitle>Insurance Management</CardTitle>
              <CardDescription>Manage current policies, renewals, expiry status, and policy history.</CardDescription>
            </div>
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
              Add Insurance
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 px-3 pb-4 sm:px-6 sm:pb-6">
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 px-3 py-2.5"><p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">Current</p><p className="text-xl font-bold text-emerald-800">{currentCount}</p></div>
            <div className="rounded-xl border border-amber-100 bg-amber-50/70 px-3 py-2.5"><p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">Needs Attention</p><p className="text-xl font-bold text-amber-800">{attentionCount}</p></div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5"><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">History</p><p className="text-xl font-bold text-slate-700">{historyCount}</p></div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
            <div className="mb-3 flex w-full rounded-lg border border-slate-200 bg-slate-100 p-1 sm:w-fit">
              <button type="button" onClick={() => setActiveTab('current')} className={cn('flex-1 rounded-md px-4 py-2 text-xs font-semibold transition-colors sm:flex-none', activeTab === 'current' ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-500 hover:text-slate-700')}>Current Policies <span className="ml-1 text-[10px] opacity-70">{currentCount}</span></button>
              <button type="button" onClick={() => setActiveTab('history')} className={cn('flex flex-1 items-center justify-center gap-1.5 rounded-md px-4 py-2 text-xs font-semibold transition-colors sm:flex-none', activeTab === 'history' ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-500 hover:text-slate-700')}><History className="h-3.5 w-3.5" />History <span className="text-[10px] opacity-70">{historyCount}</span></button>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-5">
              <div className="relative sm:col-span-2 xl:col-span-1">
                <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Vehicle, policy or company..." value={query} onChange={(event) => setQuery(event.target.value)} className="h-10 bg-white pl-9" />
              </div>
              <Select value={policyTypeFilter} onValueChange={setPolicyTypeFilter}>
                <SelectTrigger className="h-10 bg-white"><SelectValue placeholder="Policy type" /></SelectTrigger>
                <SelectContent><SelectItem value="All">All Policy Types</SelectItem>{policyTypeOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-10 bg-white"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>{['All', 'Valid', 'Due Soon', 'Expired', 'Missing'].map((status) => <SelectItem key={status} value={status}>{status === 'All' ? 'All Statuses' : status}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={expiryFilter} onValueChange={setExpiryFilter}>
                <SelectTrigger className="h-10 bg-white"><SelectValue placeholder="Expiry period" /></SelectTrigger>
                <SelectContent>{['All', 'This Month', 'Next 30 Days', 'Next 90 Days', 'This Year'].map((period) => <SelectItem key={period} value={period}>{period === 'All' ? 'All Expiry Dates' : period}</SelectItem>)}</SelectContent>
              </Select>
              <Button type="button" variant="outline" onClick={resetFilters} className="h-10 bg-white"><RotateCcw className="mr-2 h-4 w-4" />Reset</Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Showing {filteredRows.length} of {activeTab === 'current' ? currentCount : historyCount} policies</p>
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
              insurancePagination.paginatedRows.map((row) => (
                <div key={row.id} role="button" tabIndex={0} onClick={() => setViewRow(row)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setViewRow(row); } }} className="cursor-pointer rounded-xl border border-white/70 bg-white/85 p-4 shadow-sm transition-transform active:scale-[0.99]">
                  {/* Top: vehicle number + alert badge */}
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">{row.vehicleNumber || '-'}</p>
                      <p className="text-xs text-muted-foreground">{row.insuranceCompany || '-'}</p>
                    </div>
                    <Badge variant="outline" className={insuranceAlertClass(String(row.alertStage || ''))}>
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
                  <div className="mt-3 flex items-center justify-end gap-1.5 border-t border-slate-100 pt-3">
                    {row.policyDocumentUrl && <Button type="button" size="icon" variant="outline" className="h-9 w-9 border-emerald-200 bg-emerald-50 text-emerald-700" title="View uploaded policy document" aria-label="View uploaded policy document" asChild><a href={String(row.policyDocumentUrl)} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}><Eye className="h-4 w-4" /></a></Button>}
                    {activeTab === 'current' && canAdd && <Link href={getRenewalHref(row)} onClick={(event) => event.stopPropagation()}><Button type="button" size="icon" className="h-9 w-9 bg-amber-500 text-white hover:bg-amber-600" title="Renew policy" aria-label="Renew policy"><RefreshCw className="h-4 w-4" /></Button></Link>}
                    <Button type="button" size="icon" variant="outline" onClick={(event) => { event.stopPropagation(); openEdit(row); }} disabled={!canEdit} className="h-9 w-9 bg-white text-slate-700" title="Edit insurance" aria-label="Edit insurance"><Pencil className="h-4 w-4" /></Button>
                    <Button type="button" size="icon" variant="outline" onClick={(event) => { event.stopPropagation(); setDeleteRow(row); }} disabled={!canDelete} className="h-9 w-9 border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100 hover:text-rose-700" title="Delete insurance" aria-label="Delete insurance"><Trash2 className="h-4 w-4" /></Button>
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
          <div className="min-h-[320px] overflow-auto rounded-xl border border-slate-200 bg-white h-[calc(100vh-500px)]">
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
                  <TableHead>Created Time</TableHead>
                  <TableHead className="text-center">Document</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 4 }).map((_, index) => (
                    <TableRow key={index}>
                      <TableCell colSpan={10}>
                        <Skeleton className="h-8 w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  insurancePagination.paginatedRows.map((row) => (
                    <TableRow key={String(row.id)} tabIndex={0} onClick={() => setViewRow(row)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setViewRow(row); } }} className="cursor-pointer transition-colors hover:bg-emerald-50/60 focus-visible:bg-emerald-50 focus-visible:outline-none">
                      <TableCell className="font-semibold text-slate-800">{row.vehicleNumber || '-'}</TableCell>
                      <TableCell>{row.insuranceCompany || '-'}</TableCell>
                      <TableCell>{row.policyNumber || '-'}</TableCell>
                      <TableCell>{row.expiryDate || '-'}</TableCell>
                      <TableCell><Badge variant="outline" className={insuranceAlertClass(String(row.alertStage || ''))}>{row.alertStage || '-'}</Badge></TableCell>
                      <TableCell>{row.renewalStatus || '-'}</TableCell>
                      <TableCell>{row.complianceStatus || '-'}</TableCell>
                      <TableCell className="whitespace-nowrap">{formatVehicleTimestamp(row.createdAt)}</TableCell>
                      <TableCell className="text-center">{row.policyDocumentUrl ? <Button type="button" size="icon" variant="ghost" className="h-8 w-8 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800" title="View uploaded policy document" aria-label="View uploaded policy document" asChild><a href={String(row.policyDocumentUrl)} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}><Eye className="h-4 w-4" /></a></Button> : <span className="text-xs text-muted-foreground">-</span>}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {activeTab === 'current' && canAdd && (
                            <Link href={getRenewalHref(row)} onClick={(event) => event.stopPropagation()}>
                              <Button type="button" size="icon" className="h-8 w-8 bg-amber-500 text-white hover:bg-amber-600" title="Renew policy" aria-label="Renew policy"><RefreshCw className="h-3.5 w-3.5" /></Button>
                            </Link>
                          )}
                          <Button type="button" size="icon" variant="ghost" onClick={(event) => { event.stopPropagation(); openEdit(row); }} disabled={!canEdit} className="h-8 w-8 text-slate-700 hover:bg-slate-100" title="Edit insurance" aria-label="Edit insurance">
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button type="button" size="icon" variant="ghost" onClick={(event) => { event.stopPropagation(); setDeleteRow(row); }} disabled={!canDelete} className="h-8 w-8 text-rose-600 hover:bg-rose-50 hover:text-rose-700" title="Delete insurance" aria-label="Delete insurance">
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
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
            currentPage={insurancePagination.currentPage}
            totalPages={insurancePagination.totalPages}
            totalRows={filteredRows.length}
            pageSize={insurancePagination.pageSize}
            onPageChange={insurancePagination.setCurrentPage}
          />
        </CardContent>
      </Card>

      <Dialog open={!!viewRow} onOpenChange={(open) => { if (!open) setViewRow(null); }}>
        <DialogContent size="default" className="vm-mobile-dialog flex max-h-[88vh] w-[calc(100vw-1.5rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
          {viewRow && <>
            <DialogHeader className="shrink-0 border-b border-emerald-100 bg-gradient-to-r from-emerald-50 via-white to-cyan-50 px-4 py-3 pr-12">
              <DialogTitle className="flex items-center gap-2 text-base"><ShieldCheck className="h-4 w-4 text-emerald-600" />{viewRow.vehicleNumber || 'Insurance Policy'}</DialogTitle>
              <DialogDescription className="truncate text-xs">{viewRow.policyNumber || '-'} · {viewRow.insuranceCompany || '-'}</DialogDescription>
            </DialogHeader>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-slate-50/70 p-3">
              <div className="flex flex-wrap gap-1.5"><Badge variant="outline" className={insuranceAlertClass(String(viewRow.alertStage || ''))}>{viewRow.alertStage || '-'}</Badge><Badge variant="outline" className="bg-white">{viewRow.renewalStatus || '-'}</Badge><Badge variant="outline" className="bg-white">{viewRow.complianceStatus || '-'}</Badge></div>
              <section className="rounded-xl border bg-white p-3 shadow-sm">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">Policy Details</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <InsuranceDetail label="Vehicle Number" value={viewRow.vehicleNumber || '-'} />
                  <InsuranceDetail label="Policy Number" value={viewRow.policyNumber || '-'} />
                  <InsuranceDetail label="Policy Type" value={viewRow.policyType || '-'} />
                  <InsuranceDetail label="Insurance Company" value={viewRow.insuranceCompany || '-'} />
                  <InsuranceDetail label="Start Date" value={viewRow.startDate || '-'} />
                  <InsuranceDetail label="Expiry Date" value={viewRow.expiryDate || '-'} />
                  <InsuranceDetail label="Premium Amount" value={formatInsuranceCurrency(viewRow.premiumAmount)} />
                  <InsuranceDetail label="IDV Value" value={formatInsuranceCurrency(viewRow.idvValue)} />
                  <InsuranceDetail label="Created Time" value={formatVehicleTimestamp(viewRow.createdAt)} />
                </div>
              </section>
              <section className="rounded-xl border bg-white p-3 shadow-sm">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">Agent & Document</p>
                <div className="grid grid-cols-2 gap-2"><InsuranceDetail label="Agent Name" value={viewRow.agentName || '-'} /><InsuranceDetail label="Agent Contact" value={viewRow.agentContact || '-'} /></div>
                {viewRow.policyDocumentUrl ? <a href={String(viewRow.policyDocumentUrl)} target="_blank" rel="noreferrer" className="mt-2 flex items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"><span className="flex min-w-0 items-center gap-2"><Eye className="h-4 w-4 shrink-0" /><span className="truncate">View uploaded policy document</span></span><ExternalLink className="h-3.5 w-3.5 shrink-0" /></a> : <div className="mt-2 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-xs text-muted-foreground">No policy document uploaded.</div>}
              </section>
              {viewRow.remarks && <section className="rounded-xl border bg-white p-3 shadow-sm"><p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Remarks</p><p className="mt-1 whitespace-pre-wrap text-xs text-slate-700">{viewRow.remarks}</p></section>}
            </div>
            <DialogFooter className="shrink-0 border-t bg-white px-3 py-2">
              <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => setViewRow(null)}>Close</Button>
              {activeTab === 'current' && canAdd && <Link href={getRenewalHref(viewRow)}><Button type="button" size="sm" className="h-8 bg-amber-500 text-white hover:bg-amber-600"><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Renew</Button></Link>}
              {canEdit && <Button type="button" size="sm" className="h-8 bg-emerald-600 hover:bg-emerald-700" onClick={() => { const row = viewRow; setViewRow(null); openEdit(row); }}><Pencil className="mr-1.5 h-3.5 w-3.5" />Edit</Button>}
            </DialogFooter>
          </>}
        </DialogContent>
      </Dialog>

      <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) setIsRenewalMode(false); }}>
        <DialogContent className="vm-mobile-dialog flex max-h-[92vh] w-[calc(100vw-2rem)] max-w-5xl flex-col gap-0 overflow-hidden rounded-2xl border-slate-200 bg-slate-50 p-0 shadow-2xl">
          <div className="vm-dialog-header shrink-0 border-b border-emerald-100 bg-gradient-to-r from-emerald-50 via-white to-cyan-50 px-4 py-4 pr-12 sm:px-6 sm:py-5">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-500/20"><ShieldCheck className="h-5 w-5" /></div>
              <div className="min-w-0 flex-1">
                {isRenewalMode && renewingFromId && !editingRow && <span className="mb-1 inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">Renewing Existing Policy</span>}
                <DialogTitle className="text-lg text-slate-900">{editingRow ? 'Edit Insurance Policy' : isRenewalMode && renewingFromId ? 'Renew Insurance Policy' : 'Add Insurance Policy'}</DialogTitle>
                <DialogDescription className="mt-0.5">Policy information, coverage dates, value, agent, and document.</DialogDescription>
              </div>
              <div className="hidden items-center gap-1.5 sm:flex"><span className="rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-emerald-700">Policy Details</span><span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600">Document</span></div>
            </div>
          </div>
          <div className="vm-dialog-body min-h-0 flex-1 overflow-y-auto bg-slate-50/80 px-3 py-3 sm:px-6 sm:py-5">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
              <div className="mb-4 flex items-center justify-between border-b border-slate-100 pb-3">
                <div><p className="text-sm font-semibold text-slate-800">Policy Information</p><p className="text-xs text-muted-foreground">Select the vehicle and enter the latest insurance details.</p></div>
                <span className="rounded-full bg-rose-50 px-2.5 py-1 text-[11px] font-medium text-rose-600">* Required</span>
              </div>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
                <SearchableSelectField
                  label="Vehicle Number *"
                  value={form.vehicleId}
                  onValueChange={(v) => setField('vehicleId', v)}
                  options={vehicleOptions}
                  searchPlaceholder="Type to search vehicle number..."
                />
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
          <DialogFooter className="vm-dialog-footer shrink-0 border-t border-slate-200 bg-white px-3 py-3 shadow-[0_-10px_30px_-25px_rgba(15,23,42,0.5)] sm:px-6 sm:py-4 sm:justify-between">
            <p className="hidden text-xs text-muted-foreground sm:block">Review policy dates and vehicle before saving.</p>
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
        onImportComplete={() => {
          const vehicleIds = Array.from(importedVehicleIdsRef.current);
          importedVehicleIdsRef.current.clear();
          void Promise.all(vehicleIds.map((vehicleId) => syncVehicleComplianceStatus(vehicleId)));
          void loadRows();
          void log('Import Insurance', { vehicleCount: vehicleIds.length });
        }}
      />
    </div>
  );
}

function formatInsuranceCurrency(value: unknown) {
  if (value === '' || value === null || value === undefined) return '-';
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '-';
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount);
}

function InsuranceDetail({ label, value }: { label: string; value: ReactNode }) {
  return <div className="min-w-0 rounded-lg border border-slate-100 bg-slate-50 px-2.5 py-2"><p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p><div className="mt-0.5 truncate text-xs font-medium text-slate-700" title={typeof value === 'string' ? value : undefined}>{value}</div></div>;
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

function SearchableSelectField({
  label,
  value,
  onValueChange,
  options,
  searchPlaceholder,
  className,
}: {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  searchPlaceholder: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const selectedOption = options.find((option) => option.value === value);

  return (
    <Field label={label} className={className}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label={label}
            className="h-9 w-full justify-between border-slate-200 bg-white px-3 text-[13px] font-normal"
          >
            <span className={cn('truncate', !selectedOption && 'text-muted-foreground')}>
              {selectedOption?.label || `Select ${label.replace(/\s*\*$/, '').toLowerCase()}`}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[--radix-popover-trigger-width] p-0"
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <Command>
            <CommandInput autoFocus placeholder={searchPlaceholder} />
            <CommandList>
              <CommandEmpty>No vehicle found.</CommandEmpty>
              <CommandGroup>
                {options.map((option) => (
                  <CommandItem
                    key={option.value}
                    value={option.label}
                    onSelect={() => {
                      onValueChange(option.value);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        'mr-2 h-4 w-4',
                        value === option.value ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                    {option.label}
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
