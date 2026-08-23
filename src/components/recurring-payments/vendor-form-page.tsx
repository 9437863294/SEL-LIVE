'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { collection, doc, getDoc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { ArrowLeft, Loader2, Save } from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import { RP_COLLECTIONS } from '@/lib/recurring-payments';
import type { RecurringVendor } from './vendor-management';
import { ControlledField } from './controlled-field';
import { useFieldControl, validateFieldControlRequirements } from './use-field-control';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { dispatchNotification } from '@/lib/notifications';
import { ACTIVITY_MODULES } from '@/lib/activity-modules';

type BankSnapshot = Pick<RecurringVendor, 'bankName' | 'maskedAccountNumber' | 'ifsc'>;

function bankSnapshot(vendor: Partial<RecurringVendor>): BankSnapshot {
  return {
    bankName: vendor.bankName || '',
    maskedAccountNumber: vendor.maskedAccountNumber || '',
    ifsc: vendor.ifsc || '',
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

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const authorized = vendorId ? can('Edit', 'Recurring Payments.Vendors') : can('Add', 'Recurring Payments.Vendors');
    if (!user || !authorized) return;
    const missingLabel = validateFieldControlRequirements('vendor', vendor, field);
    if (missingLabel) return toast({ title: `${missingLabel} is required`, variant: 'destructive' });
    setSaving(true);
    try {
      const reference = vendorId ? doc(db, RP_COLLECTIONS.vendors, vendorId) : doc(collection(db, RP_COLLECTIONS.vendors));
      const previousBank = bankSnapshot(originalVendor);
      const nextBank = bankSnapshot(vendor);
      const bankChanged = vendorId && JSON.stringify(previousBank) !== JSON.stringify(nextBank);
      // Omit `id` rather than setting it to `undefined` — Firestore's set()/update() rejects
      // any field whose value is `undefined`.
      const { id: _vendorId, ...vendorFields } = vendor;
      const payload = {
        ...vendorFields,
        organizationId,
        name: vendor.name?.trim(),
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
        summary: bankChanged ? `${vendor.name} vendor record and banking information updated` : `${vendor.name} vendor record saved`,
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
        const recipients = users.filter(item => /admin|accounts/i.test(item.role || '') && item.organizationId === organizationId);
        // Dispatched after the commit rather than inside the batch. Batching it made
        // the alert atomic with the save, but the dispatcher also has to send the
        // mobile/web push — and a push about a banking change is not something to
        // send from inside a transaction that may still roll back. Notifying once the
        // change is durable is the safer ordering for a payment-detail change.
        await dispatchNotification(
          { userIds: recipients.map(item => item.id) },
          {
            type: 'vendor_bank_change',
            title: `Vendor banking information updated: ${vendor.name}`,
            body: 'Review the previous and new masked banking values in the vendor audit log.',
            module: ACTIVITY_MODULES.RECURRING_PAYMENTS,
            // Fraud-relevant: someone changing where money goes should not be a
            // notification anyone has to go looking for.
            severity: 'CRITICAL',
            itemId: reference.id,
            itemRef: vendor.name,
            link: `/recurring-payments/vendors/${reference.id}`,
          },
        );
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
    <div className="flex items-center gap-3"><Button size="icon" variant="outline" onClick={() => router.back()}><ArrowLeft className="h-4 w-4" /></Button><div><h1 className="text-2xl font-bold">{vendorId ? 'Edit Vendor' : 'Add Vendor'}</h1><p className="text-sm text-muted-foreground">Tax, contact, terms and masked banking details</p></div></div>
    <Card><CardHeader><CardTitle>Vendor information</CardTitle><CardDescription>Full bank account numbers should not be stored here. Banking changes are separately audited and notified.</CardDescription></CardHeader><CardContent>
      <form onSubmit={save} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
        <div className="flex justify-end gap-2 sm:col-span-2 lg:col-span-3"><Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button><Button disabled={saving}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save vendor</Button></div>
      </form>
    </CardContent></Card>
  </div>;
}
