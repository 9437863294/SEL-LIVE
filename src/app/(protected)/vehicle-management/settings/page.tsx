'use client';

import { useEffect, useState } from 'react';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  DEFAULT_TRACKING_SETTINGS,
  VEHICLE_COLLECTIONS,
  VEHICLE_SETTINGS_DOC_ID,
} from '@/lib/vehicle-management';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

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
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [settings, setSettings] = useState<TrackingSettings>({
    driverLocationUpdateIntervalSec: DEFAULT_TRACKING_SETTINGS.driverLocationUpdateIntervalSec,
    enableSnapToRoadHint: DEFAULT_TRACKING_SETTINGS.enableSnapToRoadHint,
    allowBackgroundTrackingHint: DEFAULT_TRACKING_SETTINGS.allowBackgroundTrackingHint,
  });

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      try {
        const ref = doc(db, VEHICLE_COLLECTIONS.settings, VEHICLE_SETTINGS_DOC_ID);
        const snap = await getDoc(ref);
        if (!snap.exists()) {
          setIsLoading(false);
          return;
        }
        const data = snap.data() as Record<string, any>;
        setSettings({
          driverLocationUpdateIntervalSec: Number(data.driverLocationUpdateIntervalSec || DEFAULT_TRACKING_SETTINGS.driverLocationUpdateIntervalSec),
          enableSnapToRoadHint: Boolean(data.enableSnapToRoadHint),
          allowBackgroundTrackingHint: data.allowBackgroundTrackingHint !== false,
        });
      } catch (error) {
        console.error('Failed to load tracking settings', error);
        toast({
          title: 'Error',
          description: 'Unable to load vehicle tracking settings.',
          variant: 'destructive',
        });
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
        {
          ...settings,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      toast({
        title: 'Saved',
        description: 'Tracking settings updated successfully.',
      });
    } catch (error) {
      console.error('Failed to save tracking settings', error);
      toast({
        title: 'Error',
        description: 'Unable to save tracking settings.',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
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

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-28 w-full rounded-xl" />
        <Skeleton className="h-60 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="vm-panel-strong overflow-hidden">
        <div className="h-1 w-full bg-gradient-to-r from-indigo-500 via-sky-500 to-cyan-600 animate-bb-gradient" />
        <CardHeader>
          <CardTitle className="tracking-tight">Vehicle Tracking Settings</CardTitle>
          <CardDescription>
            Control how frequently driver trip location is pushed during active trips.
          </CardDescription>
        </CardHeader>
      </Card>

      <Card className="vm-panel">
        <CardHeader>
          <CardTitle className="text-lg">Trip Tracking Console</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Location Update Interval</Label>
            <Select
              value={String(settings.driverLocationUpdateIntervalSec)}
              onValueChange={(value) =>
                setSettings((prev) => ({
                  ...prev,
                  driverLocationUpdateIntervalSec: Number(value),
                }))
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
                setSettings((prev) => ({
                  ...prev,
                  enableSnapToRoadHint: value === 'yes',
                }))
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
                setSettings((prev) => ({
                  ...prev,
                  allowBackgroundTrackingHint: value === 'yes',
                }))
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
