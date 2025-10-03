
'use client';

import { useState, useEffect, useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, DropdownMenuCheckboxItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { MoreHorizontal, PlusCircle, MinusCircle, Search, Columns3 } from 'lucide-react';
import { cn } from '@/lib/utils';

// Mock data - replace with actual data fetching
const mockTransactions = [
  { id: '1', date: '2025-09-26T19:46:00', type: 'Conversion', sku: 'PG-001-EA', quantity: 10, cost: null, details: null, notes: 'Converted from 1 Box' },
  { id: '2', date: '2025-09-26T19:46:00', type: 'Conversion', sku: 'PG-001', quantity: -1, cost: null, details: null, notes: 'Converted to 10 Each' },
  { id: '3', date: '2023-11-01T15:00:00', type: 'Transfer', sku: 'DD-305', quantity: -15, cost: null, details: null, notes: 'Transfer to Site B' },
  { id: '4', date: '2023-11-01T11:00:00', type: 'Goods Issue', sku: 'LC-003', quantity: -30, cost: null, details: 'Order: CUST-C-101', notes: '' },
  { id: '5', date: '2023-10-31T10:00:00', type: 'Goods Receipt', sku: 'HG-001', quantity: 40, cost: 195.00, details: 'Supplier: Heavy Duty Inc.\nPO: PO-125\nInvoice: INV-003\nBatch: B003', notes: '' },
  { id: '6', date: '2023-10-30T13:20:00', type: 'Return', sku: 'SW-042', quantity: 5, cost: null, details: null, notes: 'Customer return' },
  { id: '7', date: '2023-10-29T08:00:00', type: 'Goods Issue', sku: 'PG-001', quantity: -15, cost: null, details: 'Order: CUST-B-92', notes: '' },
  { id: '8', date: '2023-10-28T16:45:00', type: 'Adjustment', sku: 'CW-007', quantity: -2, cost: null, details: null, notes: 'Stock count correction' },
];

const allColumns = ['Cost', 'Details', 'Notes'];

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>({
    'Cost': true,
    'Details': true,
    'Notes': true,
  });

  useEffect(() => {
    const timer = setTimeout(() => {
      setTransactions(mockTransactions);
      setIsLoading(false);
    }, 1500);

    return () => clearTimeout(timer);
  }, []);

  const filteredTransactions = useMemo(() => {
    return transactions.filter(t => t.sku.toLowerCase().includes(searchTerm.toLowerCase()));
  }, [transactions, searchTerm]);
  
  const getBadgeVariant = (type: string) => {
    switch (type) {
        case 'Goods Receipt':
        case 'Return':
            return 'default';
        case 'Goods Issue':
            return 'destructive';
        case 'Conversion':
        case 'Transfer':
        case 'Adjustment':
        default:
            return 'secondary';
    }
  }

  return (
    <div>
      <h1 className="text-3xl font-bold mb-6">Transactions</h1>
      <Card>
        <CardHeader>
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <CardTitle>Movement History</CardTitle>
                    <CardDescription>A complete log of all stock movements and transactions.</CardDescription>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline"><PlusCircle className="mr-2 h-4 w-4" /> Stock In</Button>
                    <Button variant="outline"><MinusCircle className="mr-2 h-4 w-4" /> Stock Out</Button>
                </div>
            </div>
            <div className="mt-4 flex items-center gap-2">
                <div className="relative flex-grow">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Filter by SKU..."
                        className="pl-8"
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                    />
                </div>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="outline">
                            <Columns3 className="mr-2 h-4 w-4" />
                            Columns
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        <DropdownMenuLabel>Toggle Columns</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        {allColumns.map(col => (
                            <DropdownMenuCheckboxItem
                                key={col}
                                checked={columnVisibility[col]}
                                onCheckedChange={(checked) => setColumnVisibility(prev => ({...prev, [col]: !!checked}))}
                            >
                                {col}
                            </DropdownMenuCheckboxItem>
                        ))}
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Item SKU</TableHead>
                <TableHead>Quantity</TableHead>
                {columnVisibility['Cost'] && <TableHead>Cost</TableHead>}
                {columnVisibility['Details'] && <TableHead>Details</TableHead>}
                {columnVisibility['Notes'] && <TableHead>Notes</TableHead>}
                <TableHead className="w-[50px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={8}>
                      <Skeleton className="h-6 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : filteredTransactions.length > 0 ? (
                filteredTransactions.map(t => (
                  <TableRow key={t.id}>
                    <TableCell className="text-sm">
                        {new Date(t.date).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                        <br/>
                        <span className="text-xs text-muted-foreground">{new Date(t.date).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}</span>
                    </TableCell>
                    <TableCell><Badge variant={getBadgeVariant(t.type)}>{t.type}</Badge></TableCell>
                    <TableCell>{t.sku}</TableCell>
                    <TableCell className={cn("font-semibold", t.quantity > 0 ? 'text-green-600' : 'text-red-600')}>
                        {t.quantity > 0 ? `+${t.quantity}` : t.quantity}
                    </TableCell>
                    {columnVisibility['Cost'] && <TableCell>{t.cost ? `$${t.cost.toFixed(2)}` : ''}</TableCell>}
                    {columnVisibility['Details'] && <TableCell className="text-xs whitespace-pre-wrap">{t.details}</TableCell>}
                    {columnVisibility['Notes'] && <TableCell>{t.notes}</TableCell>}
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4"/></Button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem>View Details</DropdownMenuItem>
                          <DropdownMenuItem>Edit</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={8} className="text-center h-24">
                    No transactions found.
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
