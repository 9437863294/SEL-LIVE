'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { serverTimestamp, setDoc, doc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { DEFAULT_VEHICLE_TYPES, VEHICLE_COLLECTIONS, VEHICLE_TYPES_DOC_ID } from '@/lib/vehicle-management';
import { useVehicleOptions, useVehicleTypeOptions } from '@/components/vehicle-management/hooks';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { AlertTriangle, CarFront, Plus, RotateCcw, Save, Search, Tag, Trash2, ArrowLeft } from 'lucide-react';

export default function VehicleTypesSettingsPage() {
  const { can } = useAuthorization();
  const { toast } = useToast();
  const canView = can('View', 'Vehicle Management.Settings');
  const canEdit = can('Edit', 'Vehicle Management.Settings');

  const { types: liveTypes, isLoading: typesLoading } = useVehicleTypeOptions();
  const { rows: vehicleRows, isLoading: vehiclesLoading } = useVehicleOptions();
  const [localTypes, setLocalTypes] = useState<string[]>([]);
  const [newTypeName, setNewTypeName] = useState('');
  const [search, setSearch] = useState('');
  const [typesSaving, setTypesSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const typesInitialized = useRef(false);
  const savedTypes = useRef<string[]>([]);

  useEffect(() => {
    if (!typesLoading && !typesInitialized.current) {
      setLocalTypes(liveTypes);
      savedTypes.current = [...liveTypes];
      typesInitialized.current = true;
    }
  }, [liveTypes, typesLoading]);

  // How many registered vehicles currently use each type — lets an admin see at a glance
  // whether a type is safe to remove instead of finding out after the fact.
  const usageByType = useMemo(() => {
    const counts: Record<string, number> = {};
    vehicleRows.forEach((row) => {
      const type = String(row.vehicleType || '').trim();
      if (!type) return;
      counts[type] = (counts[type] || 0) + 1;
    });
    return counts;
  }, [vehicleRows]);

  const sortedTypes = useMemo(
    () => [...localTypes].sort((a, b) => a.localeCompare(b)),
    [localTypes]
  );
  const visibleTypes = useMemo(
    () => sortedTypes.filter((type) => type.toLowerCase().includes(search.trim().toLowerCase())),
    [sortedTypes, search]
  );
  const usedCount = useMemo(() => localTypes.filter((type) => usageByType[type] > 0).length, [localTypes, usageByType]);

  const addType = () => {
    const trimmed = newTypeName.trim();
    if (!trimmed) return;
    if (localTypes.some((t) => t.toLowerCase() === trimmed.toLowerCase())) {
      toast({ title: 'Duplicate', description: `"${trimmed}" already exists.`, variant: 'destructive' });
      return;
    }
    setLocalTypes((prev) => [...prev, trimmed]);
    setNewTypeName('');
    toast({ title: 'Added', description: `"${trimmed}" will be available once you save.` });
  };

  const confirmRemoveType = () => {
    if (!pendingDelete) return;
    setLocalTypes((prev) => prev.filter((t) => t !== pendingDelete));
    setPendingDelete(null);
  };

  const saveTypes = async () => {
    if (!canEdit || typesSaving) return;
    setTypesSaving(true);
    try {
      await setDoc(
        doc(db, VEHICLE_COLLECTIONS.settings, VEHICLE_TYPES_DOC_ID),
        { types: localTypes, updatedAt: serverTimestamp() },
        { merge: true }
      );
      savedTypes.current = [...localTypes];
      toast({ title: 'Saved', description: 'Vehicle types updated successfully.' });
    } catch {
      toast({ title: 'Error', description: 'Unable to save vehicle types.', variant: 'destructive' });
    } finally {
      setTypesSaving(false);
    }
  };

  const resetTypesToDefault = () => {
    setLocalTypes([...DEFAULT_VEHICLE_TYPES]);
  };

  const typesDirty = JSON.stringify(localTypes) !== JSON.stringify(savedTypes.current);

  if (!canView) {
    return (
      <Card className="vm-panel-strong">
        <CardHeader>
          <CardTitle>Access Restricted</CardTitle>
          <CardDescription>You do not have permission to view vehicle settings.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (typesLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-28 w-full rounded-xl" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
    );
  }

  const pendingDeleteUsage = pendingDelete ? usageByType[pendingDelete] || 0 : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Link href="/vehicle-management/settings">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div>
          <h1 className="text-xl font-bold">Vehicle Types</h1>
          <p className="text-sm text-muted-foreground">Controls the Vehicle Type dropdown in Vehicle Master.</p>
        </div>
      </div>

      {/* Hero + stats */}
      <Card className="vm-panel-strong overflow-hidden">
        <div className="h-1 w-full bg-gradient-to-r from-violet-500 to-purple-600" />
        <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-100">
              <Tag className="h-5 w-5 text-violet-600" />
            </div>
            <div>
              <p className="font-semibold text-slate-900">Vehicle Type Setup</p>
              <p className="text-xs text-muted-foreground">Add or remove the types available when registering a vehicle.</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:gap-2">
            <div className="rounded-lg border border-violet-100 bg-violet-50/50 px-3 py-2 text-center">
              <p className="text-lg font-bold leading-tight text-violet-700">{localTypes.length}</p>
              <p className="text-[11px] text-muted-foreground">Total types</p>
            </div>
            <div className="rounded-lg border border-emerald-100 bg-emerald-50/50 px-3 py-2 text-center">
              <p className="text-lg font-bold leading-tight text-emerald-700">{vehiclesLoading ? '…' : usedCount}</p>
              <p className="text-[11px] text-muted-foreground">In use</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Toolbar: search + add */}
      <Card className="vm-panel overflow-hidden">
        <CardContent className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="type-search" className="text-xs font-semibold text-slate-600">Search types</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="type-search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search vehicle types…"
                className="bg-white pl-8"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-vehicle-type" className="text-xs font-semibold text-slate-600">Add a new type</Label>
            <div className="flex gap-2">
              <Input
                id="new-vehicle-type"
                value={newTypeName}
                onChange={(event) => setNewTypeName(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') addType(); }}
                placeholder="Example: Excavator"
                disabled={!canEdit}
                maxLength={40}
                className="bg-white"
              />
              <Button type="button" onClick={addType} disabled={!canEdit || !newTypeName.trim()} className="shrink-0 border-violet-200 bg-violet-600 text-white hover:bg-violet-700">
                <Plus className="mr-1.5 h-4 w-4" />Add
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* List */}
      <Card className="vm-panel overflow-hidden">
        <CardHeader className="flex flex-row items-center justify-between border-b border-slate-100 p-4">
          <div>
            <CardTitle className="text-base">Configured Types</CardTitle>
            <CardDescription className="mt-0.5 text-xs">Sorted alphabetically. Vehicle counts reflect current Vehicle Master records.</CardDescription>
          </div>
          <Badge variant="outline" className="bg-white">{visibleTypes.length} of {localTypes.length}</Badge>
        </CardHeader>
        <CardContent className="p-0">
          {visibleTypes.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-14 text-center text-sm text-muted-foreground">
              <Tag className="h-8 w-8 text-muted-foreground/40" />
              {localTypes.length === 0 ? 'No vehicle types configured yet.' : 'No types match your search.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Vehicles</TableHead>
                    {canEdit && <TableHead className="text-right">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleTypes.map((type) => {
                    const count = usageByType[type] || 0;
                    return (
                      <TableRow key={type}>
                        <TableCell className="font-medium text-slate-800">
                          <span className="flex items-center gap-2">
                            <CarFront className="h-3.5 w-3.5 text-violet-500" />
                            {type}
                          </span>
                        </TableCell>
                        <TableCell>
                          {vehiclesLoading ? (
                            <Skeleton className="h-5 w-16" />
                          ) : count > 0 ? (
                            <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">{count} vehicle{count === 1 ? '' : 's'}</Badge>
                          ) : (
                            <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-500">Not used</Badge>
                          )}
                        </TableCell>
                        {canEdit && (
                          <TableCell className="text-right">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive hover:bg-destructive/10"
                              onClick={() => setPendingDelete(type)}
                              aria-label={`Remove ${type}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Save bar */}
      <Card className="vm-panel overflow-hidden">
        <CardContent className="flex flex-col-reverse gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
          <Button type="button" variant="ghost" onClick={resetTypesToDefault} disabled={!canEdit} className="text-slate-600">
            <RotateCcw className="mr-1.5 h-4 w-4" />Restore Defaults
          </Button>
          <div className="flex items-center gap-2">
            {typesDirty && <Badge className="bg-amber-500 text-white">Unsaved changes</Badge>}
            <Button onClick={saveTypes} disabled={!canEdit || typesSaving || !typesDirty} className="bg-gradient-to-r from-violet-500 to-purple-600 text-white">
              <Save className="mr-1.5 h-4 w-4" />{typesSaving ? 'Saving...' : typesDirty ? 'Save Vehicle Types' : 'Types Saved'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => { if (!open) setPendingDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              {pendingDeleteUsage > 0 && <AlertTriangle className="h-5 w-5 text-amber-500" />}
              Remove "{pendingDelete}"?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDeleteUsage > 0
                ? `${pendingDeleteUsage} vehicle${pendingDeleteUsage === 1 ? '' : 's'} currently ${pendingDeleteUsage === 1 ? 'has' : 'have'} this type. They'll keep their existing value, but it will no longer appear as a selectable option once you save — editing one of those vehicles will show an empty Vehicle Type field until it's reselected.`
                : 'This type is not currently used by any vehicle. It will be removed from the Vehicle Type dropdown once you save.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmRemoveType} className="bg-destructive hover:bg-destructive/90">
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
