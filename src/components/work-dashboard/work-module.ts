/**
 * The launcher's icon and colour for the module a work item came from, so a row on the board wears
 * the same tile as the module's card on the Modules tab.
 *
 * Work items name modules by their activity-log names (`@/lib/activity-modules`), which differ from
 * the launcher's catalogue for a few modules; those are mapped here. A module with no launcher card
 * falls back to the registry's plain document tile rather than borrowing another module's colour.
 */

import { moduleIcons } from '@/components/module-hub/module-catalog';
import { getModuleIconEntry, type ModuleIconEntry } from '@/components/module-hub/module-icon-registry';
import { gradientAccent } from '@/components/home/home-data';
import { canonicalModuleName } from '@/lib/activity-modules';
import { moduleDisplayName } from '@/lib/module-display-names';

const WORK_TO_LAUNCHER: Record<string, string> = {
  'Bank Guarantee': 'Bank Guarantee Management',
  'Letter of Credit': 'Letter of Credit Management',
};

/** Modules with work sources but no card of their own in the catalogue. */
const EXTRA_ICON_KEYS: Record<string, string> = {
  'HR & Recruitment': 'Users',
  Procurement: 'ShoppingCart',
};

export interface WorkModuleLook extends ModuleIconEntry {
  /** The gradient's end colour as hex, for a shadow or a bar in the module's colour. */
  accent: string;
  /** What the person sees, e.g. "Fleet & Travel" for Driver Management. */
  label: string;
}

const cache = new Map<string, WorkModuleLook>();

export function workModuleLook(module: string): WorkModuleLook {
  const cached = cache.get(module);
  if (cached) return cached;
  const canonical = canonicalModuleName(module);
  const launcherName = WORK_TO_LAUNCHER[canonical] ?? canonical;
  const entry = getModuleIconEntry(moduleIcons[launcherName] ?? EXTRA_ICON_KEYS[canonical]);
  // A renamed module shows its new name; otherwise the shorter work name ("Bank Guarantee").
  const display = moduleDisplayName(launcherName);
  const look = { ...entry, accent: gradientAccent(entry.gradient), label: display !== launcherName ? display : canonical };
  cache.set(module, look);
  return look;
}
