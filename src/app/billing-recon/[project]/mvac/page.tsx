
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
import { useParams } from 'next/navigation';

const initialMvacItem = {
    'WO': '',
    'Project': '',
    'BOQ Sl. No.': '',
    'Description': '',
    'Unit': '',
    'Total BOQ Qty': '',
    'Rate': '',
    'Amount': '',
    'Start Date': '',
    'End Date': '',
    'Status': ''
};

export default function AddMvacItemPage() {
  const { toast } = useToast();
  const params = useParams();
  const projectSlug = params.project as string;
  const [mvacItem, setMvacItem] = useState(initialMvacItem);
  const [isSaving, setIsSaving] = useState(false);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setMvacItem(prev => ({ ...prev, [name]: value }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    if (!mvacItem['WO'] || !mvacItem['BOQ Sl. No.']) {
        toast({
            title: 'Missing Required Fields',
            description: 'Please fill in at least "WO" and "BOQ Sl. No.".',
            variant: 'destructive',
        });
        setIsSaving(false);
        return;
    }
    
    try {
        await addDoc(collection(db, 'projects', projectSlug, 'mvacItems'), mvacItem);
        toast({
            title: 'Item Added',
            description: 'The new MVAC item has been successfully saved.',
        });
        setMvacItem(initialMvacItem); // Reset form
    } catch (error) {
        console.error("Error adding MVAC item: ", error);
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
            <Link href={`/billing-recon/${projectSlug}`}>
                <Button variant="ghost" size="icon">
                    <ArrowLeft className="h-6 w-6" />
                </Button>
            </Link>
            <h1 className="text-2xl font-bold">Add New MVAC Item</h1>
        </div>
        <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save Item
        </Button>
      </div>

      <Card>
        <CardHeader>
            <CardTitle>Item Details</CardTitle>
            <CardDescription>Fill in the details for the new MVAC item.</CardDescription>
        </CardHeader>
        <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {Object.keys(initialMvacItem).map(key => (
                    <div className="space-y-2" key={key}>
                        <Label htmlFor={key}>{key}</Label>
                        <Input
                            id={key}
                            name={key}
                            value={mvacItem[key as keyof typeof mvacItem]}
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
