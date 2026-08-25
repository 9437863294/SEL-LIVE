/**
 * `/settings/user-management/greythr-linking` — reconcile platform logins against greytHR employees.
 *
 * Nested under User Management rather than given its own top-level `users` segment, because it is the
 * same subject as the page above it and the permission it checks is the same one. A thin route, like
 * the other module entry points.
 */

import { GreytHRLinkingWorkspace } from '@/components/access-management/greythr-linking';

export default function GreytHRLinkingPage() {
  return <GreytHRLinkingWorkspace />;
}
