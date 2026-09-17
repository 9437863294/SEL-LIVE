


'use client';

import Link from 'next/link';
import {
  Home,
  Building2,
  IndianRupee,
  ShieldAlert,
  Plus,
  Wallet,
  ArrowRight,
  Sparkles,
} from 'lucide-react';
import { ExpenseBadge, ExpensesPageHeader } from '@/components/expenses/page-header';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useEffect, useState, useMemo } from 'react';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, where } from 'firebase/firestore';
import type { Department } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthorization } from '@/hooks/useAuthorization';

interface DeptCardItem {
  icon: LucideIcon;
  text: string;
  href: string;
  description: string;
}

/**
 * Departments cycle through these rather than all sharing one primary tint — a wall of identical
 * cards is hard to scan, and a department keeps the same colour across reloads because the tone is
 * picked by its position in the (stably ordered) list.
 */
const DEPARTMENT_TONES = [
  { tile: 'from-blue-500 to-indigo-600', soft: 'bg-blue-50', ring: 'group-hover:border-blue-300', bar: 'from-blue-500 to-indigo-500', text: 'group-hover:text-blue-600' },
  { tile: 'from-violet-500 to-purple-600', soft: 'bg-violet-50', ring: 'group-hover:border-violet-300', bar: 'from-violet-500 to-purple-500', text: 'group-hover:text-violet-600' },
  { tile: 'from-emerald-500 to-teal-600', soft: 'bg-emerald-50', ring: 'group-hover:border-emerald-300', bar: 'from-emerald-500 to-teal-500', text: 'group-hover:text-emerald-600' },
  { tile: 'from-amber-500 to-orange-600', soft: 'bg-amber-50', ring: 'group-hover:border-amber-300', bar: 'from-amber-500 to-orange-500', text: 'group-hover:text-amber-600' },
  { tile: 'from-fuchsia-500 to-pink-600', soft: 'bg-fuchsia-50', ring: 'group-hover:border-fuchsia-300', bar: 'from-fuchsia-500 to-pink-500', text: 'group-hover:text-fuchsia-600' },
  { tile: 'from-cyan-500 to-sky-600', soft: 'bg-cyan-50', ring: 'group-hover:border-cyan-300', bar: 'from-cyan-500 to-sky-500', text: 'group-hover:text-cyan-600' },
] as const;

function DepartmentCard({ item, tone }: { item: DeptCardItem; tone: (typeof DEPARTMENT_TONES)[number] }) {
  const isDisabled = item.href === '#';

  const cardContent = (
    <div
      className={cn(
        'group relative flex h-full flex-col overflow-hidden rounded-xl border bg-white/75 backdrop-blur-sm transition-all duration-300',
        isDisabled
          ? 'cursor-not-allowed border-border/50 opacity-50'
          : cn('cursor-pointer border-white/70 shadow-sm hover:-translate-y-0.5 hover:shadow-lg', tone.ring),
      )}
    >
      {!isDisabled && (
        <div className={cn('absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r opacity-70 transition-opacity duration-300 group-hover:opacity-100', tone.bar)} />
      )}

      <CardHeader className="relative flex-row items-center gap-3.5 space-y-0 p-5">
        <div
          className={cn(
            'flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br shadow-sm transition-transform duration-300 group-hover:scale-110',
            tone.tile,
          )}
        >
          <item.icon className="h-5 w-5 text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <CardTitle className={cn('truncate text-sm font-bold transition-colors', tone.text)}>{item.text}</CardTitle>
          <CardDescription className="mt-0.5 line-clamp-2 text-xs">{item.description}</CardDescription>
        </div>
        {!isDisabled && (
          <ArrowRight className="h-4 w-4 flex-shrink-0 text-muted-foreground/40 transition-all duration-300 group-hover:translate-x-0.5 group-hover:text-foreground/60" />
        )}
      </CardHeader>
    </div>
  );

  if (isDisabled) return <div className="h-full">{cardContent}</div>;
  return (
    <Link href={item.href} className="no-underline h-full block">
      {cardContent}
    </Link>
  );
}

export default function ExpensesPage() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { can, isLoading: isAuthLoading } = useAuthorization();
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

  const visibleDepartments = useMemo(
    () =>
      departments.filter(
        dept => can('View', 'Expenses.Departments', dept.id) || can('View All', 'Expenses.Expense Requests'),
      ),
    [departments, can],
  );

  const departmentItems = useMemo(
    () =>
      visibleDepartments.map(dept => ({
        icon: Building2,
        text: dept.name,
        href: `/expenses/${dept.id}`,
        description: `View and manage expense requests for the ${dept.name} department.`,
      })),
    [visibleDepartments],
  );

  /**
   * Shown when the user can raise a request in *any* of their departments. This used to ask only
   * about the first card in the grid, so someone who could create in their second department never
   * saw the shortcut — and someone who could create only in the first saw it regardless.
   */
  const canCreateAnywhere = useMemo(
    () => visibleDepartments.some(dept => can('Create', 'Expenses.Departments', dept.id)),
    [visibleDepartments, can],
  );

  if (isAuthLoading || (isLoading && canViewModule)) {
    return (
      <div className="w-full space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
      </div>
    );
  }

  if (!canViewModule) {
    return (
      <div className="w-full">
        <div className="mb-6 flex items-center gap-2">
          <Link href="/"><Button variant="ghost" size="icon"><Home className="h-5 w-5" /></Button></Link>
          <h1 className="text-xl font-bold">Expenses Management</h1>
        </div>
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
      <ExpensesPageHeader
        icon={IndianRupee}
        title="Expenses Management"
        description="Manage expense requests across all departments"
        accent="blue"
        backHref="/"
        badge={<ExpenseBadge accent="blue"><Sparkles className="h-2.5 w-2.5" /> Live</ExpenseBadge>}
      />

      {/* Departments section */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Building2 className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Your Departments
          </h2>
          <div className="flex-1 h-px bg-border/50" />
        </div>

        {departmentItems.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {departmentItems.map((item, index) => (
              <DepartmentCard key={item.text} item={item} tone={DEPARTMENT_TONES[index % DEPARTMENT_TONES.length]} />
            ))}
            {/* New Expense Request shortcut card */}
            {canCreateAnywhere && (
              <Link href="/expenses/new-request" className="h-full block">
                <div className="group relative flex flex-col h-full rounded-xl border border-dashed border-primary/30 transition-all duration-300 overflow-hidden bg-primary/5 hover:bg-primary/10 hover:border-primary/50 cursor-pointer hover:-translate-y-0.5 hover:shadow-lg hover:shadow-primary/10">
                  <div className="flex flex-col items-center justify-center flex-1 p-5 text-center gap-2">
                    <div className="flex items-center justify-center rounded-xl bg-primary/10 border border-primary/20 h-11 w-11 group-hover:scale-110 transition-transform duration-300">
                      <Plus className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-primary">New Request</p>
                      <p className="text-xs text-muted-foreground">Create expense request</p>
                    </div>
                  </div>
                </div>
              </Link>
            )}
          </div>
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
