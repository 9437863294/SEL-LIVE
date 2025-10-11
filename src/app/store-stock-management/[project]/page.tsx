
'use client';

import { useState, useEffect, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { InventoryLog, Project } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { DollarSign, Archive, ArchiveX } from 'lucide-react';


export default function ProjectDashboardPage() {
  const params = useParams();
  const projectSlug = params.project as string;
  const { toast } = useToast();

  const [inventoryLogs, setInventoryLogs] = useState<InventoryLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!projectSlug) return;
    const fetchData = async () => {
        setIsLoading(true);
        try {
            const projectsQuery = query(collection(db, 'projects'));
            const projectsSnapshot = await getDocs(projectsQuery);
            const slugify = (text: string) => text.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]+/g, '');
            const projectData = projectsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project)).find(p => slugify(p.projectName) === projectSlug);

            if (!projectData) {
                toast({ title: "Error", description: "Project not found.", variant: "destructive" });
                setIsLoading(false);
                return;
            }

            const inventoryQuery = query(collection(db, 'inventoryLogs'), where('projectId', '==', projectData.id));
            const inventorySnapshot = await getDocs(inventoryQuery);
            const inventoryData = inventorySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as InventoryLog));
            setInventoryLogs(inventoryData);

        } catch (error) {
            console.error("Error fetching dashboard data:", error);
            toast({ title: 'Error', description: 'Failed to fetch dashboard data.', variant: 'destructive' });
        }
        setIsLoading(false);
    };
    fetchData();
  }, [projectSlug, toast]);

  const dashboardStats = useMemo(() => {
    if (inventoryLogs.length === 0) {
      return { totalStockValue: 0, itemsInStock: 0, lowStockItems: 0 };
    }

    const itemBalances = new Map<string, { balance: number; value: number }>();

    inventoryLogs.forEach(log => {
      const current = itemBalances.get(log.itemId) || { balance: 0, value: 0 };
      const quantity = log.transactionType === 'Goods Receipt' ? log.availableQuantity : -log.quantity;
      current.balance += quantity;
      current.value += quantity * (log.cost || 0);
      itemBalances.set(log.itemId, current);
    });
    
    let totalStockValue = 0;
    let itemsInStock = 0;
    let lowStockItems = 0;
    const LOW_STOCK_THRESHOLD = 10;

    itemBalances.forEach(item => {
        totalStockValue += item.value;
        if (item.balance > 0) {
            itemsInStock++;
            if(item.balance < LOW_STOCK_THRESHOLD) {
                lowStockItems++;
            }
        }
    });

    return { totalStockValue, itemsInStock, lowStockItems };
  }, [inventoryLogs]);
  
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);
  };

  return (
    <div>
      <h1 className="text-3xl font-bold mb-6">Dashboard</h1>
       <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Stock Value</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-8 w-32" /> : <div className="text-2xl font-bold">{formatCurrency(dashboardStats.totalStockValue)}</div>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Items in Stock</CardTitle>
            <Archive className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
             {isLoading ? <Skeleton className="h-8 w-24" /> : <div className="text-2xl font-bold">{dashboardStats.itemsInStock}</div>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Low Stock Items</CardTitle>
             <ArchiveX className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-8 w-16" /> : <div className="text-2xl font-bold">{dashboardStats.lowStockItems}</div>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
