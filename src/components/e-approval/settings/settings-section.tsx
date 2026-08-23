'use client';

import type { ReactNode } from 'react';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { E_APPROVAL_BASE_PATH, E_APPROVAL_PERMISSION_RESOURCE } from '@/lib/e-approval';
import { PageHeader } from '../page-header';
import { useEApprovalPermissions } from '../hooks';

/**
 * The shell each settings sub-page sits in.
 *
 * It owns the two things every one of them would otherwise repeat: the permission gate for its own
 * node, and a header that links back to the hub. Written once so a new section cannot ship with the
 * gate forgotten — which, on the pages that decide who can approve what, is the mistake that matters.
 */
export function SettingsSection({
  title,
  description,
  node,
  children,
}: {
  title: string;
  description: string;
  /** The `Settings.<node>` permission this page is governed by. */
  node: string;
  children: (canEdit: boolean) => ReactNode;
}) {
  const permissions = useEApprovalPermissions();
  const path = `${E_APPROVAL_PERMISSION_RESOURCE}.Settings.${node}`;

  const canView =
    permissions.can('View', path) || permissions.can('Add', path) || permissions.can('Edit', path);
  const canEdit = permissions.can('Edit', path) || permissions.can('Add', path);

  if (!permissions.isLoading && !canView) {
    return (
      <div className="space-y-3">
        <PageHeader title={title} backHref={`${E_APPROVAL_BASE_PATH}/settings`} backLabel="Settings" />
        <Card>
          <CardHeader>
            <CardTitle>Not permitted</CardTitle>
            <CardDescription>
              You do not have access to {title.toLowerCase()}. Ask your administrator for the{' '}
              <span className="font-medium">{node}</span> permission.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <PageHeader
        title={title}
        description={description}
        backHref={`${E_APPROVAL_BASE_PATH}/settings`}
        backLabel="Settings"
        meta={canView && !canEdit ? [{ label: 'Access', value: 'View only' }] : undefined}
      />
      {children(canEdit)}
    </div>
  );
}
