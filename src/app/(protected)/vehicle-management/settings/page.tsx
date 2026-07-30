'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  DEFAULT_TRACKING_SETTINGS,
  DEFAULT_VEHICLE_TYPES,
  VEHICLE_COLLECTIONS,
  VEHICLE_SETTINGS_DOC_ID,
  VEHICLE_TYPES_DOC_ID,
} from '@/lib/vehicle-management';
import { useVehicleTypeOptions } from '@/components/vehicle-management/hooks';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { BatteryCharging, LocateFixed, Plus, Radio, RotateCcw, Save, Settings2, Tag, X } from 'lucide-react';
import { Switch } from '@/components/ui/switch';

type TrackingSettings = {
  driverLocationUpdateIntervalSec: number;
  enableSnapToRoadHint: boolean;
  allowBackgroundTrackingHint: boolean;
};

const intervalOptions = [
  { value: 10, label: 'Every 10 seconds' },
  { value: 30, label: 'Every 30 seconds' },
  { value: 60, label: 'Every 1 minute' },
];

export default function VehicleManagementSettingsPage() {
  const { can } = useAuthorization();
  const { toast } = useToast();
  const canView = can('View', 'Vehicle Management.Settings');
  const canEdit = can('Edit', 'Vehicle Management.Settings');

  // --- Tracking settings ---
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [settings, setSettings] = useState<TrackingSettings>({
    driverLocationUpdateIntervalSec: DEFAULT_TRACKING_SETTINGS.driverLocationUpdateIntervalSec,
    enableSnapToRoadHint: DEFAULT_TRACKING_SETTINGS.enableSnapToRoadHint,
    allowBackgroundTrackingHint: DEFAULT_TRACKING_SETTINGS.allowBackgroundTrackingHint,
  });

  // --- Vehicle types ---
  const { types: liveTypes, isLoading: typesLoading } = useVehicleTypeOptions();
  const [localTypes, setLocalTypes] = useState<string[]>([]);
  const [newTypeName, setNewTypeName] = useState('');
  const [typesSaving, setTypesSaving] = useState(false);
  const typesInitialized = useRef(false);
  const savedSettings = useRef<TrackingSettings | null>(null);
  const savedTypes = useRef<string[]>([]);

  useEffect(() => {
    if (!typesLoading && !typesInitialized.current) {
      setLocalTypes(liveTypes);
      savedTypes.current = [...liveTypes];
      typesInitialized.current = true;
    }
  }, [liveTypes, typesLoading]);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      try {
        const ref = doc(db, VEHICLE_COLLECTIONS.settings, VEHICLE_SETTINGS_DOC_ID);
        const snap = await getDoc(ref);
        if (!snap.exists()) {
          savedSettings.current = { ...settings };
          setIsLoading(false);
          return;
        }
        const data = snap.data() as Record<string, any>;
        const loaded = {
          driverLocationUpdateIntervalSec: Number(data.driverLocationUpdateIntervalSec || DEFAULT_TRACKING_SETTINGS.driverLocationUpdateIntervalSec),
          enableSnapToRoadHint: Boolean(data.enableSnapToRoadHint),
          allowBackgroundTrackingHint: data.allowBackgroundTrackingHint !== false,
        };
        setSettings(loaded);
        savedSettings.current = loaded;
      } catch {
        toast({ title: 'Error', description: 'Unable to load vehicle tracking settings.', variant: 'destructive' });
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [toast]);

  const save = async () => {
    if (!canEdit || isSaving) return;
    setIsSaving(true);
    try {
      await setDoc(
        doc(db, VEHICLE_COLLECTIONS.settings, VEHICLE_SETTINGS_DOC_ID),
        { ...settings, updatedAt: serverTimestamp() },
        { merge: true }
      );
      savedSettings.current = { ...settings };
      toast({ title: 'Saved', description: 'Tracking settings updated successfully.' });
    } catch {
      toast({ title: 'Error', description: 'Unable to save tracking settings.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const addType = () => {
    const trimmed = newTypeName.trim();
    if (!trimmed) return;
    if (localTypes.some((t) => t.toLowerCase() === trimmed.toLowerCase())) {
      toast({ title: 'Duplicate', description: `"${trimmed}" already exists.`, variant: 'destructive' });
      return;
    }
    setLocalTypes((prev) => [...prev, trimmed]);
    setNewTypeName('');
  };

  const removeType = (type: string) => {
    setLocalTypes((prev) => prev.filter((t) => t !== type));
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

  const resetTrackingToDefault = () => {
    setSettings({ ...DEFAULT_TRACKING_SETTINGS });
  };

  const trackingDirty = savedSettings.current
    ? JSON.stringify(settings) !== JSON.stringify(savedSettings.current)
    : false;
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

  if (isLoading || typesLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-28 w-full rounded-xl" />
        <Skeleton className="h-60 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="vm-panel-strong overflow-hidden">
        <div className="h-1 w-full bg-gradient-to-r from-indigo-500 via-sky-500 to-cyan-600 animate-bb-gradient" />
        <CardHeader className="flex flex-row items-start gap-3 p-4 sm:p-5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600"><Settings2 className="h-5 w-5" /></div>
          <div className="min-w-0 flex-1"><CardTitle className="text-lg tracking-tight">Vehicle Settings</CardTitle><CardDescription className="mt-0.5 text-xs">Configure master vehicle types and driver trip-tracking behaviour.</CardDescription></div>
          {!canEdit && <Badge variant="outline" className="bg-slate-50 text-slate-600">View only</Badge>}
        </CardHeader>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 xl:items-start">
        <Card className="vm-panel overflow-hidden">
          <div className="h-0.5 w-full bg-gradient-to-r from-violet-500 to-purple-600" />
          <CardHeader className="border-b border-slate-100 p-4">
            <div className="flex items-start gap-3">
              <div className="rounded-lg bg-violet-100 p-2"><Tag className="h-4 w-4 text-violet-600" /></div>
              <div className="flex-1"><CardTitle className="text-base">Vehicle Type Setup</CardTitle><CardDescription className="mt-0.5 text-xs">Controls the Vehicle Type dropdown in Vehicle Master.</CardDescription></div>
              <Badge variant="outline" className="bg-white">{localTypes.length} types</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 p-4">
            <div className="min-h-[118px] rounded-xl border border-violet-100 bg-violet-50/30 p-3">
              {localTypes.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No vehicle types configured.</p> : (
                <div className="flex flex-wrap gap-2">{localTypes.map((type) => (
                  <Badge key={type} variant="secondary" className="gap-1.5 border border-violet-200 bg-white py-1 pl-2.5 pr-1.5 text-xs font-medium text-violet-700">
                    {type}{canEdit && <button type="button" onClick={() => removeType(type)} className="rounded-full p-0.5 transition-colors hover:bg-violet-100" aria-label={`Remove ${type}`}><X className="h-3 w-3" /></button>}
                  </Badge>
                ))}</div>
              )}
            </div>

            <div className="space-y-1.5"><Label htmlFor="new-vehicle-type" className="text-xs font-semibold">Add Vehicle Type</Label><div className="flex gap-2"><Input id="new-vehicle-type" value={newTypeName} onChange={(event) => setNewTypeName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') addType(); }} placeholder="Example: Excavator" disabled={!canEdit} maxLength={40} className="bg-white" /><Button type="button" variant="outline" onClick={addType} disabled={!canEdit || !newTypeName.trim()} className="border-violet-200 text-violet-700"><Plus className="mr-1.5 h-4 w-4" />Add</Button></div></div>

            <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <Button type="button" variant="ghost" onClick={resetTypesToDefault} disabled={!canEdit} className="text-slate-600"><RotateCcw className="mr-1.5 h-4 w-4" />Restore Defaults</Button>
              <Button onClick={saveTypes} disabled={!canEdit || typesSaving || !typesDirty} className="bg-gradient-to-r from-violet-500 to-purple-600 text-white"><Save className="mr-1.5 h-4 w-4" />{typesSaving ? 'Saving...' : typesDirty ? 'Save Vehicle Types' : 'Types Saved'}</Button>
            </div>
          </CardContent>
        </Card>

        <Card className="vm-panel overflow-hidden">
          <div className="h-0.5 w-full bg-gradient-to-r from-indigo-500 to-cyan-600" />
          <CardHeader className="border-b border-slate-100 p-4">
            <div className="flex items-start gap-3"><div className="rounded-lg bg-cyan-100 p-2"><Radio className="h-4 w-4 text-cyan-700" /></div><div className="flex-1"><CardTitle className="text-base">Trip Tracking Setup</CardTitle><CardDescription className="mt-0.5 text-xs">Applied when the driver starts a tracked trip.</CardDescription></div>{trackingDirty && <Badge className="bg-amber-500 text-white">Unsaved</Badge>}</div>
          </CardHeader>
          <CardContent className="space-y-3 p-4">
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="flex items-start gap-3"><div className="rounded-lg bg-indigo-50 p-2 text-indigo-600"><LocateFixed className="h-4 w-4" /></div><div className="min-w-0 flex-1"><Label className="font-semibold">Location Update Interval</Label><p className="mt-0.5 text-xs text-muted-foreground">How often the driver app records location during a trip.</p><Select disabled={!canEdit} value={String(settings.driverLocationUpdateIntervalSec)} onValueChange={(value) => setSettings((prev) => ({ ...prev, driverLocationUpdateIntervalSec: Number(value) }))}><SelectTrigger className="mt-3 bg-slate-50"><SelectValue /></SelectTrigger><SelectContent>{intervalOptions.map((item) => <SelectItem key={item.value} value={String(item.value)}>{item.label}</SelectItem>)}</SelectContent></Select></div></div>
            </div>

            <SettingSwitch icon={<LocateFixed className="h-4 w-4" />} title="Road Snapping Hint" description="Suggest matching captured points to the nearest road." checked={settings.enableSnapToRoadHint} disabled={!canEdit} onCheckedChange={(checked) => setSettings((prev) => ({ ...prev, enableSnapToRoadHint: checked }))} />
            <SettingSwitch icon={<BatteryCharging className="h-4 w-4" />} title="Background Tracking Hint" description="Allow location tracking while the driver app is in the background." checked={settings.allowBackgroundTrackingHint} disabled={!canEdit} onCheckedChange={(checked) => setSettings((prev) => ({ ...prev, allowBackgroundTrackingHint: checked }))} />

            <div className="rounded-xl border border-cyan-100 bg-cyan-50/70 p-3 text-xs leading-relaxed text-cyan-900">The driver app reads these settings before tracking starts. Shorter intervals improve route detail but use more battery and mobile data.</div>

            <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <Button type="button" variant="ghost" onClick={resetTrackingToDefault} disabled={!canEdit} className="text-slate-600"><RotateCcw className="mr-1.5 h-4 w-4" />Restore Defaults</Button>
              <Button onClick={save} disabled={!canEdit || isSaving || !trackingDirty} className="bg-gradient-to-r from-indigo-500 to-cyan-600 text-white"><Save className="mr-1.5 h-4 w-4" />{isSaving ? 'Saving...' : trackingDirty ? 'Save Tracking Settings' : 'Settings Saved'}</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SettingSwitch({ icon, title, description, checked, disabled, onCheckedChange }: { icon: ReactNode; title: string; description: string; checked: boolean; disabled: boolean; onCheckedChange: (checked: boolean) => void }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
      <div className="rounded-lg bg-cyan-50 p-2 text-cyan-700">{icon}</div>
      <div className="min-w-0 flex-1"><p className="text-sm font-semibold text-slate-800">{title}</p><p className="text-xs text-muted-foreground">{description}</p></div>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} className="data-[state=checked]:bg-cyan-600" />
    </div>
  );
}
