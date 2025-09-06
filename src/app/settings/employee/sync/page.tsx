
'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, DownloadCloud, Loader2, Check, Inbox, ArrowRight, ArrowLeft as ArrowLeftIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, writeBatch, doc, getDocs, query, where } from 'firebase/firestore';
import { syncGreytHR } from '@/ai';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';

type FetchedEmployee = {
  employeeId: string;
  name: string;
  email: string;
  phone: string;
  department: string;
  designation: string;
  status: string;
};

export default function SyncEmployeePage() {
  const { toast } = useToast();
  const [step, setStep] = useState<'initial' | 'fetched' | 'importing' | 'completed'>('initial');
  const [isFetching, setIsFetching] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [fetchedEmployees, setFetchedEmployees] = useState<FetchedEmployee[]>([]);
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<string[]>([]);
  const [importProgress, setImportProgress] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [hasNextPage, setHasNextPage] = useState(false);

  const handleFetch = async (page = 1) => {
    setIsFetching(true);
    setFetchedEmployees([]);
    setSelectedEmployeeIds([]);
    try {
      const result = await syncGreytHR({ page });
      if (result.success && result.employees) {
        setFetchedEmployees(result.employees);
        setStep('fetched');
        setCurrentPage(result.currentPage ?? 1);
        setHasNextPage(result.hasNextPage ?? false);
        toast({
          title: 'Fetch Successful',
          description: `${result.message} (Page ${result.currentPage})`,
        });
      } else {
        throw new Error(result.message || 'An unknown error occurred during fetch.');
      }
    } catch (error: any) {
      toast({
        title: 'Fetch Failed',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIsFetching(false);
    }
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedEmployeeIds(fetchedEmployees.map(emp => emp.employeeId));
    } else {
      setSelectedEmployeeIds([]);
    }
  };

  const handleSelectEmployee = (id: string, checked: boolean) => {
    setSelectedEmployeeIds(prev =>
      checked ? [...prev, id] : prev.filter(empId => empId !== id)
    );
  };
  
  const employeesToImport = useMemo(() => {
    return fetchedEmployees.filter(emp => selectedEmployeeIds.includes(emp.employeeId));
  }, [fetchedEmployees, selectedEmployeeIds]);

  const handleImport = async () => {
    if (employeesToImport.length === 0) {
        toast({ title: 'No Employees Selected', description: 'Please select at least one employee to import.', variant: 'destructive' });
        return;
    }
    
    setIsImporting(true);
    setStep('importing');
    setImportProgress(0);

    const employeesRef = collection(db, 'employees');
    let importedCount = 0;

    for (let i = 0; i < employeesToImport.length; i++) {
        const empData = employeesToImport[i];
        
        try {
            const q = query(employeesRef, where("employeeId", "==", empData.employeeId));
            const querySnapshot = await getDocs(q);
            const batch = writeBatch(db);

            if (querySnapshot.empty) {
                const newDocRef = doc(employeesRef);
                batch.set(newDocRef, empData);
            } else {
                const docToUpdate = querySnapshot.docs[0];
                batch.update(docToUpdate.ref, empData);
            }
            await batch.commit();
            importedCount++;
        } catch (error) {
             console.error(`Failed to import employee ${empData.employeeId}:`, error);
        }
        
        setImportProgress(((i + 1) / employeesToImport.length) * 100);
    }
    
    // Dispatch event to notify other components of successful sync
    window.dispatchEvent(new CustomEvent('greytHRSyncSuccess'));
    
    setIsImporting(false);
    setStep('completed');
    toast({
        title: 'Import Complete',
        description: `Successfully imported ${importedCount} of ${employeesToImport.length} selected employees.`,
    });
  }

  return (
    <div className="w-full max-w-5xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/settings/employee">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-6 w-6" />
            </Button>
          </Link>
          <h1 className="text-2xl font-bold">Sync & Import from GreytHR</h1>
        </div>
      </div>
      
      {step === 'initial' && (
        <Card className="text-center">
            <CardHeader>
                <CardTitle>Start Synchronization</CardTitle>
                <CardDescription>Fetch the latest employee data from GreytHR to preview before importing.</CardDescription>
            </CardHeader>
            <CardContent>
                <Button onClick={() => handleFetch(1)} disabled={isFetching} size="lg">
                    {isFetching ? (
                        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    ) : (
                        <DownloadCloud className="mr-2 h-5 w-5" />
                    )}
                    Fetch from GreytHR
                </Button>
            </CardContent>
        </Card>
      )}

      {step === 'fetched' && (
        <Card>
            <CardHeader>
                <div className="flex justify-between items-center">
                    <div>
                        <CardTitle>Review & Select Employees</CardTitle>
                        <CardDescription>{fetchedEmployees.length} employees fetched. Select who to import.</CardDescription>
                    </div>
                    <Button onClick={handleImport} disabled={employeesToImport.length === 0}>
                        Import ({employeesToImport.length}) Selected
                    </Button>
                </div>
            </CardHeader>
            <CardContent>
                 <div className="border rounded-lg overflow-hidden max-h-[60vh] overflow-y-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-[50px]">
                                <Checkbox
                                    checked={fetchedEmployees.length > 0 && selectedEmployeeIds.length === fetchedEmployees.length}
                                    onCheckedChange={(checked) => handleSelectAll(!!checked)}
                                    aria-label="Select all"
                                />
                                </TableHead>
                                <TableHead>Employee ID</TableHead>
                                <TableHead>Name</TableHead>
                                <TableHead>Email</TableHead>
                                <TableHead>Mobile</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                             {isFetching ? (
                                <TableRow>
                                    <TableCell colSpan={5} className="h-24 text-center">
                                        <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
                                    </TableCell>
                                </TableRow>
                             ) : fetchedEmployees.length > 0 ? (
                                fetchedEmployees.map(emp => (
                                    <TableRow key={emp.employeeId}>
                                        <TableCell>
                                            <Checkbox
                                                checked={selectedEmployeeIds.includes(emp.employeeId)}
                                                onCheckedChange={(checked) => handleSelectEmployee(emp.employeeId, !!checked)}
                                            />
                                        </TableCell>
                                        <TableCell>{emp.employeeId}</TableCell>
                                        <TableCell>{emp.name}</TableCell>
                                        <TableCell>{emp.email}</TableCell>
                                        <TableCell>{emp.phone}</TableCell>
                                    </TableRow>
                                ))
                             ) : (
                                <TableRow>
                                    <TableCell colSpan={5} className="text-center h-24">No employees found in GreytHR.</TableCell>
                                </TableRow>
                             )}
                        </TableBody>
                    </Table>
                 </div>
                 <div className="flex items-center justify-end space-x-2 py-4">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleFetch(currentPage - 1)}
                        disabled={currentPage <= 1 || isFetching}
                    >
                        <ArrowLeftIcon className="mr-2 h-4 w-4" />
                        Previous
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleFetch(currentPage + 1)}
                        disabled={!hasNextPage || isFetching}
                    >
                        Next
                        <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                </div>
            </CardContent>
        </Card>
      )}
      
      {(step === 'importing' || step === 'completed') && (
        <Card>
            <CardHeader>
                <CardTitle>Import Progress</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <Progress value={importProgress} />
                <p className="text-center text-muted-foreground">{Math.round(importProgress)}% Complete</p>
                {step === 'completed' && (
                    <Alert variant="default" className="bg-green-50 border-green-200 text-green-800">
                        <Check className="h-4 w-4 !text-green-600" />
                        <AlertTitle>Import Complete!</AlertTitle>
                        <AlertDescription>
                            The selected employees have been imported. You can now return to the employee list or start a new fetch.
                        </AlertDescription>
                        <div className="mt-4 flex gap-2">
                             <Link href="/settings/employee/manage">
                                <Button variant="outline">View Employee List</Button>
                             </Link>
                             <Button onClick={() => setStep('initial')}>Start New Fetch</Button>
                        </div>
                    </Alert>
                )}
            </CardContent>
        </Card>
      )}

    </div>
  );
}
