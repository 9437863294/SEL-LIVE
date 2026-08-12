'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import {
  AlertTriangle,
  Boxes,
  Calculator,
  CheckCircle2,
  Component,
  PackageCheck,
  PackageMinus,
} from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import {
  asDateInput,
  maxBuildablePacks,
  packBuildRequirements,
  type InventoryBalance,
  type InventoryDocument,
  type InventoryItem,
  type InventoryLocation,
} from '@/lib/inventory';
import { inventoryCommand, inventoryRequestId } from '@/lib/inventory-client';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';

type PackAssemblyDocument = InventoryDocument & {
  unbuildQuantity?: number;
};

type AssemblyMode = 'build' | 'unbuild';

export default function PackAssemblyPage() {
  const { user } = useAuth();
  const { can, isLoading: authorizationLoading } = useAuthorization();
  const { toast } = useToast();
  const organizationId = user?.organizationId || 'default';
  const canView = can('View Inventory', 'Store & Stock Management.Inventory')
    || can('View Inventory', 'Store & Stock Management.Projects');
  const canBuild = can('Build Pack', 'Store & Stock Management.Inventory')
    || can('Manage All', 'Store & Stock Management.Inventory');
  // Existing Build Pack roles keep reverse access; new roles can separate it with Unbuild Pack.
  const canUnbuild = can('Unbuild Pack', 'Store & Stock Management.Inventory') || canBuild;
  const canViewCost = can('View Cost', 'Store & Stock Management.Inventory')
    || can('View Inventory', 'Store & Stock Management.Projects');

  const [items, setItems] = useState<InventoryItem[]>([]);
  const [locations, setLocations] = useState<InventoryLocation[]>([]);
  const [balances, setBalances] = useState<InventoryBalance[]>([]);
  const [documents, setDocuments] = useState<PackAssemblyDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<AssemblyMode>('build');
  const [mainItemId, setMainItemId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [transactionDate, setTransactionDate] = useState(asDateInput());
  const [referenceDocument, setReferenceDocument] = useState('');
  const [remarks, setRemarks] = useState('');

  const load = useCallback(async () => {
    if (!user || authorizationLoading || !canView) {
      if (!authorizationLoading) setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [itemSnapshot, locationSnapshot, balanceSnapshot, documentSnapshot] = await Promise.all([
        getDocs(query(collection(db, 'inventoryItems'), where('organizationId', '==', organizationId))),
        getDocs(query(collection(db, 'inventoryLocations'), where('organizationId', '==', organizationId))),
        getDocs(query(collection(db, 'inventoryBalances'), where('organizationId', '==', organizationId))),
        getDocs(query(collection(db, 'inventoryDocuments'), where('organizationId', '==', organizationId))),
      ]);
      const accessibleLocations = locationSnapshot.docs
        .map((document) => ({ id: document.id, ...document.data() }) as InventoryLocation)
        .filter((location) => location.active && (!location.allowedUserIds?.length || location.allowedUserIds.includes(user.id)))
        .sort((left, right) => left.locationName.localeCompare(right.locationName));
      const accessibleLocationIds = new Set(accessibleLocations.map((location) => location.id));
      setItems(itemSnapshot.docs
        .map((document) => ({ id: document.id, ...document.data() }) as InventoryItem)
        .filter((item) => item.active !== false && item.classification === 'Inventory'));
      setLocations(accessibleLocations);
      setBalances(balanceSnapshot.docs
        .map((document) => ({ id: document.id, ...document.data() }) as InventoryBalance)
        .filter((balance) => accessibleLocationIds.has(balance.locationId)));
      setDocuments(documentSnapshot.docs
        .map((document) => ({ id: document.id, ...document.data() }) as PackAssemblyDocument)
        .filter((document) => (
          ['Pack Assembly', 'Pack Disassembly'].includes(document.documentType)
          && Boolean(document.sourceLocationId && accessibleLocationIds.has(document.sourceLocationId))
        ))
        .sort((left, right) => right.transactionDate.localeCompare(left.transactionDate))
        .slice(0, 20));
    } catch (error) {
      console.error('Unable to load pack assemblies', error);
      toast({
        title: 'Unable to load pack assembly',
        description: 'Items, locations, or balances could not be loaded.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [authorizationLoading, canView, organizationId, toast, user]);

  useEffect(() => { void load(); }, [load]);

  const packItems = useMemo(
    () => items.filter((item) => Boolean(item.packList?.length)).sort((left, right) => left.itemName.localeCompare(right.itemName)),
    [items],
  );
  const selectedItem = items.find((item) => item.id === mainItemId);
  const itemMap = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const availableByItem = useMemo(() => new Map(items.map((item) => {
    const balance = balances.find((entry) => entry.itemId === item.id && entry.locationId === locationId);
    return [item.id, Number(balance?.availableQuantity || 0)];
  })), [balances, items, locationId]);
  const requirements = useMemo(
    () => packBuildRequirements(selectedItem?.packList || [], quantity),
    [quantity, selectedItem],
  );
  const maxBuildable = useMemo(
    () => maxBuildablePacks(selectedItem?.packList || [], availableByItem),
    [availableByItem, selectedItem],
  );
  const mainBalance = balances.find((entry) => entry.itemId === mainItemId && entry.locationId === locationId);
  const availableMainQuantity = Number(mainBalance?.availableQuantity || 0);
  const estimatedUnitCost = requirements.reduce((sum, requirement) => {
    const component = itemMap.get(requirement.itemId);
    const balance = balances.find((entry) => entry.itemId === requirement.itemId && entry.locationId === locationId);
    return sum + Number(requirement.quantity || 0) * Number(balance?.averageCost || component?.costRate || 0);
  }, 0);
  const componentShortage = requirements.some((requirement) => (
    Number(requirement.requiredQuantity || 0) > Number(availableByItem.get(requirement.itemId) || 0)
  ));
  const mainItemShortage = quantity > availableMainQuantity;
  const isUnbuild = mode === 'unbuild';
  const hasPermission = isUnbuild ? canUnbuild : canBuild;
  const isBlocked = isUnbuild ? mainItemShortage : componentShortage;

  const submit = async () => {
    if (!hasPermission) {
      toast({
        title: 'Permission required',
        description: `${isUnbuild ? 'Unbuild' : 'Build'} Pack permission is required.`,
        variant: 'destructive',
      });
      return;
    }
    if (!mainItemId || !locationId || !Number.isInteger(quantity) || quantity <= 0) {
      toast({
        title: `Complete the ${mode}`,
        description: `Select a main item, location, and positive whole ${mode} quantity.`,
        variant: 'destructive',
      });
      return;
    }
    if (!isUnbuild && componentShortage) {
      toast({
        title: 'Insufficient component stock',
        description: 'Reduce the build quantity or receive the missing sub-items first.',
        variant: 'destructive',
      });
      return;
    }
    if (isUnbuild && mainItemShortage) {
      toast({
        title: 'Insufficient main-item stock',
        description: `Only ${formatQuantity(availableMainQuantity)} ${selectedItem?.unit || ''} is available to unbuild.`,
        variant: 'destructive',
      });
      return;
    }

    setSaving(true);
    try {
      const result = await inventoryCommand<{ documentNumber: string; unitCost: number }>({
        action: isUnbuild ? 'unbuildPack' : 'buildPack',
        clientRequestId: inventoryRequestId(),
        transactionDate,
        locationId,
        mainItemId,
        ...(isUnbuild ? { unbuildQuantity: quantity } : { buildQuantity: quantity }),
        referenceDocument,
        remarks,
      });
      toast({
        title: `${result.documentNumber} posted`,
        description: isUnbuild
          ? `${quantity} ${selectedItem?.unit || ''} of ${selectedItem?.itemName || 'the main item'} unbuilt and its components returned to stock.`
          : `${quantity} ${selectedItem?.unit || ''} of ${selectedItem?.itemName || 'the main item'} added to stock.`,
      });
      setReferenceDocument('');
      setRemarks('');
      setQuantity(1);
      await load();
    } catch (error) {
      toast({
        title: `Pack ${mode} failed`,
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  if (authorizationLoading || loading) return <AssemblySkeleton />;
  if (!canView) {
    return <Card><CardHeader><CardTitle>Access denied</CardTitle><CardDescription>You do not have permission to view inventory assemblies.</CardDescription></CardHeader></Card>;
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-2 flex items-center gap-2 text-sm font-medium text-fuchsia-700">
          <Component className="h-4 w-4" />Inventory assembly
        </div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Build &amp; unbuild item packs</h1>
        <p className="text-muted-foreground">
          Create a main item from configured components or break finished stock back into those components.
        </p>
      </div>

      {!canBuild && !canUnbuild && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Assembly permission required</AlertTitle>
          <AlertDescription>Grant Build Pack or Unbuild Pack permission to post assembly transactions.</AlertDescription>
        </Alert>
      )}

      <div className="grid w-full max-w-xl grid-cols-2 rounded-xl border bg-muted p-1">
        <Button
          type="button"
          variant={isUnbuild ? 'ghost' : 'default'}
          className={!isUnbuild ? 'bg-fuchsia-700 hover:bg-fuchsia-800' : ''}
          onClick={() => setMode('build')}
        >
          <PackageCheck className="mr-2 h-4 w-4" />Build item
        </Button>
        <Button
          type="button"
          variant={isUnbuild ? 'default' : 'ghost'}
          className={isUnbuild ? 'bg-amber-600 hover:bg-amber-700' : ''}
          onClick={() => setMode('unbuild')}
        >
          <PackageMinus className="mr-2 h-4 w-4" />Unbuild item
        </Button>
      </div>

      <Alert>
        <CheckCircle2 className="h-4 w-4" />
        <AlertTitle>Controlled stock calculation</AlertTitle>
        <AlertDescription>
          {isUnbuild
            ? 'Unbuilding decreases available main-item stock and restores every configured component at the same location in one atomic posting.'
            : 'Building decreases every component and increases the main item at the same location in one atomic posting.'}
        </AlertDescription>
      </Alert>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)]">
        <Card>
          <CardHeader>
            <CardTitle>{isUnbuild ? 'Unbuild' : 'Build'} header</CardTitle>
            <CardDescription>Select a configured pack and the store where {isUnbuild ? 'disassembly' : 'assembly'} takes place.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="Main item / pack">
              <Select value={mainItemId} onValueChange={setMainItemId}>
                <SelectTrigger><SelectValue placeholder="Select pack item" /></SelectTrigger>
                <SelectContent>{packItems.map((item) => (
                  <SelectItem key={item.id} value={item.id}>{item.itemCode} · {item.itemName} ({item.unit})</SelectItem>
                ))}</SelectContent>
              </Select>
            </Field>
            <Field label="Assembly location">
              <Select value={locationId} onValueChange={setLocationId}>
                <SelectTrigger><SelectValue placeholder="Select store or warehouse" /></SelectTrigger>
                <SelectContent>{locations.map((location) => (
                  <SelectItem key={location.id} value={location.id}>{location.locationCode} · {location.locationName}</SelectItem>
                ))}</SelectContent>
              </Select>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={`${isUnbuild ? 'Unbuild' : 'Build'} date`}>
                <Input type="date" value={transactionDate} onChange={(event) => setTransactionDate(event.target.value)} />
              </Field>
              <Field label={`${isUnbuild ? 'Unbuild' : 'Build'} quantity${selectedItem ? ` (${selectedItem.unit})` : ''}`}>
                <Input type="number" min="1" step="1" value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} />
              </Field>
            </div>
            <Field label="Reference">
              <Input value={referenceDocument} onChange={(event) => setReferenceDocument(event.target.value)} placeholder="Work order / request / note" />
            </Field>
            <Field label="Remarks">
              <Textarea value={remarks} onChange={(event) => setRemarks(event.target.value)} placeholder={`${isUnbuild ? 'Disassembly' : 'Assembly'} details or special instructions`} />
            </Field>
            <Button
              className={isUnbuild ? 'w-full bg-amber-600 hover:bg-amber-700' : 'w-full'}
              size="lg"
              disabled={saving || !hasPermission || !selectedItem || !locationId || isBlocked}
              onClick={submit}
            >
              {saving
                ? `${isUnbuild ? 'Unbuilding' : 'Building'} and posting…`
                : `${isUnbuild ? 'Unbuild' : 'Build'} ${quantity || 0} ${selectedItem?.unit || 'pack(s)'}`}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{isUnbuild ? 'Component recovery' : 'Component calculation'}</CardTitle>
            <CardDescription>
              {selectedItem
                ? `${selectedItem.packList?.length || 0} sub-items ${isUnbuild ? 'recovered from' : 'required for'} ${quantity || 0} ${selectedItem.unit}`
                : 'Select a main item to calculate its sub-items.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {selectedItem && locationId && (
              <div className="grid gap-3 sm:grid-cols-3">
                <MiniMetric
                  icon={Boxes}
                  label={isUnbuild ? 'Available to unbuild' : 'Maximum buildable'}
                  value={`${formatQuantity(isUnbuild ? availableMainQuantity : maxBuildable)} ${selectedItem.unit}`}
                />
                <MiniMetric icon={Calculator} label={`${isUnbuild ? 'Unbuild' : 'Build'} quantity`} value={`${quantity || 0} ${selectedItem.unit}`} />
                <MiniMetric
                  icon={isUnbuild ? PackageMinus : PackageCheck}
                  label={isUnbuild ? 'Main item unit cost' : 'Estimated unit cost'}
                  value={canViewCost
                    ? formatCurrency(isUnbuild ? Number(mainBalance?.averageCost || selectedItem.costRate || 0) : estimatedUnitCost)
                    : 'Restricted'}
                />
              </div>
            )}

            <div className="overflow-x-auto rounded-xl border">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Sub-item</TableHead>
                  <TableHead className="text-right">Per main item</TableHead>
                  <TableHead className="text-right">{isUnbuild ? 'Recovered' : 'Required'}</TableHead>
                  <TableHead className="text-right">Current stock</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {requirements.map((requirement) => {
                    const component = itemMap.get(requirement.itemId);
                    const available = Number(availableByItem.get(requirement.itemId) || 0);
                    const short = !isUnbuild && Number(requirement.requiredQuantity || 0) > available;
                    return (
                      <TableRow key={requirement.itemId}>
                        <TableCell>
                          <div className="font-medium">{component?.itemName || requirement.itemName}</div>
                          <div className="text-xs text-muted-foreground">{component?.itemCode || requirement.itemCode} · {component?.unit || requirement.unit}</div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatQuantity(requirement.quantity)}</TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">{formatQuantity(requirement.requiredQuantity)}</TableCell>
                        <TableCell className="text-right tabular-nums">{locationId ? formatQuantity(available) : '—'}</TableCell>
                        <TableCell>
                          {!locationId
                            ? <Badge variant="secondary">Select location</Badge>
                            : isUnbuild
                              ? <Badge className="bg-amber-600 hover:bg-amber-600">Will recover</Badge>
                              : short
                                ? <Badge variant="destructive">Short</Badge>
                                : <Badge className="bg-emerald-600 hover:bg-emerald-600">Ready</Badge>}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {!requirements.length && (
                    <TableRow><TableCell colSpan={5} className="h-36 text-center text-muted-foreground">
                      {packItems.length ? 'Select a pack item to see its component calculation.' : 'No items have a pack list yet. Add one from Item Master.'}
                    </TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            {!isUnbuild && componentShortage && (
              <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Not enough component stock</AlertTitle><AlertDescription>At least one sub-item is below the requirement. Posting is blocked to prevent negative inventory.</AlertDescription></Alert>
            )}
            {isUnbuild && mainItemShortage && (
              <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Not enough finished-item stock</AlertTitle><AlertDescription>Reduce the unbuild quantity to {formatQuantity(availableMainQuantity)} {selectedItem?.unit || ''} or less.</AlertDescription></Alert>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent build and unbuild activity</CardTitle>
          <CardDescription>The latest posted assembly transactions at your authorized locations.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Date / document</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Main item</TableHead>
              <TableHead>Location</TableHead>
              <TableHead className="text-right">Quantity</TableHead>
              <TableHead className="text-right">Unit cost</TableHead>
              <TableHead className="text-right">Total value</TableHead>
              <TableHead>Status</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {documents.map((document) => {
                const unbuilt = document.documentType === 'Pack Disassembly';
                const mainLine = document.lines?.find((line) => (
                  unbuilt ? line.lineRole === 'Disassembled' : line.lineRole === 'Output'
                )) || document.lines?.[0];
                const documentQuantity = document.unbuildQuantity || document.buildQuantity || mainLine?.quantity || 0;
                return (
                  <TableRow key={document.id}>
                    <TableCell><div>{document.transactionDate}</div><div className="font-mono text-xs text-muted-foreground">{document.documentNumber}</div></TableCell>
                    <TableCell><Badge className={unbuilt ? 'bg-amber-600 hover:bg-amber-600' : 'bg-fuchsia-700 hover:bg-fuchsia-700'}>{unbuilt ? 'Unbuilt' : 'Built'}</Badge></TableCell>
                    <TableCell><div className="font-medium">{document.mainItemName || mainLine?.itemName}</div><div className="text-xs text-muted-foreground">{document.mainItemCode || mainLine?.itemCode}</div></TableCell>
                    <TableCell>{document.sourceLocationName || '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatQuantity(documentQuantity)} {mainLine?.unit}</TableCell>
                    <TableCell className="text-right">{canViewCost ? formatCurrency(mainLine?.unitCost || 0) : 'Restricted'}</TableCell>
                    <TableCell className="text-right">{canViewCost ? formatCurrency(Number(mainLine?.unitCost || 0) * Number(documentQuantity)) : 'Restricted'}</TableCell>
                    <TableCell><Badge className="bg-emerald-600 hover:bg-emerald-600">{document.status}</Badge></TableCell>
                  </TableRow>
                );
              })}
              {!documents.length && <TableRow><TableCell colSpan={8} className="h-28 text-center text-muted-foreground">No pack assembly transactions have been posted yet.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label>{label}</Label>{children}</div>;
}

function MiniMetric({ icon: Icon, label, value }: { icon: typeof Boxes; label: string; value: string }) {
  return <div className="flex items-center gap-3 rounded-xl border bg-slate-50 p-3"><div className="rounded-lg bg-fuchsia-100 p-2"><Icon className="h-4 w-4 text-fuchsia-700" /></div><div><p className="text-xs text-muted-foreground">{label}</p><p className="font-semibold">{value}</p></div></div>;
}

function formatQuantity(value: number) {
  return Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });
}

function formatCurrency(value: number) {
  return `₹${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function AssemblySkeleton() {
  return <div className="space-y-6"><Skeleton className="h-12 w-72" /><div className="grid gap-4 lg:grid-cols-2"><Skeleton className="h-[520px]" /><Skeleton className="h-[520px]" /></div><Skeleton className="h-72" /></div>;
}
