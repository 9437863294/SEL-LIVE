"use client";

import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  ClipboardList,
  FolderCog,
  Settings2,
  ShieldAlert,
  SlidersHorizontal,
} from "lucide-react";
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

const SETTINGS_PERMISSION = "Project Management.Settings";

const settingsSections = [
  {
    title: "Manage Projects",
    description: "Create Project Management projects and map them to global projects.",
    href: "/project-management/settings/projects",
    icon: FolderCog,
    gradient: "from-indigo-500 to-blue-600",
  },
  {
    title: "General Settings",
    description: "Configure general defaults for Project Management.",
    href: "/project-management/settings/general",
    icon: Settings2,
    gradient: "from-slate-500 to-slate-700",
  },
  {
    title: "BOQ Settings",
    description: "Configure BOQ behavior, defaults, and future custom fields.",
    href: "/project-management/settings/boq",
    icon: ClipboardList,
    gradient: "from-violet-500 to-purple-600",
  },
  {
    title: "Field Control",
    description: "Show, hide, rename, or require fields across BOQ, Indent, RFQ, PO, and project mapping forms.",
    href: "/project-management/settings/field-control",
    icon: SlidersHorizontal,
    gradient: "from-indigo-500 to-blue-600",
  },
];

export default function ProjectManagementSettingsPage() {
  const { can, isLoading } = useAuthorization();

  if (isLoading) {
    return (
      <main className="min-h-[calc(100dvh-4rem)] space-y-5 p-4 sm:p-6">
        <Skeleton className="h-24 w-full rounded-xl" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      </main>
    );
  }

  if (!can("View", SETTINGS_PERMISSION)) {
    return (
      <main className="min-h-[calc(100dvh-4rem)] p-4 sm:p-6">
        <h1 className="mb-6 text-2xl font-bold sm:text-3xl">
          Project Management Settings
        </h1>
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>
              You do not have permission to access Project Management settings.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center p-8">
            <ShieldAlert className="h-16 w-16 text-destructive" />
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-[calc(100dvh-4rem)] space-y-5 p-4 sm:p-6">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <Card className="relative overflow-hidden border-0 bg-gradient-to-r from-slate-700 via-slate-600 to-slate-500 text-white shadow-lg">
        <div className="absolute inset-0 opacity-10 bg-[radial-gradient(ellipse_at_top_right,_white_0%,_transparent_60%)]" />
        <CardContent className="relative flex items-center gap-4 p-5">
          <Button variant="ghost" size="icon" asChild className="shrink-0 text-white hover:bg-white/20 hover:text-white">
            <Link href="/project-management" aria-label="Back to Project Management">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/20 backdrop-blur-sm">
            <Settings2 className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Project Management Settings</h1>
            <p className="mt-0.5 text-sm text-slate-200">
              Manage projects and configure module-wide behavior
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ── Sections ─────────────────────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
        {settingsSections.map((section) => {
          const Icon = section.icon;

          return (
            <Link key={section.href} href={section.href} className="group no-underline">
              <Card className="h-full overflow-hidden border-border/60 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
                <div className={cn("h-1 w-full bg-gradient-to-r", section.gradient)} />
                <CardContent className="flex items-center gap-2.5 p-3">
                  <div
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br shadow-sm",
                      section.gradient,
                    )}
                  >
                    <Icon className="h-4 w-4 text-white" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold leading-tight">{section.title}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {section.description}
                    </p>
                  </div>
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1" />
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </main>
  );
}
