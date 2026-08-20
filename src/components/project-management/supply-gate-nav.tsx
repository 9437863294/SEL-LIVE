"use client";

import { BadgeCheck, ClipboardCheck, Factory, FileCheck2, PackageCheck, ShoppingCart, Truck } from "lucide-react";
import { PillNav } from "@/components/shared/pill-nav";

/**
 * The seven stages a manufactured BOQ item moves through after being placed on a PO — shown as a
 * consistent cross-link bar on each stage's own page (and on the PO detail page) so moving
 * between them doesn't require going back through the Supply hub every time.
 */
const STAGES = [
  // The register, not the PO hub: this bar exists to move between the stages' working screens, and
  // the hub would add a click for anyone crossing from another gate.
  { key: "purchase-orders", href: "/project-management/purchase-orders/register", label: "Purchase Orders", icon: ShoppingCart },
  // The register, for the same reason as purchase-orders above.
  { key: "manufacturing-clearance", href: "/project-management/manufacturing-clearance/register", label: "Manufacturing Clearance", icon: Factory },
  // The register, for the same reason as the two above.
  { key: "inspections", href: "/project-management/inspections/register", label: "Inspections", icon: ClipboardCheck },
  { key: "mdcc", href: "/project-management/mdcc", label: "MDCC", icon: BadgeCheck },
  { key: "dispatch-instructions", href: "/project-management/dispatch-instructions", label: "Dispatch Instructions", icon: Truck },
  { key: "grn", href: "/project-management/grn", label: "GRN", icon: PackageCheck },
  { key: "mvac", href: "/project-management/mvac", label: "MVAC", icon: FileCheck2 },
] as const;

export function SupplyGateNav({ mappingId, active }: { mappingId: string; active: (typeof STAGES)[number]["key"] }) {
  return (
    <PillNav
      label="Supply stages"
      active={active}
      gradient="from-violet-600 to-purple-600"
      items={STAGES.map((stage) => ({
        key: stage.key,
        label: stage.label,
        icon: stage.icon,
        href: `${stage.href}?project=${encodeURIComponent(mappingId)}`,
      }))}
    />
  );
}
