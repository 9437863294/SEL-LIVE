'use client';

/**
 * `/settings/access-management/templates/[templateId]` — edit an existing template.
 *
 * Sibling of `templates/new`; `AccessTemplatePage` handles both, since editing and creating are the
 * same form with different initial values. A static `new` segment takes precedence over this dynamic
 * one in Next.js's own route resolution, so the two routes cannot collide.
 */

import { Suspense } from 'react';
import { useParams } from 'next/navigation';
import { HrLoader } from '@/components/hr/hr-ui';
import { AccessTemplatePage } from '@/components/access-management/access-template-page';

export default function EditAccessTemplateRoute() {
  const params = useParams<{ templateId: string }>();
  const templateId = String(params?.templateId ?? '');

  // `useSearchParams` (inside AccessTemplatePage, reading `returnTo`) requires a Suspense boundary.
  return (
    <Suspense fallback={<HrLoader label="Loading…" />}>
      <AccessTemplatePage templateId={templateId} />
    </Suspense>
  );
}
