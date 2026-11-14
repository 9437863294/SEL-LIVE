"use client";

/**
 * Project Management › Settings › BOQ Column Settings, from the user's mock-up
 * (`sel-pm-projects-settings`, the `v-boq` screen): the purple band with Scan Imports and Save
 * Columns, an "Add Dynamic Column" card, and the column register as a table — order, stored key,
 * display label, validation type, and one switch per BOQ view.
 *
 * Props only: the page (`settings/boq/page.tsx`) owns permissions and Firestore, and hands this
 * view the loaded columns and async callbacks — so the screen can be rendered with fabricated data.
 * Edits stay local until Save Columns, as before; the built-in columns can't be removed.
 */

import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ClipboardList,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Trash2,
} from "lucide-react";
import { useBackNavigation } from "@/hooks/use-back-navigation";
import { useToast } from "@/hooks/use-toast";
import {
  DEFAULT_BOQ_COLUMNS,
  type BoqColumnConfig,
  type BoqColumnDataType,
} from "@/lib/project-management-boq-columns";
import {
  HERO_PRIMARY_BUTTON,
  HERO_SECONDARY_BUTTON,
  HeroBand,
} from "@/components/project-management/hero-band";
import { DprReportCallout, DprReportCard } from "@/components/project-management/dpr/reports-parts";
import { Button } from "@/components/ui/button";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export interface BoqColumnSettingsViewProps {
  /** The columns as loaded (saved settings merged with headers found in imports). */
  initialColumns: BoqColumnConfig[];
  canEdit: boolean;
  /** Writes the whole list; throws when the save fails. */
  onSave: (columns: BoqColumnConfig[]) => Promise<void>;
  /** Looks for headers in imported BOQ items and returns `columns` with any new ones added. */
  onScanImports?: (columns: BoqColumnConfig[]) => Promise<BoqColumnConfig[]>;
}

const DATA_TYPES: Array<{ value: BoqColumnDataType; label: string }> = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "percentage", label: "Percentage (0–100)" },
  { value: "date", label: "Date" },
  { value: "yesno", label: "Yes/No" },
];

const BUILT_IN_KEYS = new Set(DEFAULT_BOQ_COLUMNS.map((column) => column.key));

/** The two views' switches, each in its own colour when on. */
const SWITCH_COSTING =
  "data-[state=checked]:bg-gradient-to-br data-[state=checked]:from-amber-400 data-[state=checked]:to-amber-600";
const SWITCH_OPERATIONAL =
  "data-[state=checked]:bg-gradient-to-br data-[state=checked]:from-emerald-400 data-[state=checked]:to-emerald-600";

const PURPLE = ["#d8b4fe", "#9333ea"] as const;

/** Columns in their saved shape: `order` follows position. */
const normalise = (columns: readonly BoqColumnConfig[]) => columns.map((column, order) => ({ ...column, order }));

export function BoqColumnSettingsView({ initialColumns, canEdit, onSave, onScanImports }: BoqColumnSettingsViewProps) {
  const { toast } = useToast();
  const back = useBackNavigation("/project-management/settings", { fallbackLabel: "Settings" });

  // A new load replaces the edits, as the page did when it reloaded.
  const [source, setSource] = useState(initialColumns);
  const [columns, setColumns] = useState<BoqColumnConfig[]>(initialColumns);
  const [savedJson, setSavedJson] = useState(() => JSON.stringify(normalise(initialColumns)));
  if (source !== initialColumns) {
    setSource(initialColumns);
    setColumns(initialColumns);
    setSavedJson(JSON.stringify(normalise(initialColumns)));
  }

  const [newKey, setNewKey] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newDataType, setNewDataType] = useState<BoqColumnDataType>("text");
  const [isSaving, setIsSaving] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  /** Remove takes two clicks: the first arms the button, the second removes. */
  const [armedKey, setArmedKey] = useState<string | null>(null);
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (armTimer.current) clearTimeout(armTimer.current);
  }, []);

  const dirty = JSON.stringify(normalise(columns)) !== savedJson;
  const costingCount = columns.filter((column) => column.showInCosting).length;
  const operationalCount = columns.filter((column) => column.showInOperational).length;

  const updateColumn = (key: string, changes: Partial<BoqColumnConfig>) =>
    setColumns((current) => current.map((column) => (column.key === key ? { ...column, ...changes } : column)));

  const moveColumn = (index: number, direction: -1 | 1) =>
    setColumns((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const reordered = [...current];
      [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
      return normalise(reordered);
    });

  const addColumn = () => {
    const key = newKey.trim();
    if (!key) return;
    if (columns.some((column) => column.key.toLowerCase() === key.toLowerCase())) {
      toast({
        title: "Column already exists",
        description: "Use the existing row to configure this column.",
        variant: "destructive",
      });
      return;
    }
    setColumns((current) => [
      ...current,
      {
        key,
        label: newLabel.trim() || key,
        dataType: newDataType,
        showInCosting: false,
        showInOperational: false,
        order: current.length,
      },
    ]);
    setNewKey("");
    setNewLabel("");
    setNewDataType("text");
    toast({ title: `${key} added`, description: "Hidden in both views until you switch one on. Save Columns to keep it." });
  };

  const removeColumn = (key: string) => {
    if (armedKey !== key) {
      setArmedKey(key);
      if (armTimer.current) clearTimeout(armTimer.current);
      armTimer.current = setTimeout(() => setArmedKey(null), 2500);
      return;
    }
    setArmedKey(null);
    setColumns((current) => normalise(current.filter((column) => column.key !== key)));
  };

  const scanImports = async () => {
    if (!onScanImports) return;
    setIsScanning(true);
    try {
      const next = await onScanImports(columns);
      const added = next.length - columns.length;
      setColumns(next);
      toast({
        title: added ? `${added} imported column${added === 1 ? "" : "s"} found` : "Columns are up to date",
      });
    } catch (error) {
      console.error("Failed to discover BOQ columns:", error);
      toast({ title: "Unable to scan imported columns", variant: "destructive" });
    } finally {
      setIsScanning(false);
    }
  };

  const save = async () => {
    if (!canEdit) return;
    setIsSaving(true);
    try {
      const next = normalise(columns);
      await onSave(next);
      setSavedJson(JSON.stringify(next));
      toast({ title: "BOQ column configuration saved" });
    } catch (error) {
      console.error("Failed to save BOQ column settings:", error);
      toast({ title: "Unable to save BOQ columns", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const discard = () => {
    setColumns(JSON.parse(savedJson) as BoqColumnConfig[]);
    setArmedKey(null);
  };

  const saveButton = (className: string) => (
    <Button onClick={() => void save()} disabled={!canEdit || isSaving} className={className}>
      {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
      Save Columns
    </Button>
  );

  return (
    <div className="space-y-4">
      <HeroBand
        band="purple"
        back={back}
        icon={ClipboardList}
        crumbs={[
          { label: "Project Management", href: "/project-management" },
          { label: "Settings", href: "/project-management/settings" },
        ]}
        title="BOQ Column Settings"
        description="Configure labels, validation data types, order, and visibility for both BOQ views."
        actions={
          <>
            {onScanImports ? (
              <Button onClick={() => void scanImports()} disabled={isScanning} className={HERO_SECONDARY_BUTTON}>
                {isScanning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                Scan Imports
              </Button>
            ) : null}
            {saveButton(HERO_PRIMARY_BUTTON)}
          </>
        }
      />

      {!canEdit ? (
        <DprReportCallout tone="info" title="You can view these columns but not change them">
          Ask for the Edit action on Project Management.Settings to add, reorder or switch columns.
        </DprReportCallout>
      ) : null}

      <DprReportCard
        icon={Plus}
        colours={PURPLE}
        title="Add Dynamic Column"
        subtitle="The column key must exactly match the Excel header or stored BOQ field."
      >
        <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_220px_auto] lg:items-end">
          <div className="space-y-1.5">
            <div className="flex h-6 items-center">
              <Label htmlFor="column-key">
                Column key <span className="text-rose-600">*</span>
              </Label>
            </div>
            <Input
              id="column-key"
              placeholder="For example: Drawing No"
              value={newKey}
              onChange={(event) => setNewKey(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") addColumn();
              }}
              disabled={!canEdit}
            />
          </div>
          <div className="space-y-1.5">
            <div className="flex h-6 items-center">
              <Label htmlFor="column-label">Display label</Label>
            </div>
            <Input
              id="column-label"
              placeholder="Optional custom label"
              value={newLabel}
              onChange={(event) => setNewLabel(event.target.value)}
              disabled={!canEdit}
            />
          </div>
          <div className="space-y-1.5">
            <div className="flex h-6 items-center">
              <Label htmlFor="column-data-type">Validation data type</Label>
            </div>
            <Select
              value={newDataType}
              onValueChange={(dataType: BoqColumnDataType) => setNewDataType(dataType)}
              disabled={!canEdit}
            >
              <SelectTrigger id="column-data-type" className="text-left">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DATA_TYPES.map((type) => (
                  <SelectItem key={type.value} value={type.value}>
                    {type.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            onClick={addColumn}
            disabled={!canEdit || !newKey.trim()}
            className="keep-light rounded-xl font-extrabold text-white shadow-md"
            style={{ backgroundImage: "linear-gradient(135deg, #a855f7, #7c3aed)" }}
          >
            <Plus className="mr-2 h-4 w-4" />
            Add Column
          </Button>
        </div>
      </DprReportCard>

      <DprReportCard
        icon={ClipboardList}
        colours={PURPLE}
        title="BOQ Columns"
        subtitle="Data types are applied during BOQ import validation. Imported headers stay hidden until enabled."
        aside={
          <span className="flex flex-wrap items-center gap-3.5 text-xs font-bold text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <i
                className="h-2.5 w-2.5 rounded-[3px]"
                style={{ backgroundImage: "linear-gradient(135deg, #fbbf24, #d97706)" }}
                aria-hidden="true"
              />
              BOQ Costing <b className="tabular-nums text-foreground">{costingCount}</b>
            </span>
            <span className="flex items-center gap-1.5">
              <i
                className="h-2.5 w-2.5 rounded-[3px]"
                style={{ backgroundImage: "linear-gradient(135deg, #34d399, #059669)" }}
                aria-hidden="true"
              />
              Operational BOQ <b className="tabular-nums text-foreground">{operationalCount}</b>
            </span>
          </span>
        }
      >
        <Table stickyHeader containerClassName="max-h-[65vh]" className="min-w-[1080px] table-fixed">
          <colgroup>
            <col className="w-[124px]" />
            <col className="w-[220px]" />
            <col />
            <col className="w-[210px]" />
            <col className="w-[124px]" />
            <col className="w-[140px]" />
            <col className="w-[84px]" />
          </colgroup>
          <TableHeader>
            <TableRow>
              <TableHead className="truncate">Order</TableHead>
              <TableHead className="truncate">Stored key</TableHead>
              <TableHead className="truncate">Display label</TableHead>
              <TableHead className="truncate">Validation type</TableHead>
              <TableHead className="truncate text-center">BOQ Costing</TableHead>
              <TableHead className="truncate text-center">Operational BOQ</TableHead>
              <TableHead className="truncate text-right">Remove</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {columns.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                  No columns yet. Add one above, or scan the imported BOQ headers.
                </TableCell>
              </TableRow>
            ) : (
              columns.map((column, index) => {
                const builtIn = BUILT_IN_KEYS.has(column.key);
                const armed = armedKey === column.key;
                const renamed = column.label !== column.key;
                return (
                  <TableRow key={column.key}>
                    <TableCell className="py-1.5">
                      <span className="flex items-center gap-1">
                        <b className="w-6 text-center text-xs tabular-nums text-muted-foreground">{index + 1}</b>
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-7 w-7 rounded-lg"
                          onClick={() => moveColumn(index, -1)}
                          disabled={!canEdit || index === 0}
                          aria-label={`Move ${column.label} up`}
                          title="Move up"
                        >
                          <ArrowUp className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-7 w-7 rounded-lg"
                          onClick={() => moveColumn(index, 1)}
                          disabled={!canEdit || index === columns.length - 1}
                          aria-label={`Move ${column.label} down`}
                          title="Move down"
                        >
                          <ArrowDown className="h-3.5 w-3.5" />
                        </Button>
                      </span>
                    </TableCell>
                    <TableCell className="py-1.5" title={column.key}>
                      <span className="inline-block max-w-full truncate rounded-md bg-violet-50 px-2 py-0.5 align-middle font-mono text-xs font-bold text-violet-700">
                        {column.key}
                      </span>
                    </TableCell>
                    <TableCell className="py-1.5">
                      <Input
                        aria-label={`Display label for ${column.key}`}
                        className={cn("h-9 w-full min-w-0", renamed && "border-amber-200 bg-amber-50")}
                        title={renamed ? `Shown as "${column.label}" — stored as "${column.key}"` : undefined}
                        value={column.label}
                        onChange={(event) => updateColumn(column.key, { label: event.target.value })}
                        disabled={!canEdit}
                      />
                    </TableCell>
                    <TableCell className="py-1.5">
                      <Select
                        value={column.dataType}
                        onValueChange={(dataType: BoqColumnDataType) => updateColumn(column.key, { dataType })}
                        disabled={!canEdit}
                      >
                        <SelectTrigger className="h-9 text-left" aria-label={`Validation type for ${column.label}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {DATA_TYPES.map((type) => (
                            <SelectItem key={type.value} value={type.value}>
                              {type.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="py-1.5 text-center">
                      <Switch
                        checked={column.showInCosting}
                        onCheckedChange={(showInCosting) => updateColumn(column.key, { showInCosting })}
                        disabled={!canEdit}
                        className={SWITCH_COSTING}
                        aria-label={`Show ${column.label} in BOQ Costing`}
                      />
                    </TableCell>
                    <TableCell className="py-1.5 text-center">
                      <Switch
                        checked={column.showInOperational}
                        onCheckedChange={(showInOperational) => updateColumn(column.key, { showInOperational })}
                        disabled={!canEdit}
                        className={SWITCH_OPERATIONAL}
                        aria-label={`Show ${column.label} in Operational BOQ`}
                      />
                    </TableCell>
                    <TableCell className="py-1.5 text-right">
                      <Button
                        variant="outline"
                        size="icon"
                        className={cn(
                          "h-8 w-8 rounded-[10px] text-rose-600",
                          armed && "keep-light border-rose-600 bg-rose-600 text-white hover:bg-rose-700 hover:text-white",
                        )}
                        onClick={() => removeColumn(column.key)}
                        disabled={!canEdit || builtIn}
                        aria-label={armed ? `Click again to remove ${column.label}` : `Remove ${column.label}`}
                        title={
                          builtIn
                            ? "A built-in column can't be removed — switch it off instead"
                            : armed
                              ? "Click again to remove"
                              : "Remove"
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </DprReportCard>

      {canEdit && dirty ? (
        // Save Columns is the page's only save and the list runs long: keep it in reach once
        // something has changed.
        <div
          className="keep-light sticky bottom-4 z-10 flex flex-wrap items-center gap-2.5 rounded-2xl px-4 py-3 font-bold text-white shadow-lg"
          style={{ backgroundColor: "#1e1b4b" }}
        >
          <span className="text-sm">Unsaved changes</span>
          <span className="flex-1" />
          <Button variant="outline" onClick={discard} disabled={isSaving} className={HERO_SECONDARY_BUTTON}>
            <RotateCcw className="mr-2 h-4 w-4" />
            Discard
          </Button>
          {saveButton(HERO_PRIMARY_BUTTON)}
        </div>
      ) : null}
    </div>
  );
}
