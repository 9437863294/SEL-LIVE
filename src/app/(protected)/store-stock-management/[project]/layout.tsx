
'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import {
  ArrowRightLeft, BarChart3, BrainCircuit,
  ClipboardList, Component, GitCommit, LayoutDashboard, Package, Settings, Warehouse,
} from 'lucide-react';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useCompanyProfile } from '@/hooks/use-company-profile';
import { ModuleShell, type ModuleNavGroup } from '@/components/shared/module-shell';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Project } from '@/lib/types';
import { projectMatchesSlug } from '@/lib/project-slug';

export default function ProjectLayout({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const projectSlug = params?.project as string;
  const { can } = useAuthorization();
  const { profile } = useCompanyProfile();
  const [currentProject, setCurrentProject] = React.useState<Project | null>(null);

  React.useEffect(() => {
    const fetchProject = async () => {
      if (!projectSlug) return;
      const snap = await getDocs(collection(db, 'projects'));
      const found = snap.docs.map(d => ({ id: d.id, ...d.data() } as Project)).find(p => projectMatchesSlug(p.projectName, projectSlug));
      setCurrentProject(found || null);
    };
    fetchProject();
  }, [projectSlug]);

  const projectId = currentProject?.id || '';
  const base = `/store-stock-management/${projectSlug}`;

  // Each entry on its project-scoped right; Settings is module-wide. Each page gates itself as well.
  const groups = React.useMemo<ModuleNavGroup[]>(() => [
    {
      id: 'main',
      items: [
        { id: 'dashboard', href: base, icon: LayoutDashboard, label: 'Dashboard', tone: 'blue', visible: can('View Dashboard', 'Store & Stock Management.Projects', projectId) },
        { id: 'inventory', href: `${base}/inventory`, icon: Warehouse, label: 'Inventory', tone: 'emerald', visible: can('View Inventory', 'Store & Stock Management.Projects', projectId) },
        { id: 'transactions', href: `${base}/transactions`, icon: ArrowRightLeft, label: 'Transactions', tone: 'violet', visible: can('View Transactions', 'Store & Stock Management.Projects', projectId) },
        { id: 'conversions', href: `${base}/conversions`, icon: GitCommit, label: 'Conversions', tone: 'amber', visible: can('View Conversions', 'Store & Stock Management.Projects', projectId) },
        { id: 'assembly', href: `${base}/assembly`, icon: Component, label: 'BOM Mgmt', tone: 'indigo', visible: can('View BOM', 'Store & Stock Management.Projects', projectId) },
        { id: 'boq', href: `${base}/boq`, icon: ClipboardList, label: 'BOQ', tone: 'teal', visible: can('View BOQ', 'Store & Stock Management.Projects', projectId) },
        { id: 'reports', href: `${base}/reports`, icon: BarChart3, label: 'Reports', tone: 'sky', visible: can('View Reports', 'Store & Stock Management.Projects', projectId) },
        { id: 'ai-forecast', href: `${base}/ai-forecast`, icon: BrainCircuit, label: 'AI Forecast', tone: 'purple', visible: can('View AI Forecast', 'Store & Stock Management.Projects', projectId) },
      ],
    },
    {
      id: 'configuration',
      items: [
        { id: 'settings', href: '/store-stock-management/settings', icon: Settings, label: 'Settings', tone: 'slate', visible: can('View', 'Store & Stock Management.Settings') },
      ],
    },
  ], [base, can, projectId]);

  return (
    <ModuleShell
      title="Store & Stock"
      subtitle={currentProject?.projectName}
      icon={Package}
      groups={groups}
    >
      {children}
      <footer className="mt-6 flex items-center border-t border-border/40 px-1 py-3 text-xs text-muted-foreground">
        <span>Copyright © 2025 {profile.shortName || profile.legalName}. All Rights Reserved.</span>
      </footer>
    </ModuleShell>
  );
}
