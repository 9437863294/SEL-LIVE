"use client";

/**
 * The inspection call register.
 *
 * Distinct from the older Inspection Register, which lists BOQ *items* and their gate status. This
 * lists the calls: each covers a vendor, several purchase order lines and a quantity offered on
 * each, and results are recorded per line.
 *
 * Recording a result is where the three quantities separate — offered, accepted, rejected — so the
 * result dialog is built around that and nothing else. Accepted defaults to the whole offered
 * quantity because a clean pass is the common case; typing anything less produces the rejected
 * figure automatically, and that quantity returns to the cleared balance for rework.
 */

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  Ban,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  Hourglass,
  Loader2,
  PencilLine,
  Plus,
  RotateCcw,
  Settings,
  Table2,
  Trash2,
  Wrench,
} from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useToast } from "@/hooks/use-toast";
import { logUserActivity } from "@/lib/activity-logger";
import { formatQuantity, toNumber } from "@/lib/purchase-orders";
import { INSPECTION_PERMISSION_RESOURCE, PUNCH_SEVERITIES, type PunchItem, type PunchSeverity } from "@/lib/supply-gates";
import {
  buildInspectionRegisterRows,
  canIssueMdccForItem,
  inspectionCallStatusStyles,
  inspectionItemStatusStyles,
  inspectionPoLineKey,
  rejectedQtyOf,
  resultStatusFor,
  validateInspectionResult,
  type InspectionCallItem,
  type InspectionCallStatus,
} from "@/lib/project-management-inspection-quantity";
import {
  cancelInspectionCall,
  deleteInspectionDraft,
  loadInspectionWorkspace,
  rebuildInspectionPoLineBalances,
  recordInspectionResult,
  type InspectionResultLine,
  type InspectionWorkspace,
} from "@/lib/project-management-inspection-service";
import { useProjectManagementInspectionContext } from "@/components/inspection/use-inspection-host-context";
import {
  InspectionAccessDenied,
  InspectionLoadingState,
  InspectionProjectNotFound,
} from "@/components/inspection/inspection-page-shell";
import {
  PM_TABLE_CLASS,
  PmContent,
  PmSectionHead,
  PmShell,
  PmSidebar,
  PmTableFoot,
  PmTopbar,
  pmAccent,
} from "@/components/project-management/pm-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

const VIEWS = [
  { key: "all", label: "All calls", icon: ClipboardList },
  { key: "Draft", label: "Drafts", icon: PencilLine },
  { key: "Called", label: "Awaiting inspection", icon: Hourglass },
  { key: "Completed", label: "Inspected", icon: ClipboardCheck },
  { key: "rework", label: "Rework pending", icon: Wrench },
  { key: "Cancelled", label: "Cancelled", icon: Ban },
] as const;

type ViewKey = (typeof VIEWS)[number]["key"];

const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

const formatDate = (value?: string) => {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

/** What the result dialog holds per line while it is being filled in. */
type ResultDraft = {
  acceptedQty: string;
  punchDescription: string;
  punchSeverity: PunchSeverity;
  remarks: string;
};

export default function InspectionCallsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const mappingId = searchParams?.get("project") ?? "";
  const view = (searchParams?.get("view") ?? "all") as ViewKey;
  const { toast } = useToast();
  const { user } = useAuth();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { context, isResolving, notFound, projectName } =
    useProjectManagementInspectionContext(mappingId);

  const canView = can("View", INSPECTION_PERMISSION_RESOURCE);
  const canRequest = can("Request", INSPECTION_PERMISSION_RESOURCE);
  const canRecord = can("Record Result", INSPECTION_PERMISSION_RESOURCE);

  const [workspace, setWorkspace] = useState<InspectionWorkspace | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [busyCallId, setBusyCallId] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  /** The call whose result is being recorded, and the per-line inputs. */
  const [resultCallId, setResultCallId] = useState("");
  const [inspectionDate, setInspectionDate] = useState(today());
  const [inspectorName, setInspectorName] = useState("");
  const [resultByItemId, setResultByItemId] = useState<Record<string, ResultDraft>>({});

  const globalProjectId = context.globalProjectId;

  const loadData = useCallback(async () => {
    if (!globalProjectId) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      setWorkspace(await loadInspectionWorkspace(globalProjectId));
    } catch (error) {
      console.error("Failed to load inspection calls:", error);
      toast({ title: "Unable to load inspection calls", variant: "destructive" });
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

  const itemsByCallId = useMemo(() => {
    const map = new Map<string, InspectionCallItem[]>();
    for (const item of workspace?.items ?? []) {
      const list = map.get(item.callId) ?? [];
      list.push(item);
      map.set(item.callId, list);
    }
    return map;
  }, [workspace]);

  const allRows = useMemo(
    () =>
      buildInspectionRegisterRows(workspace?.calls ?? [], workspace?.items ?? []).sort(
        (a, b) => b.callDate.localeCompare(a.callDate) || b.callNumber.localeCompare(a.callNumber),
      ),
    [workspace],
  );

  const matchesView = useCallback(
    (row: (typeof allRows)[number], key: ViewKey) => {
      if (key === "all") return true;
      // Rework is not a status — it is any call that rejected something, which is the list a
      // procurement engineer actually chases.
      if (key === "rework") return row.rejectedQty > 0;
      if (key === "Called") return row.status === "Called" || row.status === "Partially Inspected";
      return row.status === key;
    },
    [],
  );

  const rows = useMemo(() => allRows.filter((row) => matchesView(row, view)), [allRows, matchesView, view]);
  const countFor = useCallback(
    (key: ViewKey) => allRows.filter((row) => matchesView(row, key)).length,
    [allRows, matchesView],
  );

  const setView = (value: string) => {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (value === "all") params.delete("view");
    else params.set("view", value);
    const path = context.inspectionHref("calls").split("?")[0];
    const query = params.toString();
    router.replace(query ? `${path}?${query}` : path);
  };

  const toggleRow = (callId: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(callId)) next.delete(callId);
      else next.add(callId);
      return next;
    });

  /** Lines of the call whose result is open, restricted to those still awaiting a decision. */
  const resultLines = useMemo(
    () => (itemsByCallId.get(resultCallId) ?? []).filter((item) => item.status === "Pending"),
    [itemsByCallId, resultCallId],
  );

  const openResultDialog = (callId: string) => {
    const pending = (itemsByCallId.get(callId) ?? []).filter((item) => item.status === "Pending");
    setResultCallId(callId);
    setInspectionDate(today());
    setInspectorName(workspace?.calls.find((call) => call.id === callId)?.inspectorName ?? "");
    setResultByItemId(
      Object.fromEntries(
        pending.map((item) => [
          item.id,
          {
            // A clean pass is the common case, so accepted starts at the whole offered quantity.
            acceptedQty: String(toNumber(item.offeredQty)),
            punchDescription: "",
            punchSeverity: "Minor" as PunchSeverity,
            remarks: "",
          },
        ]),
      ),
    );
  };

  const resultErrors = useMemo(
    () =>
      resultLines
        .map((item) => {
          const draft = resultByItemId[item.id];
          if (!draft) return null;
          const check = validateInspectionResult(
            toNumber(item.offeredQty),
            toNumber(draft.acceptedQty),
          );
          return check.ok ? null : { itemId: item.id, message: check.message! };
        })
        .filter((entry): entry is { itemId: string; message: string } => entry !== null),
    [resultLines, resultByItemId],
  );

  const handleRecordResult = async () => {
    if (!globalProjectId || !user || !resultCallId) return;
    if (resultErrors.length) {
      toast({
        title: "Fix the highlighted quantities first",
        description: resultErrors[0].message,
        variant: "destructive",
      });
      return;
    }

    const callNumber =
      workspace?.calls.find((call) => call.id === resultCallId)?.callNumber ?? resultCallId;
    setBusyCallId(resultCallId);
    try {
      const results: InspectionResultLine[] = resultLines.map((item) => {
        const draft = resultByItemId[item.id];
        const punchItems: PunchItem[] = draft?.punchDescription.trim()
          ? [
              {
                punchId: `punch_${item.id}`,
                description: draft.punchDescription.trim(),
                severity: draft.punchSeverity,
                closed: false,
              },
            ]
          : [];
        return {
          itemId: item.id,
          acceptedQty: toNumber(draft?.acceptedQty),
          punchItems,
          remarks: draft?.remarks,
        };
      });

      await recordInspectionResult({
        globalProjectId,
        callId: resultCallId,
        inspectionDate,
        inspectorName,
        results,
        actor: { id: user.id, name: user.name },
      });

      const acceptedTotal = results.reduce((sum, result) => sum + result.acceptedQty, 0);
      const offeredTotal = resultLines.reduce((sum, item) => sum + toNumber(item.offeredQty), 0);

      void logUserActivity({
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        module: context.activityModule,
        action: "Record Inspection Result",
        details: {
          project: projectName,
          callNumber,
          lines: results.length,
          offeredQty: offeredTotal,
          acceptedQty: acceptedTotal,
          rejectedQty: Math.round((offeredTotal - acceptedTotal) * 1000) / 1000,
        },
        recordId: resultCallId,
        recordRef: callNumber,
      });

      toast({
        title: `Result recorded for ${callNumber}`,
        description:
          offeredTotal > acceptedTotal
            ? `${formatQuantity(offeredTotal - acceptedTotal)} rejected and returned to the cleared balance for rework.`
            : `${formatQuantity(acceptedTotal)} accepted and ready for MDCC.`,
      });
      setResultCallId("");
      await loadData();
    } catch (error) {
      console.error("Failed to record the inspection result:", error);
      toast({
        title: `Unable to record the result for ${callNumber}`,
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusyCallId("");
    }
  };

  const handleCancel = async (callId: string, callNumber: string) => {
    if (!globalProjectId || !user) return;
    setBusyCallId(callId);
    try {
      await cancelInspectionCall({
        globalProjectId,
        callId,
        actor: { id: user.id, name: user.name },
      });
      void logUserActivity({
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        module: context.activityModule,
        action: "Cancel Inspection Call",
        details: { project: projectName, callNumber },
        recordId: callId,
        recordRef: callNumber,
      });
      toast({
        title: `${callNumber} cancelled`,
        description: "The offered quantity has been released back to the cleared balance.",
      });
      await loadData();
    } catch (error) {
      console.error("Failed to cancel the inspection call:", error);
      toast({
        title: `Unable to cancel ${callNumber}`,
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusyCallId("");
    }
  };

  const handleDelete = async (callId: string, callNumber: string) => {
    if (!globalProjectId) return;
    setBusyCallId(callId);
    try {
      await deleteInspectionDraft(globalProjectId, callId);
      toast({ title: `${callNumber} deleted` });
      await loadData();
    } catch (error) {
      console.error("Failed to delete the draft call:", error);
      toast({
        title: `Unable to delete ${callNumber}`,
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusyCallId("");
    }
  };

  const handleRebuild = async () => {
    if (!globalProjectId) return;
    setBusyCallId("rebuild");
    try {
      const written = await rebuildInspectionPoLineBalances(globalProjectId);
      toast({
        title: "Balances rebuilt",
        description: `${written} purchase order line balance${written === 1 ? "" : "s"} recomputed, picking up any new clearance.`,
      });
      await loadData();
    } catch (error) {
      console.error("Failed to rebuild the inspection balances:", error);
      toast({ title: "Unable to rebuild balances", variant: "destructive" });
    } finally {
      setBusyCallId("");
    }
  };

  if (isAuthLoading || isResolving) return <InspectionLoadingState />;
  if (!canView) {
    return <InspectionAccessDenied description="You do not have permission to view inspections." />;
  }
  if (notFound) {
    return (
      <InspectionProjectNotFound
        description="Return to Project Management and choose a project before opening the inspection register."
        href="/project-management"
      />
    );
  }

  const offeredTotal = rows.reduce((sum, row) => sum + row.offeredQty, 0);
  const acceptedTotal = rows.reduce((sum, row) => sum + row.acceptedQty, 0);
  const rejectedTotal = rows.reduce((sum, row) => sum + row.rejectedQty, 0);
  const blockingTotal = rows.reduce((sum, row) => sum + row.blockingPunchCount, 0);

  return (
    <PmShell
      sidebar={
        <PmSidebar
          title="Inspection Calls"
          subtitle={projectName}
          icon={ClipboardList}
          gradient="from-blue-500 to-indigo-600"
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
            {
              label: "Elsewhere",
              links: [
                {
                  href: context.inspectionHref("register"),
                  label: "Item gate register",
                  icon: Table2,
                  color: "text-cyan-600",
                  bg: "bg-cyan-100",
                },
              ],
            },
          ]}
          footerLinks={[
            {
              href: context.inspectionHref("settings"),
              label: "Settings",
              icon: Settings,
              color: "text-slate-600",
              bg: "bg-slate-100",
            },
          ]}
        />
      }
    >
      <PmTopbar
        title="Inspection Calls"
        breadcrumbs={[
          { label: projectName || "Project" },
          { label: "Inspections", href: context.inspectionHref() },
        ]}
        backHref={context.inspectionHref()}
        backLabel="Back to Inspections"
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={busyCallId === "rebuild" || !canRecord}
              onClick={() => void handleRebuild()}
              title="Recompute the per-PO-line balances, picking up any clearance approved since."
            >
              {busyCallId === "rebuild" ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <RotateCcw className="mr-1.5 h-4 w-4" />
              )}
              Rebuild balances
            </Button>
            <Button size="sm" disabled={!canRequest} asChild={canRequest}>
              {canRequest ? (
                <Link href={context.inspectionHref("new")}>
                  <Plus className="mr-1.5 h-4 w-4" />
                  New call
                </Link>
              ) : (
                <span>
                  <Plus className="mr-1.5 h-4 w-4" />
                  New call
                </span>
              )}
            </Button>
          </>
        }
      />

      <PmContent>
        <PmSectionHead
          title={VIEWS.find((entry) => entry.key === view)?.label ?? "All calls"}
          stats={[
            { label: "calls", value: String(rows.length) },
            { label: "offered", value: formatQuantity(offeredTotal) },
            { label: "accepted", value: formatQuantity(acceptedTotal) },
            ...(rejectedTotal
              ? [{ label: "rejected", value: formatQuantity(rejectedTotal), tone: "flag" as const }]
              : []),
            ...(blockingTotal
              ? [
                  {
                    label: "lines blocked by punch",
                    value: String(blockingTotal),
                    tone: "flag" as const,
                  },
                ]
              : []),
          ]}
        />

        <Card className="overflow-hidden border-border/60">
          {isLoading ? (
            <CardContent className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading inspection calls…
            </CardContent>
          ) : rows.length === 0 ? (
            <CardContent className="py-12 text-center">
              <ClipboardList className="mx-auto mb-3 h-9 w-9 text-muted-foreground/40" />
              <p className="text-sm font-medium">
                {allRows.length === 0
                  ? "No inspection call has been raised yet"
                  : `No ${VIEWS.find((entry) => entry.key === view)?.label.toLowerCase()}`}
              </p>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                A call offers cleared quantity for inspection. Only quantity approved by
                Manufacturing Clearance can be offered.
              </p>
              {canRequest && allRows.length === 0 && (
                <Button size="sm" className="mt-4" asChild>
                  <Link href={context.inspectionHref("new")}>
                    <Plus className="mr-1.5 h-4 w-4" />
                    Raise the first call
                  </Link>
                </Button>
              )}
            </CardContent>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table className={PM_TABLE_CLASS}>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8" />
                      <TableHead>Call No.</TableHead>
                      <TableHead>Call date</TableHead>
                      <TableHead>Inspected</TableHead>
                      <TableHead>Vendor</TableHead>
                      <TableHead>Inspector</TableHead>
                      <TableHead className="text-right">Lines</TableHead>
                      <TableHead className="text-right">Offered</TableHead>
                      <TableHead className="text-right">Accepted</TableHead>
                      <TableHead className="text-right">Rejected</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="w-40 text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => {
                      const isOpen = expanded.has(row.callId);
                      const lines = itemsByCallId.get(row.callId) ?? [];
                      const isBusy = busyCallId === row.callId;
                      const isLive =
                        row.status === "Called" || row.status === "Partially Inspected";
                      return (
                        <Fragment key={row.callId}>
                          <TableRow
                            className="cursor-pointer hover:bg-muted/40"
                            onClick={() => toggleRow(row.callId)}
                          >
                            <TableCell>
                              {isOpen ? (
                                <ChevronDown className="h-4 w-4 text-muted-foreground" />
                              ) : (
                                <ChevronRight className="h-4 w-4 text-muted-foreground" />
                              )}
                            </TableCell>
                            <TableCell className="font-medium">{row.callNumber}</TableCell>
                            <TableCell className="text-muted-foreground">
                              {formatDate(row.callDate)}
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {formatDate(row.inspectionDate)}
                            </TableCell>
                            <TableCell>{row.vendorName}</TableCell>
                            <TableCell className="text-muted-foreground">
                              {row.inspectorName || "—"}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {row.itemCount}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatQuantity(row.offeredQty)}
                            </TableCell>
                            <TableCell className="text-right font-semibold tabular-nums text-emerald-700">
                              {row.acceptedQty ? formatQuantity(row.acceptedQty) : "—"}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-red-700">
                              {row.rejectedQty ? formatQuantity(row.rejectedQty) : "—"}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className={`border-transparent ${inspectionCallStatusStyles[row.status as InspectionCallStatus] ?? ""}`}
                              >
                                {row.status}
                              </Badge>
                              {row.blockingPunchCount > 0 && (
                                <span
                                  className="ml-1 inline-flex items-center gap-0.5 text-xs text-amber-700"
                                  title="Open Critical or Major punch items block MDCC"
                                >
                                  <AlertTriangle className="h-3 w-3" />
                                  {row.blockingPunchCount}
                                </span>
                              )}
                            </TableCell>
                            <TableCell
                              className="text-right"
                              onClick={(event) => event.stopPropagation()}
                            >
                              {isBusy ? (
                                <Loader2 className="ml-auto h-4 w-4 animate-spin text-muted-foreground" />
                              ) : isLive ? (
                                <div className="flex justify-end gap-1">
                                  {canRecord && (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-7 px-2 text-blue-700"
                                      onClick={() => openResultDialog(row.callId)}
                                    >
                                      <ClipboardCheck className="mr-1 h-3.5 w-3.5" />
                                      Record
                                    </Button>
                                  )}
                                  {canRequest && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-7 px-2 text-muted-foreground"
                                      onClick={() => void handleCancel(row.callId, row.callNumber)}
                                    >
                                      <Ban className="mr-1 h-3.5 w-3.5" />
                                      Cancel
                                    </Button>
                                  )}
                                </div>
                              ) : row.status === "Draft" && canRequest ? (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-2 text-muted-foreground"
                                  onClick={() => void handleDelete(row.callId, row.callNumber)}
                                >
                                  <Trash2 className="mr-1 h-3.5 w-3.5" />
                                  Delete
                                </Button>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </TableCell>
                          </TableRow>

                          {isOpen &&
                            lines.map((line) => {
                              const ledger = workspace?.ledgers.get(
                                inspectionPoLineKey(line.poId, line.poLineId),
                              );
                              const rejected = rejectedQtyOf(line);
                              const mdccReady = canIssueMdccForItem(line);
                              return (
                                <TableRow key={line.id} className="bg-muted/20">
                                  <TableCell />
                                  <TableCell className="text-xs text-muted-foreground">
                                    {line.poNumber}
                                  </TableCell>
                                  <TableCell colSpan={3} className="text-sm">
                                    <span className="block max-w-[24rem] truncate">
                                      {line.itemDescription}
                                    </span>
                                  </TableCell>
                                  <TableCell className="text-xs text-muted-foreground">
                                    {ledger ? `${formatQuantity(ledger.clearedQty)} cleared` : ""}
                                  </TableCell>
                                  <TableCell className="text-right text-xs text-muted-foreground">
                                    {line.unit}
                                  </TableCell>
                                  <TableCell className="text-right tabular-nums">
                                    {formatQuantity(line.offeredQty)}
                                  </TableCell>
                                  <TableCell className="text-right tabular-nums text-emerald-700">
                                    {line.acceptedQty ? formatQuantity(line.acceptedQty) : "—"}
                                  </TableCell>
                                  <TableCell className="text-right tabular-nums text-red-700">
                                    {rejected ? formatQuantity(rejected) : "—"}
                                  </TableCell>
                                  <TableCell>
                                    <Badge
                                      variant="outline"
                                      className={`border-transparent text-[11px] ${inspectionItemStatusStyles[line.status] ?? ""}`}
                                    >
                                      {line.status}
                                    </Badge>
                                  </TableCell>
                                  <TableCell className="text-right text-xs">
                                    {line.status === "Pending" ? (
                                      <span className="text-muted-foreground">Awaiting result</span>
                                    ) : mdccReady ? (
                                      <span className="text-emerald-700">Ready for MDCC</span>
                                    ) : line.status === "Failed" ? (
                                      <span className="text-red-700">Rework</span>
                                    ) : (
                                      <span className="text-amber-700">Punch open</span>
                                    )}
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                        </Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <PmTableFoot
                left={
                  <>
                    {rows.length} call{rows.length === 1 ? "" : "s"} · click a row to see its lines
                  </>
                }
                right={
                  <span className="font-medium text-foreground">
                    {formatQuantity(acceptedTotal)} accepted of {formatQuantity(offeredTotal)}{" "}
                    offered
                  </span>
                }
              />
            </>
          )}
        </Card>
      </PmContent>

      <Dialog open={Boolean(resultCallId)} onOpenChange={(open) => !open && setResultCallId("")}>
        {/* The breakpoint prefix is load-bearing: DialogContent defaults to size="full", whose
            `sm:max-w-[1800px]` an unprefixed `max-w-*` cannot override — tailwind-merge only
            resolves conflicts within the same variant, so the two would both apply and the
            wider one would win above 640px. */}
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader className="pr-8">
            <DialogTitle>
              Record inspection result
              {workspace?.calls.find((call) => call.id === resultCallId)?.callNumber
                ? ` — ${workspace.calls.find((call) => call.id === resultCallId)!.callNumber}`
                : ""}
            </DialogTitle>
            <DialogDescription>
              Accepted quantity proceeds to MDCC. Anything short of the offered quantity is
              rejected and returns to the cleared balance for rework.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="result-date">Inspection date</Label>
              <Input
                id="result-date"
                type="date"
                className="h-9"
                value={inspectionDate}
                onChange={(event) => setInspectionDate(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="result-inspector">Inspector</Label>
              <Input
                id="result-inspector"
                className="h-9"
                placeholder="Who inspected"
                value={inspectorName}
                onChange={(event) => setInspectorName(event.target.value)}
              />
            </div>
          </div>

          <div className="max-h-[45vh] space-y-3 overflow-y-auto pr-1">
            {resultLines.map((item) => {
              const draft = resultByItemId[item.id];
              const offered = toNumber(item.offeredQty);
              const accepted = toNumber(draft?.acceptedQty);
              const rejected = Math.max(0, Math.round((offered - accepted) * 1000) / 1000);
              const error = resultErrors.find((entry) => entry.itemId === item.id);
              return (
                <Card key={item.id} className={error ? "border-red-300" : "border-border/60"}>
                  <CardContent className="space-y-3 py-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-sm font-medium">{item.itemDescription}</span>
                      <span className="text-xs text-muted-foreground">
                        {item.poNumber} · offered {formatQuantity(offered)} {item.unit}
                      </span>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-[8rem_1fr_9rem]">
                      <div className="space-y-1">
                        <Label htmlFor={`accepted-${item.id}`} className="text-xs">
                          Accepted
                        </Label>
                        <Input
                          id={`accepted-${item.id}`}
                          type="number"
                          min={0}
                          step="any"
                          inputMode="decimal"
                          className="h-8 text-right tabular-nums"
                          value={draft?.acceptedQty ?? ""}
                          onChange={(event) =>
                            setResultByItemId((current) => ({
                              ...current,
                              [item.id]: { ...current[item.id], acceptedQty: event.target.value },
                            }))
                          }
                          aria-invalid={Boolean(error)}
                        />
                      </div>

                      <div className="space-y-1">
                        <Label htmlFor={`punch-${item.id}`} className="text-xs">
                          Punch item (optional)
                        </Label>
                        <Input
                          id={`punch-${item.id}`}
                          className="h-8"
                          placeholder="Observation to be closed out"
                          value={draft?.punchDescription ?? ""}
                          onChange={(event) =>
                            setResultByItemId((current) => ({
                              ...current,
                              [item.id]: {
                                ...current[item.id],
                                punchDescription: event.target.value,
                              },
                            }))
                          }
                        />
                      </div>

                      <div className="space-y-1">
                        <Label className="text-xs">Severity</Label>
                        <Select
                          value={draft?.punchSeverity ?? "Minor"}
                          onValueChange={(value) =>
                            setResultByItemId((current) => ({
                              ...current,
                              [item.id]: {
                                ...current[item.id],
                                punchSeverity: value as PunchSeverity,
                              },
                            }))
                          }
                        >
                          <SelectTrigger className="h-8">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {PUNCH_SEVERITIES.map((severity) => (
                              <SelectItem key={severity} value={severity}>
                                {severity}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <Textarea
                      rows={1}
                      placeholder="Remarks (optional)"
                      value={draft?.remarks ?? ""}
                      onChange={(event) =>
                        setResultByItemId((current) => ({
                          ...current,
                          [item.id]: { ...current[item.id], remarks: event.target.value },
                        }))
                      }
                    />

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                      <span className="text-muted-foreground">
                        Outcome:{" "}
                        <span className="font-medium text-foreground">
                          {resultStatusFor(
                            accepted,
                            draft?.punchDescription.trim()
                              ? [
                                  {
                                    punchId: "preview",
                                    description: draft.punchDescription,
                                    severity: draft.punchSeverity,
                                    closed: false,
                                  },
                                ]
                              : [],
                          )}
                        </span>
                      </span>
                      {rejected > 0 && (
                        <span className="text-red-700">
                          {formatQuantity(rejected)} {item.unit} rejected, returns for rework
                        </span>
                      )}
                      {error && <span className="text-red-700">{error.message}</span>}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
            {resultLines.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Every line on this call already has a result.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setResultCallId("")}>
              Cancel
            </Button>
            <Button
              disabled={
                !canRecord ||
                !resultLines.length ||
                resultErrors.length > 0 ||
                Boolean(busyCallId)
              }
              onClick={() => void handleRecordResult()}
            >
              {busyCallId === resultCallId && busyCallId ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <ClipboardCheck className="mr-1.5 h-4 w-4" />
              )}
              Record result
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PmShell>
  );
}
