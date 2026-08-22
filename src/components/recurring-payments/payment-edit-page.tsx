"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  collection,
  doc,
  getDoc,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { ArrowLeft, Loader2, Save } from "lucide-react";
import { db } from "@/lib/firebase";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useToast } from "@/hooks/use-toast";
import {
  isObligationEditable,
  type PaymentObligation,
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

export default function PaymentEditPage({ paymentId }: { paymentId: string }) {
  const router = useRouter();
  const { user, users } = useAuth();
  const { can } = useAuthorization();
  const { toast } = useToast();
  const { field } = useFieldControl("paymentEdit");
  const { projects, departments, activeProjects, activeDepartments } =
    useGlobalScopes();
  const [payment, setPayment] = useState<PaymentObligation | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    getDoc(doc(db, RP_COLLECTIONS.payments, paymentId))
      .then((snapshot) => {
        setPayment(
          snapshot.exists()
            ? ({ id: snapshot.id, ...snapshot.data() } as PaymentObligation)
            : null,
        );
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [paymentId]);
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
    const next = {
      title: String(form.get("title") || ""),
      vendorName: String(form.get("vendorName") || ""),
      category: String(form.get("category") || ""),
      branchName: String(form.get("branchName") || ""),
      projectId,
      projectName:
        projects.find((item) => item.id === projectId)?.projectName || "",
      departmentId,
      department:
        departments.find((item) => item.id === departmentId)?.name || "",
      dueDate: String(form.get("dueDate") || ""),
      billAmount: Number(form.get("billAmount") || 0),
      priority: String(form.get("priority") || "Normal"),
      assignedTo: String(form.get("assignedTo") || ""),
      description: String(form.get("description") || ""),
      updatedAt: serverTimestamp(),
    };
    setSaving(true);
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, RP_COLLECTIONS.payments, payment.id), next);
      batch.set(
        doc(
          collection(
            db,
            RP_COLLECTIONS.payments,
            payment.id,
            RP_COLLECTIONS.auditLogs,
          ),
        ),
        {
          organizationId: payment.organizationId,
          paymentId: payment.id,
          action: "Payment edited",
          summary: "Editable payment information updated",
          page: `/recurring-payments/payments/${payment.id}/edit`,
          recordId: payment.id,
          previousValue: {
            title: payment.title,
            vendorName: payment.vendorName,
            dueDate: payment.dueDate,
            billAmount: payment.billAmount,
          },
          newValue: next,
          userId: user.id,
          userName: user.name,
          createdAt: serverTimestamp(),
        },
      );
      await batch.commit();
      toast({ title: "Payment updated" });
      router.push(`/recurring-payments/payments/${payment.id}`);
    } catch {
      toast({ title: "Payment could not be updated", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }
  if (loading)
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
      <div className="flex items-center gap-3">
        <Button variant="outline" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Edit Payment</h1>
          <p className="text-sm text-muted-foreground">{payment.id}</p>
        </div>
      </div>
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
          <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
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
                defaultValue={
                  payment.projectId ||
                  projects.find(
                    (item) => item.projectName === payment.projectName,
                  )?.id ||
                  "none"
                }
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
                disabled={locked}
                name="departmentId"
                defaultValue={
                  payment.departmentId ||
                  departments.find((item) => item.name === payment.department)
                    ?.id ||
                  "none"
                }
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
            <ControlledField setting={field("billAmount")}>
              <Input
                disabled={locked}
                name="billAmount"
                type="number"
                min="0"
                defaultValue={payment.billAmount || payment.expectedAmount}
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
                  {["Low", "Normal", "High", "Critical"].map((item) => (
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
                defaultValue={payment.assignedTo}
              >
                <SelectTrigger>
                  <SelectValue />
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
