'use client';

/**
 * Settings › Email Auth — reserved for authorising company email services. The request workflow is
 * not built yet, so the page says so plainly instead of showing buttons that do nothing; connecting
 * a mailbox to read and send mail is Mail Hub's (Mail › Settings › Email accounts).
 */

import Link from 'next/link';
import { ArrowRight, MailCheck, PlugZap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/shared/page-header';
import { SettingsAccessDenied, SettingsPage, SettingsSection } from '@/components/settings/settings-ui';
import { useBackNavigation } from '@/hooks/use-back-navigation';
import { useAuthorization } from '@/hooks/useAuthorization';

export default function EmailAuthorizationPage() {
  const back = useBackNavigation('/settings');
  const { can } = useAuthorization();

  if (!can('View', 'Settings.Email Authorization')) return <SettingsAccessDenied title="Email Authorization" icon={MailCheck} />;

  return (
    <SettingsPage>
      <PageHeader
        title="Email Authorization"
        description="Authorising the company's email services for SEL Live."
        icon={MailCheck}
        backHref={back.href}
        backLabel={back.label}
        onBackClick={back.onClick}
      />

      <SettingsSection title="Not set up yet" icon={PlugZap}>
        <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1 space-y-1.5 text-sm text-muted-foreground">
            <p>
              Requests to authorise a company email service are not connected in this version of SEL Live, so there is
              nothing to send or revoke here yet.
            </p>
            <p>To read and send your own mail inside SEL Live, connect your mailbox in Mail Hub instead.</p>
          </div>
          <Button asChild variant="outline" className="shrink-0">
            <Link href="/mail/settings/accounts">
              Email accounts
              <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </SettingsSection>
    </SettingsPage>
  );
}
