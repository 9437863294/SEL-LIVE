/**
 * `/settings/access-management/greythr-linking` — reconcile platform logins against greytHR employees.
 *
 * It lived under `/settings/user-management` until that screen was merged into this module; the
 * component was already here, so the move put the route where its code always was. A thin route,
 * like the other module entry points.
 */

import { GreytHRLinkingWorkspace } from '@/components/access-management/greythr-linking';

export default function GreytHRLinkingPage() {
  return <GreytHRLinkingWorkspace />;
}
