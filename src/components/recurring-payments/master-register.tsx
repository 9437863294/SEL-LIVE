"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  Timestamp,
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
  Search,
} from "lucide-react";
import { db } from "@/lib/firebase";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useToast } from "@/hooks/use-toast";
import {
  buildPaymentObligationFields,
  actionableRecurringCycle,
  buildRecurringCycle,
  pendingRecurringCycles,
  currency,
  DEFAULT_RECURRING_WORKFLOW,
  loadWorkingCalendar,
  maskAccount,
  matchApprovalRule,
  resolveWorkflowActivation,
  type ApprovalRule,
  type RecurringPaymentMaster,
  type RecurringWorkflowStep,
  RP_COLLECTIONS,
} from "@/lib/recurring-payments";
import { addBusinessHours, makeIsWorkingDay } from "@/lib/working-hours";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import CollapsibleFilterCard from "./collapsible-filter-card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
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

  async function changeStatus(master: RecurringPaymentMaster) {
    const next = master.status === "Active" ? "Paused" : "Active";
    await updateDoc(doc(db, RP_COLLECTIONS.masters, master.id), {
      status: next,
      updatedAt: serverTimestamp(),
      updatedBy: user?.id || "",
    });
    toast({ title: `Master ${next.toLowerCase()}` });
  }

  async function archive(master: RecurringPaymentMaster) {
    await updateDoc(doc(db, RP_COLLECTIONS.masters, master.id), {
      deleted: true,
      status: "Inactive",
      deletedAt: serverTimestamp(),
      deletedBy: user?.id || "",
    });
    toast({
      title: "Master archived",
      description: "Generated payments and audit history were retained.",
    });
  }

  async function duplicate(master: RecurringPaymentMaster) {
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
      createdAt: serverTimestamp(),
      createdBy: user?.id || "",
      updatedAt: serverTimestamp(),
      updatedBy: user?.id || "",
    });
    toast({
      title: "Draft copy created",
      description: `Master ${created.id} is ready for review.`,
    });
  }

  async function generateAll() {
    if (!user) return;
    setGeneratingAll(true);
    try {
      const eligible = rows.filter(
        (master) =>
          master.status === "Active" && master.autoGenerationEnabled !== false,
      );
      if (!eligible.length) {
        toast({ title: "No active masters are eligible for generation" });
        return;
      }
      // Fetch existing approval rules and every payment obligation id already generated for the
      // org once, up front, instead of a getDoc per master — a single read pass, then every
      // master is checked against it in memory so the exact same cycle is never generated twice.
      // Also fetch the org's automation settings and the configured workflow once, so each newly
      // generated obligation can be entered into its first workflow step immediately (same as the
      // per-master "Generate now" button and the daily automation route) instead of sitting at
      // "Scheduled" until the next cron run picks it up.
      const [ruleSnapshot, existingSnapshot, settingsSnap, workflowSnap, calendar] =
        await Promise.all([
          getDocs(
            query(
              collection(db, RP_COLLECTIONS.approvalRules),
              where("organizationId", "==", organizationId),
            ),
          ),
          getDocs(
            query(
              collection(db, RP_COLLECTIONS.payments),
              where("organizationId", "==", organizationId),
            ),
          ),
          getDoc(
            doc(
              db,
              RP_COLLECTIONS.settings,
              organizationId.replace(/[^a-zA-Z0-9_-]/g, "_"),
            ),
          ),
          getDoc(doc(db, "workflows", "recurring-payments-workflow")),
          // Fetched once for the whole batch — every master in the loop reuses the same schedule,
          // rather than a Firestore round-trip per master.
          loadWorkingCalendar(),
        ]);
      const rules = ruleSnapshot.docs.map(
        (item) => ({ id: item.id, ...item.data() }) as ApprovalRule,
      );
      const existingIds = new Set(existingSnapshot.docs.map((item) => item.id));
      const activationDays = Math.min(
        90,
        Math.max(
          0,
          Number(settingsSnap.data()?.automation?.workflowActivationDays ?? 7),
        ),
      );
      const workflow = (workflowSnap.data()?.steps ||
        DEFAULT_RECURRING_WORKFLOW) as RecurringWorkflowStep[];
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      // Shared with the schedule math so a "last working day of month" due date resolves against
      // the org's own calendar here exactly as it does in the cron.
      const isWorkingDay = makeIsWorkingDay(
        calendar.workingHours,
        calendar.holidays,
      );

      let generated = 0;
      let workflowTriggered = 0;
      let duplicateCount = 0;
      let notYetDueCount = 0;
      let outsideDatesCount = 0;
      let batch = writeBatch(db);
      let batchWrites = 0;
      const commits: Promise<void>[] = [];

      for (const master of eligible) {
        // Same rule as the daily automation route: every cycle carries its own generation date
        // (expected bill date minus the master's lead time), so this only asks which cycles are
        // already due for creation — catching up immediately on any window that already passed.
        const cycles = pendingRecurringCycles(master, now, { isWorkingDay });
        if (!cycles.length) {
          // An empty list means either the master has no cycle at all right now, or its cycle
          // simply hasn't reached its lead-time window yet — different outcomes to report.
          if (buildRecurringCycle(master, now)) notYetDueCount++;
          else outsideDatesCount++;
          continue;
        }
        for (const cycle of cycles) {
        const cycleKey = `${organizationId}_${master.id}_${cycle.key}`;
        const docId = cycleKey.replace(/[^a-zA-Z0-9_-]/g, "_");
        if (existingIds.has(docId)) {
          duplicateCount++;
          continue;
        }
        const amount = Number(master.amount || 0);
        const approvalRule = matchApprovalRule(rules, {
          amount,
          category: master.category,
          projectId: master.projectId,
          projectName: master.projectName,
        });
        const obligationFields = buildPaymentObligationFields({
          organizationId,
          masterId: master.id,
          cycle,
          generatedAutomatically: false,
          title: master.title,
          category: master.category,
          vendorName: master.vendorName,
          branchId: master.branchId,
          branchName: master.branchName,
          projectId: master.projectId,
          projectName: master.projectName,
          departmentId: master.departmentId,
          department: master.department,
          costCentre: master.costCentre,
          ledger: master.ledger,
          amountType: master.amountType,
          description: master.description,
          accountNumber: master.accountNumber,
          amount,
          maximumAmount: master.maximumAmount,
          assignedTo: master.assignedTo,
          backupAssignedTo: master.backupAssignedTo,
          verifierId: master.verifierId,
          approverId: master.approverId,
          accountsProcessorId: master.accountsProcessorId,
          approvalRule,
        });
        const activation = resolveWorkflowActivation(
          workflow[0],
          obligationFields,
          { activationDays, today },
        );
        if (activation) workflowTriggered++;
        batch.set(doc(db, RP_COLLECTIONS.payments, docId), {
          ...obligationFields,
          ...(activation
            ? {
                status: activation.status,
                workflowStatus: activation.workflowStatus,
                stage: activation.stage,
                currentStepId: activation.currentStepId,
                assignees: activation.assignees,
                workflowStartedAt: serverTimestamp(),
                stepEnteredAt: serverTimestamp(),
                // Real deadline, not resolveWorkflowActivation's naive approximation — accounts
                // for the org's configured working hours and holidays.
                workflowDeadline: Timestamp.fromMillis(
                  addBusinessHours(new Date(), Math.max(1, workflow[0].tat), calendar.workingHours, calendar.holidays).getTime(),
                ),
              }
            : {}),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        // Guard against this same run ever writing the same docId twice (masterId is already
        // part of the key, so two different masters can't collide — this only protects against
        // a master somehow appearing in `rows` more than once).
        existingIds.add(docId);
        generated++;
        batchWrites++;
        // Stay comfortably under Firestore's 500-write-per-batch limit.
        if (batchWrites === 400) {
          commits.push(batch.commit());
          batch = writeBatch(db);
          batchWrites = 0;
        }
        }
      }
      if (batchWrites > 0) commits.push(batch.commit());
      await Promise.all(commits);

      const skippedParts = [
        duplicateCount && `${duplicateCount} already generated`,
        notYetDueCount && `${notYetDueCount} not yet due`,
        outsideDatesCount && `${outsideDatesCount} outside active dates`,
      ].filter(Boolean);
      const notYetActiveCount = generated - workflowTriggered;
      const detailParts = [
        workflowTriggered &&
          `${workflowTriggered} entered their workflow`,
        notYetActiveCount &&
          `${notYetActiveCount} still at "Scheduled" (not yet due for the workflow, or no assignee is configured for the first step)`,
        skippedParts.length && `skipped: ${skippedParts.join(", ")}`,
      ].filter(Boolean);
      toast({
        title: generated
          ? `${generated} payment(s) generated`
          : "No new payments were due for generation",
        description: detailParts.length
          ? `${detailParts.join(". ")}.`
          : undefined,
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

  function exportCsv() {
    const header = [
      "Title",
      "Category",
      "Vendor",
      "Branch",
      "Project",
      "Department",
      "Frequency",
      "Amount Type",
      "Amount",
      "Due Day",
      "Owner",
      "Status",
    ];
    const data = visible.map((master) => [
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
      master.assignedToName || "",
      master.status,
    ]);
    const csv = [header, ...data]
      .map((line) =>
        line
          .map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`)
          .join(","),
      )
      .join("\r\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    link.download = `recurring-payment-masters-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  async function importCsv(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !user || !canImport) return;
    try {
      const lines = (await file.text()).split(/\r?\n/).filter(Boolean);
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
      const dataRows = lines.slice(1, 101).map(parseCsvLine);
      for (const values of dataRows) {
        const get = (name: string) =>
          values[headers.indexOf(name)]?.trim() || "";
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
        if (projectValue && !project)
          throw new Error(`Global project not found: ${projectValue}.`);
        if (departmentValue && !department)
          throw new Error(`Global department not found: ${departmentValue}.`);
        await addDoc(collection(db, RP_COLLECTIONS.masters), {
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
          frequency: get("frequency") || "Monthly",
          amountType: get("amount type") || "Fixed",
          amount: Number(get("amount") || 0),
          dueDay: Number(get("due day") || 1),
          assignedTo: get("owner id"),
          assignedToName:
            users.find((item) => item.id === get("owner id"))?.name || "",
          startDate: get("start date"),
          status: "Draft",
          autoGenerationEnabled: true,
          deleted: false,
          createdAt: serverTimestamp(),
          createdBy: user.id,
          updatedAt: serverTimestamp(),
          updatedBy: user.id,
        });
      }
      toast({
        title: `${dataRows.length} draft master(s) imported`,
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
      <Card className="border-0 bg-gradient-to-r from-indigo-700 to-violet-700 text-white">
        <CardContent className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-2xl font-bold">Recurring Payment Masters</h1>
            <p className="text-sm text-indigo-100">
              Controlled templates for automated financial obligations
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canExport && (
              <Button variant="secondary" onClick={exportCsv}>
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
                  variant="secondary"
                  onClick={() => fileInput.current?.click()}
                >
                  <FileUp className="mr-2 h-4 w-4" />
                  Import masters
                </Button>
              </>
            )}
            {canGenerate && (
              <Button
                variant="secondary"
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
                <Button className="bg-white text-indigo-800 hover:bg-indigo-50">
                  <Plus className="mr-2 h-4 w-4" />
                  New master
                </Button>
              </Link>
            )}
          </div>
        </CardContent>
      </Card>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
      <CollapsibleFilterCard
        title="Search & filters"
        activeCount={activeFilterCount}
        onClear={() => { setSearch(""); setFilters(DEFAULT_MASTER_FILTERS); }}
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Search masters…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
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
                  {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CollapsibleFilterCard>
      {/* No card header here: the page banner above already names this list, so a "Master register"
          title plus a count restated the same thing twice in a row. */}
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Master</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Scope</TableHead>
                  <TableHead>Department / cost centre</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>Frequency</TableHead>
                  <TableHead>Next due</TableHead>
                  <TableHead className="text-right">Expected amount</TableHead>
                  <TableHead>Amount type</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((master) => {
                  // The cycle actually awaiting payment, which for arrears-billed masters is the
                  // closed period whose bill has arrived — not the period today sits inside.
                  const cycle = actionableRecurringCycle(master, new Date());
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
                        {cycle ? `Due ${cycle.dueDate}` : "Outside active dates"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right font-semibold">
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
                        <Badge
                          variant={
                            master.status === "Active" ? "default" : "secondary"
                          }
                        >
                          {master.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="icon" variant="ghost">
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
          </div>
        </CardContent>
      </Card>
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
