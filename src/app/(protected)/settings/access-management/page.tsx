/**
 * `/settings/access-management` — the Enterprise Access Control Center.
 *
 * A thin route: everything lives in `@/components/access-management`, matching how the other large
 * modules in this app are laid out (`components/hr`, `components/recurring-payments`). Keeping the
 * route file to an import means the workspace can be reused — the user access profile route renders
 * pieces of it — without a page importing another page.
 */

import { AccessControlCenter } from '@/components/access-management/access-control-center';

export default function AccessManagementPage() {
  return <AccessControlCenter />;
}
