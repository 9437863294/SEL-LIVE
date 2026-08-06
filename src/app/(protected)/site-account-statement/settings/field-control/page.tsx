'use client';

import { useEffect, useState } from 'react';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  DEFAULT_EXPENSE_FIELD_CONTROL, DEFAULT_PAYMENT_FIELD_CONTROL,
  EXPENSE_FIELD_CONTROL_LABELS, PAYMENT_FIELD_CONTROL_LABELS,
  SAS_COLLECTIONS, SAS_FIELD_CONTROL_DOC_ID,
  type SASExpenseFieldControl, type SASFieldControlSettings, type SASPaymentFieldControl,
} from '@/lib/site-account-statement';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useActivityLogger } from '@/hooks/useActivityLogger';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Loader2, Receipt, Save, ShieldAlert, SlidersHorizontal, TrendingUp } from 'lucide-react';

const MODULE   = 'Site Account Statement';
const RESOURCE = 'Field Control';

const EXPENSE_FIELD_ORDER: (keyof SASExpenseFieldControl)[] = [
  'expenseCategory', 'expenseSubCategory', 'expensedBy', 'paymentMode',
  'vendorPartyName', 'billNo', 'narration', 'remarks', 'attachment',
];

const PAYMENT_FIELD_ORDER: (keyof SASPaymentFieldControl)[] = [
  'paymentMode', 'referenceNo', 'receivedBy', 'remarks', 'attachment',
];

export default function FieldControlSettingsPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { log } = useActivityLogger('Site Account Statement');
  const { toast } = useToast();
  const { user } = useAuth();

  const canView = can('View', `${MODULE}.${RESOURCE}`) || can('View Module', MODULE);
  const canEdit = can('Edit', `${MODULE}.${RESOURCE}`);

  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [expenseFields, setExpenseFields] = useState<SASExpenseFieldControl>(DEFAULT_EXPENSE_FIELD_CONTROL);
  const [paymentFields, setPaymentFields] = useState<SASPaymentFieldControl>(DEFAULT_PAYMENT_FIELD_CONTROL);

  useEffect(() => {
    if (!isAuthLoading && canView) void loadSettings();
  }, [isAuthLoading, canView]);

  async function loadSettings() {
    setLoading(true);
    try {
      const snap = await getDoc(doc(db, SAS_COLLECTIONS.settings, SAS_FIELD_CONTROL_DOC_ID));
      const data = snap.exists() ? (snap.data() as Partial<SASFieldControlSettings>) : null;
      setExpenseFields({ ...DEFAULT_EXPENSE_FIELD_CONTROL, ...(data?.expense || {}) });
      setPaymentFields({ ...DEFAULT_PAYMENT_FIELD_CONTROL, ...(data?.payment || {}) });
    } catch {
      setExpenseFields(DEFAULT_EXPENSE_FIELD_CONTROL);
      setPaymentFields(DEFAULT_PAYMENT_FIELD_CONTROL);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!canEdit) return;
    setSaving(true);
    try {
      await setDoc(doc(db, SAS_COLLECTIONS.settings, SAS_FIELD_CONTROL_DOC_ID), {
        expense: expenseFields,
        payment: paymentFields,
        updatedAt: serverTimestamp(),
        updatedBy: user?.id || '',
        updatedByName: user?.name || '',
      }, { merge: true });
      void log('Update SAS Field Control', {});
      toast({ title: 'Saved', description: 'Field control settings updated.' });
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  if (isAuthLoading || loading) {
    return <div className="space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}</div>;
  }

  if (!canView) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <ShieldAlert className="h-10 w-10 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">You do not have permission to view field control settings.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-slate-800 flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-emerald-600" />
          Field Control
        </h1>
        <p className="text-sm text-muted-foreground">
          Choose which fields are mandatory or optional on the Add Expense and Add Receipt forms — including the document upload.
          Project, Date and Amount always stay mandatory on both forms.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Expense form fields */}
        <Card className="bg-white/80 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Receipt className="h-4 w-4 text-rose-500" />
              Add Expense Form
            </CardTitle>
            <CardDescription>Toggle a field on to require it before an expense can be saved.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {EXPENSE_FIELD_ORDER.map(key => (
              <div key={key} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
                <Label htmlFor={`exp-${key}`} className="font-medium cursor-pointer">
                  {EXPENSE_FIELD_CONTROL_LABELS[key]}
                </Label>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant={expenseFields[key] ? 'default' : 'secondary'} className={expenseFields[key] ? 'bg-rose-600 hover:bg-rose-600' : ''}>
                    {expenseFields[key] ? 'Mandatory' : 'Optional'}
                  </Badge>
                  <Switch
                    id={`exp-${key}`}
                    checked={expenseFields[key]}
                    onCheckedChange={v => setExpenseFields(f => ({ ...f, [key]: v }))}
                    disabled={!canEdit}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Payment / Receipt form fields */}
        <Card className="bg-white/80 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4 text-emerald-500" />
              Add Receipt Form
            </CardTitle>
            <CardDescription>Toggle a field on to require it before a receipt can be saved.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {PAYMENT_FIELD_ORDER.map(key => (
              <div key={key} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
                <Label htmlFor={`pay-${key}`} className="font-medium cursor-pointer">
                  {PAYMENT_FIELD_CONTROL_LABELS[key]}
                </Label>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant={paymentFields[key] ? 'default' : 'secondary'} className={paymentFields[key] ? 'bg-emerald-600 hover:bg-emerald-600' : ''}>
                    {paymentFields[key] ? 'Mandatory' : 'Optional'}
                  </Badge>
                  <Switch
                    id={`pay-${key}`}
                    checked={paymentFields[key]}
                    onCheckedChange={v => setPaymentFields(f => ({ ...f, [key]: v }))}
                    disabled={!canEdit}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {canEdit && (
        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving} className="gap-2 bg-emerald-600 hover:bg-emerald-700 min-w-[160px]">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save Field Settings
          </Button>
        </div>
      )}
    </div>
  );
}
