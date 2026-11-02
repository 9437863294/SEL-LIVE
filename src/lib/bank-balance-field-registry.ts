/**
 * Field Control and Sort Order registries for Bank Balance, on Site Account Statement's model.
 *
 * Every form an administrator can tune is a flat list of fields. Per organisation, each field's
 * label, whether it is required and whether it is shown at all can be overridden from Bank Balance
 * › Settings › Field Control. A `locked` field keeps its visibility and requirement — only its
 * label can change — because the form's own logic needs it: the record's account, date and amount,
 * or a value the save cannot do without. Hiding or optionalising one of those would let the form
 * produce unusable records, or trap the user behind a check for a field they can no longer see.
 *
 * Payment entry's five "mandatory" switches used to live on Settings › Payment Entry. Field Control
 * now holds them; until someone saves Field Control, each of those fields' default requirement is
 * still read from the old switches (`LEGACY_PAYMENT_MANDATORY`), so nothing changes on rollout.
 *
 * `followsForm`: the label the form shows depends on context (the payment mode's "Cheque no." /
 * "UTR no.", "Cheque date" / "Transfer date"). The default label stands for that, and only a label
 * an administrator actually changes replaces it.
 *
 * Sort Order covers flat lists only. The payments and receipts logs are a date → bank → method
 * tree and the transfers page a date-wise ledger, where row order carries meaning: re-sorting them
 * would not give a different view of the same data, it would destroy the view.
 *
 * Importless apart from Site Account's comparator, so `node --test` loads it directly.
 */

import { compareBy, type SASSortDirection, type SASSortField, type SASSortSetting } from './site-account-statement-sort-registry.ts';

export type BBFormKey = 'payment' | 'receipt' | 'transfer' | 'account';

export interface BBFieldDef {
  key: string;
  defaultLabel: string;
  defaultRequired: boolean;
  /** Visible/required are fixed when true — only the label can be customised. */
  locked?: boolean;
  /** The form words this label itself (by payment mode, by account type) unless it is renamed. */
  followsForm?: boolean;
  /** Can be made required or optional, but not hidden: the form works through it. */
  alwaysShown?: boolean;
  /** A note for the settings table: what the field is, or why it is locked. */
  hint?: string;
}

export interface BBFormDef {
  title: string;
  description: string;
  fields: BBFieldDef[];
}

export const BB_FORM_REGISTRY: Record<BBFormKey, BBFormDef> = {
  payment: {
    title: 'New Payment',
    description: 'The payment voucher: one instrument drawn on one bank account, paying one or more payees.',
    fields: [
      { key: 'mode', defaultLabel: 'Payment mode', defaultRequired: true, locked: true },
      { key: 'accountId', defaultLabel: 'Bank account', defaultRequired: true, locked: true },
      {
        key: 'instrumentNo', defaultLabel: 'Instrument no.', defaultRequired: false, followsForm: true,
        hint: 'Shown as "Cheque no.", "DD no." or "Reference no." by mode. A cheque or DD number is always required.',
      },
      { key: 'instrumentDate', defaultLabel: 'Instrument date', defaultRequired: true, locked: true, followsForm: true, hint: 'Shown as "Cheque date", "DD date" or "Transfer date" by mode.' },
      { key: 'remarks', defaultLabel: 'Remarks', defaultRequired: false },
      {
        key: 'transferCopy', defaultLabel: 'Voucher copy', defaultRequired: false, followsForm: true,
        hint: 'Shown as "Bank advice / upload file" or "Cheque / covering letter copy" by mode.',
      },
      {
        key: 'ref', defaultLabel: 'Requisition / Ref', defaultRequired: false, alwaysShown: true,
        hint: 'Each row’s Reception No. Always shown: rows link to their requisition through it.',
      },
      { key: 'partyName', defaultLabel: 'Payee', defaultRequired: true, locked: true },
      { key: 'description', defaultLabel: 'Description', defaultRequired: true, locked: true },
      { key: 'amount', defaultLabel: 'Amount', defaultRequired: true, locked: true },
      { key: 'utr', defaultLabel: 'UTR No.', defaultRequired: false, hint: 'Per row, for modes that carry one (RTGS/NEFT batches).' },
      { key: 'approvalCopy', defaultLabel: 'Approval', defaultRequired: false, hint: 'Per row: the signed approval copy for the payment.' },
    ],
  },
  receipt: {
    title: 'New Receipt',
    description: 'Several receipts into one bank account on one date.',
    fields: [
      { key: 'date', defaultLabel: 'Receipt date', defaultRequired: true, locked: true },
      { key: 'accountId', defaultLabel: 'Bank account', defaultRequired: true, locked: true },
      { key: 'description', defaultLabel: 'Description', defaultRequired: true, hint: 'Who paid, and for what.' },
      { key: 'amount', defaultLabel: 'Amount', defaultRequired: true, locked: true },
    ],
  },
  transfer: {
    title: 'New Transfer',
    description: 'Internal transfers between the company’s own accounts. Account, date and amount are needed to move money; mode, reference and narration can be shown, hidden or required.',
    fields: [
      { key: 'date', defaultLabel: 'Transfer date', defaultRequired: true, locked: true },
      { key: 'fromAccountId', defaultLabel: 'From account', defaultRequired: true, locked: true },
      { key: 'toAccountId', defaultLabel: 'To account', defaultRequired: true, locked: true },
      { key: 'amount', defaultLabel: 'Amount', defaultRequired: true, locked: true },
      { key: 'mode', defaultLabel: 'Mode', defaultRequired: false, hint: 'Internal, NEFT, RTGS, IMPS or Cheque. Always has a value while shown.' },
      { key: 'ref', defaultLabel: 'UTR / Ref no.', defaultRequired: false, followsForm: true, hint: 'Shown as "Cheque no." for a cheque.' },
      { key: 'narration', defaultLabel: 'Narration', defaultRequired: false, hint: 'Added to the description of both entries.' },
    ],
  },
  account: {
    title: 'Bank Account',
    description: 'The Add/Edit Bank Account form under Settings › Bank Accounts.',
    fields: [
      { key: 'bankName', defaultLabel: 'Bank name', defaultRequired: true, locked: true },
      { key: 'shortName', defaultLabel: 'Short name', defaultRequired: true, locked: true },
      { key: 'accountNumber', defaultLabel: 'Account number', defaultRequired: true, locked: true },
      { key: 'ifsc', defaultLabel: 'IFSC', defaultRequired: false },
      { key: 'branch', defaultLabel: 'Branch', defaultRequired: false },
      { key: 'accountType', defaultLabel: 'Account type', defaultRequired: true, locked: true },
      { key: 'status', defaultLabel: 'Status', defaultRequired: true, locked: true },
      { key: 'openingDate', defaultLabel: 'Opening date', defaultRequired: true, locked: true, hint: 'Balances are calculated from it.' },
      {
        key: 'openingAmount', defaultLabel: 'Opening figure (₹)', defaultRequired: true, locked: true, followsForm: true,
        hint: 'Shown as "Opening balance" or "Opening utilisation" by account type.',
      },
    ],
  },
};

export const BB_FORM_KEYS = Object.keys(BB_FORM_REGISTRY) as BBFormKey[];

export interface BBFieldSetting {
  visible: boolean;
  required: boolean;
  label: string;
}

/** A stored field: the `{visible, required, label}` shape. */
type StoredField = Partial<BBFieldSetting> | boolean | undefined;
export type BBFieldControlDoc = Partial<Record<BBFormKey, Record<string, StoredField>>>;

/** The old Payment Entry switches, by the Field Control key they now set the default for. */
export const LEGACY_PAYMENT_MANDATORY: Record<string, string> = {
  ref: 'paymentRequestRefNo',
  utr: 'utrNumber',
  approvalCopy: 'approvalCopy',
  instrumentNo: 'paymentRefNo',
  transferCopy: 'bankTransferCopy',
};

/**
 * One form's fields as the form should render them: the registry's defaults, the legacy payment
 * switches where Field Control has nothing for that field yet, then Field Control's overrides.
 * Locked fields take only a label from settings.
 */
export function resolveFormFields(
  formKey: BBFormKey,
  stored: Record<string, StoredField> | undefined | null,
  legacyMandatory?: Record<string, unknown> | null,
): Record<string, BBFieldSetting> {
  const out: Record<string, BBFieldSetting> = {};
  for (const def of BB_FORM_REGISTRY[formKey].fields) {
    const legacyKey = formKey === 'payment' ? LEGACY_PAYMENT_MANDATORY[def.key] : undefined;
    const legacyRequired = legacyKey && legacyMandatory && typeof legacyMandatory[legacyKey] === 'boolean' ? (legacyMandatory[legacyKey] as boolean) : undefined;
    const base: BBFieldSetting = { visible: true, required: def.locked ? def.defaultRequired : legacyRequired ?? def.defaultRequired, label: def.defaultLabel };
    const override = stored?.[def.key];
    if (override === undefined || override === null) {
      out[def.key] = base;
    } else if (typeof override === 'boolean') {
      out[def.key] = def.locked ? base : { ...base, required: override };
    } else if (def.locked) {
      out[def.key] = { ...base, label: override.label || base.label };
    } else {
      out[def.key] = {
        visible: def.alwaysShown ? true : override.visible ?? base.visible,
        required: override.required ?? base.required,
        label: override.label || base.label,
      };
    }
  }
  return out;
}

/** Every form resolved, for the settings screen's draft. */
export function resolveAllForms(doc: BBFieldControlDoc | null | undefined, legacyMandatory?: Record<string, unknown> | null) {
  const out = {} as Record<BBFormKey, Record<string, BBFieldSetting>>;
  for (const key of BB_FORM_KEYS) out[key] = resolveFormFields(key, doc?.[key], legacyMandatory);
  return out;
}

/**
 * The label a form shows: the administrator's when they renamed the field, otherwise the form's
 * own contextual wording for a `followsForm` field, otherwise the default.
 */
export function fieldLabel(formKey: BBFormKey, key: string, setting: BBFieldSetting | undefined, contextual?: string): string {
  const def = BB_FORM_REGISTRY[formKey].fields.find((field) => field.key === key);
  const label = setting?.label || def?.defaultLabel || key;
  if (def?.followsForm && contextual && label === def.defaultLabel) return contextual;
  return label;
}

function isEmpty(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/**
 * The label of the first shown, required, non-locked field left empty in `values`, or null. Locked
 * fields are skipped: the form's own checks cover them.
 */
export function missingRequiredField(
  formKey: BBFormKey,
  values: Record<string, unknown>,
  fields: Record<string, BBFieldSetting>,
  only?: string[],
): string | null {
  for (const def of BB_FORM_REGISTRY[formKey].fields) {
    if (def.locked || (only && !only.includes(def.key))) continue;
    const setting = fields[def.key];
    if (!setting?.visible || !setting.required) continue;
    if (isEmpty(values[def.key])) return setting.label;
  }
  return null;
}

// ── Sort Order ───────────────────────────────────────────────────────────────────────────────

export type BBListKey = 'cheques' | 'accounts';

export interface BBListDef {
  title: string;
  description: string;
  fields: SASSortField[];
  defaultSort: SASSortSetting;
}

export const BB_LIST_REGISTRY: Record<BBListKey, BBListDef> = {
  cheques: {
    title: 'Cheque Register',
    description: 'Payment vouchers — cheques, DDs and bank transfers.',
    fields: [
      { key: 'instrumentDate', label: 'Date', type: 'date' },
      { key: 'voucherNo', label: 'Voucher no.', type: 'text' },
      { key: 'total', label: 'Amount', type: 'number' },
      { key: 'accountName', label: 'Account', type: 'text' },
      { key: 'status', label: 'Status', type: 'text' },
    ],
    defaultSort: { field: 'instrumentDate', direction: 'desc' },
  },
  accounts: {
    title: 'Bank Accounts',
    description: 'The account list under Settings › Bank Accounts.',
    fields: [
      { key: 'shortName', label: 'Short name', type: 'text' },
      { key: 'bankName', label: 'Bank', type: 'text' },
      { key: 'accountType', label: 'Type', type: 'text' },
      { key: 'openingDate', label: 'Opening date', type: 'date' },
      { key: 'status', label: 'Status', type: 'text' },
    ],
    defaultSort: { field: 'shortName', direction: 'asc' },
  },
};

export const BB_LIST_KEYS = Object.keys(BB_LIST_REGISTRY) as BBListKey[];

export type BBSortControlDoc = Partial<Record<BBListKey, Partial<SASSortSetting>>>;

export function resolveBBSort(listKey: BBListKey, doc: BBSortControlDoc | null | undefined): SASSortSetting {
  const list = BB_LIST_REGISTRY[listKey];
  const override = doc?.[listKey];
  const field = list.fields.some((f) => f.key === override?.field) ? override!.field! : list.defaultSort.field;
  const direction: SASSortDirection = override?.direction === 'asc' || override?.direction === 'desc' ? override.direction : list.defaultSort.direction;
  return { field, direction };
}

export function isDefaultBBSort(listKey: BBListKey, sort: SASSortSetting): boolean {
  const fallback = BB_LIST_REGISTRY[listKey].defaultSort;
  return sort.field === fallback.field && sort.direction === fallback.direction;
}

/**
 * Rows ordered by a sort, blanks last whatever the direction. `tiebreak` keeps equal rows in a
 * stable, meaningful order (newest voucher first). The input is never mutated.
 */
export function sortBBRows<T>(rows: T[], listKey: BBListKey, sort: SASSortSetting, tiebreak?: (a: T, b: T) => number): T[] {
  const field = BB_LIST_REGISTRY[listKey].fields.find((f) => f.key === sort.field);
  if (!field) return rows;
  return [...rows].sort(
    (a, b) => compareBy(a as Record<string, unknown>, b as Record<string, unknown>, field, sort.direction) || (tiebreak ? tiebreak(a, b) : 0),
  );
}

/** "Date, Newest first" — a list's opening sort described, for the change log. */
export function describeBBSort(listKey: BBListKey, sort: SASSortSetting): string {
  const field = BB_LIST_REGISTRY[listKey].fields.find((f) => f.key === sort.field);
  return `${field?.label ?? sort.field}, ${sortDirectionLabel(field?.type ?? 'text', sort.direction)}`;
}

export function sortDirectionLabel(type: SASSortField['type'], direction: SASSortDirection): string {
  if (type === 'number') return direction === 'asc' ? 'Smallest first' : 'Largest first';
  if (type === 'date') return direction === 'asc' ? 'Oldest first' : 'Newest first';
  return direction === 'asc' ? 'A to Z' : 'Z to A';
}
