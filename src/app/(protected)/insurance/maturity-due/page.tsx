
'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, CalendarClock, RotateCw, Edit } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, where, orderBy } from 'firebase/firestore';
import type { InsurancePolicy } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import {
  format,
  isPast,
  isWithinInterval,
  addDays,
  getYear,
} from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { useRouter } from 'next/navigation';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export default function MaturityDuePage() {
  const { toast } = useToast();
  const router = useRouter();
  const [policies, setPolicies] = useState<InsurancePolicy[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [selectedYear, setSelectedYear] = useState<string>('all');
  const [selectedMonth, setSelectedMonth] = useState<string>('all');

  const yearOptions = useMemo(() => {
    if (policies.length === 0) return [getYear(new Date()).toString()];
    const years = new Set(
      policies.map((p) => {
        const date = p.date_of_maturity?.toDate?.();
        return date ? getYear(date) : 0;
      }).filter((y) => y > 0)
    );
    return Array.from(years)
      .sort((a, b) => b - a)
      .map(String);
  }, [policies]);

  const monthOptions = Array.from({ length: 12 }, (_, i) => ({
    value: String(i),
    label: format(new Date(0, i), 'MMMM'),
  }));

  const fetchPolicies = async () => {
    setIsLoading(true);
    try {
      const q = query(
        collection(db, 'insurance_policies'),
        where('date_of_maturity', '!=', null),
        orderBy('date_of_maturity', 'asc')
      );
      const querySnapshot = await getDocs(q);
      const policiesData = querySnapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
        } as InsurancePolicy;
      });
      setPolicies(policiesData);
    } catch (error) {
      console.error('Error fetching policies:', error);
      toast({
        title: 'Error',
        description: 'Failed to fetch insurance policies.',
        variant: 'destructive',
      });
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchPolicies();
  }, [toast]);

  const filteredPolicies = useMemo(() => {
    return policies.filter((policy) => {
      const maturityDate = policy.date_of_maturity?.toDate?.();
      if (!maturityDate) return false;
      const yearMatch =
        selectedYear === 'all' ||
        getYear(maturityDate).toString() === selectedYear;
      const monthMatch =
        selectedMonth === 'all' ||
        maturityDate.getMonth().toString() === selectedMonth;
      return yearMatch && monthMatch;
    });
  }, [policies, selectedYear, selectedMonth]);

  const getStatus = (maturityDate: Date | null) => {
    if (!maturityDate)
      return { text: 'N/A', variant: 'secondary' as const };
    if (isPast(maturityDate))
      return { text: 'Matured', variant: 'destructive' as const };
    if (isWithinInterval(maturityDate, { start: new Date(), end: addDays(new Date(), 90) })) {
      return { text: 'Mature Soon', variant: 'default' as const };
    }
    return { text: 'Upcoming', variant: 'secondary' as const };
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
    }).format(amount);
  };

  const handleRowClick = (policyId: string) => {
    router.push(`/insurance/personal/${policyId}`);
  };

  return (
    <div className="w-full">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link href="/insurance">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-6 w-6" />
            </Button>
          </Link>
          <div>
            <h1 className="text-xl font-bold">Maturity Due</h1>
            <p className="text-sm text-muted-foreground">
              Upcoming and overdue policy maturities.
            </p>
          </div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex justify-end">
            <div className="flex flex-wrap items-center gap-4">
              <Select value={selectedYear} onValueChange={setSelectedYear}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="All Years" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Years</SelectItem>
                  {yearOptions.map((year) => (
                    <SelectItem key={year} value={year}>
                      {year}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="All Months" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Months</SelectItem>
                  {monthOptions.map((month) => (
                    <SelectItem key={month.value} value={month.value}>
                      {month.label}
                    </SelectItem>
                  ))}
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
                <TableHead>Sum Insured</TableHead>
                <TableHead>Maturity Date</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={6}>
                      <Skeleton className="h-8" />
                    </TableCell>
                  </TableRow>
                ))
              ) : filteredPolicies.length > 0 ? (
                filteredPolicies.map((policy) => {
                  const maturityDate = policy.date_of_maturity?.toDate?.() ?? null;
                  const status = getStatus(maturityDate);
                  return (
                    <TableRow
                      key={policy.id}
                      onClick={() => handleRowClick(policy.id)}
                      className="cursor-pointer"
                    >
                      <TableCell className="font-medium">
                        {policy.insured_person}
                      </TableCell>
                      <TableCell>{policy.policy_no}</TableCell>
                      <TableCell>{policy.insurance_company}</TableCell>
                      <TableCell>
                        {formatCurrency(policy.sum_insured)}
                      </TableCell>
                      <TableCell>
                        {maturityDate
                          ? format(maturityDate, 'dd MMM, yyyy')
                          : 'N/A'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={status.variant}>{status.text}</Badge>
                      </TableCell>
                    </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={6} className="text-center h-24">
                    No policies found for the selected period.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
