'use client';

/**
 * Vehicle Management › Settings › Fleet: everything the fleet system is configured by, on one page
 * reached from the Settings hub (not the sidebar). Tabs, because each part is edited by a different
 * person on a different day — the limits rarely, the vehicles' approvers when staff change, the
 * purposes almost never — and one long form would save them all at once.
 *
 * Read-only for Fleet Settings · View; editable with Fleet Settings · Edit or Vehicle Management ·
 * Settings · Edit. Geofences themselves are drawn on their own page, linked from here.
 */

import Link from 'next/link';
import { useState } from 'react';
import { Bell, Building2, CarFront, ListChecks, MapPinned, SlidersHorizontal, Truck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/components/shared/page-header';
import { ErrorBlock, LoadingBlock } from '@/components/driver-management/trips/trip-ui';
import type { FleetSettings } from '@/lib/fleet/types';
import { useFleetMasters, useFleetSettingsAccess } from './fleet-masters';
import NotificationSettings from './notification-settings';
import ProjectSitesSettings from './project-sites-settings';
import PurposesSettings from './purposes-settings';
import RulesLimitsSettings from './rules-limits-settings';
import VehicleFleetSettings from './vehicle-fleet-settings';

type Tab = 'rules' | 'approvals' | 'purposes' | 'vehicles' | 'sites';

const TABS: { value: Tab; label: string; icon: typeof Truck }[] = [
  { value: 'rules', label: 'Rules & limits', icon: SlidersHorizontal },
  { value: 'approvals', label: 'Approvals & notifications', icon: Bell },
  { value: 'purposes', label: 'Purposes', icon: ListChecks },
  { value: 'vehicles', label: 'Vehicles', icon: CarFront },
  { value: 'sites', label: 'Project sites', icon: Building2 },
];

export default function FleetSettingsPage() {
  const { canView, canEdit, isLoading } = useFleetSettingsAccess();
  const { data, error, loading, reload, setData } = useFleetMasters();
  const [tab, setTab] = useState<Tab>('rules');

  if (isLoading || (loading && !data)) return <LoadingBlock />;
  if (!canView && !data) return <ErrorBlock message="Fleet settings need Vehicle Management · Fleet Settings · View." />;
  if (!data) return <ErrorBlock message={error ?? 'Could not load the fleet settings.'} onRetry={() => void reload()} />;

  const savedSettings = (settings: FleetSettings) => {
    setData((current) => (current ? { ...current, settings } : current));
    // Vehicles' defaults follow the settings: reload so the Vehicles tab shows them.
    void reload();
  };
  const refresh = () => void reload();
  const updated = data.settings.updatedAt ? `Last changed ${data.settings.updatedAt.slice(0, 10)}${data.settings.updatedByName ? ` by ${data.settings.updatedByName}` : ''}.` : 'Defaults — not changed yet.';

  return (
    <div className="space-y-4">
      <PageHeader
        title="Fleet settings"
        icon={Truck}
        backHref="/vehicle-management/settings"
        description={`Daily km limits, the GPS/odometer rule, approvals, purposes and each vehicle's fleet figures. ${updated}`}
        actions={
          <Button asChild variant="outline">
            <Link href="/vehicle-management/fleet/geofences">
              <MapPinned className="mr-2 h-4 w-4" aria-hidden />
              Geofences
            </Link>
          </Button>
        }
      />
      {!canEdit && <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">You can view these settings. Changing them needs Fleet Settings · Edit.</p>}

      <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)}>
        <TabsList className="h-auto max-w-full justify-start overflow-x-auto">
          {TABS.map((entry) => (
            <TabsTrigger key={entry.value} value={entry.value} className="gap-1.5 whitespace-nowrap">
              <entry.icon className="h-4 w-4" aria-hidden />
              {entry.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="rules" className="mt-4">
          <RulesLimitsSettings settings={data.settings} canEdit={canEdit} onSaved={savedSettings} />
        </TabsContent>
        <TabsContent value="approvals" className="mt-4">
          <NotificationSettings settings={data.settings} users={data.users} canEdit={canEdit} onSaved={savedSettings} />
        </TabsContent>
        <TabsContent value="purposes" className="mt-4">
          <PurposesSettings purposes={data.purposes} canEdit={canEdit} onChanged={refresh} />
        </TabsContent>
        <TabsContent value="vehicles" className="mt-4">
          <VehicleFleetSettings vehicles={data.vehicles} settings={data.settings} users={data.users} geofences={data.geofences} canEdit={canEdit} onChanged={refresh} />
        </TabsContent>
        <TabsContent value="sites" className="mt-4">
          <ProjectSitesSettings projects={data.projects} geofences={data.geofences} canEdit={canEdit} onChanged={refresh} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
