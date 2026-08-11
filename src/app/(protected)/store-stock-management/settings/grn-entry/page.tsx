
'use client';

import { useState, useEffect, useCallback } from 'react';
import { Save, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

interface MandatoryFields {
  poNumber: boolean;
  poDate: boolean;
  invoiceNumber: boolean;
  invoiceDate: boolean;
  invoiceAmount: boolean;
  invoiceFiles: boolean;
  transporterDocs: boolean;
  vehicleNo: boolean;
  waybillNo: boolean;
  lrNo: boolean;
  lrDate: boolean;
}

export default function GrnEntrySettingsPage() {
  const { toast } = useToast();
  const [mandatoryFields, setMandatoryFields] = useState<MandatoryFields>({
    poNumber: true,
    poDate: false,
    invoiceNumber: true,
    invoiceDate: false,
    invoiceAmount: false,
    invoiceFiles: false,
    transporterDocs: false,
    vehicleNo: false,
    waybillNo: false,
    lrNo: false,
    lrDate: false,
  });
  
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const fetchSettings = useCallback(async () => {
    setIsLoading(true);
    try {
      const settingsDoc = await getDoc(doc(db, 'storeStockSettings', 'grnEntry'));
      if (settingsDoc.exists()) {
        const settingsData = settingsDoc.data();
        setMandatoryFields(prev => ({ ...prev, ...settingsData.mandatoryFields }));
      }
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
    setIsSaving(true);
    try {
      await setDoc(doc(db, 'storeStockSettings', 'grnEntry'), { mandatoryFields }, { merge: true });
      toast({ title: 'Success', description: 'Mandatory fields configuration saved.' });
    } catch (e) {
      toast({ title: 'Error', description: 'Failed to save settings.', variant: 'destructive' });
    }
    setIsSaving(false);
  };

  const fieldLabels: Record<keyof MandatoryFields, string> = {
    poNumber: 'P.O. Number',
    poDate: 'P.O. Date',
    invoiceNumber: 'Invoice Number',
    invoiceDate: 'Invoice Date',
    invoiceAmount: 'Invoice Amount',
    invoiceFiles: 'Invoice Upload',
    transporterDocs: 'Transporter Doc Upload',
    vehicleNo: 'Vehicle No.',
    waybillNo: 'Waybill No.',
    lrNo: 'LR No.',
    lrDate: 'LR Date',
  };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-violet-600">Transaction configuration</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">GRN Entry Settings</h1>
          <p className="mt-1 text-sm text-muted-foreground">Choose the information users must provide when creating a Goods Receipt Note.</p>
        </div>
        <Button onClick={handleSaveMandatoryFields} disabled={isSaving}>
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save Settings
        </Button>
      </div>
      
      <Card className="border-slate-200/80 shadow-sm">
          <CardHeader>
            <CardTitle>Mandatory Fields</CardTitle>
            <CardDescription>Select which fields are required when creating a GRN.</CardDescription>
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
        </Card>
    </div>
  );
}
