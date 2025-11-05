
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, View } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { db } from '@/lib/firebase';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';
import { useParams } from 'next/navigation';
import type { MvacItem } from '@/lib/types';

export default function MvacLogPage() {
  const { toast } = useToast();
  const params = useParams();
  const projectSlug = params.project as string;
  const [mvacEntries, setMvacEntries] = useState<MvacItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchMvacEntries = async () => {
      if (!projectSlug) return;
      setIsLoading(true);
      try {
        const q = query(collection(db, 'mvacItems'), where('projectSlug', '==', projectSlug));
        const querySnapshot = await getDocs(q);
        const entries = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as MvacItem));
        setMvacEntries(entries);
      } catch (error) {
        console.error("Error fetching MVAC entries: ", error);
        toast({ title: 'Error', description: 'Failed to fetch MVAC entries.', variant: 'destructive' });
      }
      setIsLoading(false);
    };
    fetchMvacEntries();
  }, [projectSlug, toast]);
  
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
                  <TableHead>WO No.</TableHead>
                  <TableHead>BOQ Sl. No.</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Total BOQ Qty</TableHead>
                  <TableHead>Rate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={5}><Skeleton className="h-5" /></TableCell>
                    </TableRow>
                  ))
                ) : mvacEntries.length > 0 ? (
                  mvacEntries.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell>{entry['WO']}</TableCell>
                      <TableCell>{entry['BOQ Sl. No.']}</TableCell>
                      <TableCell>{entry['Description']}</TableCell>
                      <TableCell>{entry['Total BOQ Qty']}</TableCell>
                      <TableCell>{entry['Rate']}</TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center h-24">
                      No MVAC entries found for this project.
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
