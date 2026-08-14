"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  ClipboardCheck,
  ClipboardList,
  Compass,
  Factory,
  FileSearch,
  Gauge,
  ListChecks,
  Package,
  PenTool,
  ShieldAlert,
  ShoppingCart,
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
  const canViewDrawing = can("View", `${MODULE_NAME}.Drawing`) || canViewBoq;
  const canViewManufacturingClearance = can("View", `${MODULE_NAME}.Manufacturing Clearance`) || canViewBoq;
  const canViewInspections = can("View", `${MODULE_NAME}.Inspections`) || canViewBoq;
  const canViewMdcc = can("View", `${MODULE_NAME}.MDCC`) || canViewBoq;
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

  const quickLinks = [
    {
      show: canViewBoq,
      href: `/project-management/boq/costing?project=${encodeURIComponent(mappingId)}&scope2=Supply`,
      title: "BOQ",
      description: mapping
        ? `View BOQ items for ${mapping.projectName}, filtered to Scope 2 = Supply.`
        : "View BOQ items filtered to Scope 2 = Supply.",
      icon: ClipboardList,
      gradient: "from-cyan-500 to-blue-600",
    },
    {
      show: canViewSurvey,
      href: `/project-management/survey?project=${encodeURIComponent(mappingId)}`,
      title: "Survey",
      description: mapping
        ? `Track survey activities for ${mapping.projectName}.`
        : "Track survey activities for this project.",
      icon: Compass,
      gradient: "from-rose-500 to-pink-600",
    },
    {
      show: canViewIndent,
      href: `/project-management/indent?project=${encodeURIComponent(mappingId)}`,
      title: "Indent",
      description: mapping
        ? `Create BOQ item indents for ${mapping.projectName}.`
        : "Create project indents against BOQ items.",
      icon: ListChecks,
      gradient: "from-amber-500 to-orange-600",
    },
    {
      show: canViewRfq,
      href: `/project-management/rfq?project=${encodeURIComponent(mappingId)}`,
      title: "RFQ",
      description: mapping
        ? `Request vendor quotations for ${mapping.projectName}.`
        : "Request and compare vendor quotations for indents.",
      icon: FileSearch,
      gradient: "from-violet-500 to-purple-600",
    },
    {
      show: canViewPurchaseOrders,
      href: `/project-management/purchase-orders?project=${encodeURIComponent(mappingId)}`,
      title: "Purchase Orders",
      description: mapping
        ? `Create and track purchase orders for ${mapping.projectName}.`
        : "Create and track purchase orders against vendors.",
      icon: ShoppingCart,
      gradient: "from-emerald-500 to-teal-600",
    },
    {
      show: canViewDrawing,
      href: `/project-management/drawing?project=${encodeURIComponent(mappingId)}`,
      title: "Drawing",
      description: mapping
        ? `Track drawings for ${mapping.projectName}.`
        : "Track drawings for this project.",
      icon: PenTool,
      gradient: "from-slate-500 to-slate-700",
    },
    {
      show: canViewManufacturingClearance,
      href: `/project-management/manufacturing-clearance?project=${encodeURIComponent(mappingId)}`,
      title: "Manufacturing Clearance",
      description: mapping
        ? `Track manufacturing clearance for ${mapping.projectName}.`
        : "Track manufacturing clearance for this project.",
      icon: Factory,
      gradient: "from-lime-500 to-green-600",
    },
    {
      show: canViewInspections,
      href: `/project-management/inspections?project=${encodeURIComponent(mappingId)}`,
      title: "Inspections",
      description: mapping
        ? `Track inspections for ${mapping.projectName}.`
        : "Track inspections for this project.",
      icon: ClipboardCheck,
      gradient: "from-blue-500 to-indigo-600",
    },
    {
      show: canViewMdcc,
      href: `/project-management/mdcc?project=${encodeURIComponent(mappingId)}`,
      title: "MDCC",
      description: mapping
        ? `Track MDCC for ${mapping.projectName}.`
        : "Track MDCC for this project.",
      icon: BadgeCheck,
      gradient: "from-fuchsia-500 to-purple-600",
    },
    {
      show: canViewMvac,
      href: `/project-management/mvac?project=${encodeURIComponent(mappingId)}`,
      title: "MVAC",
      description: mapping
        ? `Track MVAC for ${mapping.projectName}.`
        : "Track MVAC for this project.",
      icon: Gauge,
      gradient: "from-teal-500 to-cyan-600",
    },
  ].filter((link) => link.show);

  if (isAuthLoading || isLoading) {
    return (
      <main className="min-h-[calc(100vh-4rem)] space-y-5 p-4 sm:p-6">
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
      <main className="min-h-[calc(100vh-4rem)] p-4 sm:p-6">
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
      <main className="min-h-[calc(100vh-4rem)] p-4 sm:p-6">
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
    <main className="min-h-[calc(100vh-4rem)] space-y-5 p-4 sm:p-6">
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
          <p className="text-sm text-muted-foreground">Supply chain workflow for {mapping.projectName}.</p>
        </div>
      </div>

      {quickLinks.length ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {quickLinks.map((link) => (
            <Link key={link.title} href={link.href} className="group no-underline">
              <Card className="h-full overflow-hidden border-border/60 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
                <div className={cn("h-1 w-full bg-gradient-to-r", link.gradient)} />
                <CardContent className="flex items-center gap-2.5 p-3">
                  <div
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br shadow-sm",
                      link.gradient,
                    )}
                  >
                    <link.icon className="h-4 w-4 text-white" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold leading-tight">{link.title}</p>
                    <p className="truncate text-xs text-muted-foreground">{link.description}</p>
                  </div>
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1" />
                </CardContent>
              </Card>
            </Link>
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
