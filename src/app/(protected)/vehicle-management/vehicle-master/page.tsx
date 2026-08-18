'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { addDoc, collection, deleteDoc, doc, getDocs, limit, query as firestoreQuery, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuthorization } from '@/hooks/useAuthorization';
import {
  useDepartmentOptions,
  useDriverOptions,
  useProjectOptions,
  useVehicleTypeOptions,
} from '@/components/vehicle-management/hooks';
import { compareCreatedAtDesc, computeRenewalMeta, formatVehicleTimestamp, getVehicleComplianceRequirements, toVehicleCode, VEHICLE_COLLECTIONS } from '@/lib/vehicle-management';
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
import { CarFront, Download, FileUp, Gauge, Loader2, MapPin, ShieldCheck } from 'lucide-react';
import { VehicleImportDialog, type ImportField } from '@/components/vehicle-management/import-dialog';
import { VehicleTablePagination, useVehicleTablePagination } from '@/components/vehicle-management/table-pagination';
import { VehicleDetailsDialog } from '@/components/vehicle-management/vehicle-details-dialog';
import { useFieldControl, validateFieldControlRequirements } from '@/components/vehicle-management/use-field-control';
import { labelWithMark } from '@/components/vehicle-management/controlled-field';

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
const normalizeVehicleNumber = (value: unknown) =>
  String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

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

type ComplianceLookup = { expiryDate: string; status: string };

// Compliance records (insurance/PUC/fitness/road tax/permit) are linked to a vehicle via
// its Firestore document id (`vehicleId` on the compliance doc), not the human-readable
// VEH-xxxxxx code stored on the vehicle master row. For each vehicle we keep only the
// current (non-archived, non-renewed) record with the latest expiry.
const buildLatestComplianceMap = (
  docsData: Record<string, any>[],
  expiryKeys: string[]
): Map<string, ComplianceLookup> => {
  const map = new Map<string, ComplianceLookup & { stamp: number }>();
  docsData.forEach((data) => {
    if (data.isArchived === true || data.renewalStatus === 'Renewed') return;
    const vehicleId = String(data.vehicleId || '');
    if (!vehicleId) return;
    const expiryDate =
      expiryKeys.map((key) => String(data[key] || '').trim()).find((value) => value.length > 0) || '';
    const meta = computeRenewalMeta(expiryDate);
    const stamp = expiryDate && !Number.isNaN(new Date(expiryDate).getTime()) ? new Date(expiryDate).getTime() : 0;
    const existing = map.get(vehicleId);
    if (!existing || stamp >= existing.stamp) {
      map.set(vehicleId, { expiryDate, status: meta.complianceStatus, stamp });
    }
  });
  return map;
};

export default function VehicleMasterPage() {
  const { toast } = useToast();
  const { log } = useActivityLogger('Vehicle Management');
  const { can } = useAuthorization();
  const { field } = useFieldControl('vehicleMaster');
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
  const canRenewInsurance = can('Add', 'Vehicle Management.Insurance Management');
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
  const [detailsVehicle, setDetailsVehicle] = useState<VehicleRow | null>(null);
  const [showDuplicates, setShowDuplicates] = useState(false);
  const knownVehicleNumbersRef = useRef(new Set<string>());

  const loadRows = async () => {
    setIsLoading(true);
    try {
      const snap = await getDocs(collection(db, VEHICLE_COLLECTIONS.vehicleMaster));
      const data = snap.docs
        .map((entry): VehicleRow => ({ id: entry.id, ...(entry.data() as Record<string, any>) }))
        .sort(compareCreatedAtDesc);
      knownVehicleNumbersRef.current = new Set(
        data.map((row) => normalizeVehicleNumber(row.vehicleNumber || row.registrationNo)).filter(Boolean)
      );
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

  // A vehicle number must appear only once. Legacy data can still hold repeats, so the
  // earliest-created record per number is treated as the original registration and the
  // later ones are hidden as duplicates (rows are sorted newest-first, so the last
  // occurrence while iterating is the oldest one).
  const duplicateIds = useMemo(() => {
    const originalIdByNumber = new Map<string, string>();
    rows.forEach((row) => {
      const key = normalizeVehicleNumber(row.vehicleNumber || row.registrationNo);
      if (key) originalIdByNumber.set(key, String(row.id));
    });
    const originals = new Set(originalIdByNumber.values());
    return new Set(
      rows
        .filter((row) => {
          const key = normalizeVehicleNumber(row.vehicleNumber || row.registrationNo);
          return key ? !originals.has(String(row.id)) : false;
        })
        .map((row) => String(row.id))
    );
  }, [rows]);

  const visibleRows = useMemo(
    () => (showDuplicates ? rows : rows.filter((row) => !duplicateIds.has(String(row.id)))),
    [duplicateIds, rows, showDuplicates]
  );

  const filteredRows = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return visibleRows;
    return visibleRows.filter((row) =>
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
  }, [query, visibleRows]);
  const vehiclePagination = useVehicleTablePagination(filteredRows);

  // Live duplicate feedback while typing a vehicle number in the add/edit dialog.
  const duplicateVehicleNumber = useMemo(() => {
    const normalized = normalizeVehicleNumber(form.vehicleNumber);
    if (!normalized) return '';
    const clash = rows.some(
      (row) =>
        String(row.id) !== String(editingRow?.id || '') &&
        normalizeVehicleNumber(row.vehicleNumber || row.registrationNo) === normalized
    );
    return clash ? normalized : '';
  }, [editingRow, form.vehicleNumber, rows]);

  const exportExcel = async () => {
    if (!canExport || isExporting) return;
    setIsExporting(true);
    try {
      const [insSnap, pucSnap, fitSnap, rtSnap, permSnap] = await Promise.all([
        getDocs(collection(db, VEHICLE_COLLECTIONS.insurance)),
        getDocs(collection(db, VEHICLE_COLLECTIONS.puc)),
        getDocs(collection(db, VEHICLE_COLLECTIONS.fitness)),
        getDocs(collection(db, VEHICLE_COLLECTIONS.roadTax)),
        getDocs(collection(db, VEHICLE_COLLECTIONS.permit)),
      ]);
      const insuranceMap = buildLatestComplianceMap(insSnap.docs.map((d) => d.data()), ['expiryDate']);
      const pucMap = buildLatestComplianceMap(pucSnap.docs.map((d) => d.data()), ['expiryDate']);
      const fitnessMap = buildLatestComplianceMap(fitSnap.docs.map((d) => d.data()), ['expiryDate']);
      const roadTaxMap = buildLatestComplianceMap(rtSnap.docs.map((d) => d.data()), ['validTill']);
      const permitMap = buildLatestComplianceMap(permSnap.docs.map((d) => d.data()), ['validTill']);

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
        { header: 'Insurance Status', key: 'insuranceStatus', width: 16 },
        { header: 'Insurance Expiry Date', key: 'insuranceExpiryDate', width: 18 },
        { header: 'PUC Status', key: 'pucStatus', width: 14 },
        { header: 'PUC Expiry Date', key: 'pucExpiryDate', width: 16 },
        { header: 'Fitness Status', key: 'fitnessStatus', width: 14 },
        { header: 'Fitness Expiry Date', key: 'fitnessExpiryDate', width: 18 },
        { header: 'Road Tax Status', key: 'roadTaxStatus', width: 14 },
        { header: 'Road Tax Valid Till', key: 'roadTaxValidTill', width: 18 },
        { header: 'Permit Status', key: 'permitStatus', width: 14 },
        { header: 'Permit Valid Till', key: 'permitValidTill', width: 18 },
        { header: 'Remarks', key: 'remarks', width: 28 },
      ];
      filteredRows.forEach(row => {
        const requirements = getVehicleComplianceRequirements(row);
        const insurance = insuranceMap.get(String(row.id || ''));
        const puc = pucMap.get(String(row.id || ''));
        const fitness = fitnessMap.get(String(row.id || ''));
        const roadTax = roadTaxMap.get(String(row.id || ''));
        const permit = permitMap.get(String(row.id || ''));
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
          insuranceStatus: requirements.insurance ? (insurance?.status || 'Missing') : 'Not Applicable',
          insuranceExpiryDate: insurance?.expiryDate || '',
          pucStatus: requirements.puc ? (puc?.status || 'Missing') : 'Not Applicable',
          pucExpiryDate: puc?.expiryDate || '',
          fitnessStatus: requirements.fitness ? (fitness?.status || 'Missing') : 'Not Applicable',
          fitnessExpiryDate: fitness?.expiryDate || '',
          roadTaxStatus: requirements.roadTax ? (roadTax?.status || 'Missing') : 'Not Applicable',
          roadTaxValidTill: roadTax?.expiryDate || '',
          permitStatus: requirements.permit ? (permit?.status || 'Missing') : 'Not Applicable',
          permitValidTill: permit?.expiryDate || '',
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
    {
      key: 'vehicleNumber',
      label: 'Vehicle Number',
      required: true,
      hint: 'e.g. MH12AB1234 — must not already exist',
      validate: (v) => {
        const normalized = normalizeVehicleNumber(v);
        if (!normalized) return 'Cannot be empty';
        if (knownVehicleNumbersRef.current.has(normalized)) return `${normalized} is already in Vehicle Master`;
        return null;
      },
    },
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
    const vehicleNumber = normalizeVehicleNumber(row.vehicleNumber);
    if (!vehicleNumber) throw new Error('Vehicle number is required.');
    if (knownVehicleNumbersRef.current.has(vehicleNumber)) {
      throw new Error(`Vehicle ${vehicleNumber} already exists.`);
    }
    const duplicateSnap = await getDocs(
      firestoreQuery(
        collection(db, VEHICLE_COLLECTIONS.vehicleMaster),
        where('vehicleNumber', '==', vehicleNumber)
      )
    );
    if (!duplicateSnap.empty) {
      knownVehicleNumbersRef.current.add(vehicleNumber);
      throw new Error(`Vehicle ${vehicleNumber} already exists.`);
    }
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
    knownVehicleNumbersRef.current.add(vehicleNumber);
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
    if (!toText(form.vehicleNumber).trim()) {
      toast({ title: 'Validation Error', description: `${field('vehicleNumber').label} is required.`, variant: 'destructive' });
      return;
    }
    const missingLabel = validateFieldControlRequirements('vehicleMaster', { ...form }, field);
    if (missingLabel) {
      toast({ title: 'Validation Error', description: `${missingLabel} is required.`, variant: 'destructive' });
      return;
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
      const normalizedVehicleNumber = normalizeVehicleNumber(form.vehicleNumber);
      const existingLocalRow = rows.find(
        (row) =>
          String(row.id) !== String(editingRow?.id || '') &&
          normalizeVehicleNumber(row.vehicleNumber || row.registrationNo) === normalizedVehicleNumber
      );
      if (existingLocalRow) {
        toast({
          title: 'Duplicate Vehicle',
          description: `Vehicle ${normalizedVehicleNumber} already exists. Open the existing record to update it.`,
          variant: 'destructive',
        });
        return;
      }
      const duplicateSnap = await getDocs(
        firestoreQuery(
          collection(db, VEHICLE_COLLECTIONS.vehicleMaster),
          where('vehicleNumber', '==', normalizedVehicleNumber)
        )
      );
      const duplicateOnServer = duplicateSnap.docs.some((entry) => entry.id !== String(editingRow?.id || ''));
      if (duplicateOnServer) {
        toast({
          title: 'Duplicate Vehicle',
          description: `Vehicle ${normalizedVehicleNumber} is already registered.`,
          variant: 'destructive',
        });
        return;
      }
      const normalizedDriverId = form.assignedDriverId === DRIVER_UNASSIGNED ? '' : form.assignedDriverId;
      const basePayload: Record<string, any> = {
        vehicleNumber: normalizedVehicleNumber,
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

      // Recompute the vehicle's cached compliance-health fields (documentHealthStatus,
      // hasExpiredDocuments, documentAlertCount) now that vehicleStatus/requireX flags may
      // have changed (e.g. marking a vehicle Sold should clear its stale "Expired" flags).
      try {
        await syncVehicleComplianceStatus(savedId);
      } catch (syncError) {
        console.error('Failed to sync vehicle compliance status', syncError);
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
      if (previousDriverId !== nextDriverId) {
        await addDoc(collection(db, VEHICLE_COLLECTIONS.driverAssignments), {
          vehicleId: savedId,
          vehicleNumber: String(basePayload.vehicleNumber || ''),
          previousDriverId,
          previousDriverName: String(editingRow?.assignedDriverName || ''),
          driverId: nextDriverId,
          driverName: String(basePayload.assignedDriverName || ''),
          action: nextDriverId ? (previousDriverId ? 'Reassigned' : 'Assigned') : 'Unassigned',
          source: 'Vehicle Master',
          eventDate: new Date().toISOString(),
          createdAt: serverTimestamp(),
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
      const vehicleId = String(deleteRow.id);
      const relatedSources = [
        { name: 'insurance', collectionName: VEHICLE_COLLECTIONS.insurance, field: 'vehicleId' },
        { name: 'PUC', collectionName: VEHICLE_COLLECTIONS.puc, field: 'vehicleId' },
        { name: 'fitness', collectionName: VEHICLE_COLLECTIONS.fitness, field: 'vehicleId' },
        { name: 'road tax', collectionName: VEHICLE_COLLECTIONS.roadTax, field: 'vehicleId' },
        { name: 'permit', collectionName: VEHICLE_COLLECTIONS.permit, field: 'vehicleId' },
        { name: 'maintenance', collectionName: VEHICLE_COLLECTIONS.maintenance, field: 'vehicleId' },
        { name: 'fuel', collectionName: VEHICLE_COLLECTIONS.fuel, field: 'vehicleId' },
        { name: 'trip', collectionName: VEHICLE_COLLECTIONS.trips, field: 'vehicleId' },
        { name: 'document', collectionName: VEHICLE_COLLECTIONS.documents, field: 'vehicleId' },
        { name: 'driver assignment', collectionName: VEHICLE_COLLECTIONS.driver, field: 'assignedVehicleId' },
        { name: 'assignment history', collectionName: VEHICLE_COLLECTIONS.driverAssignments, field: 'vehicleId' },
      ];
      const references = await Promise.all(
        relatedSources.map(async (source) => ({
          name: source.name,
          snapshot: await getDocs(
            firestoreQuery(collection(db, source.collectionName), where(source.field, '==', vehicleId), limit(1))
          ),
        }))
      );
      const linked = references.filter((result) => !result.snapshot.empty).map((result) => result.name);
      if (linked.length > 0) {
        toast({
          title: 'Vehicle Has Linked History',
          description: `Deletion is blocked to preserve ${linked.slice(0, 3).join(', ')} records. Mark the vehicle Sold, Scrapped, or Inactive instead.`,
          variant: 'destructive',
        });
        setDeleteRow(null);
        return;
      }
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
    <div className="space-y-3 sm:space-y-4">
      <Card className="vm-panel-strong overflow-hidden">
        <div className="h-1 w-full bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-600 animate-bb-gradient" />
        <CardHeader className="flex flex-col gap-3 px-3 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-6">
          <div>
            <CardTitle>Vehicle Master</CardTitle>
            <CardDescription>Manage complete vehicle profile and assignment details.</CardDescription>
          </div>
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:justify-end">
            <Badge variant="outline" className="col-span-2 w-fit bg-white/70 sm:col-span-1">
              {rows.length - duplicateIds.size} records
            </Badge>
            <Button variant="outline" onClick={() => void loadRows()} className="h-11 bg-white/80 hover:bg-white sm:h-10">
              Refresh
            </Button>
            {canExport && (
              <Button variant="outline" onClick={() => void exportExcel()} disabled={isExporting} className="h-11 bg-white/80 hover:bg-white sm:h-10">
                {isExporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                {isExporting ? 'Exporting…' : 'Export'}
              </Button>
            )}
            {canImport && (
              <Button variant="outline" onClick={() => setImportDialogOpen(true)} className="h-11 bg-white/80 hover:bg-white sm:h-10">
                <FileUp className="mr-2 h-4 w-4" /> Import
              </Button>
            )}
            <Button
              onClick={openAdd}
              disabled={!canAdd}
              className="h-11 bg-gradient-to-r from-emerald-500 to-teal-600 text-white hover:from-emerald-600 hover:to-teal-700 sm:h-10"
            >
              Add Vehicle
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 px-3 pb-4 sm:px-6 sm:pb-6">
          <Input
            placeholder="Search vehicle..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="h-11 w-full border-slate-200 bg-white focus-visible:ring-emerald-400/40 sm:h-10 sm:max-w-xs"
          />
          {duplicateIds.size > 0 && (
            <div className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800 sm:flex-row sm:items-center sm:justify-between">
              <span>
                {duplicateIds.size} record{duplicateIds.size === 1 ? '' : 's'} repeat a vehicle number that is already
                registered. Only the original record for each number is listed.
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowDuplicates((prev) => !prev)}
                className="h-8 shrink-0 border-amber-300 bg-white px-3 text-amber-800 hover:bg-amber-100"
              >
                {showDuplicates ? 'Hide duplicates' : 'Review duplicates'}
              </Button>
            </div>
          )}
          {/* Mobile card view */}
          <div className="space-y-2.5 sm:hidden">
            {isLoading ? (
              Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 w-full rounded-xl" />)
            ) : filteredRows.length === 0 ? (
              <div className="rounded-xl border border-white/70 bg-white/85 px-4 py-8 text-center text-sm text-muted-foreground">
                No vehicle records found.
              </div>
            ) : (
              vehiclePagination.paginatedRows.map((row) => (
                <div key={String(row.id)} onClick={() => setDetailsVehicle(row)} className="cursor-pointer rounded-xl border border-white/70 bg-white/85 p-4 shadow-sm active:scale-[0.99] transition-transform">
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <div>
                      <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
                        {row.vehicleNumber || '-'}
                        {duplicateIds.has(String(row.id)) && (
                          <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                            Duplicate
                          </span>
                        )}
                      </p>
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
                    <Button size="sm" variant="outline" onClick={(event) => { event.stopPropagation(); openEdit(row); }} disabled={!canEdit} className="flex-1 h-10 bg-white/80">Edit</Button>
                    <Button size="sm" variant="destructive" onClick={(event) => { event.stopPropagation(); setDeleteRow(row); }} disabled={!canDelete} className="flex-1 h-10">Delete</Button>
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
            <table className="min-w-[1420px] w-full caption-bottom text-sm">
              <TableHeader className="sticky top-0 z-10 bg-slate-50 shadow-sm">
                <TableRow className="[&_th]:whitespace-nowrap">
                  <TableHead>Vehicle ID</TableHead>
                  <TableHead>Vehicle Number</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Driver</TableHead>
                  <TableHead>Fuel</TableHead>
                  <TableHead>Docs Health</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created Time</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 4 }).map((_, index) => (
                    <TableRow key={index}>
                      <TableCell colSpan={11}>
                        <Skeleton className="h-8 w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  vehiclePagination.paginatedRows.map((row) => (
                    <TableRow
                      key={String(row.id)}
                      onClick={() => setDetailsVehicle(row)}
                      className={cn(
                        'h-14 cursor-pointer hover:bg-emerald-50/70',
                        duplicateIds.has(String(row.id)) && 'bg-amber-50/70 hover:bg-amber-50'
                      )}
                    >
                      <TableCell className="whitespace-nowrap font-medium">{row.vehicleId || '-'}</TableCell>
                      <TableCell className="whitespace-nowrap font-semibold text-slate-800">
                        <span className="flex items-center gap-1.5">
                          {row.vehicleNumber || '-'}
                          {duplicateIds.has(String(row.id)) && (
                            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                              Duplicate
                            </span>
                          )}
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{row.vehicleType || '-'}</TableCell>
                      <TableCell className="max-w-[180px] truncate whitespace-nowrap" title={String(row.assignedDepartmentName || '')}>{row.assignedDepartmentName || '-'}</TableCell>
                      <TableCell className="max-w-[240px] truncate whitespace-nowrap" title={String(row.assignedProjectName || '')}>{row.assignedProjectName || '-'}</TableCell>
                      <TableCell className="max-w-[180px] truncate whitespace-nowrap" title={String(row.assignedDriverName || '')}>{row.assignedDriverName || '-'}</TableCell>
                      <TableCell className="whitespace-nowrap">{row.fuelType || '-'}</TableCell>
                      <TableCell className="whitespace-nowrap">{row.documentHealthStatus || '-'}</TableCell>
                      <TableCell className="whitespace-nowrap">{row.vehicleStatus || '-'}</TableCell>
                      <TableCell className="whitespace-nowrap">{formatVehicleTimestamp(row.createdAt)}</TableCell>
                      <TableCell className="w-[160px] whitespace-nowrap text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button size="sm" variant="outline" onClick={(event) => { event.stopPropagation(); openEdit(row); }} disabled={!canEdit} className="h-8 bg-white px-3">
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={(event) => { event.stopPropagation(); setDeleteRow(row); }}
                            disabled={!canDelete}
                            className="h-8 px-3"
                          >
                            Delete
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
          <VehicleTablePagination
            currentPage={vehiclePagination.currentPage}
            totalPages={vehiclePagination.totalPages}
            totalRows={filteredRows.length}
            pageSize={vehiclePagination.pageSize}
            onPageChange={vehiclePagination.setCurrentPage}
          />
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="inset-0 left-0 top-0 flex h-[100dvh] max-h-none w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 bg-slate-50 p-0 shadow-2xl sm:left-1/2 sm:top-1/2 sm:h-[90dvh] sm:max-h-[900px] sm:w-[calc(100vw-3rem)] sm:max-w-6xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border">
          <div className="shrink-0 border-b border-emerald-100 bg-gradient-to-r from-emerald-50 via-white to-teal-50 px-4 pb-3 pt-4 pr-12 sm:px-7 sm:py-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 shadow-lg shadow-emerald-500/20 sm:h-11 sm:w-11">
                <CarFront className="h-5 w-5 text-white" />
              </div>
              <div className="min-w-0 flex-1">
                <DialogTitle className="text-lg text-slate-900 sm:text-xl">
                  {editingRow ? 'Edit Vehicle Profile' : 'Register New Vehicle'}
                </DialogTitle>
                <DialogDescription className="mt-0.5 text-xs sm:text-sm">
                  Fields marked <span className="font-semibold text-rose-500">*</span> are required
                </DialogDescription>
              </div>
              <div className="hidden items-center gap-1.5 sm:flex"><span className="rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-emerald-700">Identity</span><span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600">Assignment</span><span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600">Compliance</span></div>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-7 sm:py-5">
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 lg:items-start lg:gap-4">
              <FormSection className="lg:col-span-2" icon={<CarFront className="h-4 w-4" />} title="Vehicle identity" description="Registration and manufacturing details" tone="emerald">
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
                <Field label={`${field('vehicleNumber').label} *`}>
                  <Input
                    value={form.vehicleNumber}
                    onChange={(e) => setField('vehicleNumber', normalizeVehicleNumber(e.target.value))}
                    autoCapitalize="characters"
                    placeholder="e.g. MH12AB1234"
                    aria-invalid={!!duplicateVehicleNumber}
                    className={cn(
                      'h-11 uppercase tracking-wide sm:h-9',
                      duplicateVehicleNumber && 'border-rose-300 focus-visible:ring-rose-400/40'
                    )}
                  />
                  {duplicateVehicleNumber && (
                    <p className="text-[11px] font-medium text-rose-600">
                      {duplicateVehicleNumber} is already registered. Open that vehicle to update it instead.
                    </p>
                  )}
                </Field>
                {field('vehicleType').visible && <SelectField label={labelWithMark(field('vehicleType'))} value={form.vehicleType} onValueChange={(v) => setField('vehicleType', v)} options={vehicleTypeOptions} />}
                {field('vehicleCategory').visible && <SelectField label={labelWithMark(field('vehicleCategory'))} value={form.vehicleCategory} onValueChange={(v) => setField('vehicleCategory', v)} options={vehicleCategoryOptions} />}
                {field('brand').visible && (
                <Field label={labelWithMark(field('brand'))}>
                  <Input value={form.brand} onChange={(e) => setField('brand', e.target.value)} placeholder="Manufacturer" className="h-9" />
                </Field>
                )}
                {field('model').visible && (
                <Field label={labelWithMark(field('model'))}>
                  <Input value={form.model} onChange={(e) => setField('model', e.target.value)} placeholder="Model name" className="h-9" />
                </Field>
                )}
                {field('yearOfManufacture').visible && (
                <Field label={labelWithMark(field('yearOfManufacture'))}>
                  <Input value={form.yearOfManufacture} onChange={(e) => setField('yearOfManufacture', e.target.value)} type="number" className="h-9" />
                </Field>
                )}
                {field('fuelType').visible && <SelectField label={labelWithMark(field('fuelType'))} value={form.fuelType} onValueChange={(v) => setField('fuelType', v)} options={fuelTypeOptions} />}
                {field('chassisNumber').visible && (
                <Field label={labelWithMark(field('chassisNumber'))}>
                  <Input value={form.chassisNumber} onChange={(e) => setField('chassisNumber', e.target.value)} className="h-9" />
                </Field>
                )}
                {field('engineNumber').visible && (
                <Field label={labelWithMark(field('engineNumber'))}>
                  <Input value={form.engineNumber} onChange={(e) => setField('engineNumber', e.target.value)} className="h-9" />
                </Field>
                )}
              </div>
              </FormSection>

              <FormSection icon={<Gauge className="h-4 w-4" />} title="Ownership & usage" description="Purchase, odometer and operating state" tone="blue">
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                {field('ownershipType').visible && <SelectField label={labelWithMark(field('ownershipType'))} value={form.ownershipType} onValueChange={(v) => setField('ownershipType', v)} options={ownershipTypeOptions} />}
                {field('purchaseDate').visible && (
                <Field label={labelWithMark(field('purchaseDate'))}>
                  <Input value={form.purchaseDate} onChange={(e) => setField('purchaseDate', e.target.value)} type="date" className="h-9" />
                </Field>
                )}
                {field('purchaseValue').visible && (
                <Field label={labelWithMark(field('purchaseValue'))}>
                  <Input value={form.purchaseValue} onChange={(e) => setField('purchaseValue', e.target.value)} type="number" className="h-9" />
                </Field>
                )}
                {field('currentStatus').visible && <SelectField label={labelWithMark(field('currentStatus'))} value={form.currentStatus} onValueChange={(v) => setField('currentStatus', v)} options={currentStatusOptions} />}
                {field('currentOdometerKm').visible && (
                <Field label={labelWithMark(field('currentOdometerKm'))}>
                  <Input value={form.currentOdometerKm} onChange={(e) => setField('currentOdometerKm', e.target.value)} type="number" min="0" className="h-9" />
                </Field>
                )}
                {field('vehicleStatus').visible && <SelectField label={labelWithMark(field('vehicleStatus'))} value={form.vehicleStatus} onValueChange={(v) => setField('vehicleStatus', v)} options={vehicleStatusOptions} />}
              </div>
              </FormSection>

              <FormSection icon={<MapPin className="h-4 w-4" />} title="Assignment" description="Connect this vehicle to its working team" tone="violet">
              <div className="grid grid-cols-1 gap-2">
                {field('assignedDepartmentId').visible && <SelectField label={labelWithMark(field('assignedDepartmentId'))} value={form.assignedDepartmentId} onValueChange={(v) => setField('assignedDepartmentId', v)} options={departmentOptions} />}
                {field('assignedProjectId').visible && <SelectField label={labelWithMark(field('assignedProjectId'))} value={form.assignedProjectId} onValueChange={(v) => setField('assignedProjectId', v)} options={projectOptions} />}
                {field('assignedDriverId').visible && <SelectField label={labelWithMark(field('assignedDriverId'))} value={form.assignedDriverId} onValueChange={(v) => setField('assignedDriverId', v)} options={driverOptions} />}
              </div>
              </FormSection>

              <FormSection className="lg:col-span-2" icon={<ShieldCheck className="h-4 w-4" />} title="Compliance & notes" description="Control documents and add useful notes" tone="amber">
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
                {field('complianceRuleMode').visible && (
                <SelectField
                  label={labelWithMark(field('complianceRuleMode'))}
                  value={form.complianceRuleMode}
                  onValueChange={(v) => setField('complianceRuleMode', v)}
                  options={[
                    { value: 'Auto', label: 'Auto (By Vehicle Type/Fuel)' },
                    { value: 'Manual', label: 'Manual (Set Required Docs)' },
                  ]}
                />
                )}
                {requiresManualRules(form) && (
                  <>
                    {field('requireInsurance').visible && <SelectField label={labelWithMark(field('requireInsurance'))} value={form.requireInsurance} onValueChange={(v) => setField('requireInsurance', v)} options={yesNoOptions} />}
                    {field('requirePuc').visible && <SelectField label={labelWithMark(field('requirePuc'))} value={form.requirePuc} onValueChange={(v) => setField('requirePuc', v)} options={yesNoOptions} />}
                    {field('requireFitness').visible && <SelectField label={labelWithMark(field('requireFitness'))} value={form.requireFitness} onValueChange={(v) => setField('requireFitness', v)} options={yesNoOptions} />}
                    {field('requireRoadTax').visible && <SelectField label={labelWithMark(field('requireRoadTax'))} value={form.requireRoadTax} onValueChange={(v) => setField('requireRoadTax', v)} options={yesNoOptions} />}
                    {field('requirePermit').visible && <SelectField label={labelWithMark(field('requirePermit'))} value={form.requirePermit} onValueChange={(v) => setField('requirePermit', v)} options={yesNoOptions} />}
                  </>
                )}
                {field('remarks').visible && (
                <Field label={field('remarks').label} className="md:col-span-2 xl:col-span-3">
                  <Textarea value={form.remarks} onChange={(e) => setField('remarks', e.target.value)} placeholder="Add any useful vehicle notes…" className="min-h-[84px] resize-none" />
                </Field>
                )}
              </div>
              </FormSection>
            </div>
          </div>
          <DialogFooter className="grid shrink-0 grid-cols-2 gap-2 border-t border-slate-200 bg-white px-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 shadow-[0_-10px_30px_-25px_rgba(15,23,42,0.5)] sm:flex sm:items-center sm:px-7 sm:py-4">
            <p className="col-span-2 mr-auto hidden text-xs text-muted-foreground sm:block">Review identity, assignment, and compliance settings before saving.</p>
            <Button variant="outline" onClick={() => setDialogOpen(false)} className="h-11 sm:h-10">
              Cancel
            </Button>
            <Button onClick={() => void submit()} disabled={isSaving || !!duplicateVehicleNumber} className="h-11 bg-gradient-to-r from-emerald-500 to-teal-600 text-white hover:from-emerald-600 hover:to-teal-700 sm:h-10">
              {isSaving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              {editingRow ? 'Update Vehicle' : 'Register Vehicle'}
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
      <VehicleDetailsDialog
        vehicle={detailsVehicle}
        open={!!detailsVehicle}
        onOpenChange={(open) => { if (!open) setDetailsVehicle(null); }}
        canRenewInsurance={canRenewInsurance}
      />
    </div>
  );
}

function FormSection({
  icon,
  title,
  description,
  tone,
  className,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  tone: 'emerald' | 'blue' | 'violet' | 'amber';
  className?: string;
  children: ReactNode;
}) {
  const tones = {
    emerald: 'bg-emerald-50 text-emerald-700',
    blue: 'bg-blue-50 text-blue-700',
    violet: 'bg-violet-50 text-violet-700',
    amber: 'bg-amber-50 text-amber-700',
  };

  return (
    <section className={cn('overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]', className)}>
      <div className="flex items-center gap-2.5 border-b border-slate-100 px-3 py-2.5 sm:px-4">
        <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', tones[tone])}>
          {icon}
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold leading-tight text-slate-800">{title}</h3>
          <p className="mt-0.5 text-[11px] leading-tight text-slate-500">{description}</p>
        </div>
      </div>
      <div className="p-2.5 sm:p-3">{children}</div>
    </section>
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
        'space-y-1.5 [&_input]:h-11 sm:[&_input]:h-9',
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
        <SelectTrigger className="h-11 border-slate-200 bg-white text-[13px] sm:h-9">
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
