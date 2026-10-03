'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { collection, doc, getDoc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { Loader2, Save } from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import { RP_COLLECTIONS, maskAccount } from '@/lib/recurring-payments';
import type { RecurringVendor } from './vendor-management';
import { ControlledField } from './controlled-field';
import { useFieldControl, validateFieldControlRequirements } from './use-field-control';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/shared/page-header';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { dispatchNotification } from '@/lib/notifications';
import { ACTIVITY_MODULES } from '@/lib/activity-modules';

type BankSnapshot = Pick<RecurringVendor, 'bankName' | 'maskedAccountNumber' | 'ifsc'>;

const GSTIN_PATTERN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PAN_PATTERN = /^[A-Z]{5}\d{4}[A-Z]$/;
const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;

// Normalised the same way on both sides, so an untouched legacy value (a full account number, a
// lower-case IFSC) doesn't read as a banking change and fire a false alert when it is re-saved.
function bankSnapshot(vendor: Partial<RecurringVendor>): BankSnapshot {
  return {
    bankName: vendor.bankName?.trim() || '',
    maskedAccountNumber: maskAccount(vendor.maskedAccountNumber?.replace(/\s/g, '')),
    ifsc: vendor.ifsc?.trim().toUpperCase() || '',
  };
}

export default function VendorFormPage({ vendorId }: { vendorId?: string }) {
  const router = useRouter();
  const { user, users } = useAuth();
  const { can } = useAuthorization();
  const { toast } = useToast();
  const { field } = useFieldControl('vendor');
  const organizationId = user?.organizationId || 'default';
  const [vendor, setVendor] = useState<Partial<RecurringVendor>>({ status: 'Active' });
  const [originalVendor, setOriginalVendor] = useState<Partial<RecurringVendor>>({});
  const [loading, setLoading] = useState(!!vendorId);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!vendorId) return;
    getDoc(doc(db, RP_COLLECTIONS.vendors, vendorId))
      .then(snapshot => {
        if (snapshot.exists()) {
          const loaded = { id: snapshot.id, ...snapshot.data() } as RecurringVendor;
          setVendor(loaded);
          setOriginalVendor(loaded);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [vendorId]);

  const set = (key: keyof RecurringVendor, value: string) => setVendor(current => ({ ...current, [key]: value }));
  const canSave = vendorId ? can('Edit', 'Recurring Payments.Vendors') : can('Add', 'Recurring Payments.Vendors');

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!user) return;
    if (!canSave) return toast({ title: `You do not have permission to ${vendorId ? 'edit' : 'add'} vendors`, variant: 'destructive' });
    // Trimmed before the required check — a whitespace-only name used to pass it. Tax and bank
    // codes are upper-cased, and only the last four digits of the account number are ever stored.
    const normalized: Partial<RecurringVendor> = {
      ...vendor,
      name: vendor.name?.trim() || '',
      gstin: vendor.gstin?.trim().toUpperCase() || '',
      pan: vendor.pan?.trim().toUpperCase() || '',
      ...bankSnapshot(vendor),
    };
    const missingLabel = validateFieldControlRequirements('vendor', normalized, field);
    if (missingLabel) return toast({ title: `${missingLabel} is required`, variant: 'destructive' });
    if (normalized.gstin && !GSTIN_PATTERN.test(normalized.gstin)) return toast({ title: 'GSTIN is not valid', description: '15 characters, e.g. 27ABCDE1234F1Z5.', variant: 'destructive' });
    if (normalized.pan && !PAN_PATTERN.test(normalized.pan)) return toast({ title: 'PAN is not valid', description: '10 characters, e.g. ABCDE1234F.', variant: 'destructive' });
    if (normalized.ifsc && !IFSC_PATTERN.test(normalized.ifsc)) return toast({ title: 'IFSC is not valid', description: '11 characters, e.g. HDFC0001234.', variant: 'destructive' });
    setSaving(true);
    try {
      const reference = vendorId ? doc(db, RP_COLLECTIONS.vendors, vendorId) : doc(collection(db, RP_COLLECTIONS.vendors));
      const previousBank = bankSnapshot(originalVendor);
      const nextBank = bankSnapshot(normalized);
      const bankChanged = vendorId && JSON.stringify(previousBank) !== JSON.stringify(nextBank);
      // Omit `id` rather than setting it to `undefined` — Firestore's set()/update() rejects
      // any field whose value is `undefined`.
      const { id: _vendorId, ...vendorFields } = normalized;
      const payload = {
        ...vendorFields,
        organizationId,
        name: normalized.name,
        updatedAt: serverTimestamp(),
        updatedBy: user.id,
      };
      const batch = writeBatch(db);
      if (vendorId) batch.update(reference, payload);
      else batch.set(reference, { ...payload, createdAt: serverTimestamp(), createdBy: user.id });

      batch.set(doc(collection(reference, RP_COLLECTIONS.auditLogs)), {
        organizationId,
        vendorId: reference.id,
        action: vendorId ? 'Vendor updated' : 'Vendor created',
        summary: bankChanged ? `${normalized.name} vendor record and banking information updated` : `${normalized.name} vendor record saved`,
        page: vendorId ? `/recurring-payments/vendors/${reference.id}/edit` : '/recurring-payments/vendors/new',
        recordId: reference.id,
        previousValue: vendorId ? previousBank : null,
        newValue: nextBank,
        bankChanged,
        userId: user.id,
        userName: user.name,
        createdAt: serverTimestamp(),
      });

      await batch.commit();

      if (bankChanged) {
        // Users with no organizationId belong to 'default', exactly as this page scopes them.
        const recipients = users.filter(item => /admin|accounts/i.test(item.role || '') && (item.organizationId || 'default') === organizationId);
        // Dispatched after the commit rather than inside the batch. Batching it made
        // the alert atomic with the save, but the dispatcher also has to send the
        // mobile/web push — and a push about a banking change is not something to
        // send from inside a transaction that may still roll back. Notifying once the
        // change is durable is the safer ordering for a payment-detail change.
        // Its own try: the vendor is already saved, so a failed alert must not report a failed save.
        try {
          await dispatchNotification(
            { userIds: recipients.map(item => item.id) },
            {
              type: 'vendor_bank_change',
              title: `Vendor banking information updated: ${normalized.name}`,
              body: 'Review the previous and new masked banking values in the vendor audit log.',
              module: ACTIVITY_MODULES.RECURRING_PAYMENTS,
              // Fraud-relevant: someone changing where money goes should not be a
              // notification anyone has to go looking for.
              severity: 'CRITICAL',
              itemId: reference.id,
              itemRef: normalized.name,
              link: `/recurring-payments/vendors/${reference.id}`,
            },
          );
        } catch {
          toast({ title: 'Bank-change alert not sent', description: 'The vendor was saved, but Admin/Accounts could not be notified. Let them know directly.', variant: 'destructive' });
        }
      }

      toast({ title: vendorId ? 'Vendor updated' : 'Vendor created' });
      router.push(`/recurring-payments/vendors/${reference.id}`);
    } catch {
      toast({ title: 'Vendor could not be saved', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="flex min-h-[45vh] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin" /></div>;

  return <div className="mx-auto max-w-4xl space-y-4">
    <PageHeader
      backHref={vendorId ? `/recurring-payments/vendors/${vendorId}` : '/recurring-payments/vendors'}
      backLabel={vendorId ? 'Back to vendor' : 'Back to vendors'}
      title={vendorId ? 'Edit Vendor' : 'Add Vendor'}
      description="Tax, contact, terms and masked banking details"
    />
    <Card><CardHeader><CardTitle>Vendor information</CardTitle><CardDescription>Full bank account numbers should not be stored here. Banking changes are separately audited and notified.</CardDescription></CardHeader><CardContent>
      <form onSubmit={save} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <ControlledField setting={field('name')}><Input value={vendor.name || ''} onChange={event => set('name', event.target.value)} required={field('name').required} /></ControlledField>
        <ControlledField setting={field('code')}><Input value={vendor.code || ''} onChange={event => set('code', event.target.value)} required={field('code').required} /></ControlledField>
        <ControlledField setting={field('category')}><Input value={vendor.category || ''} onChange={event => set('category', event.target.value)} required={field('category').required} /></ControlledField>
        <ControlledField setting={field('gstin')}><Input value={vendor.gstin || ''} onChange={event => set('gstin', event.target.value)} required={field('gstin').required} /></ControlledField>
        <ControlledField setting={field('pan')}><Input value={vendor.pan || ''} onChange={event => set('pan', event.target.value)} required={field('pan').required} /></ControlledField>
        <ControlledField setting={field('contactPerson')}><Input value={vendor.contactPerson || ''} onChange={event => set('contactPerson', event.target.value)} required={field('contactPerson').required} /></ControlledField>
        <ControlledField setting={field('mobile')}><Input value={vendor.mobile || ''} onChange={event => set('mobile', event.target.value)} required={field('mobile').required} /></ControlledField>
        <ControlledField setting={field('email')}><Input type="email" value={vendor.email || ''} onChange={event => set('email', event.target.value)} required={field('email').required} /></ControlledField>
        <ControlledField setting={field('paymentTerms')}><Input value={vendor.paymentTerms || ''} onChange={event => set('paymentTerms', event.target.value)} required={field('paymentTerms').required} /></ControlledField>
        <ControlledField setting={field('bankName')}><Input value={vendor.bankName || ''} onChange={event => set('bankName', event.target.value)} required={field('bankName').required} /></ControlledField>
        <ControlledField setting={field('maskedAccountNumber')}><Input placeholder="••••1234" value={vendor.maskedAccountNumber || ''} onChange={event => set('maskedAccountNumber', event.target.value)} required={field('maskedAccountNumber').required} /></ControlledField>
        <ControlledField setting={field('ifsc')}><Input value={vendor.ifsc || ''} onChange={event => set('ifsc', event.target.value)} required={field('ifsc').required} /></ControlledField>
        <ControlledField setting={field('status')}><Select value={vendor.status || 'Active'} onValueChange={value => set('status', value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Active">Active</SelectItem><SelectItem value="Inactive">Inactive</SelectItem></SelectContent></Select></ControlledField>
        <div className="sm:col-span-2 lg:col-span-3"><ControlledField setting={field('address')}><Textarea value={vendor.address || ''} onChange={event => set('address', event.target.value)} /></ControlledField></div>
        <div className="flex flex-wrap items-center justify-end gap-2 sm:col-span-2 lg:col-span-3">{!canSave && <p className="mr-auto text-xs text-muted-foreground">You can view this form, but you do not have permission to save it.</p>}<Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button><Button disabled={saving || !canSave}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save vendor</Button></div>
      </form>
    </CardContent></Card>
  </div>;
}
