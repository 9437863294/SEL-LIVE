
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, View } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { db } from '@/lib/firebase';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';
import { format } from 'date-fns';
import type { Bill } from '@/lib/types';
import ViewBillDialog from '@/components/subcontractors-management/ViewBillDialog';
import { useParams } from 'next/navigation';


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
        const q = query(collection(db, 'projects', projectSlug, 'bills'), orderBy('createdAt', 'desc'));
        const querySnapshot = await getDocs(q);
        const entries = querySnapshot.docs.map(doc => {
          const data = doc.data();
          return {
            id: doc.id,
            ...data,
            billDate: format(new Date(data.billDate), 'dd MMM, yyyy'),
            totalAmount: data.items.reduce((sum: number, item: any) => sum + parseFloat(item.totalAmount || '0'), 0)
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
            <Link href={`/billing-recon/${projectSlug}/billing`}>
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
                  <TableHead>No. of Items</TableHead>
                  <TableHead>Total Amount</TableHead>
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
                      <TableCell className="text-right"><Skeleton className="h-8 w-8 ml-auto" /></TableCell>
                    </TableRow>
                  ))
                ) : bills.length > 0 ? (
                  bills.map((bill) => (
                    <TableRow key={bill.id} onClick={() => handleViewDetails(bill)} className="cursor-pointer">
                      <TableCell className="font-medium">{bill.billNo}</TableCell>
                      <TableCell>{bill.billDate}</TableCell>
                      <TableCell>{bill.workOrderNo}</TableCell>
                      <TableCell>{bill.items.length}</TableCell>
                      <TableCell>{formatCurrency(bill.totalAmount || 0)}</TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon" onClick={() => handleViewDetails(bill)}>
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
