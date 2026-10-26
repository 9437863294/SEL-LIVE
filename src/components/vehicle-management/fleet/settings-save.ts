'use client';

/**
 * Saving Settings › Fleet. The API takes the whole settings document, so each tab sends the saved
 * settings with only its own edits laid over them — an unsaved edit on another tab stays that tab's
 * draft instead of being saved, or lost, as a side effect.
 */

import { fleetFetch } from '@/components/fleet/fleet-api';
import type { FleetSettings } from '@/lib/fleet/types';

export async function saveFleetSettings(saved: FleetSettings, patch: Partial<FleetSettings>): Promise<FleetSettings> {
  // Who saved last is the server's to stamp.
  const current: Partial<FleetSettings> = { ...saved };
  delete current.updatedAt;
  delete current.updatedById;
  delete current.updatedByName;
  const result = await fleetFetch<{ settings: FleetSettings }>('settings', { method: 'PUT', body: { ...current, ...patch } });
  return result.settings;
}

/** Fields typed as text until saved, so a half-typed number is not forced to 0 under the cursor. */
export type NumberDraft<K extends string> = Partial<Record<K, string>>;

export function parseDraftNumbers<K extends string>(
  draft: NumberDraft<K>,
  rules: Record<K, { min: number; max: number; integer?: boolean; label: string }>,
): { values: Partial<Record<K, number>>; errors: Partial<Record<K, string>> } {
  const values: Partial<Record<K, number>> = {};
  const errors: Partial<Record<K, string>> = {};
  for (const key of Object.keys(draft) as K[]) {
    const text = (draft[key] ?? '').trim();
    const rule = rules[key];
    const parsed = Number(text);
    if (text === '' || !Number.isFinite(parsed)) errors[key] = `Enter ${rule.label.toLowerCase()}.`;
    else if (parsed < rule.min || parsed > rule.max) errors[key] = `From ${rule.min} to ${rule.max.toLocaleString('en-IN')}.`;
    else if (rule.integer && !Number.isInteger(parsed)) errors[key] = 'A whole number.';
    else values[key] = parsed;
  }
  return { values, errors };
}
