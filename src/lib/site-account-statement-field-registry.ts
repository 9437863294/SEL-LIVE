/**
 * Field Control registry for the Site Account Statement module.
 *
 * Every form in the module — Add Expense (including the dashboard's quick-add dialog, which
 * shares this same configuration), Add Receipt, Project Setup, Expense Categories, Tender
 * Budget, Category Budget (used by both the dedicated Category Budget page and the Site Fund
 * Budget page's inline dialog), Budget Alerts, and Site Fund Budget — is described here as a
 * flat list of fields. An admin can, per organization, override each field's label, whether
 * it's required, and whether it's shown at all — from Settings > Field Control.
 *
 * A field marked `locked: true` cannot have its `visible`/`required` overridden — only its
 * label can be customized. Fields are locked when the surrounding form has a hardcoded
 * validation guard (a submit-time `if (!value) return/throw ...` beyond the plain HTML
 * `required` attribute) or is the record's own identifying field (Project, Date, Amount) —
 * hiding or optionalizing those would either let the form silently produce unusable records or
 * trap the user behind a guard for a field they can no longer see.
 *
 * Not covered here (by design, same reasoning as Recurring Payments): the Bulk Category Budget
 * grid (a dynamic per-category list of amounts, not a fixed field set) and the two file-only
 * forms (Excel approval-sheet import, PDF budget-approval upload) — a single file input has no
 * meaningful required/optional distinction worth exposing.
 */

export type SASFormKey =
  | 'expense'
  | 'payment'
  | 'project'
  | 'expenseCategory'
  | 'tenderBudget'
  | 'categoryBudget'
  | 'budgetAlerts'
  | 'siteFundBudget';

export interface SASFieldDef {
  key: string;
  defaultLabel: string;
  defaultRequired: boolean;
  /** Visible/required are fixed when true — only the label can be customized. */
  locked?: boolean;
}

export interface SASFormDef {
  title: string;
  description: string;
  fields: SASFieldDef[];
}

export const SAS_FORM_REGISTRY: Record<SASFormKey, SASFormDef> = {
  expense: {
    title: 'Add Expense',
    description: 'The Add/Edit Expense form — used on the Site Expenses page and the dashboard’s quick-add dialog.',
    fields: [
      { key: 'projectId', defaultLabel: 'Project', defaultRequired: true, locked: true },
      { key: 'expenseDate', defaultLabel: 'Expense Date', defaultRequired: true, locked: true },
      { key: 'expenseAmount', defaultLabel: 'Amount', defaultRequired: true, locked: true },
      { key: 'expenseCategory', defaultLabel: 'Main Category', defaultRequired: true },
      { key: 'expenseSubCategory', defaultLabel: 'Sub-Category', defaultRequired: false },
      { key: 'expensedBy', defaultLabel: 'Expensed By', defaultRequired: true },
      { key: 'paymentMode', defaultLabel: 'Payment Mode', defaultRequired: false },
      { key: 'vendorPartyName', defaultLabel: 'Vendor / Party Name', defaultRequired: false },
      { key: 'billNo', defaultLabel: 'Bill No.', defaultRequired: false },
      { key: 'narration', defaultLabel: 'Narration', defaultRequired: false },
      { key: 'remarks', defaultLabel: 'Remarks', defaultRequired: false },
      { key: 'attachment', defaultLabel: 'Upload Document', defaultRequired: false },
    ],
  },
  payment: {
    title: 'Add Receipt',
    description: 'The Add/Edit Payment Received form on the Payments page.',
    fields: [
      { key: 'projectId', defaultLabel: 'Project', defaultRequired: true, locked: true },
      { key: 'receiptDate', defaultLabel: 'Receipt Date', defaultRequired: true, locked: true },
      { key: 'receivedAmount', defaultLabel: 'Amount', defaultRequired: true, locked: true },
      { key: 'paymentMode', defaultLabel: 'Payment Mode', defaultRequired: false },
      { key: 'referenceNo', defaultLabel: 'Reference No.', defaultRequired: false },
      { key: 'receivedBy', defaultLabel: 'Received By', defaultRequired: false },
      { key: 'remarks', defaultLabel: 'Remarks', defaultRequired: false },
      { key: 'attachment', defaultLabel: 'Upload Document', defaultRequired: false },
    ],
  },
  project: {
    title: 'Project Setup',
    description: 'The Add/Edit Project form under Settings.',
    fields: [
      { key: 'centralProjectId', defaultLabel: 'Project', defaultRequired: true, locked: true },
      { key: 'assignedPersonId', defaultLabel: 'Assigned Person', defaultRequired: false },
      { key: 'altUserId', defaultLabel: 'Alternative User', defaultRequired: false },
      { key: 'viewerId', defaultLabel: 'Viewer', defaultRequired: false },
      { key: 'status', defaultLabel: 'Status', defaultRequired: false },
      { key: 'enabledForSiteAccount', defaultLabel: 'Enable for Site Account Statement', defaultRequired: false },
    ],
  },
  expenseCategory: {
    title: 'Expense Categories',
    description: 'The Add/Edit Category form under Settings.',
    fields: [
      { key: 'name', defaultLabel: 'Category Name', defaultRequired: true, locked: true },
      { key: 'parentId', defaultLabel: 'Parent Category', defaultRequired: false },
      { key: 'description', defaultLabel: 'Description', defaultRequired: false },
      { key: 'isActive', defaultLabel: 'Active', defaultRequired: false },
    ],
  },
  tenderBudget: {
    title: 'Tender Budget Setup',
    description: 'The Set Up Tender Budget dialog. All fields are required by the form’s own logic, so only labels can be customized.',
    fields: [
      { key: 'dialogProjectId', defaultLabel: 'Project', defaultRequired: true, locked: true },
      { key: 'dialogAmount', defaultLabel: 'Tender Amount (₹)', defaultRequired: true, locked: true },
      { key: 'dialogStart', defaultLabel: 'Start Month', defaultRequired: true, locked: true },
      { key: 'dialogEnd', defaultLabel: 'End Month', defaultRequired: true, locked: true },
      { key: 'dialogNotes', defaultLabel: 'Notes', defaultRequired: false },
    ],
  },
  categoryBudget: {
    title: 'Category Budget',
    description: 'The Set/Edit Category Budget dialog — shared by the Category Budget page and the Site Fund Budget page’s inline category dialog.',
    fields: [
      { key: 'amount', defaultLabel: 'Budget Amount (₹)', defaultRequired: true, locked: true },
      { key: 'notes', defaultLabel: 'Notes', defaultRequired: false },
    ],
  },
  budgetAlerts: {
    title: 'Budget Alerts',
    description: 'The Configure Alerts dialog. Every field here is locked because the dialog’s own logic already enforces what’s required — only labels can be customized.',
    fields: [
      { key: 'enabled', defaultLabel: 'Enable Alerts', defaultRequired: false, locked: true },
      { key: 'thresholds', defaultLabel: 'Alert Thresholds', defaultRequired: false, locked: true },
      { key: 'recipients', defaultLabel: 'Recipients', defaultRequired: false, locked: true },
      { key: 'newName', defaultLabel: 'Name', defaultRequired: true, locked: true },
      { key: 'newEmail', defaultLabel: 'Email', defaultRequired: true, locked: true },
    ],
  },
  siteFundBudget: {
    title: 'Site Fund Budget',
    description: 'The Set/Edit Budget dialog (Total / FY / Monthly) on the Site Fund Budget page.',
    fields: [
      { key: 'projectId', defaultLabel: 'Project', defaultRequired: true, locked: true },
      { key: 'budgetAmount', defaultLabel: 'Budget Amount (₹)', defaultRequired: true, locked: true },
      { key: 'notes', defaultLabel: 'Notes', defaultRequired: false },
    ],
  },
};

export const SAS_FORM_KEYS = Object.keys(SAS_FORM_REGISTRY) as SASFormKey[];
