'use client';

/**
 * `/settings/access-management/roles/[roleId]` — edit an existing role.
 *
 * Sibling of `roles/new`; `RolePage` handles both, since editing and creating are the same form with
 * different initial values. A static `new` segment takes precedence over this dynamic one in Next.js's
 * own route resolution, so the two routes cannot collide.
 */

import { Suspense } from 'react';
import { useParams } from 'next/navigation';
import { HrLoader } from '@/components/hr/hr-ui';
import { RolePage } from '@/components/access-management/role-page';

export default function EditRoleRoute() {
  const params = useParams<{ roleId: string }>();
  const roleId = String(params?.roleId ?? '');

  // `useSearchParams` (inside RolePage, reading `returnTo`) requires a Suspense boundary.
  return (
    <Suspense fallback={<HrLoader label="Loading…" />}>
      <RolePage roleId={roleId} />
    </Suspense>
  );
}
