
'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, Upload, Plus, ArrowUpDown, MoreHorizontal, Calendar as CalendarIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import type { DailyRequisitionEntry } from '@/lib/types';

// Mock Data
const mockData: DailyRequisitionEntry[] = [
  { id: '1', createdAt: '28/08/2025 5:47 PM', receptionNo: 'SEL\\REC\\2025-26\\7339', date: 'August 28th, 2025', project: 'TPSODL', department: 'HR', narration: 'ugfhkjfkkjgfh', grossAmount: 365413.00, netAmount: 654646.00 },
  { id: '2', createdAt: '28/08/2025 3:38 PM', receptionNo: 'SEL/2025-26/1', date: 'April 1st, 2025', project: 'TPNODL-ARADI', department: 'PROJECT', narration: 'DIBYENDU SAHOO', grossAmount: 5500.00, netAmount: 5500.00 },
  { id: '3', createdAt: '28/08/2025 3:38 PM', receptionNo: 'SEL/2025-26/2', date: 'April 2nd, 2025', project: 'HO', department: 'ADMIN', narration: 'PAYMENT TOWARDS KOLKATA FL...', grossAmount: 8200.00, netAmount: 8200.00 },
  { id: '4', createdAt: '28/08/2025 3:38 PM', receptionNo: 'SEL/2025-26/3', date: 'April 2nd, 2025', project: 'HO', department: 'ADMIN', narration: 'PAYMENT TOWARDS DURGA ELE...', grossAmount: 6533.00, netAmount: 6533.00 },
  { id: '5', createdAt: '28/08/2025 3:38 PM', receptionNo: 'SEL/2025-26/4', date: 'April 3rd, 2025', project: 'ODSSP PURI', department: 'FINANCE', narration: 'H A MARBLES', grossAmount: 6588.85, netAmount: 7775.00 },
  { id: '6', createdAt: '28/08/2025 3:38 PM', receptionNo: 'SEL/2025-26/5', date: 'April 3rd, 2025', project: 'HO', department: 'IT', narration: 'MT CREATIONS', grossAmount: 3200.00, netAmount: 3200.00 },
];

type SortKey = keyof DailyRequisitionEntry | '';

export default function EntrySheetPage() {
  const [entries, setEntries] = useState<DailyRequisitionEntry[]>(mockData);
  const [sortKey, setSortKey] = useState<SortKey>('createdAt');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [filterText, setFilterText] = useState('');
  const [date, setDate] = useState<Date>();

  const sortedEntries = useMemo(() => {
    let sortableEntries = [...entries];
    if (sortKey) {
      sortableEntries.sort((a, b) => {
        if (a[sortKey] < b[sortKey]) {
          return sortDirection === 'asc' ? -1 : 1;
        }
        if (a[sortKey] > b[sortKey]) {
          return sortDirection === 'asc' ? 1 : -1;
        }
        return 0;
      });
    }
    return sortableEntries.filter(entry => 
      Object.values(entry).some(value => 
        String(value).toLowerCase().includes(filterText.toLowerCase())
      )
    );
  }, [entries, sortKey, sortDirection, filterText]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDirection('asc');
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);
  };
  
  const headers: { key: SortKey; label: string }[] = [
    { key: 'createdAt', label: 'Created At' },
    { key: 'receptionNo', label: 'Reception No.' },
    { key: 'date', label: 'Date' },
    { key: 'project', label: 'Project' },
    { key: 'department', label: 'Department' },
    { key: 'narration', label: 'Narration' },
    { key: 'grossAmount', label: 'Gross Amount' },
    { key: 'netAmount', label: 'Net Amount' },
  ];

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link href="/daily-requisition">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-6 w-6" />
            </Button>
          </Link>
          <h1 className="text-2xl font-bold">Entry Sheet</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline">
            <Upload className="mr-2 h-4 w-4" />
            Import from Excel
          </Button>
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Add New Entry
          </Button>
        </div>
      </div>
      
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Total Entries: {entries.length}</h2>
        <div className="flex items-center gap-2">
            <Popover>
                <PopoverTrigger asChild>
                <Button
                    variant={"outline"}
                    className={cn(
                    "w-[240px] justify-start text-left font-normal",
                    !date && "text-muted-foreground"
                    )}
                >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {date ? "Date selected" : "Filter by date"}
                </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                    mode="single"
                    selected={date}
                    onSelect={setDate}
                    initialFocus
                />
                </PopoverContent>
            </Popover>
           <Input 
                placeholder="Filter entries..." 
                className="w-64"
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
            />
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {headers.map(header => (
                     <TableHead key={header.key} onClick={() => handleSort(header.key)}>
                        <div className="flex items-center cursor-pointer">
                            {header.label}
                            {sortKey === header.key && <ArrowUpDown className="ml-2 h-4 w-4" />}
                        </div>
                     </TableHead>
                  ))}
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedEntries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell>{entry.createdAt}</TableCell>
                    <TableCell>{entry.receptionNo}</TableCell>
                    <TableCell>{entry.date}</TableCell>
                    <TableCell>{entry.project}</TableCell>
                    <TableCell>{entry.department}</TableCell>
                    <TableCell>{entry.narration}</TableCell>
                    <TableCell>{formatCurrency(entry.grossAmount)}</TableCell>
                    <TableCell>{formatCurrency(entry.netAmount)}</TableCell>
                    <TableCell>
                       <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem>View</DropdownMenuItem>
                          <DropdownMenuItem>Edit</DropdownMenuItem>
                          <DropdownMenuItem className="text-destructive">Delete</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
      
       <div className="flex items-center justify-between space-x-2 py-4">
        <p className="text-sm text-muted-foreground">Page 1 of 164</p>
        <div className="space-x-2">
            <Button variant="outline" size="sm">Previous</Button>
            <Button variant="outline" size="sm">Next</Button>
        </div>
      </div>

    </div>
  );
}
