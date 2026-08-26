/**
 * `/settings/access-management/users/new` — the Add User form, as a page.
 *
 * Sibling of `users/[userId]`, which is the access profile for an existing user. A thin route, like
 * the other module entry points; everything lives in `@/components/access-management`.
 */

import { Suspense } from 'react';
import { HrLoader } from '@/components/hr/hr-ui';
import { AddUserPage } from '@/components/access-management/add-user-page';

export default function NewUserRoute() {
  // `useSearchParams` reads `returnTo`, which requires a Suspense boundary in the App Router.
  return (
    <Suspense fallback={<HrLoader label="Loading…" />}>
      <AddUserPage />
    </Suspense>
  );
}
