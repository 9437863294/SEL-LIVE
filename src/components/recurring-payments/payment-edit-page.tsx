"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  collection,
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";
import { Loader2, Save } from "lucide-react";
import { db } from "@/lib/firebase";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useToast } from "@/hooks/use-toast";
import {
  isObligationEditable,
  outstandingAmountOf,
  type PaymentObligation,
  recurringDateOnly,
  RP_COLLECTIONS,
} from "@/lib/recurring-payments";
import { ControlledField } from "./controlled-field";
import { useFieldControl, validateFieldControlRequirements } from "./use-field-control";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageHeader } from "@/components/shared/page-header";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useGlobalScopes } from "./use-global-scopes";

/** Whole days from one `YYYY-MM-DD` date to another, on local calendar dates. */
function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return Math.round(
    (new Date(ty, tm - 1, td).getTime() - new Date(fy, fm - 1, fd).getTime()) /
      86_400_000,
  );
}

/** A `YYYY-MM-DD` date moved by `days`, built from local date parts (never UTC parsing). */
function shiftDate(value: string, days: number): string {
  const [y, m, d] = value.split("-").map(Number);
  return recurringDateOnly(new Date(y, m - 1, d + days));
}

export default function PaymentEditPage({ paymentId }: { paymentId: string }) {
  const router = useRouter();
  const { user, users } = useAuth();
  const { can } = useAuthorization();
  const { toast } = useToast();
  const { field } = useFieldControl("paymentEdit");
  const {
    projects,
    departments,
    activeProjects,
    activeDepartments,
    loading: scopesLoading,
  } = useGlobalScopes();
  const [payment, setPayment] = useState<PaymentObligation | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const organizationId = user?.organizationId || "default";
  useEffect(() => {
    getDoc(doc(db, RP_COLLECTIONS.payments, paymentId))
      .then((snapshot) => {
        const data = snapshot.exists()
          ? ({ id: snapshot.id, ...snapshot.data() } as PaymentObligation)
          : null;
        // Another organization's obligation, or a soft-deleted one, is not found — the same
        // treatment the detail page gives it.
        setPayment(
          data?.organizationId === organizationId && data.deleted !== true
            ? data
            : null,
        );
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [paymentId, organizationId]);
  // The values each Select opens on. Saving one unchanged is skipped, so a value the option list
  // cannot express (a project name with no id) is never rewritten.
  const initialProjectId = payment
    ? payment.projectId ||
      projects.find((item) => item.projectName === payment.projectName)?.id ||
      "none"
    : "none";
  const initialDepartmentId = payment
    ? payment.departmentId ||
      departments.find((item) => item.name === payment.department)?.id ||
      "none"
    : "none";
  const initialAssignedTo = payment?.assignedTo || "none";
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!payment || !user || !can("Edit", "Recurring Payments.Payments"))
      return;
    const form = new FormData(event.currentTarget);
    const selectedProjectId = String(form.get("projectId") || "");
    const selectedDepartmentId = String(form.get("departmentId") || "");
    const projectId = selectedProjectId === "none" ? "" : selectedProjectId;
    const departmentId =
      selectedDepartmentId === "none" ? "" : selectedDepartmentId;
    const missingLabel = validateFieldControlRequirements(
      "paymentEdit",
      { ...Object.fromEntries(form.entries()), projectId, departmentId },
      field,
    );
    if (missingLabel)
      return toast({ title: `${missingLabel} is required`, variant: "destructive" });
    // Only fields Field Control actually rendered are written. A hidden field has no input, so
    // reading it would save '' or 0 over whatever the obligation already holds.
    const shown = (key: string) => field(key).visible;
    const text = (key: string) => String(form.get(key) || "");
    const edits: Record<string, unknown> = {};
    for (const key of ["title", "vendorName", "category", "branchName", "description"])
      if (shown(key)) edits[key] = text(key);
    if (shown("priority")) edits.priority = text("priority") || "Normal";
    if (shown("assignedTo") && text("assignedTo") !== initialAssignedTo)
      edits.assignedTo = text("assignedTo") === "none" ? "" : text("assignedTo");
    if (shown("projectId") && selectedProjectId !== initialProjectId) {
      edits.projectId = projectId;
      edits.projectName =
        projects.find((item) => item.id === projectId)?.projectName || "";
    }
    if (shown("departmentId") && selectedDepartmentId !== initialDepartmentId) {
      edits.departmentId = departmentId;
      edits.department =
        departments.find((item) => item.id === departmentId)?.name || "";
    }
    const dueDate = shown("dueDate") ? text("dueDate") : "";
    // A bill is only written when one was typed or changed — blank leaves the obligation without
    // one (never 0), and the field no longer pre-fills the estimate as if a bill had arrived.
    const billInput = shown("billAmount") ? text("billAmount").trim() : "";
    const billAmount =
      billInput !== "" && Number(billInput) !== Number(payment.billAmount ?? NaN)
        ? Number(billInput)
        : undefined;
    setSaving(true);
    try {
      const paymentRef = doc(db, RP_COLLECTIONS.payments, payment.id);
      await runTransaction(db, async (transaction) => {
        // Re-read, so a payment verified or approved since this form opened is refused rather than
        // edited on the strength of a stale lock check.
        const snapshot = await transaction.get(paymentRef);
        const current = snapshot.exists()
          ? ({ id: snapshot.id, ...snapshot.data() } as PaymentObligation)
          : null;
        if (!current || current.organizationId !== organizationId || !isObligationEditable(current))
          throw new Error(
            "This payment has moved past the editable stages and can no longer be changed here.",
          );
        const next: Record<string, unknown> = { ...edits, updatedAt: serverTimestamp() };
        if (dueDate && dueDate !== current.dueDate) {
          // The grace and bill-expected dates are offsets from the due date, so they move with it —
          // otherwise a postponed payment still falls Overdue on its old date.
          const delta = daysBetween(current.dueDate, dueDate);
          next.dueDate = dueDate;
          if (current.overdueDate) next.overdueDate = shiftDate(current.overdueDate, delta);
          if (current.expectedBillDate)
            next.expectedBillDate = shiftDate(current.expectedBillDate, delta);
        }
        if (billAmount !== undefined) {
          next.billAmount = billAmount;
          next.outstandingAmount = outstandingAmountOf({ ...current, billAmount });
        }
        transaction.update(paymentRef, next);
        transaction.set(
          doc(
            collection(
              db,
              RP_COLLECTIONS.payments,
              payment.id,
              RP_COLLECTIONS.auditLogs,
            ),
          ),
          {
            organizationId: current.organizationId,
            paymentId: payment.id,
            action: "Payment edited",
            summary: "Editable payment information updated",
            page: `/recurring-payments/payments/${payment.id}/edit`,
            recordId: payment.id,
            previousValue: {
              title: current.title,
              vendorName: current.vendorName,
              dueDate: current.dueDate,
              billAmount: current.billAmount ?? null,
            },
            newValue: next,
            userId: user.id,
            userName: user.name,
            createdAt: serverTimestamp(),
          },
        );
      });
      toast({ title: "Payment updated" });
      router.push(`/recurring-payments/payments/${payment.id}`);
    } catch (error) {
      toast({
        title: "Payment could not be updated",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }
  // Also waits for projects/departments: the Selects' defaultValue is fixed at mount, and a legacy
  // obligation matched only by name would otherwise mount as "none" and save '' over its scope.
  if (loading || scopesLoading)
    return (
      <div className="flex min-h-[45vh] items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin" />
      </div>
    );
  if (!payment)
    return (
      <Card>
        <CardContent className="py-16 text-center">
          Payment not found.
        </CardContent>
      </Card>
    );
  const locked = !isObligationEditable(payment);
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageHeader
        backHref={`/recurring-payments/payments/${payment.id}`}
        backLabel="Back to payment"
        title="Edit Payment"
        meta={[{ label: "Payment ID", value: payment.id }]}
      />
      <Card>
        <CardHeader>
          <CardTitle>Payment information</CardTitle>
          <CardDescription>
            {locked
              ? "This payment is locked because it has progressed beyond the editable stages."
              : "Changes are recorded in the audit trail."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={save} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <ControlledField setting={field("title")}>
              <Input
                disabled={locked}
                name="title"
                defaultValue={payment.title}
                required={field("title").required}
              />
            </ControlledField>
            <ControlledField setting={field("vendorName")}>
              <Input
                disabled={locked}
                name="vendorName"
                defaultValue={payment.vendorName}
                required={field("vendorName").required}
              />
            </ControlledField>
            <ControlledField setting={field("category")}>
              <Input
                disabled={locked}
                name="category"
                defaultValue={payment.category}
                required={field("category").required}
              />
            </ControlledField>
            <ControlledField setting={field("dueDate")}>
              <Input
                disabled={locked}
                name="dueDate"
                type="date"
                defaultValue={payment.dueDate}
                required={field("dueDate").required}
              />
            </ControlledField>
            <ControlledField setting={field("branchName")}>
              <Input
                disabled={locked}
                name="branchName"
                defaultValue={payment.branchName}
              />
            </ControlledField>
            <ControlledField setting={field("projectId")}>
              <Select
                disabled={locked}
                name="projectId"
                defaultValue={initialProjectId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select global project" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No project</SelectItem>
                  {/* An inactive project stays selectable as the current value; without an item
                      matching it the Select would submit its first option instead. */}
                  {initialProjectId !== "none" &&
                    !activeProjects.some((item) => item.id === initialProjectId) && (
                      <SelectItem value={initialProjectId}>
                        {projects.find((item) => item.id === initialProjectId)
                          ?.projectName ||
                          payment.projectName ||
                          initialProjectId}{" "}
                        (inactive)
                      </SelectItem>
                    )}
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
                disabled={locked}
                name="departmentId"
                defaultValue={initialDepartmentId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select global department" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No department</SelectItem>
                  {initialDepartmentId !== "none" &&
                    !activeDepartments.some((item) => item.id === initialDepartmentId) && (
                      <SelectItem value={initialDepartmentId}>
                        {departments.find((item) => item.id === initialDepartmentId)
                          ?.name ||
                          payment.department ||
                          initialDepartmentId}{" "}
                        (inactive)
                      </SelectItem>
                    )}
                  {activeDepartments.map((department) => (
                    <SelectItem value={department.id} key={department.id}>
                      {department.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </ControlledField>
            <ControlledField setting={field("billAmount")}>
              <Input
                disabled={locked}
                name="billAmount"
                type="number"
                min="0"
                defaultValue={payment.billAmount ?? ""}
                placeholder={`Expected ${payment.expectedAmount || 0}`}
              />
            </ControlledField>
            <ControlledField setting={field("priority")}>
              <Select
                disabled={locked}
                name="priority"
                defaultValue={payment.priority || "Normal"}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[
                    ...new Set([
                      "Low",
                      "Normal",
                      "High",
                      "Critical",
                      payment.priority || "Normal",
                    ]),
                  ].map((item) => (
                    <SelectItem value={item} key={item}>
                      {item}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </ControlledField>
            <ControlledField setting={field("assignedTo")}>
              <Select
                disabled={locked}
                name="assignedTo"
                defaultValue={initialAssignedTo}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {/* "Unassigned" and an inactive current owner are both listed, so an untouched
                      field round-trips instead of reassigning to the first active user. */}
                  <SelectItem value="none">Unassigned</SelectItem>
                  {initialAssignedTo !== "none" &&
                    !users.some(
                      (item) => item.id === initialAssignedTo && item.status === "Active",
                    ) && (
                      <SelectItem value={initialAssignedTo}>
                        {users.find((item) => item.id === initialAssignedTo)?.name ||
                          initialAssignedTo}{" "}
                        (inactive)
                      </SelectItem>
                    )}
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
            <div className="sm:col-span-2">
              <ControlledField setting={field("description")}>
                <Textarea
                  disabled={locked}
                  name="description"
                  defaultValue={payment.description}
                />
              </ControlledField>
            </div>
            <div className="sm:col-span-2 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => router.back()}
              >
                Cancel
              </Button>
              {!locked && (
                <Button disabled={saving}>
                  {saving ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="mr-2 h-4 w-4" />
                  )}
                  Save changes
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
