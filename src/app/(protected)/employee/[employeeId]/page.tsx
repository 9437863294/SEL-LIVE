'use client';

/**
 * `/employee/[employeeId]` — everything this system holds about one employee.
 *
 * Keyed by greytHR's numeric employee id, which is the `employees` document id — so a row in
 * Employee Management links straight here.
 */

import { useParams } from 'next/navigation';
import { EmployeeProfile } from '@/components/employee/employee-profile';

export default function EmployeeProfilePage() {
  const params = useParams<{ employeeId: string }>();
  return <EmployeeProfile employeeId={String(params?.employeeId ?? '')} />;
}
