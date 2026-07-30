'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { collection, doc, onSnapshot, orderBy, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { AlertTriangle, ArrowLeft, Edit3, Loader2, Power } from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import { type PaymentObligation, RP_COLLECTIONS, currency, maskAccount } from '@/lib/recurring-payments';
import type { RecurringVendor } from './vendor-management';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

type AuditRecord = { id: string; action: string; summary?: string; userName?: string; createdAt?: unknown };

export default function VendorDetailPage({ vendorId }: { vendorId: string }) {
  const router = useRouter();
  const { user } = useAuth();
  const { can } = useAuthorization();
  const { toast } = useToast();
  const organizationId = user?.organizationId || 'default';
  const [vendor, setVendor] = useState<RecurringVendor | null>(null);
  const [allPayments, setAllPayments] = useState<PaymentObligation[]>([]);
  const [audit, setAudit] = useState<AuditRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const vendorRef = doc(db, RP_COLLECTIONS.vendors, vendorId);
    const stops = [
      onSnapshot(vendorRef, snapshot => {
        const value = snapshot.exists() ? ({ id: snapshot.id, ...snapshot.data() } as RecurringVendor) : null;
        setVendor(value?.organizationId === organizationId ? value : null);
        setLoading(false);
      }, () => setLoading(false)),
      onSnapshot(query(collection(db, RP_COLLECTIONS.payments), where('organizationId', '==', organizationId)), snapshot => {
        setAllPayments(snapshot.docs.map(item => ({ id: item.id, ...item.data() } as PaymentObligation)));
      }),
      onSnapshot(query(collection(vendorRef, RP_COLLECTIONS.auditLogs), orderBy('createdAt', 'desc')), snapshot => {
        setAudit(snapshot.docs.map(item => ({ id: item.id, ...item.data() } as AuditRecord)));
      }),
    ];
    return () => stops.forEach(stop => stop());
  }, [organizationId, vendorId]);

  const payments = allPayments.filter(item => item.vendorName === vendor?.name);
  const outstanding = payments.filter(item => !['Paid', 'Closed', 'Cancelled', 'Waived'].includes(item.status));

  async function toggle() {
    if (!vendor) return;
    const status = vendor.status === 'Active' ? 'Inactive' : 'Active';
    await updateDoc(doc(db, RP_COLLECTIONS.vendors, vendor.id), { status, updatedAt: serverTimestamp() });
    toast({ title: `Vendor ${status.toLowerCase()}` });
  }

  if (loading) return <div className="flex min-h-[45vh] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin" /></div>;
  if (!vendor) return <Card><CardContent className="py-16 text-center"><AlertTriangle className="mx-auto mb-3 h-9 w-9 text-amber-500" />Vendor not found or access denied.</CardContent></Card>;

  return <div className="space-y-5">
    <Card className="border-0 bg-gradient-to-r from-slate-900 to-indigo-900 text-white"><CardContent className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between"><div className="flex gap-3"><Button variant="secondary" size="icon" onClick={() => router.back()}><ArrowLeft className="h-4 w-4" /></Button><div><div className="flex items-center gap-2"><h1 className="text-2xl font-bold">{vendor.name}</h1><Badge className="bg-white/15 text-white">{vendor.status}</Badge></div><p className="text-sm text-indigo-100">{vendor.code || vendor.id} · {vendor.category || 'General vendor'}</p></div></div>{can('Edit', 'Recurring Payments.Vendors') && <div className="flex gap-2"><Link href={`/recurring-payments/vendors/${vendor.id}/edit`}><Button variant="secondary"><Edit3 className="mr-2 h-4 w-4" />Edit</Button></Link><Button variant="secondary" onClick={toggle}><Power className="mr-2 h-4 w-4" />{vendor.status === 'Active' ? 'Deactivate' : 'Activate'}</Button></div>}</CardContent></Card>
    <div className="grid gap-3 sm:grid-cols-3"><Metric label="Payment records" value={String(payments.length)} /><Metric label="Outstanding records" value={String(outstanding.length)} /><Metric label="Outstanding value" value={currency(outstanding.reduce((sum, item) => sum + Math.max(0, (item.billAmount || item.expectedAmount) - (item.settledAmount || item.paidAmount)), 0))} /></div>
    <Tabs defaultValue="overview"><TabsList className="flex h-auto flex-wrap"><TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="bank">Bank details</TabsTrigger><TabsTrigger value="payments">Payment history</TabsTrigger><TabsTrigger value="outstanding">Outstanding</TabsTrigger><TabsTrigger value="audit">Audit log</TabsTrigger></TabsList>
      <TabsContent value="overview"><Card><CardContent className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3"><Info label="GSTIN" value={vendor.gstin || '—'} /><Info label="PAN" value={vendor.pan || '—'} /><Info label="Contact person" value={vendor.contactPerson || '—'} /><Info label="Mobile" value={vendor.mobile || '—'} /><Info label="Email" value={vendor.email || '—'} /><Info label="Payment terms" value={vendor.paymentTerms || '—'} /><div className="sm:col-span-2 lg:col-span-3"><Info label="Address" value={vendor.address || '—'} /></div></CardContent></Card></TabsContent>
      <TabsContent value="bank"><Card><CardContent className="grid gap-4 p-5 sm:grid-cols-3"><Info label="Bank name" value={vendor.bankName || '—'} /><Info label="Masked account" value={maskAccount(vendor.maskedAccountNumber) || '—'} /><Info label="IFSC" value={vendor.ifsc || '—'} /></CardContent></Card></TabsContent>
      <TabsContent value="payments"><PaymentTable rows={payments} onOpen={id => router.push(`/recurring-payments/payments/${id}`)} /></TabsContent>
      <TabsContent value="outstanding"><PaymentTable rows={outstanding} onOpen={id => router.push(`/recurring-payments/payments/${id}`)} /></TabsContent>
      <TabsContent value="audit"><Card><CardContent className="space-y-3 p-5">{audit.map(item => <div className="rounded-xl border p-3" key={item.id}><p className="font-medium">{item.action}</p><p className="text-sm text-muted-foreground">{item.summary}</p><p className="text-xs text-muted-foreground">{item.userName} · {formatTimestamp(item.createdAt)}</p></div>)}{!audit.length && <p className="py-8 text-center text-sm text-muted-foreground">No vendor audit history.</p>}</CardContent></Card></TabsContent>
    </Tabs>
  </div>;
}

function Metric({ label, value }: { label: string; value: string }) { return <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-xl font-bold">{value}</p></CardContent></Card>; }
function Info({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border bg-muted/20 p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-medium">{value}</p></div>; }
function PaymentTable({ rows, onOpen }: { rows: PaymentObligation[]; onOpen: (id: string) => void }) { return <Card><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Payment</TableHead><TableHead>Due date</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{rows.map(item => <TableRow key={item.id} className="cursor-pointer" onClick={() => onOpen(item.id)}><TableCell>{item.title}</TableCell><TableCell>{item.dueDate}</TableCell><TableCell className="text-right">{currency(item.billAmount || item.expectedAmount)}</TableCell><TableCell><Badge variant="outline">{item.status}</Badge></TableCell></TableRow>)}{!rows.length && <TableRow><TableCell colSpan={4} className="h-24 text-center text-muted-foreground">No payments found.</TableCell></TableRow>}</TableBody></Table></CardContent></Card>; }
function formatTimestamp(value: unknown) { const timestamp = value as { toDate?: () => Date; seconds?: number } | null; if (timestamp?.toDate) return timestamp.toDate().toLocaleString('en-IN'); if (timestamp?.seconds) return new Date(timestamp.seconds * 1000).toLocaleString('en-IN'); return '—'; }
