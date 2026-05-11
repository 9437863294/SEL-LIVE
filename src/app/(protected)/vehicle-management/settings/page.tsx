'use client';

import { useEffect, useRef, useState } from 'react';
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
import { Plus, Tag, Trash2, X } from 'lucide-react';

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

const yesNoValue = (value: boolean) => (value ? 'yes' : 'no');

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

  useEffect(() => {
    if (!typesLoading && !typesInitialized.current) {
      setLocalTypes(liveTypes);
      typesInitialized.current = true;
    }
  }, [liveTypes, typesLoading]);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      try {
        const ref = doc(db, VEHICLE_COLLECTIONS.settings, VEHICLE_SETTINGS_DOC_ID);
        const snap = await getDoc(ref);
        if (!snap.exists()) { setIsLoading(false); return; }
        const data = snap.data() as Record<string, any>;
        setSettings({
          driverLocationUpdateIntervalSec: Number(data.driverLocationUpdateIntervalSec || DEFAULT_TRACKING_SETTINGS.driverLocationUpdateIntervalSec),
          enableSnapToRoadHint: Boolean(data.enableSnapToRoadHint),
          allowBackgroundTrackingHint: data.allowBackgroundTrackingHint !== false,
        });
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
      {/* Header */}
      <Card className="vm-panel-strong overflow-hidden">
        <div className="h-1 w-full bg-gradient-to-r from-indigo-500 via-sky-500 to-cyan-600 animate-bb-gradient" />
        <CardHeader>
          <CardTitle className="tracking-tight">Vehicle Settings</CardTitle>
          <CardDescription>
            Manage vehicle types and trip tracking configuration.
          </CardDescription>
        </CardHeader>
      </Card>

      {/* Vehicle Types */}
      <Card className="vm-panel overflow-hidden">
        <div className="h-0.5 w-full bg-gradient-to-r from-violet-500 to-purple-600" />
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-violet-100 p-1.5">
              <Tag className="h-4 w-4 text-violet-600" />
            </div>
            <div>
              <CardTitle className="text-base">Vehicle Types</CardTitle>
              <CardDescription className="text-xs mt-0.5">
                These types appear in the Vehicle Type dropdown when adding or editing vehicles.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Current types */}
          <div className="min-h-[80px] rounded-lg border border-border/60 bg-muted/20 p-3">
            {localTypes.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No vehicle types defined. Add one below or reset to defaults.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {localTypes.map((type) => (
                  <Badge
                    key={type}
                    variant="secondary"
                    className="gap-1.5 pl-2.5 pr-1.5 py-1 text-xs font-medium bg-violet-50 text-violet-700 border border-violet-200 hover:bg-violet-100"
                  >
                    {type}
                    {canEdit && (
                      <button
                        onClick={() => removeType(type)}
                        className="rounded-full hover:bg-violet-200 p-0.5 transition-colors"
                        title={`Remove ${type}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* Add new type */}
          {canEdit && (
            <div className="flex gap-2">
              <Input
                value={newTypeName}
                onChange={(e) => setNewTypeName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addType()}
                placeholder="e.g. Excavator, Crane, Tractor..."
                className="bg-white/85 flex-1"
                maxLength={40}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={addType}
                disabled={!newTypeName.trim()}
                className="gap-1.5 border-violet-200 text-violet-700 hover:bg-violet-50"
              >
                <Plus className="h-3.5 w-3.5" />
                Add
              </Button>
            </div>
          )}

          {/* Actions */}
          {canEdit && (
            <div className="flex items-center gap-2 pt-1">
              <Button
                onClick={saveTypes}
                disabled={typesSaving}
                className="flex-1 bg-gradient-to-r from-violet-500 to-purple-600 text-white"
              >
                {typesSaving ? 'Saving...' : 'Save Vehicle Types'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={resetTypesToDefault}
                className="gap-1.5 text-muted-foreground"
                title="Reset to default types"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Reset
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tracking Settings */}
      <Card className="vm-panel overflow-hidden">
        <div className="h-0.5 w-full bg-gradient-to-r from-indigo-500 to-cyan-600" />
        <CardHeader>
          <CardTitle className="text-base">Trip Tracking Console</CardTitle>
          <CardDescription className="text-xs">
            Control how frequently driver trip location is pushed during active trips.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Location Update Interval</Label>
            <Select
              value={String(settings.driverLocationUpdateIntervalSec)}
              onValueChange={(value) =>
                setSettings((prev) => ({ ...prev, driverLocationUpdateIntervalSec: Number(value) }))
              }
            >
              <SelectTrigger className="bg-white/85">
                <SelectValue placeholder="Select update interval" />
              </SelectTrigger>
              <SelectContent>
                {intervalOptions.map((item) => (
                  <SelectItem key={item.value} value={String(item.value)}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Road Snapping Hint</Label>
            <Select
              value={yesNoValue(settings.enableSnapToRoadHint)}
              onValueChange={(value) =>
                setSettings((prev) => ({ ...prev, enableSnapToRoadHint: value === 'yes' }))
              }
            >
              <SelectTrigger className="bg-white/85">
                <SelectValue placeholder="Select option" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="yes">Enabled</SelectItem>
                <SelectItem value="no">Disabled</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Background Tracking Hint</Label>
            <Select
              value={yesNoValue(settings.allowBackgroundTrackingHint)}
              onValueChange={(value) =>
                setSettings((prev) => ({ ...prev, allowBackgroundTrackingHint: value === 'yes' }))
              }
            >
              <SelectTrigger className="bg-white/85">
                <SelectValue placeholder="Select option" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="yes">Allowed</SelectItem>
                <SelectItem value="no">Restricted</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="rounded-xl border border-cyan-100 bg-cyan-50/70 p-3 text-sm text-cyan-900">
            Driver app reads this configuration before tracking starts. For high-frequency mode, keep battery impact in mind.
          </div>

          <div className="md:col-span-2">
            <Button
              onClick={save}
              disabled={!canEdit || isSaving}
              className="w-full bg-gradient-to-r from-indigo-500 to-cyan-600 text-white"
            >
              {isSaving ? 'Saving...' : 'Save Tracking Settings'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
