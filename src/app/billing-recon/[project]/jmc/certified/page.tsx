
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, FileSpreadsheet, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { db } from '@/lib/firebase';
import { collection, getDocs, orderBy, query, where } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';
import { format } from 'date-fns';
import type { JmcEntry } from '@/lib/types';
import ViewJmcEntryDialog from '@/components/ViewJmcEntryDialog';
import { useParams } from 'next/navigation';
import * as XLSX from 'xlsx';

export default function CertifiedJmcLogPage() {
  const { toast } = useToast();
  const params = useParams();
  const projectSlug = params.project as string;
  const [certifiedEntries, setCertifiedEntries] = useState<JmcEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchCertifiedEntries = async () => {
      if (!projectSlug) return;
      setIsLoading(true);
      try {
        const jmcCollectionRef = collection(db, 'projects', projectSlug, 'jmcEntries');
        // Fetch all documents and filter client-side to avoid indexing issues
        const querySnapshot = await getDocs(jmcCollectionRef);
        const entries = querySnapshot.docs.map(doc => {
          const data = doc.data();
          const isCertified = data.items.some((item: any) => typeof item.certifiedQty === 'number' && item.certifiedQty > 0);
          
          if (data.status === 'Certified' || isCertified) {
            return {
              id: doc.id,
              ...data,
              createdAt: data.createdAt ? format(new Date(data.createdAt), 'dd MMM yyyy') : 'N/A',
              totalAmount: data.items.reduce((sum: number, item: any) => sum + parseFloat(item.totalAmount || '0'), 0),
              certifiedValue: data.items.reduce((sum: number, item: any) => sum + ((item.certifiedQty || 0) * (item.rate || 0)), 0),
            } as JmcEntry;
          }
          return null;
        }).filter((entry): entry is JmcEntry => entry !== null);
        
        // Sort after filtering
        entries.sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

        setCertifiedEntries(entries);
      } catch (error) {
        console.error("Error fetching certified JMCs: ", error);
        toast({ title: 'Error', description: 'Failed to fetch certified JMC entries.', variant: 'destructive' });
      }
      setIsLoading(false);
    };
    fetchCertifiedEntries();
  }, [projectSlug, toast]);
  
  const handleExportAll = () => {
    const flattenedData = certifiedEntries.flatMap(entry => 
      entry.items.map(item => ({
        'JMC No': entry.jmcNo,
        'WO No': entry.woNo,
        'JMC Date': entry.jmcDate,
        'BOQ Sl. No.': item.boqSlNo,
        'Description': item.description,
        'Unit': item.unit,
        'Rate': item.rate,
        'Executed Qty': item.executedQty,
        'Certified Qty': item.certifiedQty,
        'Total Amount': item.totalAmount,
      }))
    );

    const worksheet = XLSX.utils.json_to_sheet(flattenedData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Certified JMC Log");
    XLSX.writeFile(workbook, `certified_jmc_log_${projectSlug}.xlsx`);
  };
  
  const formatCurrency = (amount: number) => {
    if (isNaN(amount)) return 'N/A';
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link href={`/billing-recon/${projectSlug}/jmc`}>
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-6 w-6" />
              </Button>
            </Link>
            <h1 className="text-2xl font-bold">Certified JMC Log</h1>
          </div>
           <Button onClick={handleExportAll} disabled={certifiedEntries.length === 0}>
              <Download className="mr-2 h-4 w-4" /> Export All as Excel
          </Button>
        </div>
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>JMC No.</TableHead>
                  <TableHead>Bill Date</TableHead>
                  <TableHead>Work Order No.</TableHead>
                  <TableHead>No. of Items</TableHead>
                  <TableHead>Total Value</TableHead>
                  <TableHead>Certified Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={6}><Skeleton className="h-5" /></TableCell>
                    </TableRow>
                  ))
                ) : certifiedEntries.length > 0 ? (
                  certifiedEntries.map((entry) => (
                    <TableRow key={entry.id} className="cursor-pointer">
                      <TableCell className="font-medium">{entry.jmcNo}</TableCell>
                      <TableCell>{format(new Date(entry.jmcDate), 'dd MMM, yyyy')}</TableCell>
                      <TableCell>{entry.woNo}</TableCell>
                      <TableCell>{entry.items.length}</TableCell>
                      <TableCell>{formatCurrency(entry.totalAmount || 0)}</TableCell>
                      <TableCell>{formatCurrency(entry.certifiedValue || 0)}</TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center h-24">
                      No certified JMC entries found.
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
