"use client";

/**
 * A supply gate's landing screen — MDCC, Dispatch Instructions, GRN.
 *
 * These three had no landing page at all: `/project-management/mdcc` was a 404, and the only way
 * in was the Supply hub's link straight to `/documents`. Every other screen in Project Management
 * answers to its module base, so a bookmark, a typed URL or a link that lost its suffix fell off
 * a cliff.
 *
 * What it shows is the question this gate actually answers: **what can I raise right now**. The
 * stage above has passed quantity down, some of it is already in flight, and what is left is the
 * work. That reading is the ledger's (`buildSupplyLedgers`), so this page adds no arithmetic of
 * its own.
 *
 * One component, three stages: the stage definition supplies the vocabulary, as it does for the
 * register and the create form.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  FileStack,
  Hourglass,
  Loader2,
  Package,
  PackageCheck,
  Plus,
  ShieldAlert,
  type LucideIcon,
} from "lucide-react";
import { useAuthorization } from "@/hooks/useAuthorization";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/shared/page-header";
import { formatQuantity } from "@/lib/quantity-format";
import {
  buildSupplyRegisterRows,
  supplyStage,
  type SupplyLedger,
  type SupplyLedgerStage,
} from "@/lib/project-management-supply-ledger";
import { loadSupplyChain, type SupplyChain } from "@/lib/project-management-supply-service";
import {
  SUPPLY_STAGE_CHROME,
  hrefWith,
  useSupplyProject,
} from "@/components/project-management/supply-document-screens";
import { cn } from "@/lib/utils";

function Figure({
  icon: Icon,
  label,
  value,
  detail,
  gradient,
  flag,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  detail: string;
  gradient: string;
  flag?: boolean;
}) {
  return (
    <Card className="overflow-hidden border-border/60">
      <CardContent className="flex items-center gap-3 p-4">
        <span
          className={cn(
            "grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br text-white shadow-md",
            gradient,
          )}
          aria-hidden="true"
        >
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-muted-foreground">{label}</p>
          <p
            className={cn(
              "truncate text-xl font-extrabold leading-tight",
              flag && "text-destructive",
            )}
          >
            {value}
          </p>
          <p className="truncate text-[11.5px] text-muted-foreground">{detail}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export function SupplyDocumentHub({ stage }: { stage: SupplyLedgerStage }) {
  const definition = supplyStage(stage);
  const chrome = SUPPLY_STAGE_CHROME[stage];
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { globalProjectId, projectName, isResolving, notFound } = useSupplyProject(mappingId);
  const { can, isLoading: isAuthLoading } = useAuthorization();

  const canView = !isAuthLoading && can("View", definition.permissionResource);
  const canRaise = !isAuthLoading && can(definition.raiseAction, definition.permissionResource);

  const [chain, setChain] = useState<SupplyChain | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const loadData = useCallback(async () => {
    if (!globalProjectId || !canView) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setLoadError("");
    try {
      setChain(await loadSupplyChain(globalProjectId));
    } catch (error) {
      console.error(`Failed to load the ${definition.label} figures:`, error);
      setLoadError(`The ${definition.label} figures could not be loaded. Your register is unchanged.`);
    } finally {
      setIsLoading(false);
    }
  }, [globalProjectId, canView, definition.label]);

  useEffect(() => {
    if (isAuthLoading) return;
    // Reading the chain once the project resolves is what an effect is for; `loadData` owns its
    // own loading flag, including turning it off when there is nothing to read.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadData();
  }, [isAuthLoading, loadData]);

  const state = chain?.stages[stage] ?? null;

  const reading = useMemo(() => {
    const ledgers: SupplyLedger[] = state ? [...state.ledgers.values()] : [];
    const rows = buildSupplyRegisterRows(state?.docs ?? [], state?.items ?? []);

    const open = rows.filter(
      (row) => row.status === "Open" || row.status === "Partially Completed",
    );
    const ready = ledgers.filter((ledger) => ledger.availableQty > 0);
    const waiting = ledgers.filter((ledger) => ledger.awaitingUpstream);

    return {
      documents: rows.length,
      drafts: rows.filter((row) => row.status === "Draft").length,
      open: open.length,
      openQty: open.reduce((sum, row) => sum + row.presentedQty - row.acceptedQty, 0),
      acceptedQty: rows.reduce((sum, row) => sum + row.acceptedQty, 0),
      rejectedQty: rows.reduce((sum, row) => sum + row.rejectedQty, 0),
      blocking: rows.reduce((sum, row) => sum + row.blockingObservationCount, 0),
      readyLines: ready.length,
      readyQty: ready.reduce((sum, ledger) => sum + ledger.availableQty, 0),
      waitingLines: waiting.length,
      /** The biggest few things that could go on a document today. */
      top: [...ready].sort((a, b) => b.availableQty - a.availableQty).slice(0, 6),
    };
  }, [state]);

  if (isAuthLoading || isResolving) {
    return (
      <main className="min-h-[calc(100dvh-4rem)] space-y-4 p-4 sm:p-6">
        <Skeleton className="h-9 w-64" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((tile) => (
            <Skeleton key={tile} className="h-[86px] rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-64 w-full rounded-xl" />
      </main>
    );
  }

  if (!canView) {
    return (
      <main className="min-h-[calc(100dvh-4rem)] p-4 sm:p-6">
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>
              You do not have permission to view {definition.label}.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center p-8">
            <ShieldAlert className="h-16 w-16 text-destructive" />
          </CardContent>
        </Card>
      </main>
    );
  }

  if (notFound) {
    return (
      <main className="min-h-[calc(100dvh-4rem)] p-4 sm:p-6">
        <Card>
          <CardHeader>
            <CardTitle>Select a project first</CardTitle>
            <CardDescription>
              Return to Supply and choose a project before opening {definition.label}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/project-management/supply">Select Project</Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-[calc(100dvh-4rem)] space-y-4 p-4 sm:p-6">
      <PageHeader
        title={definition.label}
        description={
          projectName
            ? `${definition.docNoun[0]!.toUpperCase()}${definition.docNoun.slice(1)}s for ${projectName}`
            : `${definition.docNoun[0]!.toUpperCase()}${definition.docNoun.slice(1)}s on this project`
        }
        icon={Package}
        backHref={hrefWith("/project-management/supply", mappingId)}
        backLabel="Back to Supply"
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href={hrefWith(`${chrome.basePath}/documents`, mappingId)}>
                <FileStack className="mr-2 h-4 w-4" />
                Open register
              </Link>
            </Button>
            {canRaise ? (
              <Button asChild>
                <Link href={hrefWith(`${chrome.basePath}/new`, mappingId)}>
                  <Plus className="mr-2 h-4 w-4" />
                  New {definition.label}
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      {loadError ? (
        <Card className="border-destructive/40">
          <CardContent className="p-6 text-sm font-semibold text-muted-foreground">
            {loadError}
          </CardContent>
        </Card>
      ) : null}

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((tile) => (
            <Skeleton key={tile} className="h-[86px] rounded-xl" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Figure
              icon={PackageCheck}
              label="Ready to present"
              value={formatQuantity(reading.readyQty)}
              detail={`${reading.readyLines} line${reading.readyLines === 1 ? "" : "s"} the stage above has passed down`}
              gradient="from-emerald-400 to-emerald-700"
            />
            <Figure
              icon={Hourglass}
              label="Awaiting decision"
              value={String(reading.open)}
              detail={
                reading.openQty > 0
                  ? `${formatQuantity(reading.openQty)} ${definition.presentedLabel.toLowerCase()} and undecided`
                  : "Nothing is in flight"
              }
              gradient="from-amber-300 to-amber-600"
            />
            <Figure
              icon={FileStack}
              label={`${definition.label} documents`}
              value={String(reading.documents)}
              detail={
                reading.drafts > 0
                  ? `${reading.drafts} draft${reading.drafts === 1 ? "" : "s"} holding no quantity`
                  : `${formatQuantity(reading.acceptedQty)} ${definition.acceptedLabel.toLowerCase()} so far`
              }
              gradient={chrome.gradient}
            />
            <Figure
              icon={AlertTriangle}
              label="Needs attention"
              value={String(reading.blocking)}
              detail={
                reading.blocking > 0
                  ? "Open Critical or Major observations block release"
                  : reading.rejectedQty > 0
                    ? `${formatQuantity(reading.rejectedQty)} not accepted, back in the pool`
                    : "Nothing blocked"
              }
              gradient="from-rose-400 to-rose-700"
              flag={reading.blocking > 0}
            />
          </div>

          <Card className="border-border/60">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">What can go on a {definition.docNoun}</CardTitle>
              <CardDescription>
                Lines with quantity the stage above has passed down and nothing has taken yet.
                {reading.waitingLines > 0
                  ? ` ${reading.waitingLines} further line${reading.waitingLines === 1 ? " is" : "s are"} still waiting upstream.`
                  : ""}
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {reading.top.length === 0 ? (
                <div className="px-6 py-10 text-center">
                  <Package className="mx-auto mb-3 h-9 w-9 text-muted-foreground/40" />
                  <p className="text-sm font-medium">
                    Nothing is available for a {definition.docNoun} yet
                  </p>
                  <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                    A line appears here once the stage above has passed quantity down to{" "}
                    {definition.label}.
                  </p>
                </div>
              ) : (
                <ul className="divide-y">
                  {reading.top.map((ledger) => (
                    <li
                      key={`${ledger.poId}-${ledger.poLineId}`}
                      className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold" title={ledger.itemDescription}>
                          {ledger.itemDescription}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {ledger.poNumber} · {ledger.acceptedPct}% through this gate
                        </p>
                      </div>
                      <span className="whitespace-nowrap text-sm font-extrabold tabular-nums">
                        {formatQuantity(ledger.availableQty)} {ledger.unit}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="border-t px-4 py-2.5 text-right">
                <Link
                  href={hrefWith(`${chrome.basePath}/documents`, mappingId)}
                  className="inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline"
                >
                  Open the {definition.label} register
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {isLoading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Reading the chain…
        </p>
      ) : null}
    </main>
  );
}
