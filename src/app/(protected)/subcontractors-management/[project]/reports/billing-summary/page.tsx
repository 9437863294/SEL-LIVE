
'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, where, collectionGroup, Timestamp } from 'firebase/firestore';
import type { Bill, Project, Subcontractor, ProformaBill } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { format, getYear } from 'date-fns';
import { useParams, useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import ViewBillDialog from '@/components/subcontractors-management/ViewBillDialog';
import ViewProformaBillDialog from '@/components/subcontractors-management/ViewProformaBillDialog';

type DisplayBill = {
  id: string;
  type: 'Regular' | 'Retention' | 'Proforma';
  date: string;
  sortDate: Date;
  projectName?: string;
  projectId: string;
  netPayable: number;
  billNo: string;
  subcontractorName: string;
  workOrderNo: string;
  status?: string;
};

const slugify = (text: string) => {
  if (!text) return '';
  return text.toString().toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]+/g, '');
};

const toDateSafe = (value: any): Date | null => {
  if (!value) return null;
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
};

const formatDateSafe = (dateInput: any) => {
  const d = toDateSafe(dateInput);
  if (!d) return 'N/A';
  try {
    return format(d, 'dd MMM, yyyy');
  } catch {
    return 'Invalid Date';
  }
};

const formatCurrency = (amount: number) => {
  if (isNaN(amount)) return 'N/A';
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);
};

export default function BillingSummaryReport() {
  const params = useParams();
  const router = useRouter();
  const { project: projectSlug } = params as { project: string };
  const { toast } = useToast();

  const [bills, setBills] = useState<Bill[]>([]);
  const [proformaBills, setProformaBills] = useState<ProformaBill[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [subcontractors, setSubcontractors] = useState<Subcontractor[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [selectedRegularBill, setSelectedRegularBill] = useState<Bill | null>(null);
  const [selectedProformaBill, setSelectedProformaBill] = useState<ProformaBill | null>(null);
  const [isBillViewOpen, setIsBillViewOpen] = useState(false);
  const [isProformaViewOpen, setIsProformaViewOpen] = useState(false);

  const [filters, setFilters] = useState({
    project: projectSlug === 'all' ? 'all' : projectSlug,
    subcontractor: 'all',
    year: 'all',
    month: 'all',
    type: 'all',
  });

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      try {
        const projectsSnap = await getDocs(query(collection(db, 'projects')));
        const allProjects = projectsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project));
        setProjects(allProjects);

        const subsSnap = await getDocs(query(collectionGroup(db, 'subcontractors')));
        setSubcontractors(subsSnap.docs.map(d => ({id: d.id, ...d.data()} as Subcontractor)));

        const billsSnap = await getDocs(query(collectionGroup(db, 'bills')));
        const proformaSnap = await getDocs(query(collectionGroup(db, 'proformaBills')));
        
        const billEntries: Bill[] = billsSnap.docs.map(doc => {
            const data = doc.data() as Bill;
            const projectId = doc.ref.parent.parent?.id || '';
            const project = allProjects.find(p => p.id === projectId);
            return { ...data, id: doc.id, projectId, projectName: project?.projectName };
        });

        const proformaEntries: ProformaBill[] = proformaSnap.docs.map(doc => {
            const data = doc.data() as ProformaBill;
            const projectId = doc.ref.parent.parent?.id || '';
            const project = allProjects.find(p => p.id === projectId);
            return { ...data, id: doc.id, projectId, projectName: project?.projectName };
        });

        setBills(billEntries);
        setProformaBills(proformaEntries);

      } catch (error) {
        console.error("Error fetching data:", error);
        toast({ title: 'Error', description: 'Failed to load report data.', variant: 'destructive' });
      }
      setIsLoading(false);
    };
    fetchData();
  }, [toast]);

  const handleFilterChange = (field: keyof typeof filters, value: string) => {
    setFilters(prev => ({ ...prev, [field]: value }));
  };

  const filteredBills = useMemo(() => {
      const unifiedList: DisplayBill[] = [
          ...bills.map(b => ({
              id: b.id,
              type: b.isRetentionBill ? 'Retention' : 'Regular',
              date: b.billDate,
              sortDate: new Date(b.billDate),
              billNo: b.billNo,
              netPayable: b.netPayable,
              projectName: b.projectName,
              projectId: b.projectId,
              subcontractorId: b.subcontractorId,
              subcontractorName: b.subcontractorName || '',
              workOrderNo: b.workOrderNo,
              status: b.status,
          })),
          ...proformaBills.map(pb => ({
              id: pb.id,
              type: 'Proforma',
              date: pb.date,
              sortDate: new Date(pb.date),
              billNo: pb.proformaNo,
              netPayable: pb.payableAmount,
              projectName: pb.projectName,
              projectId: pb.projectId,
              subcontractorId: pb.subcontractorId,
              subcontractorName: pb.subcontractorName,
              workOrderNo: pb.workOrderNo,
              status: pb.status,
          })),
      ];

      return unifiedList.filter(bill => {
        const projectMatch = filters.project === 'all' || slugify(bill.projectName || '') === filters.project;
        const subMatch = filters.subcontractor === 'all' || bill.subcontractorId === filters.subcontractor;
        const yearMatch = filters.year === 'all' || getYear(bill.sortDate).toString() === filters.year;
        const monthMatch = filters.month === 'all' || bill.sortDate.getMonth().toString() === filters.month;
        const typeMatch = filters.type === 'all' || bill.type === filters.type;
        return projectMatch && subMatch && yearMatch && monthMatch && typeMatch;
    }).sort((a, b) => b.sortDate.getTime() - a.sortDate.getTime());
  }, [bills, proformaBills, filters]);
  
  const filterOptions = useMemo(() => {
    const allItems = [...bills, ...proformaBills];
    const visibleProjects = projects.filter(p => allItems.some(b => b.projectId === p.id));
    const visibleSubs = subcontractors.filter(s => allItems.some(b => b.subcontractorId === s.id));
    const years = [...new Set(allItems.map(b => getYear(toDateSafe(b.date || (b as Bill).billDate)!)?.toString()))].filter(Boolean).sort((a,b) => parseInt(b) - parseInt(a));
    const months = Array.from({length: 12}, (_, i) => ({ value: i.toString(), label: format(new Date(0, i), 'MMMM') }));

    return { projects: visibleProjects, subcontractors: visibleSubs, years, months };
  }, [bills, proformaBills, projects, subcontractors]);
  
  const totalAmount = useMemo(() => {
    return filteredBills.reduce((sum, bill) => sum + (bill.netPayable || 0), 0);
  }, [filteredBills]);

  const handleViewDetails = (bill: DisplayBill) => {
    if (bill.type === 'Proforma') {
      const originalProforma = proformaBills.find(pb => pb.id === bill.id);
      if (originalProforma) {
        setSelectedProformaBill(originalProforma);
        setIsProformaViewOpen(true);
      }
    } else {
      const originalBill = bills.find(b => b.id === bill.id);
      if (originalBill) {
        setSelectedRegularBill(originalBill);
        setIsBillViewOpen(true);
      }
    }
  };

  return (
    <>
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link href={`/subcontractors-management/${projectSlug}/reports`}>
              <Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button>
            </Link>
            <h1 className="text-2xl font-bold">Billing Summary Report</h1>
          </div>
        </div>
        
        <Card className="mb-6">
          <CardContent className="p-4 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 items-end">
              <div className="space-y-1">
                  <p className="text-sm font-medium">Project</p>
                  <Select value={filters.project} onValueChange={(v) => handleFilterChange('project', v)}>
                      <SelectTrigger><SelectValue placeholder="All Projects" /></SelectTrigger>
                      <SelectContent>
                          <SelectItem value="all">All Projects</SelectItem>
                          {filterOptions.projects.map(p => <SelectItem key={p.id} value={slugify(p.projectName)}>{p.projectName}</SelectItem>)}
                      </SelectContent>
                  </Select>
              </div>
              <div className="space-y-1">
                  <p className="text-sm font-medium">Subcontractor</p>
                  <Select value={filters.subcontractor} onValueChange={(v) => handleFilterChange('subcontractor', v)}>
                      <SelectTrigger><SelectValue placeholder="All Subcontractors" /></SelectTrigger>
                      <SelectContent>
                          <SelectItem value="all">All Subcontractors</SelectItem>
                          {filterOptions.subcontractors.map(s => <SelectItem key={s.id} value={s.id}>{s.legalName}</SelectItem>)}
                      </SelectContent>
                  </Select>
              </div>
              <div className="space-y-1">
                  <p className="text-sm font-medium">Type</p>
                  <Select value={filters.type} onValueChange={(v) => handleFilterChange('type', v)}>
                      <SelectTrigger><SelectValue placeholder="All Types" /></SelectTrigger>
                      <SelectContent>
                          <SelectItem value="all">All Types</SelectItem>
                          <SelectItem value="Regular">Regular</SelectItem>
                          <SelectItem value="Retention">Retention</SelectItem>
                          <SelectItem value="Proforma">Proforma</SelectItem>
                      </SelectContent>
                  </Select>
              </div>
              <div className="space-y-1">
                  <p className="text-sm font-medium">Year</p>
                  <Select value={filters.year} onValueChange={(v) => handleFilterChange('year', v)}>
                      <SelectTrigger><SelectValue placeholder="All Years" /></SelectTrigger>
                      <SelectContent>
                          <SelectItem value="all">All Years</SelectItem>
                          {filterOptions.years.map(y => <SelectItem key={y} value={y}>{y}</SelectItem>)}
                      </SelectContent>
                  </Select>
              </div>
              <div className="space-y-1">
                  <p className="text-sm font-medium">Month</p>
                  <Select value={filters.month} onValueChange={(v) => handleFilterChange('month', v)}>
                      <SelectTrigger><SelectValue placeholder="All Months" /></SelectTrigger>
                      <SelectContent>
                          <SelectItem value="all">All Months</SelectItem>
                          {filterOptions.months.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                      </SelectContent>
                  </Select>
              </div>
              <Card className="p-3 bg-muted">
                  <p className="text-sm font-medium text-muted-foreground">Total Payable</p>
                  <p className="text-xl font-bold">{formatCurrency(totalAmount)}</p>
              </Card>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead>Bill No.</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Subcontractor</TableHead>
                  <TableHead>WO No.</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 10 }).map((_, i) => (
                    <TableRow key={i}><TableCell colSpan={8}><Skeleton className="h-5" /></TableCell></TableRow>
                  ))
                ) : filteredBills.length > 0 ? (
                  filteredBills.map((bill) => (
                    <TableRow key={bill.id} onClick={() => handleViewDetails(bill)} className="cursor-pointer">
                      <TableCell>{bill.projectName}</TableCell>
                      <TableCell className="font-medium">{bill.billNo}</TableCell>
                      <TableCell>{formatDateSafe(bill.date)}</TableCell>
                      <TableCell><Badge variant={bill.type === 'Regular' ? 'default' : bill.type === 'Proforma' ? 'secondary' : 'outline'}>{bill.type}</Badge></TableCell>
                      <TableCell>{bill.subcontractorName}</TableCell>
                      <TableCell>{bill.workOrderNo}</TableCell>
                      <TableCell>{bill.status || 'N/A'}</TableCell>
                      <TableCell className="text-right">{formatCurrency(bill.netPayable)}</TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center h-24">
                      No bills found for the selected filters.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <ViewBillDialog
        isOpen={isBillViewOpen}
        onOpenChange={setIsBillViewOpen}
        bill={selectedRegularBill}
        workflow={[]}
        onAction={async () => {}}
        isActionLoading={false}
      />
      <ViewProformaBillDialog
        isOpen={isProformaViewOpen}
        onOpenChange={setIsProformaViewOpen}
        bill={selectedProformaBill}
        workflow={[]}
        onAction={async () => {}}
        isActionLoading={false}
      />
    </>
  );
}
