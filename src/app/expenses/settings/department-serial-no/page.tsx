
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Save, ShieldAlert, Loader2 } from 'lucide-react';
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
import { useAuthorization } from '@/hooks/useAuthorization';
import { useAuth } from '@/components/auth/AuthProvider';
import { logUserActivity } from '@/lib/activity-logger';

const initialConfigState: SerialNumberConfig = {
    prefix: '',
    format: '',
    suffix: '',
    startingIndex: 1,
};

export default function DepartmentSerialNoPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { can, isLoading: isAuthLoading } = useAuthorization();

  const [departments, setDepartments] = useState<Department[]>([]);
  const [configs, setConfigs] = useState<Record<string, SerialNumberConfig>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [savingStates, setSavingStates] = useState<Record<string, boolean>>({});
  
  const canViewPage = can('View', 'Expenses.Settings');
  const canEdit = can('Edit Serial Nos', 'Expenses.Settings');

  useEffect(() => {
    if (isAuthLoading) return;

    if (canViewPage) {
        fetchDepartmentsAndConfigs();
    } else {
        setIsLoading(false);
    }
  }, [isAuthLoading, canViewPage]);

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

  const handleConfigChange = (deptId: string, field: keyof SerialNumberConfig, value: string | number) => {
    setConfigs(prev => ({
      ...prev,
      [deptId]: {
        ...prev[deptId],
        [field]: value
      }
    }));
  };

  const handleSaveConfig = async (deptId: string, deptName: string) => {
    if (!user) return;
    setSavingStates(prev => ({ ...prev, [deptId]: true }));
    try {
      await setDoc(doc(db, 'departmentSerialConfigs', deptId), configs[deptId]);
      await logUserActivity({
          userId: user.id,
          action: 'Update Department Serial No. Config',
          details: { department: deptName, config: configs[deptId] }
      });
      toast({ title: 'Success', description: `Configuration for ${deptName} saved.` });
    } catch (error) {
      console.error("Error saving config:", error);
      toast({ title: 'Error', description: 'Failed to save configuration.', variant: 'destructive' });
    } finally {
        setSavingStates(prev => ({ ...prev, [deptId]: false }));
    }
  };
  
  if (isAuthLoading || (isLoading && canViewPage)) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <Skeleton className="h-10 w-96 mb-6" />
        <div className="space-y-6">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-48 w-full" />)}
        </div>
      </div>
    );
  }

  if (!canViewPage) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center gap-4">
            <Link href="/expenses/settings"><Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button></Link>
            <h1 className="text-2xl font-bold">Department-wise Serial Number</h1>
        </div>
        <Card>
            <CardHeader><CardTitle>Access Denied</CardTitle><CardDescription>You do not have permission to view this page.</CardDescription></CardHeader>
            <CardContent className="flex justify-center p-8"><ShieldAlert className="h-16 w-16 text-destructive" /></CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center gap-4">
        <Link href="/expenses/settings">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-6 w-6" />
          </Button>
        </Link>
        <h1 className="text-2xl font-bold">Department-wise Serial Number</h1>
      </div>

      <div className="space-y-6">
        {departments.length > 0 ? (
          departments.map((dept) => (
            <Card key={dept.id}>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>{dept.name}</CardTitle>
                  <CardDescription>Configure serial numbers for the {dept.name} department.</CardDescription>
                </div>
                <Button onClick={() => handleSaveConfig(dept.id, dept.name)} disabled={!canEdit || savingStates[dept.id]}>
                    {savingStates[dept.id] ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Save className="mr-2 h-4 w-4" />}
                     Save
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
                          disabled={!canEdit}
                      />
                  </div>
                  <div className="space-y-1">
                      <Label htmlFor={`format-${dept.id}`} className="text-sm font-normal text-muted-foreground">Format</Label>
                      <Input 
                          id={`format-${dept.id}`}
                          value={configs[dept.id]?.format || ''}
                          onChange={(e) => handleConfigChange(dept.id, 'format', e.target.value)}
                          disabled={!canEdit}
                      />
                  </div>
                  <div className="space-y-1">
                      <Label htmlFor={`suffix-${dept.id}`} className="text-sm font-normal text-muted-foreground">Suffix</Label>
                      <Input 
                          id={`suffix-${dept.id}`}
                          value={configs[dept.id]?.suffix || ''}
                          onChange={(e) => handleConfigChange(dept.id, 'suffix', e.target.value)}
                          disabled={!canEdit}
                      />
                  </div>
                  <div className="space-y-1">
                      <Label htmlFor={`index-${dept.id}`} className="text-sm font-normal text-muted-foreground">Index</Label>
                      <Input 
                          id={`index-${dept.id}`}
                          type="number"
                          value={configs[dept.id]?.startingIndex || 1}
                          onChange={(e) => handleConfigChange(dept.id, 'startingIndex', parseInt(e.target.value, 10) || 1)}
                          disabled={!canEdit}
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
