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
import { ArrowLeft, FilePlus2, Loader2, Save, Send } from "lucide-react";
import { db } from "@/lib/firebase";
import { storage } from "@/lib/firebase-storage";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useToast } from "@/hooks/use-toast";
import {
  DEFAULT_PAYMENT_CATEGORIES,
  DEFAULT_RECURRING_PAYMENT_SETTINGS,
  DEFAULT_RECURRING_WORKFLOW,
  loadWorkingCalendar,
  type ApprovalRule,
  type RecurringPaymentSettings,
  type RecurringWorkflowStep,
  RP_COLLECTIONS,
  currency,
} from "@/lib/recurring-payments";
import { addBusinessHours } from "@/lib/working-hours";
import { ControlledField } from "./controlled-field";
import {
  useFieldControl,
  validateFieldControlRequirements,
  type RPFieldSetting,
} from "./use-field-control";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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

export default function ManualPaymentForm() {
  const router = useRouter();
  const { user, users } = useAuth();
  const { can } = useAuthorization();
  const { toast } = useToast();
  const { field } = useFieldControl("manualPayment");
  const organizationId = user?.organizationId || "default";
  const { projects, departments, activeProjects, activeDepartments } =
    useGlobalScopes();
  const [vendors, setVendors] = useState<NamedRecord[]>([]);
  const [categories, setCategories] = useState<NamedRecord[]>([]);
  const [saving, setSaving] = useState(false);
  const [amounts, setAmounts] = useState({
    bill: 0,
    tax: 0,
    tds: 0,
    deduction: 0,
    adjustment: 0,
  });
  const netPayable = useMemo(
    () =>
      Math.max(
        0,
        amounts.bill +
          amounts.tax -
          amounts.tds -
          amounts.deduction +
          amounts.adjustment,
      ),
    [amounts],
  );

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
    ]).then(([vendorSnapshot, categorySnapshot]) => {
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
    });
  }, [organizationId]);

  async function upload(
    file: FormDataEntryValue | null,
    paymentId: string,
    type: string,
  ) {
    if (!(file instanceof File) || !file.size) return null;
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const reference = storageRef(
      storage,
      `recurring-payments/${organizationId}/${paymentId}/documents/${Date.now()}-${safeName}`,
    );
    await uploadBytes(reference, file);
    return {
      reference: await getDownloadURL(reference),
      fileName: file.name,
      fileType: file.type || file.name.split(".").pop() || "file",
      fileSize: file.size,
      type,
    };
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || !can("Add", "Recurring Payments.Payments"))
      return toast({
        title: "You do not have permission to create payments",
        variant: "destructive",
      });
    const submitter = event.nativeEvent as SubmitEvent;
    const intent =
      (submitter.submitter as HTMLButtonElement | null)?.value || "draft";
    const form = new FormData(event.currentTarget);
    const billingStart = String(form.get("billingPeriodStart") || "");
    const billingEnd = String(form.get("billingPeriodEnd") || "");
    const dueDate = String(form.get("dueDate") || "");
    const billDate = String(form.get("billDate") || "");
    const vendorName = String(form.get("vendorName") || "").trim();
    const billNumber = String(form.get("billNumber") || "").trim();
    if (billingStart && billingEnd && billingEnd < billingStart)
      return toast({
        title: "Billing period end cannot be before the start date",
        variant: "destructive",
      });
    if (
      billDate &&
      dueDate &&
      dueDate < billDate &&
      !String(form.get("exceptionReason") || "").trim()
    )
      return toast({
        title:
          "Enter an exception reason when the due date is before the bill date",
        variant: "destructive",
      });
    const fieldValues = {
      ...Object.fromEntries(form.entries()),
      projectId: String(form.get("projectId") || "") === "none" ? "" : form.get("projectId"),
      departmentId: String(form.get("departmentId") || "") === "none" ? "" : form.get("departmentId"),
      billAmount: amounts.bill,
      taxAmount: amounts.tax,
      tdsAmount: amounts.tds,
      deductionAmount: amounts.deduction,
      adjustmentAmount: amounts.adjustment,
    };
    const missingLabel = validateFieldControlRequirements("manualPayment", fieldValues, field);
    if (missingLabel)
      return toast({ title: `${missingLabel} is required`, variant: "destructive" });

    setSaving(true);
    try {
      const duplicates = await getDocs(
        query(
          collection(db, RP_COLLECTIONS.payments),
          where("organizationId", "==", organizationId),
        ),
      );
      const duplicate = duplicates.docs.find((item) => {
        const payment = item.data();
        return (
          String(payment.vendorName || "").toLowerCase() ===
            vendorName.toLowerCase() &&
          String(payment.billNumber || "").toLowerCase() ===
            billNumber.toLowerCase() &&
          String(payment.billDate || "") === billDate &&
          Number(payment.billAmount || 0) === amounts.bill
        );
      });
      if (duplicate)
        throw new Error(
          `Possible duplicate bill found in payment ${duplicate.id}.`,
        );

      const settingsSnapshot = await getDoc(
        doc(
          db,
          RP_COLLECTIONS.settings,
          organizationId.replace(/[^a-zA-Z0-9_-]/g, "_"),
        ),
      );
      const settingsData = settingsSnapshot.data() as
        Partial<RecurringPaymentSettings> | undefined;
      const settings = {
        ...DEFAULT_RECURRING_PAYMENT_SETTINGS,
        ...settingsData,
        controls: {
          ...DEFAULT_RECURRING_PAYMENT_SETTINGS.controls,
          ...settingsData?.controls,
        },
      };
      const billFile = form.get("billFile");
      if (
        intent === "submit" &&
        settings.controls.requireBillBeforeApproval &&
        (!(billFile instanceof File) || !billFile.size)
      )
        throw new Error("A bill attachment is required before submission.");

      const paymentRef = doc(collection(db, RP_COLLECTIONS.payments));
      const uploadedBill = await upload(billFile, paymentRef.id, "Bill");
      const supporting = await upload(
        form.get("supportingFile"),
        paymentRef.id,
        "Supporting document",
      );
      const workflowSnapshot = await getDoc(
        doc(db, "workflows", "recurring-payments-workflow"),
      );
      const workflow = (workflowSnapshot.data()?.steps?.length
        ? workflowSnapshot.data()?.steps
        : DEFAULT_RECURRING_WORKFLOW) as RecurringWorkflowStep[];
      const verificationStep =
        workflow.find((step) =>
          step.name.toLowerCase().includes("verification"),
        ) || workflow[0];
      const verifierId = String(form.get("verifierId") || "");
      if (intent === "submit" && !verifierId)
        throw new Error("Select a verifier before submitting.");
      const category = String(form.get("category") || "");
      const selectedProjectId = String(form.get("projectId") || "");
      const selectedDepartmentId = String(form.get("departmentId") || "");
      const projectId = selectedProjectId === "none" ? "" : selectedProjectId;
      const departmentId =
        selectedDepartmentId === "none" ? "" : selectedDepartmentId;
      const projectName =
        projects.find((item) => item.id === projectId)?.projectName || "";
      const department =
        departments.find((item) => item.id === departmentId)?.name || "";
      const [ruleSnapshot, calendar] = await Promise.all([
        getDocs(
          query(
            collection(db, RP_COLLECTIONS.approvalRules),
            where("organizationId", "==", organizationId),
          ),
        ),
        loadWorkingCalendar(),
      ]);
      const approvalRule = ruleSnapshot.docs
        .map((item) => ({ id: item.id, ...item.data() }) as ApprovalRule)
        .find(
          (rule) =>
            rule.active &&
            netPayable >= Number(rule.minAmount || 0) &&
            netPayable <=
              (rule.maxAmount == null
                ? Number.POSITIVE_INFINITY
                : Number(rule.maxAmount)) &&
            (!rule.category || rule.category === category) &&
            (!rule.project ||
              rule.project === projectId ||
              rule.project === projectName),
        );
      const timestamp = Timestamp.now();
      const documents = [uploadedBill, supporting]
        .filter(Boolean)
        .map((document, index) => ({
          stepId: verificationStep?.id || "manual",
          action: "Manual Payment Created",
          reference: document!.reference,
          addedBy: user.id,
          addedAt: timestamp,
          category: document!.type,
          fileType: document!.fileType,
          fileName: document!.fileName,
          fileSize: document!.fileSize,
          version: index + 1,
        }));
      const status = intent === "submit" ? "Under Verification" : "Draft";
      const batch = writeBatch(db);
      batch.set(paymentRef, {
        organizationId,
        cycleKey: `${organizationId}_manual_${paymentRef.id}`,
        sourceType: "Manual",
        masterId: "",
        title: String(form.get("title") || "").trim(),
        category,
        vendorName,
        description: String(form.get("description") || ""),
        branchName: String(form.get("branchName") || ""),
        projectId,
        projectName,
        departmentId,
        department,
        priority: String(form.get("priority") || "Normal"),
        billNumber,
        billDate,
        billReceivedDate: dateOnly(new Date()),
        billingPeriodStart: billingStart || billDate || dueDate,
        billingPeriodEnd: billingEnd || billDate || dueDate,
        dueDate,
        expectedAmount: amounts.bill,
        billAmount: amounts.bill,
        taxAmount: amounts.tax,
        tdsAmount: amounts.tds,
        deductionAmount: amounts.deduction,
        adjustmentAmount: amounts.adjustment,
        netPayableAmount: netPayable,
        paidAmount: 0,
        settledAmount: 0,
        outstandingAmount: netPayable,
        assignedTo: String(form.get("ownerId") || ""),
        verifierId,
        approverId: String(form.get("approverId") || ""),
        accountsProcessorId: String(form.get("accountsProcessorId") || ""),
        approvalRuleId: approvalRule?.id || null,
        approvalMode: approvalRule?.mode || null,
        approvalLevels: approvalRule?.approvers || [],
        currentApprovalLevel: approvalRule ? 1 : 0,
        approvalCompletedBy: [],
        finalAccountsVerification:
          approvalRule?.finalAccountsVerification !== false,
        generatedAutomatically: false,
        status,
        workflowStatus: intent === "submit" ? "In Progress" : "Scheduled",
        stage: intent === "submit" ? verificationStep.name : "Draft",
        currentStepId: intent === "submit" ? verificationStep.id : null,
        assignees: intent === "submit" ? [verifierId] : [],
        workflowStartedAt: intent === "submit" ? timestamp : null,
        stepEnteredAt: intent === "submit" ? timestamp : null,
        workflowDeadline:
          intent === "submit"
            ? Timestamp.fromMillis(
                addBusinessHours(new Date(), Math.max(1, verificationStep.tat), calendar.workingHours, calendar.holidays).getTime(),
              )
            : null,
        documentReferences: documents,
        workflowHistory: [
          {
            action:
              intent === "submit" ? "Created and submitted" : "Saved as draft",
            comment: String(form.get("notes") || ""),
            userId: user.id,
            userName: user.name,
            stepId: verificationStep?.id || "manual",
            stepName: intent === "submit" ? verificationStep.name : "Draft",
            timestamp,
          },
        ],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batch.set(doc(collection(paymentRef, RP_COLLECTIONS.auditLogs)), {
        organizationId,
        paymentId: paymentRef.id,
        action:
          intent === "submit"
            ? "Manual payment submitted"
            : "Manual payment draft created",
        summary: `${String(form.get("title") || "")} for ${currency(netPayable)}`,
        page: "/recurring-payments/payments/new",
        recordId: paymentRef.id,
        previousValue: null,
        newValue: { status, netPayable },
        userId: user.id,
        userName: user.name,
        reason: String(form.get("notes") || ""),
        createdAt: timestamp,
      });
      await batch.commit();
      toast({
        title:
          intent === "submit"
            ? "Payment submitted for verification"
            : "Manual payment draft saved",
      });
      router.push(`/recurring-payments/payments/${paymentRef.id}`);
    } catch (error) {
      toast({
        title: "Payment could not be saved",
        description:
          error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Create Manual Payment</h1>
          <p className="text-sm text-muted-foreground">
            Create a one-time financial obligation outside recurring generation.
          </p>
        </div>
      </div>
      <form onSubmit={submit} className="space-y-5">
        <Section
          title="Basic information"
          description="Organization scope, ownership and priority"
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Organization *">
              <Input
                value={user?.organizationName || organizationId}
                disabled
              />
            </Field>
            <ControlledField setting={field("branchName")}>
              <Input name="branchName" />
            </ControlledField>
            <ControlledField setting={field("projectId")}>
              <Select name="projectId" defaultValue="none">
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
              <Select name="departmentId" defaultValue="none">
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
              <Input name="title" required={field("title").required} />
            </ControlledField>
            <ControlledField setting={field("category")}>
              <Select name="category" required={field("category").required}>
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
              <Input name="vendorName" required={field("vendorName").required} list="manual-payment-vendors" />
              <datalist id="manual-payment-vendors">
                {vendors.map((item) => (
                  <option key={item.id}>{item.name}</option>
                ))}
              </datalist>
            </ControlledField>
            <ControlledField setting={field("priority")}>
              <Select name="priority" defaultValue="Normal">
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["Low", "Normal", "High", "Critical"].map((item) => (
                    <SelectItem value={item} key={item}>
                      {item}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </ControlledField>
            <div className="sm:col-span-2 lg:col-span-4">
              <ControlledField setting={field("description")}>
                <Textarea name="description" />
              </ControlledField>
            </div>
          </div>
        </Section>
        <Section
          title="Billing information"
          description="Bill, period, due date and payable calculation"
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <ControlledField setting={field("billNumber")}>
              <Input name="billNumber" required={field("billNumber").required} />
            </ControlledField>
            <ControlledField setting={field("billDate")}>
              <Input name="billDate" type="date" />
            </ControlledField>
            <ControlledField setting={field("billingPeriodStart")}>
              <Input name="billingPeriodStart" type="date" />
            </ControlledField>
            <ControlledField setting={field("billingPeriodEnd")}>
              <Input name="billingPeriodEnd" type="date" />
            </ControlledField>
            <ControlledField setting={field("dueDate")}>
              <Input name="dueDate" type="date" required={field("dueDate").required} />
            </ControlledField>
            <AmountField
              setting={field("billAmount")}
              allowNegative={false}
              value={amounts.bill}
              onChange={(bill) =>
                setAmounts((current) => ({ ...current, bill }))
              }
            />
            <AmountField
              setting={field("taxAmount")}
              allowNegative={false}
              value={amounts.tax}
              onChange={(tax) => setAmounts((current) => ({ ...current, tax }))}
            />
            <AmountField
              setting={field("tdsAmount")}
              allowNegative={false}
              value={amounts.tds}
              onChange={(tds) => setAmounts((current) => ({ ...current, tds }))}
            />
            <AmountField
              setting={field("deductionAmount")}
              allowNegative={false}
              value={amounts.deduction}
              onChange={(deduction) =>
                setAmounts((current) => ({ ...current, deduction }))
              }
            />
            <AmountField
              setting={field("adjustmentAmount")}
              allowNegative
              value={amounts.adjustment}
              onChange={(adjustment) =>
                setAmounts((current) => ({ ...current, adjustment }))
              }
            />
            <Field label="Net payable">
              <Input
                value={currency(netPayable)}
                disabled
                className="font-bold"
              />
            </Field>
            <ControlledField setting={field("exceptionReason")}>
              <Input
                name="exceptionReason"
                placeholder="Required for unusual due date"
              />
            </ControlledField>
          </div>
        </Section>
        <Section
          title="Assignment"
          description="People responsible for verification, approval and processing"
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <UserSelect
              name="ownerId"
              setting={field("ownerId")}
              users={users}
            />
            <UserSelect name="verifierId" setting={field("verifierId")} users={users} />
            <UserSelect name="approverId" setting={field("approverId")} users={users} />
            <UserSelect
              name="accountsProcessorId"
              setting={field("accountsProcessorId")}
              users={users}
            />
          </div>
        </Section>
        <Section
          title="Documents and notes"
          description="Bill and supporting evidence"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <ControlledField setting={field("billFile")}>
              <Input
                name="billFile"
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.xlsx,.docx"
              />
            </ControlledField>
            <ControlledField setting={field("supportingFile")}>
              <Input
                name="supportingFile"
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.xlsx,.docx"
              />
            </ControlledField>
            <div className="sm:col-span-2">
              <ControlledField setting={field("notes")}>
                <Textarea name="notes" />
              </ControlledField>
            </div>
          </div>
        </Section>
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => router.back()}>
            Cancel
          </Button>
          <Button
            type="submit"
            name="intent"
            value="draft"
            variant="secondary"
            disabled={saving}
          >
            <Save className="mr-2 h-4 w-4" />
            Save as draft
          </Button>
          <Button type="submit" name="intent" value="submit" disabled={saving}>
            {saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Send className="mr-2 h-4 w-4" />
            )}
            Save and submit for verification
          </Button>
        </div>
      </form>
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FilePlus2 className="h-5 w-5 text-indigo-600" />
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
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
function AmountField({
  setting,
  allowNegative = false,
  value,
  onChange,
}: {
  setting: RPFieldSetting;
  allowNegative?: boolean;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <ControlledField setting={setting}>
      <Input
        type="number"
        min={allowNegative ? undefined : 0}
        step="0.01"
        value={value || ""}
        onChange={(event) => onChange(Number(event.target.value || 0))}
        required={setting.required}
      />
    </ControlledField>
  );
}
function UserSelect({
  name,
  setting,
  users,
}: {
  name: string;
  setting: RPFieldSetting;
  users: Array<{ id: string; name: string; status: string }>;
}) {
  return (
    <ControlledField setting={setting}>
      <Select name={name} required={setting.required}>
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
    </ControlledField>
  );
}
function dateOnly(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
