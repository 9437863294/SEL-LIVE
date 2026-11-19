"use client";

/**
 * JMC's frame: the shared `ModuleShell` sidebar (desktop) and bottom bar (phone), over the register
 * loaded once for the whole module.
 *
 * The module used to be a page of link cards with every screen reached through it and a back arrow
 * to return. It has as many screens as the other sidebar modules — a dashboard, a configurable run
 * of workflow stages, the log, reports and settings — so it navigates like them.
 *
 * The workflow stages are configured per installation, so the sidebar's middle group is built from
 * `workflows/jmc-workflow` rather than written out here, and each stage carries the number of
 * certificates waiting on it. Settings gets one entry, never one per settings card.
 */

import { useMemo, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, ClipboardList, GitMerge, LayoutDashboard } from "lucide-react";
import { useAuthorization } from "@/hooks/useAuthorization";
import { PM_JMC_PERMISSION_RESOURCE } from "@/lib/jmc-module";
import { useProjectManagementJmcContext } from "@/components/jmc/use-jmc-host-context";
import {
  JMC_TABS,
  JmcRegisterProvider,
  jmcStagePath,
  jmcTabHref,
  useJmcRegister,
  type JmcTabKey,
} from "@/components/jmc/jmc-shell";
import {
  ModuleShell,
  type ModuleNavGroup,
  type ModuleNavItem,
  type ModuleNavTab,
} from "@/components/shared/module-shell";

const tabFor = (key: JmcTabKey) => JMC_TABS.find((tab) => tab.key === key)!;

function JmcModuleFrame({
  mappingId,
  canView,
  isAuthLoading,
  allowed,
  children,
}: {
  mappingId: string;
  canView: boolean;
  isAuthLoading: boolean;
  allowed: { create: boolean; log: boolean; reports: boolean; settings: boolean };
  children: ReactNode;
}) {
  // The shared register (the provider below), so the stage counts cost no read of their own.
  const { projectName, reading } = useJmcRegister();

  const groups = useMemo<ModuleNavGroup[]>(() => {
    const item = (key: JmcTabKey, extra: Partial<ModuleNavItem> = {}): ModuleNavItem => {
      const tab = tabFor(key);
      return {
        id: tab.key,
        label: tab.label,
        href: jmcTabHref(tab.path, mappingId),
        icon: tab.icon,
        tone: tab.tone,
        match: key === "dashboard" ? "exact" : "prefix",
        ...extra,
      };
    };

    return [
      { id: "home", items: [item("dashboard")] },
      {
        id: "workflow",
        label: "Workflow",
        items: reading.stages.map((stage) => ({
          id: `stage-${stage.id}`,
          label: stage.name,
          href: jmcTabHref(jmcStagePath(stage.id), mappingId),
          icon: GitMerge,
          tone: "cyan",
          match: "prefix",
          // What is actually sitting on this desk, not how many have ever passed through it.
          badge: stage.waiting > 0 ? stage.waiting : null,
        })),
      },
      {
        id: "records",
        label: "Records",
        items: [
          item("log", { visible: allowed.log }),
          item("reports", { visible: allowed.reports }),
        ],
      },
      { id: "setup", items: [item("settings", { visible: allowed.settings })] },
    ];
  }, [mappingId, reading.stages, allowed]);

  const mobileTabs: ModuleNavTab[] = [
    {
      href: jmcTabHref("", mappingId),
      label: "Home",
      icon: LayoutDashboard,
      exact: true,
    },
    { href: jmcTabHref("log", mappingId), label: "Log", icon: tabFor("log").icon },
    ...(allowed.create
      ? [
          {
            href: jmcTabHref("entry", mappingId),
            label: "New",
            icon: tabFor("entry").icon,
            emphasized: true,
            ariaLabel: "Create a JMC",
          } satisfies ModuleNavTab,
        ]
      : []),
    { href: jmcTabHref("reports", mappingId), label: "Reports", icon: tabFor("reports").icon },
  ];

  return (
    <ModuleShell
      title="JMC"
      subtitle={projectName || "Project Management"}
      icon={ClipboardList}
      groups={groups}
      mobileTabs={mobileTabs}
      gate={{
        loading: isAuthLoading,
        allowed: canView,
        deniedMessage: "You do not have permission to access JMC management.",
      }}
      footer={
        <Link
          href={mappingId ? `/project-management/civil?project=${encodeURIComponent(mappingId)}` : "/project-management"}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Back to Civil
        </Link>
      }
    >
      {children}
    </ModuleShell>
  );
}

export default function JmcModuleLayoutShell({ children }: { children: ReactNode }) {
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { context, projectName } = useProjectManagementJmcContext(mappingId);
  const { can, isLoading } = useAuthorization();

  const check = (action: string) => {
    if (isLoading) return false;
    try {
      return can(action, PM_JMC_PERMISSION_RESOURCE);
    } catch {
      return false;
    }
  };
  const canView = check("View");
  const allowed = {
    create: check("Create JMC Entry"),
    log: check("View Log"),
    reports: check("View Reports"),
    settings: check("View Settings"),
  };

  return (
    <JmcRegisterProvider
      mappingId={mappingId}
      globalProjectId={context.globalProjectId}
      canRead={canView}
      projectName={projectName}
    >
      <JmcModuleFrame
        mappingId={mappingId}
        canView={canView}
        isAuthLoading={isLoading}
        allowed={allowed}
      >
        {children}
      </JmcModuleFrame>
    </JmcRegisterProvider>
  );
}
