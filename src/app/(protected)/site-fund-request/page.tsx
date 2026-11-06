'use client';

import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { PageHeader } from '@/components/shared/page-header';
import { ModuleTile, ModuleTileGrid, ModuleTileSkeletons, moduleTileGradient, type ModuleTileItem } from '@/components/shared/module-tile';
import { FileText, BarChart3, Settings, GitMerge, Clock, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';
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

  const navCards = useMemo((): ModuleTileItem[] => {
    // Each stage takes the next colour round, so neighbouring stages stay tellable apart.
    const stageCards = workflowSteps.map((step, index): ModuleTileItem => ({
      icon: GitMerge,
      title: step.name,
      href: `/site-fund-request/stage/${step.id}`,
      description: `Manage tasks at the ${step.name} stage.`,
      gradient: moduleTileGradient(index + 1),
      disabled: !canViewRequests,
    }));

    return [
      { icon: FileText, title: 'All Requests', href: '/site-fund-request/requests', description: 'View and manage all fund requests.', gradient: 'from-indigo-500 to-blue-600', disabled: !canViewRequests },
      ...stageCards,
      { icon: BarChart3, title: 'Reports', href: '/site-fund-request/reports', description: 'View summary reports.', gradient: 'from-teal-500 to-cyan-600', disabled: !can('View', `${MODULE}.Reports`) },
      { icon: Settings, title: 'Settings', href: '/site-fund-request/settings', description: 'Configure workflow and settings.', gradient: 'from-slate-500 to-slate-700', disabled: !can('View', `${MODULE}.Settings`) },
    ];
  }, [workflowSteps, canViewRequests, can]);

  if (isLoading || authIsLoading || projectAccess.isLoading) {
    return (
      <div className="p-4 sm:p-6">
        <Skeleton className="h-8 w-64 mb-6" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 mb-6">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <ModuleTileSkeletons count={4} />
      </div>
    );
  }

  return (
    <div className="w-full space-y-6 p-4 sm:p-6">
      <PageHeader
        eyebrow="Site Fund Request"
        title="Dashboard"
        description="Overview of fund requests and workflow stages."
      />

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
        <ModuleTileGrid>
          {navCards.map(card => (
            <ModuleTile key={card.href} item={card} />
          ))}
        </ModuleTileGrid>
      </div>
    </div>
  );
}
