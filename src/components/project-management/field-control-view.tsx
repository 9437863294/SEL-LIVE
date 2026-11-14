"use client";

/**
 * Project Management › Settings › Field Control, from the user's mock-up
 * (`sel-pm-projects-settings`, the `v-fields` screen): the sky band with Save changes, one card for
 * the chosen form — a legend of required and visible fields, the form picker and Reset — and its
 * fields as a table of label, Required, Visible and field key.
 *
 * Props only: `field-control-settings.tsx` owns permissions and Firestore and hands this view the
 * live settings and a save callback — so the screen can be rendered with fabricated data.
 *
 * Rules: a locked field keeps its registry visibility and requirement (only its label changes); a
 * hidden field can't be required, so hiding one clears its Required switch.
 */

import { useState } from "react";
import { Loader2, Lock, RotateCcw, Save, SlidersHorizontal } from "lucide-react";
import { useBackNavigation } from "@/hooks/use-back-navigation";
import { useToast } from "@/hooks/use-toast";
import {
  PM_FORM_KEYS,
  PM_FORM_REGISTRY,
  type PMFormKey,
} from "@/lib/project-management-field-registry";
import type { PMFieldSetting } from "@/components/project-management/use-field-control";
import { HERO_PRIMARY_BUTTON, HeroBand } from "@/components/project-management/hero-band";
import {
  DprReportCallout,
  DprReportCard,
  DprReportPill,
} from "@/components/project-management/dpr/reports-parts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

/** Every form's field settings, keyed by form then field. */
export type FieldControlDraft = Record<PMFormKey, Record<string, PMFieldSetting>>;

/** Every form at the registry's defaults: visible, its default requirement and label. */
export function buildDefaultFieldControlDraft(): FieldControlDraft {
  const draft = {} as FieldControlDraft;
  for (const formKey of PM_FORM_KEYS) {
    draft[formKey] = {};
    for (const field of PM_FORM_REGISTRY[formKey].fields) {
      draft[formKey][field.key] = { visible: true, required: field.defaultRequired, label: field.defaultLabel };
    }
  }
  return draft;
}

export interface FieldControlViewProps {
  /** The settings as stored (merged over the defaults). A new value replaces the edits. */
  initialDraft: FieldControlDraft;
  canEdit: boolean;
  /** Writes every form's settings; throws when the save fails. */
  onSave: (draft: FieldControlDraft) => Promise<void>;
  initialForm?: PMFormKey;
}

const SWITCH_REQUIRED =
  "data-[state=checked]:bg-gradient-to-br data-[state=checked]:from-rose-400 data-[state=checked]:to-rose-600";
const SWITCH_VISIBLE =
  "data-[state=checked]:bg-gradient-to-br data-[state=checked]:from-sky-400 data-[state=checked]:to-sky-600";

const SKY = ["#7dd3fc", "#0284c7"] as const;

export function FieldControlView({ initialDraft, canEdit, onSave, initialForm = "boqAdd" }: FieldControlViewProps) {
  const { toast } = useToast();
  const back = useBackNavigation("/project-management/settings", { fallbackLabel: "Settings" });
  const [activeForm, setActiveForm] = useState<PMFormKey>(initialForm);

  // A fresh snapshot replaces the draft, as the screen always did.
  const [source, setSource] = useState(initialDraft);
  const [draft, setDraft] = useState<FieldControlDraft>(initialDraft);
  if (source !== initialDraft) {
    setSource(initialDraft);
    setDraft(initialDraft);
  }
  const [saving, setSaving] = useState(false);

  const update = (formKey: PMFormKey, fieldKey: string, patch: Partial<PMFieldSetting>) =>
    setDraft((current) => ({
      ...current,
      [formKey]: { ...current[formKey], [fieldKey]: { ...current[formKey][fieldKey], ...patch } },
    }));

  const resetForm = (formKey: PMFormKey) =>
    setDraft((current) => ({ ...current, [formKey]: buildDefaultFieldControlDraft()[formKey] }));

  const save = async () => {
    if (!canEdit) return;
    setSaving(true);
    try {
      await onSave(draft);
      toast({ title: "Field control saved" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      toast({ title: "Error", description: message || "Field control could not be saved.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const formDef = PM_FORM_REGISTRY[activeForm];
  const formState = draft[activeForm] || {};
  const rows = formDef.fields.map((field) => ({
    field,
    setting: formState[field.key] || { visible: true, required: field.defaultRequired, label: field.defaultLabel },
  }));
  const requiredCount = rows.filter(({ setting }) => setting.visible && setting.required).length;
  const visibleCount = rows.filter(({ setting }) => setting.visible).length;

  return (
    <div className="space-y-4">
      <HeroBand
        band="sky"
        back={back}
        icon={SlidersHorizontal}
        crumbs={[
          { label: "Project Management", href: "/project-management" },
          { label: "Settings", href: "/project-management/settings" },
        ]}
        title="Field Control"
        description="Choose which fields appear, whether they're required, and what they're called — per form."
        actions={
          canEdit ? (
            <Button onClick={() => void save()} disabled={saving} className={HERO_PRIMARY_BUTTON}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Save changes
            </Button>
          ) : null
        }
      />

      {!canEdit ? (
        <DprReportCallout tone="warning" title="You have view-only access to Field Control">
          Ask your administrator for “Manage Field Control” permission to make changes.
        </DprReportCallout>
      ) : null}

      <DprReportCard
        icon={SlidersHorizontal}
        colours={SKY}
        title={formDef.title}
        subtitle={formDef.description}
        aside={
          <>
            <span className="flex flex-wrap items-center gap-3 text-xs font-bold text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <i className="h-2.5 w-2.5 rounded-[3px]" style={{ backgroundColor: "#e11d48" }} aria-hidden="true" />
                Required <b className="tabular-nums text-foreground">{requiredCount}</b>
              </span>
              <span className="flex items-center gap-1.5">
                <i className="h-2.5 w-2.5 rounded-[3px]" style={{ backgroundColor: "#0284c7" }} aria-hidden="true" />
                Visible <b className="tabular-nums text-foreground">{visibleCount}</b>
              </span>
            </span>
            <Select value={activeForm} onValueChange={(value) => setActiveForm(value as PMFormKey)}>
              <SelectTrigger className="h-9 w-full min-w-0 text-left sm:w-56" aria-label="Form">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PM_FORM_KEYS.map((key) => (
                  <SelectItem value={key} key={key}>
                    {PM_FORM_REGISTRY[key].title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {canEdit ? (
              <Button variant="outline" size="sm" className="h-9" onClick={() => resetForm(activeForm)}>
                <RotateCcw className="mr-2 h-3.5 w-3.5" />
                Reset
              </Button>
            ) : null}
          </>
        }
      >
        <Table stickyHeader containerClassName="max-h-[65vh]" className="min-w-[760px] table-fixed">
          <colgroup>
            <col className="w-[300px]" />
            <col className="w-[120px]" />
            <col className="w-[120px]" />
            <col />
          </colgroup>
          <TableHeader>
            <TableRow>
              <TableHead className="truncate">Label</TableHead>
              <TableHead className="truncate text-center">Required</TableHead>
              <TableHead className="truncate text-center">Visible</TableHead>
              <TableHead className="truncate">Field key</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ field, setting }) => {
              const renamed = setting.label !== field.defaultLabel;
              const locked = Boolean(field.locked);
              return (
                <TableRow key={field.key} className={cn(locked && "bg-muted/30")}>
                  <TableCell className="py-1.5">
                    <Input
                      aria-label={`Label for ${field.key}`}
                      className={cn("h-9 w-full min-w-0", renamed && "border-amber-200 bg-amber-50")}
                      title={renamed ? `Renamed from "${field.defaultLabel}"` : undefined}
                      value={setting.label}
                      disabled={!canEdit}
                      onChange={(event) => update(activeForm, field.key, { label: event.target.value })}
                    />
                  </TableCell>
                  <TableCell className="py-1.5 text-center">
                    <span
                      className="inline-flex"
                      title={
                        locked
                          ? "Locked by the form's own logic"
                          : !setting.visible
                            ? "Hidden fields cannot be required"
                            : undefined
                      }
                    >
                      <Switch
                        checked={setting.visible && setting.required}
                        disabled={!canEdit || locked || !setting.visible}
                        className={SWITCH_REQUIRED}
                        aria-label={`${field.key} required`}
                        onCheckedChange={(value) => update(activeForm, field.key, { required: value })}
                      />
                    </span>
                  </TableCell>
                  <TableCell className="py-1.5 text-center">
                    <span className="inline-flex" title={locked ? "Locked by the form's own logic" : undefined}>
                      <Switch
                        checked={setting.visible}
                        disabled={!canEdit || locked}
                        className={SWITCH_VISIBLE}
                        aria-label={`${field.key} visible`}
                        onCheckedChange={(value) =>
                          // A hidden field can't be required.
                          update(activeForm, field.key, value ? { visible: true } : { visible: false, required: false })
                        }
                      />
                    </span>
                  </TableCell>
                  <TableCell className="truncate py-1.5" title={field.key}>
                    <span className="inline-block max-w-full truncate rounded-md bg-violet-50 px-2 py-0.5 align-middle font-mono text-xs font-bold text-violet-700">
                      {field.key}
                    </span>
                    {locked ? (
                      <span className="ml-2 inline-flex align-middle">
                        <DprReportPill tone="neutral">
                          <Lock className="mr-1 inline h-2.5 w-2.5 align-[-1px]" aria-hidden="true" />
                          Locked
                        </DprReportPill>
                      </span>
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </DprReportCard>

      <DprReportCallout tone="info" title="Locked fields">
        Locked fields are required by the form&apos;s own logic — for example, the Scope 1/Scope 2/BOQ SL No
        combination a BOQ item&apos;s duplicate check keys off, or a Purchase Order&apos;s vendor and dates — so
        they can&apos;t be hidden or made optional here, but their label can still be renamed. Changes apply to
        everyone using this module.
      </DprReportCallout>
    </div>
  );
}
