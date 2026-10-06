"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  addDoc,
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import {
  Archive,
  Building2,
  Copy,
  Download,
  Eye,
  FileUp,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Power,
  RefreshCw,
} from "lucide-react";
import { db } from "@/lib/firebase";
import { personOptionLabel } from '@/lib/people-directory';
import { useAuth } from "@/components/auth/AuthProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useToast } from "@/hooks/use-toast";
import {
  actionableRecurringCycle,
  BILL_DATE_RULES,
  buildRecurringCycle,
  DUE_DATE_RULES,
  normalizeDueDateRule,
  recurrenceLeadDays,
  pendingRecurringCycles,
  currency,
  downloadCsv,
  loadWorkingCalendar,
  maskAccount,
  recurringDateOnly,
  recurringObligationId,
  type RecurrenceFrequency,
  type RecurringPaymentMaster,
  RP_COLLECTIONS,
} from "@/lib/recurring-payments";
import {
  generateMasterCycle,
  loadManualGenerationContext,
} from "@/lib/recurring-payments-generation";
import { makeIsWorkingDay } from "@/lib/working-hours";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/page-header";
import { FilterBar } from "@/components/shared/filter-bar";
import { TableCard } from "@/components/shared/table-card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { useGlobalScopes } from "./use-global-scopes";

const ALL = "all";
const DEFAULT_MASTER_FILTERS = {
  status: ALL,
  category: ALL,
  frequency: ALL,
  owner: ALL,
};
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** A real calendar date in YYYY-MM-DD — rejects 2026-02-30 as well as 01/04/2026. */
function isValidIsoDate(value: string) {
  if (!ISO_DATE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}
const FREQUENCIES: RecurrenceFrequency[] = ["Weekly", "Monthly", "Bi-monthly", "Quarterly", "Half-yearly", "Yearly", "Renewable", "Custom"];
const AMOUNT_TYPES: RecurringPaymentMaster["amountType"][] = ["Fixed", "Variable", "Estimated"];
const MAX_IMPORT_ROWS = 400;
/** Export headers, which are also the columns the import reads (case-insensitively). */
const IMPORT_COLUMNS = [
  "Title", "Category", "Vendor", "Branch", "Project", "Department", "Frequency", "Amount Type",
  "Amount", "Due Day", "Due Date Rule", "Bill Date Rule", "Bill Day Offset", "Period Anchor Day",
  "Lead Days", "Grace Days", "Custom Interval Days", "Owner ID", "Owner Name", "Start Date",
  "End Date", "Status",
] as const;

export default function RecurringMasterRegister() {
  const { user, users } = useAuth();
  const { can } = useAuthorization();
  const { toast } = useToast();
  const organizationId = user?.organizationId || "default";
  const { projects, departments } = useGlobalScopes();
  const fileInput = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<RecurringPaymentMaster[]>([]);
  const [loading, setLoading] = useState(true);
  const [generatingAll, setGeneratingAll] = useState(false);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState(DEFAULT_MASTER_FILTERS);
  const activeFilterCount = (search.trim() ? 1 : 0)
    + (Object.keys(DEFAULT_MASTER_FILTERS) as Array<keyof typeof DEFAULT_MASTER_FILTERS>)
      .filter((key) => filters[key] !== DEFAULT_MASTER_FILTERS[key]).length;

  useEffect(
    () =>
      onSnapshot(
        query(
          collection(db, RP_COLLECTIONS.masters),
          where("organizationId", "==", organizationId),
        ),
        (snapshot) => {
          setRows(
            snapshot.docs
              .map(
                (item) =>
                  ({ id: item.id, ...item.data() }) as RecurringPaymentMaster,
              )
              .filter((item) => !item.deleted),
          );
          setLoading(false);
        },
        () => setLoading(false),
      ),
    [organizationId],
  );

  // Ids of every obligation in the org, soft-deleted included (a deleted obligation still occupies
  // its cycle's id). Lets "Next Due" name the next cycle that is actually missing, rather than the
  // oldest one in the pending window, which the cron has usually generated already.
  const [obligationIds, setObligationIds] = useState<string[]>([]);
  useEffect(
    () =>
      onSnapshot(
        query(
          collection(db, RP_COLLECTIONS.payments),
          where("organizationId", "==", organizationId),
        ),
        (snapshot) => setObligationIds(snapshot.docs.map((item) => item.id)),
        () => undefined,
      ),
    [organizationId],
  );
  const [calendar, setCalendar] = useState<Awaited<ReturnType<typeof loadWorkingCalendar>> | null>(null);
  useEffect(() => {
    loadWorkingCalendar().then(setCalendar).catch(() => undefined);
  }, []);
  const nextCycles = useMemo(() => {
    const isWorkingDay = makeIsWorkingDay(calendar?.workingHours, calendar?.holidays);
    const now = new Date();
    // Built once per run: a per-master Set re-copied every obligation id for every master.
    const generatedIds = new Set(obligationIds);
    return new Map(
      rows.map((master) => [
        master.id,
        master.startDate
          ? actionableRecurringCycle(master, now, {
              isWorkingDay,
              isGenerated: (cycle) => generatedIds.has(recurringObligationId(organizationId, master.id, cycle.key)),
            })
          : null,
      ]),
    );
  }, [rows, obligationIds, calendar, organizationId]);

  const visible = useMemo(
    () =>
      rows
        .filter((master) => {
          const matchesSearch =
            `${master.title} ${master.category} ${master.vendorName} ${master.branchName || ""} ${master.projectName || ""} ${master.department || ""} ${master.accountNumber || ""}`
              .toLowerCase()
              .includes(search.toLowerCase());
          return (
            matchesSearch &&
            (filters.status === ALL || master.status === filters.status) &&
            (filters.category === ALL ||
              master.category === filters.category) &&
            (filters.frequency === ALL ||
              master.frequency === filters.frequency) &&
            (filters.owner === ALL || master.assignedTo === filters.owner)
          );
        })
        .sort((a, b) => a.title.localeCompare(b.title)),
    [filters, rows, search],
  );

  const canAdd = can("Add", "Recurring Payments.Recurring Masters");
  const canEdit = can("Edit", "Recurring Payments.Recurring Masters");
  const canDelete = can("Delete", "Recurring Payments.Recurring Masters");
  const canImport =
    can("Import", "Recurring Payments.Recurring Masters") || canAdd;
  const canExport =
    can("Export", "Recurring Payments.Recurring Masters") ||
    can("View", "Recurring Payments.Recurring Masters");
  const canGenerate = can("Add", "Recurring Payments.Payments");

  /**
   * What stops a master from being activated: the same mandatory fields the master form enforces.
   * "Activate" here is one click, so without this a CSV-imported draft with no owner or start date
   * went straight into automation without ever passing the form's validation.
   */
  function activationBlockers(master: RecurringPaymentMaster) {
    const missing: string[] = [];
    if (!master.title?.trim()) missing.push("title");
    if (!master.category) missing.push("category");
    if (!master.vendorName?.trim()) missing.push("vendor");
    if (!master.startDate || !ISO_DATE.test(master.startDate)) missing.push("start date");
    if (!master.assignedTo) missing.push("payment owner");
    if (master.amountType === "Fixed" && !Number(master.amount)) missing.push("fixed amount");
    return missing;
  }

  async function changeStatus(master: RecurringPaymentMaster) {
    const next = master.status === "Active" ? "Paused" : "Active";
    if (next === "Active") {
      const missing = activationBlockers(master);
      if (missing.length)
        return toast({
          title: "Complete the master before activating it",
          description: `Missing: ${missing.join(", ")}. Open Edit master to fill them in.`,
          variant: "destructive",
        });
    }
    try {
      await updateDoc(doc(db, RP_COLLECTIONS.masters, master.id), {
        status: next,
        updatedAt: serverTimestamp(),
        updatedBy: user?.id || "",
      });
      await addDoc(collection(db, RP_COLLECTIONS.masters, master.id, RP_COLLECTIONS.auditLogs), {
        organizationId,
        masterId: master.id,
        action: `Master ${next.toLowerCase()}`,
        summary: `Status changed from ${master.status} to ${next}`,
        userId: user?.id || "",
        userName: user?.name || "",
        createdAt: serverTimestamp(),
      });
      toast({ title: `Master ${next.toLowerCase()}` });
    } catch (error) {
      toast({ title: "Status change failed", description: error instanceof Error ? error.message : "Please try again.", variant: "destructive" });
    }
  }

  async function archive(master: RecurringPaymentMaster) {
    // Same confirmation the master's own page asks for — one stray click in a row menu used to be
    // enough to take a master out of automation.
    if (!window.confirm(`Archive "${master.title}"? Existing generated payments will remain available.`)) return;
    try {
      await updateDoc(doc(db, RP_COLLECTIONS.masters, master.id), {
        deleted: true,
        status: "Inactive",
        deletionReason: "Archived from master register",
        deletedAt: serverTimestamp(),
        deletedBy: user?.id || "",
      });
      await addDoc(collection(db, RP_COLLECTIONS.masters, master.id, RP_COLLECTIONS.auditLogs), {
        organizationId,
        masterId: master.id,
        action: "Master archived",
        summary: "Archived from master register; generated payments retained",
        userId: user?.id || "",
        userName: user?.name || "",
        createdAt: serverTimestamp(),
      });
      toast({
        title: "Master archived",
        description: "Generated payments and audit history were retained.",
      });
    } catch (error) {
      toast({ title: "Archive failed", description: error instanceof Error ? error.message : "Please try again.", variant: "destructive" });
    }
  }

  async function duplicate(master: RecurringPaymentMaster) {
    try {
      const {
        id: _id,
        createdAt: _createdAt,
        updatedAt: _updatedAt,
        ...copy
      } = master;
      const created = await addDoc(collection(db, RP_COLLECTIONS.masters), {
        ...copy,
        title: `${master.title} (Copy)`,
        status: "Draft",
        deleted: false,
        createdAt: serverTimestamp(),
        createdBy: user?.id || "",
        updatedAt: serverTimestamp(),
        updatedBy: user?.id || "",
      });
      toast({
        title: "Draft copy created",
        description: `Master ${created.id} is ready for review.`,
      });
    } catch (error) {
      toast({ title: "Duplicate failed", description: error instanceof Error ? error.message : "Please try again.", variant: "destructive" });
    }
  }

  async function generateAll() {
    if (!user) return;
    setGeneratingAll(true);
    try {
      const eligible = rows.filter(
        (master) =>
          master.status === "Active" && master.autoGenerationEnabled !== false && master.startDate,
      );
      if (!eligible.length) {
        toast({ title: "No active masters are eligible for generation" });
        return;
      }
      // One read pass up front — approval rules, settings, workflow, calendar and every obligation
      // id already generated for the org — then each master is checked in memory, so a cycle that
      // already exists costs nothing. The write itself still goes through `generateMasterCycle`,
      // which creates only if absent, so a race with the nightly run can't overwrite anything.
      const [context, existingSnapshot] = await Promise.all([
        loadManualGenerationContext(organizationId, user),
        getDocs(query(collection(db, RP_COLLECTIONS.payments), where("organizationId", "==", organizationId))),
      ]);
      const existingIds = new Set(existingSnapshot.docs.map((item) => item.id));
      const now = new Date();

      let generated = 0;
      let workflowTriggered = 0;
      let duplicateCount = 0;
      let notYetDueCount = 0;
      let outsideDatesCount = 0;
      // Counted separately, because "the bill isn't expected yet" and "nobody could be assigned"
      // need completely different responses from whoever pressed the button.
      let awaitingBillDateCount = 0;
      let noAssigneeCount = 0;
      const failures: string[] = [];

      for (const master of eligible) {
        // Same rule as the daily automation route: every cycle carries its own generation date
        // (expected bill date minus the master's lead time), so this only asks which cycles are
        // already due for creation — catching up immediately on any window that already passed.
        const cycles = pendingRecurringCycles(master, now, context.scheduleOptions);
        if (!cycles.length) {
          // An empty list means either the master has no cycle at all right now, or its cycle
          // simply hasn't reached its lead-time window yet — different outcomes to report.
          if (buildRecurringCycle(master, now, context.scheduleOptions)) notYetDueCount++;
          else outsideDatesCount++;
          continue;
        }
        for (const cycle of cycles) {
          if (existingIds.has(recurringObligationId(organizationId, master.id, cycle.key))) {
            duplicateCount++;
            continue;
          }
          try {
            const outcome = await generateMasterCycle(master, cycle, context);
            existingIds.add(outcome.paymentId);
            if (outcome.kind === "exists") duplicateCount++;
            else {
              generated++;
              if (outcome.activationStage) workflowTriggered++;
              else if (outcome.noAssignee) noAssigneeCount++;
              else awaitingBillDateCount++;
            }
          } catch (error) {
            // One master's failure must not abandon every master after it.
            failures.push(`${master.title}: ${error instanceof Error ? error.message : "failed"}`);
          }
        }
      }

      const skippedParts = [
        duplicateCount && `${duplicateCount} already generated`,
        notYetDueCount && `${notYetDueCount} not yet due`,
        outsideDatesCount && `${outsideDatesCount} outside active dates`,
      ].filter(Boolean);
      const detailParts = [
        workflowTriggered && `${workflowTriggered} entered their workflow`,
        awaitingBillDateCount &&
          `${awaitingBillDateCount} waiting at "Scheduled" (no workflow step configured)`,
        noAssigneeCount &&
          `${noAssigneeCount} could not be assigned — check the payment owner, or the first step's users in Settings › Workflow`,
        skippedParts.length && `skipped: ${skippedParts.join(", ")}`,
        failures.length && `${failures.length} failed (${failures.slice(0, 3).join("; ")}${failures.length > 3 ? "; …" : ""})`,
      ].filter(Boolean);
      toast({
        title: generated
          ? `${generated} payment(s) generated`
          : "No new payments were due for generation",
        description: detailParts.length
          ? `${detailParts.join(". ")}.`
          : undefined,
        variant: failures.length || noAssigneeCount ? "destructive" : undefined,
      });
    } catch (error) {
      toast({
        title: "Bulk generation failed",
        description:
          error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setGeneratingAll(false);
    }
  }

  // The export carries every column the import reads, under the same headers, so a file can be
  // exported, edited and re-imported without losing the schedule rules or the owner.
  function exportCsv() {
    downloadCsv(
      `recurring-payment-masters-${recurringDateOnly(new Date())}.csv`,
      [...IMPORT_COLUMNS],
      visible.map((master) => [
        master.title,
        master.category,
        master.vendorName,
        master.branchName || "",
        master.projectName || "",
        master.department || "",
        master.frequency,
        master.amountType,
        master.amount,
        master.dueDay,
        normalizeDueDateRule(master.dueDateRule),
        master.billDateRule || "Start of billing period",
        master.billDayOffset ?? 1,
        master.periodAnchorDay || 1,
        recurrenceLeadDays(master),
        master.gracePeriodDays || 0,
        master.customIntervalDays || "",
        master.assignedTo || "",
        master.assignedToName || "",
        master.startDate,
        master.endDate || "",
        master.status,
      ]),
    );
  }

  async function importCsv(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !user || !canImport) return;
    try {
      const lines = (await file.text()).replace(/^﻿/, "").split(/\r?\n/).filter((line) => line.trim());
      if (lines.length < 2) throw new Error("The CSV has no data rows.");
      const headers = parseCsvLine(lines[0]).map((item) =>
        item.trim().toLowerCase(),
      );
      const required = [
        "title",
        "category",
        "vendor",
        "frequency",
        "amount",
        "due day",
        "owner id",
        "start date",
      ];
      if (required.some((field) => !headers.includes(field)))
        throw new Error(`Required columns: ${required.join(", ")}.`);
      const dataLines = lines.slice(1);
      if (dataLines.length > MAX_IMPORT_ROWS)
        throw new Error(`The file has ${dataLines.length} rows; import at most ${MAX_IMPORT_ROWS} at a time.`);

      // Every row is validated before anything is written, then all of them go in one batch. Rows
      // used to be written one by one and checked inside the loop, so a bad project on row 50 left
      // rows 1–49 imported behind a "CSV import failed" message, and re-importing the corrected file
      // duplicated them. A start date in any format but YYYY-MM-DD produced cycle keys of "NaN-NaN".
      const problems: string[] = [];
      const records = dataLines.map((line, index) => {
        const values = parseCsvLine(line);
        const rowNo = index + 2;
        const get = (name: string) => {
          const at = headers.indexOf(name);
          return at < 0 ? "" : values[at]?.trim() || "";
        };
        const issue = (message: string) => problems.push(`Row ${rowNo}: ${message}`);
        const projectValue = get("project");
        const departmentValue = get("department");
        const project = projects.find(
          (item) =>
            item.id === projectValue ||
            item.projectName.toLowerCase() === projectValue.toLowerCase(),
        );
        const department = departments.find(
          (item) =>
            item.id === departmentValue ||
            item.name.toLowerCase() === departmentValue.toLowerCase(),
        );
        if (projectValue && !project) issue(`project "${projectValue}" not found`);
        if (departmentValue && !department) issue(`department "${departmentValue}" not found`);
        if (!get("title")) issue("title is blank");
        if (!get("category")) issue("category is blank");
        if (!get("vendor")) issue("vendor is blank");
        const frequency = (get("frequency") || "Monthly") as RecurrenceFrequency;
        if (!FREQUENCIES.includes(frequency)) issue(`frequency "${frequency}" is not one of ${FREQUENCIES.join(", ")}`);
        const amountType = (get("amount type") || "Fixed") as RecurringPaymentMaster["amountType"];
        if (!AMOUNT_TYPES.includes(amountType)) issue(`amount type "${amountType}" is not one of ${AMOUNT_TYPES.join(", ")}`);
        const amount = Number(get("amount") || 0);
        if (!Number.isFinite(amount) || amount < 0) issue(`amount "${get("amount")}" is not a number`);
        const startDate = get("start date");
        if (!isValidIsoDate(startDate)) issue(`start date "${startDate}" must be a real date in YYYY-MM-DD format`);
        const endDate = get("end date");
        if (endDate && !isValidIsoDate(endDate)) issue(`end date "${endDate}" must be YYYY-MM-DD`);
        if (endDate && startDate && endDate < startDate) issue("end date is before start date");
        const ownerId = get("owner id");
        const owner = users.find((item) => item.id === ownerId);
        if (ownerId && !owner) issue(`owner id "${ownerId}" is not a known user`);
        const dueDateRule = get("due date rule");
        if (dueDateRule && !(DUE_DATE_RULES as string[]).includes(dueDateRule)) issue(`due date rule "${dueDateRule}" is not one of ${DUE_DATE_RULES.join(", ")}`);
        // A bare "due day" column means a day of the month; with a rule, it is that rule's number.
        const effectiveDueRule = dueDateRule || "Fixed day of month";
        const dueDay = Number(get("due day") || 1);
        const dueDayMax = effectiveDueRule === "Fixed day of month" ? 31 : 180;
        if (!Number.isInteger(dueDay) || dueDay < 0 || dueDay > dueDayMax) issue(`due day "${get("due day")}" must be 0–${dueDayMax} for "${effectiveDueRule}"`);
        const whole = (name: string, fallback: number, max: number) => {
          const raw = get(name);
          if (!raw) return fallback;
          const value = Number(raw);
          if (!Number.isInteger(value) || value < 0 || value > max) issue(`${name} "${raw}" must be a whole number 0–${max}`);
          return Math.min(max, Math.max(0, Math.round(value) || 0));
        };
        const billDayOffset = whole("bill day offset", 1, 31);
        const generateLeadDays = whole("lead days", 7, 365);
        const gracePeriodDays = whole("grace days", 0, 365);
        const customIntervalDays = whole("custom interval days", 30, 3660);
        const billDateRule = get("bill date rule");
        if (billDateRule && !(BILL_DATE_RULES as string[]).includes(billDateRule)) issue(`bill date rule "${billDateRule}" is not one of ${BILL_DATE_RULES.join(", ")}`);
        return {
          organizationId,
          organizationName: user.organizationName || "",
          title: get("title"),
          category: get("category"),
          vendorName: get("vendor"),
          branchName: get("branch"),
          projectId: project?.id || "",
          projectName: project?.projectName || "",
          departmentId: department?.id || "",
          department: department?.name || "",
          frequency,
          amountType,
          amount,
          dueDay,
          // Left unset, the schedule would read a bare due day as "N days after the bill date",
          // which is not what anyone filling in that column meant.
          dueDateRule: effectiveDueRule,
          ...(billDateRule ? { billDateRule } : {}),
          billDayOffset,
          generateLeadDays,
          gracePeriodDays,
          ...(frequency === "Custom" ? { customIntervalDays } : {}),
          periodAnchorDay: Math.min(31, Math.max(1, Number(get("period anchor day") || 1) || 1)),
          assignedTo: ownerId,
          assignedToName: owner?.name || "",
          startDate,
          ...(endDate ? { endDate } : {}),
          status: "Draft",
          autoGenerationEnabled: true,
          deleted: false,
          createdAt: serverTimestamp(),
          createdBy: user.id,
          updatedAt: serverTimestamp(),
          updatedBy: user.id,
        };
      });
      if (problems.length)
        throw new Error(
          `Nothing was imported. Fix ${problems.length} problem(s) and try again — ${problems.slice(0, 5).join("; ")}${problems.length > 5 ? "; …" : ""}`,
        );
      const batch = writeBatch(db);
      for (const record of records) batch.set(doc(collection(db, RP_COLLECTIONS.masters)), record);
      await batch.commit();
      toast({
        title: `${records.length} draft master(s) imported`,
        description:
          "Review and activate each imported master before automation uses it.",
      });
    } catch (error) {
      toast({
        title: "CSV import failed",
        description:
          error instanceof Error ? error.message : "Check the file structure.",
        variant: "destructive",
      });
    }
  }

  if (loading)
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-indigo-600" />
      </div>
    );

  const monthlyCommitment = rows
    .filter(
      (item) =>
        item.status === "Active" &&
        item.frequency === "Monthly" &&
        item.amountType === "Fixed",
    )
    .reduce((sum, item) => sum + Number(item.amount), 0);
  return (
    <div className="space-y-5">
      <PageHeader
        title="Recurring Payment Masters"
        description="Controlled templates for automated financial obligations"
        actions={
          <>
            {canExport && (
              <Button variant="outline" onClick={exportCsv}>
                <Download className="mr-2 h-4 w-4" />
                Export CSV
              </Button>
            )}
            {canImport && (
              <>
                <input
                  ref={fileInput}
                  className="hidden"
                  type="file"
                  accept=".csv,text/csv"
                  onChange={importCsv}
                />
                <Button
                  variant="outline"
                  onClick={() => fileInput.current?.click()}
                >
                  <FileUp className="mr-2 h-4 w-4" />
                  Import masters
                </Button>
              </>
            )}
            {canGenerate && (
              <Button
                variant="outline"
                onClick={generateAll}
                disabled={generatingAll}
              >
                {generatingAll ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                Generate all
              </Button>
            )}
            {canAdd && (
              <Link href="/recurring-payments/masters/new">
                <Button>
                  <Plus className="mr-2 h-4 w-4" />
                  New master
                </Button>
              </Link>
            )}
          </>
        }
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Total masters" value={rows.length} />
        <Metric
          label="Active"
          value={rows.filter((item) => item.status === "Active").length}
        />
        <Metric
          label="Monthly fixed commitment"
          value={currency(monthlyCommitment)}
        />
        <Metric
          label="Draft / paused"
          value={
            rows.filter((item) => ["Draft", "Paused"].includes(item.status))
              .length
          }
        />
      </div>
      {/* No title here: the page banner above already names this list, so a "Master register"
          title plus a count restated the same thing twice in a row. */}
      <TableCard
        toolbar={
          <FilterBar
            search={{ value: search, onChange: setSearch, placeholder: "Search masters…" }}
            activeCount={activeFilterCount - (search.trim() ? 1 : 0)}
            onClear={() => { setSearch(""); setFilters(DEFAULT_MASTER_FILTERS); }}
          >
            <Filter
              value={filters.status}
              label="All statuses"
              options={unique(rows.map((item) => item.status))}
              onChange={(status) =>
                setFilters((current) => ({ ...current, status }))
              }
            />
            <Filter
              value={filters.category}
              label="All categories"
              options={unique(rows.map((item) => item.category))}
              onChange={(category) =>
                setFilters((current) => ({ ...current, category }))
              }
            />
            <Filter
              value={filters.frequency}
              label="All frequencies"
              options={unique(rows.map((item) => item.frequency))}
              onChange={(frequency) =>
                setFilters((current) => ({ ...current, frequency }))
              }
            />
            <Select
              value={filters.owner}
              onValueChange={(owner) =>
                setFilters((current) => ({ ...current, owner }))
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="All owners" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All owners</SelectItem>
                {users.map((item) => (
                  <SelectItem value={item.id} key={item.id}>
                    {personOptionLabel(item)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterBar>
        }
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Master</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Scope</TableHead>
              <TableHead>Department</TableHead>
              <TableHead>Vendor</TableHead>
              <TableHead>Account</TableHead>
              <TableHead>Frequency</TableHead>
              <TableHead>Next Due</TableHead>
              <TableHead className="text-right">Expected Amount</TableHead>
              <TableHead>Amount Type</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((master) => {
              // The earliest cycle still awaiting an obligation — for arrears-billed masters the
              // closed period whose bill has arrived, not the period today sits inside.
              const cycle = nextCycles.get(master.id) ?? null;
              return (
                <TableRow key={master.id}>
                  <TableCell className="whitespace-nowrap">
                    <Link
                      className="font-medium text-indigo-700 hover:underline"
                      href={`/recurring-payments/masters/${master.id}`}
                    >
                      {master.title}
                    </Link>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {master.category}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {master.projectName ||
                      master.branchName ||
                      "Organization-wide"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {master.department || master.costCentre || "General"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {master.vendorName}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {maskAccount(master.accountNumber) || "No account"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {master.frequency}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {cycle ? `Due ${cycle.dueDate}` : "No upcoming cycle"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right tabular-nums">
                    {currency(master.amount)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {master.amountType}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {master.assignedToName ||
                      users.find((item) => item.id === master.assignedTo)
                        ?.name ||
                      "Unassigned"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <StatusBadge status={master.status} />
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        {/* The default icon button is 2.5rem tall and was setting the row
                            height on its own, so trimming cell padding alone changed little. */}
                        <Button size="icon" variant="ghost" className="h-7 w-7">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem asChild>
                          <Link
                            href={`/recurring-payments/masters/${master.id}`}
                          >
                            <Eye className="mr-2 h-4 w-4" />
                            View & generate
                          </Link>
                        </DropdownMenuItem>
                        {canEdit && (
                          <>
                            <DropdownMenuItem asChild>
                              <Link
                                href={`/recurring-payments/masters/${master.id}/edit`}
                              >
                                <Pencil className="mr-2 h-4 w-4" />
                                Edit master
                              </Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => changeStatus(master)}
                            >
                              <Power className="mr-2 h-4 w-4" />
                              {master.status === "Active"
                                ? "Pause"
                                : "Activate"}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => duplicate(master)}
                            >
                              <Copy className="mr-2 h-4 w-4" />
                              Duplicate as draft
                            </DropdownMenuItem>
                          </>
                        )}
                        {canDelete && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive"
                              onSelect={() => archive(master)}
                            >
                              <Archive className="mr-2 h-4 w-4" />
                              Archive
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })}
            {!visible.length && (
              <TableRow>
                <TableCell
                  colSpan={13}
                  className="h-36 text-center text-muted-foreground"
                >
                  No recurring masters match these filters.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableCard>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="rounded-xl bg-indigo-100 p-2">
          <Building2 className="h-5 w-5 text-indigo-600" />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-xl font-bold">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}
function Filter({
  value,
  label,
  options,
  onChange,
}: {
  value: string;
  label: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{label}</SelectItem>
        {options.map((option) => (
          <SelectItem value={option} key={option}>
            {option}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))].sort();
}
function parseCsvLine(line: string) {
  const values: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && line[index + 1] === '"' && quoted) {
      value += '"';
      index += 1;
    } else if (character === '"') quoted = !quoted;
    else if (character === "," && !quoted) {
      values.push(value);
      value = "";
    } else value += character;
  }
  values.push(value);
  return values;
}
