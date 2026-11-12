/**
 * The bank account an expense request is paid into.
 *
 * Entered on New Request under the request details. When the party is an employee, the account is
 * filled from the Employee module (greytHR's bank record, via `/api/expenses/employee-bank`) and
 * stays editable: the employee record is where it starts, not a lock. Everything is kept in capital
 * letters, as the rest of the request is.
 *
 * Pure (no imports), so the page, the API route and the details dialog share one set of rules.
 */

export interface ExpenseBankDetails {
  accountHolderName: string;
  accountNumber: string;
  ifscCode: string;
  bankName: string;
  branchName: string;
}

export type ExpenseBankField = keyof ExpenseBankDetails;

export const BANK_FIELDS: readonly ExpenseBankField[] = [
  'accountHolderName',
  'accountNumber',
  'ifscCode',
  'bankName',
  'branchName',
];

export const EMPTY_BANK: ExpenseBankDetails = {
  accountHolderName: '',
  accountNumber: '',
  ifscCode: '',
  bankName: '',
  branchName: '',
};

/** Where the account on a request came from. */
export type ExpenseBankSource = 'employee' | 'manual';

/** What a saved request carries (`expenseRequests/{id}.bankDetails`). */
export interface StoredExpenseBank extends ExpenseBankDetails {
  source: ExpenseBankSource;
  /** The employee whose record filled it, when it was filled from the Employee module. */
  employeeId?: string;
  employeeNo?: string;
  /** Filled from the Employee module, then changed on the request before it was saved. */
  edited?: boolean;
}

/** The section's state on the form: the details plus where they came from. */
export interface ExpenseBankValue extends ExpenseBankDetails {
  /** '' while nothing has been entered or filled. */
  source: ExpenseBankSource | '';
  employeeId: string;
  employeeNo: string;
  edited: boolean;
}

export const EMPTY_BANK_VALUE: ExpenseBankValue = {
  ...EMPTY_BANK,
  source: '',
  employeeId: '',
  employeeNo: '',
  edited: false,
};

/** Four letters, a zero, six letters or digits: SBIN0001234. */
export const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;

export const isIfsc = (value: unknown): boolean => IFSC_PATTERN.test(String(value ?? '').trim().toUpperCase());

/** Capitals, single spaces, no padding — how every bank field is kept. */
const tidy = (value: unknown) => String(value ?? '').toUpperCase().replace(/\s+/g, ' ').trim();

/** The details as they are saved: capitals throughout, and no spaces inside the account number or IFSC. */
export function cleanBank(value: Partial<ExpenseBankDetails> | null | undefined): ExpenseBankDetails {
  return {
    accountHolderName: tidy(value?.accountHolderName),
    accountNumber: tidy(value?.accountNumber).replace(/\s/g, ''),
    ifscCode: tidy(value?.ifscCode).replace(/\s/g, ''),
    bankName: tidy(value?.bankName),
    branchName: tidy(value?.branchName),
  };
}

/** Whether anything at all has been entered. */
export const hasBank = (value: Partial<ExpenseBankDetails> | null | undefined): boolean =>
  BANK_FIELDS.some((field) => tidy(value?.[field]) !== '');

/** Whether two sets of details say the same thing, once tidied. */
export const sameBank = (a: Partial<ExpenseBankDetails>, b: Partial<ExpenseBankDetails>): boolean => {
  const left = cleanBank(a);
  const right = cleanBank(b);
  return BANK_FIELDS.every((field) => left[field] === right[field]);
};

/**
 * What stops the save. Bank details are optional — a bill can be raised before the account is
 * known — but once any are entered, the three a transfer cannot go without are required, and the
 * account number and IFSC must be shaped like one.
 */
export function bankErrors(value: Partial<ExpenseBankDetails> | null | undefined): Partial<Record<ExpenseBankField, string>> {
  if (!hasBank(value)) return {};
  const clean = cleanBank(value);
  const errors: Partial<Record<ExpenseBankField, string>> = {};
  if (!clean.accountHolderName) errors.accountHolderName = 'Enter the name on the account.';
  if (!clean.accountNumber) errors.accountNumber = 'Enter the account number.';
  else if (!/^[0-9]{6,20}$/.test(clean.accountNumber)) errors.accountNumber = 'An account number is 6 to 20 digits.';
  if (!clean.ifscCode) errors.ifscCode = 'Enter the IFSC code.';
  else if (!IFSC_PATTERN.test(clean.ifscCode)) errors.ifscCode = 'An IFSC is 11 characters, like SBIN0001234.';
  return errors;
}

/** What New Request saves on the request, or null when no bank details were entered. */
export function toStoredBank(value: ExpenseBankValue): StoredExpenseBank | null {
  if (!hasBank(value)) return null;
  const fromEmployee = value.source === 'employee' && !!value.employeeId;
  return {
    ...cleanBank(value),
    source: fromEmployee ? 'employee' : 'manual',
    ...(fromEmployee
      ? { employeeId: value.employeeId, employeeNo: value.employeeNo, edited: value.edited }
      : {}),
  };
}

/**
 * How a party name is compared with an employee's: capitals, and initials written "R.K." or
 * "R K" alike. A party typed in any case matches the employee it names.
 */
export const employeeNameKey = (name: unknown): string =>
  String(name ?? '')
    .toUpperCase()
    .replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/* ── the lookup's answer (/api/expenses/employee-bank) ───────────────────────────────────────── */

export interface EmployeeBankMatch {
  /** greytHR's employee id — the key the Employee module files everything under. */
  employeeId: string;
  employeeNo: string;
  name: string;
  department?: string;
  designation?: string;
  /** On greytHR's current roster; false for someone found only in the mirror (usually a leaver). */
  current: boolean;
}

export interface EmployeeBankLookup {
  ok: true;
  /** Every employee the name matches. More than one means the user has to say which. */
  matches: EmployeeBankMatch[];
  /** The employee the bank details below belong to: the only match, or the one asked for. */
  employee: EmployeeBankMatch | null;
  bank: ExpenseBankDetails | null;
  /** Read from the Employee module's stored record, or fetched from greytHR just now. */
  bankFrom: 'employee-module' | 'greythr' | null;
  /** Why there are no details, or why they may be incomplete. */
  note: string | null;
}
