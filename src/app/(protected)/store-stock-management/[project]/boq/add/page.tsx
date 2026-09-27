
'use client';

import { useState, useEffect } from 'react';
import { Save, Loader2 } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, addDoc, getDocs, query } from 'firebase/firestore';
import { Label } from '@/components/ui/label';
import { useParams } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { logUserActivity } from '@/lib/activity-logger';
import type { Project } from '@/lib/types';
import { projectMatchesSlug } from '@/lib/project-slug';

const initialBoqItem = {
    'Project': '',
    'Site': '',
    'Scope': '',
    'Sl No': '',
    'Description': '',
    'UNIT': '',
    'BOQ QTY': '',
    'UNIT PRICE': '',
};

export default function AddBoqItemPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const params = useParams();
  const projectSlug = (params?.project as string) || '';
  const [boqItem, setBoqItem] = useState(initialBoqItem);
  const [isSaving, setIsSaving] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [projectId, setProjectId] = useState<string | null>(null);


  useEffect(() => {
    const fetchProjectName = async () => {
      if (!projectSlug) return;
      const projectsQuery = query(collection(db, 'projects'));
      const projectsSnapshot = await getDocs(projectsQuery);
      const projectData = projectsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project)).find(p => projectMatchesSlug(p.projectName, projectSlug));

      if (projectData) {
        setProjectName(projectData.projectName);
        setProjectId(projectData.id);
        setBoqItem(prev => ({ ...prev, 'Project': projectData.projectName }));
      }
    };
    fetchProjectName();
  }, [projectSlug]);


  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setBoqItem(prev => ({ ...prev, [name]: value }));
  };

  const handleSave = async () => {
    if (!user) {
        toast({ title: 'Authentication Error', description: 'You must be logged in.', variant: 'destructive'});
        return;
    }
    if (!projectId) {
        toast({ title: 'Error', description: 'Project not found.', variant: 'destructive'});
        return;
    }
    setIsSaving(true);
    // Basic validation
    if (!boqItem['Sl No'] || !boqItem['Description']) {
        toast({
            title: 'Missing Required Fields',
            description: 'Please fill in at least "Sl No" and "Description".',
            variant: 'destructive',
        });
        setIsSaving(false);
        return;
    }

    try {
        await addDoc(collection(db, 'projects', projectId, 'boqItems'), boqItem);

        await logUserActivity({
            userId: user.id,
            module: 'Store & Stock Management',
            action: 'Add BOQ Item (Stock)',
            details: {
                project: projectSlug,
                itemSlNo: boqItem['Sl No'],
                itemDescription: boqItem['Description'],
            }
        });

        toast({
            title: 'Item Added',
            description: 'The new BOQ item has been successfully saved.',
        });
        setBoqItem({
          ...initialBoqItem,
          'Project': projectName // Keep project name after reset
        });

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
    <div className="w-full px-4 sm:px-6 lg:px-8">
      <PageHeader
        title="Add New BOQ Item"
        backHref={`/store-stock-management/${projectSlug}/boq`}
        backLabel="Back to BOQ Management"
        actions={
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save Item
          </Button>
        }
      />

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
                            readOnly={key === 'Project'}
                        />
                    </div>
                ))}
            </div>
        </CardContent>
      </Card>
    </div>
  );
}
