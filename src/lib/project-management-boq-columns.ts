export const BOQ_COLUMN_SETTINGS_COLLECTION = "projectManagementSettings";
export const BOQ_COLUMN_SETTINGS_DOC = "boqColumns";

export type BoqColumnDataType = "text" | "number" | "percentage" | "date" | "yesno";

export type BoqColumnConfig = {
  key: string;
  label: string;
  dataType: BoqColumnDataType;
  showInCosting: boolean;
  showInOperational: boolean;
  order: number;
};

// The supply gate chain (see src/lib/supply-gates.ts) — each column is a live aggregate from that
// stage's own collection, keyed by boqItemId, same convention as Indent Qty/PO Qty/MDL Status.
// "Material Acceptance Qty" (not "MVAC Qty") deliberately avoids colliding with the unrelated
// "JMC/MVAC" quantity-certification columns already on this page (Billing Recon's MVAC, a
// different concept entirely — see the module note in supply-gates.ts).
const SUPPLY_GATE_COLUMN_KEYS = [
  "MC Status",
  "Inspection Accepted Qty",
  "MDCC Status",
  "DI Dispatch Qty",
  "GRN Accepted Qty",
  "Material Acceptance Qty",
];

const costingDefaults = new Set([
  "BOQ SL No",
  "ERP SL NO",
  "Description",
  "Unit",
  "QTY",
  "Unit Rate",
  "JMC/MVAC Executed Qty",
  "JMC/MVAC Certified Qty",
  "JMC/MVAC Amount",
  "Indent Qty",
  "PO Qty",
  ...SUPPLY_GATE_COLUMN_KEYS,
  "Total Amount",
  "Budget Price",
  "F&I %",
  "F&I Price",
  "Total Budget Price",
  "Start Date",
  "End Date",
  "MDL",
  "MDL Status",
  "Inspection Required",
]);

const operationalDefaults = new Set([
  "BOQ SL No",
  "Description",
  "Unit",
  "QTY",
  "JMC/MVAC Executed Qty",
  "JMC/MVAC Certified Qty",
  "Indent Qty",
  "PO Qty",
  "Start Date",
  "End Date",
  "MDL",
  "MDL Status",
  "Inspection Required",
]);

const standardColumnKeys = [
  "Project Name",
  "Sub-Division",
  "Site",
  "Scope 1",
  "Scope 2",
  "Category 1",
  "Category 2",
  "Category 3",
  "ERP SL NO",
  "BOQ SL No",
  "Description",
  "Unit",
  "QTY",
  "Unit Rate",
  "Total Amount",
  "JMC/MVAC Executed Qty",
  "JMC/MVAC Certified Qty",
  "JMC/MVAC Amount",
  "Indent Qty",
  "PO Qty",
  ...SUPPLY_GATE_COLUMN_KEYS,
  "Budget Price",
  "F&I %",
  "F&I Price",
  "Total Budget Price",
  "Start Date",
  "End Date",
  "MDL",
  "MDL Status",
  "Inspection Required",
];

const numberColumnKeys = new Set([
  "QTY",
  "Unit Rate",
  "Total Amount",
  "JMC/MVAC Executed Qty",
  "JMC/MVAC Certified Qty",
  "JMC/MVAC Amount",
  "Indent Qty",
  "PO Qty",
  "Budget Price",
  "F&I Price",
  "Total Budget Price",
]);

const dateColumnKeys = new Set(["Start Date", "End Date"]);

const yesNoColumnKeys = new Set(["MDL", "Inspection Required"]);

export function getDefaultBoqColumnDataType(key: string): BoqColumnDataType {
  if (yesNoColumnKeys.has(key)) return "yesno";
  if (key === "F&I %") return "percentage";
  if (dateColumnKeys.has(key) || /(?:^|\s)date(?:$|\s)/i.test(key)) return "date";
  if (numberColumnKeys.has(key)) return "number";
  if (/(?:percentage|percent|%)/i.test(key)) return "percentage";
  if (/(?:qty|quantity|amount|rate|price|cost|value)/i.test(key)) return "number";
  return "text";
}

export function normalizeBoqColumnDataType(
  value: unknown,
  key: string,
): BoqColumnDataType {
  return value === "text" ||
    value === "number" ||
    value === "percentage" ||
    value === "date" ||
    value === "yesno"
    ? value
    : getDefaultBoqColumnDataType(key);
}

export const YES_NO_OPTIONS = ["Yes", "No"] as const;

// A BOQ "section header" row (e.g. "14  BUS BAR & CIRCUIT MATERIALS") groups the items below it
// but isn't itself an orderable line — it carries no Unit and no Qty. Inferred rather than a
// stored flag, so existing data and every BOQ-consuming view automatically recognise it.
export function isBoqSectionHeader(item: { Unit?: unknown; QTY?: unknown } | null | undefined): boolean {
  if (!item) return false;
  const hasUnit = String(item.Unit ?? "").trim().length > 0;
  if (hasUnit) return false;
  const qty = Number(String(item.QTY ?? "").replace(/,/g, "").trim());
  return !Number.isFinite(qty) || qty === 0;
}

export const DEFAULT_BOQ_COLUMNS: BoqColumnConfig[] = standardColumnKeys.map(
  (key, order) => ({
    key,
    label: key,
    dataType: getDefaultBoqColumnDataType(key),
    showInCosting: costingDefaults.has(key),
    showInOperational: operationalDefaults.has(key),
    order,
  }),
);

export const BOQ_METADATA_FIELDS = new Set([
  "id",
  "bom",
  "createdAt",
  "createdBy",
  "updatedAt",
  "updatedBy",
  "source",
  "fileName",
  "projectSlug",
]);

export function mergeBoqColumns(
  savedColumns: unknown,
  discoveredKeys: string[] = [],
): BoqColumnConfig[] {
  const source = Array.isArray(savedColumns)
    ? savedColumns
        .filter(
          (column): column is Partial<BoqColumnConfig> & { key: string } =>
            Boolean(column) &&
            typeof column === "object" &&
            typeof (column as { key?: unknown }).key === "string",
        )
        .map((column, index) => ({
          key: column.key.trim(),
          label:
            typeof column.label === "string" && column.label.trim()
              ? column.label.trim()
              : column.key.trim(),
          dataType: normalizeBoqColumnDataType(column.dataType, column.key.trim()),
          showInCosting: column.showInCosting === true,
          showInOperational: column.showInOperational === true,
          order: typeof column.order === "number" ? column.order : index,
        }))
    : DEFAULT_BOQ_COLUMNS.map((column) => ({ ...column }));

  const byKey = new Map(source.map((column) => [column.key, column]));
  for (const defaultColumn of DEFAULT_BOQ_COLUMNS) {
    if (!byKey.has(defaultColumn.key)) {
      byKey.set(defaultColumn.key, { ...defaultColumn });
    }
  }

  let nextOrder = Math.max(-1, ...Array.from(byKey.values()).map((column) => column.order)) + 1;
  for (const rawKey of discoveredKeys) {
    const key = rawKey.trim();
    if (!key || BOQ_METADATA_FIELDS.has(key) || byKey.has(key)) continue;
    byKey.set(key, {
      key,
      label: key,
      dataType: getDefaultBoqColumnDataType(key),
      showInCosting: false,
      showInOperational: false,
      order: nextOrder++,
    });
  }

  return Array.from(byKey.values())
    .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label))
    .map((column, order) => ({ ...column, order }));
}
