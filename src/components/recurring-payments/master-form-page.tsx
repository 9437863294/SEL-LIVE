"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  Timestamp,
  where,
  writeBatch,
} from "firebase/firestore";
import {
  getDownloadURL,
  ref as storageRef,
  uploadBytes,
} from "firebase/storage";
import {
  AlertCircle,
  ArrowLeft,
  BellRing,
  Building2,
  CalendarClock,
  CheckCircle2,
  FileText,
  Loader2,
  Save,
  Settings2,
  ShieldCheck,
  Users,
} from "lucide-react";
import { db } from "@/lib/firebase";
import { storage } from "@/lib/firebase-storage";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useToast } from "@/hooks/use-toast";
import {
  BILL_DATE_RULES,
  buildPaymentObligationFields,
  buildRecurringCycle,
  buildRecurringCycleSchedule,
  currency,
  DEFAULT_PAYMENT_CATEGORIES,
  DEFAULT_RECURRING_WORKFLOW,
  describeRecurrence,
  DUE_DATE_RULES,
  loadWorkingCalendar,
  matchApprovalRule,
  normalizeDueDateRule,
  resolveWorkflowActivation,
  type ApprovalRule,
  type RecurrenceRuleInput,
  type RecurringPaymentMaster,
  type RecurringWorkflowStep,
  RP_COLLECTIONS,
} from "@/lib/recurring-payments";
import { addBusinessHours, makeIsWorkingDay } from "@/lib/working-hours";
import { ControlledField, ControlledToggleLabel } from "./controlled-field";
import {
  useFieldControl,
  validateFieldControlRequirements,
  type RPFieldSetting,
} from "./use-field-control";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Textarea } from "@/components/ui/textarea";
import { useGlobalScopes } from "./use-global-scopes";

type NamedRecord = { id: string; name: string; status?: string };
const blank: Partial<RecurringPaymentMaster> = {
  frequency: "Monthly",
  amountType: "Fixed",
  status: "Draft",
  autoGenerationEnabled: true,
  generateLeadDays: 7,
  gracePeriodDays: 0,
  periodAnchorDay: 1,
  // New masters default to the utility/service pattern — the bill arrives after the period it
  // covers, and payment is due a number of days after that bill. Masters saved before the schedule
  // became computable have no bill rule at all and fall back to "Start of billing period", which is
  // what reproduces the due date they already resolved to (see resolveExpectedBillDate).
  billDateRule: "End of billing period",
  billDayOffset: 1,
  dueDateRule: "Days after bill date",
  dueDay: 15,
  approvalConfiguration: "Default rule",
  highVarianceAdditionalApproval: true,
  notificationChannels: ["inApp", "email"],
  tdsApplicable: false,
  gstApplicable: false,
};

/**
 * Loads a saved master into the form without letting `blank`'s new-master defaults overwrite the
 * schedule it was actually saved with. A master written before the schedule became computable has
 * no `billDateRule`/`generateLeadDays`, so spreading `blank` under it would silently re-anchor its
 * bill date and reset its lead time on the next edit. Instead the legacy values are carried across
 * to the fields that replaced them, and legacy due-rule wording is mapped onto a selectable option.
 */
function hydrateMasterDraft(
  id: string,
  data: Partial<RecurringPaymentMaster>,
): Partial<RecurringPaymentMaster> {
  return {
    ...blank,
    ...data,
    id,
    billDateRule: data.billDateRule || "Start of billing period",
    billDayOffset: Number(data.billDayOffset ?? 1),
    dueDateRule: normalizeDueDateRule(data.dueDateRule),
    dueDay: Number(data.dueDay ?? blank.dueDay ?? 1),
    generateLeadDays: Number(
      data.generateLeadDays ?? data.generateBeforeDueDays ?? 7,
    ),
    gracePeriodDays: Number(data.gracePeriodDays || 0),
    periodAnchorDay: Number(data.periodAnchorDay || 1),
  };
}

export default function RecurringMasterFormPage({
  masterId,
}: {
  masterId?: string;
}) {
  const router = useRouter();
  const { user, users } = useAuth();
  const { can } = useAuthorization();
  const { toast } = useToast();
  const { field } = useFieldControl("master");
  const organizationId = user?.organizationId || "default";
  const { projects, departments, activeProjects, activeDepartments } =
    useGlobalScopes();
  const [draft, setDraft] = useState<Partial<RecurringPaymentMaster>>(blank);
  const [vendors, setVendors] = useState<NamedRecord[]>([]);
  const [categories, setCategories] = useState<NamedRecord[]>([]);
  const [rules, setRules] = useState<ApprovalRule[]>([]);
  // Only needed so the schedule preview resolves a "last working day of month" due date against the
  // org's real calendar; until it arrives the math falls back to Mon–Fri.
  const [calendar, setCalendar] = useState<Awaited<ReturnType<typeof loadWorkingCalendar>> | null>(null);
  const [loading, setLoading] = useState(!!masterId);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof RecurringPaymentMaster>(
    key: K,
    value: RecurringPaymentMaster[K],
  ) => setDraft((current) => ({ ...current, [key]: value }));
  useEffect(() => {
    Promise.all([
      getDocs(
        query(
          collection(db, RP_COLLECTIONS.vendors),
          where("organizationId", "==", organizationId),
        ),
      ),
      getDocs(
        query(
          collection(db, RP_COLLECTIONS.categories),
          where("organizationId", "==", organizationId),
        ),
      ),
      getDocs(
        query(
          collection(db, RP_COLLECTIONS.approvalRules),
          where("organizationId", "==", organizationId),
        ),
      ),
      masterId
        ? getDoc(doc(db, RP_COLLECTIONS.masters, masterId))
        : Promise.resolve(null),
    ])
      .then(
        ([vendorSnapshot, categorySnapshot, ruleSnapshot, masterSnapshot]) => {
          setVendors(
            vendorSnapshot.docs.map(
              (item) => ({ id: item.id, ...item.data() }) as NamedRecord,
            ),
          );
          setCategories(
            categorySnapshot.docs.map(
              (item) => ({ id: item.id, ...item.data() }) as NamedRecord,
            ),
          );
          setRules(
            ruleSnapshot.docs.map(
              (item) => ({ id: item.id, ...item.data() }) as ApprovalRule,
            ),
          );
          if (masterSnapshot && masterSnapshot.exists())
            setDraft(
              hydrateMasterDraft(masterSnapshot.id, masterSnapshot.data()),
            );
          setLoading(false);
        },
      )
      .catch(() => setLoading(false));
  }, [masterId, organizationId]);
  useEffect(() => {
    loadWorkingCalendar().then(setCalendar).catch(() => undefined);
  }, []);
  const netAmount = Number(draft.amount || 0) + Number(draft.taxAmount || 0);
  // Mirrors the exact checks `save()` runs before writing — surfaced here so the sidebar can show
  // what's blocking submission live, instead of the user only finding out from a toast after
  // clicking a save button.
  const missingRequired = useMemo(() => {
    const missing: string[] = [];
    if (!draft.title?.trim()) missing.push("Payment title");
    if (!draft.category) missing.push("Category");
    if (!draft.vendorName?.trim()) missing.push("Vendor");
    if (!draft.startDate) missing.push("Start date");
    if (!draft.assignedTo) missing.push("Payment owner");
    if (draft.endDate && draft.startDate && draft.endDate < draft.startDate)
      missing.push("End date (cannot be before start date)");
    if (draft.amountType === "Fixed" && !Number(draft.amount))
      missing.push("Fixed amount");
    if (draft.frequency === "Custom" && !Number(draft.customIntervalDays))
      missing.push("Custom interval days");
    return missing;
  }, [
    draft.title,
    draft.category,
    draft.vendorName,
    draft.startDate,
    draft.endDate,
    draft.assignedTo,
    draft.amountType,
    draft.amount,
    draft.frequency,
    draft.customIntervalDays,
  ]);
  // The exact rule set the schedule math consumes, so the preview below and what automation will
  // actually generate can never drift apart — both read this one object.
  const recurrenceRules: RecurrenceRuleInput | null = useMemo(() => {
    if (!draft.frequency || !draft.startDate) return null;
    return {
      frequency: draft.frequency,
      startDate: draft.startDate,
      endDate: draft.endDate,
      periodAnchorDay: Number(draft.periodAnchorDay || 1),
      billDateRule: draft.billDateRule,
      billDayOffset: Number(draft.billDayOffset ?? 1),
      dueDateRule: draft.dueDateRule,
      dueDay: Number(draft.dueDay ?? 1),
      gracePeriodDays: Number(draft.gracePeriodDays || 0),
      generateLeadDays: Number(draft.generateLeadDays ?? 7),
      customIntervalDays:
        draft.frequency === "Custom"
          ? Number(draft.customIntervalDays || 30)
          : undefined,
    };
  }, [
    draft.frequency,
    draft.startDate,
    draft.endDate,
    draft.periodAnchorDay,
    draft.billDateRule,
    draft.billDayOffset,
    draft.dueDateRule,
    draft.dueDay,
    draft.gracePeriodDays,
    draft.generateLeadDays,
    draft.customIntervalDays,
  ]);
  const scheduleOptions = useMemo(
    () => ({ isWorkingDay: makeIsWorkingDay(calendar?.workingHours, calendar?.holidays) }),
    [calendar],
  );
  const schedulePreview = useMemo(
    () =>
      recurrenceRules
        ? buildRecurringCycleSchedule(recurrenceRules, { ...scheduleOptions, count: 3 })
        : [],
    [recurrenceRules, scheduleOptions],
  );
  const previewCycle = schedulePreview[0] || null;
  const ownerPreview = users.find((item) => item.id === draft.assignedTo);
  async function uploadDocuments(form: FormData, id: string) {
    const files = form
      .getAll("masterDocuments")
      .filter((item): item is File => item instanceof File && item.size > 0);
    return Promise.all(
      files.map(async (file, index) => {
        const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const reference = storageRef(
          storage,
          `recurring-payments/${organizationId}/masters/${id}/${Date.now()}-${safe}`,
        );
        await uploadBytes(reference, file);
        return {
          reference: await getDownloadURL(reference),
          fileName: file.name,
          fileType: file.type || file.name.split(".").pop() || "file",
          fileSize: file.size,
          documentType: "Master supporting document",
          uploadedBy: user?.id || "",
          uploadedAt: Timestamp.now(),
          version: (draft.masterDocuments?.length || 0) + index + 1,
        };
      }),
    );
  }
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !user ||
      !(masterId
        ? can("Edit", "Recurring Payments.Recurring Masters")
        : can("Add", "Recurring Payments.Recurring Masters"))
    )
      return;
    // React nulls out the SyntheticEvent's currentTarget once the handler yields (e.g. at an
    // `await`), so the form element must be captured synchronously here rather than read from
    // `event.currentTarget` later — otherwise `new FormData(...)` below throws
    // "parameter 1 is not of type 'HTMLFormElement'".
    const formElement = event.currentTarget;
    const native = event.nativeEvent as SubmitEvent;
    const intent =
      (native.submitter as HTMLButtonElement | null)?.value || "draft";
    if (
      !draft.title?.trim() ||
      !draft.category ||
      !draft.vendorName ||
      !draft.startDate ||
      !draft.assignedTo
    )
      return toast({
        title: "Complete the mandatory basic and assignment fields",
        variant: "destructive",
      });
    if (draft.endDate && draft.endDate < draft.startDate)
      return toast({
        title: "End date cannot be before start date",
        variant: "destructive",
      });
    if (draft.amountType === "Fixed" && !Number(draft.amount))
      return toast({
        title: "Fixed amount is required",
        variant: "destructive",
      });
    if (draft.frequency === "Custom" && !Number(draft.customIntervalDays))
      return toast({
        title: "Custom interval is required",
        variant: "destructive",
      });
    const missingLabel = validateFieldControlRequirements("master", draft, field);
    if (missingLabel)
      return toast({
        title: `${missingLabel} is required`,
        variant: "destructive",
      });
    setSaving(true);
    try {
      // Multiple masters may intentionally share the same category and account (e.g. several
      // recurring "Rent" payments billed to the same account), so no duplicate check is applied
      // here beyond the mandatory-field validation above.
      const masterRef = masterId
        ? doc(db, RP_COLLECTIONS.masters, masterId)
        : doc(collection(db, RP_COLLECTIONS.masters));
      const form = new FormData(formElement);
      const documents = await uploadDocuments(form, masterRef.id);
      const owner = users.find((item) => item.id === draft.assignedTo);
      const status: RecurringPaymentMaster["status"] =
        intent === "draft" ? "Draft" : "Active";
      const approvalRule = matchApprovalRule(rules, {
        amount: Number(draft.amount || 0),
        category: draft.category,
        projectId: draft.projectId,
        projectName: draft.projectName,
      });
      // Omit `id` rather than setting it to `undefined` — Firestore's set()/update() rejects
      // any field whose value is `undefined`.
      const { id: _draftId, ...draftFields } = draft;
      const payload = {
        ...draftFields,
        organizationId,
        organizationName: user.organizationName || "",
        amount: Number(draft.amount || 0),
        maximumAmount: Number(draft.maximumAmount || 0),
        taxAmount: Number(draft.taxAmount || 0),
        securityDeposit: Number(draft.securityDeposit || 0),
        dueDay: Math.max(0, Number(draft.dueDay ?? 1)),
        billDayOffset: Math.max(0, Number(draft.billDayOffset ?? 1)),
        periodAnchorDay: Math.min(31, Math.max(1, Number(draft.periodAnchorDay || 1))),
        gracePeriodDays: Math.max(0, Number(draft.gracePeriodDays || 0)),
        generateLeadDays: Math.max(0, Number(draft.generateLeadDays ?? 7)),
        customIntervalDays:
          draft.frequency === "Custom"
            ? Number(draft.customIntervalDays || 30)
            : null,
        varianceTolerancePercent: Number(draft.varianceTolerancePercent || 20),
        assignedToName: owner?.name || "",
        status,
        deleted: false,
        masterDocuments: [...(draft.masterDocuments || []), ...documents],
        updatedAt: serverTimestamp(),
        updatedBy: user.id,
      };
      const batch = writeBatch(db);
      if (masterId) batch.update(masterRef, payload);
      else
        batch.set(masterRef, {
          ...payload,
          createdAt: serverTimestamp(),
          createdBy: user.id,
        });
      batch.set(doc(collection(masterRef, RP_COLLECTIONS.auditLogs)), {
        organizationId,
        masterId: masterRef.id,
        action: masterId ? "Master updated" : "Master created",
        summary: `${draft.title} saved as ${status}`,
        page: masterId
          ? `/recurring-payments/masters/${masterRef.id}/edit`
          : "/recurring-payments/masters/new",
        recordId: masterRef.id,
        userId: user.id,
        userName: user.name,
        newValue: { status, amount: netAmount, frequency: draft.frequency },
        createdAt: serverTimestamp(),
      });
      let activationStage: string | null = null;
      if (intent === "generate") {
        // Same rule object the preview reads, so what gets written is what the user was shown.
        const cycle = recurrenceRules
          ? buildRecurringCycle(recurrenceRules, new Date(), scheduleOptions)
          : null;
        if (cycle) {
          const cycleKey = `${organizationId}_${masterRef.id}_${cycle.key}`;
          const paymentRef = doc(
            db,
            RP_COLLECTIONS.payments,
            cycleKey.replace(/[^a-zA-Z0-9_-]/g, "_"),
          );
          const obligationFields = buildPaymentObligationFields({
            organizationId,
            masterId: masterRef.id,
            cycle,
            generatedAutomatically: false,
            title: draft.title!,
            category: draft.category!,
            vendorName: draft.vendorName!,
            branchId: draft.branchId,
            branchName: draft.branchName,
            projectId: draft.projectId,
            projectName: draft.projectName,
            departmentId: draft.departmentId,
            department: draft.department,
            costCentre: draft.costCentre,
            ledger: draft.ledger,
            amountType: draft.amountType,
            description: draft.description,
            accountNumber: draft.accountNumber,
            amount: Number(draft.amount || 0),
            maximumAmount: Number(draft.maximumAmount || 0),
            assignedTo: draft.assignedTo,
            backupAssignedTo: draft.backupAssignedTo,
            verifierId: draft.verifierId,
            approverId: draft.approverId,
            accountsProcessorId: draft.accountsProcessorId,
            approvalRule,
          });
          // Don't leave this obligation stuck at "Scheduled" until the next automation run: if
          // it's already due soon enough per the org's workflow-activation window, enter it into
          // the first workflow step immediately, same as the daily automation job would.
          const [settingsSnap, workflowSnap, calendar] = await Promise.all([
            getDoc(doc(db, RP_COLLECTIONS.settings, organizationId.replace(/[^a-zA-Z0-9_-]/g, "_"))),
            getDoc(doc(db, "workflows", "recurring-payments-workflow")),
            loadWorkingCalendar(),
          ]);
          const activationDays = Math.min(90, Math.max(0, Number(settingsSnap.data()?.automation?.workflowActivationDays ?? 7)));
          const workflow = (workflowSnap.data()?.steps || DEFAULT_RECURRING_WORKFLOW) as RecurringWorkflowStep[];
          const activation = resolveWorkflowActivation(workflow[0], obligationFields, { activationDays, today: new Date() });
          if (activation) activationStage = activation.stage;
          batch.set(
            paymentRef,
            {
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
            },
            { merge: false },
          );
        }
      }
      await batch.commit();
      toast({
        title: masterId
          ? "Recurring master updated"
          : "Recurring master created",
        description:
          intent === "generate"
            ? activationStage
              ? `Current cycle generated and sent to ${activationStage} for action.`
              : "Current cycle generated, but not due soon enough yet to enter the workflow — it'll activate automatically as the due date approaches."
            : undefined,
      });
      router.push(`/recurring-payments/masters/${masterRef.id}`);
    } catch (error) {
      toast({
        title: "Master could not be saved",
        description:
          error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }
  if (loading)
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin" />
      </div>
    );
  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold">
              {masterId
                ? "Edit Recurring Master"
                : "Create Recurring Payment Master"}
            </h1>
            {masterId && draft.status && (
              <Badge variant={draft.status === "Active" ? "default" : "secondary"}>
                {draft.status}
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            Configuration, generation, approval, notification and ownership
            controls
          </p>
        </div>
      </div>
      <form onSubmit={save} className="space-y-5">
        <div className="grid gap-5 lg:grid-cols-[1fr_320px] lg:items-start">
        <div className="space-y-5">
        <Section
          icon={Building2}
          title="Basic details"
          description="Where this obligation belongs and who it's billed to."
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Organization *">
              <Input
                value={user?.organizationName || organizationId}
                disabled
              />
            </Field>
            <ControlledField setting={field("branchName")}>
              <Input
                value={draft.branchName || ""}
                onChange={(event) => set("branchName", event.target.value)}
              />
            </ControlledField>
            <ControlledField setting={field("projectId")}>
              <Select
                value={
                  draft.projectId ||
                  projects.find(
                    (item) => item.projectName === draft.projectName,
                  )?.id ||
                  "none"
                }
                onValueChange={(value) => {
                  const project = projects.find((item) => item.id === value);
                  setDraft((current) => ({
                    ...current,
                    projectId: project?.id || "",
                    projectName: project?.projectName || "",
                  }));
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select global project" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No project</SelectItem>
                  {activeProjects.map((project) => (
                    <SelectItem value={project.id} key={project.id}>
                      {project.projectName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </ControlledField>
            <ControlledField setting={field("departmentId")}>
              <Select
                value={
                  draft.departmentId ||
                  departments.find((item) => item.name === draft.department)
                    ?.id ||
                  "none"
                }
                onValueChange={(value) => {
                  const department = departments.find(
                    (item) => item.id === value,
                  );
                  setDraft((current) => ({
                    ...current,
                    departmentId: department?.id || "",
                    department: department?.name || "",
                  }));
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select global department" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No department</SelectItem>
                  {activeDepartments.map((department) => (
                    <SelectItem value={department.id} key={department.id}>
                      {department.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </ControlledField>
            <ControlledField setting={field("title")}>
              <Input
                value={draft.title || ""}
                onChange={(event) => set("title", event.target.value)}
              />
            </ControlledField>
            <ControlledField setting={field("category")}>
              <Select
                value={draft.category}
                onValueChange={(value) => set("category", value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {[
                    ...new Set([
                      ...DEFAULT_PAYMENT_CATEGORIES,
                      ...categories.map((item) => item.name),
                    ]),
                  ].map((item) => (
                    <SelectItem value={item} key={item}>
                      {item}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </ControlledField>
            <ControlledField setting={field("vendorName")}>
              <Input
                list="master-form-vendors"
                value={draft.vendorName || ""}
                onChange={(event) => set("vendorName", event.target.value)}
              />
              <datalist id="master-form-vendors">
                {vendors.map((item) => (
                  <option key={item.id}>{item.name}</option>
                ))}
              </datalist>
            </ControlledField>
            <ControlledField setting={field("accountNumber")}>
              <Input
                value={draft.accountNumber || ""}
                onChange={(event) => set("accountNumber", event.target.value)}
              />
            </ControlledField>
            <ControlledField setting={field("internalReference")}>
              <Input
                value={draft.internalReference || ""}
                onChange={(event) =>
                  set("internalReference", event.target.value)
                }
              />
            </ControlledField>
            <div className="sm:col-span-2 lg:col-span-3">
              <ControlledField setting={field("description")}>
                <Textarea
                  value={draft.description || ""}
                  onChange={(event) => set("description", event.target.value)}
                />
              </ControlledField>
            </div>
          </div>
        </Section>
        <Section
          icon={Settings2}
          title="Billing period"
          description="How often a cycle occurs, and the window of service each cycle covers."
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <ControlledField setting={field("frequency")}>
              <Select
                value={draft.frequency}
                onValueChange={(value) =>
                  set("frequency", value as RecurringPaymentMaster["frequency"])
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[
                    "Weekly",
                    "Monthly",
                    "Bi-monthly",
                    "Quarterly",
                    "Half-yearly",
                    "Yearly",
                    "Renewable",
                    "Custom",
                  ].map((item) => (
                    <SelectItem value={item} key={item}>
                      {item}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </ControlledField>
            {draft.frequency === "Custom" && (
              <ControlledField setting={field("customIntervalDays")}>
                <Input
                  type="number"
                  min="1"
                  value={draft.customIntervalDays || ""}
                  onChange={(event) =>
                    set("customIntervalDays", Number(event.target.value))
                  }
                />
              </ControlledField>
            )}
            <ControlledField setting={field("startDate")}>
              <Input
                type="date"
                value={draft.startDate || ""}
                onChange={(event) => set("startDate", event.target.value)}
              />
            </ControlledField>
            <ControlledField setting={field("endDate")}>
              <Input
                type="date"
                value={draft.endDate || ""}
                onChange={(event) => set("endDate", event.target.value)}
              />
            </ControlledField>
            {/* Only the month-based frequencies have a month day to anchor to; Weekly, Custom and
                Renewable periods already run from the master's start date. */}
            {!["Weekly", "Custom", "Renewable"].includes(draft.frequency || "") && (
              <ControlledField
                setting={field("periodAnchorDay")}
                help="1 for calendar months. Use 17 for a vendor who bills the 17th to the 16th."
              >
                <Input
                  type="number"
                  min="1"
                  max="31"
                  value={draft.periodAnchorDay ?? 1}
                  onChange={(event) =>
                    set("periodAnchorDay", Number(event.target.value))
                  }
                />
              </ControlledField>
            )}
          </div>
        </Section>
        <Section
          icon={CalendarClock}
          title="Bill and due dates"
          description="Each cycle's dates derive from each other in order: billing period → bill date → due date → overdue date. The obligation record itself is created a lead time before the bill date."
        >
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <ControlledField setting={field("billDateRule")}>
                {/* Falls back to the same rule resolveExpectedBillDate does, so the dropdown can
                    never display a rule the calculation isn't actually using. */}
                <Select
                  value={draft.billDateRule || "Start of billing period"}
                  onValueChange={(value) =>
                    set("billDateRule", value as RecurringPaymentMaster["billDateRule"])
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BILL_DATE_RULES.map((item) => (
                      <SelectItem value={item} key={item}>
                        {item}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </ControlledField>
              {/* Only the two offset-driven bill rules have a number to configure; the period-anchored
                  ones would show an input that changes nothing. */}
              {["Fixed day of month", "Days after period end"].includes(
                draft.billDateRule || "",
              ) && (
                <ControlledField
                  setting={{
                    ...field("billDayOffset"),
                    label:
                      draft.billDateRule === "Fixed day of month"
                        ? "Bill day of month"
                        : "Days after period end",
                  }}
                >
                  <Input
                    type="number"
                    min="0"
                    max={draft.billDateRule === "Fixed day of month" ? "31" : "90"}
                    value={draft.billDayOffset ?? 1}
                    onChange={(event) =>
                      set("billDayOffset", Number(event.target.value))
                    }
                  />
                </ControlledField>
              )}
              <ControlledField setting={field("dueDateRule")}>
                <Select
                  value={normalizeDueDateRule(draft.dueDateRule)}
                  onValueChange={(value) =>
                    set("dueDateRule", value as RecurringPaymentMaster["dueDateRule"])
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DUE_DATE_RULES.map((item) => (
                      <SelectItem value={item} key={item}>
                        {item}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </ControlledField>
              {/* "Last day / last working day of month" and "Same as bill date" need no number. */}
              {["Days after bill date", "Fixed day of month"].includes(
                normalizeDueDateRule(draft.dueDateRule),
              ) && (
                <ControlledField
                  setting={{
                    ...field("dueDay"),
                    label:
                      normalizeDueDateRule(draft.dueDateRule) === "Fixed day of month"
                        ? "Due day of month"
                        : "Days after bill date",
                  }}
                >
                  <Input
                    type="number"
                    min="0"
                    max={
                      normalizeDueDateRule(draft.dueDateRule) === "Fixed day of month"
                        ? "31"
                        : "180"
                    }
                    value={draft.dueDay ?? 1}
                    onChange={(event) => set("dueDay", Number(event.target.value))}
                  />
                </ControlledField>
              )}
              <ControlledField setting={field("gracePeriodDays")}>
                <Input
                  type="number"
                  min="0"
                  max="90"
                  value={draft.gracePeriodDays ?? 0}
                  onChange={(event) =>
                    set("gracePeriodDays", Number(event.target.value))
                  }
                />
              </ControlledField>
              <ControlledField setting={field("generateLeadDays")}>
                <Input
                  type="number"
                  min="0"
                  max="365"
                  value={draft.generateLeadDays ?? 7}
                  onChange={(event) =>
                    set("generateLeadDays", Number(event.target.value))
                  }
                />
              </ControlledField>
              {field("autoGenerationEnabled").visible && (
                <Toggle
                  label={<ControlledToggleLabel setting={field("autoGenerationEnabled")} />}
                  checked={draft.autoGenerationEnabled !== false}
                  onChange={(value) => set("autoGenerationEnabled", value)}
                />
              )}
            </div>
            <SchedulePreview
              rules={recurrenceRules}
              cycles={schedulePreview}
              autoGenerationEnabled={draft.autoGenerationEnabled !== false}
            />
          </div>
        </Section>
        <Section
          icon={FileText}
          title="Amount and accounting"
          description="Expected amount, tax treatment and ledger coding."
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <ControlledField setting={field("amountType")}>
              <Select
                value={draft.amountType}
                onValueChange={(value) =>
                  set(
                    "amountType",
                    value as RecurringPaymentMaster["amountType"],
                  )
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["Fixed", "Variable", "Estimated"].map((item) => (
                    <SelectItem value={item} key={item}>
                      {item}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </ControlledField>
            <ControlledField
              setting={{
                ...field("amount"),
                // Only substitute the Fixed/Estimated wording while the label is still the
                // registry default — once an admin customizes it, respect their wording as-is.
                label:
                  field("amount").label === "Amount"
                    ? draft.amountType === "Fixed"
                      ? "Fixed amount"
                      : "Estimated amount"
                    : field("amount").label,
              }}
            >
              <Input
                type="number"
                min="0"
                value={draft.amount || ""}
                onChange={(event) => set("amount", Number(event.target.value))}
              />
            </ControlledField>
            <ControlledField setting={field("maximumAmount")}>
              <Input
                type="number"
                min="0"
                value={draft.maximumAmount || ""}
                onChange={(event) =>
                  set("maximumAmount", Number(event.target.value))
                }
              />
            </ControlledField>
            <ControlledField setting={field("taxAmount")}>
              <Input
                type="number"
                min="0"
                value={draft.taxAmount || ""}
                onChange={(event) =>
                  set("taxAmount", Number(event.target.value))
                }
              />
            </ControlledField>
            <ControlledField setting={field("costCentre")}>
              <Input
                value={draft.costCentre || ""}
                onChange={(event) => set("costCentre", event.target.value)}
              />
            </ControlledField>
            <ControlledField setting={field("ledger")}>
              <Input
                value={draft.ledger || ""}
                onChange={(event) => set("ledger", event.target.value)}
              />
            </ControlledField>
            <ControlledField setting={field("budgetHead")}>
              <Input
                value={draft.budgetHead || ""}
                onChange={(event) => set("budgetHead", event.target.value)}
              />
            </ControlledField>
            <ControlledField setting={field("varianceTolerancePercent")}>
              <Input
                type="number"
                min="0"
                value={draft.varianceTolerancePercent || 20}
                onChange={(event) =>
                  set("varianceTolerancePercent", Number(event.target.value))
                }
              />
            </ControlledField>
            {field("tdsApplicable").visible && (
              <Toggle
                label={<ControlledToggleLabel setting={field("tdsApplicable")} />}
                checked={!!draft.tdsApplicable}
                onChange={(value) => set("tdsApplicable", value)}
              />
            )}
            {field("gstApplicable").visible && (
              <Toggle
                label={<ControlledToggleLabel setting={field("gstApplicable")} />}
                checked={!!draft.gstApplicable}
                onChange={(value) => set("gstApplicable", value)}
              />
            )}
          </div>
        </Section>
        <Section
          icon={Users}
          title="Assignment"
          description="Who owns, verifies, approves and processes this payment."
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <UserField
              setting={field("assignedTo")}
              value={draft.assignedTo}
              onChange={(value) => set("assignedTo", value)}
              users={users}
            />
            <UserField
              setting={field("backupAssignedTo")}
              value={draft.backupAssignedTo}
              onChange={(value) => set("backupAssignedTo", value)}
              users={users}
              allowNone
            />
            <UserField
              setting={field("verifierId")}
              value={draft.verifierId}
              onChange={(value) => set("verifierId", value)}
              users={users}
              allowNone
            />
            <UserField
              setting={field("approverId")}
              value={draft.approverId}
              onChange={(value) => set("approverId", value)}
              users={users}
              allowNone
            />
            <UserField
              setting={field("accountsProcessorId")}
              value={draft.accountsProcessorId}
              onChange={(value) => set("accountsProcessorId", value)}
              users={users}
              allowNone
            />
            <UserField
              setting={field("escalationAuthorityId")}
              value={draft.escalationAuthorityId}
              onChange={(value) => set("escalationAuthorityId", value)}
              users={users}
              allowNone
            />
          </div>
        </Section>
        <Section
          icon={ShieldCheck}
          title="Approval configuration"
          description="Which approval rule applies once a bill is submitted."
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <ControlledField setting={field("approvalConfiguration")}>
              <Select
                value={draft.approvalConfiguration}
                onValueChange={(value) =>
                  set(
                    "approvalConfiguration",
                    value as RecurringPaymentMaster["approvalConfiguration"],
                  )
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[
                    "Default rule",
                    "Custom rule",
                    "No approval",
                    "Bill amount based",
                  ].map((item) => (
                    <SelectItem value={item} key={item}>
                      {item}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </ControlledField>
            {draft.approvalConfiguration === "Custom rule" &&
              field("customApprovalRuleId").visible && (
                <ControlledField setting={field("customApprovalRuleId")}>
                  <Select
                    value={draft.customApprovalRuleId}
                    onValueChange={(value) => set("customApprovalRuleId", value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select rule" />
                    </SelectTrigger>
                    <SelectContent>
                      {rules
                        .filter((item) => item.active)
                        .map((item) => (
                          <SelectItem value={item.id} key={item.id}>
                            {item.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </ControlledField>
              )}
            {field("highVarianceAdditionalApproval").visible && (
              <Toggle
                label={<ControlledToggleLabel setting={field("highVarianceAdditionalApproval")} />}
                checked={!!draft.highVarianceAdditionalApproval}
                onChange={(value) => set("highVarianceAdditionalApproval", value)}
              />
            )}
          </div>
        </Section>
        <Section
          icon={BellRing}
          title="Notification and documents"
          description="Who gets reminders, and any standing reference documents."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <ControlledField setting={field("reminderRecipients")}>
              <Input
                value={(draft.reminderRecipients || []).join(", ")}
                onChange={(event) =>
                  set(
                    "reminderRecipients",
                    event.target.value
                      .split(",")
                      .map((item) => item.trim())
                      .filter(Boolean),
                  )
                }
              />
            </ControlledField>
            <ControlledField setting={field("escalationRecipients")}>
              <Input
                value={(draft.escalationRecipients || []).join(", ")}
                onChange={(event) =>
                  set(
                    "escalationRecipients",
                    event.target.value
                      .split(",")
                      .map((item) => item.trim())
                      .filter(Boolean),
                  )
                }
              />
            </ControlledField>
            <ControlledField setting={field("masterDocuments")}>
              <Input
                name="masterDocuments"
                type="file"
                multiple
                accept=".pdf,.jpg,.jpeg,.png,.xlsx,.docx"
              />
            </ControlledField>
          </div>
        </Section>
        </div>
        <SummarySidebar
          draft={draft}
          owner={ownerPreview}
          missingRequired={missingRequired}
          previewCycle={previewCycle}
        />
        </div>
        <div className="sticky bottom-0 z-10 -mx-3 flex flex-wrap justify-end gap-2 border-t bg-background/95 px-3 py-3 backdrop-blur sm:-mx-4 sm:px-4">
          <Button type="button" variant="outline" onClick={() => router.back()}>
            Cancel
          </Button>
          <Button
            type="submit"
            value="draft"
            variant="secondary"
            disabled={saving}
          >
            <Save className="mr-2 h-4 w-4" />
            Save as draft
          </Button>
          <Button type="submit" value="active" disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save
            and activate
          </Button>
          {!masterId && (
            <Button
              type="submit"
              value="generate"
              className="bg-emerald-600 hover:bg-emerald-500"
              disabled={saving}
            >
              Save and generate first payment
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
function Section({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon className="h-5 w-5 text-indigo-600" />
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
/** Formats an ISO date as `dd MMM yyyy` — the schedule is read as dates, not as ISO strings. */
const showDate = (value: string) =>
  new Date(`${value}T00:00:00`).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

/**
 * Resolves the configured rules into the actual dates of the next few cycles. Without this the
 * rule fields above are unanswerable from the form alone — a user can pick "days after bill date"
 * and a lead time with no way to tell what date a bill will be generated on or when it falls due,
 * which is exactly how the previous layout read.
 */
function SchedulePreview({
  rules,
  cycles,
  autoGenerationEnabled,
}: {
  rules: RecurrenceRuleInput | null;
  cycles: ReturnType<typeof buildRecurringCycleSchedule>;
  autoGenerationEnabled: boolean;
}) {
  if (!rules)
    return (
      <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
        Pick a frequency and start date to see when bills will be generated and
        when they fall due.
      </div>
    );
  return (
    <div className="space-y-3 rounded-xl border bg-muted/30 p-4">
      <div>
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <CalendarClock className="h-4 w-4 text-indigo-600" />
          Resulting schedule
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {describeRecurrence(rules)}
        </p>
      </div>
      {cycles.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-left text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="pb-1.5 pr-3 font-medium">Cycle</th>
                <th className="pb-1.5 pr-3 font-medium">Billing period</th>
                <th className="pb-1.5 pr-3 font-medium">Obligation created</th>
                <th className="pb-1.5 pr-3 font-medium">Bill expected</th>
                <th className="pb-1.5 pr-3 font-medium">Payment due</th>
                <th className="pb-1.5 font-medium">Overdue after</th>
              </tr>
            </thead>
            <tbody className="align-top">
              {cycles.map((cycle) => (
                <tr key={cycle.key} className="border-t">
                  <td className="py-1.5 pr-3 font-medium">{cycle.label}</td>
                  <td className="py-1.5 pr-3 text-muted-foreground">
                    {showDate(cycle.billingPeriodStart)} –{" "}
                    {showDate(cycle.billingPeriodEnd)}
                  </td>
                  <td className="py-1.5 pr-3 text-muted-foreground">
                    {autoGenerationEnabled ? showDate(cycle.generationDate) : "Manual only"}
                  </td>
                  <td className="py-1.5 pr-3">{showDate(cycle.expectedBillDate)}</td>
                  <td className="py-1.5 pr-3 font-semibold">
                    {showDate(cycle.dueDate)}
                  </td>
                  <td className="py-1.5 text-muted-foreground">
                    {showDate(cycle.overdueDate)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          No cycles fall between the start and end dates — check the date range.
        </p>
      )}
      {!autoGenerationEnabled && (
        <p className="text-xs text-amber-700">
          Auto-generation is off, so nothing is created on its own. The dates
          above still apply to obligations generated manually from the master.
        </p>
      )}
    </div>
  );
}

function SummarySidebar({
  draft,
  owner,
  missingRequired,
  previewCycle,
}: {
  draft: Partial<RecurringPaymentMaster>;
  owner?: { name: string };
  missingRequired: string[];
  previewCycle: { label: string; dueDate: string; expectedBillDate: string } | null;
}) {
  return (
    <Card className="lg:sticky lg:top-4">
      <CardHeader>
        <CardTitle className="text-base">Preview</CardTitle>
        <CardDescription>
          Live snapshot of this master as configured so far.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="font-semibold">{draft.title || "Untitled master"}</p>
          <p className="text-xs text-muted-foreground">
            {draft.category || "No category"} ·{" "}
            {draft.vendorName || "No vendor"}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <SummaryStat label="Frequency" value={draft.frequency || "—"} />
          <SummaryStat
            label="Amount"
            value={draft.amount ? currency(Number(draft.amount)) : "—"}
          />
          <SummaryStat label="Owner" value={owner?.name || "Unassigned"} />
          <SummaryStat label="Status" value={draft.status || "Draft"} />
        </div>
        <div className="rounded-lg border bg-muted/30 p-3">
          <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <CalendarClock className="h-3.5 w-3.5" />
            Next cycle
          </p>
          {previewCycle ? (
            <>
              <p className="mt-1 text-sm font-semibold">
                {previewCycle.label}
              </p>
              <p className="text-xs text-muted-foreground">
                Bill {showDate(previewCycle.expectedBillDate)} · due{" "}
                {showDate(previewCycle.dueDate)}
              </p>
            </>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">
              Add a start date to preview the first cycle.
            </p>
          )}
        </div>
        {missingRequired.length ? (
          <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-semibold">Before you can save</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {missingRequired.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-xs text-emerald-900">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            All required fields are complete.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  );
}
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
function Toggle({
  label,
  checked,
  onChange,
}: {
  label: React.ReactNode;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 rounded-lg border p-3 text-sm">
      <Checkbox
        checked={checked}
        onCheckedChange={(value) => onChange(value === true)}
      />
      {label}
    </label>
  );
}
function UserField({
  setting,
  value,
  onChange,
  users,
  allowNone = false,
}: {
  setting: RPFieldSetting;
  value?: string;
  onChange: (value: string) => void;
  users: Array<{ id: string; name: string; status: string }>;
  allowNone?: boolean;
}) {
  return (
    <ControlledField setting={setting}>
      <Select
        value={value || (allowNone ? "none" : undefined)}
        onValueChange={(next) => onChange(next === "none" ? "" : next)}
      >
        <SelectTrigger>
          <SelectValue placeholder="Select user" />
        </SelectTrigger>
        <SelectContent>
          {allowNone && <SelectItem value="none">Unassigned</SelectItem>}
          {users
            .filter((item) => item.status === "Active")
            .map((item) => (
              <SelectItem value={item.id} key={item.id}>
                {item.name}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
    </ControlledField>
  );
}
