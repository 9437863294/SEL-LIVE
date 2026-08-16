
'use client';

import { GitMerge, Settings2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useMemo } from 'react';
import { useProjectManagementJmcContext } from '@/components/jmc/use-jmc-host-context';
import { JmcNav } from '@/components/jmc/jmc-nav';
import {
  JMC_SETTINGS_GRADIENT,
  JmcAccessDenied,
  JmcCardGridLoadingState,
  JmcNavCard,
  JmcNavCardGrid,
  JmcPageHeader,
  JmcPageShell,
  JmcProjectNotFound,
} from '@/components/jmc/jmc-page-shell';

type SettingsBaseItem = {
  icon: LucideIcon;
  text: string;
  description: string;
  href: string; // relative to the JMC base path, resolved through context.jmcHref()
  permission: string; // permission action, resource is context.permissionResource
};

type SettingsItem = {
  icon: LucideIcon;
  text: string;
  description: string;
  href: string; // fully-resolved app path
  disabled?: boolean;
};

const settingsItemsBase: SettingsBaseItem[] = [
  {
    icon: GitMerge,
    text: 'Workflow Configuration',
    description: 'Set up approval workflows for JMC entries.',
    href: 'settings/workflow-configuration',
    permission: 'View Settings',
  },
];

export default function JmcSettingsPage() {
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get('project') ?? '';
  const { context, isResolving, notFound, projectName } = useProjectManagementJmcContext(mappingId);
  const { can, isLoading: authLoading } = useAuthorization();

  // Only evaluate permissions when auth is ready
  const canViewPage = useMemo(() => {
    if (authLoading) return false;
    try {
      return can('View Settings', context.permissionResource);
    } catch {
      return false;
    }
  }, [authLoading, can, context]);

  const settingsItems: SettingsItem[] = useMemo(() => {
    if (!context.mappingId) return [];

    // Resolve each card’s href and disabled state with its own permission
    return settingsItemsBase.map((it) => {
      const resolvedHref = it.href === '#' ? '#' : context.jmcHref(it.href);
      const disabled =
        authLoading
          ? true
          : ((): boolean => {
              try {
                return !can(it.permission, context.permissionResource);
              } catch {
                return true;
              }
            })();

      return {
        icon: it.icon,
        text: it.text,
        description: it.description,
        href: resolvedHref,
        disabled,
      };
    });
  }, [context, authLoading, can]);

  if (authLoading || isResolving) {
    return <JmcCardGridLoadingState tiles={3} />;
  }

  if (!canViewPage) {
    return <JmcAccessDenied description="You do not have permission to access these settings." />;
  }

  if (notFound) {
    return (
      <JmcProjectNotFound description="This project could not be resolved. Choose a project from Project Management to open its JMC settings." />
    );
  }

  return (
    <JmcPageShell>
      <JmcPageHeader
        title="JMC Settings"
        subtitle={
          projectName
            ? `Configure how Joint Measurement Certificates behave for ${projectName}.`
            : 'Configure how Joint Measurement Certificates behave on this project.'
        }
        icon={Settings2}
        backHref={context.parentHref}
        gradient={JMC_SETTINGS_GRADIENT}
      />

      <JmcNav context={context} active="settings" />

      <JmcNavCardGrid>
        {settingsItems.map((item) => (
          <JmcNavCard
            key={`${item.text}-${item.href}`}
            title={item.text}
            description={item.description}
            href={item.href}
            icon={item.icon}
            gradient={JMC_SETTINGS_GRADIENT}
            disabled={item.href === '#' || item.disabled}
          />
        ))}
      </JmcNavCardGrid>
    </JmcPageShell>
  );
}
