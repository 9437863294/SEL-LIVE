'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { addDoc, collection, deleteDoc, doc, getDocs, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuthorization } from '@/hooks/useAuthorization';
import {
  useDepartmentOptions,
  useDriverOptions,
  useProjectOptions,
  useVehicleTypeOptions,
} from '@/components/vehicle-management/hooks';
import { getVehicleComplianceRequirements, toVehicleCode, VEHICLE_COLLECTIONS } from '@/lib/vehicle-management';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
import ExcelJS from 'exceljs';
import { Download, FileUp, Loader2 } from 'lucide-react';
import { VehicleImportDialog, type ImportField } from '@/components/vehicle-management/import-dialog';

const DRIVER_UNASSIGNED = '__unassigned__';

const vehicleCategoryOptions = [
  { value: 'Commercial', label: 'Commercial' },
  { value: 'Passenger', label: 'Passenger' },
  { value: 'Light', label: 'Light' },
  { value: 'Medium', label: 'Medium' },
  { value: 'Heavy', label: 'Heavy' },
  { value: 'Special Purpose', label: 'Special Purpose' },
  { value: 'Other', label: 'Other' },
];

const fuelTypeOptions = [
  { value: 'Diesel', label: 'Diesel' },
  { value: 'Petrol', label: 'Petrol' },
  { value: 'CNG', label: 'CNG' },
  { value: 'Electric', label: 'Electric' },
  { value: 'Hybrid', label: 'Hybrid' },
  { value: 'Other', label: 'Other' },
];

const ownershipTypeOptions = [
  { value: 'Owned', label: 'Owned' },
  { value: 'Leased', label: 'Leased' },
  { value: 'Rented', label: 'Rented' },
  { value: 'Attached', label: 'Attached' },
];

const currentStatusOptions = [
  { value: 'In Operation', label: 'In Operation' },
  { value: 'Idle', label: 'Idle' },
  { value: 'On Trip', label: 'On Trip' },
  { value: 'Under Check', label: 'Under Check' },
];

const vehicleStatusOptions = [
  { value: 'Active', label: 'Active' },
  { value: 'Inactive', label: 'Inactive' },
  { value: 'Under Maintenance', label: 'Under Maintenance' },
  { value: 'Sold', label: 'Sold' },
  { value: 'Scrapped', label: 'Scrapped' },
  { value: 'Rented', label: 'Rented' },
  { value: 'Expired Documents', label: 'Expired Documents' },
];

const yesNoOptions = [
  { value: 'Yes', label: 'Yes' },
  { value: 'No', label: 'No' },
];

type VehicleRow = Record<string, any>;
type VehicleFormState = Record<string, string>;

const toText = (value: unknown) => (value === null || value === undefined ? '' : String(value));

const buildInitialState = (): VehicleFormState => ({
  vehicleNumber: '',
  vehicleType: '',
  vehicleCategory: '',
  brand: '',
  model: '',
  yearOfManufacture: '',
  fuelType: '',
  chassisNumber: '',
  engineNumber: '',
  ownershipType: '',
  purchaseDate: '',
  purchaseValue: '',
  currentStatus: 'In Operation',
  assignedDepartmentId: '',
  assignedProjectId: '',
  assignedDriverId: DRIVER_UNASSIGNED,
  currentOdometerKm: '',
  complianceRuleMode: 'Auto',
  requireInsurance: 'Yes',
  requirePuc: 'Yes',
  requireFitness: 'Yes',
  requireRoadTax: 'Yes',
  requirePermit: 'Yes',
  vehicleStatus: 'Active',
  remarks: '',
});

const mapRowToState = (row: VehicleRow): VehicleFormState => ({
  vehicleNumber: toText(row.vehicleNumber),
  vehicleType: toText(row.vehicleType),
  vehicleCategory: toText(row.vehicleCategory),
  brand: toText(row.brand),
  model: toText(row.model),
  yearOfManufacture: toText(row.yearOfManufacture),
  fuelType: toText(row.fuelType),
  chassisNumber: toText(row.chassisNumber),
  engineNumber: toText(row.engineNumber),
  ownershipType: toText(row.ownershipType),
  purchaseDate: toText(row.purchaseDate),
  purchaseValue: toText(row.purchaseValue),
  currentStatus: toText(row.currentStatus) || 'In Operation',
  assignedDepartmentId: toText(row.assignedDepartmentId),
  assignedProjectId: toText(row.assignedProjectId),
  assignedDriverId: toText(row.assignedDriverId) || DRIVER_UNASSIGNED,
  currentOdometerKm: toText(row.currentOdometerKm),
  complianceRuleMode: toText(row.complianceRuleMode) || 'Auto',
  requireInsurance: toText(row.requireInsurance) || 'Yes',
  requirePuc: toText(row.requirePuc) || 'Yes',
  requireFitness: toText(row.requireFitness) || 'Yes',
  requireRoadTax: toText(row.requireRoadTax) || 'Yes',
  requirePermit: toText(row.requirePermit) || 'Yes',
  vehicleStatus: toText(row.vehicleStatus) || 'Active',
  remarks: toText(row.remarks),
});

const requiresManualRules = (form: VehicleFormState) =>
  String(form.complianceRuleMode || '').toLowerCase() === 'manual';

export default function VehicleMasterPage() {
  const { toast } = useToast();
  const { log } = useActivityLogger('Vehicle Management');
  const { can } = useAuthorization();
  const { options: departmentOptions, map: departmentMap } = useDepartmentOptions();
  const { options: projectOptions, map: projectMap } = useProjectOptions();
  const { options: rawDriverOptions, map: driverMap } = useDriverOptions();
  const { options: vehicleTypeOptions } = useVehicleTypeOptions();
  const driverOptions = useMemo(
    () => [{ value: DRIVER_UNASSIGNED, label: '— Unassigned —' }, ...rawDriverOptions],
    [rawDriverOptions]
  );

  const canView = can('View', 'Vehicle Management.Vehicle Master');
  const canAdd = can('Add', 'Vehicle Management.Vehicle Master');
  const canEdit = can('Edit', 'Vehicle Management.Vehicle Master');
  const canDelete = can('Delete', 'Vehicle Management.Vehicle Master');
  const canExport = can('Export', 'Vehicle Management.Vehicle Master') || canView;
  const canImport = can('Import', 'Vehicle Management.Vehicle Master') || canAdd;

  const [rows, setRows] = useState<VehicleRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<VehicleRow | null>(null);
  const [deleteRow, setDeleteRow] = useState<VehicleRow | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [form, setForm] = useState<VehicleFormState>(buildInitialState());

  const loadRows = async () => {
    setIsLoading(true);
    try {
      const snap = await getDocs(collection(db, VEHICLE_COLLECTIONS.vehicleMaster));
      const data = snap.docs
        .map((entry): VehicleRow => ({ id: entry.id, ...(entry.data() as Record<string, any>) }))
        .sort((a, b) => String(a.vehicleNumber || '').localeCompare(String(b.vehicleNumber || '')));
      setRows(data);
    } catch (error) {
      console.error('Failed to load vehicles', error);
      toast({ title: 'Error', description: 'Unable to load vehicle records.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredRows = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((row) =>
      [
        row.vehicleId,
        row.vehicleNumber,
        row.vehicleType,
        row.brand,
        row.model,
        row.assignedDepartmentName,
        row.assignedProjectName,
        row.assignedDriverName,
        row.fuelType,
        row.vehicleStatus,
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
      const ws = wb.addWorksheet('Vehicle Master');
      ws.columns = [
        { header: 'Vehicle ID', key: 'vehicleId', width: 14 },
        { header: 'Vehicle Number', key: 'vehicleNumber', width: 18 },
        { header: 'Vehicle Type', key: 'vehicleType', width: 16 },
        { header: 'Vehicle Category', key: 'vehicleCategory', width: 16 },
        { header: 'Brand', key: 'brand', width: 14 },
        { header: 'Model', key: 'model', width: 14 },
        { header: 'Year of Manufacture', key: 'yearOfManufacture', width: 20 },
        { header: 'Fuel Type', key: 'fuelType', width: 12 },
        { header: 'Chassis Number', key: 'chassisNumber', width: 22 },
        { header: 'Engine Number', key: 'engineNumber', width: 22 },
        { header: 'Ownership Type', key: 'ownershipType', width: 16 },
        { header: 'Purchase Date', key: 'purchaseDate', width: 14 },
        { header: 'Purchase Value', key: 'purchaseValue', width: 16 },
        { header: 'Odometer (KM)', key: 'currentOdometerKm', width: 16 },
        { header: 'Compliance Mode', key: 'complianceRuleMode', width: 16 },
        { header: 'Req. Insurance', key: 'requireInsurance', width: 15 },
        { header: 'Req. PUC', key: 'requirePuc', width: 12 },
        { header: 'Req. Fitness', key: 'requireFitness', width: 13 },
        { header: 'Req. Road Tax', key: 'requireRoadTax', width: 14 },
        { header: 'Req. Permit', key: 'requirePermit', width: 13 },
        { header: 'Department', key: 'assignedDepartmentName', width: 20 },
        { header: 'Project', key: 'assignedProjectName', width: 24 },
        { header: 'Driver', key: 'assignedDriverName', width: 20 },
        { header: 'Current Status', key: 'currentStatus', width: 16 },
        { header: 'Vehicle Status', key: 'vehicleStatus', width: 16 },
        { header: 'Remarks', key: 'remarks', width: 28 },
      ];
      filteredRows.forEach(row => {
        ws.addRow({
          vehicleId: row.vehicleId || '',
          vehicleNumber: row.vehicleNumber || '',
          vehicleType: row.vehicleType || '',
          vehicleCategory: row.vehicleCategory || '',
          brand: row.brand || '',
          model: row.model || '',
          yearOfManufacture: row.yearOfManufacture || '',
          fuelType: row.fuelType || '',
          chassisNumber: row.chassisNumber || '',
          engineNumber: row.engineNumber || '',
          ownershipType: row.ownershipType || '',
          purchaseDate: row.purchaseDate || '',
          purchaseValue: row.purchaseValue || '',
          currentOdometerKm: row.currentOdometerKm || '',
          complianceRuleMode: row.complianceRuleMode || 'Auto',
          requireInsurance: row.requireInsurance || 'Yes',
          requirePuc: row.requirePuc || 'Yes',
          requireFitness: row.requireFitness || 'Yes',
          requireRoadTax: row.requireRoadTax || 'Yes',
          requirePermit: row.requirePermit || 'Yes',
          assignedDepartmentName: row.assignedDepartmentName || '',
          assignedProjectName: row.assignedProjectName || '',
          assignedDriverName: row.assignedDriverName || '',
          currentStatus: row.currentStatus || '',
          vehicleStatus: row.vehicleStatus || '',
          remarks: row.remarks || '',
        });
      });
      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `vehicle-master.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: 'Exported', description: `${filteredRows.length} vehicles exported.` });
    } catch (err) {
      console.error('Export failed', err);
      toast({ title: 'Export Failed', description: 'Unable to export records.', variant: 'destructive' });
    } finally {
      setIsExporting(false);
    }
  };

  const VEHICLE_IMPORT_FIELDS: ImportField[] = [
    { key: 'vehicleNumber', label: 'Vehicle Number', required: true, hint: 'e.g. MH12AB1234', validate: (v) => v.trim() ? null : 'Cannot be empty' },
    { key: 'vehicleType', label: 'Vehicle Type', required: true },
    { key: 'vehicleCategory', label: 'Vehicle Category', required: true, hint: 'Commercial / Passenger / Light / Heavy …' },
    { key: 'brand', label: 'Brand', required: true },
    { key: 'model', label: 'Model', required: true },
    { key: 'yearOfManufacture', label: 'Year of Manufacture', required: true, type: 'number', validate: (v) => { const y = Number(v); return y >= 1900 && y <= new Date().getFullYear() + 2 ? null : `Invalid year: ${v}`; } },
    { key: 'fuelType', label: 'Fuel Type', required: true, hint: 'Diesel / Petrol / CNG / Electric …' },
    { key: 'chassisNumber', label: 'Chassis Number' },
    { key: 'engineNumber', label: 'Engine Number' },
    { key: 'ownershipType', label: 'Ownership Type', hint: 'Owned / Leased / Rented / Attached' },
    { key: 'purchaseDate', label: 'Purchase Date', hint: 'YYYY-MM-DD' },
    { key: 'purchaseValue', label: 'Purchase Value', type: 'number' },
    { key: 'currentOdometerKm', label: 'Odometer (KM)', type: 'number' },
    { key: 'complianceRuleMode', label: 'Compliance Mode', hint: 'Auto / Manual' },
    { key: 'requireInsurance', label: 'Req. Insurance', hint: 'Yes / No' },
    { key: 'requirePuc', label: 'Req. PUC', hint: 'Yes / No' },
    { key: 'requireFitness', label: 'Req. Fitness', hint: 'Yes / No' },
    { key: 'requireRoadTax', label: 'Req. Road Tax', hint: 'Yes / No' },
    { key: 'requirePermit', label: 'Req. Permit', hint: 'Yes / No' },
    { key: 'vehicleStatus', label: 'Vehicle Status', hint: 'Active / Inactive / Under Maintenance …' },
    { key: 'currentStatus', label: 'Current Status', hint: 'In Operation / Idle / On Trip …' },
    { key: 'remarks', label: 'Remarks' },
  ];

  const saveVehicleRow = async (row: Record<string, any>) => {
    const vehicleNumber = String(row.vehicleNumber || '').toUpperCase().replace(/\s+/g, '');
    await addDoc(collection(db, VEHICLE_COLLECTIONS.vehicleMaster), {
      vehicleId: toVehicleCode(Date.now() % 1000000),
      vehicleNumber,
      vehicleType: row.vehicleType || '',
      vehicleCategory: row.vehicleCategory || '',
      brand: row.brand || '',
      model: row.model || '',
      yearOfManufacture: Number(row.yearOfManufacture || 0),
      fuelType: row.fuelType || 'Diesel',
      chassisNumber: String(row.chassisNumber || '').toUpperCase(),
      engineNumber: String(row.engineNumber || '').toUpperCase(),
      ownershipType: row.ownershipType || 'Owned',
      purchaseDate: row.purchaseDate || '',
      purchaseValue: row.purchaseValue ? Number(row.purchaseValue) : '',
      currentOdometerKm: Number(row.currentOdometerKm || 0),
      vehicleStatus: row.vehicleStatus || 'Active',
      currentStatus: row.currentStatus || 'In Operation',
      remarks: row.remarks || '',
      complianceRuleMode: row.complianceRuleMode || 'Auto',
      requireInsurance: row.requireInsurance || 'Yes',
      requirePuc: row.requirePuc || 'Yes',
      requireFitness: row.requireFitness || 'Yes',
      requireRoadTax: row.requireRoadTax || 'Yes',
      requirePermit: row.requirePermit || 'Yes',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  };

  const openAdd = () => {
    if (!canAdd) return;
    setEditingRow(null);
    setForm(buildInitialState());
    setDialogOpen(true);
  };

  const openEdit = (row: VehicleRow) => {
    if (!canEdit) return;
    setEditingRow(row);
    setForm(mapRowToState(row));
    setDialogOpen(true);
  };

  const setField = (key: keyof VehicleFormState, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const submit = async () => {
    if (isSaving) return;
    const requiredFields: Array<[keyof VehicleFormState, string]> = [
      ['vehicleNumber', 'Vehicle Number'],
      ['vehicleType', 'Vehicle Type'],
      ['vehicleCategory', 'Vehicle Category'],
      ['brand', 'Brand'],
      ['model', 'Model'],
      ['yearOfManufacture', 'Year of Manufacture'],
      ['fuelType', 'Fuel Type'],
      ['chassisNumber', 'Chassis Number'],
      ['engineNumber', 'Engine Number'],
      ['ownershipType', 'Ownership Type'],
      ['currentOdometerKm', 'Current Odometer (KM)'],
      ['vehicleStatus', 'Vehicle Status'],
    ];

    for (const [key, label] of requiredFields) {
      if (!toText(form[key]).trim()) {
        toast({ title: 'Validation Error', description: `${label} is required.`, variant: 'destructive' });
        return;
      }
    }

    const year = Number(form.yearOfManufacture || 0);
    const odometer = Number(form.currentOdometerKm || 0);
    if (!Number.isFinite(year) || year < 1900) {
      toast({ title: 'Validation Error', description: 'Year of Manufacture is invalid.', variant: 'destructive' });
      return;
    }
    if (!Number.isFinite(odometer) || odometer < 0) {
      toast({ title: 'Validation Error', description: 'Current Odometer is invalid.', variant: 'destructive' });
      return;
    }

    try {
      setIsSaving(true);
      const normalizedDriverId = form.assignedDriverId === DRIVER_UNASSIGNED ? '' : form.assignedDriverId;
      const basePayload: Record<string, any> = {
        vehicleNumber: String(form.vehicleNumber || '').toUpperCase().replace(/\s+/g, ''),
        vehicleType: form.vehicleType,
        vehicleCategory: form.vehicleCategory,
        brand: form.brand.trim(),
        model: form.model.trim(),
        yearOfManufacture: year,
        fuelType: form.fuelType,
        chassisNumber: String(form.chassisNumber || '').toUpperCase().trim(),
        engineNumber: String(form.engineNumber || '').toUpperCase().trim(),
        ownershipType: form.ownershipType,
        purchaseDate: form.purchaseDate || '',
        purchaseValue: form.purchaseValue ? Number(form.purchaseValue) : '',
        currentStatus: form.currentStatus || 'In Operation',
        assignedDepartmentId: form.assignedDepartmentId || '',
        assignedDepartmentName: departmentMap[String(form.assignedDepartmentId || '')]?.name || '',
        assignedProjectId: form.assignedProjectId || '',
        assignedProjectName: projectMap[String(form.assignedProjectId || '')]?.projectName || '',
        assignedDriverId: normalizedDriverId,
        assignedDriverName: driverMap[String(normalizedDriverId || '')]?.driverName || '',
        currentOdometerKm: odometer,
        complianceRuleMode: form.complianceRuleMode || 'Auto',
        requireInsurance: form.requireInsurance || 'Yes',
        requirePuc: form.requirePuc || 'Yes',
        requireFitness: form.requireFitness || 'Yes',
        requireRoadTax: form.requireRoadTax || 'Yes',
        requirePermit: form.requirePermit || 'Yes',
        vehicleStatus: form.vehicleStatus,
        remarks: form.remarks || '',
      };

      const requirements = getVehicleComplianceRequirements(basePayload);
      basePayload.requireInsurance = requirements.insurance ? 'Yes' : 'No';
      basePayload.requirePuc = requirements.puc ? 'Yes' : 'No';
      basePayload.requireFitness = requirements.fitness ? 'Yes' : 'No';
      basePayload.requireRoadTax = requirements.roadTax ? 'Yes' : 'No';
      basePayload.requirePermit = requirements.permit ? 'Yes' : 'No';

      let savedId = '';
      if (editingRow) {
        savedId = String(editingRow.id);
        basePayload.vehicleId = editingRow.vehicleId || '';
        await updateDoc(doc(db, VEHICLE_COLLECTIONS.vehicleMaster, savedId), {
          ...basePayload,
          updatedAt: serverTimestamp(),
        });
      } else {
        basePayload.vehicleId = toVehicleCode(Date.now() % 1000000);
        const created = await addDoc(collection(db, VEHICLE_COLLECTIONS.vehicleMaster), {
          ...basePayload,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        savedId = created.id;
      }

      const previousDriverId = String(editingRow?.assignedDriverId || '');
      const nextDriverId = String(basePayload.assignedDriverId || '');
      if (previousDriverId && previousDriverId !== nextDriverId) {
        await updateDoc(doc(db, VEHICLE_COLLECTIONS.driver, previousDriverId), {
          assignedVehicleId: '',
          assignedVehicleNumber: '',
        });
      }
      if (nextDriverId) {
        await updateDoc(doc(db, VEHICLE_COLLECTIONS.driver, nextDriverId), {
          assignedVehicleId: savedId,
          assignedVehicleNumber: String(basePayload.vehicleNumber || ''),
        });
      }

      if (editingRow) {
        await log('Edit Vehicle', { vehicleNumber: form.vehicleNumber, vehicleId: editingRow?.id });
      } else {
        await log('Add Vehicle', { vehicleNumber: form.vehicleNumber, vehicleType: form.vehicleType });
      }
      toast({
        title: editingRow ? 'Updated' : 'Created',
        description: `Vehicle ${editingRow ? 'updated' : 'created'} successfully.`,
      });
      setDialogOpen(false);
      setEditingRow(null);
      setForm(buildInitialState());
      await loadRows();
    } catch (error) {
      console.error('Failed to save vehicle', error);
      toast({ title: 'Error', description: 'Unable to save vehicle.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteRow) return;
    try {
      await deleteDoc(doc(db, VEHICLE_COLLECTIONS.vehicleMaster, String(deleteRow.id)));
      await log('Delete Vehicle', { vehicleNumber: deleteRow?.vehicleNumber, vehicleId: deleteRow?.id });
      toast({ title: 'Deleted', description: 'Vehicle deleted successfully.' });
      setDeleteRow(null);
      await loadRows();
    } catch (error) {
      console.error('Failed to delete vehicle', error);
      toast({ title: 'Error', description: 'Unable to delete vehicle.', variant: 'destructive' });
    }
  };

  if (!canView) {
    return (
      <Card className="vm-panel-strong">
        <CardHeader>
          <CardTitle>Access Restricted</CardTitle>
          <CardDescription>You do not have permission to view Vehicle Master.</CardDescription>
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
            <CardTitle>Vehicle Master</CardTitle>
            <CardDescription>Manage complete vehicle profile and assignment details.</CardDescription>
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
              Add Vehicle
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            placeholder="Search vehicle..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="max-w-xs border-slate-200 bg-white focus-visible:ring-emerald-400/40"
          />
          {/* Mobile card view */}
          <div className="space-y-2.5 sm:hidden">
            {isLoading ? (
              Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 w-full rounded-xl" />)
            ) : filteredRows.length === 0 ? (
              <div className="rounded-xl border border-white/70 bg-white/85 px-4 py-8 text-center text-sm text-muted-foreground">
                No vehicle records found.
              </div>
            ) : (
              filteredRows.map((row) => (
                <div key={String(row.id)} className="rounded-xl border border-white/70 bg-white/85 p-4 shadow-sm active:scale-[0.99] transition-transform">
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">{row.vehicleNumber || '-'}</p>
                      <p className="text-xs text-muted-foreground">{row.vehicleType || '-'} · {row.fuelType || '-'}</p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      String(row.vehicleStatus || '').toLowerCase() === 'active'
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-slate-100 text-slate-600'
                    }`}>{row.vehicleStatus || '-'}</span>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex justify-between gap-2">
                      <span className="text-xs font-medium text-muted-foreground">Vehicle ID</span>
                      <span className="text-xs">{row.vehicleId || '-'}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-xs font-medium text-muted-foreground">Project</span>
                      <span className="text-xs max-w-[60%] text-right truncate">{row.assignedProjectName || 'Unassigned'}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-xs font-medium text-muted-foreground">Driver</span>
                      <span className="text-xs max-w-[60%] text-right truncate">{row.assignedDriverName || '-'}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-xs font-medium text-muted-foreground">Docs Health</span>
                      <span className="text-xs">{row.documentHealthStatus || '-'}</span>
                    </div>
                  </div>
                  <div className="mt-3 flex gap-2 border-t border-slate-100 pt-3">
                    <Button size="sm" variant="outline" onClick={() => openEdit(row)} disabled={!canEdit} className="flex-1 h-10 bg-white/80">Edit</Button>
                    <Button size="sm" variant="destructive" onClick={() => setDeleteRow(row)} disabled={!canDelete} className="flex-1 h-10">Delete</Button>
                  </div>
                </div>
              ))
            )}
          </div>

          {!isLoading && filteredRows.length === 0 ? (
            <div className="hidden sm:block rounded-lg border border-white/70 bg-white/80 px-4 py-10 text-center text-muted-foreground">
              No vehicle records found.
            </div>
          ) : (
          <div className="hidden sm:block overflow-auto rounded-lg border border-white/70 bg-white/80 h-[calc(100vh-230px)]">
            <table className="w-full caption-bottom text-sm">
              <TableHeader className="sticky top-0 z-10 bg-slate-50 shadow-sm">
                <TableRow>
                  <TableHead>Vehicle ID</TableHead>
                  <TableHead>Vehicle Number</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Driver</TableHead>
                  <TableHead>Fuel</TableHead>
                  <TableHead>Docs Health</TableHead>
                  <TableHead>Status</TableHead>
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
                  filteredRows.map((row) => (
                    <TableRow key={String(row.id)} className="hover:bg-emerald-50/70">
                      <TableCell>{row.vehicleId || '-'}</TableCell>
                      <TableCell>{row.vehicleNumber || '-'}</TableCell>
                      <TableCell>{row.vehicleType || '-'}</TableCell>
                      <TableCell>{row.assignedDepartmentName || '-'}</TableCell>
                      <TableCell>{row.assignedProjectName || '-'}</TableCell>
                      <TableCell>{row.assignedDriverName || '-'}</TableCell>
                      <TableCell>{row.fuelType || '-'}</TableCell>
                      <TableCell>{row.documentHealthStatus || '-'}</TableCell>
                      <TableCell>{row.vehicleStatus || '-'}</TableCell>
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
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="flex max-h-[90vh] w-[calc(100vw-2rem)] max-w-5xl flex-col gap-0 overflow-hidden p-0 vm-panel-strong">
          <div className="shrink-0 border-b border-slate-100 bg-gradient-to-r from-emerald-500/5 to-teal-500/5 px-6 pb-4 pt-5 pr-12">
            <DialogTitle>{editingRow ? 'Edit Vehicle' : 'Add Vehicle'}</DialogTitle>
            <DialogDescription>Fill all required details and save.</DialogDescription>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
              <div className="mb-3 rounded-md border border-slate-200 bg-slate-100/90 px-3 py-1.5 text-xs font-semibold text-slate-700">
                General Info
              </div>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
                <Field label="Vehicle Number *">
                  <Input value={form.vehicleNumber} onChange={(e) => setField('vehicleNumber', e.target.value)} className="h-9" />
                </Field>
                <SelectField label="Vehicle Type *" value={form.vehicleType} onValueChange={(v) => setField('vehicleType', v)} options={vehicleTypeOptions} />
                <SelectField label="Vehicle Category *" value={form.vehicleCategory} onValueChange={(v) => setField('vehicleCategory', v)} options={vehicleCategoryOptions} />
                <Field label="Brand *">
                  <Input value={form.brand} onChange={(e) => setField('brand', e.target.value)} className="h-9" />
                </Field>
                <Field label="Model *">
                  <Input value={form.model} onChange={(e) => setField('model', e.target.value)} className="h-9" />
                </Field>
                <Field label="Year Of Manufacture *">
                  <Input value={form.yearOfManufacture} onChange={(e) => setField('yearOfManufacture', e.target.value)} type="number" className="h-9" />
                </Field>
                <SelectField label="Fuel Type *" value={form.fuelType} onValueChange={(v) => setField('fuelType', v)} options={fuelTypeOptions} />
                <Field label="Chassis Number *">
                  <Input value={form.chassisNumber} onChange={(e) => setField('chassisNumber', e.target.value)} className="h-9" />
                </Field>
                <Field label="Engine Number *">
                  <Input value={form.engineNumber} onChange={(e) => setField('engineNumber', e.target.value)} className="h-9" />
                </Field>
                <SelectField label="Ownership Type *" value={form.ownershipType} onValueChange={(v) => setField('ownershipType', v)} options={ownershipTypeOptions} />
                <Field label="Purchase Date">
                  <Input value={form.purchaseDate} onChange={(e) => setField('purchaseDate', e.target.value)} type="date" className="h-9" />
                </Field>
                <Field label="Purchase Value">
                  <Input value={form.purchaseValue} onChange={(e) => setField('purchaseValue', e.target.value)} type="number" className="h-9" />
                </Field>
                <SelectField label="Current Status" value={form.currentStatus} onValueChange={(v) => setField('currentStatus', v)} options={currentStatusOptions} />
                <SelectField label="Assigned Department" value={form.assignedDepartmentId} onValueChange={(v) => setField('assignedDepartmentId', v)} options={departmentOptions} />
                <SelectField label="Assigned Project" value={form.assignedProjectId} onValueChange={(v) => setField('assignedProjectId', v)} options={projectOptions} />
                <SelectField label="Assigned Driver" value={form.assignedDriverId} onValueChange={(v) => setField('assignedDriverId', v)} options={driverOptions} />
                <Field label="Current Odometer (KM) *">
                  <Input value={form.currentOdometerKm} onChange={(e) => setField('currentOdometerKm', e.target.value)} type="number" className="h-9" />
                </Field>
                <SelectField
                  label="Compliance Rule Mode *"
                  value={form.complianceRuleMode}
                  onValueChange={(v) => setField('complianceRuleMode', v)}
                  options={[
                    { value: 'Auto', label: 'Auto (By Vehicle Type/Fuel)' },
                    { value: 'Manual', label: 'Manual (Set Required Docs)' },
                  ]}
                />
                {requiresManualRules(form) && (
                  <>
                    <SelectField label="Insurance Required" value={form.requireInsurance} onValueChange={(v) => setField('requireInsurance', v)} options={yesNoOptions} />
                    <SelectField label="PUC Required" value={form.requirePuc} onValueChange={(v) => setField('requirePuc', v)} options={yesNoOptions} />
                    <SelectField label="Fitness Required" value={form.requireFitness} onValueChange={(v) => setField('requireFitness', v)} options={yesNoOptions} />
                    <SelectField label="Road Tax Required" value={form.requireRoadTax} onValueChange={(v) => setField('requireRoadTax', v)} options={yesNoOptions} />
                    <SelectField label="Permit Required" value={form.requirePermit} onValueChange={(v) => setField('requirePermit', v)} options={yesNoOptions} />
                  </>
                )}
                <SelectField label="Vehicle Status *" value={form.vehicleStatus} onValueChange={(v) => setField('vehicleStatus', v)} options={vehicleStatusOptions} />
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
            <AlertDialogTitle>Delete Vehicle</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. Vehicle <b>{deleteRow?.vehicleNumber || ''}</b> will be deleted.
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
        title="Import Vehicles"
        fields={VEHICLE_IMPORT_FIELDS}
        onSaveRow={saveVehicleRow}
        onImportComplete={() => { void loadRows(); void log('Import Vehicles', {}); }}
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


