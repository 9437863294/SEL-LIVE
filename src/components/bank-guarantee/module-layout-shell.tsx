"use client";

import { useMemo, type ReactNode } from "react";
import {
  AlertOctagon,
  BadgeIndianRupee,
  BarChart3,
  CalendarClock,
  CheckCheck,
  ClipboardCheck,
  FileDown,
  FilePlus2,
  FileSearch,
  FileText,
  History,
  LayoutDashboard,
  LayoutList,
  Link2,
  PencilRuler,
  Plus,
  Send,
  Settings2,
  ShieldCheck,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { useAuthorization } from "@/hooks/useAuthorization";
import { BG_PERMISSION_MODULE } from "@/lib/bank-guarantee";
import {
  ModuleShell,
  type ModuleNavGroup,
  type ModuleNavTab,
  type ModuleNavTone,
} from "@/components/shared/module-shell";

type Section = {
  href: string;
  label: string;
  resource: string;
  icon: LucideIcon;
  tone: ModuleNavTone;
};
const sections: Section[] = [
  {
    href: "/bank-guarantee",
    label: "BG Dashboard",
    resource: "Dashboard",
    icon: BarChart3,
    tone: "indigo",
  },
  {
    href: "/bank-guarantee/new",
    label: "New BG Request",
    resource: "BG Requests",
    icon: FilePlus2,
    tone: "emerald",
  },
  {
    href: "/bank-guarantee/register",
    label: "BG Register",
    resource: "BG Register",
    icon: LayoutList,
    tone: "blue",
  },
  {
    href: "/bank-guarantee/approvals",
    label: "Pending Approvals",
    resource: "Pending Approvals",
    icon: ClipboardCheck,
    tone: "violet",
  },
  {
    href: "/bank-guarantee/issuance",
    label: "BG Issuance",
    resource: "BG Issuance",
    icon: Send,
    tone: "indigo",
  },
  {
    href: "/bank-guarantee/extensions",
    label: "Extensions & Amendments",
    resource: "Extension & Amendment",
    icon: PencilRuler,
    tone: "fuchsia",
  },
  {
    href: "/bank-guarantee/calendar",
    label: "Expiry Calendar",
    resource: "Expiry Calendar",
    icon: CalendarClock,
    tone: "orange",
  },
  {
    href: "/bank-guarantee/movement",
    label: "Original BG Movement",
    resource: "Original BG Movement",
    icon: History,
    tone: "sky",
  },
  {
    href: "/bank-guarantee/acknowledgements",
    label: "Beneficiary Acknowledgement",
    resource: "Beneficiary Acknowledgement",
    icon: CheckCheck,
    tone: "teal",
  },
  {
    href: "/bank-guarantee/documents",
    label: "BG Documents",
    resource: "Document Management",
    icon: FileSearch,
    tone: "slate",
  },
  {
    href: "/bank-guarantee/invocations",
    label: "Invocation & Claims",
    resource: "Invocation & Claims",
    icon: AlertOctagon,
    tone: "rose",
  },
  {
    href: "/bank-guarantee/cancellations",
    label: "Cancellation & Release",
    resource: "Cancellation & Release",
    icon: Undo2,
    tone: "amber",
  },
  {
    href: "/bank-guarantee/margins",
    label: "Margin & FD Linkage",
    resource: "Margin & FD Linkage",
    icon: Link2,
    tone: "cyan",
  },
  {
    href: "/bank-guarantee/commissions",
    label: "Commission Reconciliation",
    resource: "Commission Reconciliation",
    icon: BadgeIndianRupee,
    tone: "lime",
  },
  {
    href: "/bank-guarantee/reports",
    label: "Reports",
    resource: "Reports",
    icon: FileText,
    tone: "blue",
  },
  {
    href: "/bank-guarantee/import",
    label: "Import & Reconcile",
    resource: "Import & Reconciliation",
    icon: FileDown,
    tone: "emerald",
  },
  {
    href: "/bank-guarantee/settings",
    label: "Settings & Global Masters",
    resource: "Settings",
    icon: Settings2,
    tone: "slate",
  },
];

export default function BankGuaranteeLayoutShell({
  children,
}: {
  children: ReactNode;
}) {
  const { can, isLoading } = useAuthorization();
  const moduleAccess =
    can("View Module", BG_PERMISSION_MODULE) ||
    sections.some((section) =>
      can("View", `${BG_PERMISSION_MODULE}.${section.resource}`),
    );
  const canSee = (section: Section) =>
    moduleAccess &&
    (section.resource === "Dashboard" ||
      can("View", `${BG_PERMISSION_MODULE}.${section.resource}`) ||
      can("Add", `${BG_PERMISSION_MODULE}.${section.resource}`) ||
      can("Request", `${BG_PERMISSION_MODULE}.${section.resource}`));
  const groups = useMemo<ModuleNavGroup[]>(
    () => [
      {
        id: "main",
        items: sections.map((section) => ({
          id: section.href,
          href: section.href,
          label: section.label,
          icon: section.icon,
          tone: section.tone,
          visible: canSee(section),
          match:
            section.href === "/bank-guarantee"
              ? (path: string) =>
                  path === "/bank-guarantee" ||
                  path === "/bank-guarantee/dashboard"
              : undefined,
        })),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- canSee reads only `can` and `moduleAccess`
    [can, moduleAccess],
  );
  // The phone's bottom bar: the dashboard, the register, raising a BG request in the middle,
  // approvals, and "More" opening the pop-up of every page. Each tab only if its menu entry is visible too.
  const isVisible = (href: string) =>
    sections.some((section) => section.href === href && canSee(section));
  const bottomTabs: ModuleNavTab[] = [
    {
      href: "/bank-guarantee",
      label: "Home",
      icon: LayoutDashboard,
      match: (path) =>
        path === "/bank-guarantee" || path === "/bank-guarantee/dashboard",
    },
    ...(isVisible("/bank-guarantee/register")
      ? [
          {
            href: "/bank-guarantee/register",
            label: "Register",
            icon: LayoutList,
          },
        ]
      : []),
    ...(can("Add", `${BG_PERMISSION_MODULE}.BG Requests`)
      ? [
          {
            href: "/bank-guarantee/new",
            label: "New",
            icon: Plus,
            emphasized: true,
            ariaLabel: "New bank guarantee request",
          },
        ]
      : []),
    ...(isVisible("/bank-guarantee/approvals")
      ? [
          {
            href: "/bank-guarantee/approvals",
            label: "Approvals",
            icon: ClipboardCheck,
          },
        ]
      : []),
  ];
  return (
    <ModuleShell
      title="Bank Guarantee"
      subtitle="Exposure & lifecycle control"
      icon={ShieldCheck}
      groups={groups}
      mobileTabs={bottomTabs}
      gate={{
        loading: isLoading,
        allowed: moduleAccess,
        deniedMessage:
          "You do not have permission to access Bank Guarantee Management.",
      }}
    >
      {children}
    </ModuleShell>
  );
}
