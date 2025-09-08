
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Trash2, Eye, MoreHorizontal, FileText, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { db } from '@/lib/firebase';
import { collection, getDocs, doc, deleteDoc } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { format } from 'date-fns';
import * as XLSX from 'xlsx';

type JmcEntry = {
    id: string;
    jmcNo: string;
    woNo: string;
    jmcDate: string;
    items: any[];
    createdAt: string;
};

export default function JmcLogPage() {
  const { toast } = useToast();
  const [jmcEntries, setJmcEntries] = useState<JmcEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchJmcEntries = async () => {
    setIsLoading(true);
    try {
      const querySnapshot = await getDocs(collection(db, 'jmcEntries'));
      const entries = querySnapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          createdAt: data.createdAt ? format(new Date(data.createdAt), 'dd MMM yyyy') : 'N/A'
        } as JmcEntry;
      }).sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setJmcEntries(entries);
    } catch (error) {
      console.error("Error fetching JMC entries: ", error);
      toast({
        title: 'Error',
        description: 'Failed to fetch JMC entries.',
        variant: 'destructive',
      });
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchJmcEntries();
  }, []);

  const handleDelete = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'jmcEntries', id));
      toast({ title: 'Success', description: 'JMC entry deleted successfully.' });
      fetchJmcEntries();
    } catch (error) {
      console.error("Error deleting JMC entry:", error);
      toast({ title: 'Error', description: 'Failed to delete JMC entry.', variant: 'destructive' });
    }
  };
  
  const handleExport = () => {
    const flattenedData = jmcEntries.flatMap(entry => 
      entry.items.map(item => ({
        'JMC No': entry.jmcNo,
        'WO No': entry.woNo,
        'JMC Date': entry.jmcDate,
        'BOQ Sl. No.': item.boqSlNo,
        'Description': item.description,
        'Unit': item.unit,
        'Rate': item.rate,
        'Executed Qty': item.executedQty,
        'Total Amount': item.totalAmount,
      }))
    );

    const worksheet = XLSX.utils.json_to_sheet(flattenedData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "JMC Log");
    XLSX.writeFile(workbook, "jmc_log_export.xlsx");
  };


  return (
    <div className="w-full max-w-7xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
            <Link href="/billing-recon/tpsodl/jmc">
                <Button variant="ghost" size="icon">
                    <ArrowLeft className="h-6 w-6" />
                </Button>
            </Link>
            <h1 className="text-2xl font-bold">JMC Log</h1>
        </div>
        <Button onClick={handleExport} disabled={jmcEntries.length === 0}>
            <Download className="mr-2 h-4 w-4" /> Export as Excel
        </Button>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>JMC No.</TableHead>
                <TableHead>Work Order No.</TableHead>
                <TableHead>JMC Date</TableHead>
                <TableHead>Created At</TableHead>
                <TableHead>No. of Items</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-8 w-8 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : jmcEntries.length > 0 ? (
                jmcEntries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="font-medium">{entry.jmcNo}</TableCell>
                    <TableCell>{entry.woNo}</TableCell>
                    <TableCell>{format(new Date(entry.jmcDate), 'dd MMM, yyyy')}</TableCell>
                    <TableCell>{entry.createdAt}</TableCell>
                    <TableCell>{entry.items.length}</TableCell>
                    <TableCell className="text-right">
                        <AlertDialog>
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" className="h-8 w-8 p-0">
                                        <span className="sr-only">Open menu</span>
                                        <MoreHorizontal className="h-4 w-4" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                    <DropdownMenuItem>
                                        <Eye className="mr-2 h-4 w-4" /> View Details
                                    </DropdownMenuItem>
                                    <DropdownMenuItem>
                                        <FileText className="mr-2 h-4 w-4" /> Generate PDF
                                    </DropdownMenuItem>
                                    <AlertDialogTrigger asChild>
                                        <DropdownMenuItem className="text-destructive">
                                            <Trash2 className="mr-2 h-4 w-4" /> Delete
                                        </DropdownMenuItem>
                                    </AlertDialogTrigger>
                                </DropdownMenuContent>
                            </DropdownMenu>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                                    <AlertDialogDescription>This will permanently delete the JMC entry. This action cannot be undone.</AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => handleDelete(entry.id)}>Delete</AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={6} className="text-center h-24">
                    No JMC entries found.
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
