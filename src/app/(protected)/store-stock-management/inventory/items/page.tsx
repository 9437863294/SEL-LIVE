'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { Pencil, Plus, Search } from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/auth/AuthProvider';
import { useToast } from '@/hooks/use-toast';
import { inventoryCommand } from '@/lib/inventory-client';
import type { InventoryClassification, InventoryItem } from '@/lib/inventory';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

type ItemForm = Omit<InventoryItem, 'id' | 'organizationId'> & { id?: string };

const emptyItem: ItemForm = {
  itemCode: '', itemName: '', description: '', category: '', subcategory: '', brand: '', unit: '', secondaryUnit: '',
  minimumStockLevel: 0, reorderLevel: 0, maximumStockLevel: undefined, costRate: 0, standardRate: undefined,
  active: true, classification: 'Inventory', serialTracking: false, batchTracking: false, expiryTracking: false, notes: '',
};

export default function ItemMasterPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [units, setUnits] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<ItemForm>(emptyItem);
  const organizationId = user?.organizationId || 'default';

  const load = useCallback(async () => {
    const [itemSnapshot, unitSnapshot] = await Promise.all([
      getDocs(query(collection(db, 'inventoryItems'), where('organizationId', '==', organizationId))),
      getDocs(collection(db, 'units')),
    ]);
    setItems(itemSnapshot.docs.map((document) => ({ id: document.id, ...document.data() }) as InventoryItem).sort((a, b) => a.itemCode.localeCompare(b.itemCode)));
    setUnits(unitSnapshot.docs.map((document) => String(document.data().name || '')).filter(Boolean));
  }, [organizationId]);

  useEffect(() => { load().catch(console.error); }, [load]);

  const filtered = useMemo(() => items.filter((item) => {
    const term = search.toLowerCase().trim();
    return !term || [item.itemCode, item.itemName, item.category, item.brand, item.partNumber].some((value) => value?.toLowerCase().includes(term));
  }), [items, search]);

  const edit = (item?: InventoryItem) => {
    setForm(item ? { ...emptyItem, ...item } : { ...emptyItem });
    setOpen(true);
  };

  const save = async () => {
    if (!form.itemCode.trim() || !form.itemName.trim() || !form.unit.trim()) {
      toast({ title: 'Required fields missing', description: 'Item code, name, and unit are required.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      await inventoryCommand({ action: 'saveItem', item: form });
      toast({ title: form.id ? 'Item updated' : 'Item created', description: `${form.itemCode.toUpperCase()} · ${form.itemName}` });
      setOpen(false);
      await load();
    } catch (error) {
      toast({ title: 'Unable to save item', description: error instanceof Error ? error.message : 'Unknown error', variant: 'destructive' });
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h1 className="text-2xl font-bold">Item Master</h1><p className="text-muted-foreground">The central item catalog is independent from project BOQ.</p></div><Button onClick={() => edit()}><Plus className="mr-2 h-4 w-4" />New item</Button></div>
      <Card>
        <CardHeader className="gap-4 sm:flex-row sm:items-center sm:justify-between"><div><CardTitle>Inventory items</CardTitle><CardDescription>{items.length} master records</CardDescription></div><div className="relative w-full sm:w-80"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search items…" /></div></CardHeader>
        <CardContent className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Item</TableHead><TableHead>Category</TableHead><TableHead>Unit</TableHead><TableHead className="text-right">Reorder</TableHead><TableHead className="text-right">Cost rate</TableHead><TableHead>Tracking</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader><TableBody>
          {filtered.map((item) => <TableRow key={item.id}><TableCell className="font-mono text-xs">{item.itemCode}</TableCell><TableCell><div className="font-medium">{item.itemName}</div><div className="max-w-sm truncate text-xs text-muted-foreground">{item.description || item.brand || '—'}</div></TableCell><TableCell>{item.category || '—'}</TableCell><TableCell>{item.unit}</TableCell><TableCell className="text-right">{item.reorderLevel}</TableCell><TableCell className="text-right">₹{Number(item.costRate || 0).toLocaleString('en-IN')}</TableCell><TableCell className="space-x-1">{item.serialTracking && <Badge variant="outline">Serial</Badge>}{item.batchTracking && <Badge variant="outline">Batch</Badge>}{item.expiryTracking && <Badge variant="outline">Expiry</Badge>}</TableCell><TableCell><Badge variant={item.active ? 'default' : 'secondary'}>{item.active ? 'Active' : 'Inactive'}</Badge></TableCell><TableCell><Button variant="ghost" size="icon" onClick={() => edit(item)} aria-label={`Edit ${item.itemName}`}><Pencil className="h-4 w-4" /></Button></TableCell></TableRow>)}
          {!filtered.length && <TableRow><TableCell colSpan={9} className="h-28 text-center text-muted-foreground">No Item Master records found.</TableCell></TableRow>}
        </TableBody></Table></CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto"><DialogHeader><DialogTitle>{form.id ? 'Edit inventory item' : 'Create inventory item'}</DialogTitle></DialogHeader>
        <div className="grid gap-4 py-2 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Item code *"><Input value={form.itemCode} disabled={Boolean(form.id)} onChange={(event) => setForm({ ...form, itemCode: event.target.value })} /></Field>
          <Field label="Item name *" className="lg:col-span-2"><Input value={form.itemName} onChange={(event) => setForm({ ...form, itemName: event.target.value })} /></Field>
          <Field label="Category"><Input value={form.category || ''} onChange={(event) => setForm({ ...form, category: event.target.value })} /></Field>
          <Field label="Subcategory"><Input value={form.subcategory || ''} onChange={(event) => setForm({ ...form, subcategory: event.target.value })} /></Field>
          <Field label="Brand"><Input value={form.brand || ''} onChange={(event) => setForm({ ...form, brand: event.target.value })} /></Field>
          <Field label="Unit *"><Select value={form.unit} onValueChange={(unit) => setForm({ ...form, unit })}><SelectTrigger><SelectValue placeholder="Select unit" /></SelectTrigger><SelectContent>{units.map((unit) => <SelectItem key={unit} value={unit}>{unit}</SelectItem>)}</SelectContent></Select></Field>
          <Field label="Secondary unit"><Input value={form.secondaryUnit || ''} onChange={(event) => setForm({ ...form, secondaryUnit: event.target.value })} /></Field>
          <NumberField label="Conversion factor" value={form.conversionFactor} onChange={(conversionFactor) => setForm({ ...form, conversionFactor })} />
          <Field label="Barcode"><Input value={form.barcode || ''} onChange={(event) => setForm({ ...form, barcode: event.target.value })} /></Field>
          <Field label="Part number"><Input value={form.partNumber || ''} onChange={(event) => setForm({ ...form, partNumber: event.target.value })} /></Field>
          <Field label="Model"><Input value={form.model || ''} onChange={(event) => setForm({ ...form, model: event.target.value })} /></Field>
          <NumberField label="Minimum stock" value={form.minimumStockLevel} onChange={(minimumStockLevel) => setForm({ ...form, minimumStockLevel: minimumStockLevel || 0 })} />
          <NumberField label="Reorder level" value={form.reorderLevel} onChange={(reorderLevel) => setForm({ ...form, reorderLevel: reorderLevel || 0 })} />
          <NumberField label="Maximum stock" value={form.maximumStockLevel} onChange={(maximumStockLevel) => setForm({ ...form, maximumStockLevel })} />
          <NumberField label="Cost rate" value={form.costRate} onChange={(costRate) => setForm({ ...form, costRate: costRate || 0 })} />
          <NumberField label="Standard rate" value={form.standardRate} onChange={(standardRate) => setForm({ ...form, standardRate })} />
          <Field label="Classification"><Select value={form.classification} onValueChange={(classification: InventoryClassification) => setForm({ ...form, classification })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Inventory">Inventory</SelectItem><SelectItem value="Non-inventory">Non-inventory</SelectItem></SelectContent></Select></Field>
          <Field label="Preferred supplier"><Input value={form.preferredSupplierName || ''} onChange={(event) => setForm({ ...form, preferredSupplierName: event.target.value })} /></Field>
          <Field label="Tax code"><Input value={form.taxCode || ''} onChange={(event) => setForm({ ...form, taxCode: event.target.value })} /></Field>
          <NumberField label="Tax rate %" value={form.taxRate} onChange={(taxRate) => setForm({ ...form, taxRate })} />
          <Field label="Description" className="sm:col-span-2 lg:col-span-3"><Textarea value={form.description || ''} onChange={(event) => setForm({ ...form, description: event.target.value })} /></Field>
          <Toggle label="Active" checked={form.active} onChange={(active) => setForm({ ...form, active })} />
          <Toggle label="Serial tracking" checked={form.serialTracking} onChange={(serialTracking) => setForm({ ...form, serialTracking })} />
          <Toggle label="Batch tracking" checked={form.batchTracking} onChange={(batchTracking) => setForm({ ...form, batchTracking })} />
          <Toggle label="Expiry tracking" checked={form.expiryTracking} onChange={(expiryTracking) => setForm({ ...form, expiryTracking })} />
          <Field label="Notes" className="sm:col-span-2 lg:col-span-3"><Textarea value={form.notes || ''} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></Field>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save item'}</Button></DialogFooter>
      </DialogContent></Dialog>
    </div>
  );
}

function Field({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) { return <div className={`space-y-1.5 ${className}`}><Label>{label}</Label>{children}</div>; }
function NumberField({ label, value, onChange }: { label: string; value?: number; onChange: (value?: number) => void }) { return <Field label={label}><Input type="number" min="0" step="any" value={value ?? ''} onChange={(event) => onChange(event.target.value === '' ? undefined : Number(event.target.value))} /></Field>; }
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) { return <div className="flex items-center justify-between rounded-md border p-3"><Label>{label}</Label><Switch checked={checked} onCheckedChange={onChange} /></div>; }

