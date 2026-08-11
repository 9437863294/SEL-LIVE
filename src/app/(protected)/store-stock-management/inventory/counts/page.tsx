'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { ClipboardCheck, Plus } from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/auth/AuthProvider';
import { useToast } from '@/hooks/use-toast';
import { asDateInput, type InventoryLocation, type InventoryStockCount } from '@/lib/inventory';
import { inventoryCommand, inventoryRequestId } from '@/lib/inventory-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export default function StockCountsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const organizationId = user?.organizationId || 'default';
  const [locations, setLocations] = useState<InventoryLocation[]>([]);
  const [counts, setCounts] = useState<InventoryStockCount[]>([]);
  const [locationId, setLocationId] = useState('');
  const [date, setDate] = useState(asDateInput());
  const [selected, setSelected] = useState<InventoryStockCount | null>(null);
  const [physical, setPhysical] = useState<Record<string, { quantity: number; reason: string }>>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [locationSnapshot, countSnapshot] = await Promise.all([
      getDocs(query(collection(db, 'inventoryLocations'), where('organizationId', '==', organizationId))),
      getDocs(query(collection(db, 'inventoryStockCounts'), where('organizationId', '==', organizationId))),
    ]);
    setLocations(locationSnapshot.docs.map((document) => ({ id: document.id, ...document.data() }) as InventoryLocation).filter((location) => location.active && (!location.allowedUserIds?.length || location.allowedUserIds.includes(user?.id || ''))));
    setCounts(countSnapshot.docs.map((document) => ({ id: document.id, ...document.data() }) as InventoryStockCount).sort((a, b) => b.countDate.localeCompare(a.countDate)));
  }, [organizationId, user?.id]);
  useEffect(() => { load().catch(console.error); }, [load]);

  const create = async () => {
    if (!locationId) { toast({ title: 'Select a location', variant: 'destructive' }); return; }
    setSaving(true);
    try {
      const result = await inventoryCommand<{ countNumber: string; lineCount: number }>({ action: 'createStockCount', clientRequestId: inventoryRequestId(), locationId, countDate: date });
      toast({ title: `${result.countNumber} created`, description: `${result.lineCount} stock lines were frozen for counting.` }); await load();
    } catch (error) { toast({ title: 'Unable to create stock count', description: error instanceof Error ? error.message : 'Unknown error', variant: 'destructive' }); }
    finally { setSaving(false); }
  };
  const openCount = (count: InventoryStockCount) => {
    setSelected(count);
    setPhysical(Object.fromEntries(count.lines.map((line) => [line.id, { quantity: Number(line.physicalQuantity ?? line.systemQuantity), reason: line.varianceReason || '' }])));
  };
  const submit = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await inventoryCommand({ action: 'submitStockCount', clientRequestId: inventoryRequestId(), countId: selected.id, lines: selected.lines.map((line) => ({ id: line.id, physicalQuantity: physical[line.id]?.quantity, varianceReason: physical[line.id]?.reason })) });
      toast({ title: `${selected.countNumber} submitted`, description: 'The variance is ready for approval and posting.' }); setSelected(null); await load();
    } catch (error) { toast({ title: 'Submission failed', description: error instanceof Error ? error.message : 'Unknown error', variant: 'destructive' }); }
    finally { setSaving(false); }
  };
  const post = async (count: InventoryStockCount) => {
    setSaving(true);
    try {
      const result = await inventoryCommand<{ adjustments: number }>({ action: 'postStockCount', clientRequestId: inventoryRequestId(), countId: count.id });
      toast({ title: `${count.countNumber} posted`, description: `${result.adjustments} variance adjustment(s) were added to the ledger.` }); await load();
    } catch (error) { toast({ title: 'Posting failed', description: error instanceof Error ? error.message : 'Unknown error', variant: 'destructive' }); }
    finally { setSaving(false); }
  };

  const varianceTotal = useMemo(() => selected?.lines.reduce((sum, line) => sum + ((physical[line.id]?.quantity ?? line.systemQuantity) - line.systemQuantity), 0) || 0, [physical, selected]);

  return <div className="space-y-6"><div><h1 className="text-2xl font-bold">Physical stock count</h1><p className="text-muted-foreground">Freeze a count sheet, enter physical quantities, approve variances, and post controlled adjustments.</p></div>
    <Card><CardHeader><CardTitle>New stock-count session</CardTitle><CardDescription>The system quantity is captured when the session is created.</CardDescription></CardHeader><CardContent className="flex flex-col gap-4 sm:flex-row sm:items-end"><div className="w-full space-y-1.5 sm:max-w-md"><Label>Location</Label><Select value={locationId} onValueChange={setLocationId}><SelectTrigger><SelectValue placeholder="Select location" /></SelectTrigger><SelectContent>{locations.map((location) => <SelectItem key={location.id} value={location.id}>{location.locationCode} · {location.locationName}</SelectItem>)}</SelectContent></Select></div><div className="space-y-1.5"><Label>Count date</Label><Input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></div><Button disabled={saving} onClick={create}><Plus className="mr-2 h-4 w-4" />Generate count sheet</Button></CardContent></Card>
    <Card><CardHeader><CardTitle>Count history</CardTitle></CardHeader><CardContent className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Count</TableHead><TableHead>Location</TableHead><TableHead>Date</TableHead><TableHead>Lines</TableHead><TableHead>Variance</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader><TableBody>{counts.map((count) => <TableRow key={count.id}><TableCell className="font-medium">{count.countNumber}</TableCell><TableCell>{count.locationName}</TableCell><TableCell>{count.countDate}</TableCell><TableCell>{count.lines.length}</TableCell><TableCell>{count.lines.reduce((sum, line) => sum + Number(line.variance || 0), 0)}</TableCell><TableCell><Badge variant={count.status === 'Posted' ? 'default' : 'secondary'}>{count.status}</Badge></TableCell><TableCell><div className="flex justify-end gap-2">{count.status === 'Draft' && <Button size="sm" onClick={() => openCount(count)}><ClipboardCheck className="mr-2 h-4 w-4" />Enter count</Button>}{count.status === 'Submitted' && <Button size="sm" onClick={() => post(count)}>Approve & post</Button>}{count.status === 'Posted' && <Button size="sm" variant="outline" onClick={() => openCount(count)}>View</Button>}</div></TableCell></TableRow>)}{!counts.length && <TableRow><TableCell colSpan={7} className="h-28 text-center text-muted-foreground">No stock-count sessions yet.</TableCell></TableRow>}</TableBody></Table></CardContent></Card>

    <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}><DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto"><DialogHeader><DialogTitle>{selected?.countNumber} · {selected?.locationName}</DialogTitle></DialogHeader><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Item</TableHead><TableHead>Unit</TableHead><TableHead className="text-right">System</TableHead><TableHead className="w-36">Physical</TableHead><TableHead className="text-right">Variance</TableHead><TableHead className="min-w-64">Variance reason</TableHead></TableRow></TableHeader><TableBody>{selected?.lines.map((line) => { const entry = physical[line.id] || { quantity: line.systemQuantity, reason: '' }; const variance = entry.quantity - line.systemQuantity; return <TableRow key={line.id}><TableCell><div className="font-medium">{line.itemName}</div><div className="text-xs text-muted-foreground">{line.itemCode}</div></TableCell><TableCell>{line.unit}</TableCell><TableCell className="text-right">{line.systemQuantity}</TableCell><TableCell><Input type="number" min="0" step="any" disabled={selected.status !== 'Draft'} value={entry.quantity} onChange={(event) => setPhysical({ ...physical, [line.id]: { ...entry, quantity: Number(event.target.value) } })} /></TableCell><TableCell className={`text-right font-medium ${variance ? 'text-destructive' : ''}`}>{variance}</TableCell><TableCell><Input disabled={selected.status !== 'Draft'} value={entry.reason} onChange={(event) => setPhysical({ ...physical, [line.id]: { ...entry, reason: event.target.value } })} placeholder={variance ? 'Reason required by policy' : 'No variance'} /></TableCell></TableRow>; })}</TableBody></Table></div><DialogFooter className="items-center sm:justify-between"><div className="text-sm text-muted-foreground">Net quantity variance: <strong>{varianceTotal}</strong></div><div className="flex gap-2"><Button variant="outline" onClick={() => setSelected(null)}>Close</Button>{selected?.status === 'Draft' && <Button disabled={saving} onClick={submit}>Submit count</Button>}</div></DialogFooter></DialogContent></Dialog>
  </div>;
}

