'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { DEFAULT_TRACKING_SETTINGS, VEHICLE_COLLECTIONS, VEHICLE_SETTINGS_DOC_ID } from '@/lib/vehicle-management';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowLeft, BatteryCharging, LocateFixed, Radio, RotateCcw, Save } from 'lucide-react';
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

export default function TripTrackingSettingsPage() {
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
  const savedSettings = useRef<TrackingSettings | null>(null);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const resetTrackingToDefault = () => {
    setSettings({ ...DEFAULT_TRACKING_SETTINGS });
  };

  const trackingDirty = savedSettings.current
    ? JSON.stringify(settings) !== JSON.stringify(savedSettings.current)
    : false;

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
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-60 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Link href="/vehicle-management/settings">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div>
          <h1 className="text-xl font-bold">Trip Tracking</h1>
          <p className="text-sm text-muted-foreground">Applied when the driver starts a tracked trip.</p>
        </div>
      </div>

      <Card className="vm-panel overflow-hidden">
        <div className="h-0.5 w-full bg-gradient-to-r from-teal-500 to-cyan-600" />
        <CardHeader className="border-b border-slate-100 p-4">
          <div className="flex items-start gap-3"><div className="rounded-lg bg-teal-100 p-2"><Radio className="h-4 w-4 text-teal-700" /></div><div className="flex-1"><CardTitle className="text-base">Trip Tracking Setup</CardTitle><CardDescription className="mt-0.5 text-xs">Applied when the driver starts a tracked trip.</CardDescription></div>{trackingDirty && <Badge className="bg-amber-500 text-white">Unsaved</Badge>}</div>
        </CardHeader>
        <CardContent className="space-y-3 p-4">
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex items-start gap-3"><div className="rounded-lg bg-teal-50 p-2 text-teal-600"><LocateFixed className="h-4 w-4" /></div><div className="min-w-0 flex-1"><Label className="font-semibold">Location Update Interval</Label><p className="mt-0.5 text-xs text-muted-foreground">How often the driver app records location during a trip.</p><Select disabled={!canEdit} value={String(settings.driverLocationUpdateIntervalSec)} onValueChange={(value) => setSettings((prev) => ({ ...prev, driverLocationUpdateIntervalSec: Number(value) }))}><SelectTrigger className="mt-3 bg-slate-50"><SelectValue /></SelectTrigger><SelectContent>{intervalOptions.map((item) => <SelectItem key={item.value} value={String(item.value)}>{item.label}</SelectItem>)}</SelectContent></Select></div></div>
          </div>

          <SettingSwitch icon={<LocateFixed className="h-4 w-4" />} title="Road Snapping Hint" description="Suggest matching captured points to the nearest road." checked={settings.enableSnapToRoadHint} disabled={!canEdit} onCheckedChange={(checked) => setSettings((prev) => ({ ...prev, enableSnapToRoadHint: checked }))} />
          <SettingSwitch icon={<BatteryCharging className="h-4 w-4" />} title="Background Tracking Hint" description="Allow location tracking while the driver app is in the background." checked={settings.allowBackgroundTrackingHint} disabled={!canEdit} onCheckedChange={(checked) => setSettings((prev) => ({ ...prev, allowBackgroundTrackingHint: checked }))} />

          <div className="rounded-xl border border-teal-100 bg-teal-50/70 p-3 text-xs leading-relaxed text-teal-900">The driver app reads these settings before tracking starts. Shorter intervals improve route detail but use more battery and mobile data.</div>

          <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <Button type="button" variant="ghost" onClick={resetTrackingToDefault} disabled={!canEdit} className="text-slate-600"><RotateCcw className="mr-1.5 h-4 w-4" />Restore Defaults</Button>
            <Button onClick={save} disabled={!canEdit || isSaving || !trackingDirty} className="bg-gradient-to-r from-teal-500 to-cyan-600 text-white"><Save className="mr-1.5 h-4 w-4" />{isSaving ? 'Saving...' : trackingDirty ? 'Save Tracking Settings' : 'Settings Saved'}</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SettingSwitch({ icon, title, description, checked, disabled, onCheckedChange }: { icon: ReactNode; title: string; description: string; checked: boolean; disabled: boolean; onCheckedChange: (checked: boolean) => void }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
      <div className="rounded-lg bg-teal-50 p-2 text-teal-700">{icon}</div>
      <div className="min-w-0 flex-1"><p className="text-sm font-semibold text-slate-800">{title}</p><p className="text-xs text-muted-foreground">{description}</p></div>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} className="data-[state=checked]:bg-teal-600" />
    </div>
  );
}
