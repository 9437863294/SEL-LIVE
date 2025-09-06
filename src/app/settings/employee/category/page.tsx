
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs } from 'firebase/firestore';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface Category {
    id: number;
    name: string;
    type: 'Department' | 'Designation';
}

export default function ManageCategoryPage() {
  const { toast } = useToast();
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchCategories = async () => {
      setIsLoading(true);
      try {
        const querySnapshot = await getDocs(collection(db, 'categories'));
        const categoriesData: Category[] = querySnapshot.docs.map(doc => doc.data() as Category);
        setCategories(categoriesData);
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

    fetchCategories();
  }, [toast]);

  const departments = categories.filter(c => c.type === 'Department').sort((a, b) => a.name.localeCompare(b.name));
  const designations = categories.filter(c => c.type === 'Designation').sort((a, b) => a.name.localeCompare(b.name));

  const renderTable = (data: Category[], title: string) => (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>{title} Name</TableHead>
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
                  No {title.toLowerCase()} found.
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
      <div className="mb-6 flex items-center gap-4">
        <Link href="/settings/employee">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-6 w-6" />
          </Button>
        </Link>
        <h1 className="text-2xl font-bold">Synced Categories</h1>
      </div>
      
      <Tabs defaultValue="departments">
        <TabsList>
            <TabsTrigger value="departments">Departments ({departments.length})</TabsTrigger>
            <TabsTrigger value="designations">Designations ({designations.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="departments" className="mt-4">
            {renderTable(departments, 'Department')}
        </TabsContent>
        <TabsContent value="designations" className="mt-4">
            {renderTable(designations, 'Designation')}
        </TabsContent>
      </Tabs>
    </div>
  );
}

    