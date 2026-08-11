'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { AlertTriangle, Boxes, IndianRupee, PackageCheck, PackageX, Search } from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { InventoryBalance, InventoryItem, InventoryLocation } from '@/lib/inventory';

type ItemRow = InventoryItem & { onHand: number; reserved: number; available: number; value: number; locations: number };

export default function InventoryDashboardPage() {
  const { user } = useAuth();
  const { can, isLoading: authLoading } = useAuthorization();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [locations, setLocations] = useState<InventoryLocation[]>([]);
  const [balances, setBalances] = useState<InventoryBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'low' | 'out'>('all');
  const [selected, setSelected] = useState<ItemRow | null>(null);
  const organizationId = user?.organizationId || 'default';
  const canView = can('View Inventory', 'Store & Stock Management.Inventory')
    || can('View Inventory', 'Store & Stock Management.Projects');
  const canViewCost = can('View Cost', 'Store & Stock Management.Inventory')
    || can('View Inventory', 'Store & Stock Management.Projects');

  useEffect(() => {
    if (!user || authLoading || !canView) {
      if (!authLoading) setLoading(false);
      return;
    }
    let active = true;
    const load = async () => {
      try {
        const [itemSnapshot, locationSnapshot, balanceSnapshot] = await Promise.all([
          getDocs(query(collection(db, 'inventoryItems'), where('organizationId', '==', organizationId))),
          getDocs(query(collection(db, 'inventoryLocations'), where('organizationId', '==', organizationId))),
          getDocs(query(collection(db, 'inventoryBalances'), where('organizationId', '==', organizationId))),
        ]);
        if (!active) return;
        const accessibleLocations = locationSnapshot.docs
          .map((document) => ({ id: document.id, ...document.data() }) as InventoryLocation)
          .filter((location) => !location.allowedUserIds?.length || location.allowedUserIds.includes(user.id));
        const locationIds = new Set(accessibleLocations.map((location) => location.id));
        setItems(itemSnapshot.docs.map((document) => ({ id: document.id, ...document.data() }) as InventoryItem));
        setLocations(accessibleLocations);
        setBalances(balanceSnapshot.docs
          .map((document) => ({ id: document.id, ...document.data() }) as InventoryBalance)
          .filter((balance) => locationIds.has(balance.locationId)));
      } catch (error) {
        console.error('Unable to load inventory dashboard', error);
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => { active = false; };
  }, [authLoading, canView, organizationId, user]);

  const rows = useMemo<ItemRow[]>(() => items.filter((item) => item.active !== false && item.classification === 'Inventory').map((item) => {
    const itemBalances = balances.filter((balance) => balance.itemId === item.id);
    return {
      ...item,
      onHand: itemBalances.reduce((sum, balance) => sum + Number(balance.onHandQuantity || 0), 0),
      reserved: itemBalances.reduce((sum, balance) => sum + Number(balance.reservedQuantity || 0), 0),
      available: itemBalances.reduce((sum, balance) => sum + Number(balance.availableQuantity || 0), 0),
      value: itemBalances.reduce((sum, balance) => sum + Number(balance.inventoryValue || 0), 0),
      locations: itemBalances.filter((balance) => Number(balance.onHandQuantity || 0) !== 0).length,
    };
  }), [balances, items]);

  const filteredRows = useMemo(() => rows.filter((row) => {
    const term = search.toLowerCase().trim();
    const matchesSearch = !term || [row.itemCode, row.itemName, row.category, row.brand, row.barcode].some((value) => value?.toLowerCase().includes(term));
    const matchesFilter = filter === 'all' || (filter === 'out' ? row.available <= 0 : row.available > 0 && row.available <= row.reorderLevel);
    return matchesSearch && matchesFilter;
  }), [filter, rows, search]);

  const totalValue = rows.reduce((sum, row) => sum + row.value, 0);
  const low = rows.filter((row) => row.available > 0 && row.available <= row.reorderLevel).length;
  const out = rows.filter((row) => row.available <= 0).length;

  if (authLoading || loading) return <DashboardSkeleton />;
  if (!canView) {
    return <Card><CardHeader><CardTitle>Access denied</CardTitle><CardDescription>You do not have permission to view inventory.</CardDescription></CardHeader></Card>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Inventory control</h1>
          <p className="text-muted-foreground">Item- and location-wise stock derived from posted ledger movements.</p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline"><Link href="/store-stock-management/inventory/transfers">New transfer</Link></Button>
          <Button asChild><Link href="/store-stock-management/inventory/movements">Post movement</Link></Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Metric title="Inventory value" value={canViewCost ? `₹${totalValue.toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : 'Restricted'} icon={IndianRupee} />
        <Metric title="Active items" value={rows.length.toLocaleString()} icon={Boxes} />
        <Metric title="Locations" value={locations.filter((location) => location.active).length.toLocaleString()} icon={PackageCheck} />
        <button className="text-left" onClick={() => setFilter(filter === 'low' ? 'all' : 'low')}><Metric title="Low stock" value={low.toLocaleString()} icon={AlertTriangle} active={filter === 'low'} /></button>
        <button className="text-left" onClick={() => setFilter(filter === 'out' ? 'all' : 'out')}><Metric title="Out of stock" value={out.toLocaleString()} icon={PackageX} active={filter === 'out'} /></button>
      </div>

      <Card>
        <CardHeader className="gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div><CardTitle>Network stock</CardTitle><CardDescription>Click an item to see availability at every authorized location.</CardDescription></div>
          <div className="relative w-full sm:w-80"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search code, item, category…" className="pl-9" /></div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow><TableHead>Item</TableHead><TableHead>Category</TableHead><TableHead className="text-right">On hand</TableHead><TableHead className="text-right">Reserved</TableHead><TableHead className="text-right">Available</TableHead><TableHead>Locations</TableHead>{canViewCost && <TableHead className="text-right">Value</TableHead>}<TableHead>Status</TableHead></TableRow></TableHeader>
            <TableBody>
              {filteredRows.map((row) => {
                const status = row.available <= 0 ? 'Out of stock' : row.available <= row.reorderLevel ? 'Low stock' : 'In stock';
                return (
                  <TableRow key={row.id} className="cursor-pointer" onClick={() => setSelected(row)}>
                    <TableCell><div className="font-medium">{row.itemName}</div><div className="text-xs text-muted-foreground">{row.itemCode} · {row.unit}</div></TableCell>
                    <TableCell>{row.category || '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.onHand.toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.reserved.toLocaleString()}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{row.available.toLocaleString()}</TableCell>
                    <TableCell>{row.locations}</TableCell>
                    {canViewCost && <TableCell className="text-right tabular-nums">₹{row.value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</TableCell>}
                    <TableCell><Badge variant={status === 'In stock' ? 'default' : 'destructive'}>{status}</Badge></TableCell>
                  </TableRow>
                );
              })}
              {!filteredRows.length && <TableRow><TableCell colSpan={canViewCost ? 8 : 7} className="h-28 text-center text-muted-foreground">No items match this view. Add Item Master records and post opening stock to begin.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>{selected?.itemName}</DialogTitle><DialogDescription>{selected?.itemCode} · availability across locations you can access</DialogDescription></DialogHeader>
          <Table><TableHeader><TableRow><TableHead>Location</TableHead><TableHead>Type</TableHead><TableHead className="text-right">On hand</TableHead><TableHead className="text-right">Reserved</TableHead><TableHead className="text-right">Available</TableHead></TableRow></TableHeader>
            <TableBody>{selected && balances.filter((balance) => balance.itemId === selected.id).map((balance) => {
              const location = locations.find((entry) => entry.id === balance.locationId);
              if (!location) return null;
              return <TableRow key={balance.id}><TableCell><div className="font-medium">{location.locationName}</div><div className="text-xs text-muted-foreground">{location.locationCode}</div></TableCell><TableCell>{location.type}</TableCell><TableCell className="text-right">{balance.onHandQuantity}</TableCell><TableCell className="text-right">{balance.reservedQuantity}</TableCell><TableCell className="text-right font-medium">{balance.availableQuantity}</TableCell></TableRow>;
            })}</TableBody>
          </Table>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Metric({ title, value, icon: Icon, active }: { title: string; value: string | number; icon: typeof Boxes; active?: boolean }) {
  return <Card className={active ? 'border-primary ring-1 ring-primary' : ''}><CardContent className="flex items-center justify-between p-5"><div><p className="text-sm text-muted-foreground">{title}</p><p className="mt-1 text-2xl font-bold">{value}</p></div><div className="rounded-full bg-primary/10 p-3"><Icon className="h-5 w-5 text-primary" /></div></CardContent></Card>;
}

function DashboardSkeleton() {
  return <div className="space-y-6"><Skeleton className="h-10 w-72" /><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">{Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-28" />)}</div><Skeleton className="h-96" /></div>;
}

