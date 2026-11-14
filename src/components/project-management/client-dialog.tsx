"use client";

/**
 * Create / edit a client, from the user's mock-up (`sel-pm-projects-settings`): a gradient header,
 * fields with their units written in, an orange "Flow-Down Terms" section, and checks shown as you
 * type — GSTIN and PAN shapes (upper-cased as typed), PAN matching the GSTIN's characters 3–12,
 * percentages 0–100, days and months not negative, LD rate not above the LD cap, no second client
 * of the same name, and whatever Field Control makes required.
 *
 * Props-only: the page writes the record (`onSave`) — this file has no Firestore or auth in it, so
 * it can be rendered with fabricated data.
 */

import { useMemo, useState, type ReactNode } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import type { Client } from "@/lib/types";
import { PM_FORM_REGISTRY } from "@/lib/project-management-field-registry";
import type { PMFieldSetting } from "@/components/project-management/use-field-control";
import {
  SUB_ITEM_DIALOG_CLASS,
  SUB_ITEM_DIALOG_STYLE,
  SuffixInput,
} from "@/components/project-management/dpr/sub-item-dialog-parts";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
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
import { cn } from "@/lib/utils";

export type ClientForm = {
  name: string;
  gstin: string;
  pan: string;
  address: string;
  paymentTermsDays: string;
  retentionPct: string;
  defaultTdsPct: string;
  warrantyMonths: string;
  ldRatePct: string;
  ldCapPct: string;
  performanceSecurityPct: string;
  inspectionRegime: string;
  status: "Active" | "Inactive";
};

export const emptyClientForm: ClientForm = {
  name: "",
  gstin: "",
  pan: "",
  address: "",
  paymentTermsDays: "",
  retentionPct: "",
  defaultTdsPct: "",
  warrantyMonths: "",
  ldRatePct: "",
  ldCapPct: "",
  performanceSecurityPct: "",
  inspectionRegime: "",
  status: "Active",
};

const numberText = (value: number | null | undefined) => (value != null ? String(value) : "");

export function clientToForm(client: Client): ClientForm {
  return {
    name: client.name,
    gstin: client.gstin ?? "",
    pan: client.pan ?? "",
    address: client.addresses?.[0] ?? "",
    paymentTermsDays: numberText(client.paymentTermsDays),
    retentionPct: numberText(client.retentionPct),
    defaultTdsPct: numberText(client.defaultTdsPct),
    warrantyMonths: numberText(client.warrantyMonths),
    ldRatePct: numberText(client.ldRatePct),
    ldCapPct: numberText(client.ldCapPct),
    performanceSecurityPct: numberText(client.performanceSecurityPct),
    inspectionRegime: client.inspectionRegime ?? "",
    status: client.status,
  };
}

/** The stored fields a form becomes (timestamps are the page's). Blank numbers are null, never undefined. */
export function clientFormToRecord(form: ClientForm) {
  const num = (text: string) => (text.trim() ? Number(text.trim()) : null);
  return {
    name: form.name.trim(),
    gstin: form.gstin.trim(),
    pan: form.pan.trim(),
    addresses: form.address.trim() ? [form.address.trim()] : [],
    paymentTermsDays: num(form.paymentTermsDays),
    retentionPct: num(form.retentionPct),
    defaultTdsPct: num(form.defaultTdsPct),
    warrantyMonths: num(form.warrantyMonths),
    ldRatePct: num(form.ldRatePct),
    ldCapPct: num(form.ldCapPct),
    performanceSecurityPct: num(form.performanceSecurityPct),
    inspectionRegime: form.inspectionRegime.trim(),
    status: form.status,
  };
}

const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const PERCENT_KEYS = ["retentionPct", "defaultTdsPct", "ldRatePct", "ldCapPct", "performanceSecurityPct"] as const;
const COUNT_KEYS = ["paymentTermsDays", "warrantyMonths"] as const;

type ClientFormErrors = Partial<Record<keyof ClientForm, string>>;

/**
 * Every problem with a form, by field. `live` problems (shapes, ranges, a clash) show as typed;
 * `required` ones only once Save has been pressed.
 */
export function checkClientForm(
  form: ClientForm,
  context: { otherNames: readonly string[]; fieldControl: (key: string) => PMFieldSetting },
): { live: ClientFormErrors; required: ClientFormErrors } {
  const live: ClientFormErrors = {};
  const required: ClientFormErrors = {};
  const name = form.name.trim();
  if (!name) required.name = "Enter the client name.";
  else if (context.otherNames.includes(name.toLowerCase())) live.name = `A client named "${name}" already exists.`;

  const gstin = form.gstin.trim();
  const pan = form.pan.trim();
  if (gstin && !GSTIN_PATTERN.test(gstin)) live.gstin = "GSTIN should be 15 characters, e.g. 21ABCDE1234F1Z5.";
  if (pan && !PAN_PATTERN.test(pan)) live.pan = "PAN should be 10 characters, e.g. ABCDE1234F.";
  else if (pan && gstin && GSTIN_PATTERN.test(gstin) && gstin.slice(2, 12) !== pan) {
    live.pan = "PAN doesn't match characters 3–12 of the GSTIN.";
  }

  for (const key of PERCENT_KEYS) {
    const text = form[key].trim();
    if (!text) continue;
    const value = Number(text);
    if (!Number.isFinite(value) || value < 0 || value > 100) live[key] = "Enter 0–100.";
  }
  for (const key of COUNT_KEYS) {
    const text = form[key].trim();
    if (!text) continue;
    const value = Number(text);
    if (!Number.isFinite(value) || value < 0) live[key] = "Enter a number, 0 or more.";
  }
  if (!live.ldRatePct && !live.ldCapPct && form.ldRatePct.trim() && form.ldCapPct.trim()) {
    if (Number(form.ldRatePct) > Number(form.ldCapPct)) live.ldRatePct = "LD rate is above the LD cap.";
  }

  // Field Control's required fields — the same rule as validateFieldControlRequirements, kept per
  // field so each message sits under its own box. Locked fields are the form's own (the name, above).
  for (const def of PM_FORM_REGISTRY.clientMaster.fields) {
    if (def.locked || !(def.key in form)) continue;
    const setting = context.fieldControl(def.key);
    if (!setting.visible || !setting.required) continue;
    const key = def.key as keyof ClientForm;
    if (!String(form[key] ?? "").trim()) required[key] = `${setting.label} is required.`;
  }
  return { live, required };
}

type TextKey = Exclude<keyof ClientForm, "status">;

/**
 * A dialog whose header is a coloured band: the dialog's own window buttons and × sit on it in
 * white (the same override as GstTdsVerificationDialog's `BANNER_DIALOG_CLASS`).
 */
const BANNER_DIALOG_CLASS =
  "[&_[data-slot=dialog-close]]:text-white [&_[data-slot=dialog-close]]:opacity-90 [&_[data-slot=dialog-close]]:data-[state=open]:bg-transparent [&_[data-slot=dialog-close]]:data-[state=open]:text-white [&_[data-slot=dialog-window-controls]]:text-white";

const HEADER_BAND = {
  backgroundImage:
    "radial-gradient(300px 140px at 100% 0%, rgba(244, 114, 182, 0.5), transparent 70%), linear-gradient(120deg, #312e81, #4f46e5 55%, #7c3aed)",
} as const;

export function ClientDialog({
  open,
  client,
  otherNames,
  fieldControl,
  onClose,
  onSave,
}: {
  open: boolean;
  /** The client being edited, or null for a new one. */
  client: Client | null;
  /** Lower-cased names of every other client, for the duplicate check. */
  otherNames: readonly string[];
  fieldControl: (key: string) => PMFieldSetting;
  onClose: () => void;
  /** Writes the client; resolves true when it saved (the dialog then closes). */
  onSave: (form: ClientForm) => Promise<boolean>;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? onClose() : undefined)}>
      {open ? (
        <ClientDialogBody
          key={client?.id ?? "new"}
          client={client}
          otherNames={otherNames}
          fieldControl={fieldControl}
          onClose={onClose}
          onSave={onSave}
        />
      ) : null}
    </Dialog>
  );
}

function ClientDialogBody({
  client,
  otherNames,
  fieldControl,
  onClose,
  onSave,
}: {
  client: Client | null;
  otherNames: readonly string[];
  fieldControl: (key: string) => PMFieldSetting;
  onClose: () => void;
  onSave: (form: ClientForm) => Promise<boolean>;
}) {
  const [form, setForm] = useState<ClientForm>(() => (client ? clientToForm(client) : emptyClientForm));
  const [attempted, setAttempted] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const check = useMemo(() => checkClientForm(form, { otherNames, fieldControl }), [form, otherNames, fieldControl]);
  const shown: ClientFormErrors = attempted ? { ...check.required, ...check.live } : check.live;
  const blocked = Object.keys(check.live).length > 0;

  const set = (key: TextKey, value: string) => setForm((current) => ({ ...current, [key]: value }));

  const save = async () => {
    setAttempted(true);
    if (Object.keys(check.live).length > 0 || Object.keys(check.required).length > 0) return;
    setIsSaving(true);
    try {
      if (await onSave(form)) onClose();
    } finally {
      setIsSaving(false);
    }
  };

  /** One field, as Field Control has it (hidden, required, renamed), with its message under it. */
  const field = (key: keyof ClientForm, input: (invalid: boolean) => ReactNode, className?: string) => {
    const setting = fieldControl(key);
    if (!setting.visible) return null;
    const error = shown[key];
    return (
      <div className={cn("min-w-0 space-y-1.5", className)}>
        <Label htmlFor={`client-${key}`} className="text-xs font-extrabold text-muted-foreground">
          {setting.label}
          {setting.required ? <span className="text-destructive"> *</span> : null}
        </Label>
        {input(Boolean(error))}
        {error ? (
          <p id={`client-${key}-error`} className="text-[11.5px] font-bold text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    );
  };
  const invalidClass = (invalid: boolean) => (invalid ? "border-rose-300 bg-rose-50" : undefined);
  const text = (key: TextKey, placeholder?: string) =>
    field(key, (invalid) => (
      <Input
        id={`client-${key}`}
        value={form[key]}
        placeholder={placeholder}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `client-${key}-error` : undefined}
        className={invalidClass(invalid)}
        onChange={(event) => set(key, event.target.value)}
      />
    ));
  const code = (key: "gstin" | "pan", placeholder: string, maxLength: number) =>
    field(key, (invalid) => (
      <Input
        id={`client-${key}`}
        value={form[key]}
        placeholder={placeholder}
        maxLength={maxLength}
        autoCapitalize="characters"
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `client-${key}-error` : undefined}
        className={cn("font-semibold uppercase tracking-wide", invalidClass(invalid))}
        // Upper-cased and spaces dropped as typed, so a pasted "21 abcde…" still checks.
        onChange={(event) => set(key, event.target.value.toUpperCase().replace(/\s/g, ""))}
      />
    ));
  const amount = (key: TextKey, suffix: string) =>
    field(key, (invalid) => (
      <SuffixInput
        id={`client-${key}`}
        suffix={suffix}
        inputMode="decimal"
        value={form[key]}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `client-${key}-error` : undefined}
        className={invalidClass(invalid)}
        onChange={(event) => set(key, event.target.value)}
      />
    ));

  return (
    <DialogContent
      size="lg"
      className={cn(SUB_ITEM_DIALOG_CLASS, BANNER_DIALOG_CLASS, "sm:max-w-[40rem]")}
      style={SUB_ITEM_DIALOG_STYLE}
    >
      <DialogHeader className="keep-light shrink-0 px-5 pb-4 pt-5 text-left text-white sm:px-6" style={HEADER_BAND}>
        <DialogTitle className="pr-6 text-[19px] font-extrabold sm:pr-24">
          {client ? "Edit Client" : "Create Client"}
        </DialogTitle>
        <DialogDescription className="text-indigo-100">
          Clients are the paying customer for one or more projects — contract terms like retention and payment
          terms can default from here.
        </DialogDescription>
      </DialogHeader>

      <DialogBody className="mx-0 space-y-4 px-5 py-4 sm:px-6">
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          {field(
            "name",
            (invalid) => (
              <Input
                id="client-name"
                autoFocus
                value={form.name}
                placeholder="e.g. Power Grid Corporation"
                aria-invalid={invalid || undefined}
                aria-describedby={invalid ? "client-name-error" : undefined}
                className={invalidClass(invalid)}
                onChange={(event) => set("name", event.target.value)}
              />
            ),
            "sm:col-span-2",
          )}
          {code("gstin", "15-character GSTIN", 15)}
          {code("pan", "10-character PAN", 10)}
          <div className="sm:col-span-2">{text("address")}</div>
        </div>

        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
          {amount("paymentTermsDays", "days")}
          {amount("retentionPct", "%")}
          {amount("defaultTdsPct", "%")}
        </div>

        <div className="flex items-center gap-2.5 rounded-[14px] border border-orange-200 bg-gradient-to-r from-orange-50 to-transparent px-3.5 py-3">
          <span
            className="keep-light flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[10px] text-white"
            style={{ backgroundImage: "linear-gradient(135deg, #fdba74, #ea580c)" }}
            aria-hidden="true"
          >
            <ShieldCheck className="h-[15px] w-[15px]" />
          </span>
          <div className="min-w-0">
            <b className="block text-[13px]">Flow-Down Terms</b>
            <small className="block text-[11.5px] text-muted-foreground">
              What this client&apos;s contract obligates SEL to — every purchase order is checked against these
              before issue.
            </small>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
          {amount("warrantyMonths", "months")}
          {amount("ldRatePct", "%/wk")}
          {amount("ldCapPct", "%")}
        </div>
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          {amount("performanceSecurityPct", "%")}
          {text("inspectionRegime", "e.g. Client inspection at works, 15-day notice")}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="client-status" className="text-xs font-extrabold text-muted-foreground">
            Status
          </Label>
          <Select
            value={form.status}
            onValueChange={(status: "Active" | "Inactive") => setForm((current) => ({ ...current, status }))}
          >
            <SelectTrigger id="client-status" className="text-left">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Active">Active</SelectItem>
              <SelectItem value="Inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </DialogBody>

      <DialogFooter className="justify-end gap-2 border-t border-border/60 bg-muted/40 px-5 py-3 sm:items-center sm:space-x-0 sm:px-6">
        <Button variant="outline" onClick={onClose} disabled={isSaving}>
          Cancel
        </Button>
        <Button onClick={() => void save()} disabled={isSaving || blocked}>
          {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {client ? "Save changes" : "Create Client"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
