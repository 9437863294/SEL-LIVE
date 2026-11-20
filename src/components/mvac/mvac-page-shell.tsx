"use client";

/**
 * MVAC's page furniture: the main wrapper and the three states every screen in the module can end
 * up in — still resolving, not allowed, no project.
 *
 * The same four parts JMC and Survey keep in their own page shells. They are small and each
 * module's wording differs, which is why they are per-module rather than one shared component
 * taking four strings.
 */

import type { ReactNode } from "react";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
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
export const MVAC_MAIN_CLASS = "min-h-[calc(100dvh-4rem)] space-y-4 p-4 sm:p-6";
const MVAC_MAIN_FLAT_CLASS = "min-h-[calc(100dvh-4rem)] p-4 sm:p-6";

export const MVAC_SETTINGS_GRADIENT = "from-slate-500 to-slate-700";
export const MVAC_GRADIENT = "from-rose-500 to-pink-600";

export function MvacPageShell({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <main className={cn(MVAC_MAIN_CLASS, className)}>{children}</main>;
}

export function MvacLoadingState({ blocks = 1 }: { blocks?: number }) {
  return (
    <main className={MVAC_MAIN_CLASS}>
      <Skeleton className="h-9 w-64" />
      {Array.from({ length: blocks }).map((_, index) => (
        <Skeleton key={index} className="h-80 w-full" />
      ))}
    </main>
  );
}

export function MvacAccessDenied({
  description = "You do not have permission to view this page.",
}: {
  description?: string;
}) {
  return (
    <main className={MVAC_MAIN_FLAT_CLASS}>
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
export function MvacProjectNotFound({
  description = "Return to Project Management and choose a project before opening MVAC.",
  href = "/project-management/supply",
  label = "Select Project",
}: {
  description?: string;
  href?: string;
  label?: string;
}) {
  return (
    <main className={MVAC_MAIN_FLAT_CLASS}>
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
