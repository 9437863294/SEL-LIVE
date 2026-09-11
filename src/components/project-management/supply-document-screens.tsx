"use client";

/**
 * The document screens for MDCC, DI, GRN and MVAC — one implementation, four stages.
 *
 * These four stages differ in vocabulary, not in shape: present a quantity against PO lines, then
 * record what was accepted. Four copies of a create form and a register would be roughly three
 * thousand lines that have to be kept in step by hand, so the stage definition in
 * `project-management-supply-ledger.ts` supplies the wording and these components supply the
 * behaviour.
 *
 * What that buys beyond less code: a fix to the balance display, or the drift flag, or the
 * decision dialog, lands on all four stages at once instead of three of them.
 */

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  FileStack,
  Hourglass,
  Layers,
  Loader2,
  PencilLine,
  Plus,
  RotateCcw,
  Save,
  Send,
  Trash2,
  Wrench,
} from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useToast } from "@/hooks/use-toast";
import { logUserActivity } from "@/lib/activity-logger";
import { cn } from "@/lib/utils";
import { formatQuantity, toNumber } from "@/lib/purchase-orders";
import { PUNCH_SEVERITIES, type PunchItem, type PunchSeverity } from "@/lib/supply-gates";
import {
  buildSupplyRegisterRows,
  supplyDocStatusStyles,
  supplyItemStatusStyles,
  supplyPoLineKey,
  supplyRejectedQtyOf,
  supplyStage,
  validatePresentedQty,
  validateSupplyDecision,
  type SupplyDocItem,
  type SupplyLedger,
  type SupplyLedgerStage,
} from "@/lib/project-management-supply-ledger";
import {
  SUPPLY_BALANCE_CONFLICT,
  cancelSupplyDoc,
  createSupplyDoc,
  deleteSupplyDraft,
  loadSupplyChain,
  rebuildSupplyBalances,
  recordSupplyDecision,
  syncSupplyGateRecords,
  upstreamQtyByLineKey,
  type SupplyChain,
  type SupplyDecisionLine,
  type SupplyDraftLine,
} from "@/lib/project-management-supply-service";
import {
  PM_TABLE_CLASS,
  PmContent,
  PmSectionHead,
  PmShell,
  PmSidebar,
  PmStatusPill,
  PmTableFoot,
  PmTopbar,
  pmAccent,
} from "@/components/project-management/pm-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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

/** Per-stage screen chrome the ledger definition does not carry. */
export interface SupplyStageChrome {
  /** Route base, e.g. `/project-management/mdcc`. */
  basePath: string;
  gradient: string;
  /** What the deciding party is called: "Client representative", "Transporter", … */
  counterpartyLabel: string;
  /** Extra fields on the create form, kept in the document's `meta` bag. */
  metaFields?: Array<{ key: string; label: string; placeholder?: string }>;
}

export const SUPPLY_STAGE_CHROME: Record<SupplyLedgerStage, SupplyStageChrome> = {
  mdcc: {
    basePath: "/project-management/mdcc",
    gradient: "from-purple-500 to-fuchsia-600",
    counterpartyLabel: "Client representative",
    metaFields: [{ key: "validUntil", label: "Valid until", placeholder: "YYYY-MM-DD" }],
  },
  di: {
    basePath: "/project-management/dispatch-instructions",
    gradient: "from-orange-500 to-amber-600",
    counterpartyLabel: "Transporter",
    metaFields: [
      { key: "consignee", label: "Consignee" },
      { key: "deliveryAddress", label: "Delivery address" },
      { key: "vehicleNo", label: "Vehicle / LR no." },
    ],
  },
  grn: {
    basePath: "/project-management/grn",
    gradient: "from-teal-500 to-cyan-600",
    counterpartyLabel: "Received by",
    metaFields: [{ key: "storeLocation", label: "Store / location" }],
  },
  mvac: {
    basePath: "/project-management/mvac",
    gradient: "from-rose-500 to-pink-600",
    counterpartyLabel: "Client representative",
    metaFields: [],
  },
};

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

const hrefWith = (path: string, mappingId: string, extra = "") =>
  `${path}?project=${encodeURIComponent(mappingId)}${extra}`;

/** Shared project-mapping resolution, matching the other supply screens. */
function useSupplyProject(mappingId: string) {
  const [state, setState] = useState<{
    globalProjectId: string;
    projectName: string;
    isResolving: boolean;
    notFound: boolean;
  }>({ globalProjectId: "", projectName: "", isResolving: Boolean(mappingId), notFound: !mappingId });

  useEffect(() => {
    if (!mappingId) {
      setState({ globalProjectId: "", projectName: "", isResolving: false, notFound: true });
      return;
    }
    let cancelled = false;
    setState((current) => ({ ...current, isResolving: true, notFound: false }));
    void (async () => {
      try {
        const { doc, getDoc } = await import("firebase/firestore");
        const { db } = await import("@/lib/firebase");
        const snapshot = await getDoc(doc(db, "projectManagementProjects", mappingId));
        if (cancelled) return;
        const data = snapshot.exists()
          ? (snapshot.data() as { globalProjectId?: unknown; projectName?: unknown })
          : null;
        const mapped = String(data?.globalProjectId ?? "");
        setState({
          globalProjectId: mapped,
          projectName: String(data?.projectName ?? ""),
          isResolving: false,
          notFound: !mapped,
        });
      } catch (error) {
        console.error("Failed to resolve the Project Management project mapping:", error);
        if (!cancelled) {
          setState({ globalProjectId: "", projectName: "", isResolving: false, notFound: true });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mappingId]);

  return state;
}

function GuardState({ title, description }: { title: string; description: string }) {
  return (
    <main className="min-h-[calc(100dvh-4rem)] p-4 sm:p-6">
      <Card className="mx-auto max-w-lg">
        <CardContent className="py-10 text-center">
          <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" />
          <p className="font-medium">{title}</p>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </CardContent>
      </Card>
    </main>
  );
}

function LoadingState() {
  return (
    <main className="flex min-h-[calc(100dvh-4rem)] items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </main>
  );
}

/* ── Create ─────────────────────────────────────────────────────────────────────────────────── */

type Candidate = {
  key: string;
  ledger: SupplyLedger;
  boqItemId?: string;
  vendorId: string;
  vendorName: string;
  directPath: boolean;
};

export function SupplyDocumentNew({ stage }: { stage: SupplyLedgerStage }) {
  const definition = supplyStage(stage);
  const chrome = SUPPLY_STAGE_CHROME[stage];
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const router = useRouter();
  const { toast } = useToast();
  const { user } = useAuth();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { globalProjectId, projectName, isResolving, notFound } = useSupplyProject(mappingId);

  const canView = can("View", definition.permissionResource);
  const canRaise = can(definition.raiseAction, definition.permissionResource);

  const [chain, setChain] = useState<SupplyChain | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [vendorId, setVendorId] = useState("");
  const [docDate, setDocDate] = useState(today());
  const [counterparty, setCounterparty] = useState("");
  const [meta, setMeta] = useState<Record<string, string>>({});
  const [remarks, setRemarks] = useState("");
  const [qtyByKey, setQtyByKey] = useState<Record<string, string>>({});

  const loadData = useCallback(async () => {
    if (!globalProjectId) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      setChain(await loadSupplyChain(globalProjectId));
    } catch (error) {
      console.error(`Failed to load ${definition.label} balances:`, error);
      toast({ title: `Unable to load ${definition.label} balances`, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [globalProjectId, toast, definition.label]);

  useEffect(() => {
    if (isAuthLoading || !canView) {
      setIsLoading(false);
      return;
    }
    void loadData();
  }, [canView, isAuthLoading, loadData]);

  const state = chain?.stages[stage];

  const allCandidates = useMemo<Candidate[]>(() => {
    if (!state || !chain) return [];
    const out: Candidate[] = [];
    for (const line of state.poLines) {
      const key = supplyPoLineKey(line.poId, line.poLineId);
      const ledger = state.ledgers.get(key);
      if (!ledger) continue;
      const vendor = chain.vendorByPoId.get(line.poId);
      out.push({
        key,
        ledger,
        boqItemId: line.boqItemId,
        vendorId: vendor?.vendorId ?? "",
        vendorName: vendor?.vendorName ?? "Unknown vendor",
        directPath: Boolean(line.directPath),
      });
    }
    return out;
  }, [state, chain]);

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

  const draftLines = useMemo(
    () =>
      rows
        .filter((row) => qtyByKey[row.key] !== undefined && qtyByKey[row.key] !== "")
        .map((row) => {
          const qty = toNumber(qtyByKey[row.key]);
          const check = validatePresentedQty(stage, qty, row.ledger, {
            directPath: row.directPath,
          });
          return { row, qty, error: check.ok ? undefined : check.message };
        }),
    [rows, qtyByKey, stage],
  );

  const lineErrors = draftLines.filter((line) => line.error);
  const totalQty = draftLines.reduce((sum, line) => sum + line.qty, 0);
  const awaitingCount = rows.filter((row) => row.ledger.awaitingUpstream).length;
  const canSubmit = draftLines.length > 0 && lineErrors.length === 0 && !isSaving;

  const toggleLine = (row: Candidate, checked: boolean) =>
    setQtyByKey((current) => {
      const next = { ...current };
      if (checked) next[row.key] = String(row.ledger.availableQty);
      else delete next[row.key];
      return next;
    });

  const handleSave = async (submit: boolean) => {
    if (!globalProjectId || !user || !state) return;
    const vendor = vendorOptions.find((entry) => entry.vendorId === vendorId);
    if (!vendor) {
      toast({ title: "Choose a vendor first", variant: "destructive" });
      return;
    }
    if (!draftLines.length) {
      toast({ title: "Add at least one purchase order line", variant: "destructive" });
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
      const lines: SupplyDraftLine[] = draftLines.map(({ row, qty }) => ({
        poId: row.ledger.poId,
        poNumber: row.ledger.poNumber,
        poLineId: row.ledger.poLineId,
        boqItemId: row.boqItemId,
        itemDescription: row.ledger.itemDescription,
        unit: row.ledger.unit,
        presentedQty: qty,
      }));

      const cleanMeta = Object.fromEntries(
        Object.entries(meta).filter(([, value]) => value.trim()),
      );

      const { docNumber } = await createSupplyDoc({
        globalProjectId,
        stage,
        vendorId: vendor.vendorId,
        vendorName: vendor.vendorName,
        docDate,
        counterparty,
        meta: cleanMeta,
        remarks,
        lines,
        upstreamQtyByLineKey: upstreamQtyByLineKey(state),
        submit,
        actor: { id: user.id, name: user.name },
      });

      void logUserActivity({
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        module: "Project Management",
        action: submit ? `Raise ${definition.label}` : `Create ${definition.label} Draft`,
        details: {
          project: projectName,
          docNumber,
          vendor: vendor.vendorName,
          lines: lines.length,
          presentedQty: totalQty,
          purchaseOrders: [...new Set(lines.map((line) => line.poNumber))],
        },
        recordRef: `${docNumber} · ${vendor.vendorName}`,
      });

      toast({
        title: submit ? `${docNumber} raised` : `${docNumber} saved as draft`,
        description: submit
          ? `${formatQuantity(totalQty)} on ${lines.length} purchase order line(s).`
          : `Draft ${definition.docNoun}s hold no quantity until they are raised.`,
      });
      router.push(hrefWith(`${chrome.basePath}/documents`, mappingId));
    } catch (error) {
      console.error(`Failed to raise the ${definition.docNoun}:`, error);
      const message = error instanceof Error ? error.message : "Please try again.";
      toast({
        title: message.includes(SUPPLY_BALANCE_CONFLICT)
          ? "Available balance changed"
          : `Unable to raise the ${definition.docNoun}`,
        description: message.replace(`${SUPPLY_BALANCE_CONFLICT}: `, ""),
        variant: "destructive",
      });
      if (message.includes(SUPPLY_BALANCE_CONFLICT)) void loadData();
    } finally {
      setIsSaving(false);
    }
  };

  if (isAuthLoading || isResolving) return <LoadingState />;
  if (!canView) {
    return (
      <GuardState
        title="Access denied"
        description={`You do not have permission to view ${definition.label}.`}
      />
    );
  }
  if (notFound) {
    return (
      <GuardState
        title="Project not found"
        description="Return to Project Management and choose a project first."
      />
    );
  }

  return (
    <PmShell>
      <PmTopbar
        title={`New ${definition.label}`}
        breadcrumbs={[
          { label: definition.label, href: hrefWith(`${chrome.basePath}/documents`, mappingId) },
          { label: "New" },
        ]}
        backHref={hrefWith(`${chrome.basePath}/documents`, mappingId)}
        backLabel={`Back to ${definition.label} documents`}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={!canRaise || !draftLines.length || isSaving}
              onClick={() => void handleSave(false)}
            >
              <Save className="mr-1.5 h-4 w-4" />
              Save draft
            </Button>
            <Button size="sm" disabled={!canRaise || !canSubmit} onClick={() => void handleSave(true)}>
              {isSaving ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-1.5 h-4 w-4" />
              )}
              Raise {definition.label}
            </Button>
          </>
        }
      />

      <PmContent>
        {!canRaise && (
          <Card className="mb-4 border-amber-300 bg-amber-50/60">
            <CardContent className="flex items-start gap-2 py-3 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                You can see balances but not raise a {definition.docNoun}. Ask for the{" "}
                {definition.raiseAction} permission on {definition.label}.
              </span>
            </CardContent>
          </Card>
        )}

        <Card className="mb-4 border-border/60">
          <CardContent className="grid gap-4 py-4 md:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="supply-vendor">Vendor</Label>
              <Select
                value={vendorId}
                onValueChange={(value) => {
                  setVendorId(value);
                  setQtyByKey({});
                }}
              >
                <SelectTrigger id="supply-vendor" className="h-9">
                  <SelectValue
                    placeholder={vendorOptions.length ? "Choose a vendor" : "No vendor has balance"}
                  />
                </SelectTrigger>
                <SelectContent>
                  {vendorOptions.map((vendor) => (
                    <SelectItem key={vendor.vendorId} value={vendor.vendorId}>
                      {vendor.vendorName} · {vendor.openLines} line
                      {vendor.openLines === 1 ? "" : "s"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="supply-date">Date</Label>
              <Input
                id="supply-date"
                type="date"
                className="h-9"
                value={docDate}
                onChange={(event) => setDocDate(event.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="supply-counterparty">{chrome.counterpartyLabel}</Label>
              <Input
                id="supply-counterparty"
                className="h-9"
                value={counterparty}
                onChange={(event) => setCounterparty(event.target.value)}
              />
            </div>

            {(chrome.metaFields ?? []).map((field) => (
              <div key={field.key} className="space-y-1.5">
                <Label htmlFor={`meta-${field.key}`}>{field.label}</Label>
                <Input
                  id={`meta-${field.key}`}
                  className="h-9"
                  placeholder={field.placeholder}
                  value={meta[field.key] ?? ""}
                  onChange={(event) =>
                    setMeta((current) => ({ ...current, [field.key]: event.target.value }))
                  }
                />
              </div>
            ))}

            <div className="space-y-1.5 md:col-span-4">
              <Label htmlFor="supply-remarks">Remarks</Label>
              <Textarea
                id="supply-remarks"
                rows={2}
                value={remarks}
                onChange={(event) => setRemarks(event.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        <PmSectionHead
          title={`Quantity available for ${definition.label}`}
          stats={[
            { label: "selected", value: String(draftLines.length) },
            { label: definition.presentedLabel.toLowerCase(), value: formatQuantity(totalQty) },
            ...(awaitingCount
              ? [{ label: "awaiting upstream", value: String(awaitingCount), tone: "flag" as const }]
              : []),
            ...(lineErrors.length
              ? [{ label: "over balance", value: String(lineErrors.length), tone: "flag" as const }]
              : []),
          ]}
        />

        <Card className="overflow-hidden border-border/60">
          {isLoading ? (
            <CardContent className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading balances…
            </CardContent>
          ) : !vendorId ? (
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              <FileStack className="mx-auto mb-2 h-8 w-8 opacity-40" />
              Choose a vendor to see what is available.
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
                      <TableHead className="text-right">Upstream</TableHead>
                      <TableHead className="text-right">{definition.acceptedLabel}</TableHead>
                      <TableHead className="text-right">In flight</TableHead>
                      <TableHead className="text-right">Available</TableHead>
                      <TableHead>Line</TableHead>
                      <TableHead className="w-32 text-right">{definition.presentedLabel}</TableHead>
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
                              disabled={!offerable || !canRaise}
                              onCheckedChange={(checked) => toggleLine(row, checked === true)}
                              aria-label={`Add ${ledger.itemDescription}`}
                            />
                          </TableCell>
                          <TableCell className="font-medium">{ledger.poNumber}</TableCell>
                          <TableCell>
                            <span className="block max-w-[18rem] truncate">
                              {ledger.itemDescription}
                            </span>
                            {row.directPath && (
                              <span className="text-xs text-muted-foreground">direct path</span>
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground">{ledger.unit}</TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">
                            {formatQuantity(ledger.orderedQty)}
                          </TableCell>
                          <TableCell className="text-right font-medium tabular-nums">
                            {formatQuantity(ledger.upstreamQty)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-emerald-700">
                            {ledger.acceptedQty ? formatQuantity(ledger.acceptedQty) : "—"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-amber-700">
                            {ledger.inFlightQty ? formatQuantity(ledger.inFlightQty) : "—"}
                          </TableCell>
                          <TableCell className="text-right font-semibold tabular-nums">
                            {formatQuantity(ledger.availableQty)}
                          </TableCell>
                          <TableCell>
                            {ledger.awaitingUpstream ? (
                              <PmStatusPill label="Awaiting upstream" tone="neutral" />
                            ) : (
                              <PmStatusPill
                                label={ledger.status}
                                tone={
                                  ledger.status === "Complete"
                                    ? "ok"
                                    : ledger.status === "Partial"
                                      ? "wait"
                                      : "neutral"
                                }
                              />
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {!offerable ? (
                              <span className="text-xs text-muted-foreground">No balance</span>
                            ) : (
                              <Input
                                type="number"
                                min={0}
                                step="any"
                                inputMode="decimal"
                                className="h-8 w-28 text-right tabular-nums"
                                placeholder="0"
                                disabled={!selected || !canRaise}
                                value={qtyByKey[row.key] ?? ""}
                                onChange={(event) =>
                                  setQtyByKey((current) => ({
                                    ...current,
                                    [row.key]: event.target.value,
                                  }))
                                }
                                aria-invalid={Boolean(draft?.error)}
                              />
                            )}
                            {draft?.error && (
                              <p className="mt-1 max-w-[16rem] text-right text-xs text-red-700">
                                {draft.error}
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
                    {rows.length} line{rows.length === 1 ? "" : "s"} · {awaitingCount} awaiting
                    upstream
                  </>
                }
                right={
                  draftLines.length > 0 ? (
                    <span className="font-medium text-foreground">
                      {formatQuantity(totalQty)} across {draftLines.length} line
                      {draftLines.length === 1 ? "" : "s"}
                    </span>
                  ) : (
                    "Tick a line to add it"
                  )
                }
              />
            </>
          )}
        </Card>
      </PmContent>
    </PmShell>
  );
}

/* ── Register ───────────────────────────────────────────────────────────────────────────────── */

const VIEWS = [
  { key: "all", label: "All documents", icon: Layers },
  { key: "Draft", label: "Drafts", icon: PencilLine },
  { key: "Open", label: "Awaiting decision", icon: Hourglass },
  { key: "Completed", label: "Completed", icon: CheckCircle2 },
  { key: "rejected", label: "Rejected quantity", icon: Wrench },
  { key: "Cancelled", label: "Cancelled", icon: Ban },
] as const;

type ViewKey = (typeof VIEWS)[number]["key"];

type DecisionDraft = {
  acceptedQty: string;
  shortQty: string;
  damagedQty: string;
  observation: string;
  severity: PunchSeverity;
  remarks: string;
};

export function SupplyDocumentRegister({ stage }: { stage: SupplyLedgerStage }) {
  const definition = supplyStage(stage);
  const chrome = SUPPLY_STAGE_CHROME[stage];
  const searchParams = useSearchParams();
  const router = useRouter();
  const mappingId = searchParams?.get("project") ?? "";
  const view = (searchParams?.get("view") ?? "all") as ViewKey;
  const { toast } = useToast();
  const { user } = useAuth();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { globalProjectId, projectName, isResolving, notFound } = useSupplyProject(mappingId);

  const canView = can("View", definition.permissionResource);
  const canRaise = can(definition.raiseAction, definition.permissionResource);
  const canComplete = can(definition.completeAction, definition.permissionResource);

  const [chain, setChain] = useState<SupplyChain | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [decisionDocId, setDecisionDocId] = useState("");
  const [decidedDate, setDecidedDate] = useState(today());
  const [counterparty, setCounterparty] = useState("");
  const [decisionByItemId, setDecisionByItemId] = useState<Record<string, DecisionDraft>>({});

  const loadData = useCallback(async () => {
    if (!globalProjectId) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      setChain(await loadSupplyChain(globalProjectId));
    } catch (error) {
      console.error(`Failed to load ${definition.label} documents:`, error);
      toast({ title: `Unable to load ${definition.label} documents`, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [globalProjectId, toast, definition.label]);

  useEffect(() => {
    if (isAuthLoading || !canView) {
      setIsLoading(false);
      return;
    }
    void loadData();
  }, [canView, isAuthLoading, loadData]);

  const state = chain?.stages[stage];

  const itemsByDocId = useMemo(() => {
    const map = new Map<string, SupplyDocItem[]>();
    for (const item of state?.items ?? []) {
      const list = map.get(item.docId) ?? [];
      list.push(item);
      map.set(item.docId, list);
    }
    return map;
  }, [state]);

  const allRows = useMemo(
    () =>
      buildSupplyRegisterRows(state?.docs ?? [], state?.items ?? []).sort(
        (a, b) => b.docDate.localeCompare(a.docDate) || b.docNumber.localeCompare(a.docNumber),
      ),
    [state],
  );

  const matchesView = useCallback((row: (typeof allRows)[number], key: ViewKey) => {
    if (key === "all") return true;
    if (key === "rejected") return row.rejectedQty > 0;
    if (key === "Open") return row.status === "Open" || row.status === "Partially Completed";
    return row.status === key;
  }, []);

  const rows = useMemo(() => allRows.filter((row) => matchesView(row, view)), [allRows, matchesView, view]);
  const countFor = useCallback(
    (key: ViewKey) => allRows.filter((row) => matchesView(row, key)).length,
    [allRows, matchesView],
  );

  const setView = (value: string) => {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (value === "all") params.delete("view");
    else params.set("view", value);
    router.replace(`${chrome.basePath}/documents?${params.toString()}`);
  };

  const decisionLines = useMemo(
    () => (itemsByDocId.get(decisionDocId) ?? []).filter((item) => item.status === "Pending"),
    [itemsByDocId, decisionDocId],
  );

  const openDecision = (docId: string) => {
    const pending = (itemsByDocId.get(docId) ?? []).filter((item) => item.status === "Pending");
    setDecisionDocId(docId);
    setDecidedDate(today());
    setCounterparty(state?.docs.find((entry) => entry.id === docId)?.counterparty ?? "");
    setDecisionByItemId(
      Object.fromEntries(
        pending.map((item) => [
          item.id,
          {
            // Full acceptance is the common case.
            acceptedQty: String(toNumber(item.presentedQty)),
            shortQty: "",
            damagedQty: "",
            observation: "",
            severity: "Minor" as PunchSeverity,
            remarks: "",
          },
        ]),
      ),
    );
  };

  const decisionErrors = useMemo(
    () =>
      decisionLines
        .map((item) => {
          const draft = decisionByItemId[item.id];
          if (!draft) return null;
          const check = validateSupplyDecision(
            stage,
            toNumber(item.presentedQty),
            toNumber(draft.acceptedQty),
          );
          return check.ok ? null : { itemId: item.id, message: check.message! };
        })
        .filter((entry): entry is { itemId: string; message: string } => entry !== null),
    [decisionLines, decisionByItemId, stage],
  );

  /** Running totals for the decision dialog's footer. A document routinely covers several PO lines,
   * and the per-line figures never add themselves up — this is what the document will commit. */
  const decisionTotals = useMemo(() => {
    let presented = 0;
    let accepted = 0;
    for (const item of decisionLines) {
      const linePresented = toNumber(item.presentedQty);
      presented += linePresented;
      accepted += Math.min(toNumber(decisionByItemId[item.id]?.acceptedQty), linePresented);
    }
    const round = (value: number) => Math.round(value * 1000) / 1000;
    return {
      presented: round(presented),
      accepted: round(accepted),
      notAccepted: round(Math.max(0, presented - accepted)),
    };
  }, [decisionLines, decisionByItemId]);

  /** The document being decided, for the dialog's header context. */
  const decisionDoc = useMemo(
    () => state?.docs.find((entry) => entry.id === decisionDocId) ?? null,
    [state, decisionDocId],
  );

  const handleRecord = async () => {
    if (!globalProjectId || !user || !decisionDocId) return;
    if (decisionErrors.length) {
      toast({
        title: "Fix the highlighted quantities first",
        description: decisionErrors[0].message,
        variant: "destructive",
      });
      return;
    }
    const docNumber =
      state?.docs.find((entry) => entry.id === decisionDocId)?.docNumber ?? decisionDocId;
    setBusyId(decisionDocId);
    try {
      const decisions: SupplyDecisionLine[] = decisionLines.map((item) => {
        const draft = decisionByItemId[item.id];
        const observations: PunchItem[] = draft?.observation.trim()
          ? [
              {
                punchId: `obs_${item.id}`,
                description: draft.observation.trim(),
                severity: draft.severity,
                closed: false,
              },
            ]
          : [];
        return {
          itemId: item.id,
          acceptedQty: toNumber(draft?.acceptedQty),
          observations,
          remarks: draft?.remarks,
          ...(stage === "grn"
            ? {
                shortQty: toNumber(draft?.shortQty),
                damagedQty: toNumber(draft?.damagedQty),
              }
            : {}),
        };
      });

      await recordSupplyDecision({
        globalProjectId,
        stage,
        docId: decisionDocId,
        decidedDate,
        counterparty,
        decisions,
        actor: { id: user.id, name: user.name },
      });

      const acceptedTotal = decisions.reduce((sum, entry) => sum + entry.acceptedQty, 0);
      const presentedTotal = decisionLines.reduce(
        (sum, item) => sum + toNumber(item.presentedQty),
        0,
      );

      void logUserActivity({
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        module: "Project Management",
        action: `Record ${definition.label} Outcome`,
        details: {
          project: projectName,
          docNumber,
          lines: decisions.length,
          presentedQty: presentedTotal,
          acceptedQty: acceptedTotal,
        },
        recordId: decisionDocId,
        recordRef: docNumber,
      });

      toast({
        title: `${docNumber} recorded`,
        description:
          presentedTotal > acceptedTotal
            ? `${formatQuantity(presentedTotal - acceptedTotal)} not accepted and returned to the balance.`
            : `${formatQuantity(acceptedTotal)} ${definition.acceptedLabel.toLowerCase()}.`,
      });
      setDecisionDocId("");
      await loadData();
    } catch (error) {
      console.error(`Failed to record the ${definition.docNoun} outcome:`, error);
      toast({
        title: `Unable to record ${docNumber}`,
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusyId("");
    }
  };

  const handleCancel = async (docId: string, docNumber: string) => {
    if (!globalProjectId || !user) return;
    setBusyId(docId);
    try {
      await cancelSupplyDoc({
        globalProjectId,
        stage,
        docId,
        actor: { id: user.id, name: user.name },
      });
      toast({
        title: `${docNumber} cancelled`,
        description: "The quantity it was holding has been released.",
      });
      await loadData();
    } catch (error) {
      console.error(`Failed to cancel the ${definition.docNoun}:`, error);
      toast({
        title: `Unable to cancel ${docNumber}`,
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusyId("");
    }
  };

  const handleDelete = async (docId: string, docNumber: string) => {
    if (!globalProjectId) return;
    setBusyId(docId);
    try {
      await deleteSupplyDraft(globalProjectId, stage, docId);
      toast({ title: `${docNumber} deleted` });
      await loadData();
    } catch (error) {
      console.error(`Failed to delete the draft ${definition.docNoun}:`, error);
      toast({
        title: `Unable to delete ${docNumber}`,
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusyId("");
    }
  };

  const handleRebuild = async () => {
    if (!globalProjectId) return;
    setBusyId("rebuild");
    try {
      const written = await rebuildSupplyBalances(globalProjectId, stage);
      const gates = await syncSupplyGateRecords(globalProjectId, stage);
      toast({
        title: "Balances rebuilt",
        description: `${written} line balance${written === 1 ? "" : "s"} recomputed and ${gates} item gate${gates === 1 ? "" : "s"} brought in line.`,
      });
      await loadData();
    } catch (error) {
      console.error("Failed to rebuild balances:", error);
      toast({ title: "Unable to rebuild balances", variant: "destructive" });
    } finally {
      setBusyId("");
    }
  };

  if (isAuthLoading || isResolving) return <LoadingState />;
  if (!canView) {
    return (
      <GuardState
        title="Access denied"
        description={`You do not have permission to view ${definition.label}.`}
      />
    );
  }
  if (notFound) {
    return (
      <GuardState
        title="Project not found"
        description="Return to Project Management and choose a project first."
      />
    );
  }

  const presentedTotal = rows.reduce((sum, row) => sum + row.presentedQty, 0);
  const acceptedTotal = rows.reduce((sum, row) => sum + row.acceptedQty, 0);
  const rejectedTotal = rows.reduce((sum, row) => sum + row.rejectedQty, 0);
  const blockingTotal = rows.reduce((sum, row) => sum + row.blockingObservationCount, 0);

  return (
    <PmShell
      sidebar={
        <PmSidebar
          title={`${definition.label} Documents`}
          subtitle={projectName}
          icon={FileStack}
          gradient={chrome.gradient}
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
        />
      }
    >
      <PmTopbar
        title={`${definition.label} Documents`}
        // This register is the only screen under the module base, so its parent is the Supply hub
        // rather than a module landing page.
        breadcrumbs={[
          { label: projectName || "Project" },
          { label: definition.label, href: hrefWith(`${chrome.basePath}/documents`, mappingId) },
        ]}
        backHref={hrefWith("/project-management/supply", mappingId)}
        backLabel="Back to Supply"
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={busyId === "rebuild" || !canComplete}
              onClick={() => void handleRebuild()}
              title="Recompute line balances and item gates from the documents."
            >
              {busyId === "rebuild" ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <RotateCcw className="mr-1.5 h-4 w-4" />
              )}
              Rebuild balances
            </Button>
            <Button size="sm" disabled={!canRaise} asChild={canRaise}>
              {canRaise ? (
                <Link href={hrefWith(`${chrome.basePath}/new`, mappingId)}>
                  <Plus className="mr-1.5 h-4 w-4" />
                  New {definition.label}
                </Link>
              ) : (
                <span>
                  <Plus className="mr-1.5 h-4 w-4" />
                  New {definition.label}
                </span>
              )}
            </Button>
          </>
        }
      />

      <PmContent>
        <PmSectionHead
          title={VIEWS.find((entry) => entry.key === view)?.label ?? "All documents"}
          stats={[
            { label: "documents", value: String(rows.length) },
            { label: definition.presentedLabel.toLowerCase(), value: formatQuantity(presentedTotal) },
            { label: definition.acceptedLabel.toLowerCase(), value: formatQuantity(acceptedTotal) },
            ...(rejectedTotal
              ? [{ label: "not accepted", value: formatQuantity(rejectedTotal), tone: "flag" as const }]
              : []),
            ...(blockingTotal
              ? [{ label: "blocked by observation", value: String(blockingTotal), tone: "flag" as const }]
              : []),
          ]}
        />

        <Card className="overflow-hidden border-border/60">
          {isLoading ? (
            <CardContent className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading documents…
            </CardContent>
          ) : rows.length === 0 ? (
            <CardContent className="py-12 text-center">
              <FileStack className="mx-auto mb-3 h-9 w-9 text-muted-foreground/40" />
              <p className="text-sm font-medium">
                {allRows.length === 0
                  ? `No ${definition.docNoun} has been raised yet`
                  : `No ${(VIEWS.find((entry) => entry.key === view)?.label ?? "").toLowerCase()}`}
              </p>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                A {definition.docNoun} may only cover quantity the stage above it has passed down.
              </p>
              {canRaise && allRows.length === 0 && (
                <Button size="sm" className="mt-4" asChild>
                  <Link href={hrefWith(`${chrome.basePath}/new`, mappingId)}>
                    <Plus className="mr-1.5 h-4 w-4" />
                    Raise the first one
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
                      <TableHead>Number</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Decided</TableHead>
                      <TableHead>Vendor</TableHead>
                      <TableHead className="text-right">Lines</TableHead>
                      <TableHead className="text-right">{definition.presentedLabel}</TableHead>
                      <TableHead className="text-right">{definition.acceptedLabel}</TableHead>
                      <TableHead className="text-right">Not accepted</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="w-40 text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => {
                      const isOpen = expanded.has(row.docId);
                      const lines = itemsByDocId.get(row.docId) ?? [];
                      const isBusy = busyId === row.docId;
                      const isLive =
                        row.status === "Open" || row.status === "Partially Completed";
                      return (
                        <Fragment key={row.docId}>
                          <TableRow
                            className="cursor-pointer hover:bg-muted/40"
                            onClick={() =>
                              setExpanded((current) => {
                                const next = new Set(current);
                                if (next.has(row.docId)) next.delete(row.docId);
                                else next.add(row.docId);
                                return next;
                              })
                            }
                          >
                            <TableCell>
                              {isOpen ? (
                                <ChevronDown className="h-4 w-4 text-muted-foreground" />
                              ) : (
                                <ChevronRight className="h-4 w-4 text-muted-foreground" />
                              )}
                            </TableCell>
                            <TableCell className="font-medium">{row.docNumber}</TableCell>
                            <TableCell className="text-muted-foreground">
                              {formatDate(row.docDate)}
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {formatDate(row.decidedDate)}
                            </TableCell>
                            <TableCell>{row.vendorName || "—"}</TableCell>
                            <TableCell className="text-right tabular-nums">
                              {row.itemCount}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatQuantity(row.presentedQty)}
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
                                className={`border-transparent ${supplyDocStatusStyles[row.status]}`}
                              >
                                {row.status}
                              </Badge>
                              {row.blockingObservationCount > 0 && (
                                <span
                                  className="ml-1 inline-flex items-center gap-0.5 text-xs text-amber-700"
                                  title="Open Critical or Major observations block downstream release"
                                >
                                  <AlertTriangle className="h-3 w-3" />
                                  {row.blockingObservationCount}
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
                                  {canComplete && (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-7 px-2 text-blue-700"
                                      onClick={() => openDecision(row.docId)}
                                    >
                                      <ClipboardCheck className="mr-1 h-3.5 w-3.5" />
                                      Record
                                    </Button>
                                  )}
                                  {canRaise && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-7 px-2 text-muted-foreground"
                                      onClick={() => void handleCancel(row.docId, row.docNumber)}
                                    >
                                      <Ban className="mr-1 h-3.5 w-3.5" />
                                      Cancel
                                    </Button>
                                  )}
                                </div>
                              ) : row.status === "Draft" && canRaise ? (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-2 text-muted-foreground"
                                  onClick={() => void handleDelete(row.docId, row.docNumber)}
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
                              const ledger = state?.ledgers.get(
                                supplyPoLineKey(line.poId, line.poLineId),
                              );
                              const rejected = supplyRejectedQtyOf(line);
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
                                  <TableCell className="text-right text-xs text-muted-foreground">
                                    {line.unit}
                                  </TableCell>
                                  <TableCell className="text-right tabular-nums">
                                    {formatQuantity(line.presentedQty)}
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
                                      className={`border-transparent text-[11px] ${supplyItemStatusStyles[line.status]}`}
                                    >
                                      {line.status}
                                    </Badge>
                                  </TableCell>
                                  <TableCell className="text-right text-xs text-muted-foreground">
                                    {ledger ? `${ledger.acceptedPct}% of upstream` : ""}
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
                    {rows.length} document{rows.length === 1 ? "" : "s"} · click a row to see its
                    lines
                  </>
                }
                right={
                  <span className="font-medium text-foreground">
                    {formatQuantity(acceptedTotal)} {definition.acceptedLabel.toLowerCase()} of{" "}
                    {formatQuantity(presentedTotal)}
                  </span>
                }
              />
            </>
          )}
        </Card>
      </PmContent>

      <Dialog
        open={Boolean(decisionDocId)}
        onOpenChange={(open) => !open && setDecisionDocId("")}
      >
        {/* `size="xl"` rather than a `max-w-*` class: DialogContent defaults to size="full", whose
            `sm:max-w-[1800px]` an unprefixed `max-w-*` cannot override — tailwind-merge only
            resolves conflicts within the same variant. The preset also brings `max-h-[90vh]`, so
            the shell's `flex flex-col` lets the line list own the scroll and the footer stay put. */}
        <DialogContent size="xl" className="gap-4">
          <DialogHeader className="space-y-1.5 pr-8">
            <DialogTitle className="flex flex-wrap items-center gap-2">
              <span>Record {definition.label} outcome</span>
              {decisionDoc?.docNumber && (
                <Badge variant="outline" className="font-mono text-xs font-normal">
                  {decisionDoc.docNumber}
                </Badge>
              )}
            </DialogTitle>
            <DialogDescription>
              {definition.acceptedLabel} quantity flows to the next stage. Anything short of the{" "}
              {definition.presentedLabel.toLowerCase()} quantity returns to the balance.
            </DialogDescription>
          </DialogHeader>

          {/* Who decided and when — one panel, visually separate from the per-line work below. */}
          <div className="grid shrink-0 gap-3 rounded-lg border border-border/60 bg-muted/30 p-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
            <div className="space-y-1.5">
              <Label htmlFor="decision-date" className="text-xs">
                Date
              </Label>
              <Input
                id="decision-date"
                type="date"
                className="h-9 bg-background"
                value={decidedDate}
                onChange={(event) => setDecidedDate(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="decision-party" className="text-xs">
                {chrome.counterpartyLabel}
              </Label>
              <Input
                id="decision-party"
                className="h-9 bg-background"
                placeholder={chrome.counterpartyLabel}
                value={counterparty}
                onChange={(event) => setCounterparty(event.target.value)}
              />
            </div>
          </div>

          {/* The lines own the remaining height rather than a fixed 45vh, so a two-line document is
              not padded out and a ten-line one uses the whole dialog. */}
          <div className="-mx-1 min-h-0 flex-1 space-y-3 overflow-y-auto px-1">
            {decisionLines.map((item) => {
              const draft = decisionByItemId[item.id];
              const presented = toNumber(item.presentedQty);
              const accepted = toNumber(draft?.acceptedQty);
              const notAccepted = Math.max(0, Math.round((presented - accepted) * 1000) / 1000);
              const error = decisionErrors.find((entry) => entry.itemId === item.id);
              const update = (patch: Partial<DecisionDraft>) =>
                setDecisionByItemId((current) => ({
                  ...current,
                  [item.id]: { ...current[item.id], ...patch },
                }));
              // Preview of the outcome this input produces, so the verdict is visible while the
              // quantity is being typed rather than only after the document is committed.
              const outcome =
                accepted <= 0
                  ? "Rejected"
                  : notAccepted > 0
                    ? "Partially accepted"
                    : "Accepted";
              const outcomeStyle =
                outcome === "Partially accepted"
                  ? "bg-amber-100 text-amber-800"
                  : supplyItemStatusStyles[outcome];
              return (
                <Card
                  key={item.id}
                  className={cn(
                    "overflow-hidden",
                    error ? "border-red-300 bg-red-50/40" : "border-border/60",
                  )}
                >
                  <CardContent className="space-y-3 p-4">
                    {/* What is being judged, and the verdict this input currently produces. */}
                    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium leading-snug">{item.itemDescription}</p>
                        <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                          {item.poNumber}
                        </p>
                      </div>
                      <Badge variant="outline" className={cn("shrink-0", outcomeStyle)}>
                        {outcome}
                      </Badge>
                    </div>

                    {/* The quantity decision, as the arithmetic it actually is: presented is fixed,
                        accepted is the only input, the shortfall falls out of the two. Showing all
                        three together is what stops a mis-keyed figure going unnoticed. */}
                    <div className="grid grid-cols-3 items-end gap-3 rounded-lg border border-border/60 bg-muted/30 p-3">
                      <div className="min-w-0">
                        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                          {definition.presentedLabel}
                        </p>
                        <p className="mt-1 truncate text-base font-semibold tabular-nums">
                          {formatQuantity(presented)}
                          <span className="ml-1 text-xs font-normal text-muted-foreground">
                            {item.unit}
                          </span>
                        </p>
                      </div>

                      <div className="min-w-0 space-y-1">
                        <Label
                          htmlFor={`acc-${item.id}`}
                          className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
                        >
                          {definition.acceptedLabel}
                        </Label>
                        <Input
                          id={`acc-${item.id}`}
                          type="number"
                          min={0}
                          step="any"
                          inputMode="decimal"
                          className="h-9 bg-background text-right text-base font-semibold tabular-nums"
                          value={draft?.acceptedQty ?? ""}
                          onChange={(event) => update({ acceptedQty: event.target.value })}
                          aria-invalid={Boolean(error)}
                        />
                      </div>

                      <div className="min-w-0">
                        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                          Not accepted
                        </p>
                        <p
                          className={cn(
                            "mt-1 truncate text-base font-semibold tabular-nums",
                            notAccepted > 0 ? "text-red-700" : "text-muted-foreground",
                          )}
                        >
                          {formatQuantity(notAccepted)}
                          <span className="ml-1 text-xs font-normal text-muted-foreground">
                            {item.unit}
                          </span>
                        </p>
                      </div>
                    </div>

                    {/* GRN alone splits the shortfall into its causes — the two are a breakdown of
                        "not accepted" above, not extra quantities on top of it. */}
                    {stage === "grn" && (
                      <div className="grid grid-cols-2 gap-3 sm:max-w-sm">
                        <div className="space-y-1">
                          <Label htmlFor={`short-${item.id}`} className="text-xs">
                            Short
                          </Label>
                          <Input
                            id={`short-${item.id}`}
                            type="number"
                            min={0}
                            step="any"
                            inputMode="decimal"
                            className="h-9 text-right tabular-nums"
                            value={draft?.shortQty ?? ""}
                            onChange={(event) => update({ shortQty: event.target.value })}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor={`dmg-${item.id}`} className="text-xs">
                            Damaged
                          </Label>
                          <Input
                            id={`dmg-${item.id}`}
                            type="number"
                            min={0}
                            step="any"
                            inputMode="decimal"
                            className="h-9 text-right tabular-nums"
                            value={draft?.damagedQty ?? ""}
                            onChange={(event) => update({ damagedQty: event.target.value })}
                          />
                        </div>
                      </div>
                    )}

                    {/* Secondary to the quantity: an observation only matters once something passed. */}
                    <div
                      className={cn(
                        "grid gap-3",
                        stage !== "grn" && "sm:grid-cols-[minmax(0,1fr)_10rem]",
                      )}
                    >
                      <div className="space-y-1">
                        <Label htmlFor={`obs-${item.id}`} className="text-xs">
                          Observation <span className="text-muted-foreground">(optional)</span>
                        </Label>
                        <Input
                          id={`obs-${item.id}`}
                          className="h-9"
                          placeholder="To be closed out"
                          value={draft?.observation ?? ""}
                          onChange={(event) => update({ observation: event.target.value })}
                        />
                      </div>

                      {stage !== "grn" && (
                        <div className="space-y-1">
                          <Label className="text-xs">Severity</Label>
                          <Select
                            value={draft?.severity ?? "Minor"}
                            onValueChange={(value) => update({ severity: value as PunchSeverity })}
                            // A severity with nothing to describe is noise; the field only becomes
                            // meaningful once an observation has been written.
                            disabled={!draft?.observation?.trim()}
                          >
                            <SelectTrigger className="h-9">
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
                      )}
                    </div>

                    {(notAccepted > 0 || error) && (
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                        {notAccepted > 0 && !error && (
                          <span className="flex items-center gap-1.5 text-red-700">
                            <RotateCcw className="h-3.5 w-3.5 shrink-0" />
                            {formatQuantity(notAccepted)} {item.unit} returns to the balance
                          </span>
                        )}
                        {error && (
                          <span className="flex items-center gap-1.5 font-medium text-red-700">
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                            {error.message}
                          </span>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
            {decisionLines.length === 0 && (
              <div className="flex flex-col items-center gap-2 py-10 text-center">
                <ClipboardCheck className="h-8 w-8 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">
                  Every line on this document already has an outcome.
                </p>
              </div>
            )}
          </div>

          {/* What the whole document commits, beside the button that commits it. */}
          <DialogFooter className="shrink-0 flex-col-reverse gap-3 border-t border-border/60 pt-4 sm:flex-row sm:items-center sm:justify-between">
            {decisionLines.length > 0 && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground sm:mr-auto">
                <span>
                  {decisionLines.length} line{decisionLines.length === 1 ? "" : "s"}
                </span>
                <span>
                  {definition.acceptedLabel}{" "}
                  <strong className="font-semibold tabular-nums text-emerald-700">
                    {formatQuantity(decisionTotals.accepted)}
                  </strong>{" "}
                  of {formatQuantity(decisionTotals.presented)}
                </span>
                {decisionTotals.notAccepted > 0 && (
                  <span>
                    Not accepted{" "}
                    <strong className="font-semibold tabular-nums text-red-700">
                      {formatQuantity(decisionTotals.notAccepted)}
                    </strong>
                  </span>
                )}
              </div>
            )}
            <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDecisionDocId("")}>
              Cancel
            </Button>
            <Button
              disabled={
                !canComplete ||
                !decisionLines.length ||
                decisionErrors.length > 0 ||
                Boolean(busyId)
              }
              onClick={() => void handleRecord()}
            >
              {busyId === decisionDocId && busyId ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <ClipboardCheck className="mr-1.5 h-4 w-4" />
              )}
              Record outcome
            </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PmShell>
  );
}
