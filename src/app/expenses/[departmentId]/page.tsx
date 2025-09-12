
'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import type { Department } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';

export default function DepartmentExpensesPage() {
  const params = useParams();
  const { toast } = useToast();
  const departmentId = params.departmentId as string;

  const [department, setDepartment] = useState<Department | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!departmentId) return;

    const fetchDepartment = async () => {
      setIsLoading(true);
      try {
        const docRef = doc(db, 'departments', departmentId);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setDepartment({ id: docSnap.id, ...docSnap.data() } as Department);
        } else {
          toast({ title: 'Error', description: 'Department not found.', variant: 'destructive' });
        }
      } catch (error) {
        console.error("Error fetching department:", error);
        toast({ title: 'Error', description: 'Failed to fetch department details.', variant: 'destructive' });
      }
      setIsLoading(false);
    };

    fetchDepartment();
  }, [departmentId, toast]);

  if (isLoading) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center gap-2">
          <Skeleton className="h-10 w-10" />
          <Skeleton className="h-8 w-64" />
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center gap-2">
        <Link href="/expenses">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-6 w-6" />
          </Button>
        </Link>
        <h1 className="text-2xl font-bold">
          {department ? `${department.name} Department Expenses` : 'Department Expenses'}
        </h1>
      </div>
      <div className="text-center py-20 border-2 border-dashed rounded-lg">
        <p className="text-muted-foreground">Expense management tools for this department will be here.</p>
      </div>
    </div>
  );
}
