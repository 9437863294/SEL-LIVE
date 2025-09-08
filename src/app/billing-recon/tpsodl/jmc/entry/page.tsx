
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

const initialJmcItem = {
    'JMC No': '',
    'WO No': '',
    'BOQ Sl. No.': '',
    'Activity Description': '',
    'Quantity Executed': '',
    'Unit': '',
    'Rate': '',
    'Total Amount': '',
    'JMC Date': '',
};

export default function JmcEntryPage() {
  const { toast } = useToast();
  const [item, setItem] = useState(initialJmcItem);
  const [isSaving, setIsSaving] = useState(false);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setItem(prev => ({ ...prev, [name]: value }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    if (!item['JMC No'] || !item['WO No']) {
        toast({
            title: 'Missing Required Fields',
            description: 'Please fill in at least "JMC No" and "WO No".',
            variant: 'destructive',
        });
        setIsSaving(false);
        return;
    }
    
    try {
        await addDoc(collection(db, 'jmcEntries'), item);
        toast({
            title: 'JMC Entry Created',
            description: 'The new JMC entry has been successfully saved.',
        });
        setItem(initialJmcItem); // Reset form
    } catch (error) {
        console.error("Error creating JMC entry: ", error);
        toast({
            title: 'Save Failed',
            description: 'An error occurred while saving the JMC entry.',
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
            <Link href="/billing-recon/tpsodl/jmc">
                <Button variant="ghost" size="icon">
                    <ArrowLeft className="h-6 w-6" />
                </Button>
            </Link>
            <h1 className="text-2xl font-bold">Create JMC Entry</h1>
        </div>
        <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save Entry
        </Button>
      </div>

      <Card>
        <CardHeader>
            <CardTitle>JMC Details</CardTitle>
            <CardDescription>Fill in the details for the new Joint Measurement Certificate entry.</CardDescription>
        </CardHeader>
        <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {Object.keys(initialJmcItem).map(key => (
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
