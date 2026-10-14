'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import { doc, onSnapshot } from 'firebase/firestore';
import {
  BarChart3,
  BookOpen,
  CalendarClock,
  CalendarDays,
  CircleDollarSign,
  ClipboardCheck,
  FileCheck2,
  LayoutDashboard,
  ListChecks,
  Plus,
  ReceiptIndianRupee,
  Repeat2,
  Settings,
  Tags,
  Users,
  WalletCards,
  type LucideIcon,
} from 'lucide-react';
import { db } from '@/lib/firebase';
import { DEFAULT_RECURRING_WORKFLOW, type RecurringWorkflowStep } from '@/lib/recurring-payments';
import { useAuthorization } from '@/hooks/useAuthorization';
import { ModuleShell, type ModuleNavGroup, type ModuleNavTab, type ModuleNavTone } from '@/components/shared/module-shell';
import { useAssignedWorkflowSteps } from './use-assigned-workflow';

type NavItem = {
  href: string;
  label: string;
  resource: string;
  icon: LucideIcon;
  tone: ModuleNavTone;
  group: string;
  /** Set on workflow-step entries so an assignee of that step can reach it without the role. */
  stepId?: string;
};

const coreItems: NavItem[] = [
  { href: '/recurring-payments', label: 'Dashboard', resource: 'Dashboard', icon: LayoutDashboard, tone: 'emerald', group: 'overview' },
  { href: '/recurring-payments/payments', label: 'All Payments', resource: 'Payments', icon: ReceiptIndianRupee, tone: 'blue', group: 'payments' },
  { href: '/recurring-payments/upcoming', label: 'Upcoming', resource: 'Payments', icon: CalendarClock, tone: 'cyan', group: 'payments' },
  { href: '/recurring-payments/overdue', label: 'Overdue', resource: 'Payments', icon: CircleDollarSign, tone: 'rose', group: 'payments' },
];

const managementItems: NavItem[] = [
  { href: '/recurring-payments/approvals', label: 'Pending Approvals', resource: 'Approvals', icon: ClipboardCheck, tone: 'amber', group: 'control' },
  { href: '/recurring-payments/calendar', label: 'Payment Calendar', resource: 'Payments', icon: CalendarDays, tone: 'sky', group: 'control' },
  { href: '/recurring-payments/masters', label: 'Recurring Masters', resource: 'Recurring Masters', icon: Repeat2, tone: 'indigo', group: 'masters' },
  { href: '/recurring-payments/vendors', label: 'Vendors', resource: 'Vendors', icon: Users, tone: 'purple', group: 'masters' },
  { href: '/recurring-payments/categories', label: 'Categories', resource: 'Categories', icon: Tags, tone: 'orange', group: 'masters' },
  { href: '/recurring-payments/reports', label: 'Reports', resource: 'Reports', icon: BarChart3, tone: 'fuchsia', group: 'insights' },
  { href: '/recurring-payments/settings', label: 'Settings', resource: 'Settings', icon: Settings, tone: 'slate', group: 'settings' },
  { href: '/recurring-payments/handbook', label: 'Handbook', resource: 'Dashboard', icon: BookOpen, tone: 'teal', group: 'help' },
];

/** Section headings, keyed by each entry's `group`. */
const GROUP_LABELS: Record<string, string> = {
  overview: 'Overview',
  payments: 'Payments',
  workflow: 'Workflow',
  control: 'Control',
  masters: 'Masters',
  insights: 'Insights',
  settings: 'Settings',
  help: 'Help',
};

const workflowPalette: { tone: ModuleNavTone; icon: LucideIcon }[] = [
  { tone: 'violet', icon: FileCheck2 },
  { tone: 'amber', icon: ClipboardCheck },
  { tone: 'pink', icon: ListChecks },
  { tone: 'teal', icon: WalletCards },
  { tone: 'green', icon: FileCheck2 },
];

function matchesPath(pathname: string, href: string) {
  if (href === '/recurring-payments') {
    return pathname === href || pathname === '/recurring-payments/dashboard';
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function RecurringPaymentsLayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const safePathname = pathname || '';
  const { can, isLoading: authLoading } = useAuthorization();
  const { assignedStepIds, hasAssignedWork, loading: assignmentsLoading } = useAssignedWorkflowSteps();
  const [workflowSteps, setWorkflowSteps] = useState<RecurringWorkflowStep[]>(DEFAULT_RECURRING_WORKFLOW);

  useEffect(
    () =>
      onSnapshot(
        doc(db, 'workflows', 'recurring-payments-workflow'),
        (snapshot) => {
          const steps = snapshot.data()?.steps as RecurringWorkflowStep[] | undefined;
          if (steps?.length) setWorkflowSteps(steps);
        },
        // A failed read keeps the steps already shown (the default workflow at worst), so the
        // sidebar stays usable instead of surfacing an uncaught listener error.
        (error) => console.warn('Recurring payments workflow could not be loaded for the sidebar', error),
      ),
    [],
  );

  const navItems = useMemo(() => {
    const workflowItems: NavItem[] = workflowSteps.map((step, index) => {
      const palette = workflowPalette[index % workflowPalette.length];
      const normalizedName = step.name.toLowerCase();
      const resource = normalizedName.includes('approval')
        ? 'Approvals'
        : normalizedName.includes('payment') || normalizedName.includes('closure')
          ? 'Payment Processing'
          : 'Payments';
      return {
        href: `/recurring-payments/stage/${step.id}`,
        label: step.name,
        resource,
        icon: palette.icon,
        tone: palette.tone,
        group: 'workflow',
        stepId: step.id,
      };
    });

    // Whoever the workflow named on a step gets that step's queue — and the approval centre when
    // the step is an approval — without needing the matching role permission on top.
    const assignedApproval = workflowSteps.some(
      (step) => assignedStepIds.has(step.id) && step.name.toLowerCase().includes('approval'),
    );
    return [...coreItems, ...workflowItems, ...managementItems].filter((item) =>
      item.stepId
        // Assignment is the *only* gate on a workflow step queue, deliberately narrower than the
        // rest of the module. A step page renders nothing but the signed-in user's own assigned
        // tasks, so a role permission on its own surfaced a page that could only ever be empty —
        // and implied the holder had work waiting when the workflow had never named them. Anyone
        // needing oversight of other people's queues uses All Payments or the reports, which are
        // built to show the whole organization.
        ? assignedStepIds.has(item.stepId)
        : can('View', `Recurring Payments.${item.resource}`) ||
          (['Approvals', 'Payment Processing'].includes(item.resource) &&
            can('View', 'Recurring Payments.Payments')) ||
          (item.href === '/recurring-payments/approvals' && assignedApproval),
    );
  }, [assignedStepIds, can, workflowSteps]);

  const groups = useMemo<ModuleNavGroup[]>(() => {
    const list: ModuleNavGroup[] = [];
    for (const item of navItems) {
      let group = list.find((entry) => entry.id === item.group);
      if (!group) {
        group = { id: item.group, label: GROUP_LABELS[item.group], items: [] };
        list.push(group);
      }
      group.items.push({
        id: item.stepId ? `stage-${item.stepId}` : item.href,
        label: item.label,
        href: item.href,
        icon: item.icon,
        tone: item.tone,
        match: item.href === '/recurring-payments' ? (path: string) => matchesPath(path, item.href) : undefined,
      });
    }
    return list;
  }, [navItems]);

  const canViewModule = can('View Module', 'Recurring Payments') || hasAssignedWork;
  const currentPageAllowed = safePathname.startsWith('/recurring-payments/settings/workflow')
    ? can('View Workflow', 'Recurring Payments.Settings')
    : navItems.some((item) => matchesPath(safePathname, item.href));

  // The phone's bottom bar: the payment register and the approval centre either side of a new
  // payment, and "More" opening the pop-up of every page. Each tab only if its sidebar entry is
  // visible too. A create form sits under its register's route, so it is offered only where
  // that register is open to the user — otherwise the shell would refuse the page it leads to.
  const isVisible = (href: string) => navItems.some((item) => item.href === href);
  const createTab: ModuleNavTab | null =
    can('Add', 'Recurring Payments.Payments') && isVisible('/recurring-payments/payments')
      ? { href: '/recurring-payments/payments/new', label: 'New', icon: Plus, emphasized: true, ariaLabel: 'New manual payment' }
      : can('Add', 'Recurring Payments.Recurring Masters') && isVisible('/recurring-payments/masters')
        ? { href: '/recurring-payments/masters/new', label: 'New', icon: Plus, emphasized: true, ariaLabel: 'New recurring master' }
        : null;
  const bottomTabs: ModuleNavTab[] = [
    ...(isVisible('/recurring-payments')
      ? [{ href: '/recurring-payments', label: 'Home', icon: LayoutDashboard, match: (path: string) => matchesPath(path, '/recurring-payments') }]
      : []),
    ...(isVisible('/recurring-payments/payments')
      ? [{ href: '/recurring-payments/payments', label: 'Payments', icon: ReceiptIndianRupee }]
      : []),
    ...(createTab ? [createTab] : []),
    ...(isVisible('/recurring-payments/approvals')
      ? [{ href: '/recurring-payments/approvals', label: 'Approvals', icon: ClipboardCheck }]
      : []),
  ];

  // A workflow step is refused for a different reason than everything else — the user may well
  // hold the role permission and simply have no task here — so saying "no permission" would send
  // them to an administrator who has nothing to change.
  const stageRefused = safePathname.startsWith('/recurring-payments/stage/');

  // `recurring-payments-theme` / `-content` carry the module's table frame and print rules in
  // globals.css; the shell itself is the shared one.
  return (
    <div className="recurring-payments-theme w-full">
      <ModuleShell
        title="Recurring Payments"
        subtitle="Bill & Workflow Manager"
        icon={Repeat2}
        groups={groups}
        mobileTabs={bottomTabs}
        gate={{
          // Assignment-only access resolves a moment after the role check does — wait for it rather
          // than flashing "Access denied" at a user whose queue is about to grant them the page.
          loading: authLoading || (assignmentsLoading && (!canViewModule || !currentPageAllowed)),
          allowed: canViewModule,
          deniedMessage: 'You do not have permission to access Recurring Payments.',
          pageAllowed: currentPageAllowed,
          pageDeniedMessage: stageRefused
            ? 'No tasks assigned to you at this step. A workflow step only shows the tasks it has assigned to you; it reappears in the menu as soon as a payment reaches you at it.'
            : 'You do not have permission to view this Recurring Payments page.',
        }}
      >
        <div className="recurring-payments-content min-w-0">{children}</div>
      </ModuleShell>
    </div>
  );
}
