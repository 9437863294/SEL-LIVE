
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, View } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { db } from '@/lib/firebase';
import { collection, getDocs, orderBy, query, where } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';
import { format } from 'date-fns';
import type { Bill, Project, JmcEntry, MvacEntry } from '@/lib/types';
import { useParams } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import ViewJmcEntryDialog from '@/components/ViewJmcEntryDialog';
import ViewMvacEntryDialog from '@/components/ViewMvacEntryDialog';

const slugify = (text: string) => {
  if (!text) return '';
  return text.toString().toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '')
    .replace(/\-\-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
}

type CombinedLogEntry = (JmcEntry | MvacEntry) & { type: 'JMC' | 'MVAC' };

export default function CombinedLogPage() {
  const { toast } = useToast();
  const params = useParams();
  const projectSlug = params.project as string;

  const [log, setLog] = useState<CombinedLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [selectedJmc, setSelectedJmc] = useState<JmcEntry | null>(null);
  const [isJmcViewOpen, setIsJmcViewOpen] = useState(false);
  
  const [selectedMvac, setSelectedMvac] = useState<MvacEntry | null>(null);
  const [isMvacViewOpen, setIsMvacViewOpen] = useState(false);

  useEffect(() => {
    const fetchLogs = async () => {
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

        const jmcQuery = query(collection(db, 'projects', projectId, 'jmcEntries'), orderBy('createdAt', 'desc'));
        const mvacQuery = query(collection(db, 'projects', projectId, 'mvacEntries'), orderBy('createdAt', 'desc'));
        
        const [jmcSnapshot, mvacSnapshot] = await Promise.all([
            getDocs(jmcQuery),
            getDocs(mvacQuery),
        ]);
        
        const jmcEntries = jmcSnapshot.docs.map(doc => ({ id: doc.id, type: 'JMC', ...doc.data() } as CombinedLogEntry));
        const mvacEntries = mvacSnapshot.docs.map(doc => ({ id: doc.id, type: 'MVAC', ...doc.data() } as CombinedLogEntry));
        
        const combined = [...jmcEntries, ...mvacEntries];
        combined.sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis());
        
        setLog(combined);

      } catch (error) {
        console.error("Error fetching logs: ", error);
        toast({ title: 'Error', description: 'Failed to fetch combined log for this project.', variant: 'destructive' });
      }
      setIsLoading(false);
    };
    fetchLogs();
  }, [projectSlug, toast]);
  
  const handleViewDetails = (entry: CombinedLogEntry) => {
    if (entry.type === 'JMC') {
        setSelectedJmc(entry as JmcEntry);
        setIsJmcViewOpen(true);
    } else {
        setSelectedMvac(entry as MvacEntry);
        setIsMvacViewOpen(true);
    }
  };
  
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);
  }

  const getTotalAmount = (entry: CombinedLogEntry) => {
    return entry.items.reduce((sum: number, item: any) => sum + parseFloat(item.totalAmount || '0'), 0);
  }

  const getDate = (entry: CombinedLogEntry) => {
    const date = (entry as JmcEntry).jmcDate || (entry as MvacEntry).mvacDate;
    if (!date) return 'N/A';
    try {
        return format(new Date(date), 'dd MMM, yyyy');
    } catch {
        return 'Invalid Date';
    }
  }

  return (
    <>
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link href={`/billing-recon/${projectSlug}`}>
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-6 w-6" />
              </Button>
            </Link>
            <h1 className="text-2xl font-bold">Combined JMC & MVAC Log</h1>
          </div>
        </div>
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Number</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>No. of Items</TableHead>
                  <TableHead>Total Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 10 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-6 w-20" /></TableCell>
                      <TableCell className="text-right"><Skeleton className="h-8 w-8 ml-auto" /></TableCell>
                    </TableRow>
                  ))
                ) : log.length > 0 ? (
                  log.map((entry) => (
                    <TableRow key={entry.id} onClick={() => handleViewDetails(entry)} className="cursor-pointer">
                      <TableCell>
                        <Badge variant={entry.type === 'JMC' ? 'default' : 'secondary'}>{entry.type}</Badge>
                      </TableCell>
                      <TableCell className="font-medium">{(entry as JmcEntry).jmcNo || (entry as MvacEntry).mvacNo}</TableCell>
                      <TableCell>{getDate(entry)}</TableCell>
                      <TableCell>{entry.items.length}</TableCell>
                      <TableCell>{formatCurrency(getTotalAmount(entry))}</TableCell>
                      <TableCell>{entry.status}</TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon" onClick={() => handleViewDetails(entry)}>
                          <View className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center h-24">
                      No JMC or MVAC entries found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <ViewJmcEntryDialog
        isOpen={isJmcViewOpen}
        onOpenChange={setIsJmcViewOpen}
        jmcEntry={selectedJmc}
        boqItems={[]}
        bills={[]}
      />
       <ViewMvacEntryDialog
        isOpen={isMvacViewOpen}
        onOpenChange={setIsMvacViewOpen}
        MvacEntry={selectedMvac}
        boqItems={[]}
        bills={[]}
      />
    </>
  );
}
