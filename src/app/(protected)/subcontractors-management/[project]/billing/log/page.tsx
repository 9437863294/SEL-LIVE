
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, View } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { db } from '@/lib/firebase';
import { collection, getDocs, orderBy, query, where, collectionGroup } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';
import { format } from 'date-fns';
import type { Bill, Project } from '@/lib/types';
import ViewBillDialog from '@/components/ViewBillDialog';
import { useParams } from 'next/navigation';
import { Badge } from '@/components/ui/badge';

const slugify = (text: string) => {
  if (!text) return '';
  return text.toString().toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
}

export default function BillLogPage() {
  const { toast } = useToast();
  const params = useParams();
  const projectSlug = params.project as string;
  const [bills, setBills] = useState<Bill[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedBill, setSelectedBill] = useState<Bill | null>(null);
  const [isViewOpen, setIsViewOpen] = useState(false);

  useEffect(() => {
    const fetchBills = async () => {
      if (!projectSlug) return;
      setIsLoading(true);
      try {
        let billsQuery;

        if (projectSlug === 'all') {
            billsQuery = query(collectionGroup(db, 'bills'), orderBy('createdAt', 'desc'));
        } else {
            const projectsQuery = query(collection(db, 'projects'));
            const projectSnap = await getDocs(projectsQuery);
            
            const project = projectSnap.docs
                .map(doc => ({ id: doc.id, ...doc.data() } as Project))
                .find(p => slugify(p.projectName) === projectSlug);

            if (!project) {
                console.error("Project not found for slug:", projectSlug);
                toast({ title: 'Error', description: `Project with slug "${projectSlug}" not found.`, variant: 'destructive' });
                setIsLoading(false);
                return;
            }
            const projectId = project.id;
            billsQuery = query(collection(db, 'projects', projectId, 'bills'), orderBy('createdAt', 'desc'));
        }
        
        const querySnapshot = await getDocs(billsQuery);
        const entries = querySnapshot.docs.map(doc => {
          const data = doc.data();
          return {
            id: doc.id,
            ...data,
            billDate: format(new Date(data.billDate), 'dd MMM, yyyy'),
            totalAmount: data.totalAmount || data.items.reduce((sum: number, item: any) => sum + parseFloat(item.totalAmount || '0'), 0)
          } as Bill;
        });
        setBills(entries);

      } catch (error) {
        console.error("Error fetching bills: ", error);
        toast({ title: 'Error', description: 'Failed to fetch bills for this project.', variant: 'destructive' });
      }
      setIsLoading(false);
    };
    fetchBills();
  }, [projectSlug, toast]);
  
  const handleViewDetails = (bill: Bill) => {
    setSelectedBill(bill);
    setIsViewOpen(true);
  };
  
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);
  }

  return (
    <>
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link href={`/subcontractors-management/${projectSlug}/billing`}>
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-6 w-6" />
              </Button>
            </Link>
            <h1 className="text-2xl font-bold">Billing Log</h1>
          </div>
        </div>
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bill No.</TableHead>
                  <TableHead>Bill Date</TableHead>
                  <TableHead>Work Order No.</TableHead>
                  <TableHead>Net Payable</TableHead>
                  <TableHead>Deducted Advances</TableHead>
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
                      <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                      <TableCell className="text-right"><Skeleton className="h-8 w-8 ml-auto" /></TableCell>
                    </TableRow>
                  ))
                ) : bills.length > 0 ? (
                  bills.map((bill) => (
                    <TableRow key={bill.id} onClick={() => handleViewDetails(bill)} className="cursor-pointer">
                      <TableCell className="font-medium">{bill.billNo}</TableCell>
                      <TableCell>{bill.billDate}</TableCell>
                      <TableCell>{bill.woNo}</TableCell>
                      <TableCell>{formatCurrency(bill.netPayable || 0)}</TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1 items-start">
                          {(bill.advanceDeductions && bill.advanceDeductions.length > 0) ? (
                            bill.advanceDeductions.map(adv => (
                              <Badge key={adv.id} variant="secondary">
                                {adv.reference}: {formatCurrency(adv.amount)}
                              </Badge>
                            ))
                          ) : (
                            <span className="text-xs text-muted-foreground">None</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon" onClick={(e) => {e.stopPropagation(); handleViewDetails(bill)}}>
                          <View className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center h-24">
                      No bills found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <ViewBillDialog
        isOpen={isViewOpen}
        onOpenChange={setIsViewOpen}
        bill={selectedBill}
      />
    </>
  );
}
