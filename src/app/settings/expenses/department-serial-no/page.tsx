
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, doc, getDoc, setDoc } from 'firebase/firestore';
import type { Department, SerialNumberConfig } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';

const initialConfigState: SerialNumberConfig = {
    prefix: '',
    format: '',
    suffix: '',
    startingIndex: 1,
};

export default function DepartmentSerialNoPage() {
  const { toast } = useToast();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [configs, setConfigs] = useState<Record<string, SerialNumberConfig>>({});
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchDepartmentsAndConfigs = async () => {
      setIsLoading(true);
      try {
        const deptSnapshot = await getDocs(collection(db, 'departments'));
        const depts = deptSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Department));
        setDepartments(depts);

        const configPromises = depts.map(async (dept) => {
          const configDocRef = doc(db, 'departmentSerialConfigs', dept.id);
          const configDocSnap = await getDoc(configDocRef);
          if (configDocSnap.exists()) {
            return { [dept.id]: configDocSnap.data() as SerialNumberConfig };
          }
          return { [dept.id]: { ...initialConfigState, prefix: `${dept.name.substring(0,3).toUpperCase()}/` } };
        });

        const results = await Promise.all(configPromises);
        const newConfigs = results.reduce((acc, current) => ({ ...acc, ...current }), {});
        setConfigs(newConfigs);

      } catch (error) {
        console.error("Error fetching data:", error);
        toast({ title: 'Error', description: 'Failed to fetch departments or configurations.', variant: 'destructive' });
      }
      setIsLoading(false);
    };
    fetchDepartmentsAndConfigs();
  }, [toast]);

  const handleConfigChange = (deptId: string, field: keyof SerialNumberConfig, value: string | number) => {
    setConfigs(prev => ({
      ...prev,
      [deptId]: {
        ...prev[deptId],
        [field]: value
      }
    }));
  };

  const handleSaveConfig = async (deptId: string) => {
    try {
      await setDoc(doc(db, 'departmentSerialConfigs', deptId), configs[deptId]);
      toast({ title: 'Success', description: `Configuration for department saved.` });
    } catch (error) {
      console.error("Error saving config:", error);
      toast({ title: 'Error', description: 'Failed to save configuration.', variant: 'destructive' });
    }
  };

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center gap-4">
        <Link href="/settings/expenses">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-6 w-6" />
          </Button>
        </Link>
        <h1 className="text-2xl font-bold">Department-wise Serial Number</h1>
      </div>

      <div className="space-y-6">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-48 w-full" />)
        ) : departments.length > 0 ? (
          departments.map((dept) => (
            <Card key={dept.id}>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>{dept.name}</CardTitle>
                  <CardDescription>Configure serial numbers for the {dept.name} department.</CardDescription>
                </div>
                <Button onClick={() => handleSaveConfig(dept.id)}>
                    <Save className="mr-2 h-4 w-4" /> Save
                </Button>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="space-y-1">
                      <Label htmlFor={`prefix-${dept.id}`} className="text-sm font-normal text-muted-foreground">Prefix</Label>
                      <Input 
                          id={`prefix-${dept.id}`}
                          value={configs[dept.id]?.prefix || ''}
                          onChange={(e) => handleConfigChange(dept.id, 'prefix', e.target.value)}
                      />
                  </div>
                  <div className="space-y-1">
                      <Label htmlFor={`format-${dept.id}`} className="text-sm font-normal text-muted-foreground">Format</Label>
                      <Input 
                          id={`format-${dept.id}`}
                          value={configs[dept.id]?.format || ''}
                          onChange={(e) => handleConfigChange(dept.id, 'format', e.target.value)}
                      />
                  </div>
                  <div className="space-y-1">
                      <Label htmlFor={`suffix-${dept.id}`} className="text-sm font-normal text-muted-foreground">Suffix</Label>
                      <Input 
                          id={`suffix-${dept.id}`}
                          value={configs[dept.id]?.suffix || ''}
                          onChange={(e) => handleConfigChange(dept.id, 'suffix', e.target.value)}
                      />
                  </div>
                  <div className="space-y-1">
                      <Label htmlFor={`index-${dept.id}`} className="text-sm font-normal text-muted-foreground">Index</Label>
                      <Input 
                          id={`index-${dept.id}`}
                          type="number"
                          value={configs[dept.id]?.startingIndex || 1}
                          onChange={(e) => handleConfigChange(dept.id, 'startingIndex', parseInt(e.target.value, 10) || 1)}
                      />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        ) : (
          <Card>
            <CardContent className="text-center p-12">
              <p className="text-muted-foreground">No departments found.</p>
              <Link href="/settings/department">
                <Button variant="link">Add a department to get started</Button>
              </Link>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
