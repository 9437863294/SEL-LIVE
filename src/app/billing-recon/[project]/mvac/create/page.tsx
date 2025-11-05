
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Save, Loader2, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, addDoc, getDocs, doc, serverTimestamp, query, where } from 'firebase/firestore';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { logUserActivity } from '@/lib/activity-logger';
import type { MvacItem, Project } from '@/lib/types';


const initialMvacItem: Omit<MvacItem, 'id' | 'projectSlug'> = {
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

const slugify = (text: string) => {
  if (!text) return '';
  return text.toString().toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
}

export default function CreateMvacPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const router = useRouter();
  const params = useParams();
  const projectSlug = params.project as string;
  const [items, setItems] = useState<Omit<MvacItem, 'id' | 'projectSlug'>[]>([initialMvacItem]);
  const [isSaving, setIsSaving] = useState(false);
  const [projectName, setProjectName] = useState('');

   useEffect(() => {
    const fetchProjectName = async () => {
      if (!projectSlug) return;
      const projectsQuery = query(collection(db, 'projects'));
      const projectsSnapshot = await getDocs(projectsQuery);
      const projectData = projectsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project)).find(p => slugify(p.projectName) === projectSlug);
      
      if (projectData) {
        setProjectName(projectData.projectName);
        setItems(prev => prev.map(item => ({ ...item, 'Project': projectData.projectName })));
      }
    };
    fetchProjectName();
  }, [projectSlug]);

  const handleInputChange = (index: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    const newItems = [...items];
    newItems[index] = { ...newItems[index], [name]: value };
    setItems(newItems);
  };
  
  const addItem = () => {
      setItems(prev => [...prev, {...initialMvacItem, 'Project': projectName}]);
  }
  
  const removeItem = (index: number) => {
      if(items.length > 1) {
        setItems(prev => prev.filter((_, i) => i !== index));
      } else {
        setItems([initialMvacItem]);
      }
  }

  const handleSave = async () => {
    if (!user) {
        toast({ title: 'Authentication Error', description: 'You must be logged in.', variant: 'destructive'});
        return;
    }
    
    if (items.some(item => !item['WO'] || !item['BOQ Sl. No.'])) {
      toast({ title: 'Missing Fields', description: 'Please fill in at least "WO" and "BOQ Sl. No." for all items.', variant: 'destructive' });
      return;
    }

    setIsSaving(true);
    
    try {
        const batch = writeBatch(db);
        items.forEach(item => {
            const docRef = doc(collection(db, 'mvacItems'));
            batch.set(docRef, {...item, projectSlug});
        });
        await batch.commit();

        await logUserActivity({
            userId: user.id,
            action: 'Create MVAC Entries',
            details: { project: projectSlug, count: items.length }
        });

        toast({ title: 'Items Added', description: `${items.length} MVAC item(s) have been saved.`});
        router.push(`/billing-recon/${projectSlug}/mvac/log`);

    } catch (error) {
        console.error("Error adding MVAC items: ", error);
        toast({ title: 'Save Failed', description: 'An error occurred while saving the items.', variant: 'destructive' });
    } finally {
        setIsSaving(false);
    }
  };

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
            <Link href={`/billing-recon/${projectSlug}/mvac`}>
                <Button variant="ghost" size="icon"> <ArrowLeft className="h-6 w-6" /> </Button>
            </Link>
            <h1 className="text-2xl font-bold">Create New MVAC Entry</h1>
        </div>
        <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save Entries
        </Button>
      </div>

      <div className="space-y-4">
        {items.map((item, index) => (
            <Card key={index}>
                <CardHeader className="flex flex-row items-start justify-between">
                    <div>
                        <CardTitle>Item #{index + 1}</CardTitle>
                        <CardDescription>Details for Material/Vehicle Administration Certificate</CardDescription>
                    </div>
                    {items.length > 1 && (
                        <Button variant="ghost" size="icon" onClick={() => removeItem(index)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                    )}
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {Object.keys(initialMvacItem).map(key => (
                            <div className="space-y-1" key={key}>
                                <Label htmlFor={`${key}-${index}`}>{key}</Label>
                                <Input
                                    id={`${key}-${index}`}
                                    name={key}
                                    value={item[key as keyof typeof item]}
                                    onChange={(e) => handleInputChange(index, e)}
                                    readOnly={key === 'Project'}
                                />
                            </div>
                        ))}
                    </div>
                </CardContent>
            </Card>
        ))}
      </div>
      <div className="mt-4">
        <Button variant="outline" onClick={addItem}>
            <Plus className="mr-2 h-4 w-4" /> Add Another Item
        </Button>
      </div>
    </div>
  );
}
