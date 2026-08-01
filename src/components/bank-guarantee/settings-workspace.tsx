"use client";

import { useEffect, useMemo, useState } from "react";
import {
  collection,
  getDocs,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { Plus, Trash2 } from "lucide-react";
import GenericCrudPage, {
  type CrudColumnConfig,
  type CrudFieldConfig,
} from "@/components/vehicle-management/generic-crud-page";
import { db } from "@/lib/firebase";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useToast } from "@/hooks/use-toast";
import {
  BG_COLLECTIONS,
  BG_PERMISSION_MODULE,
  DEFAULT_BG_SETTINGS,
  bgLabel,
  calculateBgAvailableLimit,
  formatBgCurrency,
  type BGSettings,
} from "@/lib/bank-guarantee";
import {
  bgSettingsReference,
  loadBGSettings,
} from "@/lib/bank-guarantee-settings";
import type { BankAccount, Project } from "@/lib/types";
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
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
export default function BGSettingsWorkspace() {
  const { user } = useAuth();
  const { can } = useAuthorization();
  const { toast } = useToast();
  const organizationId = user?.organizationId || "default",
    canView = can("View", `${BG_PERMISSION_MODULE}.Settings`),
    canEdit = can("Edit", `${BG_PERMISSION_MODULE}.Settings`),
    canBeneficiary =
      can("Manage Beneficiaries", `${BG_PERMISSION_MODULE}.Settings`) ||
      canEdit,
    canContracts =
      can("Manage Contracts", `${BG_PERMISSION_MODULE}.Settings`) || canEdit,
    canLimits =
      can("Manage Limits", `${BG_PERMISSION_MODULE}.Settings`) || canEdit;
  const [settings, setSettings] = useState<BGSettings>({
      ...DEFAULT_BG_SETTINGS,
      organizationId,
    }),
    [saving, setSaving] = useState(false),
    [banks, setBanks] = useState<BankAccount[]>([]),
    [projects, setProjects] = useState<Project[]>([]),
    [beneficiaries, setBeneficiaries] = useState<
      Array<Record<string, any> & { id: string }>
    >([]);
  useEffect(() => {
    if (!canView) return;
    void Promise.all([
      loadBGSettings(organizationId),
      getDocs(collection(db, "bankAccounts")),
      getDocs(collection(db, "projects")),
      getDocs(collection(db, BG_COLLECTIONS.beneficiaries)),
    ]).then(([organizationSettings, bankSnap, projectSnap, beneficiarySnap]) => {
      setSettings(organizationSettings);
      setBanks(
        bankSnap.docs
          .map((item) => ({ id: item.id, ...item.data() }) as BankAccount)
          .filter((item) => item.status === "Active"),
      );
      setProjects(
        projectSnap.docs
          .map((item) => ({ id: item.id, ...item.data() }) as Project)
          .filter((item) => item.status === "Active"),
      );
      setBeneficiaries(
        beneficiarySnap.docs
          .map(
            (item) =>
              ({ id: item.id, ...item.data() }) as Record<string, any> & {
                id: string;
              },
          )
          .filter(
            (item) =>
              !item.organizationId || item.organizationId === organizationId,
          ),
      );
    });
  }, [canView, organizationId]);
  const set = <K extends keyof BGSettings>(key: K, value: BGSettings[K]) =>
    setSettings((current) => ({ ...current, [key]: value }));
  const save = async () => {
    if (!user || !canEdit) return;
    setSaving(true);
    try {
      await setDoc(
        bgSettingsReference(organizationId),
        {
          ...settings,
          approvalThresholds: settings.approvalThresholds
            .filter((item) => item.amount >= 0 && item.role.trim())
            .sort((a, b) => a.amount - b.amount),
          escalationRules: settings.escalationRules.filter(
            (item) => item.condition.trim() && item.escalationRole.trim(),
          ),
          organizationId,
          updatedBy: user.id,
          updatedByName: user.name,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      toast({ title: "BG settings saved" });
    } catch {
      toast({ title: "Unable to save BG settings", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };
  const beneficiaryFields: CrudFieldConfig[] = [
    { key: "legalName", label: "Legal Name", type: "text", required: true },
    { key: "tradeName", label: "Trade Name", type: "text" },
    { key: "clientCode", label: "Client Code", type: "text", required: true },
    { key: "address", label: "Address", type: "textarea", required: true },
    { key: "pan", label: "PAN", type: "text" },
    { key: "gstNumber", label: "GST Number", type: "text" },
    { key: "contactPerson", label: "Contact Person", type: "text" },
    { key: "mobile", label: "Mobile", type: "text" },
    { key: "email", label: "Email", type: "text" },
    { key: "department", label: "Department", type: "text" },
    {
      key: "bgFormatPreference",
      label: "BG Format Preference",
      type: "textarea",
    },
    {
      key: "status",
      label: "Status",
      type: "select",
      options: [
        { value: "ACTIVE", label: "Active" },
        { value: "INACTIVE", label: "Inactive" },
      ],
    },
  ];
  const beneficiaryColumns: CrudColumnConfig[] = [
    { key: "legalName", label: "Legal Name" },
    { key: "clientCode", label: "Client Code" },
    { key: "contactPerson", label: "Contact" },
    { key: "mobile", label: "Mobile" },
    { key: "email", label: "Email" },
    { key: "status", label: "Status" },
  ];
  const contractFields: CrudFieldConfig[] = useMemo(
    () => [
      { key: "tenderNumber", label: "Tender Number", type: "text" },
      {
        key: "contractNumber",
        label: "Contract Number",
        type: "text",
        required: true,
      },
      { key: "workOrderNumber", label: "Work Order", type: "text" },
      {
        key: "beneficiaryId",
        label: "Beneficiary",
        type: "select",
        searchable: true,
        required: true,
        options: beneficiaries.map((item) => ({
          value: item.id,
          label: String(item.legalName || item.name),
        })),
      },
      {
        key: "projectId",
        label: "Project",
        type: "select",
        searchable: true,
        required: true,
        options: projects.map((item) => ({
          value: item.id,
          label: item.projectName,
        })),
      },
      { key: "tenderValue", label: "Tender Value", type: "number" },
      {
        key: "contractValue",
        label: "Contract Value",
        type: "number",
        required: true,
      },
      { key: "requiredBgType", label: "Required BG Type", type: "text" },
      { key: "requiredBgPercentage", label: "Required BG %", type: "number" },
      {
        key: "requiredValidityDays",
        label: "Required Validity (Days)",
        type: "number",
      },
      { key: "claimPeriodDays", label: "Claim Period (Days)", type: "number" },
      { key: "contractDate", label: "Contract Date", type: "date" },
      { key: "completionDate", label: "Completion Date", type: "date" },
      {
        key: "status",
        label: "Status",
        type: "select",
        options: [
          { value: "ACTIVE", label: "Active" },
          { value: "COMPLETED", label: "Completed" },
          { value: "ON_HOLD", label: "On Hold" },
        ],
      },
    ],
    [beneficiaries, projects],
  );
  const contractColumns: CrudColumnConfig[] = [
    { key: "contractNumber", label: "Contract" },
    { key: "tenderNumber", label: "Tender" },
    { key: "projectName", label: "Project" },
    { key: "beneficiaryName", label: "Beneficiary" },
    {
      key: "contractValue",
      label: "Value",
      formatter: (value) => formatBgCurrency(Number(value || 0)),
    },
    { key: "requiredBgPercentage", label: "BG %" },
    { key: "status", label: "Status" },
  ];
  const limitFields: CrudFieldConfig[] = useMemo(
    () => [
      {
        key: "bankId",
        label: "Global Bank Account",
        type: "select",
        searchable: true,
        required: true,
        options: banks.map((item) => ({
          value: item.id,
          label: `${item.bankName} · ${item.branch}`,
        })),
      },
      {
        key: "limitType",
        label: "Limit Type",
        type: "select",
        required: true,
        options: [
          { value: "BG", label: "Separate BG Limit" },
          { value: "LC", label: "Separate LC Limit" },
          { value: "COMBINED_BG_LC", label: "Combined BG & LC Limit" },
          { value: "TEMPORARY", label: "Temporary / Ad hoc" },
        ],
      },
      {
        key: "limitScope",
        label: "Limit Scope",
        type: "select",
        required: true,
        options: [
          { value: "GENERAL", label: "General Bank Limit" },
          { value: "PROJECT", label: "Project Specific" },
          { value: "BENEFICIARY", label: "Beneficiary Specific" },
        ],
      },
      {
        key: "projectId",
        label: "Scoped Project",
        type: "select",
        searchable: true,
        options: projects.map((item) => ({
          value: item.id,
          label: item.projectName,
        })),
      },
      {
        key: "beneficiaryId",
        label: "Scoped Beneficiary",
        type: "select",
        searchable: true,
        options: beneficiaries.map((item) => ({
          value: item.id,
          label: String(item.legalName || item.name),
        })),
      },
      {
        key: "sanctionedAmount",
        label: "Sanctioned Amount",
        type: "number",
        required: true,
      },
      { key: "temporaryLimit", label: "Temporary Limit", type: "number" },
      { key: "bgUtilizedAmount", label: "BG Utilised", type: "number" },
      { key: "lcUtilizedAmount", label: "LC Utilised", type: "number" },
      { key: "utilizedAmount", label: "Combined Utilised", type: "number" },
      { key: "reservedAmount", label: "Reserved Amount", type: "number" },
      { key: "availableAmount", label: "Available Amount", type: "number" },
      {
        key: "effectiveDate",
        label: "Effective Date",
        type: "date",
        required: true,
      },
      {
        key: "validityDate",
        label: "Validity Date",
        type: "date",
        required: true,
      },
      { key: "marginPercentage", label: "Default Margin %", type: "number" },
      { key: "commissionRate", label: "Annual Commission %", type: "number" },
      { key: "minimumCommission", label: "Minimum Commission", type: "number" },
      {
        key: "claimPeriodPolicy",
        label: "Claim Period Policy",
        type: "text",
      },
      {
        key: "calculationBasis",
        label: "Commission Basis",
        type: "select",
        options: ["DAILY", "MONTHLY", "QUARTERLY_OR_PART", "MANUAL"].map(
          (value) => ({ value, label: bgLabel(value) }),
        ),
      },
      {
        key: "status",
        label: "Status",
        type: "select",
        options: [
          { value: "ACTIVE", label: "Active" },
          { value: "EXPIRED", label: "Expired" },
          { value: "ON_HOLD", label: "On Hold" },
        ],
      },
      {
        key: "sanctionDocumentUrl",
        label: "Sanction Document",
        type: "file",
      },
    ],
    [banks, beneficiaries, projects],
  );
  const limitColumns: CrudColumnConfig[] = [
    { key: "bankName", label: "Bank" },
    { key: "limitType", label: "Type" },
    { key: "limitScope", label: "Scope" },
    {
      key: "sanctionedAmount",
      label: "Sanctioned",
      formatter: (value) => formatBgCurrency(Number(value || 0)),
    },
    {
      key: "bgUtilizedAmount",
      label: "BG Used",
      formatter: (value) => formatBgCurrency(Number(value || 0)),
    },
    {
      key: "lcUtilizedAmount",
      label: "LC Used",
      formatter: (value) => formatBgCurrency(Number(value || 0)),
    },
    {
      key: "reservedAmount",
      label: "Reserved",
      formatter: (value) => formatBgCurrency(Number(value || 0)),
    },
    {
      key: "availableAmount",
      label: "Available",
      formatter: (value) => formatBgCurrency(Number(value || 0)),
    },
    { key: "status", label: "Status" },
  ];
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">BG Settings & Global Masters</h1>
        <p className="text-sm text-muted-foreground">
          Shared bank accounts, projects, users and departments are reused;
          missing Beneficiary and Contract masters are managed here.
        </p>
      </div>
      <Tabs defaultValue="limits">
        <TabsList className="flex h-auto flex-wrap">
          <TabsTrigger value="limits">Shared Bank Limits</TabsTrigger>
          <TabsTrigger value="beneficiaries">Beneficiaries</TabsTrigger>
          <TabsTrigger value="contracts">Contracts & Tenders</TabsTrigger>
          <TabsTrigger value="workflow">Approval & Escalation</TabsTrigger>
          <TabsTrigger value="controls">Workflow Controls</TabsTrigger>
        </TabsList>
        <TabsContent value="limits">
          <GenericCrudPage
            title="Bank BG / LC Limits"
            description="One shared exposure record supports separate and combined BG/LC limits."
            itemName="Bank Limit"
            collectionName={BG_COLLECTIONS.bankLimits}
            fields={limitFields}
            columns={limitColumns}
            canView={canView}
            canAdd={canLimits}
            canEdit={canLimits}
            canDelete={false}
            canExport={canView}
            exportFileName="shared-bank-bg-lc-limits"
            uploadPathPrefix={`organizations/${organizationId}/bank-guarantees/limits`}
            onAfterFetch={(rows) =>
              rows.filter(
                (row) =>
                  user?.role === "Super Admin" ||
                  row.organizationId === organizationId,
              )
            }
            onBeforeSave={(payload) => {
              const bank = banks.find((item) => item.id === payload.bankId),
                project = projects.find(
                  (item) => item.id === payload.projectId,
                ),
                beneficiary = beneficiaries.find(
                  (item) => item.id === payload.beneficiaryId,
                ),
                utilized =
                  Number(payload.bgUtilizedAmount || 0) +
                  Number(payload.lcUtilizedAmount || 0);
              return {
                ...payload,
                organizationId,
                bankName: bank?.bankName || "",
                branchName: bank?.branch || "",
                limitScope: payload.limitScope || "GENERAL",
                projectName: project?.projectName || "",
                beneficiaryName: String(beneficiary?.legalName || ""),
                utilizedAmount: utilized,
                availableAmount: calculateBgAvailableLimit(
                  Number(payload.sanctionedAmount || 0),
                  Number(payload.temporaryLimit || 0),
                  utilized,
                  Number(payload.reservedAmount || 0),
                ),
                updatedBy: user?.id || "",
                updatedByName: user?.name || "",
              };
            }}
          />
        </TabsContent>
        <TabsContent value="beneficiaries">
          <GenericCrudPage
            title="Global Beneficiary Master"
            description="Legal identity and beneficiary BG-format preferences; request forms consume this master read-only."
            itemName="Beneficiary"
            collectionName={BG_COLLECTIONS.beneficiaries}
            fields={beneficiaryFields}
            columns={beneficiaryColumns}
            canView={canView}
            canAdd={canBeneficiary}
            canEdit={canBeneficiary}
            canDelete={false}
            canExport={canView}
            uploadPathPrefix={`organizations/${organizationId}/bank-guarantees/masters`}
            onAfterFetch={(rows) =>
              rows.filter(
                (row) =>
                  user?.role === "Super Admin" ||
                  row.organizationId === organizationId,
              )
            }
            onBeforeSave={(payload) => ({
              ...payload,
              organizationId,
              updatedBy: user?.id || "",
              updatedByName: user?.name || "",
            })}
          />
        </TabsContent>
        <TabsContent value="contracts">
          <GenericCrudPage
            title="Global Contract & Tender Master"
            description="Project and beneficiary-linked contractual BG requirement setup."
            itemName="Contract"
            collectionName={BG_COLLECTIONS.contracts}
            fields={contractFields}
            columns={contractColumns}
            canView={canView}
            canAdd={canContracts}
            canEdit={canContracts}
            canDelete={false}
            canExport={canView}
            uploadPathPrefix={`organizations/${organizationId}/bank-guarantees/masters`}
            onAfterFetch={(rows) =>
              rows.filter(
                (row) =>
                  user?.role === "Super Admin" ||
                  row.organizationId === organizationId,
              )
            }
            onBeforeSave={(payload) => {
              const project = projects.find(
                  (item) => item.id === payload.projectId,
                ),
                beneficiary = beneficiaries.find(
                  (item) => item.id === payload.beneficiaryId,
                );
              return {
                ...payload,
                organizationId,
                projectName: project?.projectName || "",
                beneficiaryName: beneficiary?.legalName || "",
                updatedBy: user?.id || "",
                updatedByName: user?.name || "",
              };
            }}
          />
        </TabsContent>
        <TabsContent value="workflow">
          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Amount-based approval matrix</CardTitle>
                <CardDescription>
                  Configure the final approver after project, commercial, and
                  finance verification. Keep thresholds in ascending order.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {settings.approvalThresholds.map((threshold, index) => (
                  <div
                    key={`${index}-${threshold.role}`}
                    className="grid gap-2 sm:grid-cols-[1fr_1.3fr_auto]"
                  >
                    <Input
                      type="number"
                      min="0"
                      value={threshold.amount}
                      onChange={(event) => {
                        const rows = [...settings.approvalThresholds];
                        rows[index] = {
                          ...threshold,
                          amount: Number(event.target.value),
                        };
                        set("approvalThresholds", rows);
                      }}
                      aria-label="Approval threshold amount"
                    />
                    <Input
                      value={threshold.role}
                      onChange={(event) => {
                        const rows = [...settings.approvalThresholds];
                        rows[index] = {
                          ...threshold,
                          role: event.target.value,
                        };
                        set("approvalThresholds", rows);
                      }}
                      aria-label="Required approver role"
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      disabled={
                        !canEdit || settings.approvalThresholds.length === 1
                      }
                      onClick={() =>
                        set(
                          "approvalThresholds",
                          settings.approvalThresholds.filter(
                            (_, rowIndex) => rowIndex !== index,
                          ),
                        )
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  variant="outline"
                  disabled={!canEdit}
                  onClick={() =>
                    set("approvalThresholds", [
                      ...settings.approvalThresholds,
                      { amount: 0, role: "Finance Manager" },
                    ])
                  }
                >
                  <Plus className="mr-2 h-4 w-4" /> Add threshold
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Escalation matrix</CardTitle>
                <CardDescription>
                  Ownership and escalation timing for overdue lifecycle actions.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {settings.escalationRules.map((rule, index) => (
                  <div
                    key={`${index}-${rule.condition}`}
                    className="rounded-lg border p-3"
                  >
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Input
                        value={rule.condition}
                        placeholder="Condition"
                        onChange={(event) => {
                          const rows = [...settings.escalationRules];
                          rows[index] = {
                            ...rule,
                            condition: event.target.value,
                          };
                          set("escalationRules", rows);
                        }}
                      />
                      <Input
                        type="number"
                        min="0"
                        value={rule.afterDays}
                        placeholder="After days"
                        onChange={(event) => {
                          const rows = [...settings.escalationRules];
                          rows[index] = {
                            ...rule,
                            afterDays: Number(event.target.value),
                          };
                          set("escalationRules", rows);
                        }}
                      />
                      <Input
                        value={rule.recipientRole}
                        placeholder="Initial recipient"
                        onChange={(event) => {
                          const rows = [...settings.escalationRules];
                          rows[index] = {
                            ...rule,
                            recipientRole: event.target.value,
                          };
                          set("escalationRules", rows);
                        }}
                      />
                      <div className="flex gap-2">
                        <Input
                          value={rule.escalationRole}
                          placeholder="Escalation role"
                          onChange={(event) => {
                            const rows = [...settings.escalationRules];
                            rows[index] = {
                              ...rule,
                              escalationRole: event.target.value,
                            };
                            set("escalationRules", rows);
                          }}
                        />
                        <Button
                          variant="outline"
                          size="icon"
                          disabled={!canEdit}
                          onClick={() =>
                            set(
                              "escalationRules",
                              settings.escalationRules.filter(
                                (_, rowIndex) => rowIndex !== index,
                              ),
                            )
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
                <Button
                  variant="outline"
                  disabled={!canEdit}
                  onClick={() =>
                    set("escalationRules", [
                      ...settings.escalationRules,
                      {
                        condition: "",
                        afterDays: 1,
                        recipientRole: "Finance Manager",
                        escalationRole: "Director Finance",
                      },
                    ])
                  }
                >
                  <Plus className="mr-2 h-4 w-4" /> Add escalation
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
        <TabsContent value="controls">
          <Card>
            <CardHeader>
              <CardTitle>
                Workflow, validation, alerts, and approval controls
              </CardTitle>
              <CardDescription>
                Organization-level controls applied across the BG lifecycle.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Reference prefix">
                  <Input
                    value={settings.referencePrefix}
                    onChange={(e) => set("referencePrefix", e.target.value)}
                  />
                </Field>
                <Field label="Base currency">
                  <Input
                    value={settings.baseCurrency}
                    onChange={(e) =>
                      set("baseCurrency", e.target.value.toUpperCase())
                    }
                  />
                </Field>
                <Field label="Default claim period">
                  <Input
                    type="number"
                    value={settings.defaultClaimPeriodDays}
                    onChange={(e) =>
                      set("defaultClaimPeriodDays", Number(e.target.value))
                    }
                  />
                </Field>
                <Field label="Reservation expiry days">
                  <Input
                    type="number"
                    value={settings.reservationExpiryDays}
                    onChange={(e) =>
                      set("reservationExpiryDays", Number(e.target.value))
                    }
                  />
                </Field>
                <Field label="Expiry alert days">
                  <Input
                    value={settings.expiryAlertDays.join(", ")}
                    onChange={(e) =>
                      set(
                        "expiryAlertDays",
                        e.target.value
                          .split(",")
                          .map((v) => Number(v.trim()))
                          .filter(Number.isFinite),
                      )
                    }
                  />
                </Field>
                <Field label="Claim alert days">
                  <Input
                    value={settings.claimAlertDays.join(", ")}
                    onChange={(e) =>
                      set(
                        "claimAlertDays",
                        e.target.value
                          .split(",")
                          .map((v) => Number(v.trim()))
                          .filter(Number.isFinite),
                      )
                    }
                  />
                </Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {(
                  [
                    [
                      "requireMarginBeforeIssuance",
                      "Require complete margin before issuance",
                    ],
                    [
                      "requireBankCancellationConfirmation",
                      "Require bank cancellation confirmation",
                    ],
                    [
                      "requireBeneficiaryRelease",
                      "Require beneficiary release",
                    ],
                    ["requireOriginalReturn", "Require original BG return"],
                    [
                      "allowCrossBankFdWithApproval",
                      "Allow cross-bank FD with approval",
                    ],
                    [
                      "allowManualDateOverride",
                      "Allow controlled manual date override",
                    ],
                  ] as const
                ).map(([key, label]) => (
                  <label
                    key={key}
                    className="flex items-center justify-between rounded-lg border p-3 text-sm"
                  >
                    <span>{label}</span>
                    <Switch
                      checked={settings[key]}
                      onCheckedChange={(value) => set(key, value)}
                    />
                  </label>
                ))}
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Mandatory request documents">
                  <Textarea
                    value={settings.mandatoryRequestDocuments.join("\n")}
                    onChange={(e) =>
                      set(
                        "mandatoryRequestDocuments",
                        e.target.value.split("\n").filter(Boolean),
                      )
                    }
                  />
                </Field>
                <Field label="Mandatory issuance documents">
                  <Textarea
                    value={settings.mandatoryIssuanceDocuments.join("\n")}
                    onChange={(e) =>
                      set(
                        "mandatoryIssuanceDocuments",
                        e.target.value.split("\n").filter(Boolean),
                      )
                    }
                  />
                </Field>
                <Field label="Mandatory cancellation documents">
                  <Textarea
                    value={settings.mandatoryCancellationDocuments.join("\n")}
                    onChange={(e) =>
                      set(
                        "mandatoryCancellationDocuments",
                        e.target.value.split("\n").filter(Boolean),
                      )
                    }
                  />
                </Field>
                <Field label="Mandatory extension documents">
                  <Textarea
                    value={settings.mandatoryExtensionDocuments.join("\n")}
                    onChange={(e) =>
                      set(
                        "mandatoryExtensionDocuments",
                        e.target.value.split("\n").filter(Boolean),
                      )
                    }
                  />
                </Field>
                <Field label="Mandatory invocation documents">
                  <Textarea
                    value={settings.mandatoryInvocationDocuments.join("\n")}
                    onChange={(e) =>
                      set(
                        "mandatoryInvocationDocuments",
                        e.target.value.split("\n").filter(Boolean),
                      )
                    }
                  />
                </Field>
                <Field label="Mandatory closure documents">
                  <Textarea
                    value={settings.mandatoryClosureDocuments.join("\n")}
                    onChange={(e) =>
                      set(
                        "mandatoryClosureDocuments",
                        e.target.value.split("\n").filter(Boolean),
                      )
                    }
                  />
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Allowed BG purposes (one per line)">
                  <Textarea
                    className="min-h-44"
                    value={settings.purposes.join("\n")}
                    onChange={(event) =>
                      set(
                        "purposes",
                        event.target.value
                          .split("\n")
                          .map((value) =>
                            value.trim().toUpperCase().replace(/\s+/g, "_"),
                          )
                          .filter(Boolean),
                      )
                    }
                  />
                </Field>
                <Field label="Notification channels">
                  <div className="grid gap-2">
                    {["IN_APP", "DASHBOARD", "EMAIL", "FIREBASE_PUSH"].map(
                      (channel) => (
                        <label
                          key={channel}
                          className="flex items-center justify-between rounded-lg border p-3 text-sm"
                        >
                          <span>{bgLabel(channel)}</span>
                          <Switch
                            checked={settings.notificationChannels.includes(
                              channel,
                            )}
                            onCheckedChange={(checked) =>
                              set(
                                "notificationChannels",
                                checked
                                  ? Array.from(
                                      new Set([
                                        ...settings.notificationChannels,
                                        channel,
                                      ]),
                                    )
                                  : settings.notificationChannels.filter(
                                      (value) => value !== channel,
                                    ),
                              )
                            }
                          />
                        </label>
                      ),
                    )}
                  </div>
                </Field>
              </div>
              {canEdit && (
                <div className="flex justify-end">
                  <Button disabled={saving} onClick={() => void save()}>
                    {saving ? "Saving…" : "Save BG Settings"}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
