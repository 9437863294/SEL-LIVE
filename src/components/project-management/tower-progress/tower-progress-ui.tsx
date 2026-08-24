"use client";

/**
 * Shared chrome for the Tower Progress screens: the page shell, header, sub-navigation, the three
 * guard states every screen needs, and the two primitives that appear on nearly every one of them —
 * an activity status badge and a watermarked report photograph.
 *
 * Collected here rather than repeated per page because there are ten screens plus a report engine,
 * and the guards in particular have to behave identically on all of them: a screen that renders an
 * empty table while permissions are still resolving looks like "no data" rather than "not loaded
 * yet", which is how people conclude a register has been wiped.
 */

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeft,
  BarChart3,
  CheckCircle2,
  Download,
  ImageOff,
  LayoutDashboard,
  ListTree,
  Loader2,
  MapPin,
  Settings as SettingsIcon,
  ShieldAlert,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  activityStatusStyles,
  formatTowerDate,
  towerProgressHref,
  verificationStateStyles,
  type TowerActivity,
  type TowerActivityStatus,
  type TowerGpsFix,
  type TowerVerificationState,
} from "@/lib/project-management-tower-progress";
import {
  downloadWatermarkedPhoto,
  watermarkLines,
  type WatermarkContext,
} from "@/lib/project-management-tower-watermark";
import { useToast } from "@/hooks/use-toast";
import { useTowerProgress } from "./tower-progress-provider";

export const TOWER_PROGRESS_GRADIENT = "from-orange-500 to-red-600";

/* ── Shell ──────────────────────────────────────────────────────────────────────────────────── */

export function TowerProgressShell({ children }: { children: ReactNode }) {
  return <main className="min-h-[calc(100dvh-4rem)] space-y-5 p-4 sm:p-6">{children}</main>;
}

export function TowerProgressHeader({
  title,
  subtitle,
  icon: Icon,
  backHref,
  actions,
}: {
  title: string;
  subtitle: string;
  icon: LucideIcon;
  backHref: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href={backHref} aria-label="Back">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br shadow-sm",
            TOWER_PROGRESS_GRADIENT,
          )}
        >
          <Icon className="h-5 w-5 text-white" />
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold">{title}</h1>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

interface NavItem {
  label: string;
  sub: string;
  icon: LucideIcon;
  show: boolean;
}

/** Sub-navigation across the Tower Progress screens, active state derived from the pathname so it
 *  cannot drift from where the user actually is. */
export function TowerProgressNav() {
  const { mappingId, permissions, updates } = useTowerProgress();
  const pathname = usePathname() ?? "";
  const pendingVerifications = updates.filter(
    (update) => update.verificationState === "Pending",
  ).length;

  const items: NavItem[] = [
    { label: "Dashboard", sub: "", icon: LayoutDashboard, show: true },
    { label: "Towers", sub: "towers", icon: ListTree, show: true },
    { label: "Verify", sub: "verify", icon: ShieldCheck, show: permissions.verifyProgress },
    { label: "Map", sub: "reports/map", icon: MapPin, show: permissions.viewReports },
    { label: "Reports", sub: "reports", icon: BarChart3, show: permissions.viewReports },
    { label: "Settings", sub: "settings", icon: SettingsIcon, show: permissions.viewSettings },
  ];

  return (
    <nav className="flex flex-wrap gap-2 border-b pb-3">
      {items
        .filter((item) => item.show)
        .map((item) => {
          const href = towerProgressHref(mappingId, item.sub);
          const target = href.split("?")[0];
          // "Reports" must not light up while a specific report or the map is open, so the hub is
          // matched exactly and everything else by prefix.
          const active =
            item.sub === "" || item.sub === "reports"
              ? pathname === target
              : pathname.startsWith(target);
          return (
            <Button
              key={item.label}
              variant={active ? "default" : "outline"}
              size="sm"
              asChild
              className="relative"
            >
              <Link href={href}>
                <item.icon className="mr-2 h-4 w-4" />
                {item.label}
                {item.sub === "verify" && pendingVerifications > 0 && (
                  <span className="ml-2 rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-white">
                    {pendingVerifications}
                  </span>
                )}
              </Link>
            </Button>
          );
        })}
    </nav>
  );
}

/* ── Guards ─────────────────────────────────────────────────────────────────────────────────── */

export function TowerProgressLoading({ tiles = 5 }: { tiles?: number }) {
  return (
    <TowerProgressShell>
      <Skeleton className="h-12 w-80" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: tiles }).map((_, index) => (
          <Skeleton key={index} className="h-24 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-96 rounded-xl" />
    </TowerProgressShell>
  );
}

export function TowerProgressAccessDenied({ what = "Tower Progress" }: { what?: string }) {
  return (
    <TowerProgressShell>
      <Card>
        <CardHeader>
          <CardTitle>Access denied</CardTitle>
          <CardDescription>You do not have permission to view {what}.</CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center p-8">
          <ShieldAlert className="h-16 w-16 text-destructive" />
        </CardContent>
      </Card>
    </TowerProgressShell>
  );
}

export function TowerProgressProjectMissing() {
  return (
    <TowerProgressShell>
      <Card>
        <CardHeader>
          <CardTitle>Select a project first</CardTitle>
          <CardDescription>
            Tower Progress runs against one project. Return to Project Management and choose one.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/project-management">Select project</Link>
          </Button>
        </CardContent>
      </Card>
    </TowerProgressShell>
  );
}

/**
 * Wraps a screen in the loading / denied / no-project checks so each page body can assume it has a
 * resolved project and a loaded register. `requires` names the extra permission the screen needs
 * beyond plain View.
 */
export function TowerProgressGuard({
  children,
  requires,
  requiresLabel,
}: {
  children: ReactNode;
  requires?: boolean;
  requiresLabel?: string;
}) {
  const { isAuthLoading, isLoading, notFound, permissions, project } = useTowerProgress();

  if (isAuthLoading || isLoading) return <TowerProgressLoading />;
  if (!permissions.view) return <TowerProgressAccessDenied />;
  if (notFound || !project) return <TowerProgressProjectMissing />;
  if (requires === false) return <TowerProgressAccessDenied what={requiresLabel ?? "this screen"} />;
  return <>{children}</>;
}

/* ── Small primitives ───────────────────────────────────────────────────────────────────────── */

export function ActivityStatusBadge({
  status,
  className,
}: {
  status: TowerActivityStatus;
  className?: string;
}) {
  return (
    <Badge className={cn(activityStatusStyles[status], "whitespace-nowrap", className)}>
      {status}
    </Badge>
  );
}

export function VerificationBadge({ state }: { state: TowerVerificationState }) {
  return <Badge className={cn(verificationStateStyles[state], "whitespace-nowrap")}>{state}</Badge>;
}

export function MetricCard({
  label,
  value,
  detail,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  detail?: string;
  tone?: "neutral" | "good" | "warn" | "bad";
}) {
  const toneClass = {
    neutral: "",
    good: "border-emerald-200 bg-emerald-50/50",
    warn: "border-amber-200 bg-amber-50/50",
    bad: "border-red-200 bg-red-50/50",
  }[tone];
  return (
    <Card className={cn(toneClass)}>
      <CardContent className="p-4">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="mt-1 text-xl font-bold">{value}</p>
        {detail ? <p className="mt-1 text-xs text-muted-foreground">{detail}</p> : null}
      </CardContent>
    </Card>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 p-10 text-center">
      <CheckCircle2 className="h-10 w-10 text-muted-foreground" />
      <div>
        <p className="font-medium">{title}</p>
        <p className="mx-auto max-w-lg text-sm text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}

/* ── Report photograph ──────────────────────────────────────────────────────────────────────── */

export interface TowerReportPhotoProps {
  url: string;
  towerNo: string;
  activity: TowerActivity;
  progressDate: string;
  gps?: TowerGpsFix | null;
  uploadedByName?: string;
  verified?: boolean;
  /** Rendered small in a register cell rather than as a report plate. */
  compact?: boolean;
  className?: string;
}

/**
 * A photograph with its evidence caption (§20).
 *
 * The caption is an overlay rather than pixels burnt into the stored file, so the photograph itself
 * stays exactly as the site uploaded it, and the caption always reflects current tower data. It
 * prints as part of the report; the download button produces a standalone copy with the caption burnt
 * in, for when the photograph has to travel on its own.
 *
 * Plain `<img>` rather than `next/image`: these are Firebase Storage download URLs on a per-tower
 * path, so there is nothing for the image optimiser to pre-size and every URL would need a remote
 * pattern allowance.
 */
export function TowerReportPhoto({
  url,
  towerNo,
  activity,
  progressDate,
  gps,
  uploadedByName,
  verified,
  compact,
  className,
}: TowerReportPhotoProps) {
  const { project, settings } = useTowerProgress();
  const { toast } = useToast();
  const [isDownloading, setIsDownloading] = useState(false);
  const [failed, setFailed] = useState(false);

  const context: WatermarkContext = {
    organisation: settings.watermarkOrganisation,
    projectName: project?.projectName ?? "",
    towerNo,
    activity,
    progressDate,
    gps,
    uploadedByName,
    verified,
  };

  const handleDownload = async () => {
    setIsDownloading(true);
    try {
      await downloadWatermarkedPhoto(url, context);
    } catch (error) {
      console.error("Failed to render the watermarked photograph:", error);
      toast({
        title: "Could not prepare the watermarked copy",
        description: "The photograph is still available from the tower page.",
        variant: "destructive",
      });
    } finally {
      setIsDownloading(false);
    }
  };

  if (failed) {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center gap-1 rounded-md border border-dashed bg-muted/40 text-muted-foreground",
          compact ? "h-16 w-24" : "aspect-[4/3] w-full",
          className,
        )}
      >
        <ImageOff className="h-4 w-4" />
        <span className="text-[10px]">Unavailable</span>
      </div>
    );
  }

  if (compact) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className={cn("block", className)} title="Open photograph">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={`${towerNo} ${activity}`}
          loading="lazy"
          onError={() => setFailed(true)}
          className="h-16 w-24 rounded-md border object-cover"
        />
      </a>
    );
  }

  return (
    <figure className={cn("break-inside-avoid overflow-hidden rounded-lg border bg-black", className)}>
      <div className="relative">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={`${towerNo} — ${activity}`}
          loading="lazy"
          onError={() => setFailed(true)}
          className="block w-full object-cover"
        />
        <figcaption className="absolute inset-x-0 bottom-0 bg-black/65 px-2 py-1.5 text-[10px] leading-tight text-white">
          {watermarkLines(context).map((line, index) => (
            <span key={line} className={cn("block", index === 0 && "font-bold tracking-wide")}>
              {line}
            </span>
          ))}
        </figcaption>
      </div>
      <div className="flex items-center justify-between gap-2 bg-background px-2 py-1.5 print:hidden">
        <span className="truncate text-xs text-muted-foreground">
          {formatTowerDate(progressDate)}
          {verified ? " · Verified" : ""}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void handleDownload()}
          disabled={isDownloading}
          className="h-7 px-2"
        >
          {isDownloading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>
    </figure>
  );
}

/** Placeholder that keeps a report's photo grid aligned when an activity has no photograph yet. */
export function MissingPhotoPlate({ label }: { label: string }) {
  return (
    <div className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-1 break-inside-avoid rounded-lg border border-dashed bg-muted/30 text-center text-muted-foreground">
      <ImageOff className="h-5 w-5" />
      <span className="px-2 text-[11px]">{label}</span>
      <span className="text-[10px]">No photograph</span>
    </div>
  );
}
