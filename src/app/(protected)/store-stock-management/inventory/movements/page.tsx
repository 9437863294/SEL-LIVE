'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { Plus, Send, Trash2 } from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/auth/AuthProvider';
import { useToast } from '@/hooks/use-toast';
import { asDateInput, INBOUND_DOCUMENT_TYPES, type InventoryBalance, type InventoryDocumentType, type InventoryItem, type InventoryLocation } from '@/lib/inventory';
import { inventoryCommand, inventoryRequestId } from '@/lib/inventory-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

type MovementType = Exclude<InventoryDocumentType, 'Stock Transfer' | 'Physical Count'>;
type Line = { id: string; itemId: string; quantity: number; unitCost: number; batchNumber: string; serialNumbers: string; expiryDate: string; remarks: string };
const movementTypes: MovementType[] = ['Goods Receipt', 'Goods Issue', 'Store Return', 'Project Consumption', 'Stock Adjustment Increase', 'Stock Adjustment Decrease', 'Damaged Stock', 'Lost Stock', 'Write-Off', 'Opening Stock'];
const newLine = (): Line => ({ id: `line-${Date.now()}-${Math.random()}`, itemId: '', quantity: 1, unitCost: 0, batchNumber: '', serialNumbers: '', expiryDate: '', remarks: '' });

export default function InventoryMovementsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const organizationId = user?.organizationId || 'default';
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [locations, setLocations] = useState<InventoryLocation[]>([]);
  const [balances, setBalances] = useState<InventoryBalance[]>([]);
  const [documentType, setDocumentType] = useState<MovementType>('Goods Receipt');
  const [date, setDate] = useState(asDateInput());
  const [sourceLocationId, setSourceLocationId] = useState('');
  const [destinationLocationId, setDestinationLocationId] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [departmentName, setDepartmentName] = useState('');
  const [issuedTo, setIssuedTo] = useState('');
  const [referenceDocument, setReferenceDocument] = useState('');
  const [purpose, setPurpose] = useState('');
  const [remarks, setRemarks] = useState('');
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [saving, setSaving] = useState(false);
  const inbound = INBOUND_DOCUMENT_TYPES.includes(documentType);

  const load = useCallback(async () => {
    const [itemSnapshot, locationSnapshot, balanceSnapshot] = await Promise.all([
      getDocs(query(collection(db, 'inventoryItems'), where('organizationId', '==', organizationId))),
      getDocs(query(collection(db, 'inventoryLocations'), where('organizationId', '==', organizationId))),
      getDocs(query(collection(db, 'inventoryBalances'), where('organizationId', '==', organizationId))),
    ]);
    const accessible = locationSnapshot.docs.map((document) => ({ id: document.id, ...document.data() }) as InventoryLocation).filter((location) => location.active && (!location.allowedUserIds?.length || location.allowedUserIds.includes(user?.id || '')));
    setItems(itemSnapshot.docs.map((document) => ({ id: document.id, ...document.data() }) as InventoryItem).filter((item) => item.active && item.classification === 'Inventory'));
    setLocations(accessible);
    setBalances(balanceSnapshot.docs.map((document) => ({ id: document.id, ...document.data() }) as InventoryBalance));
  }, [organizationId, user?.id]);
  useEffect(() => { load().catch(console.error); }, [load]);

  const selectedLocationId = inbound ? destinationLocationId : sourceLocationId;
  const availability = useMemo(() => new Map(items.map((item) => [item.id, balances.find((balance) => balance.itemId === item.id && balance.locationId === selectedLocationId)?.availableQuantity || 0])), [balances, items, selectedLocationId]);

  const updateLine = (id: string, update: Partial<Line>) => setLines((current) => current.map((line) => line.id === id ? { ...line, ...update } : line));
  const submit = async () => {
    const locationMissing = inbound ? !destinationLocationId : !sourceLocationId;
    if (locationMissing || lines.some((line) => !line.itemId || line.quantity <= 0)) {
      toast({ title: 'Complete the movement', description: 'Select a location, item, and positive quantity on every line.', variant: 'destructive' }); return;
    }
    setSaving(true);
    try {
      const result = await inventoryCommand<{ documentNumber: string }>({
        action: 'postMovement', clientRequestId: inventoryRequestId(), documentType, transactionDate: date,
        sourceLocationId: inbound ? undefined : sourceLocationId,
        destinationLocationId: inbound ? destinationLocationId : undefined,
        supplierName, departmentName, issuedTo, referenceDocument, purpose, remarks,
        requesterId: user?.id, requesterName: user?.name,
        lines: lines.map((line) => ({
          id: line.id, itemId: line.itemId, quantity: Number(line.quantity), unitCost: Number(line.unitCost || 0),
          batchNumber: line.batchNumber || undefined,
          serialNumbers: line.serialNumbers.split(',').map((value) => value.trim()).filter(Boolean),
          expiryDate: line.expiryDate || undefined, remarks: line.remarks || undefined,
        })),
      });
      toast({ title: `${result.documentNumber} posted`, description: 'Balances and stock ledger were updated atomically.' });
      setLines([newLine()]); setReferenceDocument(''); setRemarks(''); setPurpose(''); setIssuedTo('');
      await load();
    } catch (error) { toast({ title: 'Posting failed', description: error instanceof Error ? error.message : 'Unknown error', variant: 'destructive' }); }
    finally { setSaving(false); }
  };

  return <div className="space-y-6">
    <div><h1 className="text-2xl font-bold">Receipts, issues & adjustments</h1><p className="text-muted-foreground">Posted documents update stock through an immutable item/location ledger. BOQ is optional.</p></div>
    <Alert><Send className="h-4 w-4" /><AlertTitle>Posting point</AlertTitle><AlertDescription>This screen posts immediately. Posted documents cannot be edited or deleted; corrections must use a return, adjustment, or reversal.</AlertDescription></Alert>
    <Card><CardHeader><CardTitle>Document header</CardTitle><CardDescription>Select the business movement and its controlling location.</CardDescription></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Field label="Movement type"><Select value={documentType} onValueChange={(value: MovementType) => setDocumentType(value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{movementTypes.map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}</SelectContent></Select></Field>
      <Field label="Transaction date"><Input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Field>
      {inbound ? <Field label="Destination location"><LocationSelect locations={locations} value={destinationLocationId} onChange={setDestinationLocationId} /></Field> : <Field label="Source location"><LocationSelect locations={locations} value={sourceLocationId} onChange={setSourceLocationId} /></Field>}
      <Field label="Reference document"><Input value={referenceDocument} onChange={(event) => setReferenceDocument(event.target.value)} placeholder="PO / issue / approval ref" /></Field>
      {documentType === 'Goods Receipt' && <Field label="Supplier"><Input value={supplierName} onChange={(event) => setSupplierName(event.target.value)} /></Field>}
      {!inbound && <Field label="Department"><Input value={departmentName} onChange={(event) => setDepartmentName(event.target.value)} /></Field>}
      {!inbound && <Field label="Issued to"><Input value={issuedTo} onChange={(event) => setIssuedTo(event.target.value)} /></Field>}
      <Field label="Purpose"><Input value={purpose} onChange={(event) => setPurpose(event.target.value)} /></Field>
      <Field label="Remarks" className="sm:col-span-2 lg:col-span-4"><Textarea value={remarks} onChange={(event) => setRemarks(event.target.value)} /></Field>
    </CardContent></Card>

    <Card><CardHeader className="flex-row items-center justify-between"><div><CardTitle>Items</CardTitle><CardDescription>Available quantity is shown for the selected source location.</CardDescription></div><Button variant="outline" onClick={() => setLines((current) => [...current, newLine()])}><Plus className="mr-2 h-4 w-4" />Add line</Button></CardHeader><CardContent className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead className="min-w-64">Item</TableHead><TableHead>Available</TableHead><TableHead className="w-28">Quantity</TableHead><TableHead className="w-32">Unit cost</TableHead><TableHead>Batch / lot</TableHead><TableHead>Serials</TableHead><TableHead>Expiry</TableHead><TableHead /></TableRow></TableHeader><TableBody>
      {lines.map((line) => { const item = items.find((entry) => entry.id === line.itemId); return <TableRow key={line.id}><TableCell><Select value={line.itemId} onValueChange={(itemId) => { const selected = items.find((entry) => entry.id === itemId); updateLine(line.id, { itemId, unitCost: selected?.costRate || 0 }); }}><SelectTrigger><SelectValue placeholder="Select item" /></SelectTrigger><SelectContent>{items.map((item) => <SelectItem key={item.id} value={item.id}>{item.itemCode} · {item.itemName}</SelectItem>)}</SelectContent></Select>{item && <div className="mt-1 text-xs text-muted-foreground">Unit: {item.unit}</div>}</TableCell><TableCell className="tabular-nums">{selectedLocationId ? Number(availability.get(line.itemId) || 0).toLocaleString() : '—'}</TableCell><TableCell><Input type="number" min="0.000001" step="any" value={line.quantity} onChange={(event) => updateLine(line.id, { quantity: Number(event.target.value) })} /></TableCell><TableCell><Input type="number" min="0" step="any" value={line.unitCost} disabled={!inbound} onChange={(event) => updateLine(line.id, { unitCost: Number(event.target.value) })} /></TableCell><TableCell><Input value={line.batchNumber} disabled={!item?.batchTracking} onChange={(event) => updateLine(line.id, { batchNumber: event.target.value })} placeholder={item?.batchTracking ? 'Required' : 'N/A'} /></TableCell><TableCell><Input value={line.serialNumbers} disabled={!item?.serialTracking} onChange={(event) => updateLine(line.id, { serialNumbers: event.target.value })} placeholder={item?.serialTracking ? 'Comma-separated' : 'N/A'} /></TableCell><TableCell><Input type="date" value={line.expiryDate} disabled={!item?.expiryTracking} onChange={(event) => updateLine(line.id, { expiryDate: event.target.value })} /></TableCell><TableCell><Button variant="ghost" size="icon" disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((entry) => entry.id !== line.id))}><Trash2 className="h-4 w-4" /></Button></TableCell></TableRow>; })}
    </TableBody></Table><div className="mt-5 flex justify-end"><Button size="lg" onClick={submit} disabled={saving}>{saving ? 'Posting…' : `Post ${documentType}`}</Button></div></CardContent></Card>
  </div>;
}

function Field({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) { return <div className={`space-y-1.5 ${className}`}><Label>{label}</Label>{children}</div>; }
function LocationSelect({ locations, value, onChange }: { locations: InventoryLocation[]; value: string; onChange: (value: string) => void }) { return <Select value={value} onValueChange={onChange}><SelectTrigger><SelectValue placeholder="Select location" /></SelectTrigger><SelectContent>{locations.map((location) => <SelectItem key={location.id} value={location.id}>{location.locationCode} · {location.locationName}</SelectItem>)}</SelectContent></Select>; }

