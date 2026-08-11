'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import {
  AlertTriangle,
  Boxes,
  ChevronLeft,
  ChevronRight,
  Download,
  IndianRupee,
  MapPin,
  PackageCheck,
  PackageX,
  Printer,
  Search,
} from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import type { InventoryBalance, InventoryItem, InventoryLocation } from '@/lib/inventory';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

type StockStatus = 'all' | 'in' | 'low' | 'out';
type SortMode = 'name' | 'available-desc' | 'available-asc' | 'value-desc';

type ItemStockRow = {
  item: InventoryItem;
  onHand: number;
  reserved: number;
  available: number;
  value: number;
  averageCost: number;
  locationCount: number;
  locationNames: string[];
};

const PAGE_SIZE = 25;

export default function ItemWiseInventoryPage() {
  const { user } = useAuth();
  const { can, isLoading: authorizationLoading } = useAuthorization();
  const { toast } = useToast();
  const organizationId = user?.organizationId || 'default';
  const canView = can('View Inventory', 'Store & Stock Management.Inventory')
    || can('View Inventory', 'Store & Stock Management.Projects');
  const canViewCost = can('View Cost', 'Store & Stock Management.Inventory')
    || can('View Inventory', 'Store & Stock Management.Projects');

  const [items, setItems] = useState<InventoryItem[]>([]);
  const [locations, setLocations] = useState<InventoryLocation[]>([]);
  const [balances, setBalances] = useState<InventoryBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [locationId, setLocationId] = useState('all');
  const [status, setStatus] = useState<StockStatus>('all');
  const [sort, setSort] = useState<SortMode>('name');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<ItemStockRow | null>(null);

  const load = useCallback(async () => {
    if (!user || authorizationLoading || !canView) {
      if (!authorizationLoading) setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError('');
    try {
      const [itemSnapshot, locationSnapshot, balanceSnapshot] = await Promise.all([
        getDocs(query(collection(db, 'inventoryItems'), where('organizationId', '==', organizationId))),
        getDocs(query(collection(db, 'inventoryLocations'), where('organizationId', '==', organizationId))),
        getDocs(query(collection(db, 'inventoryBalances'), where('organizationId', '==', organizationId))),
      ]);
      const accessibleLocations = locationSnapshot.docs
        .map((document) => ({ id: document.id, ...document.data() }) as InventoryLocation)
        .filter((location) => !location.allowedUserIds?.length || location.allowedUserIds.includes(user.id));
      const accessibleLocationIds = new Set(accessibleLocations.map((location) => location.id));
      setLocations(accessibleLocations.sort((a, b) => a.locationName.localeCompare(b.locationName)));
      setItems(itemSnapshot.docs
        .map((document) => ({ id: document.id, ...document.data() }) as InventoryItem)
        .filter((item) => item.active !== false && item.classification === 'Inventory'));
      setBalances(balanceSnapshot.docs
        .map((document) => ({ id: document.id, ...document.data() }) as InventoryBalance)
        .filter((balance) => accessibleLocationIds.has(balance.locationId)));
    } catch (error) {
      console.error('Unable to load item-wise inventory', error);
      setLoadError('Inventory balances could not be loaded. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [authorizationLoading, canView, organizationId, user]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [category, locationId, search, sort, status]);

  const locationMap = useMemo(
    () => new Map(locations.map((location) => [location.id, location])),
    [locations],
  );
  const categories = useMemo(
    () => Array.from(new Set(items.map((item) => item.category?.trim()).filter(Boolean) as string[])).sort(),
    [items],
  );

  const allRows = useMemo<ItemStockRow[]>(() => items.map((item) => {
    const itemBalances = balances.filter((balance) => balance.itemId === item.id);
    const onHand = itemBalances.reduce((sum, balance) => sum + Number(balance.onHandQuantity || 0), 0);
    const reserved = itemBalances.reduce((sum, balance) => sum + Number(balance.reservedQuantity || 0), 0);
    const available = itemBalances.reduce((sum, balance) => sum + Number(balance.availableQuantity || 0), 0);
    const value = itemBalances.reduce((sum, balance) => sum + Number(balance.inventoryValue || 0), 0);
    return {
      item,
      onHand,
      reserved,
      available,
      value,
      averageCost: onHand ? value / onHand : Number(item.costRate || 0),
      locationCount: itemBalances.filter((balance) => Number(balance.onHandQuantity || 0) !== 0).length,
      locationNames: itemBalances
        .filter((balance) => Number(balance.onHandQuantity || 0) !== 0)
        .map((balance) => locationMap.get(balance.locationId)?.locationName)
        .filter(Boolean) as string[],
    };
  }), [balances, items, locationMap]);

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const rows = allRows.filter((row) => {
      const balancesAtLocation = locationId === 'all'
        ? balances.filter((balance) => balance.itemId === row.item.id)
        : balances.filter((balance) => balance.itemId === row.item.id && balance.locationId === locationId);
      const onHand = balancesAtLocation.reduce((sum, balance) => sum + Number(balance.onHandQuantity || 0), 0);
      const reserved = balancesAtLocation.reduce((sum, balance) => sum + Number(balance.reservedQuantity || 0), 0);
      const available = balancesAtLocation.reduce((sum, balance) => sum + Number(balance.availableQuantity || 0), 0);
      const value = balancesAtLocation.reduce((sum, balance) => sum + Number(balance.inventoryValue || 0), 0);
      const searchable = [
        row.item.itemCode,
        row.item.itemName,
        row.item.description,
        row.item.category,
        row.item.subcategory,
        row.item.brand,
        row.item.barcode,
        row.item.partNumber,
        row.item.model,
      ];
      const matchesSearch = !term || searchable.some((entry) => entry?.toLowerCase().includes(term));
      const matchesCategory = category === 'all' || row.item.category === category;
      const matchesLocation = locationId === 'all' || balancesAtLocation.length > 0;
      const matchesStatus = status === 'all'
        || (status === 'out' && available <= 0)
        || (status === 'low' && available > 0 && available <= Number(row.item.reorderLevel || 0))
        || (status === 'in' && available > Number(row.item.reorderLevel || 0));
      if (!matchesSearch || !matchesCategory || !matchesLocation || !matchesStatus) return null;
      const locationNames = balancesAtLocation
        .filter((balance) => Number(balance.onHandQuantity || 0) !== 0)
        .map((balance) => locationMap.get(balance.locationId)?.locationName)
        .filter(Boolean) as string[];
      return {
        ...row,
        onHand,
        reserved,
        available,
        value,
        averageCost: onHand ? value / onHand : Number(row.item.costRate || 0),
        locationCount: locationNames.length,
        locationNames,
      };
    }).filter(Boolean) as ItemStockRow[];

    return rows.sort((a, b) => {
      if (sort === 'available-desc') return b.available - a.available;
      if (sort === 'available-asc') return a.available - b.available;
      if (sort === 'value-desc') return b.value - a.value;
      return a.item.itemName.localeCompare(b.item.itemName);
    });
  }, [allRows, balances, category, locationId, locationMap, search, sort, status]);

  const pageCount = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageRows = filteredRows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const totalOnHand = filteredRows.reduce((sum, row) => sum + row.onHand, 0);
  const totalReserved = filteredRows.reduce((sum, row) => sum + row.reserved, 0);
  const totalAvailable = filteredRows.reduce((sum, row) => sum + row.available, 0);
  const totalValue = filteredRows.reduce((sum, row) => sum + row.value, 0);
  const lowStock = allRows.filter((row) => row.available > 0 && row.available <= Number(row.item.reorderLevel || 0)).length;
  const outOfStock = allRows.filter((row) => row.available <= 0).length;

  const exportExcel = async () => {
    try {
      const ExcelJS = await import('exceljs');
      const workbook = new ExcelJS.Workbook();
      const summary = workbook.addWorksheet('Item-wise Stock');
      summary.columns = [
        { header: 'Item Code', key: 'code', width: 18 },
        { header: 'Item Name', key: 'name', width: 36 },
        { header: 'Category', key: 'category', width: 20 },
        { header: 'Unit', key: 'unit', width: 12 },
        { header: 'On Hand', key: 'onHand', width: 14 },
        { header: 'Reserved', key: 'reserved', width: 14 },
        { header: 'Available', key: 'available', width: 14 },
        { header: 'Locations', key: 'locations', width: 14 },
        ...(canViewCost ? [
          { header: 'Average Cost', key: 'averageCost', width: 16 },
          { header: 'Inventory Value', key: 'value', width: 18 },
        ] : []),
        { header: 'Stock Status', key: 'status', width: 16 },
      ];
      filteredRows.forEach((row) => summary.addRow({
        code: row.item.itemCode,
        name: row.item.itemName,
        category: row.item.category || '',
        unit: row.item.unit,
        onHand: row.onHand,
        reserved: row.reserved,
        available: row.available,
        locations: row.locationCount,
        averageCost: canViewCost ? row.averageCost : undefined,
        value: canViewCost ? row.value : undefined,
        status: stockStatus(row),
      }));

      const detail = workbook.addWorksheet('Stock by Location');
      detail.columns = [
        { header: 'Item Code', key: 'code', width: 18 },
        { header: 'Item Name', key: 'name', width: 36 },
        { header: 'Location Code', key: 'locationCode', width: 18 },
        { header: 'Location', key: 'location', width: 30 },
        { header: 'Location Type', key: 'locationType', width: 22 },
        { header: 'On Hand', key: 'onHand', width: 14 },
        { header: 'Reserved', key: 'reserved', width: 14 },
        { header: 'Available', key: 'available', width: 14 },
        ...(canViewCost ? [
          { header: 'Average Cost', key: 'averageCost', width: 16 },
          { header: 'Inventory Value', key: 'value', width: 18 },
        ] : []),
      ];
      const visibleItemIds = new Set(filteredRows.map((row) => row.item.id));
      balances
        .filter((balance) => visibleItemIds.has(balance.itemId) && (locationId === 'all' || balance.locationId === locationId))
        .forEach((balance) => {
          const item = items.find((entry) => entry.id === balance.itemId);
          const location = locationMap.get(balance.locationId);
          if (!item || !location) return;
          detail.addRow({
            code: item.itemCode,
            name: item.itemName,
            locationCode: location.locationCode,
            location: location.locationName,
            locationType: location.type,
            onHand: Number(balance.onHandQuantity || 0),
            reserved: Number(balance.reservedQuantity || 0),
            available: Number(balance.availableQuantity || 0),
            averageCost: canViewCost ? Number(balance.averageCost || 0) : undefined,
            value: canViewCost ? Number(balance.inventoryValue || 0) : undefined,
          });
        });
      [summary, detail].forEach((sheet) => {
        sheet.getRow(1).font = { bold: true };
        sheet.views = [{ state: 'frozen', ySplit: 1 }];
        sheet.autoFilter = { from: 'A1', to: sheet.getRow(1).getCell(sheet.columnCount).address };
      });
      const buffer = await workbook.xlsx.writeBuffer();
      const url = URL.createObjectURL(new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `item-wise-inventory-${new Date().toISOString().slice(0, 10)}.xlsx`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Unable to export item-wise inventory', error);
      toast({ title: 'Export failed', description: 'The item-wise workbook could not be generated.', variant: 'destructive' });
    }
  };

  if (authorizationLoading || loading) return <ItemWiseSkeleton />;
  if (!canView) {
    return <Card><CardHeader><CardTitle>Access denied</CardTitle><CardDescription>You do not have permission to view item-wise inventory.</CardDescription></CardHeader></Card>;
  }
  if (loadError) {
    return <Card><CardHeader><CardTitle>Unable to load inventory</CardTitle><CardDescription>{loadError}</CardDescription></CardHeader><CardContent><Button onClick={load}>Try again</Button></CardContent></Card>;
  }

  return (
    <div className="space-y-6 print:p-0">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-cyan-700"><Boxes className="h-4 w-4" />Inventory report</div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Item-wise inventory</h1>
          <p className="text-muted-foreground">Current stock for every item, consolidated across stores with location-level drill-down.</p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <Button variant="outline" onClick={() => window.print()}><Printer className="mr-2 h-4 w-4" />Print / PDF</Button>
          <Button onClick={exportExcel}><Download className="mr-2 h-4 w-4" />Export Excel</Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <Metric title="Filtered items" value={filteredRows.length.toLocaleString()} icon={Boxes} />
        <Metric title="On hand" value={formatQuantity(totalOnHand)} icon={PackageCheck} />
        <Metric title="Reserved" value={formatQuantity(totalReserved)} icon={AlertTriangle} />
        <Metric title="Available" value={formatQuantity(totalAvailable)} icon={MapPin} />
        <button className="text-left" onClick={() => setStatus(status === 'low' ? 'all' : 'low')}><Metric title="Low stock" value={lowStock.toLocaleString()} icon={AlertTriangle} active={status === 'low'} /></button>
        <button className="text-left" onClick={() => setStatus(status === 'out' ? 'all' : 'out')}><Metric title="Out of stock" value={outOfStock.toLocaleString()} icon={PackageX} active={status === 'out'} /></button>
      </div>

      {canViewCost && (
        <Card className="border-emerald-200 bg-gradient-to-r from-emerald-50 to-teal-50">
          <CardContent className="flex items-center justify-between gap-4 p-5">
            <div><p className="text-sm font-medium text-emerald-800">Filtered inventory value</p><p className="mt-1 text-2xl font-bold text-emerald-950">{formatCurrency(totalValue)}</p></div>
            <div className="rounded-full bg-white p-3 shadow-sm"><IndianRupee className="h-5 w-5 text-emerald-700" /></div>
          </CardContent>
        </Card>
      )}

      <Card className="print:hidden">
        <CardHeader><CardTitle>Filters</CardTitle><CardDescription>Filter the item register without changing the underlying inventory balance.</CardDescription></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <Field label="Search item">
            <div className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Code, name, barcode, part…" /></div>
          </Field>
          <Field label="Category">
            <Select value={category} onValueChange={setCategory}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All categories</SelectItem>{categories.map((entry) => <SelectItem key={entry} value={entry}>{entry}</SelectItem>)}</SelectContent></Select>
          </Field>
          <Field label="Location">
            <Select value={locationId} onValueChange={setLocationId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All accessible locations</SelectItem>{locations.map((location) => <SelectItem key={location.id} value={location.id}>{location.locationCode} · {location.locationName}</SelectItem>)}</SelectContent></Select>
          </Field>
          <Field label="Stock status">
            <Select value={status} onValueChange={(value: StockStatus) => setStatus(value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All statuses</SelectItem><SelectItem value="in">In stock</SelectItem><SelectItem value="low">Low stock</SelectItem><SelectItem value="out">Out of stock</SelectItem></SelectContent></Select>
          </Field>
          <Field label="Sort by">
            <Select value={sort} onValueChange={(value: SortMode) => setSort(value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="name">Item name</SelectItem><SelectItem value="available-desc">Available: high to low</SelectItem><SelectItem value="available-asc">Available: low to high</SelectItem>{canViewCost && <SelectItem value="value-desc">Value: high to low</SelectItem>}</SelectContent></Select>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div><CardTitle>Item stock register</CardTitle><CardDescription>{filteredRows.length} item(s) · click a row for stock availability by location</CardDescription></div>
          {(search || category !== 'all' || locationId !== 'all' || status !== 'all') && <Button className="print:hidden" variant="ghost" onClick={() => { setSearch(''); setCategory('all'); setLocationId('all'); setStatus('all'); }}>Clear filters</Button>}
        </CardHeader>
        <CardContent className="overflow-x-auto p-0 sm:p-0">
          <Table>
            <TableHeader><TableRow><TableHead className="pl-6">Item</TableHead><TableHead>Category / brand</TableHead><TableHead className="text-right">On hand</TableHead><TableHead className="text-right">Reserved</TableHead><TableHead className="text-right">Available</TableHead><TableHead>Locations</TableHead>{canViewCost && <><TableHead className="text-right">Avg. cost</TableHead><TableHead className="text-right">Value</TableHead></>}<TableHead className="pr-6">Status</TableHead></TableRow></TableHeader>
            <TableBody>
              {pageRows.map((row) => {
                const label = stockStatus(row);
                return <TableRow key={row.item.id} className="cursor-pointer hover:bg-cyan-50/50" onClick={() => setSelected(row)}>
                  <TableCell className="pl-6"><div className="font-semibold">{row.item.itemName}</div><div className="text-xs text-muted-foreground">{row.item.itemCode} · {row.item.unit}{row.item.partNumber ? ` · Part ${row.item.partNumber}` : ''}</div></TableCell>
                  <TableCell><div>{row.item.category || 'Uncategorized'}</div><div className="text-xs text-muted-foreground">{row.item.brand || 'No brand'}</div></TableCell>
                  <TableCell className="text-right tabular-nums">{formatQuantity(row.onHand)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatQuantity(row.reserved)}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{formatQuantity(row.available)}</TableCell>
                  <TableCell><div>{row.locationCount}</div><div className="max-w-48 truncate text-xs text-muted-foreground">{row.locationNames.join(', ') || 'No stock location'}</div></TableCell>
                  {canViewCost && <><TableCell className="text-right tabular-nums">{formatCurrency(row.averageCost)}</TableCell><TableCell className="text-right font-medium tabular-nums">{formatCurrency(row.value)}</TableCell></>}
                  <TableCell className="pr-6"><StatusBadge status={label} /></TableCell>
                </TableRow>;
              })}
              {!pageRows.length && <TableRow><TableCell colSpan={canViewCost ? 9 : 7} className="h-32 text-center text-muted-foreground">No items match the selected filters.</TableCell></TableRow>}
            </TableBody>
          </Table>
          {filteredRows.length > PAGE_SIZE && (
            <div className="flex items-center justify-between border-t px-6 py-4 print:hidden">
              <p className="text-sm text-muted-foreground">Showing {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filteredRows.length)} of {filteredRows.length}</p>
              <div className="flex items-center gap-2"><Button variant="outline" size="sm" disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft className="h-4 w-4" /></Button><span className="text-sm font-medium">Page {currentPage} of {pageCount}</span><Button variant="outline" size="sm" disabled={currentPage >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}><ChevronRight className="h-4 w-4" /></Button></div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent size="xl">
          <DialogHeader><DialogTitle>{selected?.item.itemName}</DialogTitle><DialogDescription>{selected?.item.itemCode} · {selected?.item.unit} · availability at every location you can access</DialogDescription></DialogHeader>
          {selected && <div className="grid gap-3 sm:grid-cols-4"><MiniMetric label="Network on hand" value={formatQuantity(allRows.find((row) => row.item.id === selected.item.id)?.onHand || 0)} /><MiniMetric label="Reserved" value={formatQuantity(allRows.find((row) => row.item.id === selected.item.id)?.reserved || 0)} /><MiniMetric label="Available" value={formatQuantity(allRows.find((row) => row.item.id === selected.item.id)?.available || 0)} />{canViewCost && <MiniMetric label="Network value" value={formatCurrency(allRows.find((row) => row.item.id === selected.item.id)?.value || 0)} />}</div>}
          <div className="max-h-[55vh] overflow-auto rounded-xl border">
            <Table><TableHeader><TableRow><TableHead>Location</TableHead><TableHead>Owner</TableHead><TableHead className="text-right">On hand</TableHead><TableHead className="text-right">Reserved</TableHead><TableHead className="text-right">Available</TableHead>{canViewCost && <><TableHead className="text-right">Average cost</TableHead><TableHead className="text-right">Value</TableHead></>}</TableRow></TableHeader>
              <TableBody>{selected && balances.filter((balance) => balance.itemId === selected.item.id).map((balance) => {
                const location = locationMap.get(balance.locationId);
                if (!location) return null;
                return <TableRow key={balance.id}><TableCell><div className="font-medium">{location.locationName}</div><div className="text-xs text-muted-foreground">{location.locationCode} · {location.type}{location.binOrRack ? ` · ${location.binOrRack}` : ''}</div></TableCell><TableCell>{location.propertyName || location.projectName || 'Organization'}</TableCell><TableCell className="text-right tabular-nums">{formatQuantity(balance.onHandQuantity)}</TableCell><TableCell className="text-right tabular-nums">{formatQuantity(balance.reservedQuantity)}</TableCell><TableCell className="text-right font-medium tabular-nums">{formatQuantity(balance.availableQuantity)}</TableCell>{canViewCost && <><TableCell className="text-right tabular-nums">{formatCurrency(balance.averageCost)}</TableCell><TableCell className="text-right tabular-nums">{formatCurrency(balance.inventoryValue)}</TableCell></>}</TableRow>;
              })}{selected && !balances.some((balance) => balance.itemId === selected.item.id) && <TableRow><TableCell colSpan={canViewCost ? 7 : 5} className="h-24 text-center text-muted-foreground">This item has no posted balance yet.</TableCell></TableRow>}</TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function stockStatus(row: ItemStockRow) {
  if (row.available <= 0) return 'Out of stock';
  if (row.available <= Number(row.item.reorderLevel || 0)) return 'Low stock';
  return 'In stock';
}

function StatusBadge({ status }: { status: string }) {
  return <Badge variant={status === 'In stock' ? 'default' : 'destructive'} className={status === 'Low stock' ? 'bg-amber-500 hover:bg-amber-500' : ''}>{status}</Badge>;
}

function formatQuantity(value: number) {
  return Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });
}

function formatCurrency(value: number) {
  return `₹${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label>{label}</Label>{children}</div>;
}

function Metric({ title, value, icon: Icon, active }: { title: string; value: string; icon: typeof Boxes; active?: boolean }) {
  return <Card className={active ? 'border-cyan-500 ring-1 ring-cyan-500' : ''}><CardContent className="flex h-full items-center justify-between gap-3 p-5"><div><p className="text-sm text-muted-foreground">{title}</p><p className="mt-1 text-2xl font-bold">{value}</p></div><div className="rounded-full bg-cyan-50 p-3"><Icon className="h-5 w-5 text-cyan-700" /></div></CardContent></Card>;
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border bg-slate-50 p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-lg font-bold">{value}</p></div>;
}

function ItemWiseSkeleton() {
  return <div className="space-y-6"><Skeleton className="h-12 w-72" /><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">{Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-28" />)}</div><Skeleton className="h-32" /><Skeleton className="h-96" /></div>;
}
