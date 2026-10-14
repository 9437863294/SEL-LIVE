'use client';

import type { ReactNode } from 'react';
import { Accessibility, Building2, LayoutDashboard, LayoutPanelLeft, Palette, SwatchBook } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { AppearanceSectionNav, SaveStatus, type SectionLink } from '@/components/appearance/controls';
import { useAuthorization } from '@/hooks/useAuthorization';
import { appearanceAdminRights, canOpenAppearanceAdmin } from '@/lib/appearance/permissions';
import { COMPANY_PROFILE_RESOURCE } from '@/lib/company-profile';

/**
 * Settings → Appearance — every design setting in one place. Three personal sections every user
 * has, then the company sections: branding and themes for the people allowed to manage them, and
 * Company Layout (sidebars, tables, dialogs, text labels — parts of the company profile — and
 * the company's animations) for `Settings.Company Profile` View/Edit holders and appearance
 * administrators. Hiding a section here is courtesy; the API routes behind the company sections
 * check the same rights and refuse everyone else.
 */
export default function AppearanceLayout({ children }: { children: ReactNode }) {
  const { can } = useAuthorization();
  const rights = appearanceAdminRights(can);
  const viewCompanyProfile = can('View', COMPANY_PROFILE_RESOURCE) || can('Edit', COMPANY_PROFILE_RESOURCE);
  const company = 'Company';
  const links: SectionLink[] = [
    { href: '/settings/appearance', label: 'My Appearance', icon: Palette },
    { href: '/settings/appearance/layout-navigation', label: 'Layout and Navigation', icon: LayoutPanelLeft },
    { href: '/settings/appearance/accessibility', label: 'Accessibility', icon: Accessibility },
    ...(rights.viewBranding ? [{ href: '/settings/appearance/branding', label: 'Company Branding', icon: Building2, group: company }] : []),
    ...(rights.viewThemes ? [{ href: '/settings/appearance/themes', label: 'Theme Management', icon: SwatchBook, group: company }] : []),
    ...(viewCompanyProfile || canOpenAppearanceAdmin(rights)
      ? [{ href: '/settings/appearance/company-layout', label: 'Layout, Text and Animations', icon: LayoutDashboard, group: company }]
      : []),
  ];

  return (
    <div className="space-y-4 px-3 py-3 sm:px-5">
      <PageHeader
        title="Appearance"
        description="How SEL Live looks and behaves for you — and, for administrators, for everyone."
        backHref="/settings"
        backLabel="Back to settings"
        actions={<SaveStatus />}
      />
      <AppearanceSectionNav links={links} />
      {children}
    </div>
  );
}
