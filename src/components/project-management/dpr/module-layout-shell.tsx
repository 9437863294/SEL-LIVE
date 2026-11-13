"use client";

/**
 * Daily Progress's frame: the shared `ModuleShell` sidebar (desktop) and bottom bar (phone), over
 * the register loaded once for the whole module.
 *
 * Every screen is project-scoped through `?project={mappingId}`, so each sidebar entry carries the
 * project on. The register is loaded here (`DprDataProvider`) rather than by each screen, so moving
 * between Dashboard, Projections, Record and the rest is instant instead of re-reading the BOQ,
 * every sheet and every projection each time.
 */

import { useMemo, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Activity, ArrowLeft, LayoutDashboard } from "lucide-react";
import { useAuthorization } from "@/hooks/useAuthorization";
import { DPR_PERMISSION_RESOURCE, DPR_SCOPES } from "@/lib/project-management-dpr";
import { DprDataProvider, useDprData } from "@/components/project-management/dpr/use-dpr-data";
import { DPR_TABS, dprHref, todayIso, type DprTabKey } from "@/components/project-management/dpr/dpr-shell";
import {
  ModuleShell,
  type ModuleNavGroup,
  type ModuleNavItem,
  type ModuleNavTab,
} from "@/components/shared/module-shell";

const GROUPS: Array<{ id: string; label?: string; keys: DprTabKey[] }> = [
  { id: "home", keys: ["dashboard"] },
  { id: "work", label: "Daily work", keys: ["record", "projections"] },
  { id: "review", label: "Review", keys: ["log", "reports"] },
  { id: "setup", keys: ["settings"] },
];

function DprModuleFrame({
  mappingId,
  canView,
  isAuthLoading,
  children,
}: {
  mappingId: string;
  canView: boolean;
  isAuthLoading: boolean;
  children: ReactNode;
}) {
  // The shared register (the provider above), so these figures cost no read of their own.
  const { projectName, boqItems, entries } = useDprData(mappingId, canView);

  /** Scopes this project progresses that have no sheet at all for today. */
  const unrecordedToday = useMemo(() => {
    const today = todayIso();
    return DPR_SCOPES.filter(
      (scope) =>
        boqItems.some((item) => item.scope === scope) &&
        !entries.some((entry) => entry.date === today && entry.scope === scope),
    ).length;
  }, [boqItems, entries]);

  const groups = useMemo<ModuleNavGroup[]>(
    () =>
      GROUPS.map((group) => ({
        id: group.id,
        label: group.label,
        items: group.keys.map((key): ModuleNavItem => {
          const tab = DPR_TABS.find((candidate) => candidate.key === key)!;
          return {
            id: tab.key,
            label: tab.navLabel ?? tab.label,
            href: dprHref(tab.path, mappingId),
            icon: tab.icon,
            tone: tab.tone,
            match: key === "dashboard" ? "exact" : "prefix",
            badge: key === "record" && unrecordedToday > 0 ? unrecordedToday : null,
          };
        }),
      })),
    [mappingId, unrecordedToday],
  );

  const tab = (key: DprTabKey, label: string, extra: Partial<ModuleNavTab> = {}): ModuleNavTab => {
    const source = DPR_TABS.find((candidate) => candidate.key === key)!;
    return { href: dprHref(source.path, mappingId), label, icon: source.icon, ...extra };
  };
  const mobileTabs: ModuleNavTab[] = [
    tab("dashboard", "Home", { icon: LayoutDashboard, exact: true }),
    tab("projections", "Plan"),
    tab("record", "Record", {
      emphasized: true,
      ariaLabel: "Record today's progress",
      badge: unrecordedToday > 0 ? unrecordedToday : undefined,
    }),
    tab("log", "Log"),
  ];

  return (
    <ModuleShell
      title="Daily Progress"
      subtitle={projectName || "Project Management"}
      icon={Activity}
      groups={groups}
      mobileTabs={mobileTabs}
      gate={{
        loading: isAuthLoading,
        allowed: canView,
        deniedMessage: "You do not have permission to view daily progress.",
      }}
      footer={
        <Link
          href={dprHref("/project-management", mappingId)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Back to Project Management
        </Link>
      }
    >
      {children}
    </ModuleShell>
  );
}

export default function DprModuleLayoutShell({ children }: { children: ReactNode }) {
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { can, isLoading } = useAuthorization();
  const canView = !isLoading && can("View", DPR_PERMISSION_RESOURCE);

  return (
    <DprDataProvider mappingId={mappingId} canRead={canView}>
      <DprModuleFrame mappingId={mappingId} canView={canView} isAuthLoading={isLoading}>
        {children}
      </DprModuleFrame>
    </DprDataProvider>
  );
}
