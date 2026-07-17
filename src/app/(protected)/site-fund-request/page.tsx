'use client';

import { useState, useEffect, useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { FileText, BarChart3, Settings, GitMerge, Clock, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';
import Link from 'next/link';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import { useSFRProjectAccess } from '@/hooks/useSFRProjectAccess';
import { db } from '@/lib/firebase';
import { doc, getDoc, collection, getDocs, query, where } from 'firebase/firestore';
import type { WorkflowStep, Requisition } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';
import { useAuth } from '@/components/auth/AuthProvider';

const MODULE = 'Site Fund Request';
const WORKFLOW_DOC = 'site-fund-request';
const COLLECTION = 'siteFundRequests';

interface StatCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  color: string;
  bg: string;
}

function StatCard({ label, value, icon: Icon, color, bg }: StatCardProps) {
  return (
    <Card className="overflow-hidden rounded-2xl border border-white/70 bg-white/65 shadow-[0_18px_60px_-45px_rgba(2,6,23,0.35)] backdrop-blur">
      <div className="h-1 w-full bg-gradient-to-r from-indigo-400 via-violet-400 to-blue-400 opacity-70" />
      <CardContent className="flex items-center gap-4 p-5">
        <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', bg)}>
          <Icon className={cn('h-5 w-5', color)} />
        </div>
        <div>
          <p className="text-2xl font-bold text-slate-900">{value}</p>
          <p className="text-xs text-slate-500">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

interface NavCardProps {
  icon: LucideIcon;
  text: string;
  href: string;
  description: string;
  disabled?: boolean;
  badge?: number;
}

function NavCard({ icon: Icon, text, href, description, disabled, badge }: NavCardProps) {
  const card = (
    <Card className={cn(
      'group flex flex-col h-full overflow-hidden rounded-2xl border border-white/70 bg-white/65 shadow-[0_18px_60px_-45px_rgba(2,6,23,0.35)] backdrop-blur transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_28px_80px_-55px_rgba(2,6,23,0.55)]',
      disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
    )}>
      <div className="h-1.5 w-full bg-gradient-to-r from-indigo-400 via-violet-400 to-blue-400 opacity-70" />
      <CardHeader className="flex-row items-center gap-4 space-y-0 p-5">
        <div className="relative rounded-2xl border border-white/70 bg-white/70 p-3 shadow-sm transition-colors group-hover:bg-white">
          <Icon className="h-6 w-6 text-slate-900/80" />
          {badge !== undefined && badge > 0 && (
            <span className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-indigo-500 text-[10px] font-bold text-white">
              {badge > 99 ? '99+' : badge}
            </span>
          )}
        </div>
        <div className="flex-1">
          <CardTitle className="text-base font-semibold text-slate-900">{text}</CardTitle>
          <CardDescription className="mt-1 text-xs text-slate-600">{description}</CardDescription>
        </div>
      </CardHeader>
    </Card>
  );

  if (disabled) return <div className="h-full">{card}</div>;
  return <Link href={href} className="no-underline h-full">{card}</Link>;
}

export default function SiteFundRequestDashboard() {
  const { toast } = useToast();
  const { can, isLoading: authIsLoading } = useAuthorization();
  const { user } = useAuth();
  const projectAccess = useSFRProjectAccess();
  const [workflowSteps, setWorkflowSteps] = useState<WorkflowStep[]>([]);
  const [stats, setStats] = useState({ total: 0, pending: 0, inProgress: 0, completed: 0, rejected: 0 });
  const [myPendingCount, setMyPendingCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  const canViewRequests = can('View', `${MODULE}.Requests`) || can('View Module', MODULE) || projectAccess.canWrite || projectAccess.isViewer;

  useEffect(() => {
    if (authIsLoading || projectAccess.isLoading) return;

    const fetchData = async () => {
      setIsLoading(true);
      try {
        const [workflowSnap, reqSnap] = await Promise.all([
          getDoc(doc(db, 'workflows', WORKFLOW_DOC)),
          getDocs(collection(db, COLLECTION)),
        ]);

        if (workflowSnap.exists()) {
          const steps = ((workflowSnap.data()?.steps ?? []) as WorkflowStep[]).filter(s => s?.id && s?.name);
          setWorkflowSteps(steps);
        }

        let reqs = reqSnap.docs.map(d => ({ id: d.id, ...d.data() } as Requisition));
        if (!projectAccess.canViewAll && projectAccess.accessibleProjectIds !== null) {
          reqs = reqs.filter(r => projectAccess.accessibleProjectIds!.has(r.projectId));
        }
        const userId = (user as any)?.id ?? (user as any)?.uid ?? '';
        setStats({
          total: reqs.length,
          pending: reqs.filter(r => r.status === 'Pending').length,
          inProgress: reqs.filter(r => r.status === 'In Progress').length,
          completed: reqs.filter(r => r.status === 'Completed').length,
          rejected: reqs.filter(r => r.status === 'Rejected').length,
        });
        setMyPendingCount(reqs.filter(r =>
          (r.assignees ?? []).includes(userId) &&
          r.status !== 'Completed' && r.status !== 'Rejected'
        ).length);
      } catch (err: any) {
        toast({ title: 'Error', description: 'Could not load dashboard data.', variant: 'destructive' });
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [authIsLoading, projectAccess.isLoading, projectAccess.canViewAll, projectAccess.accessibleProjectIds, toast, user]);

  const navCards = useMemo(() => {
    const stageCards = workflowSteps.map(step => ({
      icon: GitMerge,
      text: step.name,
      href: `/site-fund-request/stage/${step.id}`,
      description: `Manage tasks at the ${step.name} stage.`,
      disabled: !canViewRequests,
    }));

    return [
      { icon: FileText, text: 'All Requests', href: '/site-fund-request/requests', description: 'View and manage all fund requests.', disabled: !canViewRequests },
      ...stageCards,
      { icon: BarChart3, text: 'Reports', href: '/site-fund-request/reports', description: 'View summary reports.', disabled: !can('View', `${MODULE}.Reports`) },
      { icon: Settings, text: 'Settings', href: '/site-fund-request/settings', description: 'Configure workflow and settings.', disabled: !can('View', `${MODULE}.Settings`) },
    ];
  }, [workflowSteps, canViewRequests, can]);

  if (isLoading || authIsLoading || projectAccess.isLoading) {
    return (
      <div className="p-4 sm:p-6">
        <Skeleton className="h-8 w-64 mb-6" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 mb-6">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full space-y-6 p-4 sm:p-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Site Fund Request</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-900">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-600">Overview of fund requests and workflow stages.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Total Requests" value={stats.total}     icon={FileText}      color="text-indigo-600" bg="bg-indigo-50" />
        <StatCard label="Pending"        value={stats.pending}   icon={Clock}         color="text-amber-600"  bg="bg-amber-50"  />
        <StatCard label="In Progress"    value={stats.inProgress} icon={AlertCircle}  color="text-sky-600"    bg="bg-sky-50"    />
        <StatCard label="Completed"      value={stats.completed} icon={CheckCircle2}  color="text-emerald-600" bg="bg-emerald-50" />
      </div>

      {/* Navigation cards */}
      <div>
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Quick Access</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
          {navCards.map(card => (
            <NavCard key={card.href} {...card} />
          ))}
        </div>
      </div>
    </div>
  );
}
