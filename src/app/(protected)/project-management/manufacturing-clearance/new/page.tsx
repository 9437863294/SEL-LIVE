"use client";

/**
 * Raising a Manufacturing Clearance.
 *
 * An MC authorises one vendor to begin production against quantity on one or more purchase order
 * lines. It is quantity-driven and many-to-many: an MC can cover several POs and several lines of
 * the same PO, and a line can be cleared by a succession of MCs until its cumulative approved
 * quantity reaches the ordered quantity.
 *
 * The screen is built around the balance rather than the item list, because the balance is the
 * thing that goes wrong. Every candidate line shows Ordered / Approved / Reserved / Available side
 * by side, so a buyer entering 150 against a 50 balance sees why it is refused without having to
 * open the PO. Lines with nothing left are listed as Fully Cleared and cannot be selected at all.
 *
 * The client-side check is a courtesy; the binding one runs inside a transaction on submit (see
 * project-management-mc-service.ts), because two people can pass a client check simultaneously.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, Factory, Loader2, Save, Send } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useToast } from "@/hooks/use-toast";
import { logUserActivity } from "@/lib/activity-logger";
import { formatQuantity, toNumber } from "@/lib/purchase-orders";
import { MC_PERMISSION_RESOURCE } from "@/lib/supply-gates";
import {
  poLineKey,
  validateMcGrouping,
  validateMcItemQty,
  type PoLineLedger,
} from "@/lib/project-management-mc-quantity";
import {
  createMcDocument,
  effectiveQtyByLineKey,
  loadMcWorkspace,
  MC_BALANCE_CONFLICT,
  type McDraftLine,
  type McWorkspace,
} from "@/lib/project-management-mc-service";
import { useProjectManagementMcContext } from "@/components/mc/use-mc-host-context";
import {
  McAccessDenied,
  McLoadingState,
  McProjectNotFound,
} from "@/components/mc/mc-page-shell";
import {
  PM_TABLE_CLASS,
  PmContent,
  PmSectionHead,
  PmShell,
  PmStatusPill,
  PmTableFoot,
  PmTopbar,
} from "@/components/project-management/pm-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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

const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

/** One selectable row: the PO line, its ledger, and what the user has typed against it. */
type CandidateRow = {
  key: string;
  ledger: PoLineLedger;
  boqItemId?: string;
  vendorId: string;
  vendorName: string;
};

export default function NewManufacturingClearancePage() {
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const router = useRouter();
  const { toast } = useToast();
  const { user } = useAuth();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { context, isResolving, notFound, projectName } = useProjectManagementMcContext(mappingId);

  const canView = can("View", MC_PERMISSION_RESOURCE);
  const canCreate = can("Clear", MC_PERMISSION_RESOURCE) || can("Add", MC_PERMISSION_RESOURCE);

  const [workspace, setWorkspace] = useState<McWorkspace | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const [vendorId, setVendorId] = useState("");
  const [mcDate, setMcDate] = useState(today());
  const [remarks, setRemarks] = useState("");
  /** Typed quantity per PO line key. Absent means the line is not on this MC. */
  const [qtyByKey, setQtyByKey] = useState<Record<string, string>>({});

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
      console.error("Failed to load purchase order balances:", error);
      toast({ title: "Unable to load purchase order balances", variant: "destructive" });
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

  /** Every clearable PO line, with its vendor attached. */
  const allCandidates = useMemo<CandidateRow[]>(() => {
    if (!workspace) return [];
    const out: CandidateRow[] = [];
    for (const line of workspace.poLines) {
      const key = poLineKey(line.poId, line.poLineId);
      const ledger = workspace.ledgers.get(key);
      if (!ledger) continue;
      const vendor = workspace.vendorByPoId.get(line.poId);
      out.push({
        key,
        ledger,
        boqItemId: line.boqItemId,
        vendorId: vendor?.vendorId ?? "",
        vendorName: vendor?.vendorName ?? "Unknown vendor",
      });
    }
    return out;
  }, [workspace]);

  /**
   * Vendors with at least one line still open. A vendor whose whole scope is cleared is dropped
   * from the picker rather than offered and then found to be empty.
   */
  const vendorOptions = useMemo(() => {
    const byId = new Map<string, { vendorId: string; vendorName: string; openLines: number }>();
    for (const row of allCandidates) {
      if (!row.vendorId) continue;
      const entry =
        byId.get(row.vendorId) ?? { vendorId: row.vendorId, vendorName: row.vendorName, openLines: 0 };
      if (!row.ledger.fullyCleared) entry.openLines += 1;
      byId.set(row.vendorId, entry);
    }
    return [...byId.values()]
      .filter((entry) => entry.openLines > 0)
      .sort((a, b) => a.vendorName.localeCompare(b.vendorName));
  }, [allCandidates]);

  const rows = useMemo(
    () =>
      allCandidates
        .filter((row) => row.vendorId === vendorId)
        .sort(
          (a, b) =>
            a.ledger.poNumber.localeCompare(b.ledger.poNumber) ||
            a.ledger.itemDescription.localeCompare(b.ledger.itemDescription),
        ),
    [allCandidates, vendorId],
  );

  /** The lines actually going on the MC, with their typed quantity resolved. */
  const draftLines = useMemo<Array<{ row: CandidateRow; qty: number; error?: string }>>(() => {
    return rows
      .filter((row) => qtyByKey[row.key] !== undefined && qtyByKey[row.key] !== "")
      .map((row) => {
        const qty = toNumber(qtyByKey[row.key]);
        const check = validateMcItemQty(qty, row.ledger);
        return { row, qty, error: check.ok ? undefined : check.message };
      });
  }, [rows, qtyByKey]);

  const groupingErrors = useMemo(
    () =>
      validateMcGrouping(
        draftLines.map(({ row }) => ({
          poId: row.ledger.poId,
          poNumber: row.ledger.poNumber,
          vendorId: row.vendorId,
          globalProjectId,
        })),
      ),
    [draftLines, globalProjectId],
  );

  const lineErrors = draftLines.filter((line) => line.error);
  const totalQty = draftLines.reduce((sum, line) => sum + line.qty, 0);
  const distinctPoCount = new Set(draftLines.map(({ row }) => row.ledger.poId)).size;
  const canSubmit =
    draftLines.length > 0 && lineErrors.length === 0 && groupingErrors.length === 0 && !isSaving;

  const setQty = (key: string, value: string) =>
    setQtyByKey((current) => ({ ...current, [key]: value }));

  const toggleLine = (row: CandidateRow, checked: boolean) =>
    setQtyByKey((current) => {
      const next = { ...current };
      if (checked) {
        // Defaulting to the whole available balance is the common case — a buyer clearing a line
        // usually clears what is left of it.
        next[row.key] = String(row.ledger.availableQty);
      } else {
        delete next[row.key];
      }
      return next;
    });

  const handleSave = async (submit: boolean) => {
    if (!globalProjectId || !user) return;
    const vendor = vendorOptions.find((entry) => entry.vendorId === vendorId);
    if (!vendor) {
      toast({ title: "Choose a vendor first", variant: "destructive" });
      return;
    }
    if (!draftLines.length) {
      toast({ title: "Add at least one purchase order line to clear", variant: "destructive" });
      return;
    }
    if (lineErrors.length || groupingErrors.length) {
      toast({
        title: "Fix the highlighted quantities first",
        description: lineErrors[0]?.error ?? groupingErrors[0]?.message,
        variant: "destructive",
      });
      return;
    }

    setIsSaving(true);
    try {
      const lines: McDraftLine[] = draftLines.map(({ row, qty }) => ({
        poId: row.ledger.poId,
        poNumber: row.ledger.poNumber,
        poLineId: row.ledger.poLineId,
        boqItemId: row.boqItemId,
        itemDescription: row.ledger.itemDescription,
        unit: row.ledger.unit,
        currentMcQty: qty,
      }));

      const { mcNumber } = await createMcDocument({
        globalProjectId,
        vendorId: vendor.vendorId,
        vendorName: vendor.vendorName,
        mcDate,
        remarks,
        lines,
        effectiveQtyByLineKey: effectiveQtyByLineKey(workspace?.poLines ?? []),
        submit,
        actor: { id: user.id, name: user.name },
      });

      void logUserActivity({
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        module: context.activityModule,
        action: submit ? "Submit Manufacturing Clearance" : "Create Manufacturing Clearance",
        details: {
          project: projectName,
          mcNumber,
          vendor: vendor.vendorName,
          lines: lines.length,
          totalQty,
          purchaseOrders: [...new Set(lines.map((line) => line.poNumber))],
        },
        recordRef: `${mcNumber} · ${vendor.vendorName}`,
      });

      toast({
        title: submit ? `${mcNumber} submitted` : `${mcNumber} saved as draft`,
        description: submit
          ? `${formatQuantity(totalQty)} reserved across ${lines.length} purchase order line(s).`
          : "Draft clearances hold no purchase order quantity until they are submitted.",
      });
      router.push(context.mcHref("documents"));
    } catch (error) {
      console.error("Failed to raise the manufacturing clearance:", error);
      const message = error instanceof Error ? error.message : "Please try again.";
      toast({
        // The transaction refuses with the balance that was actually free at commit time, which is
        // more useful than a generic failure — so it is surfaced verbatim.
        title: message.includes(MC_BALANCE_CONFLICT)
          ? "Purchase order balance changed"
          : "Unable to raise the manufacturing clearance",
        description: message.replace(`${MC_BALANCE_CONFLICT}: `, ""),
        variant: "destructive",
      });
      // Someone else moved the balance, so the on-screen figures are now wrong.
      if (message.includes(MC_BALANCE_CONFLICT)) void loadData();
    } finally {
      setIsSaving(false);
    }
  };

  if (isAuthLoading || isResolving) return <McLoadingState />;
  if (!canView) {
    return <McAccessDenied description="You do not have permission to view manufacturing clearance." />;
  }
  if (notFound) {
    return (
      <McProjectNotFound
        description="Return to Project Management and choose a project before raising a clearance."
        href="/project-management"
      />
    );
  }

  return (
    <PmShell>
      <PmTopbar
        title="New Manufacturing Clearance"
        breadcrumbs={[
          { label: "Manufacturing Clearance", href: context.mcHref() },
          { label: "New" },
        ]}
        backHref={context.mcHref("documents")}
        backLabel="Back to MC documents"
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={!canCreate || !draftLines.length || isSaving}
              onClick={() => void handleSave(false)}
            >
              <Save className="mr-1.5 h-4 w-4" />
              Save draft
            </Button>
            <Button size="sm" disabled={!canCreate || !canSubmit} onClick={() => void handleSave(true)}>
              {isSaving ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-1.5 h-4 w-4" />
              )}
              Submit clearance
            </Button>
          </>
        }
      />

      <PmContent>
        {!canCreate && (
          <Card className="mb-4 border-amber-300 bg-amber-50/60">
            <CardContent className="flex items-start gap-2 py-3 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                You can see purchase order balances but not raise a clearance. Ask for the Clear
                permission on Manufacturing Clearance.
              </span>
            </CardContent>
          </Card>
        )}

        <Card className="mb-4 border-border/60">
          <CardContent className="grid gap-4 py-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,2fr)]">
            <div className="space-y-1.5">
              <Label htmlFor="mc-vendor">Vendor</Label>
              <Select
                value={vendorId}
                onValueChange={(value) => {
                  setVendorId(value);
                  // Lines belong to the vendor they were picked under; keeping them across a
                  // vendor change would build an MC that fails the grouping rule.
                  setQtyByKey({});
                }}
              >
                <SelectTrigger id="mc-vendor" className="h-9">
                  <SelectValue
                    placeholder={
                      vendorOptions.length ? "Choose a vendor" : "No vendor has open PO quantity"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {vendorOptions.map((vendor) => (
                    <SelectItem key={vendor.vendorId} value={vendor.vendorId}>
                      {vendor.vendorName} · {vendor.openLines} open line
                      {vendor.openLines === 1 ? "" : "s"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                One clearance covers one vendor — that is who the document is issued to.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="mc-date">Clearance date</Label>
              <Input
                id="mc-date"
                type="date"
                className="h-9"
                value={mcDate}
                onChange={(event) => setMcDate(event.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="mc-remarks">Remarks</Label>
              <Textarea
                id="mc-remarks"
                rows={2}
                placeholder="Anything the vendor or the approver needs to know."
                value={remarks}
                onChange={(event) => setRemarks(event.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        <PmSectionHead
          title="Purchase order lines"
          stats={[
            { label: "selected", value: String(draftLines.length) },
            { label: "purchase orders", value: String(distinctPoCount) },
            { label: "total quantity", value: formatQuantity(totalQty) },
            ...(lineErrors.length
              ? [{ label: "over balance", value: String(lineErrors.length), tone: "flag" as const }]
              : []),
          ]}
        />

        {groupingErrors.length > 0 && (
          <Card className="mb-3 border-red-300 bg-red-50/60">
            <CardContent className="py-3 text-sm text-red-800">
              {groupingErrors.map((error) => (
                <p key={error.message}>{error.message}</p>
              ))}
            </CardContent>
          </Card>
        )}

        <Card className="overflow-hidden border-border/60">
          {isLoading ? (
            <CardContent className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading purchase order balances…
            </CardContent>
          ) : !vendorId ? (
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              <Factory className="mx-auto mb-2 h-8 w-8 opacity-40" />
              Choose a vendor to see the purchase order lines you can clear.
            </CardContent>
          ) : rows.length === 0 ? (
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              This vendor has no purchase order lines on an issued order.
            </CardContent>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table className={PM_TABLE_CLASS}>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10" />
                      <TableHead>PO</TableHead>
                      <TableHead>Item</TableHead>
                      <TableHead>Unit</TableHead>
                      <TableHead className="text-right">Ordered</TableHead>
                      <TableHead className="text-right">Cancelled</TableHead>
                      <TableHead className="text-right">Cleared</TableHead>
                      <TableHead className="text-right">Reserved</TableHead>
                      <TableHead className="text-right">Available</TableHead>
                      <TableHead>Line status</TableHead>
                      <TableHead className="w-32 text-right">This MC</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => {
                      const { ledger } = row;
                      const selected = qtyByKey[row.key] !== undefined;
                      const draft = draftLines.find((line) => line.row.key === row.key);
                      return (
                        <TableRow
                          key={row.key}
                          className={
                            draft?.error
                              ? "bg-red-50/60"
                              : ledger.fullyCleared
                                ? "opacity-60"
                                : undefined
                          }
                        >
                          <TableCell>
                            <Checkbox
                              checked={selected}
                              disabled={ledger.fullyCleared || !canCreate}
                              onCheckedChange={(checked) => toggleLine(row, checked === true)}
                              aria-label={`Clear ${ledger.itemDescription} on ${ledger.poNumber}`}
                            />
                          </TableCell>
                          <TableCell className="font-medium">{ledger.poNumber}</TableCell>
                          <TableCell>
                            <span className="block max-w-[22rem] truncate">
                              {ledger.itemDescription}
                            </span>
                          </TableCell>
                          <TableCell className="text-muted-foreground">{ledger.unit}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatQuantity(ledger.orderedQty)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">
                            {ledger.cancelledQty ? formatQuantity(ledger.cancelledQty) : "—"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {ledger.approvedQty ? formatQuantity(ledger.approvedQty) : "—"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-amber-700">
                            {ledger.reservedQty ? formatQuantity(ledger.reservedQty) : "—"}
                          </TableCell>
                          <TableCell className="text-right font-semibold tabular-nums">
                            {formatQuantity(ledger.availableQty)}
                          </TableCell>
                          <TableCell>
                            <PmStatusPill
                              label={ledger.status}
                              tone={
                                ledger.status === "Fully Cleared"
                                  ? "ok"
                                  : ledger.status === "Partially Cleared"
                                    ? "wait"
                                    : "neutral"
                              }
                            />
                            {ledger.clearedPct > 0 && !ledger.fullyCleared && (
                              <span className="ml-1 text-xs text-muted-foreground tabular-nums">
                                {ledger.clearedPct}%
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {ledger.fullyCleared ? (
                              <span className="text-xs text-muted-foreground">No balance</span>
                            ) : (
                              <Input
                                type="number"
                                min={0}
                                step="any"
                                inputMode="decimal"
                                className="h-8 w-28 text-right tabular-nums"
                                placeholder="0"
                                disabled={!selected || !canCreate}
                                value={qtyByKey[row.key] ?? ""}
                                onChange={(event) => setQty(row.key, event.target.value)}
                                aria-invalid={Boolean(draft?.error)}
                              />
                            )}
                            {draft?.error && (
                              <p className="mt-1 max-w-[16rem] text-right text-xs text-red-700">
                                {draft.error}
                              </p>
                            )}
                            {ledger.draftQty > 0 && !draft && (
                              <p className="mt-1 text-right text-xs text-muted-foreground">
                                {formatQuantity(ledger.draftQty)} on other drafts
                              </p>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <PmTableFoot
                left={
                  <>
                    {rows.length} line{rows.length === 1 ? "" : "s"} ·{" "}
                    {rows.filter((row) => row.ledger.fullyCleared).length} fully cleared
                  </>
                }
                right={
                  draftLines.length > 0 ? (
                    <span className="font-medium text-foreground">
                      Clearing {formatQuantity(totalQty)} across {draftLines.length} line
                      {draftLines.length === 1 ? "" : "s"}
                    </span>
                  ) : (
                    "Tick a line to clear it"
                  )
                }
              />
            </>
          )}
        </Card>

        {/* A div, not a p: Badge renders a div, and a div inside a p is invalid HTML that the
            browser silently reparents — which shows up as a hydration mismatch. */}
        <div className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
          <Badge variant="outline" className="shrink-0 font-normal">
            How the balance works
          </Badge>
          <span>
            Available = Ordered − Cancelled − Cleared − Reserved. Submitting reserves the quantity so
            a second clearance cannot claim it; rejecting or cancelling releases it. A draft holds
            nothing until it is submitted.
          </span>
        </div>
      </PmContent>
    </PmShell>
  );
}
