/**
 * `/settings/access-management/roles/new` — the Role Builder, as a page.
 *
 * Also serves the duplicate flow via `?duplicateFrom=<roleId>`, since duplicating creates a role.
 * A thin route, like the other module entry points; everything lives in
 * `@/components/access-management`.
 */

import { Suspense } from 'react';
import { HrLoader } from '@/components/hr/hr-ui';
import { RolePage } from '@/components/access-management/role-page';

export default function NewRoleRoute() {
  // `useSearchParams` reads `returnTo` and `duplicateFrom`, which requires a Suspense boundary in the
  // App Router.
  return (
    <Suspense fallback={<HrLoader label="Loading…" />}>
      <RolePage />
    </Suspense>
  );
}
