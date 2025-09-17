
'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeft, Save, Plus, Trash2, Loader2 } from 'lucide-react';
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

export default function PaymentEntrySettingsPage() {
  const { toast } = useToast();
  const [mandatoryFields, setMandatoryFields] = useState<MandatoryFields>({
    paymentRequestRefNo: true,
    utrNumber: true,
    paymentMethod: true,
    paymentRefNo: true,
    approvalCopy: true,
    bankTransferCopy: true,
  });
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [newMethodName, setNewMethodName] = useState('');
  
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingFields, setIsSavingFields] = useState(false);
  const [isAddingMethod, setIsAddingMethod] = useState(false);

  const fetchSettings = useCallback(async () => {
    setIsLoading(true);
    try {
      const settingsDoc = await getDoc(doc(db, 'bankBalanceSettings', 'paymentEntry'));
      if (settingsDoc.exists()) {
        const settingsData = settingsDoc.data();
        // Ensure all fields are present, defaulting to true if not set
        const defaultTrueFields = {
            paymentRequestRefNo: true,
            utrNumber: true,
            paymentMethod: true,
            paymentRefNo: true,
            approvalCopy: true,
            bankTransferCopy: true,
        };
        setMandatoryFields({ ...defaultTrueFields, ...settingsData.mandatoryFields });
      } else {
        // If no settings exist, default all to true
         setMandatoryFields({
            paymentRequestRefNo: true,
            utrNumber: true,
            paymentMethod: true,
            paymentRefNo: true,
            approvalCopy: true,
            bankTransferCopy: true,
        });
      }
      
      const methodsSnap = await getDocs(collection(db, 'paymentMethods'));
      setPaymentMethods(methodsSnap.docs.map(d => ({id: d.id, name: d.data().name})));

    } catch (e) {
      console.error("Error fetching settings:", e);
      toast({ title: 'Error', description: 'Could not load settings.', variant: 'destructive' });
    }
    setIsLoading(false);
  }, [toast]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const handleFieldToggle = (field: keyof MandatoryFields, checked: boolean) => {
    setMandatoryFields(prev => ({ ...prev, [field]: checked }));
  };

  const handleSaveMandatoryFields = async () => {
    setIsSavingFields(true);
    try {
      await setDoc(doc(db, 'bankBalanceSettings', 'paymentEntry'), { mandatoryFields }, { merge: true });
      toast({ title: 'Success', description: 'Mandatory fields configuration saved.' });
    } catch (e) {
      toast({ title: 'Error', description: 'Failed to save settings.', variant: 'destructive' });
    }
    setIsSavingFields(false);
  };
  
  const handleAddMethod = async () => {
      if(!newMethodName.trim()) {
        toast({title: "Validation Error", description: "Method name cannot be empty.", variant: "destructive"});
        return;
      }
      setIsAddingMethod(true);
      try {
          await addDoc(collection(db, 'paymentMethods'), { name: newMethodName });
          toast({title: 'Success', description: 'New payment method added.'});
          setNewMethodName('');
          fetchSettings();
      } catch (e) {
          toast({ title: 'Error', description: 'Failed to add payment method.', variant: 'destructive' });
      }
      setIsAddingMethod(false);
  }
  
  const handleDeleteMethod = async (id: string) => {
      try {
          await deleteDoc(doc(db, 'paymentMethods', id));
          toast({title: 'Success', description: 'Payment method deleted.'});
          fetchSettings();
      } catch (e) {
           toast({ title: 'Error', description: 'Failed to delete payment method.', variant: 'destructive' });
      }
  }

  const fieldLabels: Record<keyof MandatoryFields, string> = {
    paymentRequestRefNo: 'Payment Request Ref No.',
    utrNumber: 'UTR Number',
    paymentMethod: 'Payment Method',
    paymentRefNo: 'Payment Ref No.',
    approvalCopy: 'Approval Copy',
    bankTransferCopy: 'Bank Transfer Copy',
  };

  return (
    <div className="w-full max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link href="/bank-balance/settings">
            <Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold">Payment Entry Settings</h1>
            <p className="text-muted-foreground">Customize your payment entry form.</p>
          </div>
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <Card>
          <CardHeader>
            <CardTitle>Mandatory Fields</CardTitle>
            <CardDescription>Select which fields are required when making a payment entry.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {isLoading ? <Skeleton className="h-48" /> : Object.keys(mandatoryFields).map((key) => (
              <div key={key} className="flex items-center justify-between p-3 border rounded-lg">
                <Label htmlFor={key} className="font-medium">
                  {fieldLabels[key as keyof MandatoryFields]}
                </Label>
                <Switch
                  id={key}
                  checked={mandatoryFields[key as keyof MandatoryFields]}
                  onCheckedChange={(checked) => handleFieldToggle(key as keyof MandatoryFields, checked)}
                />
              </div>
            ))}
          </CardContent>
          <CardHeader>
             <Button onClick={handleSaveMandatoryFields} disabled={isSavingFields}>
                {isSavingFields ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                 Save Field Settings
            </Button>
          </CardHeader>
        </Card>

        <Card>
            <CardHeader>
                <CardTitle>Payment Methods</CardTitle>
                <CardDescription>Manage the list of available payment methods.</CardDescription>
            </CardHeader>
            <CardContent>
                 <div className="flex gap-2 mb-4">
                    <Input 
                        placeholder="New method name..."
                        value={newMethodName}
                        onChange={(e) => setNewMethodName(e.target.value)}
                    />
                    <Button onClick={handleAddMethod} disabled={isAddingMethod}>
                       {isAddingMethod ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
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
                        {isLoading ? <TableRow><TableCell colSpan={2}><Skeleton className="h-20"/></TableCell></TableRow> :
                         paymentMethods.map(method => (
                            <TableRow key={method.id}>
                                <TableCell>{method.name}</TableCell>
                                <TableCell className="text-right">
                                    <Button variant="ghost" size="icon" onClick={() => handleDeleteMethod(method.id)}>
                                        <Trash2 className="h-4 w-4 text-destructive" />
                                    </Button>
                                </TableCell>
                            </TableRow>
                         ))
                        }
                    </TableBody>
                 </Table>
            </CardContent>
        </Card>
      </div>

    </div>
  );
}
