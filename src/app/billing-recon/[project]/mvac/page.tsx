
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Save, Loader2, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, addDoc } from 'firebase/firestore';
import { Label } from '@/components/ui/label';
import { useParams } from 'next/navigation';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/components/auth/AuthProvider';
import { logUserActivity } from '@/lib/activity-logger';

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
  const { user } = useAuth();
  const params = useParams();
  const projectSlug = params.project as string;
  const { can, isLoading } = useAuthorization();
  
  const [mvacItem, setMvacItem] = useState(initialMvacItem);
  const [isSaving, setIsSaving] = useState(false);
  
  const canAddItem = can('Add Item', 'Billing Recon.MVAC');

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setMvacItem(prev => ({ ...prev, [name]: value }));
  };

  const handleSave = async () => {
    if (!user) {
        toast({ title: 'Authentication Error', description: 'You must be logged in.', variant: 'destructive'});
        return;
    }
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

        await logUserActivity({
            userId: user.id,
            action: 'Add MVAC Item',
            details: {
                project: projectSlug,
                workOrderNo: mvacItem['WO'],
                boqSlNo: mvacItem['BOQ Sl. No.'],
            }
        });

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
  
  if(isLoading) {
    return (
       <div className="w-full px-4 sm:px-6 lg:px-8">
            <Skeleton className="h-10 w-64 mb-6" />
            <Skeleton className="h-96 w-full" />
       </div>
    )
  }

  if(!can('View', 'Billing Recon.MVAC')) {
    return (
        <div className="w-full px-4 sm:px-6 lg:px-8">
            <div className="mb-6 flex items-center gap-2">
                <Link href={`/billing-recon/${projectSlug}`}><Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button></Link>
                <h1 className="text-2xl font-bold">Add New MVAC Item</h1>
            </div>
            <Card>
                <CardHeader><CardTitle>Access Denied</CardTitle><CardDescription>You do not have permission to access MVAC management.</CardDescription></CardHeader>
                <CardContent className="flex justify-center p-8"><ShieldAlert className="h-16 w-16 text-destructive" /></CardContent>
            </Card>
        </div>
    );
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
            <Link href={`/billing-recon/${projectSlug}`}>
                <Button variant="ghost" size="icon">
                    <ArrowLeft className="h-6 w-6" />
                </Button>
            </Link>
            <h1 className="text-2xl font-bold">Add New MVAC Item</h1>
        </div>
        {canAddItem && (
            <Button onClick={handleSave} disabled={isSaving}>
                {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Save Item
            </Button>
        )}
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
                            disabled={!canAddItem}
                        />
                    </div>
                ))}
            </div>
        </CardContent>
      </Card>
    </div>
  );
}
