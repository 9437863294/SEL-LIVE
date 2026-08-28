/**
 * `/settings/access-management/templates/new` — the template editor, as a page.
 *
 * A thin route, like the other module entry points; everything lives in
 * `@/components/access-management`.
 */

import { Suspense } from 'react';
import { HrLoader } from '@/components/hr/hr-ui';
import { AccessTemplatePage } from '@/components/access-management/access-template-page';

export default function NewAccessTemplateRoute() {
  // `useSearchParams` reads `returnTo`, which requires a Suspense boundary in the App Router.
  return (
    <Suspense fallback={<HrLoader label="Loading…" />}>
      <AccessTemplatePage />
    </Suspense>
  );
}
