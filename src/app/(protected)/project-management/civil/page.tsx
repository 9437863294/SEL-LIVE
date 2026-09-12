"use client";

/**
 * Civil hub — the same shape as the Supply hub: a header and a grid of tiles, one per screen this
 * scope actually works from.
 *
 * The work-package register, its progress tiles and the subcontract coverage table used to live at
 * this path. Civil execution is measured through JMC, which is where the quantities and the money
 * already are, so the hub points at that rather than maintaining a second, parallel progress record
 * alongside it.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, Building2, Ruler, ShieldAlert } from "lucide-react";
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
import { PM_JMC_BASE_PATH } from "@/lib/jmc-module";

const MODULE_NAME = "Project Management";
const PERMISSION_RESOURCE = `${MODULE_NAME}.Civil`;

type ProjectMapping = {
  id: string;
  projectName: string;
};

export default function CivilPage() {
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { can, isLoading: isAuthLoading } = useAuthorization();

  const canViewBoq = can("View", `${MODULE_NAME}.BOQ`);
  const canView = can("View", PERMISSION_RESOURCE) || canViewBoq;
  // JMC is hosted by both modules against the same registers, so either view right opens it.
  const canViewJmc = can("View", `${MODULE_NAME}.JMC`) || can("View", "Billing Recon.JMC");

  const [mapping, setMapping] = useState<ProjectMapping | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (isAuthLoading || !canView || !mappingId) {
      setIsLoading(false);
      return;
    }
    const load = async () => {
      setIsLoading(true);
      try {
        const snapshot = await getDoc(doc(db, "projectManagementProjects", mappingId));
        setMapping(
          snapshot.exists()
            ? { id: snapshot.id, projectName: snapshot.data().projectName }
            : null,
        );
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
      show: canViewJmc,
      href: `${PM_JMC_BASE_PATH}?project=${encodeURIComponent(mappingId)}`,
      title: "JMC",
      description: mapping
        ? `Joint measurement certificates for ${mapping.projectName} — executed and certified quantity.`
        : "Joint measurement certificates — executed and certified quantity.",
      icon: Ruler,
      gradient: "from-emerald-500 to-green-600",
    },
  ].filter((link) => link.show);

  if (isAuthLoading || isLoading) {
    return (
      <main className="min-h-[calc(100dvh-4rem)] space-y-5 p-4 sm:p-6">
        <Skeleton className="h-9 w-64" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {[1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-24 rounded-xl" />
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
            <CardDescription>
              Return to Project Management and choose a project before opening Civil.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/project-management">Select Project</Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-[calc(100dvh-4rem)] space-y-5 p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link
            href={`/project-management?project=${encodeURIComponent(mappingId)}`}
            aria-label="Back to Project Management"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-stone-500 to-stone-700 shadow-sm">
          <Building2 className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Civil</h1>
          <p className="text-sm text-muted-foreground">
            Civil scope for {mapping.projectName}.
          </p>
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
        <Card>
          <CardHeader>
            <CardTitle>Nothing available</CardTitle>
            <CardDescription>
              You do not have permission for any Civil screen on this project.
            </CardDescription>
          </CardHeader>
        </Card>
      )}
    </main>
  );
}
