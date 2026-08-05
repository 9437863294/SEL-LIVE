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
  ArrowLeft,
  BellRing,
  Building2,
  FileText,
  Loader2,
  Save,
  Settings2,
  ShieldCheck,
  Users,
} from "lucide-react";
import { db, storage } from "@/lib/firebase";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useToast } from "@/hooks/use-toast";
import {
  buildPaymentObligationFields,
  buildRecurringCycle,
  DEFAULT_PAYMENT_CATEGORIES,
  matchApprovalRule,
  type ApprovalRule,
  type RecurringPaymentMaster,
  RP_COLLECTIONS,
} from "@/lib/recurring-payments";
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
  dueDay: 5,
  status: "Draft",
  autoGenerationEnabled: true,
  generateBeforeDueDays: 7,
  dueDateRule: "Fixed day of month",
  approvalConfiguration: "Default rule",
  highVarianceAdditionalApproval: true,
  notificationChannels: ["inApp", "email"],
  tdsApplicable: false,
  gstApplicable: false,
};

export default function RecurringMasterFormPage({
  masterId,
}: {
  masterId?: string;
}) {
  const router = useRouter();
  const { user, users } = useAuth();
  const { can } = useAuthorization();
  const { toast } = useToast();
  const organizationId = user?.organizationId || "default";
  const { projects, departments, activeProjects, activeDepartments } =
    useGlobalScopes();
  const [draft, setDraft] = useState<Partial<RecurringPaymentMaster>>(blank);
  const [vendors, setVendors] = useState<NamedRecord[]>([]);
  const [categories, setCategories] = useState<NamedRecord[]>([]);
  const [rules, setRules] = useState<ApprovalRule[]>([]);
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
            setDraft({
              ...blank,
              id: masterSnapshot.id,
              ...masterSnapshot.data(),
            } as RecurringPaymentMaster);
          setLoading(false);
        },
      )
      .catch(() => setLoading(false));
  }, [masterId, organizationId]);
  const netAmount = Number(draft.amount || 0) + Number(draft.taxAmount || 0);
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
    setSaving(true);
    try {
      const duplicates = await getDocs(
        query(
          collection(db, RP_COLLECTIONS.masters),
          where("organizationId", "==", organizationId),
        ),
      );
      const duplicate = duplicates.docs.find(
        (item) =>
          item.id !== masterId &&
          String(item.data().category) === draft.category &&
          String(item.data().accountNumber || "").trim() &&
          String(item.data().accountNumber).trim() ===
            String(draft.accountNumber || "").trim() &&
          !item.data().deleted,
      );
      if (duplicate)
        throw new Error(
          `A master with this category and account already exists (${duplicate.id}).`,
        );
      const masterRef = masterId
        ? doc(db, RP_COLLECTIONS.masters, masterId)
        : doc(collection(db, RP_COLLECTIONS.masters));
      const form = new FormData(event.currentTarget);
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
      const payload = {
        ...draft,
        id: undefined,
        organizationId,
        organizationName: user.organizationName || "",
        amount: Number(draft.amount || 0),
        maximumAmount: Number(draft.maximumAmount || 0),
        taxAmount: Number(draft.taxAmount || 0),
        securityDeposit: Number(draft.securityDeposit || 0),
        dueDay: Number(draft.dueDay || 1),
        gracePeriodDays: Number(draft.gracePeriodDays || 0),
        generateBeforeDueDays: Number(draft.generateBeforeDueDays || 7),
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
      if (intent === "generate") {
        const cycle = buildRecurringCycle(
          {
            frequency: draft.frequency!,
            startDate: draft.startDate,
            endDate: draft.endDate,
            dueDay: Number(draft.dueDay || 1),
            customIntervalDays:
              draft.frequency === "Custom"
                ? Number(draft.customIntervalDays || 30)
                : undefined,
          },
          new Date(),
        );
        if (cycle) {
          const cycleKey = `${organizationId}_${masterRef.id}_${cycle.key}`;
          const paymentRef = doc(
            db,
            RP_COLLECTIONS.payments,
            cycleKey.replace(/[^a-zA-Z0-9_-]/g, "_"),
          );
          batch.set(
            paymentRef,
            {
              ...buildPaymentObligationFields({
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
                verifierId: draft.verifierId,
                approverId: draft.approverId,
                accountsProcessorId: draft.accountsProcessorId,
                approvalRule,
              }),
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
          <h1 className="text-2xl font-bold">
            {masterId
              ? "Edit Recurring Master"
              : "Create Recurring Payment Master"}
          </h1>
          <p className="text-sm text-muted-foreground">
            Configuration, generation, approval, notification and ownership
            controls
          </p>
        </div>
      </div>
      <form onSubmit={save} className="space-y-5">
        <Section icon={Building2} title="Basic details">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Organization *">
              <Input
                value={user?.organizationName || organizationId}
                disabled
              />
            </Field>
            <Field label="Branch">
              <Input
                value={draft.branchName || ""}
                onChange={(event) => set("branchName", event.target.value)}
              />
            </Field>
            <Field label="Project">
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
            </Field>
            <Field label="Department">
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
            </Field>
            <Field label="Payment title *">
              <Input
                value={draft.title || ""}
                onChange={(event) => set("title", event.target.value)}
              />
            </Field>
            <Field label="Category *">
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
            </Field>
            <Field label="Vendor *">
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
            </Field>
            <Field label="Account / consumer number">
              <Input
                value={draft.accountNumber || ""}
                onChange={(event) => set("accountNumber", event.target.value)}
              />
            </Field>
            <Field label="Internal reference">
              <Input
                value={draft.internalReference || ""}
                onChange={(event) =>
                  set("internalReference", event.target.value)
                }
              />
            </Field>
            <div className="sm:col-span-2 lg:col-span-3">
              <Field label="Description">
                <Textarea
                  value={draft.description || ""}
                  onChange={(event) => set("description", event.target.value)}
                />
              </Field>
            </div>
          </div>
        </Section>
        <Section icon={Settings2} title="Recurrence settings">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Frequency">
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
            </Field>
            {draft.frequency === "Custom" && (
              <Field label="Custom interval days">
                <Input
                  type="number"
                  min="1"
                  value={draft.customIntervalDays || ""}
                  onChange={(event) =>
                    set("customIntervalDays", Number(event.target.value))
                  }
                />
              </Field>
            )}
            <Field label="Start date *">
              <Input
                type="date"
                value={draft.startDate || ""}
                onChange={(event) => set("startDate", event.target.value)}
              />
            </Field>
            <Field label="End date">
              <Input
                type="date"
                value={draft.endDate || ""}
                onChange={(event) => set("endDate", event.target.value)}
              />
            </Field>
            <Field label="Billing cycle">
              <Input
                value={draft.billingCycle || ""}
                onChange={(event) => set("billingCycle", event.target.value)}
              />
            </Field>
            <Field label="Generation rule">
              <Input
                value={draft.generationDateRule || ""}
                onChange={(event) =>
                  set("generationDateRule", event.target.value)
                }
              />
            </Field>
            <Field label="Due-date rule">
              <Select
                value={draft.dueDateRule}
                onValueChange={(value) =>
                  set(
                    "dueDateRule",
                    value as RecurringPaymentMaster["dueDateRule"],
                  )
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[
                    "Fixed day of month",
                    "Days after bill date",
                    "Days after generation date",
                    "Last working day",
                    "Custom date logic",
                  ].map((item) => (
                    <SelectItem value={item} key={item}>
                      {item}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Due day / offset">
              <Input
                type="number"
                min="1"
                max="28"
                value={draft.dueDay || 1}
                onChange={(event) => set("dueDay", Number(event.target.value))}
              />
            </Field>
            <Field label="Grace period days">
              <Input
                type="number"
                min="0"
                value={draft.gracePeriodDays || 0}
                onChange={(event) =>
                  set("gracePeriodDays", Number(event.target.value))
                }
              />
            </Field>
            <Field label="Generate before due (days)">
              <Input
                type="number"
                min="0"
                max="365"
                value={draft.generateBeforeDueDays || 7}
                onChange={(event) =>
                  set("generateBeforeDueDays", Number(event.target.value))
                }
              />
            </Field>
            <Toggle
              label="Enable auto-generation"
              checked={draft.autoGenerationEnabled !== false}
              onChange={(value) => set("autoGenerationEnabled", value)}
            />
          </div>
        </Section>
        <Section icon={FileText} title="Amount and accounting">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Amount type">
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
            </Field>
            <Field
              label={
                draft.amountType === "Fixed"
                  ? "Fixed amount *"
                  : "Estimated amount *"
              }
            >
              <Input
                type="number"
                min="0"
                value={draft.amount || ""}
                onChange={(event) => set("amount", Number(event.target.value))}
              />
            </Field>
            <Field label="Maximum permitted amount">
              <Input
                type="number"
                min="0"
                value={draft.maximumAmount || ""}
                onChange={(event) =>
                  set("maximumAmount", Number(event.target.value))
                }
              />
            </Field>
            <Field label="Tax amount">
              <Input
                type="number"
                min="0"
                value={draft.taxAmount || ""}
                onChange={(event) =>
                  set("taxAmount", Number(event.target.value))
                }
              />
            </Field>
            <Field label="Cost centre">
              <Input
                value={draft.costCentre || ""}
                onChange={(event) => set("costCentre", event.target.value)}
              />
            </Field>
            <Field label="General ledger code">
              <Input
                value={draft.ledger || ""}
                onChange={(event) => set("ledger", event.target.value)}
              />
            </Field>
            <Field label="Budget head">
              <Input
                value={draft.budgetHead || ""}
                onChange={(event) => set("budgetHead", event.target.value)}
              />
            </Field>
            <Field label="Variance tolerance %">
              <Input
                type="number"
                min="0"
                value={draft.varianceTolerancePercent || 20}
                onChange={(event) =>
                  set("varianceTolerancePercent", Number(event.target.value))
                }
              />
            </Field>
            <Toggle
              label="TDS applicable"
              checked={!!draft.tdsApplicable}
              onChange={(value) => set("tdsApplicable", value)}
            />
            <Toggle
              label="GST applicable"
              checked={!!draft.gstApplicable}
              onChange={(value) => set("gstApplicable", value)}
            />
          </div>
        </Section>
        <Section icon={Users} title="Assignment">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <UserField
              label="Payment owner *"
              value={draft.assignedTo}
              onChange={(value) => set("assignedTo", value)}
              users={users}
            />
            <UserField
              label="Backup owner"
              value={draft.backupAssignedTo}
              onChange={(value) => set("backupAssignedTo", value)}
              users={users}
            />
            <UserField
              label="Verifier"
              value={draft.verifierId}
              onChange={(value) => set("verifierId", value)}
              users={users}
            />
            <UserField
              label="Approver"
              value={draft.approverId}
              onChange={(value) => set("approverId", value)}
              users={users}
            />
            <UserField
              label="Accounts processor"
              value={draft.accountsProcessorId}
              onChange={(value) => set("accountsProcessorId", value)}
              users={users}
            />
            <UserField
              label="Escalation authority"
              value={draft.escalationAuthorityId}
              onChange={(value) => set("escalationAuthorityId", value)}
              users={users}
            />
          </div>
        </Section>
        <Section icon={ShieldCheck} title="Approval configuration">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Approval option">
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
            </Field>
            {draft.approvalConfiguration === "Custom rule" && (
              <Field label="Custom approval rule">
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
              </Field>
            )}
            <Toggle
              label="Additional approval on high variance"
              checked={!!draft.highVarianceAdditionalApproval}
              onChange={(value) => set("highVarianceAdditionalApproval", value)}
            />
          </div>
        </Section>
        <Section icon={BellRing} title="Notification and documents">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Reminder recipients">
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
            </Field>
            <Field label="Escalation recipients">
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
            </Field>
            <Field label="Master documents">
              <Input
                name="masterDocuments"
                type="file"
                multiple
                accept=".pdf,.jpg,.jpeg,.png,.xlsx,.docx"
              />
            </Field>
          </div>
        </Section>
        <div className="flex flex-wrap justify-end gap-2">
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
  children,
}: {
  icon: React.ElementType;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon className="h-5 w-5 text-indigo-600" />
          {title}
        </CardTitle>
        <CardDescription>
          Configure this section according to organization policy.
        </CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
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
  label: string;
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
  label,
  value,
  onChange,
  users,
}: {
  label: string;
  value?: string;
  onChange: (value: string) => void;
  users: Array<{ id: string; name: string; status: string }>;
}) {
  return (
    <Field label={label}>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue placeholder="Select user" />
        </SelectTrigger>
        <SelectContent>
          {users
            .filter((item) => item.status === "Active")
            .map((item) => (
              <SelectItem value={item.id} key={item.id}>
                {item.name}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
    </Field>
  );
}
