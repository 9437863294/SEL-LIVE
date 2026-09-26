"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
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
  Landmark,
  LayoutDashboard,
  LayoutList,
  Link2,
  Menu,
  PencilRuler,
  Plus,
  Send,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Undo2,
  WalletCards,
  type LucideIcon,
} from "lucide-react";
import { useAuthorization } from "@/hooks/useAuthorization";
import { BG_PERMISSION_MODULE } from "@/lib/bank-guarantee";
import {
  ModuleBottomNav,
  type ModuleNavTab,
} from "@/components/navigation/ModuleBottomNav";
import {
  SIDEBAR_ICONS_GRID,
  SidebarNavTooltip,
  useSidebarIconsOnly,
} from "@/components/navigation/use-sidebar-mode";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type Section = {
  href: string;
  label: string;
  resource: string;
  icon: LucideIcon;
  tone: string;
};
const sections: Section[] = [
  {
    href: "/bank-guarantee",
    label: "BG Dashboard",
    resource: "Dashboard",
    icon: BarChart3,
    tone: "bg-indigo-50 text-indigo-700",
  },
  {
    href: "/bank-guarantee/new",
    label: "New BG Request",
    resource: "BG Requests",
    icon: FilePlus2,
    tone: "bg-emerald-50 text-emerald-700",
  },
  {
    href: "/bank-guarantee/register",
    label: "BG Register",
    resource: "BG Register",
    icon: LayoutList,
    tone: "bg-blue-50 text-blue-700",
  },
  {
    href: "/bank-guarantee/approvals",
    label: "Pending Approvals",
    resource: "Pending Approvals",
    icon: ClipboardCheck,
    tone: "bg-violet-50 text-violet-700",
  },
  {
    href: "/bank-guarantee/issuance",
    label: "BG Issuance",
    resource: "BG Issuance",
    icon: Send,
    tone: "bg-indigo-50 text-indigo-700",
  },
  {
    href: "/bank-guarantee/extensions",
    label: "Extensions & Amendments",
    resource: "Extension & Amendment",
    icon: PencilRuler,
    tone: "bg-fuchsia-50 text-fuchsia-700",
  },
  {
    href: "/bank-guarantee/calendar",
    label: "Expiry Calendar",
    resource: "Expiry Calendar",
    icon: CalendarClock,
    tone: "bg-orange-50 text-orange-700",
  },
  {
    href: "/bank-guarantee/movement",
    label: "Original BG Movement",
    resource: "Original BG Movement",
    icon: History,
    tone: "bg-sky-50 text-sky-700",
  },
  {
    href: "/bank-guarantee/acknowledgements",
    label: "Beneficiary Acknowledgement",
    resource: "Beneficiary Acknowledgement",
    icon: CheckCheck,
    tone: "bg-teal-50 text-teal-700",
  },
  {
    href: "/bank-guarantee/documents",
    label: "BG Documents",
    resource: "Document Management",
    icon: FileSearch,
    tone: "bg-slate-100 text-slate-700",
  },
  {
    href: "/bank-guarantee/invocations",
    label: "Invocation & Claims",
    resource: "Invocation & Claims",
    icon: AlertOctagon,
    tone: "bg-rose-50 text-rose-700",
  },
  {
    href: "/bank-guarantee/cancellations",
    label: "Cancellation & Release",
    resource: "Cancellation & Release",
    icon: Undo2,
    tone: "bg-amber-50 text-amber-800",
  },
  {
    href: "/bank-guarantee/margins",
    label: "Margin & FD Linkage",
    resource: "Margin & FD Linkage",
    icon: Link2,
    tone: "bg-cyan-50 text-cyan-700",
  },
  {
    href: "/bank-guarantee/commissions",
    label: "Commission Reconciliation",
    resource: "Commission Reconciliation",
    icon: BadgeIndianRupee,
    tone: "bg-lime-50 text-lime-700",
  },
  {
    href: "/bank-guarantee/reports",
    label: "Reports",
    resource: "Reports",
    icon: FileText,
    tone: "bg-blue-50 text-blue-700",
  },
  {
    href: "/bank-guarantee/import",
    label: "Import & Reconcile",
    resource: "Import & Reconciliation",
    icon: FileDown,
    tone: "bg-emerald-50 text-emerald-700",
  },
  {
    href: "/bank-guarantee/settings",
    label: "Settings & Global Masters",
    resource: "Settings",
    icon: Settings2,
    tone: "bg-slate-100 text-slate-700",
  },
];

export default function BankGuaranteeLayoutShell({
  children,
}: {
  children: ReactNode;
}) {
  const pathname = usePathname() || "";
  const { can, isLoading } = useAuthorization();
  const [open, setOpen] = useState(false);
  const iconsOnly = useSidebarIconsOnly();
  const moduleAccess =
    can("View Module", BG_PERMISSION_MODULE) ||
    sections.some((section) =>
      can("View", `${BG_PERMISSION_MODULE}.${section.resource}`),
    );
  const visible = sections.filter(
    (section) =>
      moduleAccess &&
      (section.resource === "Dashboard" ||
        can("View", `${BG_PERMISSION_MODULE}.${section.resource}`) ||
        can("Add", `${BG_PERMISSION_MODULE}.${section.resource}`) ||
        can("Request", `${BG_PERMISSION_MODULE}.${section.resource}`)),
  );
  // The phone's bottom bar: the dashboard, the register, raising a BG request in the middle,
  // approvals, and "More" opening the full menu. Each tab only if its menu entry is visible too.
  const isVisible = (href: string) =>
    visible.some((section) => section.href === href);
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
  // `compact` is the desktop sidebar in icons mode; the phone sheet always passes labels.
  const links = (close?: () => void, compact = false) =>
    visible.map((section) => {
      const active =
        pathname === section.href ||
        (section.href !== "/bank-guarantee" &&
          pathname.startsWith(section.href));
      const Icon = section.icon;
      return (
        <SidebarNavTooltip
          key={section.href}
          label={section.label}
          enabled={compact}
        >
          <Link
            href={section.href}
            onClick={close}
            aria-current={active ? "page" : undefined}
            title={compact ? section.label : undefined}
            className={cn(
              "group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-all",
              active
                ? "bg-gradient-to-r from-indigo-600 to-violet-700 text-white shadow-md"
                : "text-slate-600 hover:bg-white hover:text-slate-950",
              compact && "relative justify-center",
            )}
          >
            <span
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
                active ? "bg-white/20 text-white" : section.tone,
              )}
            >
              <Icon className="h-3.5 w-3.5" />
            </span>
            <span className={compact ? "sr-only" : "truncate"}>
              {section.label}
            </span>
          </Link>
        </SidebarNavTooltip>
      );
    });
  if (isLoading) return <div className="min-h-[50vh]" />;
  if (!moduleAccess)
    return (
      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>
              You do not have permission to access Bank Guarantee Management.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center py-8">
            <ShieldAlert className="h-14 w-14 text-destructive" />
          </CardContent>
        </Card>
      </div>
    );
  return (
    <div className="relative w-full px-4 py-5 sm:px-6 lg:px-8">
      <div className="pointer-events-none absolute inset-0 -z-10 rounded-3xl bg-gradient-to-br from-indigo-50/70 via-white to-violet-50/60" />
      <div className="mb-3 lg:hidden">
        <Card className="border-white/80 bg-white/90">
          <CardContent className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-600 to-violet-700">
                <ShieldCheck className="h-4 w-4 text-white" />
              </span>
              <div>
                <p className="text-sm font-semibold">Bank Guarantee</p>
                <p className="text-xs text-muted-foreground">
                  Exposure & lifecycle control
                </p>
              </div>
            </div>
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger asChild>
                <Button size="sm" variant="outline">
                  <Menu className="mr-1.5 h-4 w-4" />
                  Menu
                </Button>
              </SheetTrigger>
              <SheetContent
                side="left"
                className="w-[88vw] max-w-[340px] bg-slate-50 p-0"
              >
                <SheetHeader className="border-b px-4 py-4 text-left">
                  <SheetTitle>Bank Guarantee Management</SheetTitle>
                  <SheetDescription>
                    Navigate the complete BG lifecycle
                  </SheetDescription>
                </SheetHeader>
                <div className="max-h-[calc(100vh-90px)] space-y-1 overflow-y-auto p-2 pb-8">
                  {links(() => setOpen(false))}
                </div>
              </SheetContent>
            </Sheet>
          </CardContent>
        </Card>
      </div>
      <div
        className={`grid grid-cols-1 gap-4 ${iconsOnly ? SIDEBAR_ICONS_GRID : "lg:grid-cols-[260px_minmax(0,1fr)]"} lg:items-start`}
      >
        <TooltipProvider delayDuration={150}>
          <aside className="hidden lg:sticky lg:top-[calc(var(--app-header-offset,4rem)+1rem)] lg:block">
            <Card className="overflow-hidden border-white/80 bg-white/90 shadow-sm">
              <div
                className={cn(
                  "border-b bg-gradient-to-r from-indigo-500/10 to-violet-500/5 px-4 py-3",
                  iconsOnly && "px-2",
                )}
                title={iconsOnly ? "Bank Guarantee" : undefined}
              >
                <div
                  className={cn(
                    "flex items-center gap-2.5",
                    iconsOnly && "justify-center",
                  )}
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-600 to-violet-700">
                    <ShieldCheck className="h-4 w-4 text-white" />
                  </span>
                  <div className={iconsOnly ? "sr-only" : undefined}>
                    <p className="text-sm font-semibold">Bank Guarantee</p>
                    <p className="text-[11px] text-muted-foreground">
                      Exposure & lifecycle control
                    </p>
                  </div>
                </div>
              </div>
              <CardContent className="max-h-[calc(100vh-var(--app-header-offset,4rem)-8rem)] space-y-1 overflow-y-auto p-2">
                {links(undefined, iconsOnly)}
              </CardContent>
            </Card>
          </aside>
        </TooltipProvider>
        <main className="min-w-0">{children}</main>
      </div>

      <ModuleBottomNav
        tabs={bottomTabs}
        pages={visible}
        onMore={() => setOpen(true)}
        moduleName="Bank Guarantee"
      />
    </div>
  );
}
