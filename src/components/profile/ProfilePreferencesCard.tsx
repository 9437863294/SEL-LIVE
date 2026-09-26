'use client';

import Link from 'next/link';
import { Accessibility, ChevronRight, LayoutPanelLeft, Palette, SlidersHorizontal } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAppearance } from '@/components/theme/ThemeProvider';
import { themeModeMeta } from '@/components/theme/theme-preferences';
import { ACCENTS, FONT_META } from '@/lib/appearance/model';

const TEXT_LABEL = { small: 'Small text', default: 'Default text', large: 'Large text' } as const;
const DENSITY_LABEL = { comfortable: 'Comfortable', standard: 'Standard density', compact: 'Compact' } as const;

/** What the person's SEL Live looks like right now, and where to change it. */
export function ProfilePreferencesCard() {
  const { effective, company } = useAppearance();
  const accent = effective.accent === 'brand' ? `${company.branding.shortName} brand` : ACCENTS[effective.accent].label;
  const summary = [
    themeModeMeta[effective.mode].label,
    accent,
    TEXT_LABEL[effective.textSize],
    DENSITY_LABEL[effective.density],
    FONT_META[effective.font].label,
    effective.contrast === 'high' ? 'High contrast' : null,
    effective.motion === 'reduced' ? 'Reduced motion' : null,
  ].filter(Boolean);

  const links = [
    { href: '/settings/appearance', label: 'My Appearance', hint: 'Theme, accent, text size, density', icon: Palette },
    { href: '/settings/appearance/layout-navigation', label: 'Layout and Navigation', hint: 'Sidebars, launcher, breadcrumbs', icon: LayoutPanelLeft },
    { href: '/settings/appearance/accessibility', label: 'Accessibility', hint: 'Contrast, motion, keyboard', icon: Accessibility },
  ];

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <CardTitle className="text-base">Preferences</CardTitle>
        </div>
        <CardDescription>Your appearance follows you to every device you sign in on.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="flex flex-wrap gap-1.5" aria-label="Current appearance">
          {summary.map((item) => (
            <li key={item} className="rounded-full border bg-muted/40 px-2.5 py-0.5 text-xs">
              {item}
            </li>
          ))}
        </ul>
        <nav aria-label="Preference settings" className="divide-y rounded-xl border">
          {links.map(({ href, label, hint, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-3 px-3 py-2.5 text-sm transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{label}</span>
                <span className="block text-xs text-muted-foreground">{hint}</span>
              </span>
              <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            </Link>
          ))}
        </nav>
      </CardContent>
    </Card>
  );
}
