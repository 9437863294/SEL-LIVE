'use client';

import { useCallback, useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import type { TripClaimSettings } from '@/lib/employee-trips/types';
import { errorMessage, tripFetch, type SettingsPayload } from './trip-api';
import { useTripClaims } from './trip-claims-provider';
import { useTripQuery } from './use-trip-query';

/**
 * The settings screen's data and its one save path. Each save sends one part (rules, workflow, a rate
 * card) and reports what the server did as a consequence — claims re-routed, unclaimed trips re-priced.
 */
export function useTripSettings() {
  const { toast } = useToast();
  const { reload: reloadBootstrap } = useTripClaims();
  const query = useTripQuery<SettingsPayload>('settings');
  const { setData } = query;
  const [saving, setSaving] = useState(false);

  const save = useCallback(
    async (body: Record<string, unknown>, title: string): Promise<boolean> => {
      setSaving(true);
      try {
        const result = await tripFetch<{ settings: TripClaimSettings; rerouted: number; repriced: number }>('settings', { method: 'PUT', body });
        setData((current) => (current ? { ...current, settings: result.settings } : current));
        const consequences = [
          result.rerouted ? `${result.rerouted} claim${result.rerouted === 1 ? '' : 's'} in process re-routed` : null,
          result.repriced ? `${result.repriced} unclaimed trip${result.repriced === 1 ? '' : 's'} re-priced` : null,
        ].filter(Boolean);
        toast({ title, description: consequences.length ? `${consequences.join('; ')}.` : undefined });
        reloadBootstrap();
        return true;
      } catch (failure) {
        toast({ variant: 'destructive', title: 'Not saved', description: errorMessage(failure) });
        return false;
      } finally {
        setSaving(false);
      }
    },
    [reloadBootstrap, setData, toast],
  );

  return { payload: query.data, error: query.error, saving, load: query.reload, save };
}
