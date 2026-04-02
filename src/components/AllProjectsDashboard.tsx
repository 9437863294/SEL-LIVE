
'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Clock, Users, CheckCircle, XCircle } from 'lucide-react';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Skeleton } from './ui/skeleton';
import { useEffect, useState, useMemo } from 'react';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, where } from 'firebase/firestore';
import type { Requisition } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';

interface DashboardStats {
    pendingRequisitions: number;
    completedRequisitions: number;
}

const initialStats: DashboardStats = {
    pendingRequisitions: 0,
    completedRequisitions: 0,
};

export default function AllProjectsDashboard() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const [stats, setStats] = useState<DashboardStats>(initialStats);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      try {
        const q = query(collection(db, 'requisitions'));
        const querySnapshot = await getDocs(q);
        const requisitions = querySnapshot.docs.map(doc => doc.data() as Requisition);
        
        const calculatedStats = requisitions.reduce((acc, req) => {
            if (req.status === 'Pending' || req.status === 'In Progress' || req.status === 'Needs Review') {
                acc.pendingRequisitions += 1;
            }
            if (req.status === 'Completed') {
                acc.completedRequisitions += 1;
            }
            return acc;
        }, {...initialStats});

        setStats(calculatedStats);

      } catch (error) {
        console.error("Failed to fetch dashboard stats:", error);
        toast({
            title: "Error",
            description: "Could not load dashboard summary data.",
            variant: "destructive"
        });
      }
      setIsLoading(false);
    };

    if (!isAuthLoading) {
        fetchData();
    }
  }, [isAuthLoading, toast]);
  
  const formatCurrency = (amount: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);

  const statsToDisplay = [
    { title: 'Pending Requisitions', value: stats.pendingRequisitions.toLocaleString(), icon: Clock },
    { title: 'Completed Requisitions', value: stats.completedRequisitions.toLocaleString(), icon: CheckCircle },
  ];

  return (
    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
      {isLoading ? (
        Array.from({ length: 2 }).map((_, index) => (
          <Card key={index}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <Skeleton className="h-5 w-3/5" />
              <Skeleton className="h-5 w-5 rounded-full" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-1/2" />
            </CardContent>
          </Card>
        ))
      ) : (
        statsToDisplay.map((stat, index) => (
          <Card key={index}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{stat.title}</CardTitle>
              <stat.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value}</div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
