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
  LayoutList,
  Link2,
  Menu,
  PencilRuler,
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
  const links = (close?: () => void) =>
    visible.map((section) => {
      const active =
        pathname === section.href ||
        (section.href !== "/bank-guarantee" &&
          pathname.startsWith(section.href));
      const Icon = section.icon;
      return (
        <Link
          key={section.href}
          href={section.href}
          onClick={close}
          className={cn(
            "group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-all",
            active
              ? "bg-gradient-to-r from-indigo-600 to-violet-700 text-white shadow-md"
              : "text-slate-600 hover:bg-white hover:text-slate-950",
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
          <span className="truncate">{section.label}</span>
        </Link>
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
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_minmax(0,1fr)] lg:items-start">
        <aside className="hidden lg:sticky lg:top-20 lg:block">
          <Card className="overflow-hidden border-white/80 bg-white/90 shadow-sm">
            <div className="border-b bg-gradient-to-r from-indigo-500/10 to-violet-500/5 px-4 py-3">
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-600 to-violet-700">
                  <ShieldCheck className="h-4 w-4 text-white" />
                </span>
                <div>
                  <p className="text-sm font-semibold">Bank Guarantee</p>
                  <p className="text-[11px] text-muted-foreground">
                    Exposure & lifecycle control
                  </p>
                </div>
              </div>
            </div>
            <CardContent className="max-h-[calc(100vh-12rem)] space-y-1 overflow-y-auto p-2">
              {links()}
            </CardContent>
          </Card>
        </aside>
        <main className="min-w-0">{children}</main>
      </div>
    </div>
  );
}
