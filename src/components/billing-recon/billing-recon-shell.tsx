'use client';

/**
 * Billing Recon's frame: the shared ModuleShell sidebar for every page of the module (dashboard,
 * project pages and settings), a project switcher in the sidebar header, and a context carrying
 * the project list and the current project's register, so pages that need them don't each
 * re-download the `projects` collection.
 *
 * The current project comes from the `[project]` URL segment. Outside a project (the dashboard,
 * settings) the project pages point at the project last opened on this device, so the menu stays
 * useful; with none yet they are hidden and the switcher prompts for one.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useParams, usePathname, useRouter } from 'next/navigation';
import {
  BarChart3,
  Briefcase,
  Calculator,
  ClipboardList,
  FileSpreadsheet,
  FileText,
  HardHat,
  History,
  LayoutDashboard,
  PieChart,
  Plus,
  Receipt,
  Scale,
  ScrollText,
  Settings2,
  Truck,
  Users,
  Wallet,
} from 'lucide-react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Project } from '@/lib/types';
import { useAuthorization } from '@/hooks/useAuthorization';
import { ModuleShell, type ModuleNavGroup, type ModuleNavTab } from '@/components/shared/module-shell';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { projectMatchesSlug, projectSlugCanonical } from '@/lib/project-slug';
import { billingReconRegister, type BillingReconRegister } from '@/lib/billing-recon/register';
import { BR_TONE } from './page-kit';
import { canViewSubcontractorAudit } from '@/lib/subcontractors-audit-scope';

/** Subcontractors Management's rights, which its screens check wherever they are shown. */
const SUBCONTRACTORS = 'Subcontractors Management';

const MODULE = 'Billing Recon';
const BASE = '/billing-recon';
const LAST_PROJECT_KEY = 'sel.billingRecon.lastProject';

/** Top-level segments under /billing-recon that are not project slugs. */
const RESERVED_SEGMENTS = new Set(['settings']);

interface BillingReconProjectsValue {
  /** Every project document (the switcher lists the billing-required ones). */
  projects: Project[];
  /** Projects with billing switched on in Settings › Billing Status. */
  billingProjects: Project[];
  loading: boolean;
  /** The project in the URL, or null outside a project page. */
  currentProject: Project | null;
  /** The URL's project segment, '' outside a project page. */
  currentSlug: string;
  /** Collections for the current project; the shared register while none is selected. */
  register: BillingReconRegister;
  /** Re-read the projects (after separating one, or toggling billing). */
  reload: () => Promise<void>;
}

const BillingReconProjectsContext = createContext<BillingReconProjectsValue | null>(null);

/** The module's project list and current project. Only inside the Billing Recon shell. */
export function useBillingReconProjects(): BillingReconProjectsValue {
  const value = useContext(BillingReconProjectsContext);
  if (!value) throw new Error('useBillingReconProjects must be used inside BillingReconShell');
  return value;
}

/** The slug Billing Recon links use for a project. */
export function billingReconSlug(project: Pick<Project, 'projectName'>): string {
  return projectSlugCanonical(project.projectName);
}

function readLastProject(): string {
  try {
    return window.localStorage.getItem(LAST_PROJECT_KEY) ?? '';
  } catch {
    return '';
  }
}

/** Other tabs changing the remembered project; this tab's own writes are read on its next render. */
function subscribeLastProject(onChange: () => void) {
  window.addEventListener('storage', onChange);
  return () => window.removeEventListener('storage', onChange);
}

async function fetchProjects(): Promise<Project[]> {
  const snap = await getDocs(collection(db, 'projects'));
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }) as Project)
    .sort((a, b) => String(a.projectName ?? '').localeCompare(String(b.projectName ?? '')));
}

function writeLastProject(slug: string) {
  try {
    window.localStorage.setItem(LAST_PROJECT_KEY, slug);
  } catch {
    // Storage blocked: the menu simply won't remember the project.
  }
}

export function BillingReconShell({ children }: { children: ReactNode }) {
  const params = useParams();
  const pathname = usePathname() ?? '';
  const router = useRouter();
  const { can, isLoading: authLoading } = useAuthorization();

  const rawSegment = typeof params?.project === 'string' ? params.project : '';
  const currentSlug = rawSegment && !RESERVED_SEGMENTS.has(rawSegment) ? rawSegment : '';

  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchProjects()
      .then((list) => {
        if (!cancelled) setProjects(list);
      })
      .catch((error) => console.error('Billing Recon: could not load projects', error))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Re-read the projects (after separating one, or toggling billing). */
  const reload = useCallback(async () => {
    try {
      setProjects(await fetchProjects());
    } catch (error) {
      console.error('Billing Recon: could not load projects', error);
    }
  }, []);

  // Remember the project for the menu on non-project pages. Read through useSyncExternalStore so
  // the server render (no storage) and the first client render agree, then the stored value shows.
  const storedSlug = useSyncExternalStore(subscribeLastProject, readLastProject, () => '');
  useEffect(() => {
    if (currentSlug) writeLastProject(currentSlug);
  }, [currentSlug]);
  const lastSlug = currentSlug || storedSlug;

  const currentProject = useMemo(
    () => (currentSlug ? projects.find((p) => projectMatchesSlug(p.projectName, currentSlug)) ?? null : null),
    [projects, currentSlug],
  );
  const billingProjects = useMemo(() => projects.filter((p) => p.billingRequired), [projects]);
  const register = useMemo(() => billingReconRegister(currentProject), [currentProject]);

  // The project the menu's project pages point at.
  const menuSlug = useMemo(() => {
    if (currentSlug) return currentSlug;
    if (!lastSlug) return '';
    return projects.some((p) => projectMatchesSlug(p.projectName, lastSlug)) ? lastSlug : '';
  }, [currentSlug, lastSlug, projects]);
  const menuProject = useMemo(
    () => (menuSlug ? projects.find((p) => projectMatchesSlug(p.projectName, menuSlug)) ?? null : null),
    [projects, menuSlug],
  );

  const sees = useCallback((resource: string) => can('View', `${MODULE}.${resource}`), [can]);
  const canViewModule = can('View Module', MODULE);
  const canSettings =
    canViewModule ||
    sees('Data Separation') ||
    can('Edit Serial Nos', `${MODULE}.JMC`) ||
    can('Edit Serial Nos', `${MODULE}.MVAC`);
  const allowed =
    canViewModule ||
    ['BOQ', 'JMC', 'MVAC', 'Combined Log', 'Billing', 'Reconciliation', 'Data Separation'].some(sees);

  const groups = useMemo<ModuleNavGroup[]>(() => {
    const p = menuSlug ? `${BASE}/${menuSlug}` : '';
    // Grouped like Bank Balance's menu; each entry's colour is its page family's (BR_TONE), so the
    // menu tile, the page backdrop and the page's section tiles agree.
    const has = Boolean(p);
    // Subcontractors' rights are granted per project (by id), as on that module's own sidebar.
    const scProject = menuProject?.id;
    return [
      {
        id: 'overview',
        label: 'Overview',
        items: [
          { id: 'dashboard', label: 'Dashboard', href: BASE, icon: BarChart3, tone: BR_TONE.dashboard, match: 'exact', visible: canViewModule },
          // Named after the project, so the dashboard and settings pages show which project the
          // register links below point at (the last one opened on this device).
          { id: 'project-overview', label: menuProject?.projectName ?? 'Project Overview', href: p, icon: LayoutDashboard, tone: BR_TONE.project, match: 'exact', visible: has && canViewModule },
        ],
      },
      {
        id: 'registers',
        label: 'Registers',
        items: [
          { id: 'boq', label: 'BOQ', href: `${p}/boq`, icon: ClipboardList, tone: BR_TONE.boq, visible: has && sees('BOQ') },
          { id: 'jmc', label: 'JMC', href: `${p}/jmc`, icon: HardHat, tone: BR_TONE.jmc, visible: has && sees('JMC') },
          { id: 'mvac', label: 'MVAC', href: `${p}/mvac`, icon: Truck, tone: BR_TONE.mvac, visible: has && sees('MVAC') },
          { id: 'combined-log', label: 'Combined Log', href: `${p}/combined-log`, icon: History, tone: BR_TONE.log, visible: has && sees('Combined Log') },
        ],
      },
      {
        id: 'billing',
        label: 'Billing',
        items: [
          { id: 'reconciliation', label: 'Reconciliation', href: `${p}/reconciliation`, icon: Scale, tone: BR_TONE.reconciliation, visible: has && sees('Reconciliation') },
          { id: 'billing', label: 'RA Bills', href: `${p}/billing`, icon: Calculator, tone: BR_TONE.billing, visible: has && sees('Billing') },
        ],
      },
      {
        // Subcontractors Management's screens for this project, shown in Billing Recon's frame
        // (/billing-recon/[project]/subcontractors). Same screens and records as that module — its
        // registers, not Billing Recon's — and gated by its rights, scoped to the project as its
        // own sidebar does.
        id: 'subcontractors',
        label: 'Subcontractors',
        items: [
          // Always there once a project is chosen, so the section is never silently missing: without
          // Subcontractors Management's rights its page says which one is needed (the screens check
          // their own rights wherever they are shown), and the entries below stay hidden.
          { id: 'sc-home', label: 'Subcontractors', href: `${p}/subcontractors`, icon: Briefcase, tone: 'rose', match: 'exact', visible: has },
          { id: 'sc-manage', label: 'Manage', href: `${p}/subcontractors/manage`, icon: Users, tone: 'sky', visible: has && can('View', `${SUBCONTRACTORS}.Manage Subcontractors`, scProject) },
          { id: 'sc-work-orders', label: 'Work Orders', href: `${p}/subcontractors/work-order`, icon: FileText, tone: 'violet', visible: has && can('View', `${SUBCONTRACTORS}.Work Order`, scProject) },
          { id: 'sc-billing', label: 'Subcontractor Bills', href: `${p}/subcontractors/billing`, icon: Wallet, tone: 'amber', visible: has && can('View', `${SUBCONTRACTORS}.Billing`, scProject) },
          { id: 'sc-reports', label: 'Reports', href: `${p}/subcontractors/reports`, icon: PieChart, tone: 'indigo', visible: has && can('View', `${SUBCONTRACTORS}.Reports`, scProject) },
          { id: 'sc-audit-log', label: 'Audit Log', href: `${p}/subcontractors/audit-log`, icon: ScrollText, tone: 'slate', visible: has && canViewSubcontractorAudit(can, scProject) },
        ],
      },
      {
        id: 'setup',
        label: 'Setup',
        items: [
          { id: 'settings', label: 'Settings', href: `${BASE}/settings`, icon: Settings2, tone: BR_TONE.settings, visible: canSettings },
        ],
      },
    ];
  }, [menuSlug, menuProject, canViewModule, canSettings, sees, can]);

  const mobileTabs = useMemo<ModuleNavTab[]>(() => {
    const p = menuSlug ? `${BASE}/${menuSlug}` : '';
    return [
      ...(canViewModule ? [{ href: BASE, label: 'Home', icon: BarChart3, exact: true }] : []),
      ...(p && sees('JMC') ? [{ href: `${p}/jmc`, label: 'JMC', icon: HardHat }] : []),
      ...(p && can('Create JMC Entry', `${MODULE}.JMC`)
        ? [{ href: `${p}/jmc/entry`, label: 'New', icon: Plus, emphasized: true, ariaLabel: 'New JMC entry' }]
        : []),
      ...(p && sees('Billing') ? [{ href: `${p}/billing`, label: 'Bills', icon: FileSpreadsheet }] : []),
    ];
  }, [menuSlug, canViewModule, sees, can]);

  const switchProject = useCallback(
    (slug: string) => {
      if (!slug) return;
      // Inside a project, stay on the same screen for the new one (JMC log → JMC log). Stage pages
      // and edit links carry ids that mean nothing in another project, so those land on its section.
      if (currentSlug) {
        const rest = pathname.slice(`${BASE}/${currentSlug}`.length);
        const section = rest.split('/').filter(Boolean);
        const keep = section.length <= 2 && !section.includes('stage') ? rest : section.length ? `/${section[0]}` : '';
        router.push(`${BASE}/${slug}${keep}`);
        return;
      }
      router.push(`${BASE}/${slug}`);
    },
    [currentSlug, pathname, router],
  );

  // The switcher lists billing-required projects, plus the open one if it isn't.
  const switcherProjects = useMemo(() => {
    const list = [...billingProjects];
    if (currentProject && !list.some((p) => p.id === currentProject.id)) list.unshift(currentProject);
    return list;
  }, [billingProjects, currentProject]);
  const selectedSlug = currentProject ? billingReconSlug(currentProject) : '';

  const headerActions = (
    <Select value={selectedSlug} onValueChange={switchProject}>
      <SelectTrigger className="h-8 w-full min-w-0 text-left text-xs" aria-label="Switch project">
        <SelectValue placeholder={loading ? 'Loading projects…' : 'Select a project'} />
      </SelectTrigger>
      <SelectContent>
        {switcherProjects.length === 0 && (
          <div className="px-3 py-2 text-xs text-muted-foreground">
            No project has billing switched on. Turn it on in Settings › Billing Status.
          </div>
        )}
        {switcherProjects.map((project) => (
          <SelectItem key={project.id} value={billingReconSlug(project)}>
            <span className="block max-w-[15rem] truncate">{project.projectName}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  const value = useMemo<BillingReconProjectsValue>(
    () => ({ projects, billingProjects, loading, currentProject, currentSlug, register, reload }),
    [projects, billingProjects, loading, currentProject, currentSlug, register, reload],
  );

  return (
    <BillingReconProjectsContext.Provider value={value}>
      <ModuleShell
        title="Billing Recon"
        subtitle={currentProject?.projectName ?? 'Billing & Reconciliation'}
        icon={Receipt}
        groups={groups}
        mobileTabs={mobileTabs}
        headerActions={headerActions}
        gate={{ loading: authLoading, allowed, deniedMessage: 'You do not have permission to access Billing Recon.' }}
      >
        {children}
      </ModuleShell>
    </BillingReconProjectsContext.Provider>
  );
}

export default BillingReconShell;
