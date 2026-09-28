'use client';
export const dynamic = 'force-dynamic';

import { useCallback, useEffect, useState } from 'react';
import { FilePen, Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
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
import { PageHeader } from '@/components/shared/page-header';
import { BANK_PAGE, BankAccessDenied, BankBalanceBackground, BankPageSkeleton } from '@/components/bank-balance/page-kit';
import { useToast } from '@/hooks/use-toast';
import { useAuthorization } from '@/hooks/useAuthorization';
import { db } from '@/lib/firebase';

interface MandatoryFields {
  paymentRequestRefNo: boolean;
  utrNumber: boolean;
  paymentMethod: boolean;
  paymentRefNo: boolean;
  approvalCopy: boolean;
  bankTransferCopy: boolean;
}

interface PaymentMethod {
  id: string;
  name: string;
}

const DEFAULT_MANDATORY_FIELDS: MandatoryFields = {
  paymentRequestRefNo: true,
  utrNumber: true,
  paymentMethod: true,
  paymentRefNo: true,
  approvalCopy: true,
  bankTransferCopy: true,
};

const FIELD_LABELS: Record<keyof MandatoryFields, { label: string; hint: string }> = {
  paymentRequestRefNo: { label: 'Payment Request Ref No.', hint: 'The internal request the payment settles.' },
  utrNumber: { label: 'UTR Number', hint: "The bank's transaction reference." },
  paymentMethod: { label: 'Payment Method', hint: 'Chosen from the list on the right.' },
  paymentRefNo: { label: 'Payment Ref No.', hint: 'Cheque / instrument number.' },
  approvalCopy: { label: 'Approval Copy', hint: 'Upload of the signed approval.' },
  bankTransferCopy: { label: 'Bank Transfer Copy', hint: "Upload of the bank's transfer advice." },
};

/**
 * Payment entry settings: which fields the New Payment form insists on, and the payment methods
 * it offers. Access is unchanged — the settings permission, or permission to record payments.
 */
export default function PaymentEntrySettingsPage() {
  const { toast } = useToast();
  const { can, isLoading: authLoading } = useAuthorization();

  const [mandatoryFields, setMandatoryFields] = useState<MandatoryFields>(DEFAULT_MANDATORY_FIELDS);
  const [savedFields, setSavedFields] = useState<MandatoryFields>(DEFAULT_MANDATORY_FIELDS);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [newMethodName, setNewMethodName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<PaymentMethod | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [isSavingFields, setIsSavingFields] = useState(false);
  const [isBusy, setIsBusy] = useState(false);

  const canView = can('View', 'Bank Balance.Payment Entry Settings') || can('Add', 'Bank Balance.Expenses');
  const canEdit = can('Edit', 'Bank Balance.Payment Entry Settings') || can('Add', 'Bank Balance.Expenses');

  const fetchSettings = useCallback(async () => {
    if (!canView) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const [settingsDoc, methodsSnap] = await Promise.all([
        getDoc(doc(db, 'bankBalanceSettings', 'paymentEntry')),
        getDocs(collection(db, 'paymentMethods')),
      ]);
      const loaded = { ...DEFAULT_MANDATORY_FIELDS, ...(settingsDoc.exists() ? settingsDoc.data().mandatoryFields || {} : {}) };
      setMandatoryFields(loaded);
      setSavedFields(loaded);
      setPaymentMethods(
        methodsSnap.docs
          .map((d) => ({ id: d.id, name: String(d.data().name ?? '') }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
    } catch (e) {
      console.error('Error fetching settings:', e);
      toast({ title: 'Error', description: 'Could not load settings.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  }, [canView, toast]);

  useEffect(() => {
    if (authLoading) return;
    void fetchSettings();
  }, [authLoading, fetchSettings]);

  if (authLoading || (isLoading && canView)) return <BankPageSkeleton kpis={0} blocks={1} />;
  if (!canView) return <BankAccessDenied title="Payment Entry Settings" backHref="/bank-balance/settings" backLabel="Back to settings" />;

  const isDirty = (Object.keys(mandatoryFields) as Array<keyof MandatoryFields>).some((key) => mandatoryFields[key] !== savedFields[key]);

  const handleSaveMandatoryFields = async () => {
    if (!canEdit) return;
    setIsSavingFields(true);
    try {
      await setDoc(doc(db, 'bankBalanceSettings', 'paymentEntry'), { mandatoryFields }, { merge: true });
      setSavedFields(mandatoryFields);
      toast({ title: 'Saved', description: 'Mandatory fields updated.' });
    } catch (e) {
      console.error(e);
      toast({ title: 'Error', description: 'Failed to save settings.', variant: 'destructive' });
    } finally {
      setIsSavingFields(false);
    }
  };

  const handleAddMethod = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canEdit) return;
    const name = newMethodName.trim();
    if (!name) {
      toast({ title: 'Check the name', description: 'Method name cannot be empty.', variant: 'destructive' });
      return;
    }
    if (paymentMethods.some((method) => method.name.trim().toLowerCase() === name.toLowerCase())) {
      toast({ title: 'Already listed', description: `"${name}" is already a payment method.`, variant: 'destructive' });
      return;
    }
    setIsBusy(true);
    try {
      await addDoc(collection(db, 'paymentMethods'), { name });
      toast({ title: 'Added', description: `"${name}" added.` });
      setNewMethodName('');
      void fetchSettings();
    } catch (e) {
      console.error(e);
      toast({ title: 'Error', description: 'Failed to add payment method.', variant: 'destructive' });
    } finally {
      setIsBusy(false);
    }
  };

  const handleDeleteMethod = async () => {
    if (!canEdit || !deleteTarget) return;
    setIsBusy(true);
    try {
      await deleteDoc(doc(db, 'paymentMethods', deleteTarget.id));
      toast({ title: 'Deleted', description: `"${deleteTarget.name}" removed.` });
      setDeleteTarget(null);
      void fetchSettings();
    } catch (e) {
      console.error(e);
      toast({ title: 'Error', description: 'Failed to delete payment method.', variant: 'destructive' });
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <>
      <BankBalanceBackground tone="slate" />
      <div className={BANK_PAGE}>
        <PageHeader
          title="Payment Entry Settings"
          description="What the New Payment form requires, and the payment methods it offers."
          icon={FilePen}
          backHref="/bank-balance/settings"
          backLabel="Back to settings"
        />

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Card className="min-w-0">
            <CardHeader>
              <CardTitle>Mandatory fields</CardTitle>
              <CardDescription>Fields a payment cannot be saved without.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2.5">
              {(Object.keys(FIELD_LABELS) as Array<keyof MandatoryFields>).map((key) => (
                <div key={key} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                  <Label htmlFor={`field-${key}`} className="min-w-0 cursor-pointer">
                    <span className="block font-medium">{FIELD_LABELS[key].label}</span>
                    <span className="block text-xs font-normal text-muted-foreground">{FIELD_LABELS[key].hint}</span>
                  </Label>
                  <Switch
                    id={`field-${key}`}
                    checked={mandatoryFields[key]}
                    onCheckedChange={(checked) => canEdit && setMandatoryFields((prev) => ({ ...prev, [key]: checked }))}
                    disabled={!canEdit}
                  />
                </div>
              ))}
              {canEdit && (
                <div className="flex flex-wrap items-center gap-3 pt-2">
                  <Button onClick={() => void handleSaveMandatoryFields()} disabled={isSavingFields || !isDirty}>
                    {isSavingFields ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                    Save Fields
                  </Button>
                  {isDirty && <span className="text-xs text-amber-700">Unsaved changes</span>}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="min-w-0">
            <CardHeader>
              <CardTitle>Payment methods</CardTitle>
              <CardDescription>Offered in the payment method list on the payment form.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {canEdit && (
                <form onSubmit={handleAddMethod} className="flex gap-2">
                  <Input
                    aria-label="New payment method"
                    placeholder="e.g. NEFT, RTGS, Cheque"
                    value={newMethodName}
                    onChange={(e) => setNewMethodName(e.target.value)}
                  />
                  <Button type="submit" disabled={isBusy} className="shrink-0">
                    {isBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                    Add
                  </Button>
                </form>
              )}
              {paymentMethods.length === 0 ? (
                <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No payment methods yet.</p>
              ) : (
                <ul className="divide-y rounded-lg border">
                  {paymentMethods.map((method) => (
                    <li key={method.id} className="flex items-center justify-between gap-3 px-3 py-2">
                      <span className="min-w-0 truncate text-sm font-medium">{method.name}</span>
                      {canEdit && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => setDeleteTarget(method)}
                          aria-label={`Delete ${method.name}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open && !isBusy) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove &ldquo;{deleteTarget?.name}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              It will no longer be offered on the payment form. Payments already recorded with it keep their method.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isBusy}
              onClick={(event) => {
                event.preventDefault();
                void handleDeleteMethod();
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
