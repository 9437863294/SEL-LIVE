"use client";

/**
 * The cross-link bar every module nav renders: a segmented pill track with a single indicator that
 * slides to whichever pill is active, rather than each pill toggling its own filled background.
 *
 * One shared component so the supply gates, Purchase Orders, Manufacturing Clearance, Inspections,
 * Indent, RFQ, Survey and JMC bars stay visually identical — they were eight separate copies of the
 * same button row before, which is how they drifted.
 *
 * The indicator is measured from the live DOM rather than derived from the active index, because
 * the pills are label-width so their positions aren't knowable up front. It's positioned by writing
 * to the node's style directly instead of through React state: the position is a presentational
 * detail of an element React already owns, and routing it through state would re-render the whole
 * bar on every resize tick.
 */

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type PillNavItem = {
  key: string;
  label: string;
  href: string;
  icon: LucideIcon;
  /** Optional at-a-glance count, e.g. how many rows in that screen need attention. */
  count?: number;
};

const MOVE_CLASSES = ["transition-[transform,width]", "duration-300", "ease-out"];

export function PillNav({
  items,
  active,
  label,
  /** Tailwind gradient classes for the active indicator, e.g. `"from-violet-600 to-indigo-600"`. */
  gradient = "from-violet-600 to-indigo-600",
  className,
}: {
  items: PillNavItem[];
  active: string;
  /** Accessible name for the bar, e.g. "Supply stages". */
  label: string;
  gradient?: string;
  className?: string;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const indicatorRef = useRef<HTMLSpanElement | null>(null);
  const pillRefs = useRef(new Map<string, HTMLElement>());
  const hasPlaced = useRef(false);

  const positionIndicator = useCallback(() => {
    const indicator = indicatorRef.current;
    if (!indicator) return;
    const pill = pillRefs.current.get(active);
    if (!pill) {
      indicator.style.opacity = "0";
      return;
    }
    // offsetLeft shares the track's scrollable coordinate space, so the indicator stays glued to
    // its pill even when the bar is scrolled sideways.
    indicator.style.transform = `translateX(${pill.offsetLeft}px)`;
    indicator.style.width = `${pill.offsetWidth}px`;
    indicator.style.opacity = "1";

    if (!hasPlaced.current) {
      hasPlaced.current = true;
      // Reading a layout property flushes the position above before the transition classes land,
      // so the first paint shows the indicator already in place instead of sliding in from the
      // left edge. Every later move animates.
      void indicator.offsetWidth;
      indicator.classList.add(...MOVE_CLASSES);
    }
  }, [active]);

  useLayoutEffect(() => {
    positionIndicator();
  }, [positionIndicator, items.length]);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    // Labels reflow on resize and on late webfont load, so the indicator is re-measured rather
    // than pinned to wherever it first landed.
    const observer = new ResizeObserver(() => positionIndicator());
    observer.observe(track);
    pillRefs.current.forEach((pill) => observer.observe(pill));
    return () => observer.disconnect();
  }, [positionIndicator, items.length]);

  useEffect(() => {
    // With seven supply gates the active one can start off-screen on a narrow viewport.
    pillRefs.current.get(active)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);

  const registerPill = (key: string) => (node: HTMLElement | null) => {
    if (node) pillRefs.current.set(key, node);
    else pillRefs.current.delete(key);
  };

  return (
    <nav aria-label={label} className={cn("relative", className)}>
      <div
        ref={trackRef}
        className={cn(
          "relative flex items-center gap-1 overflow-x-auto rounded-full border border-border/60 bg-muted/40 p-1",
          // The track scrolls on small screens, but a visible scrollbar under a pill row reads as a
          // rendering artefact, so it's hidden and the edges fade to hint at the overflow instead.
          "[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          "[mask-image:linear-gradient(to_right,transparent,black_12px,black_calc(100%-12px),transparent)]",
        )}
      >
        <span
          ref={indicatorRef}
          aria-hidden
          style={{ opacity: 0 }}
          className={cn(
            "pointer-events-none absolute inset-y-1 left-0 rounded-full bg-gradient-to-r shadow-[0_6px_16px_-6px_rgba(15,23,42,0.5)]",
            gradient,
          )}
        />

        {items.map((item) => {
          const Icon = item.icon;
          const isActive = item.key === active;
          const content = (
            <>
              <Icon
                className={cn(
                  "h-3.5 w-3.5 shrink-0 transition-transform duration-300 motion-reduce:transition-none",
                  isActive && "scale-110",
                )}
              />
              <span className="whitespace-nowrap">{item.label}</span>
              {item.count ? (
                <span
                  className={cn(
                    "ml-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none transition-colors duration-300",
                    isActive ? "bg-white/20 text-white" : "bg-background text-muted-foreground",
                  )}
                >
                  {item.count}
                </span>
              ) : null}
            </>
          );

          const shared = cn(
            "relative z-10 flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium",
            "transition-colors duration-300 motion-reduce:transition-none",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
            isActive ? "text-white" : "text-muted-foreground",
          );

          return (
            <Link
              key={item.key}
              ref={registerPill(item.key)}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              // Already here — clicking would only re-navigate to the same screen.
              className={cn(shared, isActive ? "pointer-events-none" : "hover:text-foreground")}
            >
              {content}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
