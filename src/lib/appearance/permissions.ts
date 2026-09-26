/**
 * Who may change what everybody sees. The same answers in the browser (to show or hide controls)
 * and in the API routes (to allow or refuse the write) — the routes are what actually decide.
 *
 * Personal appearance is not here: every signed-in user manages their own, with no permission.
 *
 * Nobody holds the two new resources on the day they ship, so the administrators who already run
 * the access system — `Settings.Access Management: Administer`, or the User Management + Role
 * Management edit pair (`canOpenAccessManagement`'s fallback) — may act until the resources are
 * granted to whoever should own branding and theming.
 */
export type AppearanceChecker = (action: string, resource: string) => boolean;

export const BRANDING_RESOURCE = 'Settings.Company Branding';
export const THEME_RESOURCE = 'Settings.Theme Management';

function isAccessAdministrator(can: AppearanceChecker): boolean {
  return (
    can('Administer', 'Settings.Access Management') ||
    (can('Edit', 'Settings.User Management') && can('Edit', 'Settings.Role Management'))
  );
}

export interface AppearanceAdminRights {
  viewBranding: boolean;
  editBranding: boolean;
  viewThemes: boolean;
  editThemes: boolean;
  publishThemes: boolean;
}

export function appearanceAdminRights(can: AppearanceChecker): AppearanceAdminRights {
  const admin = isAccessAdministrator(can);
  const editBranding = admin || can('Edit', BRANDING_RESOURCE);
  const publishThemes = admin || can('Publish', THEME_RESOURCE);
  const editThemes = publishThemes || can('Edit', THEME_RESOURCE);
  return {
    viewBranding: editBranding || can('View', BRANDING_RESOURCE),
    editBranding,
    viewThemes: editThemes || can('View', THEME_RESOURCE),
    editThemes,
    publishThemes,
  };
}

export function canOpenAppearanceAdmin(rights: AppearanceAdminRights): boolean {
  return rights.viewBranding || rights.viewThemes;
}
