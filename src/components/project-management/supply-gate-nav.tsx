"use client";

import { BadgeCheck, ClipboardCheck, Factory, FileCheck2, PackageCheck, ShoppingCart, Truck } from "lucide-react";
import { PmDocumentChain, type PmChainStage } from "@/components/project-management/pm-shell";

/**
 * The seven stages a manufactured BOQ item moves through after being placed on a PO — shown as a
 * consistent cross-link bar on each stage's own page (and on the PO detail page) so moving
 * between them doesn't require going back through the Supply hub every time.
 *
 * Rendered as a numbered document chain rather than a flat pill row. The gates are a *sequence*,
 * and equal pills said nothing about which comes before which — which is the first thing somebody
 * chasing a stuck item needs to know. Each stage keeps its own accent so seven similarly-worded
 * gates stay tellable apart at a glance.
 */
const STAGES = [
  // The register, not the PO hub: this bar exists to move between the stages' working screens, and
  // the hub would add a click for anyone crossing from another gate.
  {
    key: "purchase-orders",
    href: "/project-management/purchase-orders/register",
    label: "Purchase Orders",
    icon: ShoppingCart,
    color: "text-emerald-700",
    bg: "bg-emerald-100",
    border: "border-emerald-500",
  },
  // The register, for the same reason as purchase-orders above.
  {
    key: "manufacturing-clearance",
    href: "/project-management/manufacturing-clearance/register",
    label: "Manufacturing Clearance",
    icon: Factory,
    color: "text-amber-700",
    bg: "bg-amber-100",
    border: "border-amber-500",
  },
  // The register, for the same reason as the two above.
  {
    key: "inspections",
    href: "/project-management/inspections/register",
    label: "Inspections",
    icon: ClipboardCheck,
    color: "text-sky-700",
    bg: "bg-sky-100",
    border: "border-sky-500",
  },
  {
    key: "mdcc",
    href: "/project-management/mdcc",
    label: "MDCC",
    icon: BadgeCheck,
    color: "text-violet-700",
    bg: "bg-violet-100",
    border: "border-violet-500",
  },
  {
    key: "dispatch-instructions",
    href: "/project-management/dispatch-instructions",
    label: "Dispatch Instructions",
    icon: Truck,
    color: "text-orange-700",
    bg: "bg-orange-100",
    border: "border-orange-500",
  },
  {
    key: "grn",
    href: "/project-management/grn",
    label: "GRN",
    icon: PackageCheck,
    color: "text-cyan-700",
    bg: "bg-cyan-100",
    border: "border-cyan-500",
  },
  {
    key: "mvac",
    href: "/project-management/mvac",
    label: "MVAC",
    icon: FileCheck2,
    color: "text-rose-700",
    bg: "bg-rose-100",
    border: "border-rose-500",
  },
] as const;

export type SupplyGateKey = (typeof STAGES)[number]["key"];

export function SupplyGateNav({
  mappingId,
  active,
  /**
   * Row counts per gate, when the page happens to know them. Omitted keys render without a number
   * rather than as `0` — a page that has not read a gate's register cannot tell "none" from
   * "not loaded", and a confident zero is worse than no figure at all.
   */
  counts,
}: {
  mappingId: string;
  active: SupplyGateKey;
  counts?: Partial<Record<SupplyGateKey, number>>;
}) {
  const stages: PmChainStage[] = STAGES.map((stage) => ({
    key: stage.key,
    label: stage.label,
    href: `${stage.href}?project=${encodeURIComponent(mappingId)}`,
    color: stage.color,
    bg: stage.bg,
    border: stage.border,
    count: counts?.[stage.key],
  }));

  return <PmDocumentChain label="Supply stages" stages={stages} active={active} />;
}
