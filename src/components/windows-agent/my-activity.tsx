'use client';

import { HrLoader } from '@/components/hr/hr-ui';
import { EmployeeActivity } from './activity';
import { useWindowsAgent } from './hooks';

/**
 * §37's self-view.
 *
 * The same screen as `/windows-agent/users/[userId]`, pointed at the signed-in person and told
 * so. Reusing it rather than writing a friendlier cut-down version is deliberate: an employee
 * should see exactly what their manager sees about them, down to the timeline. A softened
 * self-view would be the kind of transparency that is really a public-relations exercise, and
 * the first person to compare the two screens would notice.
 */
export function MyActivityPage() {
  const { viewer, loading } = useWindowsAgent();
  if (loading) return <HrLoader label="Loading your activity" />;
  return <EmployeeActivity userId={viewer.userId} selfView />;
}
