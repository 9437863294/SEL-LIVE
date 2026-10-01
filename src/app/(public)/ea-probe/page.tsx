'use client';

// TEMPORARY verification fixture for the picker's column order. Deleted after the screenshots.

import { useState } from 'react';
import { AssigneePicker } from '@/components/e-approval/assignee-picker';
import type { EApprovalAssignment, EApprovalDirectory } from '@/lib/e-approval';

const directory = {
  users: [
    { id: 'u1', name: 'SHAIKH ABDUR RAHEMAN', email: 'raheman@sel.in', designation: 'Manager(Co-ordinator)', department: 'PROJECT', employeeNo: 'E1597', location: 'BOUDH-PHULBANI' },
    { id: 'u2', name: 'Sidhartha Palo', email: 'palo@sel.in', designation: 'Executive Director', department: 'ADMIN', employeeNo: 'E0001', location: 'BHUBANESWAR' },
    { id: 'u3', name: 'Banamali Dash', email: 'dash@sel.in', designation: 'Senior Manager (F)', department: 'PROJECT', employeeNo: 'E0423', location: 'BOUDH-PHULBANI' },
    { id: 'u4', name: 'Contractor Login', email: 'svc@sel.in' },
  ],
  userById: new Map(),
  departments: [{ id: 'd1', name: 'PROJECT' }],
  projects: [{ id: 'p1', name: 'BOUDH-PHULBANI' }],
  roles: ['Executive Director'],
  projectRouting: [],
} as unknown as EApprovalDirectory;

export default function Probe() {
  const [value, setValue] = useState<EApprovalAssignment[]>([]);
  return (
    <div id="probe" className="mx-auto max-w-3xl bg-white p-3">
      <AssigneePicker directory={directory} value={value} onChange={setValue} multiple label="" />
    </div>
  );
}
