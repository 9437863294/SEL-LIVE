
'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, RefreshCw, ShieldAlert, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { getAllEmployeePositions } from '@/ai';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import type { EmployeePosition } from '@/lib/types';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, orderBy, getDoc, doc } from 'firebase/firestore';
import { formatDistanceToNow } from 'date-fns';

export default function EmployeePositionDetailsPage() {
  const { toast } = useToast();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  
  const [allPositions, setAllPositions] = useState<EmployeePosition[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState<string | null>(null);

  const [filters, setFilters] = useState({
    employeeId: '',
    category: 'all',
  });
  
  const canView = can('View', 'Settings.Employee Management');
  const canSync = can('Sync from GreytHR', 'Settings.Employee Management');

  const fetchPositionsFromDb = useCallback(async () => {
    setIsLoading(true);
    try {
        const q = query(collection(db, 'employeePositions'));
        const snapshot = await getDocs(q);
        const data = snapshot.docs.map(doc => doc.data() as EmployeePosition);
        setAllPositions(data);
        
        const settingsDoc = await getDoc(doc(db, 'settings', 'employeePositionSync'));
        if (settingsDoc.exists()) {
            const syncTime = settingsDoc.data().lastSynced;
            setLastSynced(formatDistanceToNow(new Date(syncTime), { addSuffix: true }));
        }

    } catch (error: any) {
        console.error("Error fetching positions from Firestore:", error);
    } finally {
        setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (isAuthLoading) return;
    if (canView) {
      fetchPositionsFromDb();
    }
  }, [isAuthLoading, canView, fetchPositionsFromDb]);

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      const result = await getAllEmployeePositions({});
      if (result.success) {
        toast({ title: 'Sync Successful', description: result.message });
        await fetchPositionsFromDb(); // Refresh data from Firestore
      } else {
        throw new Error(result.message);
      }
    } catch (error: any) {
      toast({
        title: 'Sync Failed',
        description: error.message || 'Could not sync position details.',
        variant: 'destructive',
      });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleFilterChange = (field: keyof typeof filters, value: string) => {
    setFilters(prev => ({ ...prev, [field]: value }));
  };

  const clearFilters = () => {
    setFilters({ employeeId: '', category: 'all' });
  };
  
  const uniqueCategories = useMemo(() => {
    const categories = new Set<string>();
    allPositions.forEach(pos => {
      pos.categoryList.forEach(cat => {
        if(cat.category) categories.add(cat.category);
      });
    });
    return Array.from(categories).sort();
  }, [allPositions]);

  const filteredPositions = useMemo(() => {
    return allPositions.map(pos => {
        const filteredCategoryList = pos.categoryList.filter(cat => {
            const categoryMatch = filters.category === 'all' || cat.category === filters.category;
            return categoryMatch;
        });
        return { ...pos, categoryList: filteredCategoryList };
    }).filter(pos => {
        const employeeIdMatch = filters.employeeId === '' || String(pos.employeeId).includes(filters.employeeId);
        return employeeIdMatch && pos.categoryList.length > 0;
    });
  }, [allPositions, filters]);


  if (isAuthLoading) {
      return (
        <div className="w-full max-w-6xl mx-auto">
            <div className="mb-6"><Skeleton className="h-10 w-96" /></div>
            <Skeleton className="h-96 w-full" />
        </div>
      )
  }

  if (!canView) {
    return (
        <div className="w-full max-w-4xl mx-auto">
            <div className="mb-6 flex items-center gap-4">
              <Link href="/settings/employee">
                <Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button>
              </Link>
              <h1 className="text-2xl font-bold">All Employee Position Details</h1>
            </div>
            <Card>
                <CardHeader>
                    <CardTitle>Access Denied</CardTitle>
                    <CardDescription>You do not have permission to view this page.</CardDescription>
                </CardHeader>
                <CardContent className="flex justify-center p-8">
                    <ShieldAlert className="h-16 w-16 text-destructive" />
                </CardContent>
            </Card>
        </div>
    );
  }

  return (
    <div className="w-full max-w-6xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
            <Link href="/settings/employee">
            <Button variant="ghost" size="icon">
                <ArrowLeft className="h-6 w-6" />
            </Button>
            </Link>
            <div>
                <h1 className="text-2xl font-bold">All Employee Position Details</h1>
                <p className="text-muted-foreground">Browse position details for all employees from GreytHR.</p>
            </div>
        </div>
         <div className="flex items-center gap-2">
            {lastSynced && (
              <p className="text-sm text-muted-foreground">
                Last synced: {lastSynced}
              </p>
            )}
            <Button onClick={handleSync} disabled={isSyncing || !canSync}>
                {isSyncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <RefreshCw className="mr-2 h-4 w-4" />}
                Sync from GreytHR
            </Button>
        </div>
      </div>
      
       <Card className="mb-4">
        <CardContent className="p-4 flex flex-col md:flex-row gap-4">
          <div className="relative flex-grow">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search Employee ID..."
              className="pl-8"
              value={filters.employeeId}
              onChange={(e) => handleFilterChange('employeeId', e.target.value)}
            />
          </div>
          <Select
            value={filters.category}
            onValueChange={(value) => handleFilterChange('category', value)}
          >
            <SelectTrigger className="w-full md:w-[240px]">
              <SelectValue placeholder="Filter by Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {uniqueCategories.map((cat) => (
                <SelectItem key={cat} value={cat}>
                  {cat}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="secondary" onClick={clearFilters}>
            Clear Filters
          </Button>
        </CardContent>
      </Card>


      <Card>
        <CardContent className="p-0">
          <div className="max-h-[calc(100vh-22rem)] overflow-y-auto">
          <Table>
            <TableHeader className="sticky top-0 bg-background">
              <TableRow>
                <TableHead>Employee ID</TableHead>
                <TableHead>Position ID</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Value</TableHead>
                <TableHead>Effective From</TableHead>
                <TableHead>Effective To</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 10 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                  </TableRow>
                ))
              ) : filteredPositions.length > 0 ? (
                filteredPositions.flatMap(pos => 
                    pos.categoryList.map((cat, index) => (
                      <TableRow key={`${pos.employeeId}-${cat.id}`}>
                        {index === 0 && (
                          <TableCell rowSpan={pos.categoryList.length} className="font-medium align-top">
                            {pos.employeeId}
                          </TableCell>
                        )}
                        <TableCell>{cat.id}</TableCell>
                        <TableCell><Badge>{cat.category}</Badge></TableCell>
                        <TableCell><Badge variant="secondary">{cat.value}</Badge></TableCell>
                        <TableCell>{cat.effectiveFrom}</TableCell>
                        <TableCell>{cat.effectiveTo || 'N/A'}</TableCell>
                      </TableRow>
                    ))
                )
              ) : (
                <TableRow>
                  <TableCell colSpan={6} className="text-center h-24">
                    No position details found. Please sync from GreytHR.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
