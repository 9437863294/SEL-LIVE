"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { collection, getDocs } from "firebase/firestore";
import {
  ArrowLeft,
  Calculator,
  Loader2,
  Save,
  Send,
  ShieldAlert,
} from "lucide-react";
import { db } from "@/lib/firebase";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useToast } from "@/hooks/use-toast";
import {
  createBGRequest,
  submitBGRequest,
  type BGActor,
  type BGRequestInput,
} from "@/lib/bank-guarantee-service";
import {
  BG_COLLECTIONS,
  BG_MARGIN_TYPES,
  BG_PERMISSION_MODULE,
  BG_PURPOSES,
  addBgDays,
  bgLabel,
  calculateBgMargin,
  calculateRequiredBgAmount,
  formatBgCurrency,
} from "@/lib/bank-guarantee";
import type { BankAccount, Department, Project } from "@/lib/types";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

type Master = Record<string, any> & { id: string };
type Draft = BGRequestInput;
const today = () => new Date().toISOString().slice(0, 10);
const initial = (): Draft => ({
  departmentId: "",
  departmentName: "",
  projectId: "",
  projectName: "",
  beneficiaryId: "",
  beneficiaryName: "",
  beneficiaryAddress: "",
  beneficiaryEmail: "",
  contractId: "",
  contractReference: "",
  tenderNumber: "",
  contractNumber: "",
  workOrderNumber: "",
  contractDate: "",
  contractValue: 0,
  bgPercentage: 10,
  existingBgAmount: 0,
  purpose: "PERFORMANCE_BANK_GUARANTEE",
  description: "",
  currency: "INR",
  exchangeRate: 1,
  requestedAmount: 0,
  requiredIssueDate: today(),
  proposedStartDate: today(),
  proposedExpiryDate: addBgDays(today(), 365),
  proposedClaimExpiryDate: addBgDays(today(), 455),
  claimPeriodDays: 90,
  autoExtensionClause: false,
  preferredBankId: "",
  preferredBankName: "",
  bankLimitId: "",
  marginType: "FD",
  marginPercentage: 10,
  fdMarginAmount: 0,
  cashMarginAmount: 0,
  otherCollateralAmount: 0,
  estimatedCommission: 0,
  estimatedGst: 0,
  estimatedOtherCharges: 0,
  remarks: "",
});

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Card className="border-white/80 bg-white/90 shadow-sm">
      <CardHeader className="pb-4">
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {children}
      </CardContent>
    </Card>
  );
}
function Field({
  label,
  required,
  helper,
  wide,
  children,
}: {
  label: string;
  required?: boolean;
  helper?: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`space-y-1.5 ${wide ? "sm:col-span-2 xl:col-span-3" : ""}`}>
      <Label className="text-xs font-medium text-slate-700">
        {label}
        {required && <span className="ml-0.5 text-rose-500">*</span>}
      </Label>
      {children}
      {helper && <p className="text-[11px] text-muted-foreground">{helper}</p>}
    </div>
  );
}

export default function NewBGRequestForm() {
  const router = useRouter();
  const { user } = useAuth();
  const { can, isLoading: authLoading } = useAuthorization();
  const { toast } = useToast();
  const [draft, setDraft] = useState<Draft>(initial);
  const [projects, setProjects] = useState<Project[]>([]);
  const [banks, setBanks] = useState<BankAccount[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [beneficiaries, setBeneficiaries] = useState<Master[]>([]);
  const [contracts, setContracts] = useState<Master[]>([]);
  const [limits, setLimits] = useState<Master[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<"draft" | "submit" | null>(null);
  const canAdd = can("Add", `${BG_PERMISSION_MODULE}.BG Requests`);
  const organizationId = user?.organizationId || "default";
  useEffect(() => {
    let active = true;
    void Promise.all([
      getDocs(collection(db, "projects")),
      getDocs(collection(db, "bankAccounts")),
      getDocs(collection(db, "departments")),
      getDocs(collection(db, BG_COLLECTIONS.beneficiaries)),
      getDocs(collection(db, BG_COLLECTIONS.contracts)),
      getDocs(collection(db, BG_COLLECTIONS.bankLimits)),
    ])
      .then(
        ([
          projectSnap,
          bankSnap,
          departmentSnap,
          beneficiarySnap,
          contractSnap,
          limitSnap,
        ]) => {
          if (!active) return;
          setProjects(
            projectSnap.docs
              .map((item) => ({ id: item.id, ...item.data() }) as Project)
              .filter((item) => item.status === "Active"),
          );
          setBanks(
            bankSnap.docs
              .map((item) => ({ id: item.id, ...item.data() }) as BankAccount)
              .filter((item) => item.status === "Active"),
          );
          setDepartments(
            departmentSnap.docs
              .map((item) => ({ id: item.id, ...item.data() }) as Department)
              .filter((item) => item.status === "Active"),
          );
          setBeneficiaries(
            beneficiarySnap.docs
              .map((item) => ({ id: item.id, ...item.data() }) as Master)
              .filter(
                (item) =>
                  (!item.organizationId ||
                    item.organizationId === organizationId) &&
                  (!item.status || item.status === "ACTIVE"),
              ),
          );
          setContracts(
            contractSnap.docs
              .map((item) => ({ id: item.id, ...item.data() }) as Master)
              .filter(
                (item) =>
                  (!item.organizationId ||
                    item.organizationId === organizationId) &&
                  (!item.status || item.status === "ACTIVE"),
              ),
          );
          setLimits(
            limitSnap.docs
              .map((item) => ({ id: item.id, ...item.data() }) as Master)
              .filter(
                (item) =>
                  item.organizationId === organizationId &&
                  ["BG", "COMBINED_BG_LC"].includes(String(item.limitType)) &&
                  item.status === "ACTIVE",
              ),
          );
        },
      )
      .catch((error) => {
        console.error(error);
        toast({
          title: "Some global masters could not be loaded",
          description:
            "Configure Beneficiaries, Contracts, Banks, and Limits in BG Settings.",
          variant: "destructive",
        });
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [organizationId, toast]);
  const update = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const requirement = calculateRequiredBgAmount(
    draft.contractValue,
    draft.bgPercentage,
  );
  const balanceRequirement = Math.max(
    0,
    requirement - Number(draft.existingBgAmount || 0),
  );
  const margin = calculateBgMargin(
    draft.requestedAmount,
    draft.marginPercentage,
  );
  const baseExposure = draft.requestedAmount * Number(draft.exchangeRate || 1);
  const selectedLimit = useMemo(
    () => limits.find((item) => item.id === draft.bankLimitId),
    [draft.bankLimitId, limits],
  );
  const selectBeneficiary = (id: string) => {
    const item = beneficiaries.find((row) => row.id === id);
    if (!item) return;
    setDraft((current) => ({
      ...current,
      beneficiaryId: id,
      beneficiaryName: String(item.legalName || item.name || ""),
      beneficiaryAddress: String(item.address || ""),
      beneficiaryEmail: String(item.email || ""),
    }));
  };
  const selectContract = (id: string) => {
    const item = contracts.find((row) => row.id === id);
    if (!item) return;
    const contractValue = Number(item.contractValue || item.tenderValue || 0),
      percentage = Number(item.requiredBgPercentage || item.bgPercentage || 0);
    setDraft((current) => ({
      ...current,
      contractId: id,
      contractReference: String(item.contractNumber || item.tenderNumber || id),
      tenderNumber: String(item.tenderNumber || ""),
      contractNumber: String(item.contractNumber || ""),
      workOrderNumber: String(item.workOrderNumber || item.workOrder || ""),
      contractDate: String(item.contractDate || ""),
      contractValue,
      bgPercentage: percentage,
      requestedAmount: calculateRequiredBgAmount(contractValue, percentage),
      projectId: String(item.projectId || current.projectId),
      beneficiaryId: String(item.beneficiaryId || current.beneficiaryId),
    }));
  };
  const changeExpiry = (expiry: string) =>
    setDraft((current) => ({
      ...current,
      proposedExpiryDate: expiry,
      proposedClaimExpiryDate: addBgDays(expiry, current.claimPeriodDays),
    }));
  const save = async (mode: "draft" | "submit") => {
    if (!user || !canAdd || saving) return;
    setSaving(mode);
    try {
      const project = projects.find((item) => item.id === draft.projectId),
        bank = banks.find((item) => item.id === draft.preferredBankId),
        beneficiary = beneficiaries.find(
          (item) => item.id === draft.beneficiaryId,
        );
      const actor: BGActor = {
        userId: user.id,
        userName: user.name,
        role: user.role,
        organizationId,
        organizationName: user.organizationName,
      };
      const result = await createBGRequest(
        {
          ...draft,
          projectName: project?.projectName || draft.projectName,
          preferredBankName: bank?.bankName || draft.preferredBankName,
          beneficiaryName: String(
            beneficiary?.legalName ||
              beneficiary?.name ||
              draft.beneficiaryName,
          ),
          beneficiaryAddress: String(
            beneficiary?.address || draft.beneficiaryAddress || "",
          ),
          beneficiaryEmail: String(
            beneficiary?.email || draft.beneficiaryEmail || "",
          ),
        },
        actor,
      );
      if (mode === "submit") await submitBGRequest(result.id, actor);
      toast({
        title: mode === "submit" ? "BG request submitted" : "BG request saved",
        description: result.referenceNumber,
      });
      router.push(
        mode === "submit"
          ? "/bank-guarantee/approvals"
          : `/bank-guarantee/${result.id}`,
      );
    } catch (error) {
      toast({
        title: "Unable to save BG request",
        description:
          error instanceof Error ? error.message : "Review the request.",
        variant: "destructive",
      });
    } finally {
      setSaving(null);
    }
  };
  if (authLoading || loading)
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-indigo-600" />
      </div>
    );
  if (!canAdd)
    return (
      <Card>
        <CardHeader>
          <CardTitle>Access Denied</CardTitle>
          <CardDescription>You cannot create BG requests.</CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center py-8">
          <ShieldAlert className="h-14 w-14 text-destructive" />
        </CardContent>
      </Card>
    );
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button asChild variant="outline" size="icon">
            <Link href="/bank-guarantee">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold">New BG Request</h1>
            <p className="text-sm text-muted-foreground">
              Contract requirement, beneficiary, validity, limit, and
              collateral.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={Boolean(saving)}
            onClick={() => void save("draft")}
          >
            {saving === "draft" ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Save Draft
          </Button>
          <Button
            disabled={Boolean(saving)}
            onClick={() => void save("submit")}
          >
            {saving === "submit" ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Send className="mr-2 h-4 w-4" />
            )}
            Submit
          </Button>
        </div>
      </div>
      <Section
        title="Request and global ownership"
        description="Organization and requester come from the signed-in user. Projects and departments use global setup."
      >
        <Field label="Organization">
          <Input disabled value={user?.organizationName || organizationId} />
        </Field>
        <Field label="Requested by">
          <Input disabled value={user?.name || ""} />
        </Field>
        <Field label="Department">
          <Select
            value={draft.departmentId || "none"}
            onValueChange={(id) => {
              const item = departments.find((row) => row.id === id);
              update("departmentId", id === "none" ? "" : id);
              update("departmentName", item?.name || "");
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Not specified</SelectItem>
              {departments.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Project" required>
          <Select
            value={draft.projectId}
            onValueChange={(id) => update("projectId", id)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select project" />
            </SelectTrigger>
            <SelectContent>
              {projects.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.projectName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Beneficiary" required>
          <Select value={draft.beneficiaryId} onValueChange={selectBeneficiary}>
            <SelectTrigger>
              <SelectValue placeholder="Select beneficiary" />
            </SelectTrigger>
            <SelectContent>
              {beneficiaries.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.legalName || item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Purpose" required>
          <Select
            value={draft.purpose}
            onValueChange={(value) => update("purpose", value)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BG_PURPOSES.map((value) => (
                <SelectItem key={value} value={value}>
                  {bgLabel(value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Description" wide>
          <Textarea
            value={draft.description || ""}
            onChange={(event) => update("description", event.target.value)}
          />
        </Field>
      </Section>
      <Section
        title="Tender and contract requirement"
        description="Select the global contract master or enter controlled references."
      >
        <Field label="Contract master">
          <Select
            value={draft.contractId || "manual"}
            onValueChange={(value) =>
              value === "manual"
                ? update("contractId", "")
                : selectContract(value)
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="manual">Manual references</SelectItem>
              {contracts.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.contractNumber || item.tenderNumber || item.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Tender number">
          <Input
            value={draft.tenderNumber || ""}
            onChange={(event) => update("tenderNumber", event.target.value)}
          />
        </Field>
        <Field label="Contract number">
          <Input
            value={draft.contractNumber || ""}
            onChange={(event) => update("contractNumber", event.target.value)}
          />
        </Field>
        <Field label="Work order number">
          <Input
            value={draft.workOrderNumber || ""}
            onChange={(event) => update("workOrderNumber", event.target.value)}
          />
        </Field>
        <Field label="Contract value">
          <Input
            type="number"
            min="0"
            value={draft.contractValue || ""}
            onChange={(event) =>
              update("contractValue", Number(event.target.value))
            }
          />
        </Field>
        <Field label="Required BG %">
          <Input
            type="number"
            min="0"
            max="100"
            value={draft.bgPercentage || ""}
            onChange={(event) =>
              update("bgPercentage", Number(event.target.value))
            }
          />
        </Field>
        <Field label="Calculated requirement">
          <Input
            disabled
            value={formatBgCurrency(requirement, draft.currency)}
          />
        </Field>
        <Field label="Existing BG under contract">
          <Input
            type="number"
            min="0"
            value={draft.existingBgAmount || ""}
            onChange={(event) =>
              update("existingBgAmount", Number(event.target.value))
            }
          />
        </Field>
        <Field label="Balance requirement">
          <Input
            disabled
            value={formatBgCurrency(balanceRequirement, draft.currency)}
          />
        </Field>
      </Section>
      <Section
        title="Amount and validity"
        description="Claim expiry is recalculated from expiry plus claim period."
      >
        <Field label="Requested amount" required>
          <Input
            type="number"
            min="0"
            value={draft.requestedAmount || ""}
            onChange={(event) =>
              update("requestedAmount", Number(event.target.value))
            }
          />
        </Field>
        <Field label="Currency">
          <Select
            value={draft.currency}
            onValueChange={(value) => update("currency", value)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {["INR", "USD", "EUR", "GBP", "AED", "JPY"].map((value) => (
                <SelectItem key={value} value={value}>
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Exchange rate">
          <Input
            type="number"
            min="0"
            step="0.0001"
            value={draft.exchangeRate || ""}
            disabled={draft.currency === "INR"}
            onChange={(event) =>
              update("exchangeRate", Number(event.target.value))
            }
          />
        </Field>
        <Field label="Base-currency exposure">
          <Input disabled value={formatBgCurrency(baseExposure)} />
        </Field>
        <Field label="Required issue date">
          <Input
            type="date"
            value={draft.requiredIssueDate}
            onChange={(event) =>
              update("requiredIssueDate", event.target.value)
            }
          />
        </Field>
        <Field label="Start date">
          <Input
            type="date"
            value={draft.proposedStartDate}
            onChange={(event) =>
              update("proposedStartDate", event.target.value)
            }
          />
        </Field>
        <Field label="Expiry date">
          <Input
            type="date"
            value={draft.proposedExpiryDate}
            onChange={(event) => changeExpiry(event.target.value)}
          />
        </Field>
        <Field label="Claim period (days)">
          <Input
            type="number"
            min="0"
            value={draft.claimPeriodDays || ""}
            onChange={(event) => {
              const days = Number(event.target.value);
              setDraft((current) => ({
                ...current,
                claimPeriodDays: days,
                proposedClaimExpiryDate: addBgDays(
                  current.proposedExpiryDate,
                  days,
                ),
              }));
            }}
          />
        </Field>
        <Field label="Claim expiry">
          <Input
            type="date"
            value={draft.proposedClaimExpiryDate}
            onChange={(event) =>
              update("proposedClaimExpiryDate", event.target.value)
            }
          />
        </Field>
        <div className="flex items-center gap-3 rounded-lg border bg-slate-50 p-3">
          <Switch
            checked={draft.autoExtensionClause}
            onCheckedChange={(value) => update("autoExtensionClause", value)}
          />
          <div>
            <p className="text-sm font-medium">Auto-extension clause</p>
            <p className="text-[11px] text-muted-foreground">
              Flag contract escalation controls
            </p>
          </div>
        </div>
      </Section>
      <Section
        title="Bank limit, margin, and estimated cost"
        description="Bank accounts and combined BG/LC limits use shared global records."
      >
        <Field label="Preferred bank" required>
          <Select
            value={draft.preferredBankId}
            onValueChange={(id) => {
              update("preferredBankId", id);
              const limit = limits.find((row) => row.bankId === id);
              if (limit) update("bankLimitId", limit.id);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select bank" />
            </SelectTrigger>
            <SelectContent>
              {banks.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.bankName} · {item.branch}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Bank limit">
          <Select
            value={draft.bankLimitId || "none"}
            onValueChange={(value) =>
              update("bankLimitId", value === "none" ? "" : value)
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No linked limit</SelectItem>
              {limits
                .filter(
                  (item) =>
                    !draft.preferredBankId ||
                    item.bankId === draft.preferredBankId,
                )
                .map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.bankName} · {bgLabel(item.limitType)} ·{" "}
                    {formatBgCurrency(Number(item.availableAmount || 0))}{" "}
                    available
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          {selectedLimit && (
            <p className="text-[11px] text-muted-foreground">
              Combined utilisation includes active LC and BG exposure.
            </p>
          )}
        </Field>
        <Field label="Margin type">
          <Select
            value={draft.marginType}
            onValueChange={(value) => update("marginType", value)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BG_MARGIN_TYPES.map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Margin %">
          <Input
            type="number"
            min="0"
            max="100"
            value={draft.marginPercentage || ""}
            onChange={(event) =>
              update("marginPercentage", Number(event.target.value))
            }
          />
        </Field>
        <Field label="Required margin">
          <div className="flex h-10 items-center rounded-md border bg-indigo-50 px-3 font-semibold text-indigo-800">
            <Calculator className="mr-2 h-4 w-4" />
            {formatBgCurrency(margin)}
          </div>
        </Field>
        <Field label="Estimated commission">
          <Input
            type="number"
            min="0"
            value={draft.estimatedCommission || ""}
            onChange={(event) =>
              update("estimatedCommission", Number(event.target.value))
            }
          />
        </Field>
        <Field label="Estimated GST">
          <Input
            type="number"
            min="0"
            value={draft.estimatedGst || ""}
            onChange={(event) =>
              update("estimatedGst", Number(event.target.value))
            }
          />
        </Field>
        <Field label="Estimated other charges">
          <Input
            type="number"
            min="0"
            value={draft.estimatedOtherCharges || ""}
            onChange={(event) =>
              update("estimatedOtherCharges", Number(event.target.value))
            }
          />
        </Field>
        <Field label="Remarks" wide>
          <Textarea
            value={draft.remarks || ""}
            onChange={(event) => update("remarks", event.target.value)}
          />
        </Field>
      </Section>
    </div>
  );
}
