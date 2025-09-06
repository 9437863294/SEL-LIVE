
'use client';

import { useState, useEffect, Fragment } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, ArrowRight, ArrowLeft as ArrowLeftIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { getAllEmployeePositions } from '@/ai';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import type { EmployeePosition } from '@/lib/types';


export default function EmployeePositionDetailsPage() {
  const { toast } = useToast();
  const [positions, setPositions] = useState<EmployeePosition[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [hasNextPage, setHasNextPage] = useState(false);

  const fetchPositions = async (page: number) => {
    setIsLoading(true);
    try {
      const result = await getAllEmployeePositions({ page });
      if (result.success && result.data) {
        setPositions(result.data);
        setCurrentPage(result.currentPage ?? 1);
        setHasNextPage(result.hasNextPage ?? false);
      } else {
        throw new Error(result.message);
      }
    } catch (error: any) {
      toast({
        title: 'Fetch Failed',
        description: error.message || 'Could not fetch position details.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchPositions(1);
  }, []);

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
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
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
                    <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                  </TableRow>
                ))
              ) : positions.length > 0 ? (
                positions.map(pos => (
                   <Fragment key={pos.employeeId}>
                    {pos.categoryList.map((cat, index) => (
                      <TableRow key={cat.id}>
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
                    ))}
                  </Fragment>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={6} className="text-center h-24">
                    No position details found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <div className="flex items-center justify-end space-x-2 py-4">
        <Button
            variant="outline"
            size="sm"
            onClick={() => fetchPositions(currentPage - 1)}
            disabled={currentPage <= 1 || isLoading}
        >
            <ArrowLeftIcon className="mr-2 h-4 w-4" />
            Previous
        </Button>
        <Button
            variant="outline"
            size="sm"
            onClick={() => fetchPositions(currentPage + 1)}
            disabled={!hasNextPage || isLoading}
        >
            Next
            <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
