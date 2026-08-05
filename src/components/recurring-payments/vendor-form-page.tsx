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
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

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

      if (bankChanged) {
        const recipients = users.filter(item => /admin|accounts/i.test(item.role || '') && item.organizationId === organizationId);
        for (const recipient of recipients) {
          batch.set(doc(collection(db, 'userNotifications')), {
            userId: recipient.id,
            type: 'vendor_bank_change',
            title: `Vendor banking information updated: ${vendor.name}`,
            body: 'Review the previous and new masked banking values in the vendor audit log.',
            module: 'Recurring Payments',
            itemId: reference.id,
            link: `/recurring-payments/vendors/${reference.id}`,
            read: false,
            createdAt: serverTimestamp(),
          });
        }
      }

      await batch.commit();
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
        <Field label="Vendor name *"><Input value={vendor.name || ''} onChange={event => set('name', event.target.value)} required /></Field>
        <Field label="Vendor code"><Input value={vendor.code || ''} onChange={event => set('code', event.target.value)} /></Field>
        <Field label="Vendor category"><Input value={vendor.category || ''} onChange={event => set('category', event.target.value)} /></Field>
        <Field label="GSTIN"><Input value={vendor.gstin || ''} onChange={event => set('gstin', event.target.value)} /></Field>
        <Field label="PAN"><Input value={vendor.pan || ''} onChange={event => set('pan', event.target.value)} /></Field>
        <Field label="Contact person"><Input value={vendor.contactPerson || ''} onChange={event => set('contactPerson', event.target.value)} /></Field>
        <Field label="Mobile"><Input value={vendor.mobile || ''} onChange={event => set('mobile', event.target.value)} /></Field>
        <Field label="Email"><Input type="email" value={vendor.email || ''} onChange={event => set('email', event.target.value)} /></Field>
        <Field label="Payment terms"><Input value={vendor.paymentTerms || ''} onChange={event => set('paymentTerms', event.target.value)} /></Field>
        <Field label="Bank name"><Input value={vendor.bankName || ''} onChange={event => set('bankName', event.target.value)} /></Field>
        <Field label="Masked account number"><Input placeholder="••••1234" value={vendor.maskedAccountNumber || ''} onChange={event => set('maskedAccountNumber', event.target.value)} /></Field>
        <Field label="IFSC"><Input value={vendor.ifsc || ''} onChange={event => set('ifsc', event.target.value)} /></Field>
        <Field label="Status"><Select value={vendor.status || 'Active'} onValueChange={value => set('status', value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Active">Active</SelectItem><SelectItem value="Inactive">Inactive</SelectItem></SelectContent></Select></Field>
        <div className="sm:col-span-2 lg:col-span-3"><Field label="Address"><Textarea value={vendor.address || ''} onChange={event => set('address', event.target.value)} /></Field></div>
        <div className="flex justify-end gap-2 sm:col-span-2 lg:col-span-3"><Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button><Button disabled={saving}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save vendor</Button></div>
      </form>
    </CardContent></Card>
  </div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label>{label}</Label>{children}</div>;
}
