/**
 * Field Control registry for the Project Management module.
 *
 * Covers the module's core entity-creation forms — BOQ Add (manual entry), Indent New, RFQ New,
 * Purchase Order New, and the Project Mapping dialog (Settings → Manage Projects). An admin can,
 * per organization, override each field's label, whether it's required, and whether it's shown
 * at all — from Settings > Field Control.
 *
 * A field marked `locked: true` cannot have its `visible`/`required` overridden — only its label
 * can be customized. Fields are locked when they're the record's own identifying field (a BOQ
 * item's Scope 1/Scope 2/BOQ SL No — the exact combination the duplicate-item check keys off —
 * a PO's vendor, or a Project Mapping's name/global project), or the surrounding form has a
 * hardcoded validation guard beyond the plain "required" mechanism (e.g. PO New's paired
 * start/end date check).
 *
 * Not covered here (by design, same reasoning as Vehicle Management/Recurring Payments/Site
 * Account Statement): the BOQ Excel import wizard (a distinct, bulk-data-integrity mechanism with
 * its own field list and its own duplicate check reusing the same composite key as BOQ Add), and
 * the repeatable line-item pickers (BOQ item selection on Indent/RFQ/PO, vendor/quote selection)
 * — those are specialized multi-select mechanisms, not simple entity fields.
 */

export type PMFormKey = "boqAdd" | "indentNew" | "rfqNew" | "poNew" | "projectMapping" | "clientMaster";

export interface PMFieldDef {
  key: string;
  defaultLabel: string;
  defaultRequired: boolean;
  /** Visible/required are fixed when true — only the label can be customized. */
  locked?: boolean;
}

export interface PMFormDef {
  title: string;
  description: string;
  fields: PMFieldDef[];
}

export const PM_FORM_REGISTRY: Record<PMFormKey, PMFormDef> = {
  boqAdd: {
    title: "BOQ — Add Items",
    description: "The manual BOQ entry form under BOQ → Add Items.",
    fields: [
      { key: "subDivision", defaultLabel: "Sub-Division", defaultRequired: false },
      { key: "site", defaultLabel: "Site", defaultRequired: false },
      { key: "scope1", defaultLabel: "Scope 1", defaultRequired: true },
      { key: "scope2", defaultLabel: "Scope 2", defaultRequired: true },
      { key: "category1", defaultLabel: "Category 1", defaultRequired: false },
      { key: "category2", defaultLabel: "Category 2", defaultRequired: false },
      { key: "category3", defaultLabel: "Category 3", defaultRequired: false },
      { key: "erpSlNo", defaultLabel: "ERP SL NO", defaultRequired: false },
      { key: "boqSlNo", defaultLabel: "BOQ SL No", defaultRequired: true, locked: true },
      { key: "description", defaultLabel: "Description", defaultRequired: true, locked: true },
      { key: "unit", defaultLabel: "Unit", defaultRequired: true, locked: true },
      { key: "qty", defaultLabel: "QTY", defaultRequired: true, locked: true },
      { key: "unitRate", defaultLabel: "Unit Rate", defaultRequired: false },
      { key: "budgetPrice", defaultLabel: "Budget Price", defaultRequired: false },
      { key: "fiPercentage", defaultLabel: "F&I %", defaultRequired: false },
      { key: "startDate", defaultLabel: "Start Date", defaultRequired: false },
      { key: "endDate", defaultLabel: "End Date", defaultRequired: false },
      { key: "mdl", defaultLabel: "MDL", defaultRequired: false },
    ],
  },
  indentNew: {
    title: "Indent — New",
    description: "The header fields on the New Indent form (BOQ item lines are a separate picker, not covered here).",
    fields: [
      { key: "indentDate", defaultLabel: "Indent Date", defaultRequired: true, locked: true },
      { key: "requiredDate", defaultLabel: "Required Date", defaultRequired: false },
      { key: "remarks", defaultLabel: "Remarks", defaultRequired: false },
    ],
  },
  rfqNew: {
    title: "RFQ — New",
    description: "The header fields on the New RFQ form (indent-item and vendor selection are separate pickers, not covered here).",
    fields: [
      { key: "rfqDate", defaultLabel: "RFQ Date", defaultRequired: true, locked: true },
      { key: "dueDate", defaultLabel: "Due Date", defaultRequired: false },
      { key: "remarks", defaultLabel: "Remarks", defaultRequired: false },
    ],
  },
  poNew: {
    title: "Purchase Order — New",
    description: "The header fields on the New Purchase Order form (RFQ/indent/BOQ item selection is a separate picker, not covered here).",
    fields: [
      { key: "vendorId", defaultLabel: "Vendor", defaultRequired: true, locked: true },
      { key: "poDate", defaultLabel: "PO Date", defaultRequired: true, locked: true },
      { key: "startDate", defaultLabel: "Start Date", defaultRequired: true, locked: true },
      { key: "endDate", defaultLabel: "End Date", defaultRequired: true, locked: true },
      { key: "terms", defaultLabel: "Terms", defaultRequired: false },
      { key: "warrantyMonths", defaultLabel: "Warranty (Months)", defaultRequired: false },
      { key: "ldRatePct", defaultLabel: "LD Rate (%/week)", defaultRequired: false },
      { key: "ldCapPct", defaultLabel: "LD Cap (%)", defaultRequired: false },
      { key: "performanceSecurityPct", defaultLabel: "Performance Security (%)", defaultRequired: false },
    ],
  },
  projectMapping: {
    title: "Project Mapping",
    description: "The Add/Edit dialog under Settings → Manage Projects.",
    fields: [
      { key: "projectName", defaultLabel: "Project Name", defaultRequired: true, locked: true },
      { key: "globalProjectId", defaultLabel: "Global Project", defaultRequired: true, locked: true },
      { key: "description", defaultLabel: "Description", defaultRequired: false },
      { key: "startDate", defaultLabel: "Start Date", defaultRequired: false },
      { key: "endDate", defaultLabel: "End Date", defaultRequired: false },
    ],
  },
  clientMaster: {
    title: "Client Master",
    description: "The Add/Edit dialog under Settings → Clients.",
    fields: [
      { key: "name", defaultLabel: "Client Name", defaultRequired: true, locked: true },
      { key: "gstin", defaultLabel: "GSTIN", defaultRequired: false },
      { key: "pan", defaultLabel: "PAN", defaultRequired: false },
      { key: "address", defaultLabel: "Address", defaultRequired: false },
      { key: "paymentTermsDays", defaultLabel: "Payment Terms (Days)", defaultRequired: false },
      { key: "retentionPct", defaultLabel: "Retention %", defaultRequired: false },
      { key: "defaultTdsPct", defaultLabel: "Default TDS %", defaultRequired: false },
      { key: "warrantyMonths", defaultLabel: "Warranty (Months)", defaultRequired: false },
      { key: "ldRatePct", defaultLabel: "LD Rate (%/week)", defaultRequired: false },
      { key: "ldCapPct", defaultLabel: "LD Cap (%)", defaultRequired: false },
      { key: "performanceSecurityPct", defaultLabel: "Performance Security (%)", defaultRequired: false },
      { key: "inspectionRegime", defaultLabel: "Inspection Regime", defaultRequired: false },
    ],
  },
};

export const PM_FORM_KEYS = Object.keys(PM_FORM_REGISTRY) as PMFormKey[];
