"use client";

/**
 * A BOQ line's description as it sits in the work breakdown: indented by its depth with a small
 * branch mark, on one line, and the lines above it in the tooltip ("7 Earthing system › 7.2 GI
 * strip › Welding"). A plain BOQ line (depth 0) reads exactly as it did before sub-items existed.
 */

import { CornerDownRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** The tooltip for a line: its parents, then its own description. */
export const breakdownTitle = (item: { description?: string; path?: string }): string =>
  item.path ? `${item.path} › ${item.description ?? ""}` : (item.description ?? "");

/** Just the branch mark, for a cell whose content (a picker, an input) is not plain text. */
export function DprBranchMark() {
  return <CornerDownRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />;
}

export function DprIndentedText({
  text,
  depth = 0,
  strong = false,
  className,
}: {
  text: string;
  depth?: number;
  strong?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn("flex min-w-0 items-center gap-1", strong && "font-semibold", className)}
      style={depth > 0 ? { paddingLeft: depth * 16 } : undefined}
    >
      {depth > 0 ? (
        <CornerDownRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      ) : null}
      <span className="min-w-0 truncate">{text || "BOQ line"}</span>
    </span>
  );
}
