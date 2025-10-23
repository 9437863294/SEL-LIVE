

'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, View, MoreHorizontal, FileSpreadsheet, Trash2, Eye, Download, Edit, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { db } from '@/lib/firebase';
import { collection, getDocs, orderBy, query, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';
import { format } from 'date-fns';
import type { JmcEntry } from '@/lib/types';
import ViewJmcEntryDialog from '@/components/ViewJmcEntryDialog';
import { useParams } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { logUserActivity } from '@/lib/activity-logger';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import * as XLSX from 'xlsx';
import { UpdateCertifiedQtyDialog } from '@/components/UpdateCertifiedQtyDialog';
import { Badge } from '@/components/ui/badge';


export default function JmcLogPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const params = useParams();
  const projectSlug = params.project as string;
  const [jmcEntries, setJmcEntries] = useState<JmcEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedEntry, setSelectedEntry] = useState<JmcEntry | null>(null);
  const [isViewOpen, setIsViewOpen] = useState(false);
  const [isCertifyOpen, setIsCertifyOpen] = useState(false);

  const fetchJmcEntries = async () => {
    if (!projectSlug) return;
    setIsLoading(true);
    try {
      const jmcCollectionRef = collection(db, 'projects', projectSlug, 'jmcEntries');
      const q = query(jmcCollectionRef, orderBy('createdAt', 'desc'));
      const querySnapshot = await getDocs(q);
      const entries = querySnapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          createdAt: data.createdAt ? format(new Date(data.createdAt), 'dd MMM yyyy') : 'N/A',
          totalAmount: data.items.reduce((sum: number, item: any) => sum + parseFloat(item.totalAmount || '0'), 0),
          certifiedValue: data.items.reduce((sum: number, item: any) => sum + ((item.certifiedQty || 0) * (item.rate || 0)), 0),
        } as JmcEntry;
      });
      setJmcEntries(entries);
    } catch (error) {
      console.error("Error fetching JMC entries: ", error);
      toast({ title: 'Error', description: 'Failed to fetch JMC entries for this project.', variant: 'destructive' });
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchJmcEntries();
  }, [projectSlug, toast]);
  
  const handleViewDetails = (entry: JmcEntry) => {
    setSelectedEntry(entry);
    setIsViewOpen(true);
  };

  const handleOpenCertifyDialog = (entry: JmcEntry) => {
    setSelectedEntry(entry);
    setIsCertifyOpen(true);
  };
  
  const handleDelete = async (entry: JmcEntry) => {
    if (!user) return;
    try {
      await deleteDoc(doc(db, 'projects', projectSlug, 'jmcEntries', entry.id));
      await logUserActivity({
        userId: user.id,
        action: 'Delete JMC Entry',
        details: { project: projectSlug, jmcNo: entry.jmcNo }
      });
      toast({ title: 'Success', description: 'JMC entry deleted successfully.' });
      fetchJmcEntries();
    } catch (error) {
      console.error("Error deleting JMC entry:", error);
      toast({ title: 'Error', description: 'Failed to delete JMC entry.', variant: 'destructive' });
    }
  };

  const handleCancelJmc = async (entry: JmcEntry) => {
    if (!user) return;
    try {
        const entryRef = doc(db, 'projects', projectSlug, 'jmcEntries', entry.id);
        await updateDoc(entryRef, { status: 'Cancelled' });
        await logUserActivity({
            userId: user.id,
            action: 'Cancel JMC Entry',
            details: { project: projectSlug, jmcNo: entry.jmcNo }
        });
        toast({ title: 'Success', description: 'JMC entry has been cancelled.'});
        fetchJmcEntries();
    } catch (error) {
        console.error("Error cancelling JMC:", error);
        toast({ title: 'Error', description: 'Failed to cancel JMC entry.', variant: 'destructive' });
    }
  };

  const handleExportAll = () => {
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
        'Certified Qty': item.certifiedQty,
        'Total Amount': item.totalAmount,
      }))
    );

    const worksheet = XLSX.utils.json_to_sheet(flattenedData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "JMC Log");
    XLSX.writeFile(workbook, `jmc_log_${projectSlug}.xlsx`);
  };

  const handleExportSingle = (entry: JmcEntry) => {
    const flattenedData = entry.items.map(item => ({
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
    }));
    
    const worksheet = XLSX.utils.json_to_sheet(flattenedData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, `JMC ${entry.jmcNo}`);
    XLSX.writeFile(workbook, `jmc_${projectSlug}_${entry.jmcNo}.xlsx`);
  };
  
  const formatCurrency = (amount: number) => {
    if (isNaN(amount)) return 'N/A';
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);
  }

  return (
    <>
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link href={`/billing-recon/${projectSlug}/jmc`}>
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-6 w-6" />
              </Button>
            </Link>
            <h1 className="text-2xl font-bold">JMC Log</h1>
          </div>
           <Button onClick={handleExportAll} disabled={jmcEntries.length === 0}>
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
                  <TableHead>Certified Status</TableHead>
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
                      <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-6 w-20" /></TableCell>
                      <TableCell className="text-right"><Skeleton className="h-8 w-8 ml-auto" /></TableCell>
                    </TableRow>
                  ))
                ) : jmcEntries.length > 0 ? (
                  jmcEntries.map((entry) => {
                    const isCertified = entry.items.some(item => typeof item.certifiedQty === 'number');
                    let status: 'Certified' | 'Pending' | 'Cancelled' = 'Pending';
                    if (entry.status === 'Cancelled') {
                        status = 'Cancelled';
                    } else if (isCertified) {
                        status = 'Certified';
                    }

                    return (
                        <TableRow key={entry.id} onClick={() => handleViewDetails(entry)} className="cursor-pointer">
                          <TableCell className="font-medium">{entry.jmcNo}</TableCell>
                          <TableCell>{format(new Date(entry.jmcDate), 'dd MMM, yyyy')}</TableCell>
                          <TableCell>{entry.woNo}</TableCell>
                          <TableCell>{entry.items.length}</TableCell>
                          <TableCell>{formatCurrency(entry.totalAmount || 0)}</TableCell>
                          <TableCell>{formatCurrency(entry.certifiedValue || 0)}</TableCell>
                          <TableCell>
                            <Badge variant={status === 'Certified' ? 'default' : (status === 'Cancelled' ? 'destructive' : 'secondary')}>
                              {status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <AlertDialog>
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button variant="ghost" className="h-8 w-8 p-0" onClick={(e) => e.stopPropagation()}>
                                            <span className="sr-only">Open menu</span>
                                            <MoreHorizontal className="h-4 w-4" />
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleViewDetails(entry) }}>
                                            <Eye className="mr-2 h-4 w-4" /> View Details
                                        </DropdownMenuItem>
                                         <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleOpenCertifyDialog(entry) }} disabled={isCertified}>
                                            <Edit className="mr-2 h-4 w-4" /> Update Certified Qty
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleExportSingle(entry); }}>
                                            <FileSpreadsheet className="mr-2 h-4 w-4" /> Export to Excel
                                        </DropdownMenuItem>
                                        <DropdownMenuSeparator />
                                        <AlertDialogTrigger asChild>
                                            <DropdownMenuItem className="text-destructive" onClick={(e) => e.stopPropagation()}>
                                                <XCircle className="mr-2 h-4 w-4" /> Cancel JMC
                                            </DropdownMenuItem>
                                        </AlertDialogTrigger>
                                        <AlertDialogTrigger asChild>
                                            <DropdownMenuItem className="text-destructive" onClick={(e) => e.stopPropagation()}>
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
                                        <AlertDialogCancel onClick={(e) => e.stopPropagation()}>Cancel</AlertDialogCancel>
                                        <AlertDialogAction onClick={(e) => { e.stopPropagation(); handleDelete(entry); }}>Delete</AlertDialogAction>
                                    </AlertDialogFooter>
                                </AlertDialogContent>
                            </AlertDialog>
                          </TableCell>
                        </TableRow>
                    )
                })
                ) : (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center h-24">
                      No JMC entries found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <ViewJmcEntryDialog
        isOpen={isViewOpen}
        onOpenChange={setIsViewOpen}
        jmcEntry={selectedEntry}
      />
      {selectedEntry && (
        <UpdateCertifiedQtyDialog
            isOpen={isCertifyOpen}
            onOpenChange={setIsCertifyOpen}
            jmcEntry={selectedEntry}
            projectSlug={projectSlug}
            onSaveSuccess={fetchJmcEntries}
        />
      )}
    </>
  );
}
