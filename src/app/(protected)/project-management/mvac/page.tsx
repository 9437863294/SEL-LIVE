"use client";

/**
 * Project Management's MVAC dashboard — the module's landing screen.
 *
 * This file turns the shared register into the dashboard's props and answers the permission
 * questions; the screen itself is `MvacDashboardView`. Navigation between the MVAC screens is the
 * module sidebar's job (`layout.tsx`), so nothing here lists pages.
 */

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import {
  ClipboardCheck,
  FileCheck2,
  GitMerge,
  HandshakeIcon,
  PackageCheck,
  Truck,
  type LucideIcon,
} from "lucide-react";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useBackNavigation } from "@/hooks/use-back-navigation";
import { useMvacRegister } from "@/components/mvac/mvac-shell";
import {
  MvacDashboardView,
  type MvacDashboardStage,
  type MvacRecentCertificate,
} from "@/components/mvac/mvac-dashboard-view";
import {
  PM_MVAC_PERMISSION_RESOURCE,
  mvacParentHref,
  mvacStagePath,
  mvacTabHref,
} from "@/lib/project-management-mvac-module";
import { supplyStage } from "@/lib/project-management-supply-ledger";
import {
  mvacDocTotals,
  mvacRaisedOn,
  mvacStagePosition,
  type MvacItemLike,
} from "@/lib/project-management-mvac-dashboard";

/**
 * A stage's icon, chosen from its configured name.
 *
 * The workflow is configurable, so the stage names are whatever this installation calls them —
 * there is no fixed list to map. Matching on the verb in the name gives a meaningful icon for the
 * stages every site has, and a neutral one for anything else.
 */
const STAGE_ICONS: ReadonlyArray<{ match: RegExp; icon: LucideIcon }> = [
  { match: /receiv|deliver|material|store/i, icon: Truck },
  { match: /verif|check|inspect|review/i, icon: ClipboardCheck },
  { match: /joint|client|witness/i, icon: HandshakeIcon },
  { match: /accept|sign|approv/i, icon: FileCheck2 },
  { match: /close|complete|final/i, icon: PackageCheck },
];

const stageIcon = (name: string): LucideIcon =>
  STAGE_ICONS.find((entry) => entry.match.test(name))?.icon ?? GitMerge;

const formatDate = (value: Date | null): string =>
  value
    ? `${String(value.getDate()).padStart(2, "0")}-${String(value.getMonth() + 1).padStart(2, "0")}-${value.getFullYear()}`
    : "—";

export default function MvacDashboardPage() {
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const back = useBackNavigation(mvacParentHref(mappingId), {
    fallbackLabel: "Back to Supply Chain",
  });
  const { can, isLoading: authIsLoading } = useAuthorization();
  const { projectName, steps, docs, items, reading, isLoading, loadError } = useMvacRegister();

  const canCreate = useMemo(() => {
    if (authIsLoading) return false;
    try {
      return can(supplyStage("mvac").raiseAction, PM_MVAC_PERMISSION_RESOURCE);
    } catch {
      return false;
    }
  }, [authIsLoading, can]);

  const stages: MvacDashboardStage[] = useMemo(
    () =>
      reading.stages.map((stage) => ({
        ...stage,
        href: mvacTabHref(mvacStagePath(stage.id), mappingId),
        icon: stageIcon(stage.name),
      })),
    [reading.stages, mappingId],
  );

  /** The five most recently raised, with where each one currently sits. */
  const recent: MvacRecentCertificate[] = useMemo(() => {
    const itemsByDoc = new Map<string, MvacItemLike[]>();
    for (const item of items) {
      const docId = String(item.docId ?? "");
      if (!docId) continue;
      const list = itemsByDoc.get(docId);
      if (list) list.push(item);
      else itemsByDoc.set(docId, [item]);
    }

    return [...docs]
      .sort(
        (a, b) =>
          (mvacRaisedOn(b)?.getTime() ?? 0) - (mvacRaisedOn(a)?.getTime() ?? 0) ||
          String(b.docNumber ?? "").localeCompare(String(a.docNumber ?? "")),
      )
      .slice(0, 5)
      .map((doc) => {
        const totals = mvacDocTotals(itemsByDoc.get(doc.id) ?? []);
        const position = mvacStagePosition(doc, steps);
        const status = String(doc.status ?? "");
        return {
          id: doc.id,
          docNumber: String(doc.docNumber ?? ""),
          date: formatDate(mvacRaisedOn(doc)),
          presented: totals.presented,
          accepted: totals.accepted,
          vendorName: String(doc.vendorName ?? "Several vendors"),
          stage:
            status === "Draft" || status === "Cancelled"
              ? status
              : steps.length === 0
                ? status || "Open"
                : position >= steps.length
                  ? "Through every stage"
                  : `Waiting at ${steps[position]!.name}`,
        };
      });
  }, [docs, items, steps]);

  return (
    <MvacDashboardView
      back={back}
      crumbs={[{ label: "Supply Chain", href: mvacParentHref(mappingId) }]}
      projectName={projectName}
      description={
        projectName
          ? `Joint acceptance of material received on ${projectName} — where each certificate stands, and how much has been accepted.`
          : "Joint acceptance of material received at site — where each certificate stands, and how much has been accepted."
      }
      reading={reading}
      stages={stages}
      recent={recent}
      registerHref={mvacTabHref("documents", mappingId)}
      create={canCreate && mappingId ? { href: mvacTabHref("new", mappingId) } : undefined}
      isLoading={isLoading || authIsLoading}
      loadError={loadError}
    />
  );
}
