

'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, View, MoreHorizontal, FileSpreadsheet, Trash2, Eye, Download, Edit, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { db } from '@/lib/firebase';
import { collection, getDocs, orderBy, query, deleteDoc, doc, updateDoc, getDoc, Timestamp } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';
import { format } from 'date-fns';
import type { JmcEntry, WorkflowStep, ActionLog, BoqItem, Bill } from '@/lib/types';
import ViewJmcEntryDialog from '@/components/ViewJmcEntryDialog';
import { useParams } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { logUserActivity } from '@/lib/activity-logger';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import * as XLSX from 'xlsx';
import { UpdateCertifiedQtyDialog } from '@/components/UpdateCertifiedQtyDialog';
import { Badge } from '@/components/ui/badge';

interface EnrichedJmcEntry extends JmcEntry {
    stageDates: Record<string, string>;
    totalAmount: number;
    certifiedValue: number;
    createdAt: Timestamp;
}

export default function JmcLogPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const params = useParams();
  const projectSlug = params.project as string;
  const [jmcEntries, setJmcEntries] = useState<EnrichedJmcEntry[]>([]);
  const [workflowSteps, setWorkflowSteps] = useState<WorkflowStep[]>([]);
  const [boqItems, setBoqItems] = useState<BoqItem[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedEntry, setSelectedEntry] = useState<EnrichedJmcEntry | null>(null);
  const [isViewOpen, setIsViewOpen] = useState(false);
  const [isCertifyOpen, setIsCertifyOpen] = useState(false);

  const fetchJmcEntries = async () => {
    if (!projectSlug) return;
    setIsLoading(true);
    try {
        const [workflowSnap, boqSnap, billsSnap, jmcSnapshot] = await Promise.all([
          getDoc(doc(db, 'workflows', 'jmc-workflow')),
          getDocs(query(collection(db, 'projects', projectSlug, 'boqItems'))),
          getDocs(query(collection(db, 'projects', projectSlug, 'bills'))),
          getDocs(query(collection(db, 'projects', projectSlug, 'jmcEntries'), orderBy('createdAt', 'desc'))),
        ]);

        const steps = workflowSnap.exists() ? workflowSnap.data().steps as WorkflowStep[] : [];
        setWorkflowSteps(steps);
        setBoqItems(boqSnap.docs.map(d => ({id: d.id, ...d.data()}) as BoqItem));
        setBills(billsSnap.docs.map(d => ({id: d.id, ...d.data()}) as Bill));

        const entries = jmcSnapshot.docs.map(doc => {
            const data = doc.data();
            const history = (data.history || []) as ActionLog[];
            const stageDates: Record<string, string> = {};

            steps.forEach(step => {
                const completionLog = history.find(h => h.stepName === step.name && ['Approve', 'Complete', 'Verified'].includes(h.action));
                if (completionLog) {
                    stageDates[step.name] = format(completionLog.timestamp.toDate(), 'dd-MM-yyyy');
                } else {
                    stageDates[step.name] = '-';
                }
            });

            return {
              id: doc.id,
              ...data,
              createdAt: data.createdAt,
              totalAmount: data.items.reduce((sum: number, item: any) => sum + parseFloat(item.totalAmount || '0'), 0),
              certifiedValue: data.items.reduce((sum: number, item: any) => sum + ((item.certifiedQty || 0) * (item.rate || 0)), 0),
              stageDates,
            } as EnrichedJmcEntry;
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
  
  const handleViewDetails = (entry: EnrichedJmcEntry) => {
    setSelectedEntry(entry);
    setIsViewOpen(true);
  };

  const handleExportAll = () => {
    const dataToExport = jmcEntries.map(entry => {
        const row: Record<string, any> = {
            'JMC No.': entry.jmcNo,
            'JMC Date': format(entry.createdAt.toDate(), 'dd MMM, yyyy'),
        };
        workflowSteps.forEach(step => {
            row[step.name] = entry.stageDates[step.name] || '-';
        });
        row['JMC Value'] = entry.totalAmount;
        row['Certified Value'] = entry.certifiedValue;
        row['Stage'] = entry.stage;
        row['Status'] = entry.status;
        return row;
    });

    const worksheet = XLSX.utils.json_to_sheet(dataToExport);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "JMC Workflow Log");

    // Adjust column widths
    const colWidths = Object.keys(dataToExport[0] || {}).map(key => ({
        wch: Math.max(15, key.length, ...dataToExport.map(row => String(row[key] || '').length))
    }));
    worksheet['!cols'] = colWidths;

    XLSX.writeFile(workbook, `jmc_workflow_log_${projectSlug}.xlsx`);
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
                  <TableHead>JMC Date</TableHead>
                  {workflowSteps.map(step => (
                      <TableHead key={step.id}>{step.name}</TableHead>
                  ))}
                  <TableHead>JMC Value</TableHead>
                  <TableHead>Certified Value</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>Stage Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={7 + workflowSteps.length}><Skeleton className="h-5" /></TableCell>
                    </TableRow>
                  ))
                ) : jmcEntries.length > 0 ? (
                  jmcEntries.map((entry) => {
                    return (
                        <TableRow key={entry.id} onClick={() => handleViewDetails(entry)} className="cursor-pointer">
                          <TableCell className="font-medium">{entry.jmcNo}</TableCell>
                          <TableCell>{format(entry.createdAt.toDate(), 'dd MMM, yyyy')}</TableCell>
                          {workflowSteps.map(step => (
                            <TableCell key={step.id}>{entry.stageDates[step.name]}</TableCell>
                          ))}
                          <TableCell>{formatCurrency(entry.totalAmount)}</TableCell>
                          <TableCell>{formatCurrency(entry.certifiedValue)}</TableCell>
                          <TableCell>{entry.stage}</TableCell>
                          <TableCell>
                            <Badge variant={entry.status === 'Completed' ? 'default' : (entry.status === 'Rejected' || entry.status === 'Cancelled' ? 'destructive' : 'secondary')}>
                              {entry.status}
                            </Badge>
                          </TableCell>
                        </TableRow>
                    )
                })
                ) : (
                  <TableRow>
                    <TableCell colSpan={7 + workflowSteps.length} className="text-center h-24">
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
        boqItems={boqItems}
        bills={bills}
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
