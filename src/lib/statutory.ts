/**
 * GST & TDS on a payment request — captured once, where the request is raised (Expenses › New
 * Request), carried into its Daily Requisition, and verified there instead of re-typed.
 *
 *   taxable value (the request amount)
 *   + GST            CGST + SGST inside the company's state, IGST across states; nil under reverse
 *                    charge (the company pays that GST to the government, not to the supplier)
 *   = invoice value
 *   − TDS            on the taxable value, excluding GST (CBDT Circular 23/2017)
 *   − retention, other deductions
 *   = net payable    what the bank pays the supplier; becomes the requisition's net amount
 *
 * Pure — no Firebase or React — so it runs under plain node for tests.
 */

export type GstType = 'cgst-sgst' | 'igst' | 'none';

/** The company's GST registration state (Odisha). A supplier in the same state charges CGST + SGST. */
export const COMPANY_GST_STATE_CODE = '21';

/** GST rates in use (0.25% and 3% for stones/metals; 40% for the demerit list from 22 Sep 2025). */
export const GST_RATES = [0, 0.25, 3, 5, 12, 18, 28, 40] as const;

export interface TdsSection {
  code: string;
  label: string;
  /** Standard rate for a resident payee with a valid PAN, % of the taxable value. */
  rate: number;
}

/** The sections a construction company's vendor payments usually fall under. The rate is editable. */
export const TDS_SECTIONS: TdsSection[] = [
  { code: 'none', label: 'No TDS', rate: 0 },
  { code: '194C-IND', label: '194C · Contractor — individual / HUF', rate: 1 },
  { code: '194C-OTH', label: '194C · Contractor — company / firm / others', rate: 2 },
  { code: '194J-PRO', label: '194J · Professional services', rate: 10 },
  { code: '194J-TEC', label: '194J · Technical services / royalty / call centre', rate: 2 },
  { code: '194I-PM', label: '194I · Rent — plant, machinery, equipment', rate: 2 },
  { code: '194I-LB', label: '194I · Rent — land, building, furniture', rate: 10 },
  { code: '194H', label: '194H · Commission / brokerage', rate: 2 },
  { code: '194Q', label: '194Q · Purchase of goods', rate: 0.1 },
  { code: '194A', label: '194A · Interest (other than on securities)', rate: 10 },
  { code: '206AA', label: '206AA · Payee has no PAN', rate: 20 },
];

export const tdsSection = (code: string | undefined) => TDS_SECTIONS.find((s) => s.code === code) ?? TDS_SECTIONS[0];

/** State / UT codes as printed in the first two digits of a GSTIN. */
export const GST_STATES: Record<string, string> = {
  '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand',
  '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim',
  '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya',
  '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh',
  '24': 'Gujarat', '26': 'Dadra & Nagar Haveli and Daman & Diu', '27': 'Maharashtra', '28': 'Andhra Pradesh (old)',
  '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry',
  '35': 'Andaman & Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh', '97': 'Other Territory',
  '99': 'Centre Jurisdiction',
};

const GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

export const normaliseTaxId = (value: string | undefined) => String(value ?? '').replace(/\s+/g, '').toUpperCase();

/** The GSTIN check character (its 15th), by the GSTN's mod-36 scheme. */
export function gstinCheckChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i += 1) {
    const product = GSTIN_CHARS.indexOf(first14[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return GSTIN_CHARS[(36 - (sum % 36)) % 36];
}

export interface GstinCheck {
  valid: boolean;
  /** Why not, in words a user can act on. */
  error?: string;
  stateCode?: string;
  stateName?: string;
  /** Characters 3–12 of a GSTIN are the holder's PAN. */
  pan?: string;
}

export function checkGstin(value: string | undefined): GstinCheck {
  const gstin = normaliseTaxId(value);
  if (!gstin) return { valid: false, error: 'Enter the supplier’s GSTIN.' };
  if (gstin.length !== 15) return { valid: false, error: `A GSTIN has 15 characters; this has ${gstin.length}.` };
  if (!GSTIN_PATTERN.test(gstin)) return { valid: false, error: 'Not a GSTIN: expected 2 digits, a PAN, an entity code, Z and a check character.' };
  const stateCode = gstin.slice(0, 2);
  if (!GST_STATES[stateCode]) return { valid: false, error: `State code ${stateCode} is not a GST state code.` };
  if (gstinCheckChar(gstin.slice(0, 14)) !== gstin[14]) return { valid: false, error: 'The last character does not match — check the GSTIN for a typo.' };
  return { valid: true, stateCode, stateName: GST_STATES[stateCode], pan: gstin.slice(2, 12) };
}

export const isValidPan = (value: string | undefined) => PAN_PATTERN.test(normaliseTaxId(value));

/** Inside the company's state → CGST + SGST; any other state → IGST. */
export const suggestGstType = (supplierStateCode: string | undefined): GstType =>
  !supplierStateCode ? 'cgst-sgst' : supplierStateCode === COMPANY_GST_STATE_CODE ? 'cgst-sgst' : 'igst';

export interface StatutoryInput {
  invoiceNo: string;
  /** yyyy-MM-dd */
  invoiceDate: string;
  gstType: GstType;
  gstRate: number;
  gstNo: string;
  panNo: string;
  hsnSac: string;
  reverseCharge: boolean;
  tdsSection: string;
  tdsRate: number;
  /** Set when the TDS amount was typed rather than worked out from the rate. */
  tdsOverride: number | null;
  retentionAmount: number;
  otherDeduction: number;
  otherDeductionReason: string;
}

export interface StatutoryTotals {
  taxable: number;
  igst: number;
  cgst: number;
  sgst: number;
  gst: number;
  /** Taxable + GST charged by the supplier (GST under reverse charge is not charged). */
  invoice: number;
  tds: number;
  retention: number;
  other: number;
  net: number;
}

/** What is stored on the expense request: the inputs, and the figures they came to. */
export interface ExpenseStatutory extends StatutoryInput {
  taxableAmount: number;
  igstAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  gstAmount: number;
  invoiceAmount: number;
  tdsAmount: number;
  netPayable: number;
}

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export const EMPTY_STATUTORY: StatutoryInput = {
  invoiceNo: '',
  invoiceDate: '',
  gstType: 'none',
  gstRate: 0,
  gstNo: '',
  panNo: '',
  hsnSac: '',
  reverseCharge: false,
  tdsSection: 'none',
  tdsRate: 0,
  tdsOverride: null,
  retentionAmount: 0,
  otherDeduction: 0,
  otherDeductionReason: '',
};

export function computeStatutory(taxableAmount: number, input: StatutoryInput): StatutoryTotals {
  const taxable = round2(taxableAmount);
  const rate = input.gstType === 'none' ? 0 : Math.max(0, Number(input.gstRate) || 0);
  let igst = 0;
  let cgst = 0;
  let sgst = 0;
  if (input.gstType === 'igst') igst = round2((taxable * rate) / 100);
  if (input.gstType === 'cgst-sgst') {
    cgst = round2((taxable * rate) / 200);
    sgst = cgst;
  }
  const gst = round2(igst + cgst + sgst);
  // Under reverse charge the supplier's invoice carries no GST for us to pay them.
  const invoice = round2(taxable + (input.reverseCharge ? 0 : gst));
  const tdsFromRate = input.tdsSection === 'none' ? 0 : round2((taxable * Math.max(0, Number(input.tdsRate) || 0)) / 100);
  const tds = input.tdsOverride !== null && input.tdsSection !== 'none' ? round2(Math.max(0, input.tdsOverride)) : tdsFromRate;
  const retention = round2(Math.max(0, Number(input.retentionAmount) || 0));
  const other = round2(Math.max(0, Number(input.otherDeduction) || 0));
  return { taxable, igst, cgst, sgst, gst, invoice, tds, retention, other, net: round2(invoice - tds - retention - other) };
}

/**
 * Problems that must be fixed before the request is saved. Nothing is required while GST and TDS
 * are both "none" and there are no deductions — the section is then simply not recorded.
 */
export function statutoryErrors(taxableAmount: number, input: StatutoryInput): Partial<Record<keyof StatutoryInput | 'net', string>> {
  const errors: Partial<Record<keyof StatutoryInput | 'net', string>> = {};
  const hasGst = input.gstType !== 'none';
  if (hasGst) {
    const check = checkGstin(input.gstNo);
    if (!check.valid) errors.gstNo = check.error;
    if (!(Number(input.gstRate) > 0)) errors.gstRate = 'Choose the GST rate on the invoice.';
    if (!input.invoiceNo.trim()) errors.invoiceNo = 'The invoice number is needed to claim input tax credit.';
    if (!input.invoiceDate) errors.invoiceDate = 'Enter the invoice date.';
    if (check.valid && check.stateCode) {
      const expected = suggestGstType(check.stateCode);
      if (expected !== input.gstType) {
        errors.gstType =
          expected === 'igst'
            ? `The supplier is in ${check.stateName}, outside Odisha — an inter-state supply takes IGST.`
            : 'The supplier is in Odisha — an intra-state supply takes CGST + SGST.';
      }
    }
  }
  if (input.tdsSection !== 'none') {
    // '' = TDS switched on but no section chosen yet.
    if (!input.tdsSection) errors.tdsSection = 'Choose the TDS section.';
    const pan = normaliseTaxId(input.panNo);
    if (input.tdsSection !== '206AA' && !isValidPan(pan)) errors.panNo = 'A valid PAN is needed for TDS (without one, TDS is 20% under 206AA).';
    if (!(Number(input.tdsRate) > 0) && input.tdsOverride === null) errors.tdsRate = 'Enter the TDS rate.';
  } else if (input.panNo.trim() && !isValidPan(input.panNo)) {
    errors.panNo = 'Not a PAN: 5 letters, 4 digits and a letter.';
  }
  if ((Number(input.otherDeduction) || 0) > 0 && !input.otherDeductionReason.trim()) errors.otherDeductionReason = 'Say what the other deduction is for.';
  if (computeStatutory(taxableAmount, input).net < 0) errors.net = 'Deductions come to more than the invoice value.';
  return errors;
}

/** Whether anything statutory has been entered at all (otherwise nothing is stored). */
export const hasStatutory = (input: StatutoryInput) =>
  input.gstType !== 'none' ||
  input.tdsSection !== 'none' ||
  (Number(input.retentionAmount) || 0) > 0 ||
  (Number(input.otherDeduction) || 0) > 0 ||
  Boolean(input.invoiceNo.trim() || input.invoiceDate || input.gstNo.trim() || input.panNo.trim() || input.hsnSac.trim());

/** The record stored on the expense request — inputs normalised, figures worked out. */
export function buildExpenseStatutory(taxableAmount: number, input: StatutoryInput): ExpenseStatutory {
  const totals = computeStatutory(taxableAmount, input);
  // Kept even without GST (an unregistered-supply record may still note it) — normalised either way.
  const gstNo = normaliseTaxId(input.gstNo);
  const derivedPan = checkGstin(gstNo).pan ?? '';
  return {
    ...input,
    invoiceNo: input.invoiceNo.trim(),
    gstNo,
    panNo: normaliseTaxId(input.panNo) || derivedPan,
    hsnSac: input.hsnSac.trim(),
    gstRate: input.gstType === 'none' ? 0 : Number(input.gstRate) || 0,
    tdsRate: input.tdsSection === 'none' ? 0 : Number(input.tdsRate) || 0,
    tdsOverride: input.tdsSection === 'none' ? null : input.tdsOverride,
    otherDeductionReason: input.otherDeductionReason.trim(),
    taxableAmount: totals.taxable,
    igstAmount: totals.igst,
    cgstAmount: totals.cgst,
    sgstAmount: totals.sgst,
    gstAmount: totals.gst,
    invoiceAmount: totals.invoice,
    tdsAmount: totals.tds,
    retentionAmount: totals.retention,
    otherDeduction: totals.other,
    netPayable: totals.net,
  };
}

/**
 * The fields a Daily Requisition created from this request starts with, named as the GST & TDS
 * verification step reads and writes them. Gross is the taxable value; net is what is payable.
 */
export function requisitionStatutoryFields(statutory: ExpenseStatutory) {
  return {
    grossAmount: statutory.taxableAmount,
    netAmount: statutory.netPayable,
    igstAmount: statutory.igstAmount,
    cgstAmount: statutory.cgstAmount,
    sgstAmount: statutory.sgstAmount,
    tdsAmount: statutory.tdsAmount,
    retentionAmount: statutory.retentionAmount,
    otherDeduction: statutory.otherDeduction,
    gstNo: statutory.gstNo,
    gstType: statutory.gstType,
    gstRate: statutory.gstRate,
    invoiceNo: statutory.invoiceNo,
    invoiceDate: statutory.invoiceDate,
    panNo: statutory.panNo,
    hsnSac: statutory.hsnSac,
    reverseCharge: statutory.reverseCharge,
    tdsSection: statutory.tdsSection,
    tdsRate: statutory.tdsRate,
    otherDeductionReason: statutory.otherDeductionReason,
  };
}
