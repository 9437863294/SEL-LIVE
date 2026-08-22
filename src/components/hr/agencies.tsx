'use client';

import { useMemo, useState } from 'react';
import { Building, Loader2, Pencil, Plus, RefreshCw } from 'lucide-react';
import { addDoc, collection, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { withCreateAudit, withUpdateAudit } from '@/lib/audit-fields';
import { HR_COLLECTIONS, roundPercent, type RecruitmentAgency } from '@/lib/hr-requirement';
import { refreshAgencyPerformance } from '@/lib/hr-requirement-service';
import {
  HrDataList,
  HrEmptyState,
  HrLoader,
  HrPageHeader,
  HrStatusBadge,
  Money,
  hrDialog,
  type HrListColumn,
} from './hr-ui';
import { useHrCollection, useHrConfig, useHrPermissions } from './use-hr-config';

/**
 * Recruitment agency management, spec section 47.
 *
 * The performance columns are what make this more than an address book: submitted, shortlisted,
 * interviewed, offered and joined per agency, plus the conversion between them. They are recomputed
 * from the applications each agency submitted rather than incremented, so an agency's "shortlisted"
 * figure cannot drift upwards while the pipeline it summarises moves the other way.
 */

export default function Agencies() {
  const { toast } = useToast();
  const { actor, loading: configLoading } = useHrConfig();
  const permissions = useHrPermissions();
  const { rows: agencies, loading } = useHrCollection<RecruitmentAgency>(HR_COLLECTIONS.agencies);

  const [editing, setEditing] = useState<RecruitmentAgency | null>(null);
  const [creating, setCreating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const sorted = useMemo(
    () =>
      [...agencies].sort(
        (a, b) => (b.joinedCount || 0) - (a.joinedCount || 0) || (a.name || '').localeCompare(b.name || ''),
      ),
    [agencies],
  );

  const refreshAll = async () => {
    setRefreshing(true);
    try {
      await Promise.all(agencies.map(agency => refreshAgencyPerformance(agency.id)));
      toast({ title: 'Agency performance refreshed' });
    } catch {
      toast({ title: 'Could not refresh performance', variant: 'destructive' });
    } finally {
      setRefreshing(false);
    }
  };

  const columns: Array<HrListColumn<RecruitmentAgency>> = [
    {
      header: 'Agency',
      mobile: 'title',
      cell: row => (
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-800">{row.name}</p>
          <p className="truncate text-xs text-muted-foreground">{row.contactPerson || '—'}</p>
        </div>
      ),
    },
    { header: 'Contact', className: 'hidden lg:table-cell', cell: row => row.mobile || row.email || '—' },
    {
      header: 'Fee',
      className: 'hidden xl:table-cell',
      cell: row =>
        row.feeType === 'Flat Fee'
          ? <Money value={row.flatFee} exact />
          : row.feePercent
            ? `${row.feePercent}% of CTC`
            : '—',
    },
    {
      header: 'Guarantee',
      align: 'right',
      className: 'hidden xl:table-cell',
      cell: row => (row.replacementGuaranteeDays ? `${row.replacementGuaranteeDays}d` : '—'),
    },
    { header: 'Submitted', align: 'right', cell: row => <span className="tabular-nums">{row.submittedCount || 0}</span> },
    { header: 'Shortlisted', align: 'right', className: 'hidden lg:table-cell', cell: row => <span className="tabular-nums">{row.shortlistedCount || 0}</span> },
    { header: 'Interviewed', align: 'right', className: 'hidden xl:table-cell', cell: row => <span className="tabular-nums">{row.interviewedCount || 0}</span> },
    { header: 'Offered', align: 'right', className: 'hidden lg:table-cell', cell: row => <span className="tabular-nums">{row.offeredCount || 0}</span> },
    { header: 'Joined', align: 'right', cell: row => <span className="font-medium tabular-nums">{row.joinedCount || 0}</span> },
    {
      header: 'Yield',
      align: 'right',
      cell: row => {
        const submitted = row.submittedCount || 0;
        if (submitted === 0) return <span className="text-xs text-muted-foreground">—</span>;
        const yieldPercent = roundPercent(((row.joinedCount || 0) / submitted) * 100);
        return <span className="tabular-nums">{yieldPercent}%</span>;
      },
    },
    { header: 'Status', mobile: 'aside', cell: row => <HrStatusBadge status={row.status?.toUpperCase() || 'ACTIVE'} /> },
    {
      header: 'Actions',
      mobile: 'footer',
      cell: row =>
        permissions.can('Edit', 'Agencies') ? (
          <Button size="sm" variant="outline" className="gap-1" onClick={() => setEditing(row)}>
            <Pencil className="h-3.5 w-3.5" /> Edit
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
  ];

  if (loading || configLoading) return <HrLoader label="Loading agencies…" />;

  return (
    <div>
      <HrPageHeader
        title="Recruitment Agencies"
        description={`${agencies.length} ${agencies.length === 1 ? 'agency' : 'agencies'}`}
        actions={
          <>
            {permissions.can('View Performance', 'Agencies') && agencies.length > 0 && (
              <Button variant="outline" className="gap-2" onClick={refreshAll} disabled={refreshing}>
                {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Refresh performance
              </Button>
            )}
            {permissions.can('Add', 'Agencies') && (
              <Button className="gap-2" onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4" /> Add agency
              </Button>
            )}
          </>
        }
      />

      <HrDataList
        rows={sorted}
        columns={columns}
        empty={
          <HrEmptyState
            icon={Building}
            title="No agencies yet"
            description="Add the consultants and agencies you work with, with their fee structure and replacement guarantee."
            action={
              permissions.can('Add', 'Agencies') ? (
                <Button size="sm" className="gap-2" onClick={() => setCreating(true)}>
                  <Plus className="h-4 w-4" /> Add agency
                </Button>
              ) : undefined
            }
          />
        }
      />

      <AgencyDialog
        open={creating || Boolean(editing)}
        agency={editing}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
      />
    </div>
  );
}

function AgencyDialog({
  open,
  agency,
  onClose,
}: {
  open: boolean;
  agency: RecruitmentAgency | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const { actor } = useHrConfig();
  const [form, setForm] = useState({
    name: agency?.name || '',
    contactPerson: agency?.contactPerson || '',
    mobile: agency?.mobile || '',
    email: agency?.email || '',
    address: agency?.address || '',
    gstin: agency?.gstin || '',
    agreementRef: agency?.agreementRef || '',
    validFrom: agency?.validFrom || '',
    validUntil: agency?.validUntil || '',
    feeType: (agency?.feeType || 'Percentage of CTC') as NonNullable<RecruitmentAgency['feeType']>,
    feePercent: agency?.feePercent ? String(agency.feePercent) : '',
    flatFee: agency?.flatFee ? String(agency.flatFee) : '',
    replacementGuaranteeDays: agency?.replacementGuaranteeDays ? String(agency.replacementGuaranteeDays) : '',
    paymentTermsDays: agency?.paymentTermsDays ? String(agency.paymentTermsDays) : '',
    permittedRoles: (agency?.permittedRoles || []).join(', '),
    status: (agency?.status || 'Active') as RecruitmentAgency['status'],
    notes: agency?.notes || '',
  });
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm(prev => ({ ...prev, [key]: value }));

  if (!open) return null;

  const submit = async () => {
    if (!actor) return;
    if (!form.name.trim()) {
      toast({ title: 'Enter the agency name', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        organizationId: actor.organizationId,
        name: form.name.trim(),
        contactPerson: form.contactPerson,
        mobile: form.mobile,
        email: form.email,
        address: form.address,
        gstin: form.gstin,
        agreementRef: form.agreementRef,
        validFrom: form.validFrom,
        validUntil: form.validUntil,
        feeType: form.feeType,
        feePercent: Number(form.feePercent) || 0,
        flatFee: Number(form.flatFee) || 0,
        replacementGuaranteeDays: Number(form.replacementGuaranteeDays) || 0,
        paymentTermsDays: Number(form.paymentTermsDays) || 0,
        permittedRoles: form.permittedRoles
          .split(',')
          .map(entry => entry.trim())
          .filter(Boolean),
        status: form.status,
        notes: form.notes,
      };

      if (agency) {
        await updateDoc(doc(db, HR_COLLECTIONS.agencies, agency.id), { ...payload, ...withUpdateAudit(actor) });
      } else {
        await addDoc(collection(db, HR_COLLECTIONS.agencies), {
          ...payload,
          submittedCount: 0,
          shortlistedCount: 0,
          interviewedCount: 0,
          offeredCount: 0,
          joinedCount: 0,
          ...withCreateAudit(actor),
        });
      }

      toast({ title: agency ? 'Agency updated' : 'Agency added' });
      onClose();
    } catch {
      toast({ title: 'Could not save the agency', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className={hrDialog.contentWide}>
        <DialogHeader className={hrDialog.header}>
          <DialogTitle>{agency ? 'Edit agency' : 'Add agency'}</DialogTitle>
          <DialogDescription>Spec section 47 — agreement, fee structure and replacement guarantee.</DialogDescription>
        </DialogHeader>

        <div className={hrDialog.bodyGrid}>
          <div>
            <Label className="text-xs">Agency name *</Label>
            <Input value={form.name} onChange={event => set('name', event.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Contact person</Label>
            <Input value={form.contactPerson} onChange={event => set('contactPerson', event.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Mobile</Label>
            <Input value={form.mobile} onChange={event => set('mobile', event.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Email</Label>
            <Input type="email" value={form.email} onChange={event => set('email', event.target.value)} />
          </div>
          <div>
            <Label className="text-xs">GSTIN</Label>
            <Input value={form.gstin} onChange={event => set('gstin', event.target.value.toUpperCase())} />
          </div>
          <div>
            <Label className="text-xs">Agreement reference</Label>
            <Input value={form.agreementRef} onChange={event => set('agreementRef', event.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Valid from</Label>
            <Input type="date" value={form.validFrom} onChange={event => set('validFrom', event.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Valid until</Label>
            <Input type="date" value={form.validUntil} onChange={event => set('validUntil', event.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Fee type</Label>
            <Select value={form.feeType} onValueChange={value => set('feeType', value as typeof form.feeType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Percentage of CTC">Percentage of CTC</SelectItem>
                <SelectItem value="Flat Fee">Flat fee</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {form.feeType === 'Percentage of CTC' ? (
            <div>
              <Label className="text-xs">Fee (% of annual CTC)</Label>
              <Input type="number" inputMode="decimal" value={form.feePercent} onChange={event => set('feePercent', event.target.value)} />
            </div>
          ) : (
            <div>
              <Label className="text-xs">Flat fee</Label>
              <Input type="number" inputMode="decimal" value={form.flatFee} onChange={event => set('flatFee', event.target.value)} />
            </div>
          )}
          <div>
            <Label className="text-xs">Replacement guarantee (days)</Label>
            <Input
              type="number"
              inputMode="decimal"
              value={form.replacementGuaranteeDays}
              onChange={event => set('replacementGuaranteeDays', event.target.value)}
            />
          </div>
          <div>
            <Label className="text-xs">Payment terms (days)</Label>
            <Input type="number" inputMode="decimal" value={form.paymentTermsDays} onChange={event => set('paymentTermsDays', event.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Status</Label>
            <Select value={form.status} onValueChange={value => set('status', value as RecruitmentAgency['status'])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Active">Active</SelectItem>
                <SelectItem value="Inactive">Inactive</SelectItem>
                <SelectItem value="Blacklisted">Blacklisted</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs">Roles permitted (comma separated)</Label>
            <Input
              value={form.permittedRoles}
              onChange={event => set('permittedRoles', event.target.value)}
              placeholder="Site Engineer, Project Manager"
            />
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs">Address</Label>
            <Textarea rows={2} value={form.address} onChange={event => set('address', event.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs">Notes</Label>
            <Textarea rows={2} value={form.notes} onChange={event => set('notes', event.target.value)} />
          </div>
        </div>

        <DialogFooter className={hrDialog.footer}>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving || !form.name.trim()} className="gap-2">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
