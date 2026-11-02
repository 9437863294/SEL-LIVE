'use client';

/**
 * Where Settings › Serial Nos. used to be. Each series is now set inside the module that hands its
 * numbers out (`settingsHref` in `src/lib/document-numbers.ts`), so this address — still in
 * bookmarks, and where the launcher sends the `Serial No. Config` permission — only points onward.
 * It has no menu entry.
 */

import Link from 'next/link';
import { ArrowRight, Hash } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { SettingsPage, SettingsSection } from '@/components/settings/settings-ui';
import { useBackNavigation } from '@/hooks/use-back-navigation';
import { DOCUMENT_SERIES } from '@/lib/document-numbers';

export default function SerialNoConfigurationMovedPage() {
  const back = useBackNavigation('/settings');
  return (
    <SettingsPage>
      <PageHeader
        title="Serial Numbers"
        description="Each document series is now set in its own module's Settings."
        icon={Hash}
        backHref={back.href}
        backLabel={back.label}
        onBackClick={back.onClick}
      />
      <SettingsSection title="Open a series" icon={Hash} flush>
        <ul className="divide-y">
          {DOCUMENT_SERIES.map((series) => (
            <li key={series.id}>
              <Link
                href={series.settingsHref}
                className="flex min-w-0 items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{series.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{series.moduleName} › Settings › Serial Numbers</span>
                </span>
                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      </SettingsSection>
    </SettingsPage>
  );
}
