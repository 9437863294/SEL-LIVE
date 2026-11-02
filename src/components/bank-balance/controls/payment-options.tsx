'use client';

import { useEffect, useState } from 'react';
import { addDoc, collection, deleteDoc, doc, onSnapshot, setDoc } from 'firebase/firestore';
import { Loader2, Plus, Save, Trash2 } from 'lucide-react';
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
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useActivityLogger } from '@/hooks/useActivityLogger';
import { useToast } from '@/hooks/use-toast';
import { diffFields } from '@/lib/activity-logger';
import { ACTIVITY_MODULES } from '@/lib/activity-modules';
import { db } from '@/lib/firebase';

interface PaymentMethod {
  id: string;
  name: string;
}

/**
 * Field Control › Payment options: whether a New Payment row may be paid without a requisition,
 * and the payment methods the form offers. Formerly Settings › Payment Entry, which now redirects
 * here.
 *
 * Same documents (`bankBalanceSettings/paymentEntry`, `paymentMethods`), same activity entries
 * and the same rights as before — the settings right, or the right to record payments.
 */
export function PaymentOptions({ canEdit }: { canEdit: boolean }) {
  const { toast } = useToast();
  const { log } = useActivityLogger(ACTIVITY_MODULES.BANK_BALANCE);

  /** Whether a voucher row may be paid against a typed reference when no requisition exists for it. */
  const [savedAllowDirect, setSavedAllowDirect] = useState(true);
  /** The switch as edited, until saved; null follows the stored value. */
  const [draftDirect, setDraftDirect] = useState<boolean | null>(null);
  const allowDirect = draftDirect ?? savedAllowDirect;
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [newMethodName, setNewMethodName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<PaymentMethod | null>(null);
  const [settingsReady, setSettingsReady] = useState(false);
  const [methodsReady, setMethodsReady] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const isLoading = !settingsReady || !methodsReady;

  // Live, so an add or a delete — here or by someone else — shows without a reload.
  useEffect(
    () =>
      onSnapshot(
        doc(db, 'bankBalanceSettings', 'paymentEntry'),
        (snapshot) => {
          // Absent means allowed, so an existing site keeps the behaviour it has today.
          setSavedAllowDirect(snapshot.exists() ? snapshot.data().allowDirectPayments !== false : true);
          setSettingsReady(true);
        },
        (error) => {
          console.error('Error loading payment options:', error);
          toast({ title: 'Error', description: 'Could not load the payment options.', variant: 'destructive' });
          setSettingsReady(true);
        },
      ),
    [toast],
  );
  useEffect(
    () =>
      onSnapshot(
        collection(db, 'paymentMethods'),
        (snapshot) => {
          setMethods(snapshot.docs.map((d) => ({ id: d.id, name: String(d.data().name ?? '') })).sort((a, b) => a.name.localeCompare(b.name)));
          setMethodsReady(true);
        },
        (error) => {
          console.error('Error loading payment methods:', error);
          setMethodsReady(true);
        },
      ),
    [],
  );

  const handleSaveDirect = async () => {
    if (!canEdit) return;
    setIsSaving(true);
    try {
      // Merged and on its own key, so the old mandatory switches stored beside it stay as they are.
      await setDoc(doc(db, 'bankBalanceSettings', 'paymentEntry'), { allowDirectPayments: allowDirect }, { merge: true });
      void log(
        'Update Payment Entry Settings',
        { changes: diffFields({ allowDirectPayments: savedAllowDirect }, { allowDirectPayments: allowDirect }) },
        { recordId: 'paymentEntry', recordRef: 'Payment options' },
      );
      setDraftDirect(null);
      toast({ title: 'Saved', description: allowDirect ? 'Rows may be paid without a requisition.' : 'Every row must now settle a requisition.' });
    } catch (error) {
      console.error(error);
      toast({ title: 'Error', description: 'Failed to save.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
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
    if (methods.some((method) => method.name.trim().toLowerCase() === name.toLowerCase())) {
      toast({ title: 'Already listed', description: `"${name}" is already a payment method.`, variant: 'destructive' });
      return;
    }
    setIsBusy(true);
    try {
      const ref = await addDoc(collection(db, 'paymentMethods'), { name });
      void log('Add Payment Method', { name }, { recordId: ref.id, recordRef: name });
      toast({ title: 'Added', description: `"${name}" added.` });
      setNewMethodName('');
    } catch (error) {
      console.error(error);
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
      void log('Delete Payment Method', { name: deleteTarget.name }, { recordId: deleteTarget.id, recordRef: deleteTarget.name });
      toast({ title: 'Deleted', description: `"${deleteTarget.name}" removed.` });
      setDeleteTarget(null);
    } catch (error) {
      console.error(error);
      toast({ title: 'Error', description: 'Failed to delete payment method.', variant: 'destructive' });
    } finally {
      setIsBusy(false);
    }
  };

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Skeleton className="h-44 rounded-xl" />
        <Skeleton className="h-44 rounded-xl" />
      </div>
    );
  }

  const dirty = allowDirect !== savedAllowDirect;

  return (
    <>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Payments without a requisition</CardTitle>
            <CardDescription>How the New Payment form treats a row whose Reception No. is not waiting for payment.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <Label htmlFor="allow-direct" className="min-w-0 cursor-pointer">
                <span className="block font-medium">Allow direct payments</span>
                <span className="block text-xs font-normal text-muted-foreground">
                  On: a row can be paid against a typed reference when the requisition is not in the system. Off: every row must settle
                  a requisition waiting for payment.
                </span>
              </Label>
              <Switch id="allow-direct" checked={allowDirect} onCheckedChange={(checked) => canEdit && setDraftDirect(checked)} disabled={!canEdit} />
            </div>
            {canEdit && (
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={() => void handleSaveDirect()} disabled={isSaving || !dirty}>
                  {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Save
                </Button>
                {dirty && <span className="text-xs text-amber-700">Unsaved change</span>}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Payment methods</CardTitle>
            <CardDescription>Offered in the payment mode list on New Payment, after the standard ones.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {canEdit && (
              <form onSubmit={handleAddMethod} className="flex gap-2">
                <Input aria-label="New payment method" placeholder="e.g. NEFT, RTGS, Cheque" value={newMethodName} onChange={(e) => setNewMethodName(e.target.value)} />
                <Button type="submit" disabled={isBusy} className="shrink-0">
                  {isBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                  Add
                </Button>
              </form>
            )}
            {methods.length === 0 ? (
              <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No payment methods yet.</p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {methods.map((method) => (
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

      {!canEdit && (
        <p className="text-xs text-muted-foreground">
          You can view these options but not change them. Ask an administrator for Edit on Bank Balance › Payment Entry Settings.
        </p>
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open && !isBusy) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove &ldquo;{deleteTarget?.name}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>It will no longer be offered on the payment form. Payments already recorded with it keep their method.</AlertDialogDescription>
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
