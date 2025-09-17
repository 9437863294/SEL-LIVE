
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Save, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, doc, updateDoc } from 'firebase/firestore';
import type { Project } from '@/lib/types';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';

export default function BillingStatusPage() {
  const { toast } = useToast();
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    fetchProjects();
  }, []);

  const fetchProjects = async () => {
    setIsLoading(true);
    try {
      const querySnapshot = await getDocs(collection(db, 'projects'));
      const projectsData = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project));
      setProjects(projectsData);
    } catch (error) {
      console.error("Error fetching projects: ", error);
      toast({ title: 'Error', description: 'Failed to fetch projects.', variant: 'destructive' });
    }
    setIsLoading(false);
  };

  const handleBillingStatusChange = async (project: Project, billingRequired: boolean) => {
    setSavingId(project.id);
    try {
        const projectRef = doc(db, 'projects', project.id);
        await updateDoc(projectRef, { billingRequired });
        setProjects(prev => 
            prev.map(p => p.id === project.id ? { ...p, billingRequired } : p)
        );
        toast({ title: 'Success', description: `${project.projectName} billing status updated.` });
    } catch (error) {
        console.error("Error updating project billing status:", error);
        toast({ title: 'Error', description: 'Failed to update billing status.', variant: 'destructive' });
    } finally {
        setSavingId(null);
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center gap-2">
        <Link href="/billing-recon/settings">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-6 w-6" />
          </Button>
        </Link>
        <h1 className="text-xl font-bold">Billing Status</h1>
      </div>

       <Card>
        <CardHeader>
          <CardTitle>Project Billing Status</CardTitle>
          <CardDescription>Enable or disable billing requirements for each project.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project Name</TableHead>
                  <TableHead className="text-right">Billing Required</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-5 w-48" /></TableCell>
                      <TableCell className="text-right"><Skeleton className="h-6 w-12" /></TableCell>
                    </TableRow>
                  ))
                ) : (
                  projects.map(project => (
                    <TableRow key={project.id}>
                      <TableCell className="font-medium">{project.projectName}</TableCell>
                      <TableCell className="text-right">
                        {savingId === project.id ? (
                            <Loader2 className="h-5 w-5 animate-spin ml-auto" />
                        ) : (
                            <Switch
                                checked={project.billingRequired}
                                onCheckedChange={(checked) => handleBillingStatusChange(project, checked)}
                            />
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
