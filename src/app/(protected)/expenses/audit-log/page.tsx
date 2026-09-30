'use client';

import { useCallback, useEffect, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { History, ShieldAlert } from 'lucide-react';

import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/shared/page-header';
import { ModuleAuditLog, type AuditLogEntry } from '@/components/shared/module-audit-log';
import { useAuthorization } from '@/hooks/useAuthorization';
import { ACTIVITY_MODULES } from '@/lib/activity-modules';
import { db } from '@/lib/firebase';

const DESCRIPTION = 'Every action on expense requests and Expenses settings — who did it, when, and exactly what changed.';

export default function ExpensesAuditLogPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  // Settings › Audit Logs already sees every module's trail, so it sees this one too.
  const isGlobalAuditor = can('View', 'Settings.Audit Logs');
  const canView = can('View', 'Expenses.Audit Log') || isGlobalAuditor;
  const canExport = can('Export', 'Expenses.Audit Log') || isGlobalAuditor;

  // Expense logs name their department (`details.department`) rather than its id, and the
  // department register is the only page that opens a request — there is no per-request deep link.
  const [departmentIds, setDepartmentIds] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    if (!canView) return;
    getDocs(collection(db, 'departments'))
      .then((snap) => {
        const byName = new Map<string, string>();
        snap.docs.forEach((d) => {
          const name = (d.data().name as string | undefined)?.trim();
          if (name) byName.set(name.toLowerCase(), d.id);
        });
        setDepartmentIds(byName);
      })
      .catch((err) => console.warn('Expenses audit log: could not load departments for record links', err));
  }, [canView]);

  const recordHref = useCallback((log: AuditLogEntry) => {
    const details = log.details ?? {};
    const id =
      (typeof details.departmentId === 'string' && details.departmentId) ||
      (typeof details.department === 'string' && departmentIds.get(details.department.trim().toLowerCase()));
    return id ? `/expenses/${encodeURIComponent(id)}` : null;
  }, [departmentIds]);

  if (isAuthLoading) {
    return (
      <div className="w-full space-y-4">
        <Skeleton className="h-10 w-full max-w-80" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
        <Skeleton className="h-[400px] w-full rounded-xl" />
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="w-full">
        <PageHeader icon={History} title="Audit Log" description={DESCRIPTION} backHref="/expenses" />
        <Card className="border-destructive/30">
          <CardHeader className="pb-2 text-center">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
              <ShieldAlert className="h-7 w-7 text-destructive" />
            </div>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>
              You need the <strong>Audit Log → View</strong> permission under Expenses. Ask an administrator to grant
              it in Role Management.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="w-full space-y-4">
      <PageHeader icon={History} title="Audit Log" description={DESCRIPTION} backHref="/expenses" />
      <ModuleAuditLog module={ACTIVITY_MODULES.EXPENSES} recordHref={recordHref} canExport={canExport} />
    </div>
  );
}
