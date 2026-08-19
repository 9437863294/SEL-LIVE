/**
 * Field Control registry for the Recurring Payments module.
 *
 * Every form in the module (Recurring Master, Vendor, Category, Manual Payment, Payment Edit,
 * Approval Rule, and the workflow action dialogs — Submit Bill, Bill Verification, Record
 * Payment, Create Expense Request) is described here as a flat list of fields. An admin can, per
 * organization, override each field's label, whether it's required, and whether it's shown at
 * all — from Settings > Field Control.
 *
 * A field marked `locked: true` cannot have its `visible`/`required` overridden — only its label
 * can be customized. Fields are locked when the surrounding form has a hardcoded validation guard
 * (a submit-time `if (!value) return/throw ...` beyond the plain HTML `required` attribute) or is
 * the record's own identity/title field — hiding or optionalizing those would either let the
 * form silently produce unusable records or trap the user behind a guard for a field they can no
 * longer see. Every other field is fully configurable.
 */

export type RPFormKey =
  | "master"
  | "vendor"
  | "category"
  | "manualPayment"
  | "paymentEdit"
  | "approvalRule"
  | "submitBill"
  | "verifyBill"
  | "recordPayment"
  | "expenseRequest"
  | "workflowCommon";

export interface RPFieldDef {
  key: string;
  defaultLabel: string;
  defaultRequired: boolean;
  /** Visible/required are fixed when true — only the label can be customized. */
  locked?: boolean;
}

export interface RPFormDef {
  title: string;
  description: string;
  fields: RPFieldDef[];
}

export const RP_FORM_REGISTRY: Record<RPFormKey, RPFormDef> = {
  master: {
    title: "Recurring Master",
    description: "The form used to create or edit a recurring payment master.",
    fields: [
      { key: "branchName", defaultLabel: "Branch", defaultRequired: false },
      { key: "projectId", defaultLabel: "Project", defaultRequired: false },
      { key: "departmentId", defaultLabel: "Department", defaultRequired: false },
      { key: "title", defaultLabel: "Payment title", defaultRequired: true, locked: true },
      { key: "category", defaultLabel: "Category", defaultRequired: true, locked: true },
      { key: "vendorName", defaultLabel: "Vendor", defaultRequired: true, locked: true },
      { key: "accountNumber", defaultLabel: "Account / consumer number", defaultRequired: false },
      { key: "internalReference", defaultLabel: "Internal reference", defaultRequired: false },
      { key: "description", defaultLabel: "Description", defaultRequired: false },
      { key: "frequency", defaultLabel: "Frequency", defaultRequired: false },
      { key: "customIntervalDays", defaultLabel: "Custom interval days", defaultRequired: true, locked: true },
      { key: "startDate", defaultLabel: "Start date", defaultRequired: true, locked: true },
      { key: "endDate", defaultLabel: "End date", defaultRequired: false },
      { key: "periodAnchorDay", defaultLabel: "Billing period starts on day", defaultRequired: false },
      { key: "billDateRule", defaultLabel: "When the bill is expected", defaultRequired: false },
      { key: "billDayOffset", defaultLabel: "Bill day / offset", defaultRequired: false },
      { key: "dueDateRule", defaultLabel: "When payment is due", defaultRequired: false },
      { key: "dueDay", defaultLabel: "Due day / offset", defaultRequired: false },
      { key: "gracePeriodDays", defaultLabel: "Grace period (days after due)", defaultRequired: false },
      { key: "generateLeadDays", defaultLabel: "Create obligation this many days before the bill date", defaultRequired: false },
      { key: "autoGenerationEnabled", defaultLabel: "Enable auto-generation", defaultRequired: false },
      { key: "amountType", defaultLabel: "Amount type", defaultRequired: false },
      { key: "amount", defaultLabel: "Amount", defaultRequired: true, locked: true },
      { key: "maximumAmount", defaultLabel: "Maximum permitted amount", defaultRequired: false },
      { key: "taxAmount", defaultLabel: "Tax amount", defaultRequired: false },
      { key: "costCentre", defaultLabel: "Cost centre", defaultRequired: false },
      { key: "ledger", defaultLabel: "General ledger code", defaultRequired: false },
      { key: "budgetHead", defaultLabel: "Budget head", defaultRequired: false },
      { key: "varianceTolerancePercent", defaultLabel: "Variance tolerance %", defaultRequired: false },
      { key: "tdsApplicable", defaultLabel: "TDS applicable", defaultRequired: false },
      { key: "gstApplicable", defaultLabel: "GST applicable", defaultRequired: false },
      { key: "assignedTo", defaultLabel: "Payment owner", defaultRequired: true, locked: true },
      { key: "backupAssignedTo", defaultLabel: "Backup owner", defaultRequired: false },
      { key: "verifierId", defaultLabel: "Verifier", defaultRequired: false },
      { key: "approverId", defaultLabel: "Approver", defaultRequired: false },
      { key: "accountsProcessorId", defaultLabel: "Accounts processor", defaultRequired: false },
      { key: "escalationAuthorityId", defaultLabel: "Escalation authority", defaultRequired: false },
      { key: "approvalConfiguration", defaultLabel: "Approval option", defaultRequired: false },
      { key: "customApprovalRuleId", defaultLabel: "Custom approval rule", defaultRequired: false },
      { key: "highVarianceAdditionalApproval", defaultLabel: "Additional approval on high variance", defaultRequired: false },
      { key: "reminderRecipients", defaultLabel: "Reminder recipients", defaultRequired: false },
      { key: "escalationRecipients", defaultLabel: "Escalation recipients", defaultRequired: false },
      { key: "masterDocuments", defaultLabel: "Master documents", defaultRequired: false },
    ],
  },
  vendor: {
    title: "Vendor",
    description: "The form used to create or edit a vendor.",
    fields: [
      { key: "name", defaultLabel: "Vendor name", defaultRequired: true, locked: true },
      { key: "code", defaultLabel: "Vendor code", defaultRequired: false },
      { key: "category", defaultLabel: "Vendor category", defaultRequired: false },
      { key: "gstin", defaultLabel: "GSTIN", defaultRequired: false },
      { key: "pan", defaultLabel: "PAN", defaultRequired: false },
      { key: "contactPerson", defaultLabel: "Contact person", defaultRequired: false },
      { key: "mobile", defaultLabel: "Mobile", defaultRequired: false },
      { key: "email", defaultLabel: "Email", defaultRequired: false },
      { key: "paymentTerms", defaultLabel: "Payment terms", defaultRequired: false },
      { key: "bankName", defaultLabel: "Bank name", defaultRequired: false },
      { key: "maskedAccountNumber", defaultLabel: "Masked account number", defaultRequired: false },
      { key: "ifsc", defaultLabel: "IFSC", defaultRequired: false },
      { key: "status", defaultLabel: "Status", defaultRequired: false },
      { key: "address", defaultLabel: "Address", defaultRequired: false },
    ],
  },
  category: {
    title: "Category",
    description: "The core fields of a payment category (its own dynamic-field builder is configured per category, not here).",
    fields: [
      { key: "name", defaultLabel: "Category name", defaultRequired: true, locked: true },
      { key: "code", defaultLabel: "Category code", defaultRequired: false },
      { key: "icon", defaultLabel: "Icon name", defaultRequired: false },
      { key: "defaultFrequency", defaultLabel: "Default frequency", defaultRequired: false },
      { key: "amountType", defaultLabel: "Amount type", defaultRequired: false },
      { key: "billRequired", defaultLabel: "Bill required", defaultRequired: false },
      { key: "approvalRequired", defaultLabel: "Approval required", defaultRequired: false },
      { key: "paymentProofRequired", defaultLabel: "Payment proof required", defaultRequired: false },
      { key: "description", defaultLabel: "Description", defaultRequired: false },
    ],
  },
  manualPayment: {
    title: "Manual Payment",
    description: "The form used to create a one-off payment obligation outside recurring generation.",
    fields: [
      { key: "branchName", defaultLabel: "Branch", defaultRequired: false },
      { key: "projectId", defaultLabel: "Project", defaultRequired: false },
      { key: "departmentId", defaultLabel: "Department", defaultRequired: false },
      { key: "title", defaultLabel: "Payment title", defaultRequired: true, locked: true },
      { key: "category", defaultLabel: "Category", defaultRequired: true, locked: true },
      { key: "vendorName", defaultLabel: "Vendor", defaultRequired: true, locked: true },
      { key: "priority", defaultLabel: "Priority", defaultRequired: false },
      { key: "description", defaultLabel: "Description", defaultRequired: false },
      { key: "billNumber", defaultLabel: "Bill number", defaultRequired: true, locked: true },
      { key: "billDate", defaultLabel: "Bill date", defaultRequired: false },
      { key: "billingPeriodStart", defaultLabel: "Billing period start", defaultRequired: false },
      { key: "billingPeriodEnd", defaultLabel: "Billing period end", defaultRequired: false },
      { key: "dueDate", defaultLabel: "Due date", defaultRequired: true, locked: true },
      { key: "billAmount", defaultLabel: "Bill amount", defaultRequired: true, locked: true },
      { key: "taxAmount", defaultLabel: "Tax amount", defaultRequired: false },
      { key: "tdsAmount", defaultLabel: "TDS amount", defaultRequired: false },
      { key: "deductionAmount", defaultLabel: "Other deductions", defaultRequired: false },
      { key: "adjustmentAmount", defaultLabel: "Adjustment", defaultRequired: false },
      { key: "exceptionReason", defaultLabel: "Exception reason", defaultRequired: false },
      { key: "ownerId", defaultLabel: "Payment owner", defaultRequired: true, locked: true },
      { key: "verifierId", defaultLabel: "Verifier", defaultRequired: true, locked: true },
      { key: "approverId", defaultLabel: "Approver", defaultRequired: false },
      { key: "accountsProcessorId", defaultLabel: "Accounts person", defaultRequired: false },
      { key: "billFile", defaultLabel: "Bill document", defaultRequired: false },
      { key: "supportingFile", defaultLabel: "Supporting document", defaultRequired: false },
      { key: "notes", defaultLabel: "Notes", defaultRequired: false },
    ],
  },
  paymentEdit: {
    title: "Edit Payment",
    description: "The form used to edit a payment obligation before it progresses beyond Bill Collection.",
    fields: [
      { key: "title", defaultLabel: "Payment title", defaultRequired: true },
      { key: "vendorName", defaultLabel: "Vendor", defaultRequired: true },
      { key: "category", defaultLabel: "Category", defaultRequired: true },
      { key: "dueDate", defaultLabel: "Due date", defaultRequired: true },
      { key: "branchName", defaultLabel: "Branch", defaultRequired: false },
      { key: "projectId", defaultLabel: "Project", defaultRequired: false },
      { key: "departmentId", defaultLabel: "Department", defaultRequired: false },
      { key: "billAmount", defaultLabel: "Bill amount", defaultRequired: false },
      { key: "priority", defaultLabel: "Priority", defaultRequired: false },
      { key: "assignedTo", defaultLabel: "Payment owner", defaultRequired: false },
      { key: "description", defaultLabel: "Description", defaultRequired: false },
    ],
  },
  approvalRule: {
    title: "Approval Rule",
    description: "The dialog used to create or edit an approval rule under Settings > Approval Rules.",
    fields: [
      { key: "name", defaultLabel: "Rule name", defaultRequired: true, locked: true },
      { key: "mode", defaultLabel: "Approval mode", defaultRequired: false },
      { key: "minAmount", defaultLabel: "Minimum amount", defaultRequired: true, locked: true },
      { key: "maxAmount", defaultLabel: "Maximum amount", defaultRequired: false },
      { key: "category", defaultLabel: "Category", defaultRequired: false },
      { key: "project", defaultLabel: "Project", defaultRequired: false },
      { key: "approvers", defaultLabel: "Approvers", defaultRequired: true, locked: true },
      { key: "accounts", defaultLabel: "Final accounts verification", defaultRequired: false },
    ],
  },
  submitBill: {
    title: "Submit Bill",
    description: "The Bill Collection step's action dialog. All three fields are required by the step's own logic, so only their labels can be customized.",
    fields: [
      { key: "billNumber", defaultLabel: "Bill number", defaultRequired: true, locked: true },
      { key: "billReceivedDate", defaultLabel: "Bill received date", defaultRequired: true, locked: true },
      { key: "billAmount", defaultLabel: "Final bill amount", defaultRequired: true, locked: true },
    ],
  },
  verifyBill: {
    title: "Bill Verification checklist",
    description: "Each control in the mandatory verification checklist. Items can be hidden, made optional, or relabelled per organization.",
    fields: [
      { key: "check1", defaultLabel: "Vendor and account details match the master", defaultRequired: true },
      { key: "check2", defaultLabel: "Billing period and due date are correct", defaultRequired: true },
      { key: "check3", defaultLabel: "Bill number is unique and legible", defaultRequired: true },
      { key: "check4", defaultLabel: "Quantity, rate and amount are verified", defaultRequired: true },
      { key: "check5", defaultLabel: "GST and TDS treatment is correct", defaultRequired: true },
      { key: "check6", defaultLabel: "Cost centre, project and budget head are correct", defaultRequired: true },
      { key: "check7", defaultLabel: "Supporting documents are complete", defaultRequired: true },
      { key: "check8", defaultLabel: "Variance and duplicate-payment risks are reviewed", defaultRequired: true },
    ],
  },
  recordPayment: {
    title: "Record Payment",
    description: "The Payment Processing step's action dialog. Payment date/amount and the mode-specific bank fields are locked because the step's own logic hard-requires them.",
    fields: [
      { key: "paymentDate", defaultLabel: "Payment date", defaultRequired: true, locked: true },
      { key: "paymentAmount", defaultLabel: "Paid amount", defaultRequired: true, locked: true },
      { key: "mode", defaultLabel: "Payment mode", defaultRequired: false },
      { key: "bankAccount", defaultLabel: "Bank account", defaultRequired: true, locked: true },
      { key: "chequeNumber", defaultLabel: "Cheque number", defaultRequired: true, locked: true },
      { key: "transactionReference", defaultLabel: "Transaction / UTR", defaultRequired: true, locked: true },
      { key: "tdsAmount", defaultLabel: "TDS amount", defaultRequired: false },
      { key: "gstAmount", defaultLabel: "GST amount", defaultRequired: false },
      { key: "deductionAmount", defaultLabel: "Other deduction", defaultRequired: false },
      { key: "adjustmentAmount", defaultLabel: "Adjustment", defaultRequired: false },
      { key: "receiptFile", defaultLabel: "Payment receipt", defaultRequired: false },
    ],
  },
  expenseRequest: {
    title: "Create Expense Request",
    description: "The 'Create Expense Request' action available from any workflow step.",
    fields: [
      { key: "expenseDepartmentId", defaultLabel: "Department", defaultRequired: true, locked: true },
      { key: "expensePartyName", defaultLabel: "Party name", defaultRequired: false },
      { key: "expenseAmount", defaultLabel: "Amount", defaultRequired: true, locked: true },
      { key: "expenseHeadOfAccount", defaultLabel: "Head of account", defaultRequired: true, locked: true },
      { key: "expenseSubHeadOfAccount", defaultLabel: "Sub-head of account", defaultRequired: true, locked: true },
      { key: "expenseDescription", defaultLabel: "Expense description", defaultRequired: false },
    ],
  },
  workflowCommon: {
    title: "Workflow action — shared fields",
    description: "Fields shared by every workflow action dialog. Locked because the step's own upload/comment rules already decide when they're required.",
    fields: [
      { key: "documentFile", defaultLabel: "Supporting document", defaultRequired: false, locked: true },
      { key: "documentReference", defaultLabel: "Or document reference", defaultRequired: false, locked: true },
      { key: "comment", defaultLabel: "Comment", defaultRequired: false, locked: true },
    ],
  },
};

export const RP_FORM_KEYS = Object.keys(RP_FORM_REGISTRY) as RPFormKey[];
