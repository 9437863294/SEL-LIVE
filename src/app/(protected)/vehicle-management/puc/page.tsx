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
import { ExternalLink, Loader2, Upload } from 'lucide-react';

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
  const { options: vehicleOptions, map: vehicleMap } = useVehicleOptions();
  const { prefill, renewingFromId } = useRenewalPrefill();

  const canView = can('View', 'Vehicle Management.PUC Management');
  const canAdd = can('Add', 'Vehicle Management.PUC Management');
  const canEdit = can('Edit', 'Vehicle Management.PUC Management');
  const canDelete = can('Delete', 'Vehicle Management.PUC Management');

  const [rows, setRows] = useState<PucRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<PucRow | null>(null);
  const [deleteRow, setDeleteRow] = useState<PucRow | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [form, setForm] = useState<PucForm>(buildInitialState());
  const [file, setFile] = useState<File | null>(null);
  const prefillApplied = useRef(false);

  const loadRows = async () => {
    setIsLoading(true);
    try {
      const snap = await getDocs(collection(db, VEHICLE_COLLECTIONS.puc));
      const data = snap.docs
        .map((entry): PucRow => ({ id: entry.id, ...(entry.data() as Record<string, any>) }))
        .sort((a, b) => String(a.expiryDate || '').localeCompare(String(b.expiryDate || '')));
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
  }, [query, rows]);

  const openAdd = () => {
    if (!canAdd) return;
    setEditingRow(null);
    setForm(buildInitialState());
    setFile(null);
    setDialogOpen(true);
  };

  const openEdit = (row: PucRow) => {
    if (!canEdit) return;
    setEditingRow(row);
    setForm(mapRowToState(row));
    setFile(null);
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

      if (editingRow) {
        await updateDoc(doc(db, VEHICLE_COLLECTIONS.puc, String(editingRow.id)), {
          ...payload,
          updatedAt: serverTimestamp(),
        });
      } else {
        await addDoc(collection(db, VEHICLE_COLLECTIONS.puc), {
          ...payload,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      if (form.vehicleId) await syncVehicleComplianceStatus(String(form.vehicleId));

      if (!editingRow && renewingFromId) {
        try {
          await updateDoc(doc(db, VEHICLE_COLLECTIONS.puc, renewingFromId), {
            renewalStatus: 'Renewed',
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
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>PUC Management</CardTitle>
            <CardDescription>Track pollution certificate validity and renewal compliance.</CardDescription>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
            <Badge variant="outline" className="bg-white/70">
              {rows.length} records
            </Badge>
            <Button variant="outline" onClick={() => void loadRows()} className="bg-white/80 hover:bg-white">
              Refresh
            </Button>
            <Button
              onClick={openAdd}
              disabled={!canAdd}
              className="bg-gradient-to-r from-emerald-500 to-teal-600 text-white hover:from-emerald-600 hover:to-teal-700"
            >
              Add PUC
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            placeholder="Search PUC..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="max-w-xs border-slate-200 bg-white focus-visible:ring-emerald-400/40"
          />
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
                      <TableCell>{row.pucCertificateNumber || '-'}</TableCell>
                      <TableCell>{row.testingCenterName || '-'}</TableCell>
                      <TableCell>{row.expiryDate || '-'}</TableCell>
                      <TableCell>{row.alertStage || '-'}</TableCell>
                      <TableCell>{row.pucStatus || '-'}</TableCell>
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
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="flex max-h-[90vh] w-[calc(100vw-2rem)] max-w-4xl flex-col gap-0 overflow-hidden p-0 vm-panel-strong">
          <div className="shrink-0 border-b border-slate-100 bg-gradient-to-r from-emerald-500/5 to-teal-500/5 px-6 pb-4 pt-5 pr-12">
            <DialogTitle>{editingRow ? 'Edit PUC' : 'Add PUC'}</DialogTitle>
            <DialogDescription>Enter certificate details and upload document.</DialogDescription>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
              <div className="mb-3 rounded-md border border-slate-200 bg-slate-100/90 px-3 py-1.5 text-xs font-semibold text-slate-700">
                General Info
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


