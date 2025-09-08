
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Save, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, addDoc } from 'firebase/firestore';
import { Label } from '@/components/ui/label';

const initialBoqItem = {
    'ITEMS SPECS': '',
    'SL. No.': '',
    'Amended SL No': '',
    'Activity Description': '',
    'DESCRIPTION OF ITEMS': '',
    'UNITS': '',
    'Total Qty': '',
    'BASIC PRICE': '',
    'TOTAL AMOUNT': '',
    'GST @ 18% PER UNIT': '',
    'TOTAL PRICE PER UNIT ( In Rs)': '',
    'TOTAL PRICE FOR THE TENDER QUANTITY': ''
};

export default function AddBoqItemPage() {
  const { toast } = useToast();
  const [boqItem, setBoqItem] = useState(initialBoqItem);
  const [isSaving, setIsSaving] = useState(false);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setBoqItem(prev => ({ ...prev, [name]: value }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    // Basic validation
    if (!boqItem['SL. No.'] || !boqItem['DESCRIPTION OF ITEMS']) {
        toast({
            title: 'Missing Required Fields',
            description: 'Please fill in at least "SL. No." and "DESCRIPTION OF ITEMS".',
            variant: 'destructive',
        });
        setIsSaving(false);
        return;
    }
    
    try {
        await addDoc(collection(db, 'boqItems'), boqItem);
        toast({
            title: 'Item Added',
            description: 'The new BOQ item has been successfully saved.',
        });
        setBoqItem(initialBoqItem); // Reset form
    } catch (error) {
        console.error("Error adding BOQ item: ", error);
        toast({
            title: 'Save Failed',
            description: 'An error occurred while saving the item.',
            variant: 'destructive',
        });
    } finally {
        setIsSaving(false);
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
            <Link href="/billing-recon/tpsodl/boq">
                <Button variant="ghost" size="icon">
                    <ArrowLeft className="h-6 w-6" />
                </Button>
            </Link>
            <h1 className="text-2xl font-bold">Add New BOQ Item</h1>
        </div>
        <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save Item
        </Button>
      </div>

      <Card>
        <CardHeader>
            <CardTitle>Item Details</CardTitle>
            <CardDescription>Fill in the details for the new Bill of Quantities item.</CardDescription>
        </CardHeader>
        <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {Object.keys(initialBoqItem).map(key => (
                    <div className="space-y-2" key={key}>
                        <Label htmlFor={key}>{key}</Label>
                        <Input
                            id={key}
                            name={key}
                            value={boqItem[key as keyof typeof boqItem]}
                            onChange={handleInputChange}
                        />
                    </div>
                ))}
            </div>
        </CardContent>
      </Card>
    </div>
  );
}
