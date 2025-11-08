'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeft, View } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { db } from '@/lib/firebase';
import {
  collection,
  getDocs,
  orderBy,
  query,
} from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';
import { format, getYear } from 'date-fns';
import type {
  Bill,
  Project,
  JmcEntry,
  MvacEntry,
} from '@/lib/types';
import { useParams } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import ViewJmcEntryDialog from '@/components/ViewJmcEntryDialog';
import ViewMvacEntryDialog from '@/components/ViewMvacEntryDialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/* ---------- helpers ---------- */

const slugify = (text: string) => {
  if (!text) return '';
  return text
    .toString()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '')
    .replace(/--+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
};

function toDateSafe(value: any): Date | null {
  if (!value) return null;
  if (typeof value?.toDate === 'function') return value.toDate();
  if (value instanceof Date) return value;
  if (typeof value === 'number') return new Date(value);
  if (typeof value === 'string') {
    const d = new Date(value);
    return isNaN(+d) ? null : d;
  }
  if (value?.seconds) return new Date(value.seconds * 1000);
  return null;
}

type CombinedLogEntry = (JmcEntry | MvacEntry) & {
  id: string;
  type: 'JMC' | 'MVAC';
  executedAmount: number;
  certifiedAmount: number;
};

export default function CombinedLogPage() {
  const { toast } = useToast();
  const params = useParams();
  const projectSlug = params.project as string;

  const [log, setLog] = useState<CombinedLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [selectedJmc, setSelectedJmc] = useState<JmcEntry | null>(null);
  const [isJmcViewOpen, setIsJmcViewOpen] = useState(false);

  const [selectedMvac, setSelectedMvac] = useState<MvacEntry | null>(null);
  const [isMvacViewOpen, setIsMvacViewOpen] = useState(false);

  const [yearFilter, setYearFilter] = useState<string>('all');
  const [monthFilter, setMonthFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');

  const fetchLogs = useCallback(async () => {
    if (!projectSlug) return;
    setIsLoading(true);
    try {
      // 1) Find project by slug
      const projectsQuery = query(collection(db, 'projects'));
      const projectSnap = await getDocs(projectsQuery);

      const project = projectSnap.docs
        .map(
          (doc) =>
            ({
              id: doc.id,
              ...doc.data(),
            } as Project)
        )
        .find((p) => slugify(p.projectName) === projectSlug);

      if (!project) {
        console.error('Project not found');
        setLog([]);
        setIsLoading(false);
        return;
      }

      const projectId = project.id;

      // 2) Load JMC + MVAC entries
      const jmcQuery = query(
        collection(db, 'projects', projectId, 'jmcEntries'),
        orderBy('createdAt', 'desc')
      );
      const mvacQuery = query(
        collection(db, 'projects', projectId, 'mvacEntries'),
        orderBy('createdAt', 'desc')
      );

      const [jmcSnapshot, mvacSnapshot] = await Promise.all([
        getDocs(jmcQuery),
        getDocs(mvacQuery),
      ]);

      const jmcEntries: CombinedLogEntry[] = jmcSnapshot.docs.map((docSnap) => {
        const data = docSnap.data() as JmcEntry;
        const executedAmount = (data.items || []).reduce(
          (sum, item) => sum + ((item.executedQty || 0) * (item.rate || 0)),
          0
        );
        const certifiedAmount = (data.items || []).reduce(
          (sum, item) => sum + ((item.certifiedQty || 0) * (item.rate || 0)),
          0
        );
        return {
          ...data,
          id: docSnap.id,
          type: 'JMC',
          executedAmount,
          certifiedAmount,
        };
      });

      const mvacEntries: CombinedLogEntry[] = mvacSnapshot.docs.map(
        (docSnap) => {
          const data = docSnap.data() as MvacEntry;
          const executedAmount = (data.items || []).reduce(
            (sum, item) => sum + ((item.executedQty || 0) * (item.rate || 0)),
            0
          );
          const certifiedAmount = (data.items || []).reduce(
            (sum, item) => sum + ((item.certifiedQty || 0) * (item.rate || 0)),
            0
          );
          return {
            ...data,
            id: docSnap.id,
            type: 'MVAC',
            executedAmount,
            certifiedAmount,
          };
        }
      );

      // 3) Combine + robust sort by createdAt fallback to doc date
      const combined = [...jmcEntries, ...mvacEntries];

      combined.sort((a, b) => {
        const aCreated =
          toDateSafe((a as any).createdAt) ||
          (a.type === 'JMC'
            ? toDateSafe((a as JmcEntry).jmcDate as any)
            : toDateSafe((a as MvacEntry).mvacDate as any)) ||
          new Date(0);

        const bCreated =
          toDateSafe((b as any).createdAt) ||
          (b.type === 'JMC'
            ? toDateSafe((b as JmcEntry).jmcDate as any)
            : toDateSafe((b as MvacEntry).mvacDate as any)) ||
          new Date(0);

        return bCreated.getTime() - aCreated.getTime();
      });

      setLog(combined);
    } catch (error) {
      console.error('Error fetching logs: ', error);
      toast({
        title: 'Error',
        description: 'Failed to fetch combined log for this project.',
        variant: 'destructive',
      });
      setLog([]);
    } finally {
      setIsLoading(false);
    }
  }, [projectSlug, toast]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  /* ---------- filters ---------- */

  const filteredLog = useMemo(() => {
    return log.filter((entry) => {
      const rawDate =
        entry.type === 'JMC'
          ? (entry as JmcEntry).jmcDate
          : (entry as MvacEntry).mvacDate;
      const date = toDateSafe(rawDate);
      if (!date) return false;

      const yearMatch =
        yearFilter === 'all' || getYear(date).toString() === yearFilter;
      const monthMatch =
        monthFilter === 'all' ||
        date.getMonth().toString() === monthFilter;
      const typeMatch =
        typeFilter === 'all' || entry.type === typeFilter;

      return yearMatch && monthMatch && typeMatch;
    });
  }, [log, yearFilter, monthFilter, typeFilter]);

  const handleViewDetails = (entry: CombinedLogEntry) => {
    if (entry.type === 'JMC') {
      setSelectedJmc(entry as JmcEntry);
      setIsJmcViewOpen(true);
    } else {
      setSelectedMvac(entry as MvacEntry);
      setIsMvacViewOpen(true);
    }
  };

  const formatCurrencyCell = (amount: number) =>
    new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
    }).format(amount || 0);

  const getDate = (entry: CombinedLogEntry) => {
    const raw =
      entry.type === 'JMC'
        ? (entry as JmcEntry).jmcDate
        : (entry as MvacEntry).mvacDate;
    const date = toDateSafe(raw);
    if (!date) return 'N/A';
    try {
      return format(date, 'dd MMM, yyyy');
    } catch {
      return 'Invalid Date';
    }
  };

  const yearOptions = useMemo(() => {
    const years = new Set<number>();
    log.forEach((l) => {
      const raw =
        l.type === 'JMC'
          ? (l as JmcEntry).jmcDate
          : (l as MvacEntry).mvacDate;
      const date = toDateSafe(raw);
      if (date) years.add(getYear(date));
    });
    return Array.from(years).sort((a, b) => b - a);
  }, [log]);

  const monthOptions = Array.from({ length: 12 }, (_, i) => ({
    label: format(new Date(2000, i, 1), 'MMMM'),
    value: i.toString(), // 0-11
  }));

  const skeletonCols = 9;

  /* ---------- render ---------- */

  return (
    <>
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link href={`/billing-recon/${projectSlug}`}>
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-6 w-6" />
              </Button>
            </Link>
            <h1 className="text-2xl font-bold">
              Combined JMC &amp; MVAC Log
            </h1>
          </div>
        </div>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center gap-4">
              <Select
                value={yearFilter}
                onValueChange={setYearFilter}
              >
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="All Years" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Years</SelectItem>
                  {yearOptions.map((year) => (
                    <SelectItem
                      key={year}
                      value={String(year)}
                    >
                      {year}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={monthFilter}
                onValueChange={setMonthFilter}
              >
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="All Months" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Months</SelectItem>
                  {monthOptions.map((month) => (
                    <SelectItem
                      key={month.value}
                      value={month.value}
                    >
                      {month.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={typeFilter}
                onValueChange={setTypeFilter}
              >
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="All Types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="JMC">JMC</SelectItem>
                  <SelectItem value="MVAC">MVAC</SelectItem>
                </SelectContent>
              </Select>

              <Button
                variant="secondary"
                onClick={() => {
                  setYearFilter('all');
                  setMonthFilter('all');
                  setTypeFilter('all');
                }}
              >
                Clear Filters
              </Button>
            </div>
          </CardHeader>

          <CardContent className="p-0 overflow-x-auto">
            <Table className="min-w-[1200px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Number</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>No. of Items</TableHead>
                  <TableHead>Executed Amount</TableHead>
                  <TableHead>Certified Amount</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>Stage Status</TableHead>
                  <TableHead className="text-right">
                    Actions
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 10 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell
                        colSpan={skeletonCols}
                      >
                        <Skeleton className="h-5 w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : filteredLog.length > 0 ? (
                  filteredLog.map((entry) => (
                    <TableRow
                      key={entry.id}
                      onClick={() =>
                        handleViewDetails(entry)
                      }
                      className="cursor-pointer"
                    >
                      <TableCell>
                        <Badge
                          variant={
                            entry.type === 'JMC'
                              ? 'default'
                              : 'secondary'
                          }
                        >
                          {entry.type}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium">
                        {(entry as JmcEntry).jmcNo ||
                          (entry as MvacEntry).mvacNo}
                      </TableCell>
                      <TableCell>
                        {getDate(entry)}
                      </TableCell>
                      <TableCell>
                        {entry.items?.length || 0}
                      </TableCell>
                      <TableCell>
                        {formatCurrencyCell(
                          entry.executedAmount
                        )}
                      </TableCell>
                      <TableCell>
                        {formatCurrencyCell(
                          entry.certifiedAmount
                        )}
                      </TableCell>
                      <TableCell>
                        {(entry as any).stage || '-'}
                      </TableCell>
                      <TableCell>
                        {(entry as any).status || '-'}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleViewDetails(entry);
                          }}
                        >
                          <View className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={skeletonCols}
                      className="text-center h-24"
                    >
                      No JMC or MVAC entries found for the
                      selected period.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Detail dialogs (they handle print themselves) */}
      <ViewJmcEntryDialog
        isOpen={isJmcViewOpen}
        onOpenChange={setIsJmcViewOpen}
        jmcEntry={selectedJmc}
        boqItems={[]}
        bills={[]}
      />

      <ViewMvacEntryDialog
        isOpen={isMvacViewOpen}
        onOpenChange={setIsMvacViewOpen}
        MvacEntry={selectedMvac}
        boqItems={[]}
        bills={[]}
      />
    </>
  );
}
