
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, View } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { db } from '@/lib/firebase';
import { collection, getDocs, orderBy, query, where } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';
import { useParams } from 'next/navigation';
import type { MvacEntry, Project } from '@/lib/types';
import { format } from 'date-fns';

const slugify = (text: string) => {
  if (!text) return '';
  return text.toString().toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
}

export default function MvacLogPage() {
  const { toast } = useToast();
  const params = useParams();
  const projectSlug = params.project as string;
  const [mvacEntries, setMvacEntries] = useState<MvacEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedMvac, setSelectedMvac] = useState<MvacEntry | null>(null);
  const [isViewOpen, setIsViewOpen] = useState(false);

  useEffect(() => {
    const fetchMvacEntries = async () => {
      if (!projectSlug) return;
      setIsLoading(true);
      try {
        const projectsQuery = query(collection(db, 'projects'));
        const projectSnap = await getDocs(projectsQuery);
        
        const project = projectSnap.docs
            .map(doc => ({ id: doc.id, ...doc.data() } as Project))
            .find(p => slugify(p.projectName) === projectSlug);

        if (!project) {
            console.error("Project not found");
            return;
        }
        const projectId = project.id;
        
        const q = query(collection(db, 'projects', projectId, 'mvacEntries'), orderBy('createdAt', 'desc'));
        const querySnapshot = await getDocs(q);
        const entries = querySnapshot.docs.map(doc => {
            const data = doc.data() as MvacEntry;
            return {
                id: doc.id,
                ...data,
                mvacDate: format(new Date(data.mvacDate), 'dd MMM, yyyy'),
            };
        });
        setMvacEntries(entries);
      } catch (error) {
        console.error("Error fetching MVAC entries: ", error);
        toast({ title: 'Error', description: 'Failed to fetch MVAC entries for this project.', variant: 'destructive' });
      }
      setIsLoading(false);
    };
    fetchMvacEntries();
  }, [projectSlug, toast]);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);
  }

  return (
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link href={`/billing-recon/${projectSlug}/mvac`}>
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-6 w-6" />
              </Button>
            </Link>
            <h1 className="text-2xl font-bold">MVAC Log</h1>
          </div>
        </div>
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>MVAC No.</TableHead>
                  <TableHead>MVAC Date</TableHead>
                  <TableHead>Work Order No.</TableHead>
                  <TableHead>No. of Items</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={4}><Skeleton className="h-5" /></TableCell>
                    </TableRow>
                  ))
                ) : mvacEntries.length > 0 ? (
                  mvacEntries.map((entry) => (
                    <TableRow key={entry.id} className="cursor-pointer">
                      <TableCell className="font-medium">{entry.mvacNo}</TableCell>
                      <TableCell>{entry.mvacDate}</TableCell>
                      <TableCell>{entry.woNo}</TableCell>
                      <TableCell>{entry.items.length}</TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center h-24">
                      No MVAC entries found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
  );
}
