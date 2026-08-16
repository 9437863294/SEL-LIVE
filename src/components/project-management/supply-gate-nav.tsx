"use client";

import Link from "next/link";
import { BadgeCheck, ClipboardCheck, Factory, FileCheck2, PackageCheck, ShoppingCart, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The seven stages a manufactured BOQ item moves through after being placed on a PO — shown as a
 * consistent cross-link bar on each stage's own page (and on the PO detail page) so moving
 * between them doesn't require going back through the Supply hub every time.
 */
const STAGES = [
  { key: "purchase-orders", href: "/project-management/purchase-orders", label: "Purchase Orders", icon: ShoppingCart },
  { key: "manufacturing-clearance", href: "/project-management/manufacturing-clearance", label: "Manufacturing Clearance", icon: Factory },
  { key: "inspections", href: "/project-management/inspections", label: "Inspections", icon: ClipboardCheck },
  { key: "mdcc", href: "/project-management/mdcc", label: "MDCC", icon: BadgeCheck },
  { key: "dispatch-instructions", href: "/project-management/dispatch-instructions", label: "Dispatch Instructions", icon: Truck },
  { key: "grn", href: "/project-management/grn", label: "GRN", icon: PackageCheck },
  { key: "mvac", href: "/project-management/mvac", label: "MVAC", icon: FileCheck2 },
] as const;

export function SupplyGateNav({ mappingId, active }: { mappingId: string; active: (typeof STAGES)[number]["key"] }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {STAGES.map((stage) => {
        const Icon = stage.icon;
        const isActive = stage.key === active;
        return (
          <Button
            key={stage.key}
            variant={isActive ? "default" : "outline"}
            size="sm"
            asChild
            className={cn(isActive && "pointer-events-none")}
          >
            <Link href={`${stage.href}?project=${encodeURIComponent(mappingId)}`}>
              <Icon className="mr-1.5 h-3.5 w-3.5" />
              {stage.label}
            </Link>
          </Button>
        );
      })}
    </div>
  );
}
