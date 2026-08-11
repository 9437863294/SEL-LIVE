'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { ArrowRight, Plus, Trash2, Truck } from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/auth/AuthProvider';
import { useToast } from '@/hooks/use-toast';
import { asDateInput, type InventoryBalance, type InventoryDocument, type InventoryItem, type InventoryLocation } from '@/lib/inventory';
import { inventoryCommand, inventoryRequestId } from '@/lib/inventory-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

type DraftLine = { id: string; itemId: string; quantity: number; batchNumber: string; serialNumbers: string; expiryDate: string; remarks: string };
type ReceiptLine = { id: string; itemName: string; outstanding: number; quantity: number; rejectedQuantity: number; damagedQuantity: number };
const newLine = (): DraftLine => ({ id: `line-${Date.now()}-${Math.random()}`, itemId: '', quantity: 1, batchNumber: '', serialNumbers: '', expiryDate: '', remarks: '' });

export default function StockTransfersPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const organizationId = user?.organizationId || 'default';
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [locations, setLocations] = useState<InventoryLocation[]>([]);
  const [balances, setBalances] = useState<InventoryBalance[]>([]);
  const [transfers, setTransfers] = useState<InventoryDocument[]>([]);
  const [date, setDate] = useState(asDateInput());
  const [sourceLocationId, setSourceLocationId] = useState('');
  const [destinationLocationId, setDestinationLocationId] = useState('');
  const [reference, setReference] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [remarks, setRemarks] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([newLine()]);
  const [saving, setSaving] = useState(false);
  const [receiving, setReceiving] = useState<InventoryDocument | null>(null);
  const [receiptLines, setReceiptLines] = useState<ReceiptLine[]>([]);

  const load = useCallback(async () => {
    const [itemSnapshot, locationSnapshot, balanceSnapshot, documentSnapshot] = await Promise.all([
      getDocs(query(collection(db, 'inventoryItems'), where('organizationId', '==', organizationId))),
      getDocs(query(collection(db, 'inventoryLocations'), where('organizationId', '==', organizationId))),
      getDocs(query(collection(db, 'inventoryBalances'), where('organizationId', '==', organizationId))),
      getDocs(query(collection(db, 'inventoryDocuments'), where('organizationId', '==', organizationId))),
    ]);
    const accessible = locationSnapshot.docs.map((document) => ({ id: document.id, ...document.data() }) as InventoryLocation).filter((location) => location.active && (!location.allowedUserIds?.length || location.allowedUserIds.includes(user?.id || '')));
    const allowed = new Set(accessible.map((location) => location.id));
    setItems(itemSnapshot.docs.map((document) => ({ id: document.id, ...document.data() }) as InventoryItem).filter((item) => item.active && item.classification === 'Inventory'));
    setLocations(accessible);
    setBalances(balanceSnapshot.docs.map((document) => ({ id: document.id, ...document.data() }) as InventoryBalance));
    setTransfers(documentSnapshot.docs.map((document) => ({ id: document.id, ...document.data() }) as InventoryDocument)
      .filter((document) => document.documentType === 'Stock Transfer' && allowed.has(document.sourceLocationId || '') && allowed.has(document.destinationLocationId || ''))
      .sort((a, b) => String(b.transactionDate).localeCompare(String(a.transactionDate))));
  }, [organizationId, user?.id]);
  useEffect(() => { load().catch(console.error); }, [load]);

  const availability = useMemo(() => new Map(items.map((item) => [item.id, balances.find((balance) => balance.locationId === sourceLocationId && balance.itemId === item.id)?.availableQuantity || 0])), [balances, items, sourceLocationId]);
  const updateLine = (id: string, update: Partial<DraftLine>) => setLines((current) => current.map((line) => line.id === id ? { ...line, ...update } : line));

  const create = async () => {
    if (!sourceLocationId || !destinationLocationId || sourceLocationId === destinationLocationId || lines.some((line) => !line.itemId || line.quantity <= 0)) {
      toast({ title: 'Complete the transfer', description: 'Choose different source/destination locations and valid item quantities.', variant: 'destructive' }); return;
    }
    setSaving(true);
    try {
      const result = await inventoryCommand<{ documentNumber: string }>({ action: 'createTransfer', clientRequestId: inventoryRequestId(), transactionDate: date, sourceLocationId, destinationLocationId, requesterId: user?.id, requesterName: user?.name, referenceDocument: reference, vehicleDetails: vehicle, remarks, lines: lines.map((line) => ({ ...line, serialNumbers: line.serialNumbers.split(',').map((value) => value.trim()).filter(Boolean), expiryDate: line.expiryDate || undefined })) });
      toast({ title: `${result.documentNumber} created`, description: 'The stock transfer is saved as Draft.' });
      setLines([newLine()]); setReference(''); setVehicle(''); setRemarks(''); await load();
    } catch (error) { toast({ title: 'Unable to create transfer', description: error instanceof Error ? error.message : 'Unknown error', variant: 'destructive' }); }
    finally { setSaving(false); }
  };

  const transition = async (document: InventoryDocument, action: 'submit' | 'approve' | 'dispatch' | 'cancel') => {
    setSaving(true);
    try {
      const result = await inventoryCommand<{ status: string }>({ action: 'transitionTransfer', clientRequestId: inventoryRequestId(), documentId: document.id, transition: action });
      toast({ title: `${document.documentNumber}: ${result.status}`, description: action === 'dispatch' ? 'Source stock was reduced and is now in transit.' : 'Workflow status updated.' });
      await load();
    } catch (error) { toast({ title: 'Transfer action failed', description: error instanceof Error ? error.message : 'Unknown error', variant: 'destructive' }); }
    finally { setSaving(false); }
  };

  const openReceipt = (document: InventoryDocument) => {
    setReceiving(document);
    setReceiptLines(document.lines.filter((line) => Number(line.outstandingQuantity || 0) > 0).map((line) => ({ id: line.id, itemName: line.itemName || line.itemId, outstanding: Number(line.outstandingQuantity || 0), quantity: Number(line.outstandingQuantity || 0), rejectedQuantity: 0, damagedQuantity: 0 })));
  };
  const receive = async () => {
    if (!receiving) return;
    setSaving(true);
    try {
      const result = await inventoryCommand<{ status: string }>({ action: 'transitionTransfer', clientRequestId: inventoryRequestId(), documentId: receiving.id, transition: 'receive', lines: receiptLines.map(({ id, quantity, rejectedQuantity, damagedQuantity }) => ({ id, quantity, rejectedQuantity, damagedQuantity })) });
      toast({ title: `${receiving.documentNumber}: ${result.status}`, description: 'Accepted quantities were added to the destination ledger.' }); setReceiving(null); await load();
    } catch (error) { toast({ title: 'Receipt failed', description: error instanceof Error ? error.message : 'Unknown error', variant: 'destructive' }); }
    finally { setSaving(false); }
  };

  return <div className="space-y-6"><div><h1 className="text-2xl font-bold">Stock transfers</h1><p className="text-muted-foreground">Draft → Submitted → Approved → In Transit → Partially Received / Received.</p></div>
    <Card><CardHeader><CardTitle>Create transfer</CardTitle><CardDescription>A transfer to a project increases Project Store stock; it is not consumption.</CardDescription></CardHeader><CardContent className="space-y-5"><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><Field label="Transfer date"><Input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Field><Field label="From location"><LocationSelect locations={locations} value={sourceLocationId} onChange={setSourceLocationId} /></Field><Field label="To location"><LocationSelect locations={locations.filter((location) => location.id !== sourceLocationId)} value={destinationLocationId} onChange={setDestinationLocationId} /></Field><Field label="Reference"><Input value={reference} onChange={(event) => setReference(event.target.value)} /></Field><Field label="Vehicle / delivery"><Input value={vehicle} onChange={(event) => setVehicle(event.target.value)} /></Field><Field label="Remarks" className="sm:col-span-2 lg:col-span-3"><Textarea value={remarks} onChange={(event) => setRemarks(event.target.value)} /></Field></div>
      <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead className="min-w-64">Item</TableHead><TableHead>Available</TableHead><TableHead className="w-32">Requested</TableHead><TableHead>Batch</TableHead><TableHead>Serials</TableHead><TableHead /></TableRow></TableHeader><TableBody>{lines.map((line) => { const item = items.find((entry) => entry.id === line.itemId); return <TableRow key={line.id}><TableCell><Select value={line.itemId} onValueChange={(itemId) => updateLine(line.id, { itemId })}><SelectTrigger><SelectValue placeholder="Select item" /></SelectTrigger><SelectContent>{items.map((entry) => <SelectItem key={entry.id} value={entry.id}>{entry.itemCode} · {entry.itemName}</SelectItem>)}</SelectContent></Select></TableCell><TableCell>{sourceLocationId ? Number(availability.get(line.itemId) || 0).toLocaleString() : '—'}</TableCell><TableCell><Input type="number" min="0.000001" step="any" value={line.quantity} onChange={(event) => updateLine(line.id, { quantity: Number(event.target.value) })} /></TableCell><TableCell><Input disabled={!item?.batchTracking} value={line.batchNumber} onChange={(event) => updateLine(line.id, { batchNumber: event.target.value })} /></TableCell><TableCell><Input disabled={!item?.serialTracking} value={line.serialNumbers} onChange={(event) => updateLine(line.id, { serialNumbers: event.target.value })} /></TableCell><TableCell><Button size="icon" variant="ghost" disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((entry) => entry.id !== line.id))}><Trash2 className="h-4 w-4" /></Button></TableCell></TableRow>; })}</TableBody></Table></div>
      <div className="flex flex-wrap justify-between gap-2"><Button variant="outline" onClick={() => setLines((current) => [...current, newLine()])}><Plus className="mr-2 h-4 w-4" />Add line</Button><Button onClick={create} disabled={saving}>{saving ? 'Saving…' : 'Create draft transfer'}</Button></div>
    </CardContent></Card>

    <Card><CardHeader><CardTitle>Transfer queue</CardTitle><CardDescription>Dispatch removes source stock; receipt adds only accepted stock at destination.</CardDescription></CardHeader><CardContent className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Transfer</TableHead><TableHead>Route</TableHead><TableHead>Items</TableHead><TableHead>Status</TableHead><TableHead>Outstanding</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{transfers.map((document) => <TableRow key={document.id}><TableCell><div className="font-medium">{document.documentNumber}</div><div className="text-xs text-muted-foreground">{document.transactionDate}</div></TableCell><TableCell><div className="flex items-center gap-2">{document.sourceLocationName}<ArrowRight className="h-4 w-4" />{document.destinationLocationName}</div></TableCell><TableCell>{document.lines.length}</TableCell><TableCell><Badge variant={document.status === 'Received' ? 'default' : 'secondary'}>{document.status}</Badge></TableCell><TableCell>{document.lines.reduce((sum, line) => sum + Number(line.outstandingQuantity || 0), 0).toLocaleString()}</TableCell><TableCell><div className="flex justify-end gap-1">{document.status === 'Draft' && <><Button size="sm" variant="outline" onClick={() => transition(document, 'cancel')}>Cancel</Button><Button size="sm" onClick={() => transition(document, 'submit')}>Submit</Button></>}{document.status === 'Submitted' && <Button size="sm" onClick={() => transition(document, 'approve')}>Approve</Button>}{document.status === 'Approved' && <Button size="sm" onClick={() => transition(document, 'dispatch')}><Truck className="mr-2 h-4 w-4" />Dispatch</Button>}{['In Transit', 'Partially Received'].includes(document.status) && <Button size="sm" onClick={() => openReceipt(document)}>Receive</Button>}</div></TableCell></TableRow>)}{!transfers.length && <TableRow><TableCell colSpan={6} className="h-28 text-center text-muted-foreground">No stock transfers yet.</TableCell></TableRow>}</TableBody></Table></CardContent></Card>

    <Dialog open={Boolean(receiving)} onOpenChange={(open) => !open && setReceiving(null)}><DialogContent className="max-w-3xl"><DialogHeader><DialogTitle>Receive {receiving?.documentNumber}</DialogTitle></DialogHeader><Table><TableHeader><TableRow><TableHead>Item</TableHead><TableHead>Outstanding</TableHead><TableHead>Accepted</TableHead><TableHead>Rejected</TableHead><TableHead>Damaged</TableHead></TableRow></TableHeader><TableBody>{receiptLines.map((line) => <TableRow key={line.id}><TableCell className="font-medium">{line.itemName}</TableCell><TableCell>{line.outstanding}</TableCell>{(['quantity', 'rejectedQuantity', 'damagedQuantity'] as const).map((field) => <TableCell key={field}><Input type="number" min="0" max={line.outstanding} step="any" value={line[field]} onChange={(event) => setReceiptLines((current) => current.map((entry) => entry.id === line.id ? { ...entry, [field]: Number(event.target.value) } : entry))} /></TableCell>)}</TableRow>)}</TableBody></Table><DialogFooter><Button variant="outline" onClick={() => setReceiving(null)}>Cancel</Button><Button disabled={saving} onClick={receive}>Post receipt</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}

function Field({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) { return <div className={`space-y-1.5 ${className}`}><Label>{label}</Label>{children}</div>; }
function LocationSelect({ locations, value, onChange }: { locations: InventoryLocation[]; value: string; onChange: (value: string) => void }) { return <Select value={value} onValueChange={onChange}><SelectTrigger><SelectValue placeholder="Select location" /></SelectTrigger><SelectContent>{locations.map((location) => <SelectItem key={location.id} value={location.id}>{location.locationCode} · {location.locationName}</SelectItem>)}</SelectContent></Select>; }

