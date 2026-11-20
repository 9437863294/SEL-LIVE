"use client";

/**
 * MVAC's frame: the shared `ModuleShell` sidebar (desktop) and bottom bar (phone), over the
 * register loaded once for the whole module.
 *
 * MVAC was two pages reached from the Supply hub. It now has as many screens as the other sidebar
 * modules — a dashboard, a configurable run of workflow stages, the register, reports and settings
 * — so it navigates like them.
 *
 * The workflow stages are configured per installation, so the sidebar's middle group is built from
 * `workflows/pm-mvac-workflow` rather than written out here, and each stage carries the number of
 * certificates waiting on it. With no workflow configured the group is empty and the module still
 * works: certificates are raised and signed off on the register, as they were before.
 */

import { useMemo, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, ClipboardCheck, GitMerge, LayoutDashboard } from "lucide-react";
import { useAuthorization } from "@/hooks/useAuthorization";
import {
  PM_MVAC_PERMISSION_RESOURCE,
  mvacParentHref,
  mvacStagePath,
  mvacTabHref,
} from "@/lib/project-management-mvac-module";
import { supplyStage } from "@/lib/project-management-supply-ledger";
import { useSupplyProject } from "@/components/project-management/supply-document-screens";
import {
  MVAC_TABS,
  MvacRegisterProvider,
  useMvacRegister,
  type MvacTabKey,
} from "@/components/mvac/mvac-shell";
import {
  ModuleShell,
  type ModuleNavGroup,
  type ModuleNavItem,
  type ModuleNavTab,
} from "@/components/shared/module-shell";

const tabFor = (key: MvacTabKey) => MVAC_TABS.find((tab) => tab.key === key)!;

function MvacModuleFrame({
  mappingId,
  canView,
  isAuthLoading,
  allowed,
  children,
}: {
  mappingId: string;
  canView: boolean;
  isAuthLoading: boolean;
  allowed: { raise: boolean; reports: boolean; settings: boolean };
  children: ReactNode;
}) {
  // The shared register (the provider below), so the stage counts cost no read of their own.
  const { projectName, reading } = useMvacRegister();

  const groups = useMemo<ModuleNavGroup[]>(() => {
    const item = (key: MvacTabKey, extra: Partial<ModuleNavItem> = {}): ModuleNavItem => {
      const tab = tabFor(key);
      return {
        id: tab.key,
        label: tab.label,
        href: mvacTabHref(tab.path, mappingId),
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
          href: mvacTabHref(mvacStagePath(stage.id), mappingId),
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
          item("new", { visible: allowed.raise }),
          item("documents"),
          item("reports", { visible: allowed.reports }),
        ],
      },
      { id: "setup", items: [item("settings", { visible: allowed.settings })] },
    ];
  }, [mappingId, reading.stages, allowed]);

  const mobileTabs: ModuleNavTab[] = [
    { href: mvacTabHref("", mappingId), label: "Home", icon: LayoutDashboard, exact: true },
    {
      href: mvacTabHref("documents", mappingId),
      label: "Register",
      icon: tabFor("documents").icon,
    },
    ...(allowed.raise
      ? [
          {
            href: mvacTabHref("new", mappingId),
            label: "New",
            icon: tabFor("new").icon,
            emphasized: true,
            ariaLabel: "Raise an MVAC",
          } satisfies ModuleNavTab,
        ]
      : []),
    { href: mvacTabHref("reports", mappingId), label: "Reports", icon: tabFor("reports").icon },
  ];

  return (
    <ModuleShell
      title="MVAC"
      subtitle={projectName || "Project Management"}
      icon={ClipboardCheck}
      groups={groups}
      mobileTabs={mobileTabs}
      gate={{
        loading: isAuthLoading,
        allowed: canView,
        deniedMessage: "You do not have permission to access MVAC.",
      }}
      footer={
        <Link
          href={mvacParentHref(mappingId)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Back to Supply Chain
        </Link>
      }
    >
      {children}
    </ModuleShell>
  );
}

export default function MvacModuleLayoutShell({ children }: { children: ReactNode }) {
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { globalProjectId, projectName } = useSupplyProject(mappingId);
  const { can, isLoading } = useAuthorization();

  const check = (action: string) => {
    if (isLoading) return false;
    try {
      return can(action, PM_MVAC_PERMISSION_RESOURCE);
    } catch {
      return false;
    }
  };

  const canView = check("View");
  const allowed = {
    // The same two actions the register has always answered to, so nobody's access changes.
    raise: check(supplyStage("mvac").raiseAction),
    reports: check("View Reports"),
    settings: check("View Settings"),
  };

  return (
    <MvacRegisterProvider
      globalProjectId={globalProjectId}
      canRead={canView}
      projectName={projectName}
    >
      <MvacModuleFrame
        mappingId={mappingId}
        canView={canView}
        isAuthLoading={isLoading}
        allowed={allowed}
      >
        {children}
      </MvacModuleFrame>
    </MvacRegisterProvider>
  );
}
