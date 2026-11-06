


'use client';

import {
  Building2,
  IndianRupee,
  ShieldAlert,
  Plus,
  Wallet,
  Sparkles,
} from 'lucide-react';
import { ExpenseBadge } from '@/components/expenses/page-header';
import { PageHeader, SectionHeader } from '@/components/shared/page-header';
import { ModuleTile, ModuleTileGrid, ModuleTileSkeletons, moduleTileGradient, type ModuleTileItem } from '@/components/shared/module-tile';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useEffect, useState, useMemo } from 'react';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, where } from 'firebase/firestore';
import type { Department } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useExpensesActor } from '@/components/expenses/use-expenses-actor';

export default function ExpensesPage() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { may, canViewDepartment, isLoading: isActorLoading } = useExpensesActor();
  const canViewModule = can('View Module', 'Expenses');

  useEffect(() => {
    if (isAuthLoading) return;
    if (!canViewModule) {
      setIsLoading(false);
      return;
    }

    const fetchDepartments = async () => {
      setIsLoading(true);
      try {
        const q = query(collection(db, 'departments'), where('status', '==', 'Active'));
        const querySnapshot = await getDocs(q);
        const depts = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Department));
        setDepartments(depts);
      } catch (error) {
        console.error('Error fetching active departments:', error);
      }
      setIsLoading(false);
    };
    fetchDepartments();
  }, [isAuthLoading, canViewModule]);

  /** Only the user's own departments when Settings › User Roles names them by department. */
  const visibleDepartments = useMemo(
    () => departments.filter(dept => canViewDepartment(dept.id)),
    [departments, canViewDepartment],
  );

  /**
   * Departments take the tile colours in turn rather than all sharing one — a wall of identical
   * tiles is hard to scan — and a department keeps its colour across reloads, because the colour is
   * picked by its position in the (stably ordered) list.
   */
  const departmentItems = useMemo(
    () =>
      visibleDepartments.map((dept, index): ModuleTileItem => ({
        icon: Building2,
        title: dept.name,
        href: `/expenses/${dept.id}`,
        description: `View and manage expense requests for the ${dept.name} department.`,
        gradient: moduleTileGradient(index),
      })),
    [visibleDepartments],
  );

  /**
   * Shown when the user can raise a request in *any* of their departments. This used to ask only
   * about the first card in the grid, so someone who could create in their second department never
   * saw the shortcut — and someone who could create only in the first saw it regardless.
   */
  const canCreateAnywhere = useMemo(
    () => visibleDepartments.some(dept => may('raise-request', { departmentId: dept.id }).allowed),
    [visibleDepartments, may],
  );

  // Waits for User Roles as well, so a department-limited user never glimpses every department first.
  if (isAuthLoading || isActorLoading || (isLoading && canViewModule)) {
    return (
      <div className="w-full space-y-6">
        <Skeleton className="h-10 w-64" />
        <ModuleTileSkeletons count={4} />
      </div>
    );
  }

  if (!canViewModule) {
    return (
      <div className="w-full">
        <PageHeader icon={IndianRupee} title="Expenses Management" backHref="/" />
        <Card className="border-destructive/30">
          <CardHeader className="text-center pb-2">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
              <ShieldAlert className="h-7 w-7 text-destructive" />
            </div>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>You do not have permission to access this module.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="w-full space-y-6">
      <PageHeader
        icon={IndianRupee}
        title="Expenses Management"
        description="Manage expense requests across all departments"
        backHref="/"
        badge={<ExpenseBadge accent="blue"><Sparkles className="h-2.5 w-2.5" /> Live</ExpenseBadge>}
      />

      {/* Departments section */}
      <div>
        <SectionHeader title="Your Departments" icon={Building2} />

        {departmentItems.length > 0 ? (
          <ModuleTileGrid>
            {departmentItems.map((item) => (
              <ModuleTile key={item.href} item={item} />
            ))}
            {/* New Expense Request shortcut: dashed, as the one tile that creates rather than opens. */}
            {canCreateAnywhere && (
              <ModuleTile
                item={{
                  icon: Plus,
                  title: 'New Request',
                  description: 'Create an expense request.',
                  href: '/expenses/new-request',
                  gradient: 'from-indigo-500 to-blue-600',
                  variant: 'action',
                }}
              />
            )}
          </ModuleTileGrid>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 rounded-xl border border-dashed border-border/50 bg-muted/20">
            <div className="flex items-center justify-center rounded-full bg-muted h-16 w-16 mb-4">
              <Wallet className="h-8 w-8 text-muted-foreground" />
            </div>
            <p className="font-semibold text-foreground mb-1">No Departments Available</p>
            <p className="text-sm text-muted-foreground text-center max-w-xs">
              You don't have permission to view any active departments. Contact an administrator if you believe this is an error.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
