'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { Download, Printer, Search } from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/auth/AuthProvider';
import { asDateInput, type InventoryItem, type InventoryLocation, type StockLedgerEntry } from '@/lib/inventory';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export default function StockLedgerPage() {
  const { user } = useAuth();
  const organizationId = user?.organizationId || 'default';
  const [ledger, setLedger] = useState<StockLedgerEntry[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [locations, setLocations] = useState<InventoryLocation[]>([]);
  const [from, setFrom] = useState(`${new Date().getFullYear()}-01-01`);
  const [to, setTo] = useState(asDateInput());
  const [itemId, setItemId] = useState('all');
  const [locationId, setLocationId] = useState('all');
  const [transactionType, setTransactionType] = useState('all');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    const [ledgerSnapshot, itemSnapshot, locationSnapshot] = await Promise.all([
      getDocs(query(collection(db, 'stockLedger'), where('organizationId', '==', organizationId))),
      getDocs(query(collection(db, 'inventoryItems'), where('organizationId', '==', organizationId))),
      getDocs(query(collection(db, 'inventoryLocations'), where('organizationId', '==', organizationId))),
    ]);
    const accessible = locationSnapshot.docs.map((document) => ({ id: document.id, ...document.data() }) as InventoryLocation).filter((location) => !location.allowedUserIds?.length || location.allowedUserIds.includes(user?.id || ''));
    const allowed = new Set(accessible.map((location) => location.id));
    setLocations(accessible);
    setItems(itemSnapshot.docs.map((document) => ({ id: document.id, ...document.data() }) as InventoryItem));
    setLedger(ledgerSnapshot.docs.map((document) => ({ id: document.id, ...document.data() }) as StockLedgerEntry).filter((entry) => allowed.has(entry.locationId)));
  }, [organizationId, user?.id]);
  useEffect(() => { load().catch(console.error); }, [load]);

  const types = useMemo(() => Array.from(new Set(ledger.map((entry) => entry.transactionType))).sort(), [ledger]);
  const filtered = useMemo(() => ledger.filter((entry) => {
    const term = search.toLowerCase().trim();
    return entry.transactionDate >= from && entry.transactionDate <= to
      && (itemId === 'all' || entry.itemId === itemId)
      && (locationId === 'all' || entry.locationId === locationId)
      && (transactionType === 'all' || entry.transactionType === transactionType)
      && (!term || [entry.documentNumber, entry.itemCode, entry.itemName, entry.referenceDocument].some((value) => value?.toLowerCase().includes(term)));
  }).sort((a, b) => b.transactionDate.localeCompare(a.transactionDate) || b.documentNumber.localeCompare(a.documentNumber)), [from, itemId, ledger, locationId, search, to, transactionType]);

  const totalIn = filtered.reduce((sum, entry) => sum + Number(entry.quantityIn || 0), 0);
  const totalOut = filtered.reduce((sum, entry) => sum + Number(entry.quantityOut || 0), 0);
  const totalValue = filtered.reduce((sum, entry) => sum + Number(entry.totalValue || 0), 0);

  const exportExcel = async () => {
    const ExcelJS = await import('exceljs');
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Stock Ledger');
    sheet.columns = [
      { header: 'Date', key: 'date', width: 14 }, { header: 'Document', key: 'document', width: 20 },
      { header: 'Transaction Type', key: 'type', width: 28 }, { header: 'Item Code', key: 'code', width: 18 },
      { header: 'Item Name', key: 'item', width: 40 }, { header: 'Location', key: 'location', width: 30 },
      { header: 'Quantity In', key: 'in', width: 15 }, { header: 'Quantity Out', key: 'out', width: 15 },
      { header: 'Unit', key: 'unit', width: 12 }, { header: 'Cost Rate', key: 'rate', width: 15 },
      { header: 'Value', key: 'value', width: 18 }, { header: 'Balance After', key: 'balance', width: 16 },
      { header: 'Reference', key: 'reference', width: 24 }, { header: 'Remarks', key: 'remarks', width: 40 },
    ];
    filtered.forEach((entry) => sheet.addRow({ date: entry.transactionDate, document: entry.documentNumber, type: entry.transactionType, code: entry.itemCode, item: entry.itemName, location: entry.locationName, in: entry.quantityIn, out: entry.quantityOut, unit: entry.unit, rate: entry.costRate, value: entry.totalValue, balance: entry.balanceAfter, reference: entry.referenceDocument || '', remarks: entry.remarks || '' }));
    sheet.getRow(1).font = { bold: true };
    sheet.autoFilter = { from: 'A1', to: 'N1' };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    const buffer = await workbook.xlsx.writeBuffer();
    const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `stock-ledger-${from}-to-${to}.xlsx`; anchor.click(); URL.revokeObjectURL(url);
  };

  return <div className="space-y-6 print:p-0"><div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h1 className="text-2xl font-bold">Stock ledger & movement report</h1><p className="text-muted-foreground">Every posted quantity and value movement, filterable by date, item, location, and transaction.</p></div><div className="flex gap-2 print:hidden"><Button variant="outline" onClick={() => window.print()}><Printer className="mr-2 h-4 w-4" />Print / PDF</Button><Button onClick={exportExcel}><Download className="mr-2 h-4 w-4" />Excel</Button></div></div>
    <Card className="print:hidden"><CardHeader><CardTitle>Report filters</CardTitle></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6"><Field label="From"><Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></Field><Field label="To"><Input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></Field><Field label="Item"><Select value={itemId} onValueChange={setItemId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All items</SelectItem>{items.map((item) => <SelectItem key={item.id} value={item.id}>{item.itemCode} · {item.itemName}</SelectItem>)}</SelectContent></Select></Field><Field label="Location"><Select value={locationId} onValueChange={setLocationId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All locations</SelectItem>{locations.map((location) => <SelectItem key={location.id} value={location.id}>{location.locationCode} · {location.locationName}</SelectItem>)}</SelectContent></Select></Field><Field label="Transaction"><Select value={transactionType} onValueChange={setTransactionType}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All types</SelectItem>{types.map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}</SelectContent></Select></Field><Field label="Document / item"><div className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} /></div></Field></CardContent></Card>
    <div className="grid gap-4 sm:grid-cols-3"><Summary label="Quantity in" value={totalIn.toLocaleString()} /><Summary label="Quantity out" value={totalOut.toLocaleString()} /><Summary label="Movement value" value={`₹${totalValue.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`} /></div>
    <Card><CardHeader><CardTitle>Ledger entries</CardTitle><CardDescription>{filtered.length} entries</CardDescription></CardHeader><CardContent className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Date / document</TableHead><TableHead>Transaction</TableHead><TableHead>Item</TableHead><TableHead>Location</TableHead><TableHead className="text-right">In</TableHead><TableHead className="text-right">Out</TableHead><TableHead className="text-right">Rate</TableHead><TableHead className="text-right">Value</TableHead><TableHead className="text-right">Balance</TableHead></TableRow></TableHeader><TableBody>{filtered.map((entry) => <TableRow key={entry.id}><TableCell><div>{entry.transactionDate}</div><div className="font-mono text-xs text-muted-foreground">{entry.documentNumber}</div></TableCell><TableCell>{entry.transactionType}</TableCell><TableCell><div className="font-medium">{entry.itemName}</div><div className="text-xs text-muted-foreground">{entry.itemCode} · {entry.unit}</div></TableCell><TableCell>{entry.locationName}</TableCell><TableCell className="text-right tabular-nums text-emerald-700">{entry.quantityIn || '—'}</TableCell><TableCell className="text-right tabular-nums text-destructive">{entry.quantityOut || '—'}</TableCell><TableCell className="text-right">₹{Number(entry.costRate || 0).toLocaleString('en-IN')}</TableCell><TableCell className="text-right">₹{Number(entry.totalValue || 0).toLocaleString('en-IN')}</TableCell><TableCell className="text-right font-medium">{entry.balanceAfter}</TableCell></TableRow>)}{!filtered.length && <TableRow><TableCell colSpan={9} className="h-28 text-center text-muted-foreground">No ledger movements match the selected filters.</TableCell></TableRow>}</TableBody></Table></CardContent></Card>
  </div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <div className="space-y-1.5"><Label>{label}</Label>{children}</div>; }
function Summary({ label, value }: { label: string; value: string }) { return <Card><CardContent className="p-5"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-bold">{value}</p></CardContent></Card>; }

