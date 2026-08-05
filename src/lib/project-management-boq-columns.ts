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
  "Total Amount",
  "Budget Price",
  "F&I %",
  "F&I Price",
  "Total Budget Price",
  "Start Date",
  "End Date",
  "MDL",
  "MDL Status",
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
  "Budget Price",
  "F&I %",
  "F&I Price",
  "Total Budget Price",
  "Start Date",
  "End Date",
  "MDL",
  "MDL Status",
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

const yesNoColumnKeys = new Set(["MDL"]);

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
