"use client";

import { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import {
  BellRing,
  Bot,
  Building2,
  Loader2,
  Pencil,
  Plus,
  ShieldCheck,
} from "lucide-react";
import { db } from "@/lib/firebase";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useToast } from "@/hooks/use-toast";
import {
  ApprovalRule,
  DEFAULT_PAYMENT_CATEGORIES,
  DEFAULT_RECURRING_PAYMENT_SETTINGS,
  RecurringPaymentSettings,
  RP_COLLECTIONS,
  currency,
} from "@/lib/recurring-payments";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { useGlobalScopes } from "./use-global-scopes";
import { useFieldControl, validateFieldControlRequirements } from "./use-field-control";

const settingDocId = (organizationId: string) =>
  organizationId.replace(/[^a-zA-Z0-9_-]/g, "_");
const parseNumbers = (value: string) =>
  [
    ...new Set(
      value
        .split(",")
        .map(Number)
        .filter((n) => Number.isInteger(n) && n >= 0),
    ),
  ].sort((a, b) => b - a);

export default function RecurringPaymentSettingsPanel({
  organizationId,
  section,
}: {
  organizationId: string;
  section: "approvals" | "notifications" | "automation" | "organization";
}) {
  const { users } = useAuth();
  const { can } = useAuthorization();
  const { toast } = useToast();
  const { projects } = useGlobalScopes();
  const [settings, setSettings] = useState<RecurringPaymentSettings>({
    ...DEFAULT_RECURRING_PAYMENT_SETTINGS,
    organizationId,
  });
  const [rules, setRules] = useState<ApprovalRule[]>([]);
  const [ruleOpen, setRuleOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<ApprovalRule | null>(null);
  const [saving, setSaving] = useState(false);
  const [daysBeforeText, setDaysBeforeText] = useState("7, 3, 1, 0");
  const [daysAfterText, setDaysAfterText] = useState("1");
  const [recipientsText, setRecipientsText] = useState(
    "Assigned Employee, Accounts Team",
  );
  const canEdit = can("Edit", "Recurring Payments.Settings");

  useEffect(() => {
    const settingsRef = doc(
      db,
      RP_COLLECTIONS.settings,
      settingDocId(organizationId),
    );
    const stopSettings = onSnapshot(settingsRef, (snap) => {
      if (!snap.exists()) return;
      const data = snap.data() as Partial<RecurringPaymentSettings>;
      const merged = {
        ...DEFAULT_RECURRING_PAYMENT_SETTINGS,
        ...data,
        organizationId,
        notifications: {
          ...DEFAULT_RECURRING_PAYMENT_SETTINGS.notifications,
          ...data.notifications,
        },
        automation: {
          ...DEFAULT_RECURRING_PAYMENT_SETTINGS.automation,
          ...data.automation,
        },
        controls: {
          ...DEFAULT_RECURRING_PAYMENT_SETTINGS.controls,
          ...data.controls,
        },
      };
      setSettings(merged);
      setDaysBeforeText(merged.notifications.daysBefore.join(", "));
      setDaysAfterText(merged.notifications.daysAfter.join(", "));
      setRecipientsText(merged.notifications.recipients.join(", "));
    });
    const stopRules = onSnapshot(
      query(
        collection(db, RP_COLLECTIONS.approvalRules),
        where("organizationId", "==", organizationId),
      ),
      (snap) => {
        setRules(
          snap.docs.map((item) => ({
            id: item.id,
            ...item.data(),
          })) as ApprovalRule[],
        );
      },
    );
    return () => {
      stopSettings();
      stopRules();
    };
  }, [organizationId]);

  async function save(
    section: "notifications" | "automation" | "controls" | "organization",
  ) {
    if (!canEdit)
      return toast({
        title: "You do not have permission to edit settings",
        variant: "destructive",
      });
    setSaving(true);
    try {
      const valueToSave =
        section === "notifications"
          ? {
              ...settings,
              notifications: {
                ...settings.notifications,
                daysBefore: parseNumbers(daysBeforeText),
                daysAfter: parseNumbers(daysAfterText),
                recipients: recipientsText
                  .split(",")
                  .map((x) => x.trim())
                  .filter(Boolean),
              },
            }
          : settings;
      await setDoc(
        doc(db, RP_COLLECTIONS.settings, settingDocId(organizationId)),
        {
          ...valueToSave,
          organizationId,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      setSettings(valueToSave);
      toast({
        title: `${section === "organization" ? "Organization controls" : section[0].toUpperCase() + section.slice(1)} saved`,
      });
    } catch {
      toast({ title: "Settings could not be saved", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  const activeRules = useMemo(
    () => rules.filter((r) => r.active).length,
    [rules],
  );
  return (
    <>
      {section === "approvals" && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-indigo-600" />
                  Approval Rules
                </CardTitle>
                <CardDescription>
                  {activeRules} active rule(s). Rules can be sequential or
                  parallel and scoped by amount, category, and project.
                </CardDescription>
              </div>
              {canEdit && (
                <Button
                  onClick={() => {
                    setEditingRule(null);
                    setRuleOpen(true);
                  }}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  New rule
                </Button>
              )}
            </CardHeader>
            <CardContent className="space-y-3">
              {rules.map((rule) => (
                <div
                  key={rule.id}
                  className="flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{rule.name}</p>
                      <Badge variant="outline">{rule.mode}</Badge>
                      <Badge variant={rule.active ? "default" : "secondary"}>
                        {rule.active ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {currency(rule.minAmount)} to{" "}
                      {rule.maxAmount ? currency(rule.maxAmount) : "No limit"} ·{" "}
                      {rule.category || "All categories"} ·{" "}
                      {projects.find((item) => item.id === rule.project)
                        ?.projectName ||
                        rule.project ||
                        "All projects"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Approvers:{" "}
                      {rule.approvers
                        .map(
                          (id) =>
                            users.find((item) => item.id === id)?.name || id,
                        )
                        .join(" → ")}
                      {rule.finalAccountsVerification
                        ? " → Accounts verification"
                        : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {canEdit && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEditingRule(rule);
                          setRuleOpen(true);
                        }}
                      >
                        <Pencil className="mr-1 h-3 w-3" />
                        Edit
                      </Button>
                    )}
                    <Switch
                      disabled={!canEdit}
                      checked={rule.active}
                      onCheckedChange={(active) =>
                        updateDoc(
                          doc(db, RP_COLLECTIONS.approvalRules, rule.id),
                          { active, updatedAt: serverTimestamp() },
                        )
                      }
                    />
                  </div>
                </div>
              ))}
              {!rules.length && (
                <div className="rounded-xl border border-dashed py-12 text-center text-sm text-muted-foreground">
                  No approval rules configured. Add the first amount-based rule.
                </div>
              )}
            </CardContent>
          </Card>
      )}

      {section === "notifications" && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BellRing className="h-5 w-5 text-violet-600" />
                Notification Rules
              </CardTitle>
              <CardDescription>
                Configure channels, reminder schedule, overdue escalation, and
                recipients.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-3 sm:grid-cols-2">
                {(
                  [
                    ["inApp", "In-app notification"],
                    ["email", "Email"],
                    ["push", "Push notification"],
                    ["sms", "WhatsApp / SMS"],
                  ] as const
                ).map(([key, label]) => (
                  <ToggleRow
                    key={key}
                    label={label}
                    checked={settings.notifications[key]}
                    onChange={(value) =>
                      setSettings((s) => ({
                        ...s,
                        notifications: { ...s.notifications, [key]: value },
                      }))
                    }
                  />
                ))}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <SettingField
                  label="Days before due date"
                  help="Comma-separated, including 0 for due date"
                >
                  <Input
                    value={daysBeforeText}
                    onChange={(e) => setDaysBeforeText(e.target.value)}
                  />
                </SettingField>
                <SettingField
                  label="Days after due date"
                  help="Comma-separated escalation days"
                >
                  <Input
                    value={daysAfterText}
                    onChange={(e) => setDaysAfterText(e.target.value)}
                  />
                </SettingField>
              </div>
              <SettingField label="Recipients" help="Comma-separated roles">
                <Input
                  value={recipientsText}
                  onChange={(e) => setRecipientsText(e.target.value)}
                />
              </SettingField>
              <ToggleRow
                label="Daily overdue escalation"
                checked={settings.notifications.dailyOverdueEscalation}
                onChange={(value) =>
                  setSettings((s) => ({
                    ...s,
                    notifications: {
                      ...s.notifications,
                      dailyOverdueEscalation: value,
                    },
                  }))
                }
              />
              {canEdit && (
                <div className="flex justify-end">
                  <SaveButton
                    saving={saving}
                    onClick={() => save("notifications")}
                  />
                </div>
              )}
            </CardContent>
          </Card>
      )}

      {section === "automation" && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bot className="h-5 w-5 text-blue-600" />
                Automation
              </CardTitle>
              <CardDescription>
                The daily cron checks these settings before generating
                cycle records. Each master has its own "Generate before due
                (days)" setting that controls exactly when its obligation is
                created.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <ToggleRow
                label="Enable automatic payment generation"
                checked={settings.automation.enabled}
                onChange={(value) =>
                  setSettings((s) => ({
                    ...s,
                    automation: { ...s.automation, enabled: value },
                  }))
                }
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <SettingField
                  label="Workflow starts before due"
                  help="Days before due date; default is 7"
                >
                  <Input
                    type="number"
                    min={0}
                    max={90}
                    value={settings.automation.workflowActivationDays}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        automation: {
                          ...s.automation,
                          workflowActivationDays: Math.min(
                            90,
                            Math.max(0, Number(e.target.value)),
                          ),
                        },
                      }))
                    }
                  />
                </SettingField>
                <SettingField label="Timezone">
                  <Select
                    value={settings.automation.timezone}
                    onValueChange={(timezone) =>
                      setSettings((s) => ({
                        ...s,
                        automation: { ...s.automation, timezone },
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[
                        "Asia/Kolkata",
                        "UTC",
                        "Asia/Dubai",
                        "Asia/Singapore",
                      ].map((x) => (
                        <SelectItem value={x} key={x}>
                          {x}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </SettingField>
              </div>
              <ToggleRow
                label="Retry failed notifications"
                checked={settings.automation.retryFailedNotifications}
                onChange={(value) =>
                  setSettings((s) => ({
                    ...s,
                    automation: {
                      ...s.automation,
                      retryFailedNotifications: value,
                    },
                  }))
                }
              />
              <div className="rounded-lg bg-muted p-3 font-mono text-xs">
                Cycle key: organizationId_masterId_cycle (month, week,
                multi-month, or custom interval)
              </div>
              {canEdit && (
                <div className="flex justify-end">
                  <SaveButton
                    saving={saving}
                    onClick={() => save("automation")}
                  />
                </div>
              )}
            </CardContent>
          </Card>
      )}

      {section === "organization" && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5 text-emerald-600" />
                Organization Controls
              </CardTitle>
              <CardDescription>
                Data isolation and payment-control policy for this organization.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <SettingField
                  label="Organization ID"
                  help="Read-only data-scope key"
                >
                  <Input value={organizationId} disabled />
                </SettingField>
                <SettingField label="Organization display name">
                  <Input
                    value={settings.organizationName}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        organizationName: e.target.value,
                      }))
                    }
                  />
                </SettingField>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <ToggleRow
                  label="Lock closed payments"
                  checked={settings.controls.lockClosedPayments}
                  onChange={(value) =>
                    setSettings((s) => ({
                      ...s,
                      controls: { ...s.controls, lockClosedPayments: value },
                    }))
                  }
                />
                <ToggleRow
                  label="Require bill before approval"
                  checked={settings.controls.requireBillBeforeApproval}
                  onChange={(value) =>
                    setSettings((s) => ({
                      ...s,
                      controls: {
                        ...s.controls,
                        requireBillBeforeApproval: value,
                      },
                    }))
                  }
                />
                <ToggleRow
                  label="Require transaction reference"
                  checked={settings.controls.requireTransactionReference}
                  onChange={(value) =>
                    setSettings((s) => ({
                      ...s,
                      controls: {
                        ...s.controls,
                        requireTransactionReference: value,
                      },
                    }))
                  }
                />
                <ToggleRow
                  label="Allow authorized reopening"
                  checked={settings.controls.allowAuthorizedReopen}
                  onChange={(value) =>
                    setSettings((s) => ({
                      ...s,
                      controls: { ...s.controls, allowAuthorizedReopen: value },
                    }))
                  }
                />
              </div>
              <SettingField
                label="Amount variance warning (%)"
                help="Triggers additional review above this variance"
              >
                <Input
                  className="max-w-xs"
                  type="number"
                  min={0}
                  max={1000}
                  value={settings.controls.varianceWarningPercent}
                  onChange={(e) =>
                    setSettings((s) => ({
                      ...s,
                      controls: {
                        ...s.controls,
                        varianceWarningPercent: Number(e.target.value),
                      },
                    }))
                  }
                />
              </SettingField>
              {canEdit && (
                <div className="flex justify-end">
                  <SaveButton
                    saving={saving}
                    onClick={() => save("organization")}
                  />
                </div>
              )}
            </CardContent>
          </Card>
      )}
      <ApprovalRuleDialog
        open={ruleOpen}
        rule={editingRule}
        onClose={() => {
          setRuleOpen(false);
          setEditingRule(null);
        }}
        organizationId={organizationId}
      />
    </>
  );
}

function ApprovalRuleDialog({
  open,
  rule,
  onClose,
  organizationId,
}: {
  open: boolean;
  rule: ApprovalRule | null;
  onClose: () => void;
  organizationId: string;
}) {
  const { users } = useAuth();
  const { projects, activeProjects } = useGlobalScopes();
  const { toast } = useToast();
  const { field } = useFieldControl("approvalRule");
  const [saving, setSaving] = useState(false);
  const [approvers, setApprovers] = useState<string[]>([]);
  const [selectedProject, setSelectedProject] = useState("*");
  useEffect(() => {
    if (open) {
      setApprovers(rule?.approvers || []);
      setSelectedProject(
        rule?.project
          ? projects.find(
              (item) =>
                item.id === rule.project || item.projectName === rule.project,
            )?.id || "*"
          : "*",
      );
    }
  }, [open, projects, rule]);
  function toggleApprover(userId: string, checked: boolean) {
    setApprovers((current) =>
      checked
        ? [...new Set([...current, userId])]
        : current.filter((id) => id !== userId),
    );
  }
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!approvers.length)
      return toast({
        title: "Select at least one approver",
        variant: "destructive",
      });
    const f = new FormData(e.currentTarget);
    const missingLabel = validateFieldControlRequirements(
      "approvalRule",
      { ...Object.fromEntries(f.entries()), approvers },
      field,
    );
    if (missingLabel)
      return toast({ title: `${missingLabel} is required`, variant: "destructive" });
    setSaving(true);
    try {
      const max = String(f.get("maxAmount") || "");
      const payload = {
        organizationId,
        name: f.get("name"),
        minAmount: Number(f.get("minAmount") || 0),
        maxAmount: max ? Number(max) : null,
        category: f.get("category") === "*" ? "" : f.get("category"),
        project: f.get("project") === "*" ? "" : f.get("project"),
        mode: f.get("mode"),
        approvers,
        finalAccountsVerification: f.get("accounts") === "yes",
        active: rule?.active ?? true,
        updatedAt: serverTimestamp(),
      };
      if (rule)
        await updateDoc(
          doc(db, RP_COLLECTIONS.approvalRules, rule.id),
          payload,
        );
      else
        await addDoc(collection(db, RP_COLLECTIONS.approvalRules), {
          ...payload,
          createdAt: serverTimestamp(),
        });
      toast({
        title: rule ? "Approval rule updated" : "Approval rule created",
      });
      onClose();
    } catch {
      toast({ title: "Could not save approval rule", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {rule ? "Edit approval rule" : "New approval rule"}
          </DialogTitle>
          <DialogDescription>
            Rules are evaluated by amount, category, and project. Approvers are
            assigned by user ID automatically.
          </DialogDescription>
        </DialogHeader>
        <form
          key={rule?.id || "new"}
          onSubmit={submit}
          className="grid gap-4 sm:grid-cols-2"
        >
          {field("name").visible && (
            <SettingField label={`${field("name").label}${field("name").required ? " *" : ""}`}>
              <Input name="name" defaultValue={rule?.name || ""} required={field("name").required} />
            </SettingField>
          )}
          {field("mode").visible && (
            <SettingField label={`${field("mode").label}${field("mode").required ? " *" : ""}`}>
              <Select name="mode" defaultValue={rule?.mode || "Sequential"}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Sequential">Sequential</SelectItem>
                  <SelectItem value="Parallel">Parallel</SelectItem>
                </SelectContent>
              </Select>
            </SettingField>
          )}
          {field("minAmount").visible && (
            <SettingField label={`${field("minAmount").label}${field("minAmount").required ? " *" : ""}`}>
              <Input
                name="minAmount"
                type="number"
                min="0"
                defaultValue={rule?.minAmount || 0}
                required={field("minAmount").required}
              />
            </SettingField>
          )}
          {field("maxAmount").visible && (
            <SettingField
              label={`${field("maxAmount").label}${field("maxAmount").required ? " *" : ""}`}
              help="Leave blank for no limit"
            >
              <Input
                name="maxAmount"
                type="number"
                min="0"
                defaultValue={rule?.maxAmount ?? ""}
                required={field("maxAmount").required}
              />
            </SettingField>
          )}
          {field("category").visible && (
            <SettingField label={`${field("category").label}${field("category").required ? " *" : ""}`}>
              <Select name="category" defaultValue={rule?.category || "*"}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="*">All categories</SelectItem>
                  {DEFAULT_PAYMENT_CATEGORIES.map((x) => (
                    <SelectItem value={x} key={x}>
                      {x}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingField>
          )}
          {field("project").visible && (
            <SettingField
              label={`${field("project").label}${field("project").required ? " *" : ""}`}
              help="Uses Settings > Manage Project"
            >
              <Select
                name="project"
                value={selectedProject}
                onValueChange={setSelectedProject}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All global projects" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="*">All projects</SelectItem>
                  {activeProjects.map((project) => (
                    <SelectItem value={project.id} key={project.id}>
                      {project.projectName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingField>
          )}
          <div className="sm:col-span-2">
            <SettingField
              label={
                rule?.mode === "Parallel"
                  ? field("approvers").label
                  : `${field("approvers").label} in sequence`
              }
              help="For sequential rules, selection order is the approval order."
            >
              <div className="max-h-48 space-y-2 overflow-y-auto rounded-lg border p-3">
                {users
                  .filter((user) => user.status === "Active")
                  .map((item) => (
                    <label
                      key={item.id}
                      className="flex cursor-pointer items-center gap-3 rounded-md p-2 hover:bg-muted"
                    >
                      <Checkbox
                        checked={approvers.includes(item.id)}
                        onCheckedChange={(checked) =>
                          toggleApprover(item.id, checked === true)
                        }
                      />
                      <span className="text-sm">{item.name}</span>
                      {approvers.includes(item.id) && (
                        <Badge variant="outline" className="ml-auto">
                          {approvers.indexOf(item.id) + 1}
                        </Badge>
                      )}
                    </label>
                  ))}
                {!users.length && (
                  <p className="text-sm text-muted-foreground">
                    No active users are available.
                  </p>
                )}
              </div>
            </SettingField>
          </div>
          {field("accounts").visible && (
            <SettingField label={field("accounts").label}>
              <Select
                name="accounts"
                defaultValue={
                  rule?.finalAccountsVerification === false ? "no" : "yes"
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes">Required</SelectItem>
                  <SelectItem value="no">Not required</SelectItem>
                </SelectContent>
              </Select>
            </SettingField>
          )}
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {rule ? "Save changes" : "Create rule"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border p-3">
      <Label>{label}</Label>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
function SettingField({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {help && <p className="text-xs text-muted-foreground">{help}</p>}
    </div>
  );
}
function SaveButton({
  saving,
  onClick,
}: {
  saving: boolean;
  onClick: () => void;
}) {
  return (
    <Button onClick={onClick} disabled={saving}>
      {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save
      configuration
    </Button>
  );
}
