"use client";

/**
 * Raising an MVAC: the screen.
 *
 * It is Create JMC's form, with the two differences MVAC actually has:
 *
 *   - **what you pick from.** A JMC measures contract lines; an MVAC accepts material that has
 *     arrived, so the item picker lists what **GRN has accepted and no certificate has taken**,
 *     across every vendor, one row per purchase-order item with the GRNs that delivered it. MVAC
 *     used to be raised vendor-first off a purchase order, which is not how a joint walk-down
 *     works — what is lying at site came from whoever supplied it.
 *   - **what a line is worth.** Nothing, here: an MVAC records quantity. What it is worth is
 *     billing's question, downstream.
 *
 * Everything else — the stage run across the band, the accented detail fields, the numbered
 * register rows, the footer — is the shared entry kit, so the two forms cannot drift apart.
 *
 * Props only: no Firebase, no permissions, no rules. The page above owns the register, the
 * validation and the save.
 */

import { useMemo, useState, type MouseEvent, type ReactNode } from "react";
import {
  AlertTriangle,
  CalendarDays,
  FileText,
  FilePlus,
  FolderOpen,
  Hash,
  Library,
  Loader2,
  Plus,
  Save,
  Send,
  Trash2,
  UserCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  HeroBand,
  HERO_PRIMARY_BUTTON,
  HERO_SECONDARY_BUTTON,
} from "@/components/project-management/hero-band";
import {
  ENTRY_FIELD_COLOURS,
  ENTRY_FIELD_INPUT,
  EntryFieldLabel,
  EntryItemsFooter,
  EntryRowNumber,
  EntryStageStepper,
  type EntryStepLike,
} from "@/components/project-management/entry-form-kit";
import { PmDataList, type PmListColumn } from "@/components/project-management/pm-shell";
import { MVAC_MAIN_CLASS } from "@/components/mvac/mvac-page-shell";
import {
  MvacGrnChips,
  MvacGrnMultiSelectDialog,
  MvacItemSelector,
} from "@/components/mvac/mvac-item-selector";
import {
  formatMvacQty,
  type MvacCandidateLine,
} from "@/lib/project-management-mvac-dashboard";
import { cn } from "@/lib/utils";

/** A line on the form. `lineKey` is empty until an item has been picked into the row. */
export interface MvacFormRow {
  id: string;
  lineKey: string;
  qty: string;
}

export interface MvacCreateViewProps {
  back: { href: string; label: string; onClick?: (event: MouseEvent<HTMLAnchorElement>) => void };
  crumbs?: readonly { label: string; href?: string }[];
  projectName: string;
  /** The configured run this certificate will enter. */
  steps: readonly EntryStepLike[];
  /** Everything a GRN has accepted and no certificate has taken. */
  candidates: readonly MvacCandidateLine[];
  rows: readonly MvacFormRow[];
  onAddRow: () => void;
  onRemoveRow: (rowId: string) => void;
  onPickItem: (rowId: string, line: MvacCandidateLine | null) => void;
  onQtyChange: (rowId: string, value: string) => void;
  onAddMany: (lines: readonly MvacCandidateLine[]) => void;
  /** Row id → why its quantity is refused. */
  errorByRowId: Record<string, string>;
  docDate: string;
  onDocDateChange: (value: string) => void;
  counterparty: string;
  onCounterpartyChange: (value: string) => void;
  remarks: string;
  onRemarksChange: (value: string) => void;
  /** Set when an existing draft is being edited — its number, for the heading. */
  editingDocNumber?: string;
  canRaise: boolean;
  isLoading?: boolean;
  isSaving?: boolean;
  onSave: (submit: boolean) => void;
  /** Shown above the register when the chain could not be read. */
  loadError?: string;
}

/** A row of the register, with its chosen line resolved. */
type RegisterRow = MvacFormRow & {
  index: number;
  line: MvacCandidateLine | null;
  /** What this row may still choose: everything free, plus whatever it already holds. */
  choices: MvacCandidateLine[];
  error?: string;
};

/** What is left on the line, beside the quantity box — MVAC's answer to JMC's BOQ balance. */
function QtyNote({ row }: { row: RegisterRow }) {
  if (!row.line) {
    return (
      <span className="whitespace-nowrap text-[11px] font-semibold text-muted-foreground">
        pick an item
      </span>
    );
  }

  const typed = Number(row.qty);
  const over = Number.isFinite(typed) && typed > row.line.availableQty;
  const unit = row.line.unit;

  if (over) {
    return (
      <span
        className="flex items-center gap-1 whitespace-nowrap text-[11px] font-extrabold text-rose-600"
        title={`${formatMvacQty(typed - row.line.availableQty, unit)} more than this line has left for acceptance.`}
      >
        <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />+
        {formatMvacQty(typed - row.line.availableQty)} over
      </span>
    );
  }

  return (
    <span
      className="whitespace-nowrap text-[11px] font-semibold text-muted-foreground"
      title={`${formatMvacQty(row.line.availableQty, unit)} of this line is received and not yet on a certificate.`}
    >
      of {formatMvacQty(row.line.availableQty)}
    </span>
  );
}

export function MvacCreateView({
  back,
  crumbs,
  projectName,
  steps,
  candidates,
  rows,
  onAddRow,
  onRemoveRow,
  onPickItem,
  onQtyChange,
  onAddMany,
  errorByRowId,
  docDate,
  onDocDateChange,
  counterparty,
  onCounterpartyChange,
  remarks,
  onRemarksChange,
  editingDocNumber,
  canRaise,
  isLoading,
  isSaving,
  onSave,
  loadError,
}: MvacCreateViewProps) {
  const [isPickerOpen, setIsPickerOpen] = useState(false);

  const byKey = useMemo(
    () => new Map(candidates.map((line) => [line.key, line])),
    [candidates],
  );

  /** Lines already on the form — kept out of every picker so none can be added twice. */
  const taken = useMemo(
    () => new Set(rows.map((row) => row.lineKey).filter(Boolean)),
    [rows],
  );
  const free = useMemo(
    () => candidates.filter((line) => !taken.has(line.key)),
    [candidates, taken],
  );

  const registerRows: RegisterRow[] = rows.map((row, index) => {
    const line = row.lineKey ? (byKey.get(row.lineKey) ?? null) : null;
    return {
      ...row,
      index,
      line,
      choices: line ? [line, ...free] : free,
      error: errorByRowId[row.id],
    };
  });

  const filled = registerRows.filter((row) => row.line !== null);
  const withQty = filled.filter((row) => Number(row.qty) > 0);
  const totalQty = withQty.reduce((sum, row) => sum + (Number(row.qty) || 0), 0);
  const errorCount = Object.keys(errorByRowId).length;
  const canSubmit = canRaise && withQty.length > 0 && errorCount === 0 && !isSaving;

  const columns: PmListColumn<RegisterRow>[] = [
    {
      header: "#",
      className: "w-10",
      cell: (row) => <EntryRowNumber index={row.index} />,
    },
    {
      // The card's headline on a phone: picking the item is what fills in the rest of the row.
      header: "Item",
      mobile: "title",
      cell: (row) => (
        // The picker keeps the default control height of its own trigger; it is shortened here,
        // where it sits in a one-line register row.
        <div className="min-w-[12rem] sm:[&_button]:h-8">
          <MvacItemSelector
            candidates={row.choices}
            selectedKey={row.lineKey}
            onSelect={(line) => onPickItem(row.id, line)}
            isLoading={isLoading}
          />
        </div>
      ),
    },
    {
      header: "PO · Vendor",
      className: "whitespace-nowrap",
      cell: (row) =>
        row.line ? (
          <span className="text-xs">
            {row.line.poNumber} · {row.line.vendorName}
          </span>
        ) : (
          "—"
        ),
    },
    {
      header: "From GRN",
      cell: (row) =>
        row.line ? <MvacGrnChips grns={row.line.grns} unit={row.line.unit} /> : "—",
    },
    { header: "Unit", className: "whitespace-nowrap", cell: (row) => row.line?.unit ?? "—" },
    {
      header: "Received",
      align: "right",
      className: "whitespace-nowrap",
      cell: (row) => (
        <span className="tabular-nums">
          {row.line ? formatMvacQty(row.line.receivedQty) : "—"}
        </span>
      ),
    },
    {
      header: "Available",
      align: "right",
      className: "whitespace-nowrap",
      cell: (row) => (
        <span className="font-semibold tabular-nums">
          {row.line ? formatMvacQty(row.line.availableQty) : "—"}
        </span>
      ),
    },
    {
      header: "Accepted Qty",
      cell: (row) => (
        <div>
          <div className="flex items-center gap-2">
            <Input
              value={row.qty}
              inputMode="decimal"
              placeholder="0"
              disabled={!canRaise || !row.line}
              aria-invalid={Boolean(row.error) || undefined}
              aria-label={`Accepted quantity${row.line ? ` for ${row.line.itemDescription}` : ""}`}
              onChange={(event) => onQtyChange(row.id, event.target.value)}
              className={cn(
                "h-8 w-full text-right font-bold tabular-nums sm:w-24",
                row.error && "border-rose-400 bg-rose-50 text-rose-700",
              )}
            />
            <QtyNote row={row} />
          </div>
          {row.error ? (
            <p className="mt-1 text-[11px] font-semibold text-rose-700">{row.error}</p>
          ) : null}
        </div>
      ),
    },
    {
      header: "Action",
      align: "right",
      mobile: "footer",
      className: "w-20",
      cell: (row) => (
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onRemoveRow(row.id)}
          aria-label="Remove row"
          // The row is one line tall; a 40px icon button would set the height on its own. It keeps
          // a 44px touch target on a phone, where this sits in the card's footer.
          className="sm:h-8 sm:w-8"
        >
          <Trash2 className="h-4 w-4 text-destructive" />
          <span className="ml-2 text-destructive sm:hidden">Remove</span>
        </Button>
      ),
    },
  ];

  return (
    <>
      <main className={cn(MVAC_MAIN_CLASS, "max-sm:[--card-pad:1rem]")}>
        <HeroBand
          band="rose"
          icon={FilePlus}
          back={back}
          crumbs={crumbs}
          title={editingDocNumber ? `Edit ${editingDocNumber}` : "Create MVAC"}
          description={
            editingDocNumber
              ? "A draft holds no quantity until it is raised, so it is still yours to change."
              : projectName
                ? `Raise a joint acceptance for material received on ${projectName}`
                : "Raise a joint acceptance for material received at site"
          }
          actions={
            <>
              <Button
                variant="outline"
                className={HERO_SECONDARY_BUTTON}
                disabled={!canRaise || filled.length === 0 || isSaving}
                onClick={() => onSave(false)}
              >
                <Save className="mr-2 h-4 w-4" aria-hidden="true" />
                {editingDocNumber ? "Save changes" : "Save draft"}
              </Button>
              <Button
                className={cn(HERO_PRIMARY_BUTTON, "text-rose-900")}
                disabled={!canSubmit}
                onClick={() => onSave(true)}
              >
                {isSaving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Send className="mr-2 h-4 w-4" aria-hidden="true" />
                )}
                Raise MVAC
              </Button>
            </>
          }
        >
          {/* Raising it hands the certificate to the next desk rather than finishing it, which the
              form never said. The run is the configured workflow, so it is this installation's. */}
          <EntryStageStepper steps={steps} createLabel="Create MVAC" tone="rose" />
        </HeroBand>

        {!canRaise ? (
          <Card className="border-amber-300 bg-amber-50/60 dark:bg-amber-950/20">
            <CardContent className="flex items-start gap-2 py-3 text-sm text-amber-900 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                You can see what is available but not raise a certificate. Ask for the Request
                permission on MVAC.
              </span>
            </CardContent>
          </Card>
        ) : null}

        {loadError ? (
          <Card className="border-destructive/40">
            <CardContent className="p-6 text-sm font-semibold text-muted-foreground">
              {loadError}
            </CardContent>
          </Card>
        ) : null}

        <Card className="border-border/60">
          <CardHeader>
            <CardTitle>MVAC Details</CardTitle>
            <CardDescription>
              Provide the main details for this joint acceptance certificate.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4 md:gap-6">
              <div>
                <EntryFieldLabel htmlFor="mvac-project" icon={FolderOpen} colour={ENTRY_FIELD_COLOURS[0]}>
                  Project
                </EntryFieldLabel>
                <Input
                  id="mvac-project"
                  value={projectName || "— not resolved —"}
                  readOnly
                  // The project comes from the module you are in, not from a picker: every screen
                  // in MVAC is already scoped to it.
                  className={cn(ENTRY_FIELD_INPUT, "cursor-not-allowed bg-muted/50")}
                  style={{ borderLeftColor: ENTRY_FIELD_COLOURS[0] }}
                />
              </div>
              <div>
                {/* The number is generated inside the save, from the certificate's own date and
                    id, so it is shown as pending rather than typed. */}
                <EntryFieldLabel
                  htmlFor="mvac-no"
                  icon={Hash}
                  colour={ENTRY_FIELD_COLOURS[1]}
                  hint={editingDocNumber ? "· draft" : "· allocated on save"}
                >
                  MVAC No
                </EntryFieldLabel>
                <Input
                  id="mvac-no"
                  value={editingDocNumber || "— allocated when raised —"}
                  readOnly
                  className={cn(ENTRY_FIELD_INPUT, "cursor-not-allowed bg-muted/50")}
                  style={{ borderLeftColor: ENTRY_FIELD_COLOURS[1] }}
                />
              </div>
              <div>
                <EntryFieldLabel
                  htmlFor="mvac-counterparty"
                  icon={UserCheck}
                  colour={ENTRY_FIELD_COLOURS[2]}
                >
                  Client representative
                </EntryFieldLabel>
                <Input
                  id="mvac-counterparty"
                  value={counterparty}
                  placeholder="Who signs for the client"
                  onChange={(event) => onCounterpartyChange(event.target.value)}
                  className={ENTRY_FIELD_INPUT}
                  style={{ borderLeftColor: ENTRY_FIELD_COLOURS[2] }}
                />
              </div>
              <div>
                <EntryFieldLabel
                  htmlFor="mvac-date"
                  icon={CalendarDays}
                  colour={ENTRY_FIELD_COLOURS[3]}
                >
                  MVAC Date
                </EntryFieldLabel>
                <Input
                  id="mvac-date"
                  type="date"
                  value={docDate}
                  onChange={(event) => onDocDateChange(event.target.value)}
                  className={ENTRY_FIELD_INPUT}
                  style={{ borderLeftColor: ENTRY_FIELD_COLOURS[3] }}
                />
              </div>
              <div className="sm:col-span-2 md:col-span-4">
                <EntryFieldLabel htmlFor="mvac-remarks" icon={FileText} colour="#64748b">
                  Remarks
                </EntryFieldLabel>
                <Textarea
                  id="mvac-remarks"
                  rows={2}
                  value={remarks}
                  placeholder="Anything this certificate should record — observations, who attended, conditions"
                  onChange={(event) => onRemarksChange(event.target.value)}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle>MVAC Items</CardTitle>
                <CardDescription>
                  Add what this certificate accepts. Only material a GRN has received is offered.
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsPickerOpen(true)}
                disabled={!canRaise || free.length === 0}
              >
                <Library className="mr-2 h-4 w-4" /> Add Items from GRN
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {/* Dense: every cell is one line, so the default cell padding would make a twenty-line
                certificate scroll for no reason. */}
            <PmDataList
              dense
              rows={registerRows}
              columns={columns}
              className="max-sm:px-4 sm:rounded-none sm:border-x-0 sm:shadow-none"
            />

            <EntryItemsFooter
              itemCount={filled.length}
              withQtyCount={withQty.length}
              totalLabel="Total quantity"
              total={formatMvacQty(totalQty)}
              action={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onAddRow}
                  disabled={!canRaise || free.length === 0}
                  className="max-sm:w-full"
                >
                  <Plus className="mr-2 h-4 w-4" /> Add Item
                </Button>
              }
              note={
                errorCount > 0
                  ? `${errorCount} quantit${errorCount === 1 ? "y is" : "ies are"} beyond what the line has left — fix before raising.`
                  : candidates.length === 0 && !isLoading
                    ? "Nothing is waiting for joint acceptance: an item appears once a GRN has accepted it at site."
                    : undefined
              }
            />
          </CardContent>
        </Card>
      </main>

      <MvacGrnMultiSelectDialog
        isOpen={isPickerOpen}
        onOpenChange={setIsPickerOpen}
        candidates={free}
        onConfirm={onAddMany}
      />
    </>
  );
}
