"use client";

/**
 * The Manufacturing Clearance document register.
 *
 * The working surface for this gate. It lists the clearance *documents*: each one covers a vendor,
 * several purchase order lines and a quantity against each, and the same PO line appears on as many
 * of them as it takes to clear the ordered quantity. There is no longer a per-BOQ-item gate register
 * screen — the item gate records the downstream chain reads are derived from the approved quantity
 * here, via syncMcGateRecords().
 *
 * Rows expand to their lines, because the quantity is the point — a collapsed row tells you an MC
 * exists, and the expanded one tells you what it actually authorises.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Ban,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileStack,
  Hourglass,
  Loader2,
  PencilLine,
  Plus,
  RotateCcw,
  Settings,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useToast } from "@/hooks/use-toast";
import { logUserActivity } from "@/lib/activity-logger";
import { formatQuantity } from "@/lib/purchase-orders";
import { MC_PERMISSION_RESOURCE } from "@/lib/supply-gates";
import {
  buildMcRegisterRows,
  poLineKey,
  type McItem,
} from "@/lib/project-management-mc-quantity";
import {
  decideMcDocument,
  deleteMcDraft,
  loadMcWorkspace,
  rebuildMcPoLineBalances,
  syncMcGateRecords,
  type McWorkspace,
} from "@/lib/project-management-mc-service";
import { useProjectManagementMcContext } from "@/components/mc/use-mc-host-context";
import {
  McAccessDenied,
  McLoadingState,
  McProjectNotFound,
} from "@/components/mc/mc-page-shell";
import {
  PmContent,
  PmDataList,
  PmSectionHead,
  PmShell,
  PmSidebar,
  PmTableFoot,
  pmAccent,
  type PmListColumn,
} from "@/components/project-management/pm-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";

/** Register views. `all` first, then one per status that a reviewer actually works from. */
const VIEWS = [
  { key: "all", label: "All clearances", icon: FileStack },
  { key: "Draft", label: "Drafts", icon: PencilLine },
  { key: "Submitted", label: "Awaiting decision", icon: Hourglass },
  { key: "Approved", label: "Approved", icon: CheckCircle2 },
  { key: "Rejected", label: "Rejected", icon: XCircle },
  { key: "Cancelled", label: "Withdrawn", icon: Ban },
] as const;

type ViewKey = (typeof VIEWS)[number]["key"];

const formatDate = (value?: string) => {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

export default function ManufacturingClearanceDocumentsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const mappingId = searchParams?.get("project") ?? "";
  const view = (searchParams?.get("view") ?? "all") as ViewKey;
  const { toast } = useToast();
  const { user } = useAuth();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { context, isResolving, notFound, projectName } = useProjectManagementMcContext(mappingId);

  const canView = can("View", MC_PERMISSION_RESOURCE);
  const canCreate = can("Clear", MC_PERMISSION_RESOURCE) || can("Add", MC_PERMISSION_RESOURCE);
  const canDecide = can("Clear", MC_PERMISSION_RESOURCE);
  const canReject = can("Reject", MC_PERMISSION_RESOURCE);

  const [workspace, setWorkspace] = useState<McWorkspace | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [busyMcId, setBusyMcId] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const globalProjectId = context.globalProjectId;

  const loadData = useCallback(async () => {
    if (!globalProjectId) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      setWorkspace(await loadMcWorkspace(globalProjectId));
    } catch (error) {
      console.error("Failed to load manufacturing clearances:", error);
      toast({ title: "Unable to load manufacturing clearances", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [globalProjectId, toast]);

  useEffect(() => {
    if (isAuthLoading || !canView) {
      setIsLoading(false);
      return;
    }
    void loadData();
  }, [canView, isAuthLoading, loadData]);

  const itemsByMcId = useMemo(() => {
    const map = new Map<string, McItem[]>();
    for (const item of workspace?.items ?? []) {
      const list = map.get(item.mcId) ?? [];
      list.push(item);
      map.set(item.mcId, list);
    }
    return map;
  }, [workspace]);

  const allRows = useMemo(
    () =>
      buildMcRegisterRows(workspace?.headers ?? [], workspace?.items ?? []).sort(
        (a, b) => b.mcDate.localeCompare(a.mcDate) || b.mcNumber.localeCompare(a.mcNumber),
      ),
    [workspace],
  );

  const rows = useMemo(
    () =>
      view === "all"
        ? allRows
        : allRows.filter((row) =>
            // "Awaiting decision" covers partially approved too — it is still on someone's desk.
            view === "Submitted"
              ? row.status === "Submitted" || row.status === "Partially Approved"
              : row.status === view,
          ),
    [allRows, view],
  );

  /** The same rows with the `id` the responsive list keys its cards and table rows by. */
  const listRows = useMemo(() => rows.map((row) => ({ ...row, id: row.mcId })), [rows]);

  const countFor = useCallback(
    (key: ViewKey) =>
      key === "all"
        ? allRows.length
        : allRows.filter((row) =>
            key === "Submitted"
              ? row.status === "Submitted" || row.status === "Partially Approved"
              : row.status === key,
          ).length,
    [allRows],
  );

  /** View lives in the URL so a refresh keeps the filter and a link can point at one. */
  const setView = (value: string) => {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (value === "all") params.delete("view");
    else params.set("view", value);
    // mcHref carries `?project=` already, so its query is dropped in favour of `params`, which
    // was seeded from the current URL and therefore still holds it.
    const path = context.mcHref("documents").split("?")[0];
    const query = params.toString();
    router.replace(query ? `${path}?${query}` : path);
  };

  const toggleRow = (mcId: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(mcId)) next.delete(mcId);
      else next.add(mcId);
      return next;
    });

  const handleDecision = async (
    mcId: string,
    mcNumber: string,
    decision: "Approved" | "Rejected" | "Cancelled",
  ) => {
    if (!globalProjectId || !user) return;
    setBusyMcId(mcId);
    try {
      await decideMcDocument({
        globalProjectId,
        mcId,
        decision,
        actor: { id: user.id, name: user.name },
      });
      void logUserActivity({
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        module: context.activityModule,
        action: `${decision === "Approved" ? "Approve" : decision === "Rejected" ? "Reject" : "Cancel"} Manufacturing Clearance`,
        details: { project: projectName, mcNumber, decision },
        recordId: mcId,
        recordRef: mcNumber,
      });
      toast({
        title: `${mcNumber} ${decision.toLowerCase()}`,
        description:
          decision === "Approved"
            ? "The cleared quantity is now committed against the purchase order lines."
            : "The quantity it was holding has been released back to the purchase order lines.",
      });
      await loadData();
    } catch (error) {
      console.error(`Failed to ${decision.toLowerCase()} the manufacturing clearance:`, error);
      toast({
        title: `Unable to ${decision === "Approved" ? "approve" : decision === "Rejected" ? "reject" : "cancel"} ${mcNumber}`,
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusyMcId("");
    }
  };

  const handleDelete = async (mcId: string, mcNumber: string) => {
    if (!globalProjectId) return;
    setBusyMcId(mcId);
    try {
      await deleteMcDraft(globalProjectId, mcId);
      toast({ title: `${mcNumber} deleted` });
      await loadData();
    } catch (error) {
      console.error("Failed to delete the draft clearance:", error);
      toast({
        title: `Unable to delete ${mcNumber}`,
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusyMcId("");
    }
  };

  const handleRebuild = async () => {
    if (!globalProjectId) return;
    setBusyMcId("rebuild");
    try {
      const written = await rebuildMcPoLineBalances(globalProjectId);
      // The gate projection is rebuilt alongside, because the two can only drift together: both
      // are derived from the clearance items.
      const gates = await syncMcGateRecords(globalProjectId);
      toast({
        title: "Balances rebuilt",
        description: `${written} purchase order line balance${written === 1 ? "" : "s"} recomputed, and ${gates} item gate${gates === 1 ? "" : "s"} brought in line with the approved quantity.`,
      });
      await loadData();
    } catch (error) {
      console.error("Failed to rebuild the purchase order line balances:", error);
      toast({ title: "Unable to rebuild balances", variant: "destructive" });
    } finally {
      setBusyMcId("");
    }
  };

  if (isAuthLoading || isResolving) return <McLoadingState />;
  if (!canView) {
    return <McAccessDenied description="You do not have permission to view manufacturing clearance." />;
  }
  if (notFound) {
    return (
      <McProjectNotFound
        description="Return to Project Management and choose a project before opening the clearance register."
        href="/project-management"
      />
    );
  }

  const totalQty = rows.reduce((sum, row) => sum + row.currentMcQty, 0);

  const columns: PmListColumn<(typeof listRows)[number]>[] = [
    {
      header: "",
      className: "w-8",
      mobile: "omit",
      cell: (row) =>
        expanded.has(row.mcId) ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        ),
    },
    { header: "MC No.", className: "font-medium", mobile: "title", cell: (row) => row.mcNumber },
    { header: "Date", className: "whitespace-nowrap", cell: (row) => formatDate(row.mcDate) },
    { header: "Vendor", mobile: "title", cell: (row) => row.vendorName },
    {
      header: "POs",
      align: "right",
      cell: (row) => <span className="tabular-nums">{row.poCount}</span>,
    },
    {
      header: "Lines",
      align: "right",
      cell: (row) => <span className="tabular-nums">{row.itemCount}</span>,
    },
    {
      header: "Quantity",
      align: "right",
      cell: (row) => (
        <span className="font-semibold tabular-nums">{formatQuantity(row.currentMcQty)}</span>
      ),
    },
    {
      header: "Status",
      mobile: "aside",
      cell: (row) => (
        <StatusBadge status={row.status} />
      ),
    },
    {
      header: "Action",
      align: "right",
      className: "w-44",
      mobile: "footer",
      cell: (row) => {
        const isOpen = expanded.has(row.mcId);
        const isBusy = busyMcId === row.mcId;
        const isDecidable = row.status === "Submitted" || row.status === "Partially Approved";
        return (
          <div
            className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto sm:gap-1"
            onClick={(event) => event.stopPropagation()}
          >
            {isBusy ? (
              <Loader2 className="ml-auto h-4 w-4 animate-spin text-muted-foreground" />
            ) : isDecidable ? (
              <>
                {canDecide && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-emerald-700"
                    onClick={() => void handleDecision(row.mcId, row.mcNumber, "Approved")}
                  >
                    <Check className="mr-1 h-3.5 w-3.5" />
                    Approve
                  </Button>
                )}
                {canReject && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-red-700"
                    onClick={() => void handleDecision(row.mcId, row.mcNumber, "Rejected")}
                  >
                    <X className="mr-1 h-3.5 w-3.5" />
                    Reject
                  </Button>
                )}
                {/* Withdrawing is not rejecting: the raiser pulling back an MC
                    nobody needs is not a decision about its merit, and it
                    releases the reserved quantity either way. */}
                {canCreate && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-muted-foreground"
                    onClick={() => void handleDecision(row.mcId, row.mcNumber, "Cancelled")}
                  >
                    <Ban className="mr-1 h-3.5 w-3.5" />
                    Withdraw
                  </Button>
                )}
              </>
            ) : row.status === "Draft" && canCreate ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-muted-foreground"
                onClick={() => void handleDelete(row.mcId, row.mcNumber)}
              >
                <Trash2 className="mr-1 h-3.5 w-3.5" />
                Delete
              </Button>
            ) : (
              <span className="hidden text-xs text-muted-foreground sm:inline">—</span>
            )}
            {/* A phone card carries actions, so it cannot toggle on tap as the table row does. */}
            <Button
              variant="outline"
              size="sm"
              className="sm:hidden"
              onClick={() => toggleRow(row.mcId)}
            >
              {isOpen ? "Hide lines" : "Show lines"}
            </Button>
          </div>
        );
      },
    },
  ];

  /** The purchase order lines under an expanded clearance: one row on a desktop, stacked on a phone. */
  const renderLines = (row: (typeof listRows)[number]) => (
    <ul className="divide-y divide-border/60 sm:pl-12">
      {(itemsByMcId.get(row.mcId) ?? []).map((line) => {
        const ledger = workspace?.ledgers.get(poLineKey(line.poId, line.poLineId));
        return (
          <li
            key={line.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 sm:flex-nowrap sm:gap-4"
          >
            <span className="w-full text-xs text-muted-foreground sm:w-36 sm:shrink-0">
              {line.poNumber}
            </span>
            <span className="w-full break-words text-sm sm:w-auto sm:min-w-0 sm:flex-1 sm:truncate">
              {line.itemDescription}
            </span>
            <span className="text-sm tabular-nums sm:w-44 sm:shrink-0 sm:text-right">
              {formatQuantity(line.currentMcQty)} {line.unit}
              {ledger ? (
                <span className="ml-1.5 text-xs text-muted-foreground">
                  of {formatQuantity(ledger.effectiveQty)}
                </span>
              ) : null}
            </span>
            {ledger ? (
              <span className="text-xs text-muted-foreground sm:w-24 sm:shrink-0 sm:text-right">
                {ledger.clearedPct}% cleared
              </span>
            ) : null}
            <StatusBadge status={line.status} className="ml-auto shrink-0" />
          </li>
        );
      })}
    </ul>
  );

  return (
    <PmShell
      sidebar={
        <PmSidebar
          title="MC Documents"
          subtitle={projectName}
          icon={FileStack}
          gradient="from-lime-500 to-green-600"
          activeValue={view}
          onChange={setView}
          groups={[
            {
              label: "Views",
              views: VIEWS.map((entry, index) => ({
                value: entry.key,
                label: entry.label,
                icon: entry.icon,
                color: pmAccent(index).color,
                bg: pmAccent(index).bg,
                count: countFor(entry.key),
              })),
            },
          ]}
          footerLinks={[
            {
              href: context.mcHref("settings"),
              label: "Settings",
              icon: Settings,
              color: "text-slate-600",
              bg: "bg-slate-100",
            },
          ]}
        />
      }
    >
      <PageHeader sticky
        title="MC Documents"
        breadcrumbs={[
          { label: projectName || "Project" },
          { label: "Manufacturing Clearance", href: context.mcHref() },
        ]}
        backHref={context.mcHref()}
        backLabel="Back to Manufacturing Clearance"
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={busyMcId === "rebuild" || !canDecide}
              onClick={() => void handleRebuild()}
              title="Recompute the per-PO-line balance guards from the clearance records."
              aria-label="Rebuild balances"
            >
              {busyMcId === "rebuild" ? (
                <Loader2 className="h-4 w-4 animate-spin sm:mr-1.5" />
              ) : (
                <RotateCcw className="h-4 w-4 sm:mr-1.5" />
              )}
              <span className="hidden sm:inline">Rebuild balances</span>
            </Button>
            <Button size="sm" disabled={!canCreate} asChild={canCreate}>
              {canCreate ? (
                <Link href={context.mcHref("new")}>
                  <Plus className="mr-1.5 h-4 w-4" />
                  New MC
                </Link>
              ) : (
                <span>
                  <Plus className="mr-1.5 h-4 w-4" />
                  New MC
                </span>
              )}
            </Button>
          </>
        }
      />

      <PmContent>
        <PmSectionHead
          title={VIEWS.find((entry) => entry.key === view)?.label ?? "All clearances"}
          stats={[
            { label: "clearances", value: String(rows.length) },
            { label: "total quantity", value: formatQuantity(totalQty) },
            ...(countFor("Submitted")
              ? [
                  {
                    label: "awaiting decision",
                    value: String(countFor("Submitted")),
                    tone: "flag" as const,
                  },
                ]
              : []),
          ]}
        />

        {isLoading ? (
          <Card className="overflow-hidden border-border/60">
            <CardContent className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading manufacturing clearances…
            </CardContent>
          </Card>
        ) : (
          <PmDataList
            rows={listRows}
            columns={columns}
            onRowClick={(row) => toggleRow(row.mcId)}
            expandedIds={expanded}
            renderExpanded={renderLines}
            empty={
              <div className="px-6 py-12 text-center">
                <FileStack className="mx-auto mb-3 h-9 w-9 text-muted-foreground/40" />
                <p className="text-sm font-medium">
                  {allRows.length === 0
                    ? "No manufacturing clearance has been raised yet"
                    : `No ${VIEWS.find((entry) => entry.key === view)?.label.toLowerCase()}`}
                </p>
                <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                  A clearance authorises one vendor to begin production against quantity on one or
                  more purchase order lines.
                </p>
                {canCreate && allRows.length === 0 && (
                  <Button size="sm" className="mt-4" asChild>
                    <Link href={context.mcHref("new")}>
                      <Plus className="mr-1.5 h-4 w-4" />
                      Raise the first clearance
                    </Link>
                  </Button>
                )}
              </div>
            }
            foot={
              <PmTableFoot
                left={
                  <>
                    {rows.length} clearance{rows.length === 1 ? "" : "s"} · click a row to see its
                    purchase order lines
                  </>
                }
                right={
                  <span className="font-medium text-foreground">
                    {formatQuantity(totalQty)} total quantity
                  </span>
                }
              />
            }
          />
        )}
      </PmContent>
    </PmShell>
  );
}
