'use client';

import type { ReactNode } from 'react';
import { Accessibility, Building2, LayoutPanelLeft, Palette, SwatchBook } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { AppearanceSectionNav, SaveStatus, type SectionLink } from '@/components/appearance/controls';
import { useAuthorization } from '@/hooks/useAuthorization';
import { appearanceAdminRights } from '@/lib/appearance/permissions';

/**
 * Settings → Appearance: three personal sections every user has, and two company sections for
 * the people allowed to manage branding and themes. Hiding a section here is courtesy; the API
 * routes behind the company sections check the same rights and refuse everyone else.
 */
export default function AppearanceLayout({ children }: { children: ReactNode }) {
  const { can } = useAuthorization();
  const rights = appearanceAdminRights(can);
  const links: SectionLink[] = [
    { href: '/settings/appearance', label: 'My Appearance', icon: Palette },
    { href: '/settings/appearance/layout-navigation', label: 'Layout and Navigation', icon: LayoutPanelLeft },
    { href: '/settings/appearance/accessibility', label: 'Accessibility', icon: Accessibility },
    ...(rights.viewBranding ? [{ href: '/settings/appearance/branding', label: 'Company Branding', icon: Building2 }] : []),
    ...(rights.viewThemes ? [{ href: '/settings/appearance/themes', label: 'Theme Management', icon: SwatchBook }] : []),
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
