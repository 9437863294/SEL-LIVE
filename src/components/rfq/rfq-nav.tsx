"use client";

/**
 * The RFQ screens as one consistent cross-link bar, mirroring JmcNav, SurveyNav and IndentNav.
 *
 * Links are built through the host context, so every one carries the `?project=` handle forward.
 */

import { FilePlus2, LayoutGrid, Settings, Table2 } from "lucide-react";
import { PillNav } from "@/components/shared/pill-nav";
import type { PmRfqContext } from "@/lib/project-management-rfq-workflow";

const SCREENS = [
  { key: "hub", suffix: undefined, label: "RFQ", icon: LayoutGrid },
  { key: "register", suffix: "register", label: "RFQ Register", icon: Table2 },
  { key: "new", suffix: "new", label: "New RFQ", icon: FilePlus2 },
  { key: "settings", suffix: "settings", label: "Settings", icon: Settings },
] as const;

export type RfqNavKey = (typeof SCREENS)[number]["key"];

export function RfqNav({
  context,
  active,
  /** Screens the current user may not open — rendered disabled rather than hidden, so the bar
   * keeps a stable shape between users. */
  hidden = [],
}: {
  context: PmRfqContext;
  active: RfqNavKey;
  hidden?: RfqNavKey[];
}) {
  return (
    <PillNav
      label="RFQ screens"
      active={active}
      gradient="from-violet-600 to-fuchsia-600"
      items={SCREENS.filter((screen) => !hidden.includes(screen.key)).map((screen) => ({
        key: screen.key,
        label: screen.label,
        icon: screen.icon,
        href: context.rfqHref(screen.suffix),
      }))}
    />
  );
}
