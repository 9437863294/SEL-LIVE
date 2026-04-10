'use client';
export const dynamic = 'force-dynamic';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeft, Save, Plus, Trash2, Loader2, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { doc, getDoc, setDoc, collection, addDoc, getDocs, deleteDoc } from 'firebase/firestore';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAuthorization } from '@/hooks/useAuthorization';

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

const fieldLabels: Record<keyof MandatoryFields, string> = {
  paymentRequestRefNo: 'Payment Request Ref No.',
  utrNumber: 'UTR Number',
  paymentMethod: 'Payment Method',
  paymentRefNo: 'Payment Ref No.',
  approvalCopy: 'Approval Copy',
  bankTransferCopy: 'Bank Transfer Copy',
};

export default function PaymentEntrySettingsPage() {
  const { toast } = useToast();
  const { can, isLoading: authLoading } = useAuthorization();

  const [mandatoryFields, setMandatoryFields] =
    useState<MandatoryFields>(DEFAULT_MANDATORY_FIELDS);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [newMethodName, setNewMethodName] = useState('');

  const [isLoading, setIsLoading] = useState(true);
  const [isSavingFields, setIsSavingFields] = useState(false);
  const [isAddingMethod, setIsAddingMethod] = useState(false);

  const canView =
    can('View', 'Bank Balance.Payment Entry Settings') ||
    can('Add', 'Bank Balance.Expenses');
  const canEdit =
    can('Edit', 'Bank Balance.Payment Entry Settings') ||
    can('Add', 'Bank Balance.Expenses');

  const fetchSettings = useCallback(async () => {
    if (!canView) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const settingsDoc = await getDoc(doc(db, 'bankBalanceSettings', 'paymentEntry'));

      if (settingsDoc.exists()) {
        const settingsData = settingsDoc.data();
        const loaded = settingsData.mandatoryFields || {};
        setMandatoryFields({
          ...DEFAULT_MANDATORY_FIELDS,
          ...loaded,
        });
      } else {
        setMandatoryFields(DEFAULT_MANDATORY_FIELDS);
      }

      const methodsSnap = await getDocs(collection(db, 'paymentMethods'));
      setPaymentMethods(
        methodsSnap.docs.map((d) => ({
          id: d.id,
          name: d.data().name as string,
        }))
      );
    } catch (e) {
      console.error('Error fetching settings:', e);
      toast({
        title: 'Error',
        description: 'Could not load settings.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  }, [canView, toast]);

  useEffect(() => {
    if (authLoading) return;
    fetchSettings();
  }, [authLoading, fetchSettings]);

  const handleFieldToggle = (field: keyof MandatoryFields, checked: boolean) => {
    if (!canEdit) return;
    setMandatoryFields((prev) => ({ ...prev, [field]: checked }));
  };

  const handleSaveMandatoryFields = async () => {
    if (!canEdit) return;

    setIsSavingFields(true);
    try {
      await setDoc(
        doc(db, 'bankBalanceSettings', 'paymentEntry'),
        { mandatoryFields },
        { merge: true }
      );
      toast({
        title: 'Success',
        description: 'Mandatory fields configuration saved.',
      });
    } catch (e) {
      console.error(e);
      toast({
        title: 'Error',
        description: 'Failed to save settings.',
        variant: 'destructive',
      });
    } finally {
      setIsSavingFields(false);
    }
  };

  const handleAddMethod = async () => {
    if (!canEdit) return;

    if (!newMethodName.trim()) {
      toast({
        title: 'Validation Error',
        description: 'Method name cannot be empty.',
        variant: 'destructive',
      });
      return;
    }

    setIsAddingMethod(true);
    try {
      await addDoc(collection(db, 'paymentMethods'), { name: newMethodName.trim() });
      toast({ title: 'Success', description: 'New payment method added.' });
      setNewMethodName('');
      fetchSettings();
    } catch (e) {
      console.error(e);
      toast({
        title: 'Error',
        description: 'Failed to add payment method.',
        variant: 'destructive',
      });
    } finally {
      setIsAddingMethod(false);
    }
  };

  const handleDeleteMethod = async (id: string) => {
    if (!canEdit) return;

    try {
      await deleteDoc(doc(db, 'paymentMethods', id));
      toast({ title: 'Success', description: 'Payment method deleted.' });
      fetchSettings();
    } catch (e) {
      console.error(e);
      toast({
        title: 'Error',
        description: 'Failed to delete payment method.',
        variant: 'destructive',
      });
    }
  };

  if (authLoading || (isLoading && canView)) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8 space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center gap-2">
          <Link href="/bank-balance/settings">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-6 w-6" />
            </Button>
          </Link>
          <h1 className="text-xl font-bold">Payment Entry Settings</h1>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>
              You do not have permission to view this page.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center p-8">
            <ShieldAlert className="h-16 w-16 text-destructive" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <>
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-br from-slate-50/60 via-background to-violet-50/40 dark:from-slate-950/20 dark:via-background dark:to-violet-950/15" />
        <div className="animate-bb-orb-1 absolute top-[-10%] left-[-5%] w-[40vw] h-[40vw] rounded-full bg-violet-300/12 blur-3xl" />
        <div className="animate-bb-orb-2 absolute bottom-[-8%] right-[-6%] w-[45vw] h-[45vw] rounded-full bg-slate-300/10 blur-3xl" />
        <div className="absolute inset-0 opacity-15 dark:opacity-10"
          style={{ backgroundImage: 'radial-gradient(circle, rgba(139,92,246,0.10) 1px, transparent 1px)', backgroundSize: '28px 28px' }}
        />
      </div>
    <div className="relative w-full px-4 sm:px-6 lg:px-8 py-4">
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/bank-balance/settings">
            <Button variant="ghost" size="icon" className="rounded-full hover:bg-primary/10">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Payment Entry Settings</h1>
            <p className="text-xs text-muted-foreground">Customize your payment entry form.</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Mandatory Fields */}
        <Card>
          <CardHeader>
            <CardTitle>Mandatory Fields</CardTitle>
            <CardDescription>
              Select which fields are required when making a payment entry.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {isLoading ? (
              <Skeleton className="h-48" />
            ) : (
              (Object.keys(mandatoryFields) as (keyof MandatoryFields)[]).map(
                (key) => (
                  <div
                    key={key}
                    className="flex items-center justify-between p-3 border rounded-lg"
                  >
                    <Label htmlFor={key} className="font-medium">
                      {fieldLabels[key]}
                    </Label>
                    <Switch
                      id={key}
                      checked={mandatoryFields[key]}
                      onCheckedChange={(checked) =>
                        handleFieldToggle(key, checked)
                      }
                      disabled={!canEdit}
                    />
                  </div>
                )
              )
            )}
            <div className="pt-2">
              <Button
                onClick={handleSaveMandatoryFields}
                disabled={isSavingFields || !canEdit}
              >
                {isSavingFields ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                Save Field Settings
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Payment Methods */}
        <Card>
          <CardHeader>
            <CardTitle>Payment Methods</CardTitle>
            <CardDescription>
              Manage the list of available payment methods.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2 mb-4">
              <Input
                placeholder="New method name..."
                value={newMethodName}
                onChange={(e) => setNewMethodName(e.target.value)}
                disabled={!canEdit}
              />
              <Button
                onClick={handleAddMethod}
                disabled={isAddingMethod || !canEdit}
              >
                {isAddingMethod ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="mr-2 h-4 w-4" />
                )}
                Add
              </Button>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Method Name</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={2}>
                      <Skeleton className="h-20" />
                    </TableCell>
                  </TableRow>
                ) : paymentMethods.length > 0 ? (
                  paymentMethods.map((method) => (
                    <TableRow key={method.id}>
                      <TableCell>{method.name}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDeleteMethod(method.id)}
                          disabled={!canEdit}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={2}
                      className="text-center text-muted-foreground h-16"
                    >
                      No payment methods configured.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
    </>
  );
}
