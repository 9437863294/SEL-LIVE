
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Home, Plus } from 'lucide-react';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import type { LcEntry } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { useRouter } from 'next/navigation';

export default function LcModulePage() {
  const { toast } = useToast();
  const router = useRouter();
  const [lcs, setLcs] = useState<LcEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchLcs = async () => {
      setIsLoading(true);
      try {
        const q = query(collection(db, 'lcs'), orderBy('createdAt', 'desc'));
        const querySnapshot = await getDocs(q);
        setLcs(querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as LcEntry)));
      } catch (error) {
        console.error("Error fetching LCs:", error);
        toast({ title: 'Error', description: 'Failed to fetch Letters of Credit.', variant: 'destructive' });
      }
      setIsLoading(false);
    };
    fetchLcs();
  }, [toast]);
  
  const handleRowClick = (lcId: string) => {
    router.push(`/lc-module/${lcId}`);
  };
  
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);
  };
  
  return (
    <div className="w-full px-4 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
            <Link href="/">
                <Button variant="ghost" size="icon">
                    <Home className="h-6 w-6" />
                </Button>
            </Link>
            <h1 className="text-xl font-bold">LC Module Dashboard</h1>
        </div>
        <Link href="/lc-module/new">
            <Button>
                <Plus className="mr-2 h-4 w-4" /> Open New LC
            </Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
            <CardTitle>Letters of Credit</CardTitle>
            <CardDescription>A list of all opened Letters of Credit.</CardDescription>
        </CardHeader>
        <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>LC No.</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={4}><Skeleton className="h-6" /></TableCell>
                    </TableRow>
                  ))
                ) : lcs.length > 0 ? (
                  lcs.map(lc => (
                    <TableRow key={lc.id} onClick={() => handleRowClick(lc.id)} className="cursor-pointer">
                      <TableCell>{lc.lcNo}</TableCell>
                      <TableCell>{lc.vendor}</TableCell>
                      <TableCell>{formatCurrency(lc.lcAmount)}</TableCell>
                      <TableCell><Badge variant={lc.status === 'Opened' ? 'default' : 'secondary'}>{lc.status}</Badge></TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={4} className="h-24 text-center">No LCs found.</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
        </CardContent>
      </Card>
    </div>
  );
}
