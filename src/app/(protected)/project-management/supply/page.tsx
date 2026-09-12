"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  BarChart3,
  CalendarClock,
  ClipboardCheck,
  ClipboardList,
  Compass,
  Factory,
  FileCheck2,
  FileSearch,
  ListChecks,
  Package,
  PackageCheck,
  PenTool,
  ShieldAlert,
  ShoppingCart,
  Truck,
} from "lucide-react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuthorization } from "@/hooks/useAuthorization";
import { cn } from "@/lib/utils";

const MODULE_NAME = "Project Management";
const PERMISSION_RESOURCE = `${MODULE_NAME}.Supply`;

type ProjectMapping = {
  id: string;
  projectName: string;
};

export default function SupplyPage() {
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { can, isLoading: isAuthLoading } = useAuthorization();

  const canViewBoq = can("View", `${MODULE_NAME}.BOQ`);
  const canView = can("View", PERMISSION_RESOURCE) || canViewBoq;
  const canViewIndent = can("View", `${MODULE_NAME}.Indent`) || canViewBoq;
  const canViewRfq = can("View", `${MODULE_NAME}.RFQ`) || canViewBoq;
  const canViewPurchaseOrders = can("View", `${MODULE_NAME}.Purchase Orders`) || canViewRfq;
  const canViewSurvey = can("View", `${MODULE_NAME}.Survey`) || canViewBoq;
  const canViewRequirementPlanner = can("View", `${MODULE_NAME}.Requirement Planner`) || canViewIndent;
  const canViewDrawing = can("View", `${MODULE_NAME}.Drawing`) || canViewBoq;
  const canViewManufacturingClearance = can("View", `${MODULE_NAME}.Manufacturing Clearance`) || canViewBoq;
  const canViewInspections = can("View", `${MODULE_NAME}.Inspections`) || canViewBoq;
  const canViewMdcc = can("View", `${MODULE_NAME}.MDCC`) || canViewBoq;
  const canViewDi = can("View", `${MODULE_NAME}.Dispatch Instructions`) || canViewBoq;
  const canViewGrn = can("View", `${MODULE_NAME}.GRN`) || canViewBoq;
  const canViewMvac = can("View", `${MODULE_NAME}.MVAC`) || canViewBoq;

  const [mapping, setMapping] = useState<ProjectMapping | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (isAuthLoading || !canView) {
      setIsLoading(false);
      return;
    }
    if (!mappingId) {
      setIsLoading(false);
      return;
    }
    const load = async () => {
      setIsLoading(true);
      try {
        const snapshot = await getDoc(doc(db, "projectManagementProjects", mappingId));
        setMapping(snapshot.exists() ? { id: snapshot.id, projectName: snapshot.data().projectName } : null);
      } catch (error) {
        console.error("Failed to load project mapping:", error);
        setMapping(null);
      } finally {
        setIsLoading(false);
      }
    };
    void load();
  }, [canView, isAuthLoading, mappingId]);

  // Grouped by the phase of the chain rather than listed flat. Fourteen identical tiles in one
  // grid gave no clue that Indent/RFQ/PO are one activity, or that MDCC through MVAC only happen
  // after something has been manufactured — and the order of the chain was carried by position
  // alone, which is invisible once the grid wraps.
  //
  // The project name is deliberately absent from every description: it is already in the header,
  // and repeating it fourteen times truncated the one line each tile has for saying what it does.
  const linkGroups = [
    {
      key: "plan",
      title: "Plan & specify",
      icon: ClipboardList,
      links: [
      {
        show: canViewBoq,
        href: `/project-management/boq/costing?project=${encodeURIComponent(mappingId)}&scope2=Supply`,
        title: "BOQ",
        description: "Scope 2 = Supply, with every gate quantity alongside.",
        icon: ClipboardList,
        gradient: "from-cyan-500 to-blue-600",
      },
      {
        show: canViewSurvey,
        href: `/project-management/survey?project=${encodeURIComponent(mappingId)}`,
        title: "Survey",
        description: "Verify BOQ quantities at site before anything is ordered.",
        icon: Compass,
        gradient: "from-rose-500 to-pink-600",
      },
      {
        show: canViewRequirementPlanner,
        href: `/project-management/requirement-planner?project=${encodeURIComponent(mappingId)}`,
        title: "Requirement Planner",
        description: "What must be indented today, and what is already late.",
        icon: CalendarClock,
        gradient: "from-amber-600 to-yellow-600",
      },
      {
        show: canViewDrawing,
        href: `/project-management/drawing?project=${encodeURIComponent(mappingId)}`,
        title: "Drawing",
        description: "Submissions, revisions and approvals before manufacture.",
        icon: PenTool,
        gradient: "from-slate-500 to-slate-700",
      },
      ],
    },
    {
      key: "analyse",
      title: "Analyse",
      icon: BarChart3,
      links: [
      {
        show: canView,
        href: `/project-management/supply/reports?project=${encodeURIComponent(mappingId)}`,
        title: "Reports",
        description: "Pipeline, bottlenecks, cycle time and vendor performance.",
        icon: BarChart3,
        gradient: "from-indigo-500 to-blue-600",
      },
      ],
    },
    {
      key: "procure",
      title: "Procure",
      icon: ShoppingCart,
      links: [
      {
        show: canViewIndent,
        href: `/project-management/indent?project=${encodeURIComponent(mappingId)}`,
        title: "Indent",
        description: "Raise demand against BOQ items.",
        icon: ListChecks,
        gradient: "from-amber-500 to-orange-600",
      },
      {
        show: canViewRfq,
        href: `/project-management/rfq?project=${encodeURIComponent(mappingId)}`,
        title: "RFQ",
        description: "Request and compare vendor quotations.",
        icon: FileSearch,
        gradient: "from-violet-500 to-purple-600",
      },
      {
        show: canViewPurchaseOrders,
        href: `/project-management/purchase-orders?project=${encodeURIComponent(mappingId)}`,
        title: "Purchase Orders",
        description: "Commit quantity and rate to a vendor.",
        icon: ShoppingCart,
        gradient: "from-emerald-500 to-teal-600",
      },
      ],
    },
    {
      key: "manufacture",
      title: "Manufacture & inspect",
      icon: Factory,
      links: [
      {
        show: canViewManufacturingClearance,
        href: `/project-management/manufacturing-clearance?project=${encodeURIComponent(mappingId)}`,
        title: "Manufacturing Clearance",
        description: "Clear a vendor to begin production.",
        icon: Factory,
        gradient: "from-lime-500 to-green-600",
      },
      {
        show: canViewInspections,
        href: `/project-management/inspections?project=${encodeURIComponent(mappingId)}`,
        title: "Inspections",
        description: "Offer cleared quantity and record what passed.",
        icon: ClipboardCheck,
        gradient: "from-blue-500 to-indigo-600",
      },
      ],
    },
    {
      key: "deliver",
      title: "Dispatch & accept",
      icon: Truck,
      links: [
      {
        show: canViewMdcc,
        href: `/project-management/mdcc/documents?project=${encodeURIComponent(mappingId)}`,
        title: "MDCC",
        description: "The client's clearance to dispatch.",
        icon: BadgeCheck,
        gradient: "from-fuchsia-500 to-purple-600",
      },
      {
        show: canViewDi,
        href: `/project-management/dispatch-instructions/documents?project=${encodeURIComponent(mappingId)}`,
        title: "Dispatch Instructions",
        description: "SEL's numbered instruction authorising vendor dispatch.",
        icon: Truck,
        gradient: "from-sky-500 to-blue-600",
      },
      {
        show: canViewGrn,
        href: `/project-management/grn/documents?project=${encodeURIComponent(mappingId)}`,
        title: "GRN",
        description: "Record material receipt at site.",
        icon: PackageCheck,
        gradient: "from-orange-500 to-amber-600",
      },
      {
        show: canViewMvac,
        href: `/project-management/mvac/documents?project=${encodeURIComponent(mappingId)}`,
        title: "MVAC",
        description: "Joint acceptance with the client — the billing trigger.",
        icon: FileCheck2,
        gradient: "from-teal-500 to-cyan-600",
      },
      ],
    },
  ]
    .map((group) => ({ ...group, links: group.links.filter((link) => link.show) }))
    .filter((group) => group.links.length);

  const quickLinks = linkGroups.flatMap((group) => group.links);

  if (isAuthLoading || isLoading) {
    return (
      <main className="min-h-[calc(100dvh-4rem)] space-y-5 p-4 sm:p-6">
        <Skeleton className="h-9 w-64" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      </main>
    );
  }

  if (!canView) {
    return (
      <main className="min-h-[calc(100dvh-4rem)] p-4 sm:p-6">
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>You do not have permission to view this module.</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center p-8">
            <ShieldAlert className="h-16 w-16 text-destructive" />
          </CardContent>
        </Card>
      </main>
    );
  }

  if (!mappingId || !mapping) {
    return (
      <main className="min-h-[calc(100dvh-4rem)] p-4 sm:p-6">
        <Card>
          <CardHeader>
            <CardTitle>Select a project first</CardTitle>
            <CardDescription>Return to Project Management and choose a project before opening Supply.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild><Link href="/project-management">Select Project</Link></Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-[calc(100dvh-4rem)] space-y-5 p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href={`/project-management?project=${encodeURIComponent(mappingId)}`} aria-label="Back to Project Management">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 shadow-sm">
          <Package className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Supply</h1>
          {/* The project leads, since the screen name is already the heading above it. */}
          <p className="text-sm text-muted-foreground">
            {mapping.projectName}
            <span className="mx-1.5 text-muted-foreground/50">·</span>
            BOQ through to client acceptance
          </p>
        </div>
      </div>

      {quickLinks.length ? (
        /* Two columns rather than one flat grid, with each group's span and inner column count
           chosen so its tiles fill the row they are given: Plan(4)+Analyse(1), then
           Procure(3)+Manufacture(2), then Dispatch across the full width. */
        <div className="grid gap-5 lg:grid-cols-3">
          {linkGroups.map((group) => (
            <section
              key={group.key}
              className={cn(
                "space-y-2.5",
                group.key === "deliver"
                  ? "lg:col-span-3"
                  : group.key === "plan" || group.key === "procure"
                    ? "lg:col-span-2"
                    : "lg:col-span-1",
              )}
            >
              <div className="flex items-center gap-2">
                <group.icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {group.title}
                </h2>
                <span aria-hidden className="h-px flex-1 bg-border" />
              </div>

              <div
                className={cn(
                  "grid gap-3",
                  group.key === "deliver"
                    ? "sm:grid-cols-2 lg:grid-cols-4"
                    : group.key === "plan"
                      ? "sm:grid-cols-2"
                      : group.key === "procure"
                        ? "sm:grid-cols-2 xl:grid-cols-3"
                        : "sm:grid-cols-2 lg:grid-cols-1",
                )}
              >
                {group.links.map((link) => (
                  <Link
                    key={link.title}
                    href={link.href}
                    className="group rounded-xl no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    <Card className="h-full overflow-hidden border-border/60 transition-all duration-200 hover:-translate-y-0.5 hover:border-border hover:shadow-md">
                      <div className={cn("h-1 w-full bg-gradient-to-r", link.gradient)} />
                      <CardContent className="flex items-center gap-2.5 p-3">
                        <div
                          className={cn(
                            "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br shadow-sm transition-transform duration-200 group-hover:scale-105",
                            link.gradient,
                          )}
                        >
                          <link.icon className="h-4 w-4 text-white" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold leading-tight">{link.title}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {link.description}
                          </p>
                        </div>
                        <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1" />
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <Package className="h-10 w-10 text-muted-foreground" />
            <div>
              <p className="font-medium">Nothing available</p>
              <p className="text-sm text-muted-foreground">You don&apos;t have access to any Supply workflow sections yet.</p>
            </div>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
