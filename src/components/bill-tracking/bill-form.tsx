'use client';

/**
 * Create / edit a bill (`/bill-tracking/bills/new`, `/bill-tracking/bills/[id]/edit`).
 *
 * The calculation panel previews GST, deductions and net with the same functions the server uses,
 * but it is only a preview: the API recomputes every derived figure from the submitted source values
 * and ignores anything else. Editing sends the version the form loaded, so a bill changed by someone
 * else in the meantime is refused instead of silently overwritten.
 *
 * GST is entered as a type (CGST + SGST, IGST or none), a rate and the component amounts. The type is
 * suggested from the SEL registration that raises the bill and the client's state — the same
 * attribution chain the rest of the app uses — and can be changed. Percentage deductions follow their
 * configured base (e.g. Income TDS on taxable less mobilisation advance) as the figures change.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Calculator, ClipboardCheck, Plus, ReceiptIndianRupee, RotateCcw, Save } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader } from '@/components/shared/page-header';
import { useToast } from '@/hooks/use-toast';
import { addDays, deriveBillTotals, financialYearOf, isRetentionKind, protectedChanges } from '@/lib/bill-tracking/calculations';
import { amountsLocked, stepLabel } from '@/lib/bill-tracking/workflow';
import { categoryName, sortedCategories, subCategoriesFor } from '@/lib/bill-tracking/categories';
import type { CertificationComparison, SuggestedNote } from '@/lib/bill-tracking/certification';
import { computeDeductions, keepsIssuedLines, splitGst, suggestGst, totalFromComponents } from '@/lib/bill-tracking/gst';
import { formatINR, subtractMoney, sumMoney, toPaise } from '@/lib/bill-tracking/money';
import { noteDeductionBase, type GroupNote } from '@/lib/bill-tracking/note-rules';
import { formatRate } from '@/lib/bill-tracking/retention';
import { GST_RATES } from '@/lib/statutory';
import { cn } from '@/lib/utils';
import { GST_TYPE_LABELS, TRANSACTION_TYPE_LABELS, TRANSACTION_TYPES, type Bill, type BillDeduction, type BillTrackingConfig, type BillTransactionType, type GstType } from '@/lib/bill-tracking/types';

import { btFetch, useBt, useBtQuery, useLookups, type Lookups } from './bt-client';
import { Amount, BtError, BtLoading, FormField, FormSection, Notice, RupeeInput, Term, dateText, type FieldWidth } from './bt-ui';

/**
 * A form section's fields: one column on a phone, two on a tablet, three from a laptop, each field
 * one column wide and stretched to fill it. Fixed counts rather than auto-fill, and no field over two
 * columns: with those, the column count moved whenever the width shifted (a scrollbar, the side
 * panel) and a two-column field left a hole or dropped to a row of its own.
 */
const FORM_GRID = 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3';
/** The amounts row: taxable, the GST components, total GST and gross — all on one line when there is room. */
const AMOUNT_GRID = { 'cgst-sgst': 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5', igst: 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4', other: 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3' } as const;
import { DeductionEditor, deductionInputs as toDeductionInputs, emptyDeductionRow, num, rowsFromDeductions, str, type DeductionRow } from './deduction-editor';
import { listNames } from './note-rules-settings';

/** `legacy` = a bill imported with a single GST figure, not yet split. */
type GstChoice = GstType | 'legacy';

interface FormState {
  billSerialNumber: string;
  autoNumber: boolean;
  transactionType: BillTransactionType;
  againstBillId: string;
  gstInvoiceNumber: string;
  billDate: string;
  financialYear: string;
  submissionDate: string;
  passedDate: string;
  dueDate: string;
  expectedPaymentDate: string;
  projectId: string;
  clientId: string;
  dgmOffice: string;
  /** Picked by hand: a change of project keeps them. Otherwise they follow the project. */
  clientPicked: boolean;
  dgmPicked: boolean;
  description: string;
  /** Main category, chosen before the sub category. */
  categoryId: string;
  billTypeId: string;
  taxableAmount: string;
  /** '' = follow the suggestion. */
  gstType: GstChoice | '';
  gstRate: string;
  /** '' = the attribution chain decides. */
  gstRegistrationId: string;
  /** Component amounts typed by hand (from the invoice) instead of computed. */
  gstManual: boolean;
  /** The rate is typed ("Other") rather than picked from the standard rates. */
  gstRateCustom: boolean;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
  legacyGstAmount: string;
  deductions: DeductionRow[];
  targetWeek: string;
  collectionOwnerId: string;
  currentStage: string;
  remarks: string;
  retentionExpectedReleaseDate: string;
  /** Retention bill only: the retention head it releases ('' = not tied to a rate)… */
  releasesTypeId: string;
  /** …and the rate it was held at; '' = the head's fixed amounts. */
  releasesRate: string;
  taxableOrAdvance: string;
  changeReason: string;
}

interface InvoiceOption {
  id: string;
  billSerialNumber?: string;
  gstInvoiceNumber?: string;
  billDate: string;
  description?: string;
  billTypeId?: string;
  billTypeName: string;
  billCategory: string;
  taxableAmount: number;
  gstAmount: number;
  gstType?: GstType;
  gstPercent?: number;
  cgstAmount?: number;
  sgstAmount?: number;
  igstAmount?: number;
  grossAmount: number;
  netReceivable: number;
  /** The client has certified it — the note can be filled to match. */
  certified?: boolean;
  /** The deductions that apply to it (the certified ones once certified): what a note rule counts as held. */
  deductions?: BillDeduction[];
  /** The live notes against it, with their deductions: a note rule takes a debit note's of the invoice plus them. */
  notes?: GroupNote[];
}

/** What the bill page returns that the note form needs to match a certification. */
interface CertifiedInvoice {
  bill: Bill;
  certification: CertificationComparison | null;
}

const isNote = (type: BillTransactionType) => type === 'credit_note' || type === 'debit_note';

function fromBill(bill: Bill, config: BillTrackingConfig, lookups: Pick<Lookups, 'projects' | 'gstSetup'>): FormState {
  const project = lookups.projects.find((entry) => entry.id === bill.projectId);
  return {
    billSerialNumber: bill.billSerialNumber ?? '',
    autoNumber: false,
    transactionType: bill.transactionType,
    againstBillId: bill.againstBillId ?? '',
    gstInvoiceNumber: bill.gstInvoiceNumber ?? '',
    billDate: bill.billDate,
    // Only a year that differs from the bill date's is an override; otherwise a new date sets the year.
    financialYear: bill.financialYear && bill.financialYear !== financialYearOf(bill.billDate) ? bill.financialYear : '',
    submissionDate: bill.submissionDate ?? '',
    passedDate: bill.passedDate ?? '',
    dueDate: bill.dueDate ?? '',
    expectedPaymentDate: bill.expectedPaymentDate ?? '',
    projectId: bill.projectId,
    clientId: bill.clientId ?? '',
    dgmOffice: bill.dgmOffice ?? '',
    // Saved values that differ from the project's were picked by hand.
    clientPicked: Boolean(bill.clientId) && bill.clientId !== project?.clientId,
    dgmPicked: Boolean(bill.dgmOffice) && bill.dgmOffice !== project?.dgmOffice,
    description: bill.description ?? '',
    categoryId: config.billTypes.find((type) => type.id === bill.billTypeId)?.categoryId ?? bill.billCategory ?? '',
    billTypeId: bill.billTypeId ?? '',
    taxableAmount: String(bill.taxableAmount ?? ''),
    // A bill saved without a GST type keeps its single figure (none, for a non-GST row): never the
    // suggested type and rate, which would change it on a save that only meant to edit remarks.
    gstType: bill.gstType ?? 'legacy',
    gstRate: str(bill.gstPercent ?? config.settings.defaultGstRate),
    // The registration that raised it stays chosen (if still set up), so a save keeps it.
    gstRegistrationId: bill.gstRegistrationId && lookups.gstSetup?.registrations.some((entry) => entry.id === bill.gstRegistrationId) ? bill.gstRegistrationId : '',
    gstManual: Boolean(bill.gstType),
    gstRateCustom: bill.gstPercent !== undefined && !(GST_RATES as readonly number[]).includes(bill.gstPercent),
    cgstAmount: str(bill.cgstAmount),
    sgstAmount: str(bill.sgstAmount),
    igstAmount: str(bill.igstAmount),
    legacyGstAmount: String(bill.gstAmount ?? 0),
    deductions: rowsFromDeductions(bill.deductions ?? [], config.deductionTypes),
    targetWeek: bill.targetWeek ?? '',
    collectionOwnerId: bill.collectionOwnerId ?? '',
    currentStage: bill.currentStage ?? '',
    remarks: bill.remarks ?? '',
    retentionExpectedReleaseDate: bill.retentionExpectedReleaseDate ?? '',
    // Loaded so a save sends it back — an update rewrites the whole bill.
    releasesTypeId: bill.releasesRetention?.deductionTypeId ?? '',
    releasesRate: str(bill.releasesRetention?.rate ?? undefined),
    taxableOrAdvance: bill.taxableOrAdvance ?? '',
    changeReason: '',
  };
}

/**
 * The note that makes the raised bill plus its notes equal the client's certification: its type,
 * taxable and GST components. No deduction lines — the certified deductions already apply to the
 * invoice itself; a change of deductions takes no note.
 */
function withSuggestedNote(state: FormState, note: SuggestedNote, invoice: Pick<Bill, 'id' | 'projectId' | 'billTypeId' | 'billCategory'>, config: BillTrackingConfig): FormState {
  const type = config.billTypes.find((entry) => entry.id === invoice.billTypeId);
  return {
    ...state,
    transactionType: note.transactionType,
    againstBillId: invoice.id,
    projectId: invoice.projectId,
    categoryId: type?.categoryId ?? invoice.billCategory ?? state.categoryId,
    billTypeId: type?.id ?? state.billTypeId,
    taxableAmount: String(note.taxableAmount),
    gstType: note.gstType ?? 'legacy',
    gstRate: str(note.gstPercent ?? num(state.gstRate)),
    gstRateCustom: note.gstPercent !== undefined && !(GST_RATES as readonly number[]).includes(note.gstPercent),
    gstManual: Boolean(note.gstType),
    cgstAmount: str(note.cgstAmount),
    sgstAmount: str(note.sgstAmount),
    igstAmount: str(note.igstAmount),
    legacyGstAmount: String(note.gstAmount),
    deductions: [],
    description: note.description,
  };
}

/**
 * The suggested note with a saved note's own figures added back. The suggestion is what is still
 * unmatched with that note already counted, so the note itself must carry the suggestion plus what it
 * holds now. Null when the two cancel out: without the note the invoice already matches.
 */
function withSavedNote(note: SuggestedNote, saved: Bill): SuggestedNote | null {
  const add = (a: number | undefined, b: number | undefined) => (a === undefined && b === undefined ? undefined : sumMoney([a ?? 0, b ?? 0]));
  const taxableAmount = sumMoney([note.taxableAmount, saved.taxableAmount]);
  const gstAmount = sumMoney([note.gstAmount, saved.gstAmount]);
  if (toPaise(taxableAmount) === 0 && toPaise(gstAmount) === 0) return null;
  return {
    ...note,
    transactionType: taxableAmount < 0 || (toPaise(taxableAmount) === 0 && gstAmount < 0) ? 'credit_note' : 'debit_note',
    taxableAmount,
    gstAmount,
    cgstAmount: add(note.cgstAmount, saved.cgstAmount),
    sgstAmount: add(note.sgstAmount, saved.sgstAmount),
    igstAmount: add(note.igstAmount, saved.igstAmount),
    netAmount: sumMoney([taxableAmount, gstAmount]),
  };
}

export default function BillForm({ billId }: { billId?: string }) {
  const params = useSearchParams();
  const editing = Boolean(billId);
  // `?match=1&against=<bill>`: a note pre-filled to match that bill's client certification.
  const matchId = !billId && params.get('match') === '1' ? params.get('against') : null;
  const { data, loading, error } = useBtQuery<{ bill: Bill }>(billId ? `bills/${billId}` : null);
  const { data: matched, loading: matchLoading, error: matchError } = useBtQuery<CertifiedInvoice>(matchId ? `bills/${matchId}` : null);
  if (editing && loading) return <BtLoading label="Loading bill…" />;
  if (editing && error) return <BtError message={error} />;
  if (matchId && matchLoading) return <BtLoading label="Working out the note from the certification…" />;
  if (matchId && matchError) return <BtError message={matchError} />;
  const prefill = matched?.certification?.suggestedNote ? { note: matched.certification.suggestedNote, invoice: matched.bill } : undefined;
  return <BillFormInner key={data?.bill.id ?? (prefill ? `match-${matchId}` : 'new')} existing={data?.bill} prefill={prefill} />;
}

function BillFormInner({ existing, prefill }: { existing?: Bill; prefill?: { note: SuggestedNote; invoice: Bill } }) {
  const lookups = useLookups();
  const { can } = useBt();
  const router = useRouter();
  const params = useSearchParams();
  const { toast } = useToast();
  const { config } = lookups;
  const activeTypes = config.deductionTypes.filter((type) => type.active || existing?.deductions.some((line) => line.deductionTypeId === type.id));

  const [form, setForm] = useState<FormState>(() => {
    if (existing) return fromBill(existing, config, lookups);
    const blank: FormState = {
          billSerialNumber: '',
          autoNumber: config.settings.numbering.enabled,
          transactionType: (params.get('type') as BillTransactionType | null) ?? 'invoice',
          againstBillId: params.get('against') ?? '',
          gstInvoiceNumber: '',
          billDate: lookups.today,
          financialYear: '',
          submissionDate: '',
          passedDate: '',
          dueDate: '',
          expectedPaymentDate: '',
          projectId: params.get('project') ?? (lookups.projects.length === 1 ? lookups.projects[0].id : ''),
          clientId: '',
          dgmOffice: '',
          clientPicked: false,
          dgmPicked: false,
          description: '',
          categoryId: '',
          billTypeId: '',
          taxableAmount: '',
          gstType: '',
          gstRate: String(config.settings.defaultGstRate),
          gstRegistrationId: '',
          gstManual: false,
          gstRateCustom: false,
          cgstAmount: '',
          sgstAmount: '',
          igstAmount: '',
          legacyGstAmount: '0',
          deductions: [],
          targetWeek: '',
          collectionOwnerId: '',
          currentStage: '',
          remarks: '',
          retentionExpectedReleaseDate: '',
          releasesTypeId: '',
          releasesRate: '',
          taxableOrAdvance: '',
          changeReason: '',
        };
    return prefill ? withSuggestedNote(blank, prefill.note, prefill.invoice, config) : blank;
  });
  /** Set when the figures came from a client certification — said so above the form. */
  const [matchedFrom, setMatchedFrom] = useState<string | null>(() => (prefill ? prefill.invoice.gstInvoiceNumber || prefill.invoice.billSerialNumber || 'the invoice' : null));
  const [matching, setMatching] = useState(false);
  const [saving, setSaving] = useState(false);
  // Dates & planning is optional, so it starts folded; its header lists whatever is set inside.
  const [planningOpen, setPlanningOpen] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((current) => ({ ...current, [key]: value }));

  const project = lookups.projects.find((entry) => entry.id === form.projectId);
  // A sub category already on the bill stays selectable on its own project even if since narrowed.
  const keepTypeFor = (projectId: string) => (existing && existing.projectId === projectId ? existing.billTypeId : undefined);
  const subCategories = subCategoriesFor(config.billTypes, form.categoryId, form.projectId, keepTypeFor(form.projectId));
  const clientId = form.clientId || project?.clientId || '';
  const client = lookups.clients.find((entry) => entry.id === clientId);

  const changeProject = (projectId: string) =>
    setForm((current) => {
      const next = lookups.projects.find((entry) => entry.id === projectId);
      return {
        ...current,
        projectId,
        // The client and DGM office follow the project unless picked by hand; blank = the project's.
        clientId: current.clientPicked ? current.clientId : next?.clientId || '',
        dgmOffice: current.dgmPicked ? current.dgmOffice : next?.dgmOffice || '',
        billTypeId: subCategoriesFor(config.billTypes, current.categoryId, projectId, keepTypeFor(projectId)).some((type) => type.id === current.billTypeId) ? current.billTypeId : '',
        againstBillId: '',
      };
    });

  /* ── GST ──────────────────────────────────────────────────────────────── */
  const taxable = num(form.taxableAmount);
  const suggestion = suggestGst(lookups.gstSetup, { projectId: form.projectId || undefined, chosenRegistrationId: form.gstRegistrationId || undefined, clientGstin: client?.gstin });
  const gstChoice: GstChoice = form.gstType || suggestion.gstType;
  const rate = gstChoice === 'none' || gstChoice === 'legacy' ? 0 : num(form.gstRate);
  const computedGst = splitGst(taxable, gstChoice === 'legacy' ? 'none' : gstChoice, rate);
  const components =
    gstChoice === 'legacy'
      ? { cgstAmount: 0, sgstAmount: 0, igstAmount: 0 }
      : form.gstManual
        ? { cgstAmount: num(form.cgstAmount), sgstAmount: num(form.sgstAmount), igstAmount: num(form.igstAmount) }
        : { cgstAmount: computedGst.cgstAmount, sgstAmount: computedGst.sgstAmount, igstAmount: computedGst.igstAmount };
  const gstTotal = gstChoice === 'legacy' ? num(form.legacyGstAmount) : totalFromComponents(gstChoice, components);
  const editComponent = (key: 'cgstAmount' | 'sgstAmount' | 'igstAmount', value: string) =>
    setForm((current) => ({
      ...current,
      gstManual: true,
      // Typing one component starts from the computed figures for the others.
      cgstAmount: current.gstManual ? current.cgstAmount : str(computedGst.cgstAmount),
      sgstAmount: current.gstManual ? current.sgstAmount : str(computedGst.sgstAmount),
      igstAmount: current.gstManual ? current.igstAmount : str(computedGst.igstAmount),
      [key]: value,
    }));

  /* ── credit / debit note: the invoice it is against ───────────────────── */
  const note = isNote(form.transactionType);
  // The invoice the note was opened with is always listed, however old (the list holds the 200 latest).
  // Fixed for the form's life, so picking another invoice does not reload the list.
  const [linkedInvoiceId] = useState(() => existing?.againstBillId ?? prefill?.invoice.id ?? (params.get('against') || ''));
  const { data: invoiceData, loading: invoicesLoading } = useBtQuery<{ bills: InvoiceOption[] }>(
    note && form.projectId ? `bills/invoices?project=${form.projectId}${existing ? `&exclude=${existing.id}` : ''}${linkedInvoiceId ? `&include=${linkedInvoiceId}` : ''}` : null,
  );
  const invoices = invoiceData?.bills ?? [];
  const againstInvoice = invoices.find((invoice) => invoice.id === form.againstBillId);
  const againstReference = againstInvoice ? againstInvoice.gstInvoiceNumber || againstInvoice.billSerialNumber : undefined;

  /* ── deductions ───────────────────────────────────────────────────────── */
  const gross = Math.round((taxable + gstTotal) * 100) / 100;
  const deductionInputs = toDeductionInputs(form.deductions);
  // GST on a deduction is split like the bill's own: IGST on an IGST bill, otherwise CGST + SGST.
  const deductionGstType: GstType = gstChoice === 'igst' ? 'igst' : 'cgst-sgst';
  // A debit note under a note rule takes the rule's heads of the invoice plus its notes, as the server will.
  const noteBase = noteDeductionBase(config.settings.noteRules, { id: existing?.id, transactionType: form.transactionType, billDate: form.billDate, createdAt: existing?.createdAt, taxableAmount: taxable, gstAmount: gstTotal }, againstInvoice, againstInvoice?.notes ?? [], config.deductionTypes);
  // An edit that changes neither the lines nor the figures they were worked out on keeps them as issued,
  // as the server will (`keepsIssuedLines`) — so the preview shows what will actually be saved.
  const keepLines =
    existing !== undefined &&
    keepsIssuedLines(
      existing,
      {
        transactionType: form.transactionType,
        billDate: form.billDate,
        againstBillId: note ? form.againstBillId || undefined : undefined,
        gstType: gstChoice === 'legacy' ? undefined : gstChoice,
        taxableAmount: taxable,
        gstAmount: gstTotal,
        cgstAmount: components.cgstAmount,
        sgstAmount: components.sgstAmount,
        igstAmount: components.igstAmount,
      },
      deductionInputs,
    );
  const deductionLines = keepLines && existing ? existing.deductions : computeDeductions(deductionInputs, config.deductionTypes, { taxable, gross, roundToRupee: config.settings.roundDeductionsToRupee, gstType: deductionGstType, invoiceBase: noteBase });
  const ruleHeadNames = (noteBase?.deductionTypeIds ?? []).flatMap((id) => config.deductionTypes.find((type) => type.id === id)?.name ?? []);
  const ruleHeads = listNames(ruleHeadNames, Infinity) || 'Its deductions';

  // The rows are the deductions as raised. Once the client has certified the bill its certified
  // deductions apply instead, so the net and outstanding previewed follow them, as the server's will.
  const certification = existing?.certification;
  const totals = deriveBillTotals(
    { taxableAmount: taxable, gstAmount: gstTotal, deductions: deductionLines, collections: existing?.collections ?? [], certification, paymentStatusOverride: existing?.paymentStatusOverride },
    { tolerance: config.settings.tolerance, roundNetToRupee: config.settings.roundNetToRupee },
  );

  const addDeduction = () => setForm((current) => ({ ...current, deductions: [...current.deductions, emptyDeductionRow()] }));
  const setDeductionRows = (update: (rows: DeductionRow[]) => DeductionRow[]) => setForm((current) => ({ ...current, deductions: update(current.deductions) }));

  /* ── credit / debit note ──────────────────────────────────────────────── */
  const creditFullInvoice = (invoice: InvoiceOption) =>
    setForm((current) => {
      const type = config.billTypes.find((entry) => entry.id === invoice.billTypeId);
      const split = Boolean(invoice.gstType);
      return {
        ...current,
        taxableAmount: String(-invoice.taxableAmount),
        gstType: invoice.gstType ?? 'legacy',
        gstRate: str(invoice.gstPercent ?? num(current.gstRate)),
        gstManual: split,
        cgstAmount: str(invoice.cgstAmount !== undefined ? -invoice.cgstAmount : undefined),
        sgstAmount: str(invoice.sgstAmount !== undefined ? -invoice.sgstAmount : undefined),
        igstAmount: str(invoice.igstAmount !== undefined ? -invoice.igstAmount : undefined),
        legacyGstAmount: String(-invoice.gstAmount),
        categoryId: current.categoryId || type?.categoryId || invoice.billCategory,
        billTypeId: current.billTypeId || (type ? type.id : ''),
        description: current.description || `Credit against invoice ${invoice.gstInvoiceNumber || invoice.billSerialNumber}`,
      };
    });

  const matchCertification = async (invoice: InvoiceOption) => {
    setMatching(true);
    try {
      const detail = await btFetch<CertifiedInvoice>(`bills/${invoice.id}`);
      const suggestion = detail.certification?.suggestedNote;
      if (!suggestion) {
        toast({
          title: detail.certification?.summary.state === 'matched' ? 'Already matched' : 'Nothing to match',
          description: detail.certification?.summary.state === 'matched' ? 'This invoice and its notes already match the client certification in taxable and GST. Its certified deductions apply without a note.' : 'The client has not certified this invoice yet.',
        });
        return;
      }
      // Editing a note already counted against this invoice: the suggestion leaves its saved figures in,
      // so add them back — the note carries the whole difference, not just what is left over.
      const counted = existing && isNote(existing.transactionType) && existing.againstBillId === invoice.id && !existing.outsideCertification;
      const target = counted ? withSavedNote(suggestion, existing) : suggestion;
      if (!target) {
        toast({ title: 'This note is not needed', description: 'Without it, the invoice and its other notes already match the client certification in taxable and GST.' });
        return;
      }
      // Only the taxable and GST are filled: deduction lines and a description already entered stay.
      setForm((current) => ({ ...withSuggestedNote(current, target, detail.bill, config), deductions: current.deductions, description: current.description || target.description }));
      setMatchedFrom(invoice.gstInvoiceNumber || invoice.billSerialNumber || 'the invoice');
    } catch (caught) {
      toast({ title: 'Could not load the certification', description: caught instanceof Error ? caught.message : String(caught), variant: 'destructive' });
    } finally {
      setMatching(false);
    }
  };

  /* ── retention bill: the retention it releases ────────────────────────── */
  // The server's own test: the sub category is a retention bill, or the bill is entered as one.
  const billType = config.billTypes.find((type) => type.id === form.billTypeId);
  const isRetention = form.transactionType === 'retention_bill' || Boolean(billType?.isRetentionBill);
  const savedReleaseTypeId = existing?.releasesRetention?.deductionTypeId;
  const retentionTypes = config.deductionTypes.filter((type) => isRetentionKind(type.kind) && (type.active || type.id === savedReleaseTypeId)).sort((a, b) => a.sequence - b.sequence);
  const releaseType = config.deductionTypes.find((type) => type.id === form.releasesTypeId);
  // "30" or "30%"; blank = the head's fixed amounts.
  const releaseRate = form.releasesRate.trim() === '' ? null : Number(form.releasesRate.replace(/[%\s]/g, ''));
  const releaseRateInvalid = isRetention && Boolean(form.releasesTypeId) && releaseRate !== null && !(Number.isFinite(releaseRate) && releaseRate > 0 && releaseRate <= 100);
  const rateSuggestions = [...new Set([releaseType?.defaultPercent, 10, 30].filter((value): value is number => typeof value === 'number'))];
  const releaseHint = !form.releasesTypeId
    ? 'Which retention this bill recovers. Receipts on it then release that retention, rate by rate.'
    : releaseRateInvalid
      ? undefined
      : `Receipts on this bill release ${releaseType?.name ?? 'this head'}${releaseRate === null ? ' · fixed amount' : ` @ ${formatRate(releaseRate)}%`}.`;

  /* ── dates ────────────────────────────────────────────────────────────── */
  const creditDays = project?.creditDays ?? client?.paymentTermsDays ?? config.settings.defaultCreditDays;
  const computedDue = form.billDate ? addDays(form.submissionDate || form.billDate, creditDays) : '';
  const derivedFy = form.billDate ? financialYearOf(form.billDate) : '';

  // The lock and the change check are the server's own (`amountsLocked`, `protectedChanges`), run on the
  // bill as this form will send it — so the reason box shows exactly when the server will ask for one.
  const locked = Boolean(existing && amountsLocked(existing, config.settings));
  const preview = {
    taxableAmount: taxable,
    gstType: gstChoice === 'legacy' ? undefined : gstChoice,
    gstAmount: gstTotal,
    cgstAmount: gstChoice === 'cgst-sgst' ? components.cgstAmount : 0,
    sgstAmount: gstChoice === 'cgst-sgst' ? components.sgstAmount : 0,
    igstAmount: gstChoice === 'igst' ? components.igstAmount : 0,
    // The server stores the registration the attribution chain resolves — the chosen one, if any — but
    // leaves a bill stored without one (imported rows) without, until someone chooses one.
    gstRegistrationId: existing && !existing.gstRegistrationId && !form.gstRegistrationId ? undefined : suggestion.registration?.id,
    deductions: deductionLines,
    gstInvoiceNumber: form.gstInvoiceNumber,
    billDate: form.billDate,
    projectId: form.projectId,
    transactionType: form.transactionType,
    againstBillId: note ? form.againstBillId || undefined : undefined,
  };
  const protectedChanged = existing && locked ? protectedChanges(existing, preview).length > 0 : false;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (releaseRateInvalid) {
      setSaveError('The retention rate this bill releases must be above 0 and up to 100 — or blank for the head’s fixed amounts.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    const body = {
      billSerialNumber: form.autoNumber && !existing ? undefined : form.billSerialNumber,
      autoNumber: !existing && form.autoNumber,
      serialNumber: existing?.serialNumber,
      transactionType: form.transactionType,
      againstBillId: note ? form.againstBillId || undefined : undefined,
      gstInvoiceNumber: form.gstInvoiceNumber,
      billDate: form.billDate,
      financialYear: form.financialYear || undefined,
      submissionDate: form.submissionDate,
      passedDate: form.passedDate,
      dueDate: existing ? undefined : form.dueDate,
      expectedPaymentDate: form.expectedPaymentDate,
      projectId: form.projectId,
      clientId: form.clientId || undefined,
      dgmOffice: form.dgmOffice,
      description: form.description,
      billTypeId: form.billTypeId,
      taxableAmount: taxable,
      gstType: gstChoice === 'legacy' ? undefined : gstChoice,
      gstPercent: gstChoice === 'legacy' ? undefined : rate,
      gstAmount: gstTotal,
      cgstAmount: gstChoice === 'cgst-sgst' ? components.cgstAmount : undefined,
      sgstAmount: gstChoice === 'cgst-sgst' ? components.sgstAmount : undefined,
      igstAmount: gstChoice === 'igst' ? components.igstAmount : undefined,
      gstRegistrationId: form.gstRegistrationId || undefined,
      deductions: deductionInputs,
      targetWeek: form.targetWeek,
      collectionOwnerId: form.collectionOwnerId || undefined,
      currentStage: form.currentStage,
      remarks: form.remarks,
      retentionExpectedReleaseDate: form.retentionExpectedReleaseDate,
      // Always sent for a retention bill: an update rewrites the whole bill, so leaving it out drops it.
      releasesRetention: isRetention && form.releasesTypeId ? { deductionTypeId: form.releasesTypeId, rate: releaseRate } : undefined,
      taxableOrAdvance: form.taxableOrAdvance,
      changeReason: form.changeReason,
      expectedVersion: existing?.version,
    };
    try {
      const result = existing ? await btFetch<{ id: string }>(`bills/${existing.id}`, { method: 'PUT', body }) : await btFetch<{ id: string }>('bills', { body });
      toast({ title: existing ? 'Bill updated' : 'Bill created' });
      router.push(`/bill-tracking/bills/${result.id}`);
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : 'Could not save the bill.');
      setSaving(false);
    }
  };

  // Every field takes one column of its section's grid (FORM_GRID); `width` is kept for the call sites.
  const field = (label: React.ReactNode, control: React.ReactNode, hint?: React.ReactNode, id?: string, width?: FieldWidth, info?: React.ReactNode) => (
    <FormField label={label} hint={hint} info={info} htmlFor={id}>
      {control}
    </FormField>
  );

  // What Dates & planning holds, for its folded header — the due date it will get, always.
  const ownerName = lookups.users.find((user) => user.id === form.collectionOwnerId)?.name;
  const planningParts = [
    existing ? `Due ${dateText(existing.dueDate)}` : form.dueDate ? `Due ${dateText(form.dueDate)}` : computedDue ? `Due ${dateText(computedDue)} (${creditDays} credit days)` : null,
    form.submissionDate ? `Submitted ${dateText(form.submissionDate)}` : null,
    form.passedDate ? `Passed ${dateText(form.passedDate)}` : null,
    form.expectedPaymentDate ? `Payment expected ${dateText(form.expectedPaymentDate)}` : null,
    ownerName ? `Owner: ${ownerName}` : null,
    form.currentStage ? `Stage: ${form.currentStage}` : null,
    form.targetWeek ? `Target ${form.targetWeek}` : null,
    form.taxableOrAdvance ? `Bill / PI: ${form.taxableOrAdvance}` : null,
    form.remarks.trim() ? 'Remarks added' : null,
  ].filter((part): part is string => Boolean(part));
  const planningSummary = planningParts.length ? (
    <span className="flex flex-wrap gap-1.5">
      {planningParts.map((part) => (
        <span key={part} className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-600">
          {part}
        </span>
      ))}
    </span>
  ) : (
    'Nothing set yet — the due date will come from the bill date and the credit days.'
  );

  const canSave = existing ? can('Bills', 'Edit') : can('Bills', 'Add');
  const needsInvoice = form.transactionType === 'credit_note' && existing?.source !== 'excel_import';
  const registrations = lookups.gstSetup?.registrations ?? [];

  return (
    <form onSubmit={submit} className="space-y-4">
      <PageHeader
        icon={ReceiptIndianRupee}
        title={existing ? `Edit bill ${existing.billSerialNumber ?? ''}` : form.transactionType === 'credit_note' ? 'New credit note' : 'New bill'}
        backHref={existing ? `/bill-tracking/bills/${existing.id}` : '/bill-tracking/bills'}
        backLabel={existing ? 'Bill' : 'Bill register'}
        description={existing?.source === 'excel_import' ? 'Imported from the legacy workbook — the original bill number is preserved.' : undefined}
      />

      {matchedFrom ? (
        <Notice tone="blue" title={`Filled to match the client certification of ${matchedFrom}`}>
          Taxable and GST are entered as the difference between the certification and the raised bill (less any notes already raised). The note carries no deductions: the client’s certified deductions already apply to the invoice. Check the figures against the client’s certificate, add the note number and date, then save — the invoice will then show as matched.
        </Notice>
      ) : null}

      {existing?.certification ? (
        <Notice tone="blue" title="The client has certified this bill">
          This form changes the bill as raised. The client’s certified figures are kept separately (bill page → Certification): its certified deductions set what it pays, and its taxable and GST are compared against whatever you save here.
        </Notice>
      ) : null}

      {existing && locked ? (
        <Notice tone="amber" title={`This bill is at “${stepLabel(config.settings, existing.workflowStatus)}”`}>
          Once a bill reaches the step that locks its amounts (Approved, by default) or is raised, changing amounts, GST, deductions, the invoice number, date, project or the invoice a note is against needs the <b>Edit After Approval</b> permission and a reason. Other fields can be edited freely.
        </Notice>
      ) : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4">
          <FormSection step={1} title="Identification" description="The bill and GST invoice numbers, the bill date and what kind of document it is.">
              <div className={FORM_GRID}>
                {field(
                  'Bill number',
                  existing || !config.settings.numbering.enabled || !form.autoNumber ? (
                    <Input id="billSerialNumber" value={form.billSerialNumber} onChange={(event) => set('billSerialNumber', event.target.value)} placeholder="e.g. 175" />
                  ) : (
                    <div className="flex h-10 items-center rounded-md border border-dashed px-3 text-sm text-muted-foreground">Generated on save ({config.settings.numbering.pattern})</div>
                  ),
                  !existing && config.settings.numbering.enabled ? undefined : existing?.source === 'excel_import' ? 'Legacy number — kept as imported.' : undefined,
                  'billSerialNumber',
                  'wide',
                )}
                {!existing && config.settings.numbering.enabled
                  ? field(
                      'Auto-number',
                      <div className="flex h-10 items-center gap-2">
                        <Switch checked={form.autoNumber} onCheckedChange={(value) => set('autoNumber', value)} aria-label="Generate the bill number" />
                        <span className="text-sm text-muted-foreground">{form.autoNumber ? 'Generate' : 'Type my own'}</span>
                      </div>,
                      undefined,
                      undefined,
                      'date',
                    )
                  : null}
                {field('GST invoice / note no.', <Input id="gst-invoice" value={form.gstInvoiceNumber} onChange={(event) => set('gstInvoiceNumber', event.target.value)} placeholder="Leave blank for non-GST (NA)" />, undefined, 'gst-invoice', 'medium')}
                {field('Bill date *', <Input id="bill-date" type="date" required value={form.billDate} onChange={(event) => set('billDate', event.target.value)} />, derivedFy ? `FY ${derivedFy}` : undefined, 'bill-date', 'date')}
                {field(
                  'Transaction type',
                  <Select value={form.transactionType} onValueChange={(value) => setForm((current) => ({ ...current, transactionType: value as BillTransactionType, againstBillId: isNote(value as BillTransactionType) ? current.againstBillId : '' }))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TRANSACTION_TYPES.map((type) => (
                        <SelectItem key={type} value={type}>
                          {TRANSACTION_TYPE_LABELS[type]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>,
                  undefined,
                  undefined,
                  'medium',
                )}
                {can('Bills', 'Approve')
                  ? field(
                      'Financial year override',
                      <Input value={form.financialYear} onChange={(event) => set('financialYear', event.target.value)} placeholder={derivedFy || '2026-27'} />,
                      'Normally taken from the bill date.',
                      undefined,
                      'date',
                    )
                  : null}
              </div>
          </FormSection>

          <FormSection step={2} title="Project & category" description="Choose the main category first — its sub categories are the ones enabled for the project.">
              <div className={FORM_GRID}>
                {field(
                  'Project *',
                  <Select value={form.projectId} onValueChange={changeProject}>
                    <SelectTrigger aria-label="Project">
                      <SelectValue placeholder="Choose a project" />
                    </SelectTrigger>
                    <SelectContent className="max-h-80">
                      {lookups.projects
                        .filter((entry) => entry.status !== 'Inactive' || entry.id === form.projectId)
                        .map((entry) => (
                          <SelectItem key={entry.id} value={entry.id}>
                            {entry.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>,
                  lookups.projects.length === 0 ? 'No projects are assigned to you in Access Management.' : undefined,
                  undefined,
                  'wide',
                )}
                {field(
                  'Main category *',
                  <Select value={form.categoryId} onValueChange={(value) => setForm((current) => ({ ...current, categoryId: value, billTypeId: '' }))}>
                    <SelectTrigger aria-label="Main category">
                      <SelectValue placeholder="Choose main category" />
                    </SelectTrigger>
                    <SelectContent className="max-h-80">
                      {sortedCategories(config.billCategories)
                        .filter((category) => category.active || category.id === form.categoryId)
                        .map((category) => (
                          <SelectItem key={category.id} value={category.id}>
                            {category.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>,
                  undefined,
                  undefined,
                  'medium',
                )}
                {field(
                  'Sub category *',
                  <Select value={form.billTypeId} onValueChange={(value) => set('billTypeId', value)} disabled={!form.categoryId || !form.projectId}>
                    <SelectTrigger aria-label="Sub category">
                      <SelectValue placeholder={!form.projectId ? 'Choose the project first' : !form.categoryId ? 'Choose the main category first' : subCategories.length ? 'Choose sub category' : 'None for this project'} />
                    </SelectTrigger>
                    <SelectContent className="max-h-80">
                      {subCategories.map((type) => (
                        <SelectItem key={type.id} value={type.id}>
                          {type.name}
                          {type.isRetentionBill ? ' · retention' : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>,
                  form.projectId && form.categoryId && subCategories.length === 0 ? `No sub categories under ${categoryName(form.categoryId, config.billCategories)} are enabled for this project — add one in Settings → Bill categories.` : undefined,
                  undefined,
                  'medium',
                )}
                {field(
                  'Client',
                  <Select value={form.clientId || 'none'} onValueChange={(value) => setForm((current) => ({ ...current, clientId: value === 'none' ? '' : value, clientPicked: value !== 'none' }))}>
                    <SelectTrigger aria-label="Client">
                      <SelectValue placeholder="From project" />
                    </SelectTrigger>
                    <SelectContent className="max-h-80">
                      <SelectItem value="none">{project?.clientName ? `From project (${project.clientName})` : 'None'}</SelectItem>
                      {lookups.clients.map((entry) => (
                        <SelectItem key={entry.id} value={entry.id}>
                          {entry.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>,
                  client ? (client.gstin ? `GSTIN ${client.gstin}` : 'No GSTIN on the client master') : undefined,
                  undefined,
                  'wide',
                )}
                {field('DGM office', <Input value={form.dgmOffice} onChange={(event) => setForm((current) => ({ ...current, dgmOffice: event.target.value, dgmPicked: event.target.value.trim() !== '' }))} placeholder={project?.dgmOffice ?? 'e.g. Rayagada'} list="bt-dgm-offices" />, undefined, undefined, 'medium')}
                <datalist id="bt-dgm-offices">
                  {lookups.dgmOffices.map((office) => (
                    <option key={office} value={office} />
                  ))}
                </datalist>
                {field('Description', <Input value={form.description} onChange={(event) => set('description', event.target.value)} placeholder="e.g. RA Bill 4 — civil works" />, undefined, undefined, 'grow')}
              </div>

              {/* One invoice often holds retention at two rates (10% and 30%); a retention bill says which one it recovers. */}
              {isRetention ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                  <div className={FORM_GRID}>
                    {field(
                      'Releases retention',
                      <Select value={form.releasesTypeId || 'none'} onValueChange={(value) => set('releasesTypeId', value === 'none' ? '' : value)}>
                        <SelectTrigger id="releases-type" aria-label="Retention this bill releases">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="max-h-80">
                          <SelectItem value="none">Not tied to a rate</SelectItem>
                          {retentionTypes.map((type) => (
                            <SelectItem key={type.id} value={type.id}>
                              {type.name}
                              {type.active ? '' : ' · inactive'}
                            </SelectItem>
                          ))}
                          {form.releasesTypeId && !retentionTypes.some((type) => type.id === form.releasesTypeId) ? <SelectItem value={form.releasesTypeId}>{releaseType?.name ?? 'A removed head'} — choose another</SelectItem> : null}
                        </SelectContent>
                      </Select>,
                      releaseHint,
                      'releases-type',
                      'wide',
                    )}
                    {field(
                      'Rate %',
                      <Input id="releases-rate" inputMode="decimal" list="bt-release-rates" placeholder="Fixed" disabled={!form.releasesTypeId} value={form.releasesRate} onChange={(event) => set('releasesRate', event.target.value)} />,
                      releaseRateInvalid ? <span className="text-rose-700">Above 0 and up to 100.</span> : 'Blank = the head’s fixed amounts.',
                      'releases-rate',
                      'short',
                    )}
                    <datalist id="bt-release-rates">
                      {rateSuggestions.map((value) => (
                        <option key={value} value={String(value)} />
                      ))}
                    </datalist>
                  </div>
                </div>
              ) : null}

              {note ? (
                <div className="rounded-lg border border-violet-200 bg-violet-50/60 p-3">
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                    {field(
                      `Against invoice${needsInvoice ? ' *' : ''}`,
                      <Select value={form.againstBillId || 'none'} onValueChange={(value) => set('againstBillId', value === 'none' ? '' : value)} disabled={!form.projectId}>
                        <SelectTrigger aria-label="Against invoice">
                          <SelectValue placeholder={!form.projectId ? 'Choose the project first' : invoicesLoading ? 'Loading invoices…' : 'Choose the invoice'} />
                        </SelectTrigger>
                        <SelectContent className="max-h-80">
                          <SelectItem value="none">{needsInvoice ? '— choose the invoice —' : 'Not linked'}</SelectItem>
                          {invoices.map((invoice) => (
                            <SelectItem key={invoice.id} value={invoice.id}>
                              {invoice.gstInvoiceNumber || invoice.billSerialNumber || 'No number'} · {dateText(invoice.billDate)} · {formatINR(invoice.grossAmount)} · {invoice.billTypeName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>,
                      form.projectId && !invoicesLoading && invoices.length === 0
                        ? 'This project has no invoices to raise a note against.'
                        : form.transactionType === 'credit_note'
                          ? 'A credit note reduces what is receivable on this project; enter its amounts as negative values.'
                          : 'A debit note adds to what is receivable; linking it to an invoice is optional.',
                    )}
                    {againstInvoice && (againstInvoice.certified || form.transactionType === 'credit_note') ? (
                      <div className="flex flex-wrap gap-2">
                        {againstInvoice.certified ? (
                          <Button type="button" variant="outline" className="gap-1.5 border-violet-300 text-violet-800" disabled={matching} onClick={() => void matchCertification(againstInvoice)}>
                            <ClipboardCheck className="h-4 w-4" /> {matching ? 'Working it out…' : 'Match the client certification'}
                          </Button>
                        ) : null}
                        {form.transactionType === 'credit_note' ? (
                          <Button type="button" variant="outline" className="gap-1.5" onClick={() => creditFullInvoice(againstInvoice)}>
                            <RotateCcw className="h-4 w-4" /> Credit the full invoice
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  {againstInvoice ? (
                    <p className="mt-2 text-xs text-violet-900">
                      Invoice {againstInvoice.gstInvoiceNumber || againstInvoice.billSerialNumber}: taxable {formatINR(againstInvoice.taxableAmount)}, GST {formatINR(againstInvoice.gstAmount)}, net {formatINR(againstInvoice.netReceivable)}
                      {againstInvoice.certified ? ' after the client’s certified deductions' : ''}.
                    </p>
                  ) : null}
                </div>
              ) : null}
          </FormSection>

          {/*
            Two parts, as the client's certification form has them. First how GST is charged — the
            registration, the type and the rate — with why beneath. Then the amounts as the invoice
            reads them, left to right: taxable, each GST component, total GST and the gross they
            make, each a right-aligned rupee figure.
          */}
          <FormSection step={3} title="Amount & GST" description="The registration and client GSTIN decide CGST + SGST or IGST; type over a component to match the invoice.">
              <div className={FORM_GRID}>
                {field(
                  'SEL GST registration',
                  <Select value={form.gstRegistrationId || 'auto'} onValueChange={(value) => set('gstRegistrationId', value === 'auto' ? '' : value)}>
                    <SelectTrigger aria-label="SEL GST registration">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      <SelectItem value="auto">Automatic{suggestion.registration && !form.gstRegistrationId ? ` (${suggestion.registration.label || suggestion.registration.stateName})` : ''}</SelectItem>
                      {registrations.map((registration) => (
                        <SelectItem key={registration.id} value={registration.id}>
                          {registration.label || registration.stateName} · {registration.gstin}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>,
                  registrations.length ? undefined : 'No registrations set up in Expenses → GST registrations.',
                  undefined,
                  'wide',
                )}
                {field(
                  'GST type',
                  <Select value={gstChoice} onValueChange={(value) => setForm((current) => ({ ...current, gstType: value as GstChoice, gstManual: false }))}>
                    <SelectTrigger aria-label="GST type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(['cgst-sgst', 'igst', 'none'] as GstType[]).map((type) => (
                        <SelectItem key={type} value={type}>
                          {GST_TYPE_LABELS[type]}
                          {!form.gstType && suggestion.gstType === type ? ' (suggested)' : ''}
                        </SelectItem>
                      ))}
                      {gstChoice === 'legacy' || (existing && !existing.gstType && existing.gstAmount) ? <SelectItem value="legacy">Not split (as imported)</SelectItem> : null}
                    </SelectContent>
                  </Select>,
                  undefined,
                  undefined,
                  'medium',
                )}
                {gstChoice !== 'none' && gstChoice !== 'legacy'
                  ? field(
                      'GST rate %',
                      <Select
                        value={form.gstRateCustom || !GST_RATES.map(String).includes(form.gstRate) ? 'custom' : form.gstRate}
                        onValueChange={(value) => setForm((current) => (value === 'custom' ? { ...current, gstRateCustom: true } : { ...current, gstRate: value, gstRateCustom: false, gstManual: false }))}
                      >
                        <SelectTrigger aria-label="GST rate">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {GST_RATES.map((option) => (
                            <SelectItem key={option} value={String(option)}>
                              {option}%
                            </SelectItem>
                          ))}
                          <SelectItem value="custom">Other rate…</SelectItem>
                        </SelectContent>
                      </Select>,
                      form.gstRateCustom || !GST_RATES.map(String).includes(form.gstRate) ? (
                        <Input className="mt-1 h-8" inputMode="decimal" aria-label="GST rate (other)" placeholder="Type the rate %" autoFocus={form.gstRateCustom} value={form.gstRate} onChange={(event) => setForm((current) => ({ ...current, gstRate: event.target.value, gstManual: false }))} />
                      ) : undefined,
                      undefined,
                      'short',
                    )
                  : null}
              </div>
              <p className="-mt-1 text-xs text-slate-500">{suggestion.reason}</p>

              <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-3 sm:p-4">
                <div className={gstChoice === 'cgst-sgst' ? AMOUNT_GRID['cgst-sgst'] : gstChoice === 'igst' ? AMOUNT_GRID.igst : AMOUNT_GRID.other}>
                  {field(
                    <Term tip="Pre-GST value of the work or supply billed. Negative for a credit note.">Taxable amount *</Term>,
                    // A new taxable recomputes the GST components, as the certification form does: typed ones
                    // would otherwise stay at the old figure.
                    <RupeeInput required aria-label="Taxable amount" value={form.taxableAmount} onChange={(value) => setForm((current) => ({ ...current, taxableAmount: value, gstManual: false }))} />,
                    form.transactionType === 'credit_note' && taxable > 0 ? (
                      <button
                        type="button"
                        className="font-medium text-violet-700 hover:underline"
                        onClick={() =>
                          setForm((current) => {
                            // Typed GST turns negative with the taxable, so the note stays one consistent credit.
                            const negative = (value: string) => (num(value) > 0 ? String(-num(value)) : value);
                            return { ...current, taxableAmount: String(-taxable), cgstAmount: negative(current.cgstAmount), sgstAmount: negative(current.sgstAmount), igstAmount: negative(current.igstAmount), legacyGstAmount: negative(current.legacyGstAmount) };
                          })
                        }
                      >
                        Credit notes are negative — make it −{formatINR(taxable)}
                      </button>
                    ) : undefined,
                  )}
                  {gstChoice === 'legacy'
                    ? field('GST (total, not split)', <RupeeInput aria-label="GST amount" value={form.legacyGstAmount} onChange={(value) => set('legacyGstAmount', value)} />, 'Choose a GST type above to split it into CGST / SGST or IGST.')
                    : gstChoice === 'cgst-sgst' ? (
                      <>
                        {field(`CGST @ ${computedGst.cgstRate}%`, <RupeeInput aria-label="CGST amount" value={form.gstManual ? form.cgstAmount : String(components.cgstAmount)} onChange={(value) => editComponent('cgstAmount', value)} />)}
                        {field(`SGST @ ${computedGst.sgstRate}%`, <RupeeInput aria-label="SGST amount" value={form.gstManual ? form.sgstAmount : String(components.sgstAmount)} onChange={(value) => editComponent('sgstAmount', value)} />)}
                      </>
                    ) : gstChoice === 'igst' ? (
                      field(`IGST @ ${computedGst.igstRate}%`, <RupeeInput aria-label="IGST amount" value={form.gstManual ? form.igstAmount : String(components.igstAmount)} onChange={(value) => editComponent('igstAmount', value)} />)
                    ) : null}
                  {gstChoice === 'cgst-sgst' || gstChoice === 'igst'
                    ? field(
                        'Total GST',
                        <div className="flex h-10 items-center justify-between gap-2 rounded-md border bg-white px-3 text-sm font-semibold tabular-nums">
                          {form.gstManual ? (
                            <button type="button" className="text-xs font-normal text-emerald-700 hover:underline" onClick={() => set('gstManual', false)}>
                              Recalculate
                            </button>
                          ) : (
                            <span />
                          )}
                          <Amount value={gstTotal} signed />
                        </div>,
                        form.gstManual ? 'Typed from the invoice.' : 'Worked out from the taxable — type over a component to match the invoice.',
                      )
                    : null}
                  {field(
                    'Gross',
                    <div className="flex h-10 items-center justify-end rounded-md border border-emerald-200 bg-emerald-50/50 px-3 text-sm font-bold tabular-nums text-slate-900">
                      <Amount value={gross} signed />
                    </div>,
                    'Taxable + GST.',
                  )}
                </div>
              </div>
          </FormSection>

          <FormSection
            step={4}
            title={certification ? 'Deductions as raised' : 'Deductions'}
            description="A % line follows its configured base (e.g. Income TDS on taxable less mobilisation advance); typing an amount makes it fixed. A negative deduction adds to the net."
            actions={
              <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={addDeduction}>
                <Plus className="h-4 w-4" /> Add deduction
              </Button>
            }
            bodyClassName="space-y-3 p-3 sm:p-4"
          >
            {certification ? (
              <Notice tone="blue" title="The client’s certified deductions apply">
                These are the deductions as raised, kept as the bill was issued. What the client pays follows its certification — the certified deductions set the net receivable and outstanding, not these. To change them, edit the client’s certification (bill page → Certification).
              </Notice>
            ) : noteBase ? (
              <Notice tone="blue" title={`Note rule: ${noteBase.rule.name}`}>
                {ruleHeads} {ruleHeadNames.length === 1 ? 'is' : 'are'} taken of {againstReference ? `invoice ${againstReference}` : 'the invoice'} plus its notes up to this one — {formatINR(noteBase.taxable)} taxable, {formatINR(noteBase.gross)} gross — not of this note alone. “Take of this note only” changes one line.
                {noteBase.rule.countInCertification ? null : ' This note is left out of the invoice’s certification check: it bills the balance of the value.'}
              </Notice>
            ) : note && againstInvoice?.certified ? (
              <Notice tone="blue">
                The client’s certified deductions already apply to {againstReference ? `invoice ${againstReference}` : 'the invoice'} — this note adjusts only the taxable value and its GST. Add a deduction here only if the client deducts something on the note itself.
              </Notice>
            ) : null}
            <DeductionEditor
              rows={form.deductions}
              setRows={setDeductionRows}
              lines={deductionLines}
              activeTypes={activeTypes}
              deductionTypes={config.deductionTypes}
              gstType={deductionGstType}
              totalDeduction={totals.raisedTotalDeduction}
              defaultGstRate={config.settings.defaultGstRate}
              // No slab hint where it would mislead: a note follows its invoice's slabs, and a certified
              // bill's raised lines no longer count in the slabs (its certified ones do). A line a note
              // rule takes of the invoice plus its notes counts at its own rate, so it has a hint.
              bases={note || certification ? undefined : { taxable, gross }}
              invoiceBase={noteBase ? { deductionTypeIds: noteBase.deductionTypeIds, reference: againstReference ?? 'the invoice' } : undefined}
            />
          </FormSection>

          {/*
            Optional, so folded until wanted: closed, a line says what is set (the due date the bill
            will get, the owner, the stage…) so nothing set here goes unseen; open, the dates on one
            line and the follow-up on another, then the remarks.
          */}
          <FormSection
            step={5}
            title="Dates & planning"
            description="Optional. Dates drive ageing and the due date; owner, stage and target week drive follow-up."
            collapsible={{ open: planningOpen, onOpenChange: setPlanningOpen, summary: planningSummary }}
          >
              <fieldset className="space-y-3">
                <legend className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Dates</legend>
                {/* The dates on one line from a laptop up — four, or five with the retention release. */}
                <div className={cn('grid grid-cols-1 gap-4 sm:grid-cols-2', totals.retentionDeducted !== 0 ? 'lg:grid-cols-5' : 'lg:grid-cols-4')}>
                  {field('Submission date', <Input type="date" value={form.submissionDate} onChange={(event) => set('submissionDate', event.target.value)} />, undefined, undefined, 'date')}
                  {field('Bill passed date', <Input type="date" value={form.passedDate} onChange={(event) => set('passedDate', event.target.value)} />, undefined, undefined, 'date')}
                  {existing
                    ? field('Due date', <div className="flex h-10 items-center rounded-md border bg-slate-50 px-3 text-sm">{dateText(existing.dueDate)}</div>, undefined, undefined, 'date', 'Revise it from the bill page, with a reason.')
                    : field(
                        'Due date',
                        <Input type="date" value={form.dueDate} onChange={(event) => set('dueDate', event.target.value)} />,
                        undefined,
                        undefined,
                        'date',
                        computedDue ? (
                          <>
                            Left blank, it is <b>{dateText(computedDue)}</b>: the {form.submissionDate ? 'submission' : 'bill'} date plus {creditDays} credit days.
                          </>
                        ) : undefined,
                      )}
                  {field('Expected payment date', <Input type="date" value={form.expectedPaymentDate} onChange={(event) => set('expectedPaymentDate', event.target.value)} />, undefined, undefined, 'date')}
                  {totals.retentionDeducted !== 0 ? field('Retention release expected', <Input type="date" value={form.retentionExpectedReleaseDate} onChange={(event) => set('retentionExpectedReleaseDate', event.target.value)} />, undefined, undefined, 'date') : null}
                </div>
              </fieldset>
              <fieldset className="space-y-3 border-t border-slate-100 pt-4">
                <legend className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Follow-up</legend>
                <div className={FORM_GRID}>
                  {field(
                    'Collection owner',
                    <Select value={form.collectionOwnerId || 'none'} onValueChange={(value) => set('collectionOwnerId', value === 'none' ? '' : value)}>
                      <SelectTrigger aria-label="Collection owner">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="max-h-80">
                        <SelectItem value="none">Unassigned</SelectItem>
                        {lookups.users.map((user) => (
                          <SelectItem key={user.id} value={user.id}>
                            {user.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>,
                    undefined,
                    undefined,
                    'medium',
                  )}
                  {field(
                    'Stage',
                    <Select value={form.currentStage || 'none'} onValueChange={(value) => set('currentStage', value === 'none' ? '' : value)}>
                      <SelectTrigger aria-label="Stage">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">—</SelectItem>
                        {config.stages
                          .filter((stage) => stage.active || stage.name === form.currentStage)
                          .sort((a, b) => a.sequence - b.sequence)
                          .map((stage) => (
                            <SelectItem key={stage.id} value={stage.name}>
                              {stage.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>,
                    undefined,
                    undefined,
                    'medium',
                  )}
                  {field('Target week', <Input value={form.targetWeek} onChange={(event) => set('targetWeek', event.target.value)} placeholder="2026-W41" />, undefined, undefined, 'short')}
                  {field('Bill / PI', <Input value={form.taxableOrAdvance} onChange={(event) => set('taxableOrAdvance', event.target.value.toUpperCase())} placeholder={`BILL or ${config.settings.piMarker}`} />, 'PI rows feed the PI report.', undefined, 'date')}
                </div>
              </fieldset>
              <div className="border-t border-slate-100 pt-4">
                {field('Remarks', <Textarea rows={2} value={form.remarks} onChange={(event) => set('remarks', event.target.value)} />)}
              </div>
              {!existing ? <p className="text-xs text-muted-foreground">Attach the invoice and supporting documents from the bill page after saving.</p> : null}
          </FormSection>

          {protectedChanged ? (
            <Card className="border-amber-200 bg-amber-50">
              <CardContent className="space-y-2 p-4">
                <Label htmlFor="change-reason" className="font-semibold text-amber-900">
                  Reason for changing an approved bill *
                </Label>
                <Textarea id="change-reason" required rows={2} value={form.changeReason} onChange={(event) => set('changeReason', event.target.value)} placeholder="Recorded in the audit trail" />
              </CardContent>
            </Card>
          ) : null}
        </div>

        <div className="space-y-3 xl:sticky xl:top-[calc(var(--app-header-offset,4rem)+1rem)] xl:self-start">
          <FormSection icon={Calculator} title="Calculation" className="border-emerald-200" bodyClassName="space-y-2 p-4 text-sm">
              <Row label="Taxable" value={taxable} />
              {gstChoice === 'cgst-sgst' ? (
                <>
                  <Row label={`CGST @ ${computedGst.cgstRate}%`} value={components.cgstAmount} muted />
                  <Row label={`SGST @ ${computedGst.sgstRate}%`} value={components.sgstAmount} muted />
                </>
              ) : gstChoice === 'igst' ? (
                <Row label={`IGST @ ${computedGst.igstRate}%`} value={components.igstAmount} muted />
              ) : null}
              <Row label="GST" value={gstTotal} />
              <Row label="Gross" value={totals.grossAmount} strong />
              {deductionLines.map((line) => (
                <Row key={line.id} label={`− ${line.deductionTypeName}${line.gstAmount ? ' (incl. GST)' : ''}`} value={-line.amount} muted />
              ))}
              <Row label={certification ? 'Total deduction as raised' : 'Total deduction'} value={-totals.raisedTotalDeduction} />
              <div className="my-1 h-px bg-slate-200" />
              {/* Certified: the client's deductions replace the rows above, so its net moves by the difference. */}
              {certification && toPaise(totals.raisedTotalDeduction) !== toPaise(totals.totalDeduction) ? (
                <>
                  <Row label="Net as raised" value={totals.raisedNetReceivable} strong />
                  <Row label={`Client deducted ${totals.totalDeduction > totals.raisedTotalDeduction ? 'more' : 'less'}`} value={subtractMoney(totals.raisedTotalDeduction, totals.totalDeduction)} />
                </>
              ) : null}
              <Row label={config.settings.roundNetToRupee ? 'Net receivable (rounded)' : 'Net receivable'} value={totals.netReceivable} strong />
              {existing ? (
                <>
                  <Row label="Received" value={totals.totalReceived} />
                  <Row label="Outstanding" value={totals.outstandingAmount} strong />
                </>
              ) : null}
              <p className="pt-1 text-[11px] text-muted-foreground">Preview only — the server recalculates every figure on save.</p>
          </FormSection>
          <BtError message={saveError} />
          <div className="flex gap-2">
            <Button asChild variant="outline" className="flex-1">
              <Link href={existing ? `/bill-tracking/bills/${existing.id}` : '/bill-tracking/bills'}>Cancel</Link>
            </Button>
            <Button type="submit" className="flex-1 gap-1.5" disabled={saving || !canSave || !form.projectId || !form.categoryId || !form.billTypeId || (needsInvoice && !form.againstBillId) || releaseRateInvalid}>
              <Save className="h-4 w-4" />
              {saving ? 'Saving…' : existing ? 'Save changes' : 'Create'}
            </Button>
          </div>
          {needsInvoice && !form.againstBillId ? <p className="text-xs text-violet-800">Choose the invoice this credit note is against.</p> : null}
        </div>
      </div>
    </form>
  );
}

function Row({ label, value, strong, muted }: { label: string; value: number; strong?: boolean; muted?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-2 ${muted ? 'text-xs text-muted-foreground' : ''}`}>
      <span className="min-w-0 truncate">{label}</span>
      <Amount value={value} className={strong ? 'font-semibold text-slate-900' : undefined} signed />
    </div>
  );
}
