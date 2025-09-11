
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


const initialWorkOrderItem = {
    'WO No': '',
    'Project': '',
    'Vendor': '',
    'Start Date': '',
    'End Date': '',
    'Total Value': '',
    'Status': 'Issued'
};

export default function CreateWorkOrderPage() {
  const { toast } = useToast();
  const params = useParams();
  const projectSlug = params.project as string;
  const [item, setItem] = useState(initialWorkOrderItem);
  const [isSaving, setIsSaving] = useState(false);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setItem(prev => ({ ...prev, [name]: value }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    if (!item['WO No'] || !item['Project'] || !item['Vendor']) {
        toast({
            title: 'Missing Required Fields',
            description: 'Please fill in "WO No", "Project", and "Vendor".',
            variant: 'destructive',
        });
        setIsSaving(false);
        return;
    }
    
    try {
        const workOrderData = {
          ...item,
          projectSlug: projectSlug, // Tag work order with project slug
        }
        await addDoc(collection(db, 'workOrders'), workOrderData);
        toast({
            title: 'Work Order Created',
            description: 'The new work order has been successfully saved.',
        });
        setItem(initialWorkOrderItem); // Reset form
    } catch (error) {
        console.error("Error creating work order: ", error);
        toast({
            title: 'Save Failed',
            description: 'An error occurred while saving the work order.',
            variant: 'destructive',
        });
    } finally {
        setIsSaving(false);
    }
  };

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
            <Link href={`/billing-recon/${projectSlug}/jmc`}>
                <Button variant="ghost" size="icon">
                    <ArrowLeft className="h-6 w-6" />
                </Button>
            </Link>
            <h1 className="text-2xl font-bold">Create New Work Order</h1>
        </div>
        <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save Work Order
        </Button>
      </div>

      <Card>
        <CardHeader>
            <CardTitle>Work Order Details</CardTitle>
            <CardDescription>Fill in the details for the new work order.</CardDescription>
        </CardHeader>
        <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {Object.keys(initialWorkOrderItem).map(key => (
                    <div className="space-y-2" key={key}>
                        <Label htmlFor={key}>{key}</Label>
                        <Input
                            id={key}
                            name={key}
                            value={item[key as keyof typeof item]}
                            onChange={handleInputChange}
                            type={key.includes('Date') ? 'date' : 'text'}
                        />
                    </div>
                ))}
            </div>
        </CardContent>
      </Card>
    </div>
  );
}
