
'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, doc, updateDoc } from 'firebase/firestore';
import type { Project } from '@/lib/types';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';

export default function StockStatusPage() {
  const { toast } = useToast();

  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  const fetchProjects = useCallback(async () => {
    setIsLoading(true);
    try {
      const querySnapshot = await getDocs(collection(db, 'projects'));
      const projectsData = querySnapshot.docs.map((d) => {
        // Remove any 'id' coming from Firestore data to avoid duplicate key conflicts
        const raw = d.data() as (Project & { id?: string }) | undefined;
        const { id: _ignored, ...rest } = raw ?? {};
        return { id: d.id, ...rest } as Project;
      });
      setProjects(projectsData);
    } catch (error) {
      console.error('Error fetching projects: ', error);
      toast({ title: 'Error', description: 'Failed to fetch projects.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const handleToggle = async (project: Project, nextChecked: boolean) => {
    if (!project.id) return;
    setSavingId(project.id);
    try {
      const projectRef = doc(db, 'projects', project.id);
      await updateDoc(projectRef, { stockManagementRequired: nextChecked });
      setProjects((prev) =>
        prev.map((p) => (p.id === project.id ? { ...p, stockManagementRequired: nextChecked } : p))
      );
      toast({
        title: 'Updated',
        description: `${project.projectName ?? 'Project'} ${nextChecked ? 'enabled for' : 'removed from'} Store & Stock Management.`,
      });
    } catch (error) {
      console.error('Error updating stock management status:', error);
      toast({ title: 'Error', description: 'Failed to update stock management status.', variant: 'destructive' });
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center gap-2">
        <Link href="/store-stock-management/settings">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-6 w-6" />
          </Button>
        </Link>
        <h1 className="text-xl font-bold">Stock Management Status</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Project Stock Management Status</CardTitle>
          <CardDescription>
            Enable a project here to make it selectable in Store &amp; Stock Management. Only enabled projects show up in that module's project picker.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project Name</TableHead>
                  <TableHead>Site Code</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Stock Management Required</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell>
                        <Skeleton className="h-5 w-48" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-5 w-24" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-5 w-16" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-6 w-12" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : projects.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                      No projects found.
                    </TableCell>
                  </TableRow>
                ) : (
                  projects.map((project) => (
                    <TableRow key={project.id}>
                      <TableCell className="font-medium">{project.projectName ?? '—'}</TableCell>
                      <TableCell>{project.siteCode ?? '—'}</TableCell>
                      <TableCell>
                        <Badge variant={project.status === 'Active' ? 'default' : 'secondary'}>
                          {project.status ?? '—'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {savingId === project.id ? (
                          <Loader2 className="h-5 w-5 animate-spin" />
                        ) : (
                          <Switch
                            checked={!!project.stockManagementRequired}
                            onCheckedChange={(checked) => handleToggle(project, checked)}
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
