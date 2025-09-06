
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Search, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { getEmployeePositionDetails } from '@/ai';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface PositionDetail {
    id: number;
    category: number;
    value: number;
    effectiveFrom: string;
    effectiveTo: string | null;
}

export default function EmployeePositionDetailsPage() {
  const { toast } = useToast();
  const [employeeId, setEmployeeId] = useState('');
  const [details, setDetails] = useState<PositionDetail[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const handleFetchDetails = async () => {
    if (!employeeId.trim()) {
      toast({
        title: 'Employee ID required',
        description: 'Please enter an employee ID.',
        variant: 'destructive',
      });
      return;
    }
    setIsLoading(true);
    setDetails([]);
    setSearched(true);
    try {
      const result = await getEmployeePositionDetails({ employeeId });
      if (result.success && result.details) {
        setDetails(result.details);
        toast({
          title: 'Success',
          description: `Found ${result.details.length} position records.`,
        });
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

  return (
    <div className="w-full max-w-4xl mx-auto">
      <div className="mb-6 flex items-center gap-4">
        <Link href="/settings/employee">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-6 w-6" />
          </Button>
        </Link>
        <h1 className="text-2xl font-bold">Employee Position Details</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Fetch Details</CardTitle>
          <CardDescription>Enter an Employee ID to get their position details from GreytHR.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex w-full max-w-sm items-center space-x-2">
            <div className="grid flex-1 gap-2">
                <Label htmlFor="employeeId" className="sr-only">Employee ID</Label>
                <Input 
                    id="employeeId" 
                    placeholder="Enter Employee ID" 
                    value={employeeId}
                    onChange={(e) => setEmployeeId(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleFetchDetails()}
                />
            </div>
            <Button onClick={handleFetchDetails} disabled={isLoading}>
                {isLoading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                    <Search className="mr-2 h-4 w-4" />
                )}
                Fetch
            </Button>
          </div>
        </CardContent>
      </Card>
      
      {searched && (
         <Card className="mt-6">
            <CardHeader>
                <CardTitle>Results for Employee: {employeeId}</CardTitle>
            </CardHeader>
            <CardContent>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>ID</TableHead>
                            <TableHead>Category</TableHead>
                            <TableHead>Value</TableHead>
                            <TableHead>Effective From</TableHead>
                            <TableHead>Effective To</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {isLoading ? (
                             <TableRow>
                                <TableCell colSpan={5} className="h-24 text-center">
                                    <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
                                </TableCell>
                            </TableRow>
                        ) : details.length > 0 ? (
                           details.map(detail => (
                               <TableRow key={detail.id}>
                                   <TableCell>{detail.id}</TableCell>
                                   <TableCell>{detail.category}</TableCell>
                                   <TableCell>{detail.value}</TableCell>
                                   <TableCell>{detail.effectiveFrom}</TableCell>
                                   <TableCell>{detail.effectiveTo || 'N/A'}</TableCell>
                               </TableRow>
                           ))
                        ) : (
                            <TableRow>
                                <TableCell colSpan={5} className="text-center h-24">
                                    No position details found for this employee.
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </CardContent>
         </Card>
      )}
    </div>
  );
}
