"use client";

/**
 * Raising an inspection call.
 *
 * Same shape as New MC — pick a vendor, tick PO lines, enter quantity — with one difference the
 * screen has to make obvious: the ceiling is the **cleared** quantity, not the ordered quantity.
 * A line of 100 with 40 cleared can be offered for at most 40, and a line with nothing cleared
 * cannot be offered at all.
 *
 * So the table shows Ordered and Cleared side by side, and a line awaiting clearance is listed
 * with a link back to Manufacturing Clearance rather than hidden. Hiding it would leave a buyer
 * hunting for an item that is plainly on the purchase order.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, ClipboardCheck, Loader2, Save, Send } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useToast } from "@/hooks/use-toast";
import { logUserActivity } from "@/lib/activity-logger";
import { formatQuantity, toNumber } from "@/lib/purchase-orders";
import { INSPECTION_PERMISSION_RESOURCE } from "@/lib/supply-gates";
import {
  inspectionPoLineKey,
  validateOfferQty,
  type InspectionLedger,
} from "@/lib/project-management-inspection-quantity";
import {
  INSPECTION_BALANCE_CONFLICT,
  clearedQtyByLineKey,
  createInspectionCall,
  loadInspectionWorkspace,
  type InspectionDraftLine,
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

type CandidateRow = {
  key: string;
  ledger: InspectionLedger;
  boqItemId?: string;
  vendorId: string;
  vendorName: string;
};

export default function NewInspectionCallPage() {
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const router = useRouter();
  const { toast } = useToast();
  const { user } = useAuth();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { context, isResolving, notFound, projectName } =
    useProjectManagementInspectionContext(mappingId);

  const canView = can("View", INSPECTION_PERMISSION_RESOURCE);
  const canRequest = can("Request", INSPECTION_PERMISSION_RESOURCE);

  const [workspace, setWorkspace] = useState<InspectionWorkspace | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const [vendorId, setVendorId] = useState("");
  const [callDate, setCallDate] = useState(today());
  const [inspectorName, setInspectorName] = useState("");
  const [agency, setAgency] = useState("");
  const [remarks, setRemarks] = useState("");
  const [qtyByKey, setQtyByKey] = useState<Record<string, string>>({});

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
      console.error("Failed to load cleared quantity balances:", error);
      toast({ title: "Unable to load cleared quantity balances", variant: "destructive" });
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

  const allCandidates = useMemo<CandidateRow[]>(() => {
    if (!workspace) return [];
    const out: CandidateRow[] = [];
    for (const line of workspace.poLines) {
      const key = inspectionPoLineKey(line.poId, line.poLineId);
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
   * Vendors with at least one line that has cleared quantity left to offer. A vendor whose
   * material is all inspected — or none of it cleared — is dropped rather than offered and then
   * found to be empty.
   */
  const vendorOptions = useMemo(() => {
    const byId = new Map<string, { vendorId: string; vendorName: string; openLines: number }>();
    for (const row of allCandidates) {
      if (!row.vendorId) continue;
      const entry =
        byId.get(row.vendorId) ?? { vendorId: row.vendorId, vendorName: row.vendorName, openLines: 0 };
      if (row.ledger.availableQty > 0) entry.openLines += 1;
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

  const draftLines = useMemo<Array<{ row: CandidateRow; qty: number; error?: string }>>(
    () =>
      rows
        .filter((row) => qtyByKey[row.key] !== undefined && qtyByKey[row.key] !== "")
        .map((row) => {
          const qty = toNumber(qtyByKey[row.key]);
          const check = validateOfferQty(qty, row.ledger);
          return { row, qty, error: check.ok ? undefined : check.message };
        }),
    [rows, qtyByKey],
  );

  const lineErrors = draftLines.filter((line) => line.error);
  const totalQty = draftLines.reduce((sum, line) => sum + line.qty, 0);
  const distinctPoCount = new Set(draftLines.map(({ row }) => row.ledger.poId)).size;
  const awaitingClearanceCount = rows.filter((row) => row.ledger.awaitingClearance).length;
  const canSubmit = draftLines.length > 0 && lineErrors.length === 0 && !isSaving;

  const setQty = (key: string, value: string) =>
    setQtyByKey((current) => ({ ...current, [key]: value }));

  const toggleLine = (row: CandidateRow, checked: boolean) =>
    setQtyByKey((current) => {
      const next = { ...current };
      // Defaulting to the whole cleared balance is the common case — a vendor offers what they
      // have finished making.
      if (checked) next[row.key] = String(row.ledger.availableQty);
      else delete next[row.key];
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
      toast({ title: "Add at least one purchase order line to offer", variant: "destructive" });
      return;
    }
    if (lineErrors.length) {
      toast({
        title: "Fix the highlighted quantities first",
        description: lineErrors[0]?.error,
        variant: "destructive",
      });
      return;
    }

    setIsSaving(true);
    try {
      const lines: InspectionDraftLine[] = draftLines.map(({ row, qty }) => ({
        poId: row.ledger.poId,
        poNumber: row.ledger.poNumber,
        poLineId: row.ledger.poLineId,
        boqItemId: row.boqItemId,
        itemDescription: row.ledger.itemDescription,
        unit: row.ledger.unit,
        offeredQty: qty,
      }));

      const { callNumber } = await createInspectionCall({
        globalProjectId,
        vendorId: vendor.vendorId,
        vendorName: vendor.vendorName,
        callDate,
        inspectorName,
        agency,
        remarks,
        lines,
        clearedQtyByLineKey: clearedQtyByLineKey(workspace?.poLines ?? []),
        submit,
        actor: { id: user.id, name: user.name },
      });

      void logUserActivity({
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        module: context.activityModule,
        action: submit ? "Raise Inspection Call" : "Create Inspection Call Draft",
        details: {
          project: projectName,
          callNumber,
          vendor: vendor.vendorName,
          lines: lines.length,
          offeredQty: totalQty,
          purchaseOrders: [...new Set(lines.map((line) => line.poNumber))],
        },
        recordRef: `${callNumber} · ${vendor.vendorName}`,
      });

      toast({
        title: submit ? `${callNumber} raised` : `${callNumber} saved as draft`,
        description: submit
          ? `${formatQuantity(totalQty)} offered for inspection across ${lines.length} purchase order line(s).`
          : "Draft calls hold no cleared quantity until they are raised.",
      });
      router.push(context.inspectionHref("calls"));
    } catch (error) {
      console.error("Failed to raise the inspection call:", error);
      const message = error instanceof Error ? error.message : "Please try again.";
      toast({
        title: message.includes(INSPECTION_BALANCE_CONFLICT)
          ? "Cleared balance changed"
          : "Unable to raise the inspection call",
        description: message.replace(`${INSPECTION_BALANCE_CONFLICT}: `, ""),
        variant: "destructive",
      });
      // Someone else moved the balance, so the on-screen figures are now wrong.
      if (message.includes(INSPECTION_BALANCE_CONFLICT)) void loadData();
    } finally {
      setIsSaving(false);
    }
  };

  if (isAuthLoading || isResolving) return <InspectionLoadingState />;
  if (!canView) {
    return (
      <InspectionAccessDenied description="You do not have permission to view inspections." />
    );
  }
  if (notFound) {
    return (
      <InspectionProjectNotFound
        description="Return to Project Management and choose a project before raising an inspection call."
        href="/project-management"
      />
    );
  }

  return (
    <PmShell>
      <PmTopbar
        title="New Inspection Call"
        breadcrumbs={[
          { label: "Inspections", href: context.inspectionHref() },
          { label: "New" },
        ]}
        backHref={context.inspectionHref("calls")}
        backLabel="Back to inspection calls"
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={!canRequest || !draftLines.length || isSaving}
              onClick={() => void handleSave(false)}
            >
              <Save className="mr-1.5 h-4 w-4" />
              Save draft
            </Button>
            <Button size="sm" disabled={!canRequest || !canSubmit} onClick={() => void handleSave(true)}>
              {isSaving ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-1.5 h-4 w-4" />
              )}
              Raise call
            </Button>
          </>
        }
      />

      <PmContent>
        {!canRequest && (
          <Card className="mb-4 border-amber-300 bg-amber-50/60">
            <CardContent className="flex items-start gap-2 py-3 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                You can see cleared balances but not raise an inspection call. Ask for the Request
                permission on Inspections.
              </span>
            </CardContent>
          </Card>
        )}

        <Card className="mb-4 border-border/60">
          <CardContent className="grid gap-4 py-4 md:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="ic-vendor">Vendor</Label>
              <Select
                value={vendorId}
                onValueChange={(value) => {
                  setVendorId(value);
                  // Lines belong to the vendor they were picked under.
                  setQtyByKey({});
                }}
              >
                <SelectTrigger id="ic-vendor" className="h-9">
                  <SelectValue
                    placeholder={
                      vendorOptions.length ? "Choose a vendor" : "No vendor has cleared quantity"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {vendorOptions.map((vendor) => (
                    <SelectItem key={vendor.vendorId} value={vendor.vendorId}>
                      {vendor.vendorName} · {vendor.openLines} line
                      {vendor.openLines === 1 ? "" : "s"} offerable
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ic-date">Call date</Label>
              <Input
                id="ic-date"
                type="date"
                className="h-9"
                value={callDate}
                onChange={(event) => setCallDate(event.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ic-inspector">Inspector</Label>
              <Input
                id="ic-inspector"
                className="h-9"
                placeholder="Who will inspect"
                value={inspectorName}
                onChange={(event) => setInspectorName(event.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ic-agency">Agency</Label>
              <Input
                id="ic-agency"
                className="h-9"
                placeholder="SEL QA, client or third party"
                value={agency}
                onChange={(event) => setAgency(event.target.value)}
              />
            </div>

            <div className="space-y-1.5 md:col-span-4">
              <Label htmlFor="ic-remarks">Remarks</Label>
              <Textarea
                id="ic-remarks"
                rows={2}
                placeholder="Anything the inspector needs to know before attending."
                value={remarks}
                onChange={(event) => setRemarks(event.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        <PmSectionHead
          title="Cleared quantity available to inspect"
          stats={[
            { label: "selected", value: String(draftLines.length) },
            { label: "purchase orders", value: String(distinctPoCount) },
            { label: "offered", value: formatQuantity(totalQty) },
            ...(awaitingClearanceCount
              ? [
                  {
                    label: "awaiting clearance",
                    value: String(awaitingClearanceCount),
                    tone: "flag" as const,
                  },
                ]
              : []),
            ...(lineErrors.length
              ? [{ label: "over balance", value: String(lineErrors.length), tone: "flag" as const }]
              : []),
          ]}
        />

        <Card className="overflow-hidden border-border/60">
          {isLoading ? (
            <CardContent className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading cleared quantity balances…
            </CardContent>
          ) : !vendorId ? (
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              <ClipboardCheck className="mx-auto mb-2 h-8 w-8 opacity-40" />
              Choose a vendor to see what has been cleared and is ready to inspect.
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
                      <TableHead className="text-right">Cleared</TableHead>
                      <TableHead className="text-right">Accepted</TableHead>
                      <TableHead className="text-right">Rejected</TableHead>
                      <TableHead className="text-right">Under inspection</TableHead>
                      <TableHead className="text-right">Available</TableHead>
                      <TableHead>Line status</TableHead>
                      <TableHead className="w-32 text-right">Offer</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => {
                      const { ledger } = row;
                      const selected = qtyByKey[row.key] !== undefined;
                      const draft = draftLines.find((line) => line.row.key === row.key);
                      const offerable = ledger.availableQty > 0;
                      return (
                        <TableRow
                          key={row.key}
                          className={
                            draft?.error ? "bg-red-50/60" : !offerable ? "opacity-60" : undefined
                          }
                        >
                          <TableCell>
                            <Checkbox
                              checked={selected}
                              disabled={!offerable || !canRequest}
                              onCheckedChange={(checked) => toggleLine(row, checked === true)}
                              aria-label={`Offer ${ledger.itemDescription} on ${ledger.poNumber}`}
                            />
                          </TableCell>
                          <TableCell className="font-medium">{ledger.poNumber}</TableCell>
                          <TableCell>
                            <span className="block max-w-[20rem] truncate">
                              {ledger.itemDescription}
                            </span>
                          </TableCell>
                          <TableCell className="text-muted-foreground">{ledger.unit}</TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">
                            {formatQuantity(ledger.orderedQty)}
                          </TableCell>
                          <TableCell className="text-right font-medium tabular-nums">
                            {formatQuantity(ledger.clearedQty)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-emerald-700">
                            {ledger.acceptedQty ? formatQuantity(ledger.acceptedQty) : "—"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-red-700">
                            {ledger.rejectedQty ? formatQuantity(ledger.rejectedQty) : "—"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-amber-700">
                            {ledger.offeredPendingQty
                              ? formatQuantity(ledger.offeredPendingQty)
                              : "—"}
                          </TableCell>
                          <TableCell className="text-right font-semibold tabular-nums">
                            {formatQuantity(ledger.availableQty)}
                          </TableCell>
                          <TableCell>
                            {ledger.awaitingClearance ? (
                              <PmStatusPill label="Awaiting MC" tone="neutral" />
                            ) : (
                              <>
                                <PmStatusPill
                                  label={ledger.status}
                                  tone={
                                    ledger.status === "Fully Inspected"
                                      ? "ok"
                                      : ledger.status === "Partially Inspected"
                                        ? "wait"
                                        : "neutral"
                                  }
                                />
                                {ledger.acceptedPct > 0 && !ledger.fullyInspected && (
                                  <span className="ml-1 text-xs text-muted-foreground tabular-nums">
                                    {ledger.acceptedPct}%
                                  </span>
                                )}
                              </>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {ledger.awaitingClearance ? (
                              <Link
                                href={`/project-management/manufacturing-clearance/new?project=${encodeURIComponent(mappingId)}`}
                                className="text-xs text-blue-700 hover:underline"
                              >
                                Clear it first
                              </Link>
                            ) : !offerable ? (
                              <span className="text-xs text-muted-foreground">No balance</span>
                            ) : (
                              <Input
                                type="number"
                                min={0}
                                step="any"
                                inputMode="decimal"
                                className="h-8 w-28 text-right tabular-nums"
                                placeholder="0"
                                disabled={!selected || !canRequest}
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
                    {awaitingClearanceCount} awaiting clearance ·{" "}
                    {rows.filter((row) => row.ledger.fullyInspected).length} fully inspected
                  </>
                }
                right={
                  draftLines.length > 0 ? (
                    <span className="font-medium text-foreground">
                      Offering {formatQuantity(totalQty)} across {draftLines.length} line
                      {draftLines.length === 1 ? "" : "s"}
                    </span>
                  ) : (
                    "Tick a line to offer it"
                  )
                }
              />
            </>
          )}
        </Card>

        {/* A div, not a p: Badge renders a div, and a div inside a p is invalid HTML. */}
        <div className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
          <Badge variant="outline" className="shrink-0 font-normal">
            How the balance works
          </Badge>
          <span>
            Available = Cleared − Accepted − Under inspection. The ceiling is the quantity
            Manufacturing Clearance has approved, not the quantity ordered. Rejected material is not
            deducted — it goes back for rework and can be offered again under the same clearance.
          </span>
        </div>
      </PmContent>
    </PmShell>
  );
}
