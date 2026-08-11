'use client';

import { useCallback, useEffect, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { MapPin, Pencil, Plus } from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/auth/AuthProvider';
import { useToast } from '@/hooks/use-toast';
import { inventoryCommand } from '@/lib/inventory-client';
import type { Project } from '@/lib/types';
import type { InventoryLocation, InventoryLocationType } from '@/lib/inventory';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

type LocationForm = Omit<InventoryLocation, 'id' | 'organizationId'> & { id?: string };
const types: InventoryLocationType[] = ['Central Warehouse', 'Property Store', 'Project Store', 'Transit', 'Quarantine', 'Scrap'];
const emptyLocation: LocationForm = { locationCode: '', locationName: '', type: 'Central Warehouse', propertyId: '', propertyName: '', projectId: '', projectName: '', binOrRack: '', address: '', active: true };

export default function InventoryLocationsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const organizationId = user?.organizationId || 'default';
  const [locations, setLocations] = useState<InventoryLocation[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [form, setForm] = useState<LocationForm>(emptyLocation);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [locationSnapshot, projectSnapshot] = await Promise.all([
      getDocs(query(collection(db, 'inventoryLocations'), where('organizationId', '==', organizationId))),
      getDocs(collection(db, 'projects')),
    ]);
    setLocations(locationSnapshot.docs.map((document) => ({ id: document.id, ...document.data() }) as InventoryLocation).sort((a, b) => a.locationCode.localeCompare(b.locationCode)));
    setProjects(projectSnapshot.docs.map((document) => ({ id: document.id, ...document.data() }) as Project).filter((project) => project.status === 'Active'));
  }, [organizationId]);
  useEffect(() => { load().catch(console.error); }, [load]);

  const edit = (location?: InventoryLocation) => { setForm(location ? { ...emptyLocation, ...location } : { ...emptyLocation }); setOpen(true); };
  const save = async () => {
    if (!form.locationCode.trim() || !form.locationName.trim()) { toast({ title: 'Location code and name are required', variant: 'destructive' }); return; }
    setSaving(true);
    try {
      await inventoryCommand({ action: 'saveLocation', location: form });
      toast({ title: form.id ? 'Location updated' : 'Location created', description: `${form.locationCode.toUpperCase()} · ${form.locationName}` });
      setOpen(false); await load();
    } catch (error) { toast({ title: 'Unable to save location', description: error instanceof Error ? error.message : 'Unknown error', variant: 'destructive' }); }
    finally { setSaving(false); }
  };

  return <div className="space-y-6">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h1 className="text-2xl font-bold">Inventory locations</h1><p className="text-muted-foreground">Central, property, project, quarantine, and scrap locations with independent balances.</p></div><Button onClick={() => edit()}><Plus className="mr-2 h-4 w-4" />New location</Button></div>
    <Card><CardHeader><CardTitle>Location Master</CardTitle><CardDescription>{locations.length} physical or logical locations</CardDescription></CardHeader><CardContent className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Location</TableHead><TableHead>Type</TableHead><TableHead>Property / project</TableHead><TableHead>Bin / rack</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader><TableBody>
      {locations.map((location) => <TableRow key={location.id}><TableCell className="font-mono text-xs">{location.locationCode}</TableCell><TableCell><div className="flex items-center gap-2 font-medium"><MapPin className="h-4 w-4 text-muted-foreground" />{location.locationName}</div><div className="text-xs text-muted-foreground">{location.address || '—'}</div></TableCell><TableCell>{location.type}</TableCell><TableCell>{location.projectName || location.propertyName || 'Network-wide'}</TableCell><TableCell>{location.binOrRack || '—'}</TableCell><TableCell><Badge variant={location.active ? 'default' : 'secondary'}>{location.active ? 'Active' : 'Inactive'}</Badge></TableCell><TableCell><Button size="icon" variant="ghost" onClick={() => edit(location)}><Pencil className="h-4 w-4" /></Button></TableCell></TableRow>)}
      {!locations.length && <TableRow><TableCell colSpan={7} className="h-28 text-center text-muted-foreground">No inventory locations exist yet.</TableCell></TableRow>}
    </TableBody></Table></CardContent></Card>

    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>{form.id ? 'Edit inventory location' : 'Create inventory location'}</DialogTitle></DialogHeader><div className="grid gap-4 py-2 sm:grid-cols-2">
      <Field label="Location code *"><Input value={form.locationCode} disabled={Boolean(form.id)} onChange={(event) => setForm({ ...form, locationCode: event.target.value })} /></Field>
      <Field label="Location name *"><Input value={form.locationName} onChange={(event) => setForm({ ...form, locationName: event.target.value })} /></Field>
      <Field label="Location type"><Select value={form.type} onValueChange={(type: InventoryLocationType) => setForm({ ...form, type })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{types.map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}</SelectContent></Select></Field>
      {form.type === 'Project Store' ? <Field label="Project *"><Select value={form.projectId || ''} onValueChange={(projectId) => { const project = projects.find((item) => item.id === projectId); setForm({ ...form, projectId, projectName: project?.projectName || '' }); }}><SelectTrigger><SelectValue placeholder="Select project" /></SelectTrigger><SelectContent>{projects.map((project) => <SelectItem key={project.id} value={project.id}>{project.projectName}</SelectItem>)}</SelectContent></Select></Field> : <Field label="Property name"><Input value={form.propertyName || ''} onChange={(event) => setForm({ ...form, propertyName: event.target.value })} placeholder="Optional" /></Field>}
      <Field label="Bin / rack"><Input value={form.binOrRack || ''} onChange={(event) => setForm({ ...form, binOrRack: event.target.value })} /></Field>
      <Field label="Address"><Input value={form.address || ''} onChange={(event) => setForm({ ...form, address: event.target.value })} /></Field>
      <div className="flex items-center justify-between rounded-md border p-3 sm:col-span-2"><Label>Active location</Label><Switch checked={form.active} onCheckedChange={(active) => setForm({ ...form, active })} /></div>
    </div><DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save location'}</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <div className="space-y-1.5"><Label>{label}</Label>{children}</div>; }

