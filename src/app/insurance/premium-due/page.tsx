
'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, CalendarClock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, where, orderBy } from 'firebase/firestore';
import type { InsurancePolicy } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { format, isPast, isWithinInterval, addDays, getYear, addMonths, addQuarters, addYears } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { useRouter } from 'next/navigation';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';

function PremiumScheduleDialog({ policy, isOpen, onOpenChange }: { policy: InsurancePolicy | null, isOpen: boolean, onOpenChange: (open: boolean) => void }) {
    if (!policy) return null;

    const schedule = useMemo(() => {
        if (!policy.date_of_comm || !policy.tenure || !policy.payment_type || policy.payment_type === 'One-Time') {
            return [];
        }
        
        const startDate = policy.date_of_comm.toDate ? policy.date_of_comm.toDate() : new Date(policy.date_of_comm);
        const dates: Date[] = [];
        
        for (let i = 0; i < policy.tenure; i++) {
            switch (policy.payment_type) {
                case 'Yearly':
                    dates.push(addYears(startDate, i));
                    break;
                case 'Quarterly':
                    for (let j = 0; j < 4; j++) {
                         const newDate = addQuarters(addYears(startDate, i), j);
                         if (addYears(startDate, policy.tenure) > newDate) dates.push(newDate);
                    }
                    break;
                case 'Monthly':
                     for (let j = 0; j < 12; j++) {
                        const newDate = addMonths(addYears(startDate, i), j);
                        if (addYears(startDate, policy.tenure) > newDate) dates.push(newDate);
                    }
                    break;
            }
        }
        return dates;

    }, [policy]);
    
    const formatCurrency = (amount: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Premium Schedule</DialogTitle>
                    <DialogDescription>Policy No: {policy.policy_no}</DialogDescription>
                </DialogHeader>
                <ScrollArea className="h-80">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Due Date</TableHead>
                                <TableHead className="text-right">Premium</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {schedule.map((date, index) => (
                                <TableRow key={index}>
                                    <TableCell>{format(date, 'dd MMM, yyyy')}</TableCell>
                                    <TableCell className="text-right">{formatCurrency(policy.premium)}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </ScrollArea>
                <DialogFooter>
                    <DialogClose asChild>
                        <Button variant="outline">Close</Button>
                    </DialogClose>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}


export default function PremiumDuePage() {
  const { toast } = useToast();
  const router = useRouter();
  const [policies, setPolicies] = useState<InsurancePolicy[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [selectedYear, setSelectedYear] = useState<string>('all');
  const [selectedMonth, setSelectedMonth] = useState<string>('all');
  
  const [selectedPolicy, setSelectedPolicy] = useState<InsurancePolicy | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);

  const yearOptions = useMemo(() => {
    if (policies.length === 0) return [getYear(new Date()).toString()];
    const years = new Set(policies.map(p => p.due_date ? getYear(p.due_date) : 0).filter(y => y > 0));
    return Array.from(years).sort((a,b) => b - a).map(String);
  }, [policies]);
  
  const monthOptions = Array.from({ length: 12 }, (_, i) => ({
    value: String(i),
    label: format(new Date(0, i), 'MMMM'),
  }));

  useEffect(() => {
    const fetchPolicies = async () => {
      setIsLoading(true);
      try {
        const q = query(collection(db, 'insurance_policies'), where('due_date', '!=', null), orderBy('due_date', 'asc'));
        const querySnapshot = await getDocs(q);
        const policiesData = querySnapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                ...data,
                due_date: data.due_date ? data.due_date.toDate() : null,
                date_of_comm: data.date_of_comm ? data.date_of_comm.toDate() : null,
            } as InsurancePolicy
        });
        setPolicies(policiesData);
      } catch (error) {
        console.error("Error fetching policies:", error);
        toast({ title: 'Error', description: 'Failed to fetch insurance policies.', variant: 'destructive' });
      }
      setIsLoading(false);
    };

    fetchPolicies();
  }, [toast]);
  
  const filteredPolicies = useMemo(() => {
      return policies.filter(policy => {
          if (!policy.due_date) return false;
          const yearMatch = selectedYear === 'all' || getYear(policy.due_date).toString() === selectedYear;
          const monthMatch = selectedMonth === 'all' || policy.due_date.getMonth().toString() === selectedMonth;
          return yearMatch && monthMatch;
      });
  }, [policies, selectedYear, selectedMonth]);
  
  const getStatus = (dueDate: Date | null) => {
    if (!dueDate) return { text: 'N/A', variant: 'secondary' as const };
    if (isPast(dueDate)) return { text: 'Overdue', variant: 'destructive' as const };
    if (isWithinInterval(dueDate, { start: new Date(), end: addDays(new Date(), 30) })) {
      return { text: 'Due Soon', variant: 'default' as const };
    }
    return { text: 'Upcoming', variant: 'secondary' as const };
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);
  };
  
  const handleRowClick = (policy: InsurancePolicy) => {
    setSelectedPolicy(policy);
    setIsDetailsOpen(true);
  }

  return (
    <>
        <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center justify-between">
            <div className="flex items-center gap-2">
            <Link href="/insurance"><Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button></Link>
            <div>
                <h1 className="text-xl font-bold">Premium Due</h1>
                <p className="text-sm text-muted-foreground">Upcoming and overdue insurance premium payments.</p>
            </div>
            </div>
        </div>
        
        <Card>
            <CardHeader>
                <div className="flex justify-end">
                    <div className="flex flex-wrap items-center gap-4">
                    <Select value={selectedYear} onValueChange={setSelectedYear}>
                        <SelectTrigger className="w-[180px]"><SelectValue placeholder="Select Year" /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Years</SelectItem>
                            {yearOptions.map(year => <SelectItem key={year} value={year}>{year}</SelectItem>)}
                        </SelectContent>
                    </Select>
                    <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                        <SelectTrigger className="w-[180px]"><SelectValue placeholder="Select Month" /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Months</SelectItem>
                            {monthOptions.map(month => <SelectItem key={month.value} value={month.value}>{month.label}</SelectItem>)}
                        </SelectContent>
                    </Select>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="p-0">
            <Table>
                <TableHeader>
                <TableRow>
                    <TableHead>Policy Holder</TableHead>
                    <TableHead>Policy No.</TableHead>
                    <TableHead>Company</TableHead>
                    <TableHead>Premium</TableHead>
                    <TableHead>Due Date</TableHead>
                    <TableHead>Status</TableHead>
                </TableRow>
                </TableHeader>
                <TableBody>
                {isLoading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                        <TableCell colSpan={6}><Skeleton className="h-8" /></TableCell>
                    </TableRow>
                    ))
                ) : filteredPolicies.length > 0 ? (
                    filteredPolicies.map(policy => {
                    const status = getStatus(policy.due_date);
                    return (
                        <TableRow key={policy.id} onClick={() => handleRowClick(policy)} className="cursor-pointer">
                        <TableCell className="font-medium">{policy.insured_person}</TableCell>
                        <TableCell>{policy.policy_no}</TableCell>
                        <TableCell>{policy.insurance_company}</TableCell>
                        <TableCell>{formatCurrency(policy.premium)}</TableCell>
                        <TableCell>{policy.due_date ? format(policy.due_date, 'dd MMM, yyyy') : 'N/A'}</TableCell>
                        <TableCell><Badge variant={status.variant}>{status.text}</Badge></TableCell>
                        </TableRow>
                    );
                    })
                ) : (
                    <TableRow>
                    <TableCell colSpan={6} className="text-center h-24">No policies with upcoming due dates found for the selected period.</TableCell>
                    </TableRow>
                )}
                </TableBody>
            </Table>
            </CardContent>
        </Card>
        </div>
        <PremiumScheduleDialog policy={selectedPolicy} isOpen={isDetailsOpen} onOpenChange={setIsDetailsOpen} />
    </>
  );
}
