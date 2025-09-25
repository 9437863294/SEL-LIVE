
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs } from 'firebase/firestore';
import type { MainItem } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';

export default function ManageItemsPage() {
  const { toast } = useToast();
  const [mainItems, setMainItems] = useState<MainItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchItems = async () => {
      setIsLoading(true);
      try {
        const querySnapshot = await getDocs(collection(db, 'main_items'));
        const itemsData = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as MainItem));
        setMainItems(itemsData);
      } catch (error) {
        console.error("Error fetching main items:", error);
        toast({ title: 'Error', description: 'Failed to fetch main items.', variant: 'destructive' });
      }
      setIsLoading(false);
    };
    fetchItems();
  }, [toast]);

  return (
    <div className="w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/store-stock-management">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-6 w-6" />
            </Button>
          </Link>
          <h1 className="text-xl font-bold">Item Master</h1>
        </div>
        <Button disabled>
            <Plus className="mr-2 h-4 w-4" /> Add Main Item
        </Button>
      </div>

      <Card>
        <CardHeader>
            <CardTitle>Main Items</CardTitle>
            <CardDescription>List of all main items and their bill of materials.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item Name</TableHead>
                <TableHead>No. of Sub-Items in BOM</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={3}><Skeleton className="h-8" /></TableCell>
                  </TableRow>
                ))
              ) : mainItems.length > 0 ? (
                mainItems.map(item => (
                  <TableRow key={item.id}>
                    <TableCell>{item.name}</TableCell>
                    <TableCell>{item.bom?.length || 0}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" disabled>View/Edit BOM</Button>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={3} className="text-center h-24">No main items created yet.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
