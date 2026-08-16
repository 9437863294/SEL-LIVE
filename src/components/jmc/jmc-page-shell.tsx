"use client";

/**
 * Project Management's page furniture, for the JMC screens.
 *
 * The JMC pages arrived from Billing Recon carrying its look — bare `w-full px-4 sm:px-6 lg:px-8`
 * containers, plain headings, no gradient chip, its own ad-hoc loading and denied states. Sitting
 * next to MDCC, GRN, Inspections and MVAC that reads as a different application.
 *
 * Every Project Management operational screen is built from the same four parts: a full-height
 * `main` with consistent padding and rhythm, a header row of back-arrow + gradient icon chip +
 * title + muted subtitle, a skeleton while loading, and Card-based Access Denied / Select-a-project
 * states. This module is those parts, so the eight JMC screens adopt them by composition rather
 * than by eight separate hand-copies that drift.
 *
 * Nothing here holds state or fetches — it is presentation only, so a screen keeps owning its own
 * data, permissions and guards.
 */

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, ShieldAlert, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** The rhythm every Project Management screen uses. */
export const JMC_MAIN_CLASS = "min-h-[calc(100dvh-4rem)] space-y-5 p-4 sm:p-6";
const JMC_MAIN_FLAT_CLASS = "min-h-[calc(100dvh-4rem)] p-4 sm:p-6";

/**
 * JMC's accent, held in one place so the eight screens read as one module. Settings screens use
 * the slate accent Project Management already gives every settings surface.
 */
export const JMC_GRADIENT = "from-emerald-500 to-green-600";
export const JMC_SETTINGS_GRADIENT = "from-slate-500 to-slate-700";

/** Back-arrow + gradient icon chip + title + subtitle, exactly as MDCC/GRN/MVAC render it. */
export function JmcPageHeader({
  title,
  subtitle,
  icon: Icon,
  backHref,
  backLabel = "Back",
  gradient = JMC_GRADIENT,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  icon: LucideIcon;
  backHref: string;
  backLabel?: string;
  gradient?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href={backHref} aria-label={backLabel}>
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br shadow-sm",
            gradient,
          )}
        >
          <Icon className="h-5 w-5 text-white" />
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold">{title}</h1>
          {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** The standard main wrapper, so callers never re-type the rhythm classes. */
export function JmcPageShell({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <main className={cn(JMC_MAIN_CLASS, className)}>{children}</main>;
}

/** Project Management's loading shape: a title bar and one large block. */
export function JmcLoadingState({ blocks = 1 }: { blocks?: number }) {
  return (
    <main className={JMC_MAIN_CLASS}>
      <Skeleton className="h-9 w-64" />
      {Array.from({ length: blocks }).map((_, index) => (
        <Skeleton key={index} className="h-80 w-full" />
      ))}
    </main>
  );
}

/** Card-grid loading shape, for the hub-style screens that render tiles rather than a table. */
export function JmcCardGridLoadingState({ tiles = 6 }: { tiles?: number }) {
  return (
    <main className={JMC_MAIN_CLASS}>
      <Skeleton className="h-9 w-64" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
        {Array.from({ length: tiles }).map((_, index) => (
          <Skeleton key={index} className="h-16 rounded-xl" />
        ))}
      </div>
    </main>
  );
}

export function JmcAccessDenied({
  description = "You do not have permission to view this module.",
}: {
  description?: string;
}) {
  return (
    <main className={JMC_MAIN_FLAT_CLASS}>
      <Card>
        <CardHeader>
          <CardTitle>Access Denied</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center p-8">
          <ShieldAlert className="h-16 w-16 text-destructive" />
        </CardContent>
      </Card>
    </main>
  );
}

/** Shown when `?project=` is missing or names a mapping that no longer resolves. */
export function JmcProjectNotFound({
  description = "Return to Project Management and choose a project before opening JMC.",
  href = "/project-management/civil",
  label = "Select Project",
}: {
  description?: string;
  href?: string;
  label?: string;
}) {
  return (
    <main className={JMC_MAIN_FLAT_CLASS}>
      <Card>
        <CardHeader>
          <CardTitle>Select a project first</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href={href}>{label}</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}

/**
 * A navigation tile, matching the Project Management settings/landing card: a gradient accent
 * strip, a small gradient icon chip, title and description on one line, and a lift on hover.
 */
export function JmcNavCard({
  title,
  description,
  href,
  icon: Icon,
  gradient = JMC_GRADIENT,
  disabled,
}: {
  title: string;
  description: string;
  href: string;
  icon: LucideIcon;
  gradient?: string;
  disabled?: boolean;
}) {
  const card = (
    <Card
      className={cn(
        "h-full overflow-hidden border-border/60 transition-all duration-200",
        disabled ? "cursor-not-allowed opacity-60" : "hover:-translate-y-0.5 hover:shadow-md",
      )}
      aria-disabled={disabled || undefined}
    >
      <div className={cn("h-1 w-full bg-gradient-to-r", gradient)} />
      <CardContent className="flex items-center gap-2.5 p-3">
        <div
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br shadow-sm",
            gradient,
          )}
        >
          <Icon className="h-4 w-4 text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-tight">{title}</p>
          <p className="truncate text-xs text-muted-foreground">{description}</p>
        </div>
      </CardContent>
    </Card>
  );

  if (disabled) {
    return (
      <div className="h-full" title="You do not have permission for this" tabIndex={-1}>
        {card}
      </div>
    );
  }

  return (
    <Link href={href} className="group h-full no-underline">
      {card}
    </Link>
  );
}

/** The grid the nav cards sit in — same breakpoints as the Project Management landing page. */
export function JmcNavCardGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
      {children}
    </div>
  );
}
