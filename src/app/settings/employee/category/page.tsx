
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, RefreshCw, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { Skeleton } from '@/components/ui/skeleton';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { syncGreytHRCategories } from '@/ai';

interface Category {
    id: number;
    name: string;
    type: string;
}

export default function ManageCategoryPage() {
  const { toast } = useToast();
  const [categoriesByType, setCategoriesByType] = useState<Record<string, Category[]>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);

  const fetchCategories = async () => {
    setIsLoading(true);
    try {
      const q = query(collection(db, 'categories'), orderBy('type'), orderBy('name'));
      const querySnapshot = await getDocs(q);
      const categoriesData = querySnapshot.docs.map(doc => doc.data() as Category);
      
      const grouped = categoriesData.reduce((acc, category) => {
        const { type } = category;
        if (!acc[type]) {
          acc[type] = [];
        }
        acc[type].push(category);
        return acc;
      }, {} as Record<string, Category[]>);

      setCategoriesByType(grouped);
    } catch (error) {
      console.error("Error fetching categories: ", error);
      toast({
        title: 'Error',
        description: 'Failed to fetch categories.',
        variant: 'destructive',
      });
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchCategories();
  }, []);
  
  const handleSync = async () => {
    setIsSyncing(true);
    try {
      const result = await syncGreytHRCategories();
      if (result.success) {
        const countSummary = Object.entries(result.counts)
          .map(([key, value]) => `${value} ${key}s`)
          .join(', ');
        toast({
            title: 'Sync Successful',
            description: `Synced: ${countSummary || 'No new data.'}`,
        });
        fetchCategories(); // Refresh the list
      } else {
        throw new Error(result.message);
      }
    } catch (error: any) {
        toast({
            title: 'Sync Failed',
            description: error.message,
            variant: 'destructive',
        });
    } finally {
        setIsSyncing(false);
    }
  };

  const renderTable = (data: Category[]) => (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>Name</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-3/4" /></TableCell>
                </TableRow>
              ))
            ) : data.length > 0 ? (
              data.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>{item.id}</TableCell>
                  <TableCell className="font-medium">{item.name}</TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={2} className="text-center h-24">
                  No items found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );

  return (
    <div className="w-full max-w-4xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
            <Link href="/settings/employee">
            <Button variant="ghost" size="icon">
                <ArrowLeft className="h-6 w-6" />
            </Button>
            </Link>
            <h1 className="text-2xl font-bold">Synced Categories</h1>
        </div>
        <Button onClick={handleSync} disabled={isSyncing}>
            {isSyncing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Sync from GreytHR
        </Button>
      </div>
      
      {isLoading ? (
         <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
        </div>
      ) : Object.keys(categoriesByType).length > 0 ? (
        <Accordion type="multiple" defaultValue={Object.keys(categoriesByType)}>
          {Object.entries(categoriesByType).map(([type, categories]) => (
            <AccordionItem value={type} key={type}>
              <AccordionTrigger className="text-lg font-medium">
                {type} ({categories.length})
              </AccordionTrigger>
              <AccordionContent className="p-1">
                {renderTable(categories)}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      ) : (
        <Card className="text-center py-12">
            <CardContent>
                <p className="text-muted-foreground">No categories found.</p>
                <p className="text-muted-foreground text-sm">Try syncing from GreytHR to get started.</p>
            </CardContent>
        </Card>
      )}
    </div>
  );
}
