
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus, Edit, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
  DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, addDoc, deleteDoc, doc, updateDoc, writeBatch } from 'firebase/firestore';
import type { Project, Site } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from '@/components/ui/badge';

export default function ManageProjectsAndSitesPage() {
  const { toast } = useToast();
  const [projects, setProjects] = useState<Project[]>([]);
  const [sites, setSites] = useState<Record<string, Site[]>>({});
  const [isLoading, setIsLoading] = useState(true);

  // You would implement dialogs and handlers for adding/editing projects and sites here.

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      try {
        const projectsSnap = await getDocs(collection(db, 'projects'));
        const projectsData = projectsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project));
        setProjects(projectsData);
        
        const sitesData: Record<string, Site[]> = {};
        for (const project of projectsData) {
            const sitesSnap = await getDocs(collection(db, 'projects', project.id, 'sites'));
            sitesData[project.id] = sitesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Site));
        }
        setSites(sitesData);

      } catch (error) {
        console.error("Error fetching data:", error);
      }
      setIsLoading(false);
    };
    fetchData();
  }, []);

  return (
    <div className="w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/store-stock-management">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-6 w-6" />
            </Button>
          </Link>
          <h1 className="text-xl font-bold">Manage Projects & Sites</h1>
        </div>
        <Button disabled>
            <Plus className="mr-2 h-4 w-4" /> Add Project
        </Button>
      </div>

       <Accordion type="multiple" className="w-full space-y-4">
        {isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : projects.length > 0 ? (
          projects.map(project => (
            <AccordionItem value={project.id} key={project.id} className="border-none">
                <Card>
                    <AccordionTrigger className="p-4 hover:no-underline">
                        <div className="flex justify-between items-center w-full">
                            <h3 className="font-semibold text-lg">{project.projectName}</h3>
                            <Badge>{project.status || 'Active'}</Badge>
                        </div>
                    </AccordionTrigger>
                    <AccordionContent className="px-4 pb-4">
                       <div className="border rounded-md">
                         <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Site Name</TableHead>
                                    <TableHead>Location</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {(sites[project.id] || []).length > 0 ? (
                                    sites[project.id].map(site => (
                                        <TableRow key={site.id}>
                                            <TableCell>{site.name}</TableCell>
                                            <TableCell>{site.location}</TableCell>
                                        </TableRow>
                                    ))
                                ) : (
                                    <TableRow>
                                        <TableCell colSpan={2} className="text-center h-20">No sites for this project.</TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                         </Table>
                       </div>
                    </AccordionContent>
                </Card>
            </AccordionItem>
          ))
        ) : (
          <Card className="text-center py-12">
            <CardContent>No projects found.</CardContent>
          </Card>
        )}
       </Accordion>
    </div>
  );
}
