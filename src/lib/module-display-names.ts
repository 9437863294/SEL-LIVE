/**
 * What a module is called on screen, where that differs from its key.
 *
 * The key — `Driver Management` — names the module's permissions (roles hold "Driver Management ·
 * Trip Claims · …"), its activity log and notification rows, and its place in the Module Hub layout
 * each user has saved. Renaming the key would orphan all of those, so the key stays and only the
 * label changes, here. The URL (`/driver-management`) stays too: the SEL Driver Android app opens it.
 *
 * - Driver Management → **Fleet & Travel** (2026-10-26): it is where every official trip is
 *   recorded — employees' own-vehicle travel, claimed per km, and company fleet running, billed to
 *   projects — not only the driver app it started as.
 */

export const MODULE_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  'Driver Management': 'Fleet & Travel',
};

export const moduleDisplayName = (key: string | null | undefined): string => (key ? MODULE_DISPLAY_NAMES[key] ?? key : '');
