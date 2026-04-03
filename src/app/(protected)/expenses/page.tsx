


'use client';

import Link from 'next/link';
import {
  Home,
  Building2,
  Receipt,
  ShieldAlert,
  Layers,
  BarChart3,
  Plus,
  TrendingUp,
  Wallet,
  ArrowRight,
  Sparkles,
} from 'lucide-react';
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

function DepartmentCard({ item }: { item: DeptCardItem }) {
  const isDisabled = item.href === '#';

  const cardContent = (
    <div
      className={cn(
        'group relative flex flex-col h-full rounded-xl border transition-all duration-300 overflow-hidden',
        'bg-card/80 backdrop-blur-sm',
        isDisabled
          ? 'cursor-not-allowed opacity-50 border-border/50'
          : 'cursor-pointer border-border/60 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5 hover:-translate-y-0.5'
      )}
    >
      {/* Top glow accent on hover */}
      {!isDisabled && (
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-primary/0 to-transparent group-hover:via-primary/50 transition-all duration-500" />
      )}

      {/* Background subtle gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary/0 via-transparent to-primary/0 group-hover:from-primary/5 transition-all duration-500" />

      <CardHeader className="relative flex-row items-center gap-4 space-y-0 p-5">
        <div
          className={cn(
            'flex-shrink-0 flex items-center justify-center rounded-xl transition-all duration-300',
            'bg-primary/10 border border-primary/20 h-11 w-11',
            'group-hover:bg-primary/15 group-hover:border-primary/30 group-hover:scale-110'
          )}
        >
          <item.icon className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <CardTitle className="text-sm font-bold truncate">{item.text}</CardTitle>
          <CardDescription className="text-xs mt-0.5 line-clamp-2">{item.description}</CardDescription>
        </div>
        {!isDisabled && (
          <ArrowRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-primary group-hover:translate-x-0.5 transition-all duration-300 flex-shrink-0" />
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

function StatCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  color: string;
}) {
  return (
    <div className={cn('flex items-center gap-3 px-4 py-3 rounded-lg border bg-card/60 backdrop-blur-sm', color)}>
      <div className={cn('flex items-center justify-center rounded-md h-8 w-8 bg-current/10 flex-shrink-0')}>
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-lg font-bold leading-tight">{value}</p>
      </div>
    </div>
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

  const departmentItems = useMemo(() => {
    return departments
      .filter(dept => can('View', 'Expenses.Departments', dept.id) || can('View All', 'Expenses.Expense Requests'))
      .map(dept => ({
        icon: Building2,
        text: dept.name,
        href: `/expenses/${dept.id}`,
        description: `View and manage expense requests for the ${dept.name} department.`,
      }));
  }, [departments, can]);

  const quickActions = useMemo(() => {
    const actions = [];
    if (can('View All', 'Expenses.Expense Requests')) {
      actions.push({
        icon: Layers,
        label: 'Consolidated View',
        href: '/expenses/all',
        description: 'All expenses across departments',
      });
    }
    if (can('View', 'Expenses.Reports')) {
      actions.push({
        icon: BarChart3,
        label: 'Pivot Reports',
        href: '/expenses/reports',
        description: 'Analyze expense data',
      });
    }
    return actions;
  }, [can]);

  if (isAuthLoading || (isLoading && canViewModule)) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8 space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="flex gap-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 flex-1 rounded-lg" />)}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
      </div>
    );
  }

  if (!canViewModule) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8">
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
    <div className="w-full px-4 sm:px-6 lg:px-8 space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/">
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <Home className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">Expenses Management</h1>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-primary/10 text-primary border border-primary/20">
                <Sparkles className="h-2.5 w-2.5" />
                Live
              </span>
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">
              Manage expense requests across all departments
            </p>
          </div>
        </div>
      </div>

      {/* Stats ribbon */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-blue-500/20 bg-blue-500/5 text-blue-600 dark:text-blue-400">
          <div className="flex items-center justify-center rounded-md h-8 w-8 bg-blue-500/10 flex-shrink-0">
            <Building2 className="h-4 w-4" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Active Depts</p>
            <p className="text-lg font-bold leading-tight">{departmentItems.length}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-purple-500/20 bg-purple-500/5 text-purple-600 dark:text-purple-400">
          <div className="flex items-center justify-center rounded-md h-8 w-8 bg-purple-500/10 flex-shrink-0">
            <Receipt className="h-4 w-4" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Module</p>
            <p className="text-lg font-bold leading-tight">Expenses</p>
          </div>
        </div>
        <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400 col-span-2 sm:col-span-1">
          <div className="flex items-center justify-center rounded-md h-8 w-8 bg-emerald-500/10 flex-shrink-0">
            <TrendingUp className="h-4 w-4" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Quick Actions</p>
            <p className="text-lg font-bold leading-tight">{quickActions.length} available</p>
          </div>
        </div>
      </div>

      {/* Quick Actions strip */}
      {quickActions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {quickActions.map(action => (
            <Link key={action.href} href={action.href}>
              <Button
                variant="outline"
                size="sm"
                className="gap-2 border-border/60 hover:border-primary/40 hover:bg-primary/5 hover:text-primary transition-all duration-200"
              >
                <action.icon className="h-3.5 w-3.5" />
                {action.label}
              </Button>
            </Link>
          ))}
        </div>
      )}

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
            {departmentItems.map(item => (
              <DepartmentCard key={item.text} item={item} />
            ))}
            {/* New Expense Request shortcut card */}
            {departmentItems.length > 0 && can('Create', 'Expenses.Departments', departmentItems[0]?.href.split('/').pop() || '') && (
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
