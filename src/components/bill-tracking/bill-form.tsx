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

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Calculator, Plus, ReceiptIndianRupee, RotateCcw, Save, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader, SectionHeader } from '@/components/shared/page-header';
import { useToast } from '@/hooks/use-toast';
import { addDays, deriveBillTotals, financialYearOf, isPastApproval } from '@/lib/bill-tracking/calculations';
import { categoryName, sortedCategories, subCategoriesFor } from '@/lib/bill-tracking/categories';
import { computeDeductions, splitGst, suggestGst, totalFromComponents, type DeductionLineInput } from '@/lib/bill-tracking/gst';
import { formatINR } from '@/lib/bill-tracking/money';
import { GST_RATES } from '@/lib/statutory';
import { GST_TYPE_LABELS, TRANSACTION_TYPE_LABELS, TRANSACTION_TYPES, type Bill, type BillTrackingConfig, type BillTransactionType, type GstType } from '@/lib/bill-tracking/types';

import { btFetch, useBt, useBtQuery, useLookups } from './bt-client';
import { Amount, BtError, BtLoading, Notice, Term, dateText } from './bt-ui';

interface DeductionRow {
  id: string;
  deductionTypeId: string;
  /** Non-empty = a percentage line (the amount follows the base). */
  percentage: string;
  /** A fixed line's amount before GST. */
  baseAmount: string;
  /** GST % on the deduction (GST-applicable types only). */
  gstRate: string;
  remarks: string;
}

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
}

const newId = () => `d${Math.random().toString(36).slice(2, 9)}`;
const num = (value: string) => {
  const parsed = Number(String(value).replace(/[,₹\s]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
};
const str = (value: number | undefined) => (value === undefined ? '' : String(value));
const isNote = (type: BillTransactionType) => type === 'credit_note' || type === 'debit_note';

function fromBill(bill: Bill, config: BillTrackingConfig): FormState {
  return {
    billSerialNumber: bill.billSerialNumber ?? '',
    autoNumber: false,
    transactionType: bill.transactionType,
    againstBillId: bill.againstBillId ?? '',
    gstInvoiceNumber: bill.gstInvoiceNumber ?? '',
    billDate: bill.billDate,
    financialYear: bill.financialYear,
    submissionDate: bill.submissionDate ?? '',
    passedDate: bill.passedDate ?? '',
    dueDate: bill.dueDate ?? '',
    expectedPaymentDate: bill.expectedPaymentDate ?? '',
    projectId: bill.projectId,
    clientId: bill.clientId ?? '',
    dgmOffice: bill.dgmOffice ?? '',
    description: bill.description ?? '',
    categoryId: config.billTypes.find((type) => type.id === bill.billTypeId)?.categoryId ?? bill.billCategory ?? '',
    billTypeId: bill.billTypeId ?? '',
    taxableAmount: String(bill.taxableAmount ?? ''),
    gstType: bill.gstType ?? (bill.gstAmount ? 'legacy' : ''),
    gstRate: str(bill.gstPercent ?? config.settings.defaultGstRate),
    gstRegistrationId: '',
    gstManual: Boolean(bill.gstType),
    cgstAmount: str(bill.cgstAmount),
    sgstAmount: str(bill.sgstAmount),
    igstAmount: str(bill.igstAmount),
    legacyGstAmount: String(bill.gstAmount ?? 0),
    deductions: (bill.deductions ?? []).map((line) => {
      const type = config.deductionTypes.find((entry) => entry.id === line.deductionTypeId);
      return {
        id: line.id,
        deductionTypeId: line.deductionTypeId,
        percentage: str(line.percentage),
        baseAmount: String(line.baseAmount ?? line.amount),
        // A line saved without GST stays without it even if the type has since become GST-applicable.
        gstRate: line.gstRate !== undefined ? String(line.gstRate) : type?.gstApplicable ? '0' : '',
        remarks: line.remarks ?? '',
      };
    }),
    targetWeek: bill.targetWeek ?? '',
    collectionOwnerId: bill.collectionOwnerId ?? '',
    currentStage: bill.currentStage ?? '',
    remarks: bill.remarks ?? '',
    retentionExpectedReleaseDate: bill.retentionExpectedReleaseDate ?? '',
    taxableOrAdvance: bill.taxableOrAdvance ?? '',
    changeReason: '',
  };
}

export default function BillForm({ billId }: { billId?: string }) {
  const editing = Boolean(billId);
  const { data, loading, error } = useBtQuery<{ bill: Bill }>(billId ? `bills/${billId}` : null);
  if (editing && loading) return <BtLoading label="Loading bill…" />;
  if (editing && error) return <BtError message={error} />;
  return <BillFormInner key={data?.bill.id ?? 'new'} existing={data?.bill} />;
}

function BillFormInner({ existing }: { existing?: Bill }) {
  const lookups = useLookups();
  const { can } = useBt();
  const router = useRouter();
  const params = useSearchParams();
  const { toast } = useToast();
  const { config } = lookups;
  const activeTypes = config.deductionTypes.filter((type) => type.active || existing?.deductions.some((line) => line.deductionTypeId === type.id));

  const [form, setForm] = useState<FormState>(() =>
    existing
      ? fromBill(existing, config)
      : {
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
          description: '',
          categoryId: '',
          billTypeId: '',
          taxableAmount: '',
          gstType: '',
          gstRate: String(config.settings.defaultGstRate),
          gstRegistrationId: '',
          gstManual: false,
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
          taxableOrAdvance: '',
          changeReason: '',
        },
  );
  const [saving, setSaving] = useState(false);
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
        // Fill blanks from the project; never overwrite a choice.
        clientId: current.clientId || next?.clientId || '',
        dgmOffice: current.dgmOffice || next?.dgmOffice || '',
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

  /* ── deductions ───────────────────────────────────────────────────────── */
  const gross = Math.round((taxable + gstTotal) * 100) / 100;
  const deductionInputs: DeductionLineInput[] = form.deductions
    .filter((line) => line.deductionTypeId)
    .map((line) => ({
      id: line.id,
      deductionTypeId: line.deductionTypeId,
      percentage: line.percentage !== '' ? num(line.percentage) : undefined,
      baseAmount: line.percentage === '' ? num(line.baseAmount) : undefined,
      gstRate: line.gstRate !== '' ? num(line.gstRate) : undefined,
      remarks: line.remarks,
    }));
  const deductionLines = computeDeductions(deductionInputs, config.deductionTypes, { taxable, gross, roundToRupee: config.settings.roundDeductionsToRupee });
  const lineById = new Map(deductionLines.map((line) => [line.id, line]));

  const totals = useMemo(
    () => deriveBillTotals({ taxableAmount: taxable, gstAmount: gstTotal, deductions: deductionLines, collections: existing?.collections ?? [] }, { tolerance: config.settings.tolerance, roundNetToRupee: config.settings.roundNetToRupee }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [taxable, gstTotal, JSON.stringify(deductionLines), existing, config.settings.tolerance, config.settings.roundNetToRupee],
  );

  const addDeduction = () => setForm((current) => ({ ...current, deductions: [...current.deductions, { id: newId(), deductionTypeId: '', percentage: '', baseAmount: '', gstRate: '', remarks: '' }] }));
  const updateDeduction = (id: string, patch: Partial<DeductionRow>) =>
    setForm((current) => ({
      ...current,
      deductions: current.deductions.map((line) => {
        if (line.id !== id) return line;
        const next = { ...line, ...patch };
        if ('deductionTypeId' in patch) {
          const type = activeTypes.find((entry) => entry.id === next.deductionTypeId);
          next.percentage = type?.calculation === 'percentage' && type.defaultPercent !== undefined ? String(type.defaultPercent) : '';
          next.gstRate = type?.gstApplicable ? String(type.gstRate ?? config.settings.defaultGstRate) : '';
        }
        return next;
      }),
    }));

  /* ── credit / debit note ──────────────────────────────────────────────── */
  const note = isNote(form.transactionType);
  const { data: invoiceData, loading: invoicesLoading } = useBtQuery<{ bills: InvoiceOption[] }>(note && form.projectId ? `bills/invoices?project=${form.projectId}${existing ? `&exclude=${existing.id}` : ''}` : null);
  const invoices = invoiceData?.bills ?? [];
  const againstInvoice = invoices.find((invoice) => invoice.id === form.againstBillId);
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

  /* ── dates ────────────────────────────────────────────────────────────── */
  const creditDays = project?.creditDays ?? client?.paymentTermsDays ?? config.settings.defaultCreditDays;
  const computedDue = form.billDate ? addDays(form.submissionDate || form.billDate, creditDays) : '';
  const derivedFy = form.billDate ? financialYearOf(form.billDate) : '';

  const protectedChanged =
    existing &&
    isPastApproval(existing.workflowStatus) &&
    (taxable !== existing.taxableAmount ||
      gstTotal !== existing.gstAmount ||
      form.billDate !== existing.billDate ||
      form.projectId !== existing.projectId ||
      (form.gstInvoiceNumber || undefined) !== existing.gstInvoiceNumber ||
      (form.againstBillId || undefined) !== existing.againstBillId ||
      JSON.stringify(deductionLines.map((line) => [line.deductionTypeId, line.amount])) !== JSON.stringify(existing.deductions.map((line) => [line.deductionTypeId, line.amount])));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
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

  const field = (label: React.ReactNode, control: React.ReactNode, hint?: React.ReactNode, id?: string) => (
    <div className="min-w-0 space-y-1">
      <Label htmlFor={id} className="text-xs font-medium text-slate-600">
        {label}
      </Label>
      {control}
      {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
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

      {existing && isPastApproval(existing.workflowStatus) ? (
        <Notice tone="amber" title="This bill is approved">
          Changing amounts, GST, deductions, the invoice number, date, project or the invoice a note is against needs the <b>Edit After Approval</b> permission and a reason. Other fields can be edited freely.
        </Notice>
      ) : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4">
          <Card className="border-white/60 bg-white/85 shadow-sm">
            <CardContent className="space-y-4 p-4">
              <SectionHeader title="Identification" as="h3" />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {field(
                  'Bill number',
                  existing || !config.settings.numbering.enabled || !form.autoNumber ? (
                    <Input id="billSerialNumber" value={form.billSerialNumber} onChange={(event) => set('billSerialNumber', event.target.value)} placeholder="e.g. 175" />
                  ) : (
                    <div className="flex h-10 items-center rounded-md border border-dashed px-3 text-sm text-muted-foreground">Generated on save ({config.settings.numbering.pattern})</div>
                  ),
                  !existing && config.settings.numbering.enabled ? undefined : existing?.source === 'excel_import' ? 'Legacy number — kept as imported.' : undefined,
                  'billSerialNumber',
                )}
                {!existing && config.settings.numbering.enabled
                  ? field(
                      'Auto-number',
                      <div className="flex h-10 items-center gap-2">
                        <Switch checked={form.autoNumber} onCheckedChange={(value) => set('autoNumber', value)} aria-label="Generate the bill number" />
                        <span className="text-sm text-muted-foreground">{form.autoNumber ? 'Generate' : 'Type my own'}</span>
                      </div>,
                    )
                  : null}
                {field('GST invoice / note no.', <Input id="gst-invoice" value={form.gstInvoiceNumber} onChange={(event) => set('gstInvoiceNumber', event.target.value)} placeholder="Leave blank for non-GST (NA)" />, undefined, 'gst-invoice')}
                {field('Bill date *', <Input id="bill-date" type="date" required value={form.billDate} onChange={(event) => set('billDate', event.target.value)} />, derivedFy ? `FY ${derivedFy}` : undefined, 'bill-date')}
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
                )}
                {can('Bills', 'Approve')
                  ? field(
                      'Financial year override',
                      <Input value={form.financialYear} onChange={(event) => set('financialYear', event.target.value)} placeholder={derivedFy || '2026-27'} />,
                      'Normally taken from the bill date.',
                    )
                  : null}
              </div>
            </CardContent>
          </Card>

          <Card className="border-white/60 bg-white/85 shadow-sm">
            <CardContent className="space-y-4 p-4">
              <SectionHeader title="Project & bill" as="h3" />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
                )}
                {field(
                  'Client',
                  <Select value={form.clientId || 'none'} onValueChange={(value) => set('clientId', value === 'none' ? '' : value)}>
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
                )}
                {field('DGM office', <Input value={form.dgmOffice} onChange={(event) => set('dgmOffice', event.target.value)} placeholder={project?.dgmOffice ?? 'e.g. Rayagada'} list="bt-dgm-offices" />)}
                <datalist id="bt-dgm-offices">
                  {lookups.dgmOffices.map((office) => (
                    <option key={office} value={office} />
                  ))}
                </datalist>
                <div className="sm:col-span-2 lg:col-span-1">{field('Description', <Input value={form.description} onChange={(event) => set('description', event.target.value)} placeholder="e.g. RA Bill 4 — civil works" />)}</div>
              </div>

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
                    {againstInvoice && form.transactionType === 'credit_note' ? (
                      <Button type="button" variant="outline" className="gap-1.5" onClick={() => creditFullInvoice(againstInvoice)}>
                        <RotateCcw className="h-4 w-4" /> Credit the full invoice
                      </Button>
                    ) : null}
                  </div>
                  {againstInvoice ? (
                    <p className="mt-2 text-xs text-violet-900">
                      Invoice {againstInvoice.gstInvoiceNumber || againstInvoice.billSerialNumber}: taxable {formatINR(againstInvoice.taxableAmount)}, GST {formatINR(againstInvoice.gstAmount)}, net {formatINR(againstInvoice.netReceivable)}.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card className="border-white/60 bg-white/85 shadow-sm">
            <CardContent className="space-y-4 p-4">
              <SectionHeader title="Amount & GST" as="h3" />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {field(
                  <Term tip="Pre-GST value of the work or supply billed. Negative for a credit note.">Taxable amount (₹) *</Term>,
                  <Input inputMode="decimal" required value={form.taxableAmount} onChange={(event) => set('taxableAmount', event.target.value)} />,
                  form.transactionType === 'credit_note' && taxable > 0 ? (
                    <button type="button" className="font-medium text-violet-700 hover:underline" onClick={() => set('taxableAmount', String(-taxable))}>
                      Credit notes are negative — make it −{formatINR(taxable)}
                    </button>
                  ) : undefined,
                )}
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
                      {existing && !existing.gstType && existing.gstAmount ? <SelectItem value="legacy">Not split (as imported)</SelectItem> : null}
                    </SelectContent>
                  </Select>,
                )}
                {gstChoice !== 'none' && gstChoice !== 'legacy'
                  ? field(
                      'GST rate %',
                      <Select value={GST_RATES.map(String).includes(form.gstRate) ? form.gstRate : 'custom'} onValueChange={(value) => value !== 'custom' && setForm((current) => ({ ...current, gstRate: value, gstManual: false }))}>
                        <SelectTrigger aria-label="GST rate">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {GST_RATES.map((option) => (
                            <SelectItem key={option} value={String(option)}>
                              {option}%
                            </SelectItem>
                          ))}
                          <SelectItem value="custom">Other — type below</SelectItem>
                        </SelectContent>
                      </Select>,
                      <Input className="mt-1 h-8" inputMode="decimal" aria-label="GST rate (custom)" value={form.gstRate} onChange={(event) => setForm((current) => ({ ...current, gstRate: event.target.value, gstManual: false }))} />,
                    )
                  : null}
              </div>
              <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">{suggestion.reason}</p>

              {gstChoice === 'legacy' ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {field('GST (total, not split)', <Input inputMode="decimal" value={form.legacyGstAmount} onChange={(event) => set('legacyGstAmount', event.target.value)} />, 'Choose a GST type above to split it into CGST / SGST or IGST.')}
                </div>
              ) : gstChoice === 'none' ? null : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {gstChoice === 'cgst-sgst' ? (
                    <>
                      {field(`CGST @ ${computedGst.cgstRate}%`, <Input inputMode="decimal" aria-label="CGST amount" value={form.gstManual ? form.cgstAmount : String(components.cgstAmount)} onChange={(event) => editComponent('cgstAmount', event.target.value)} />)}
                      {field(`SGST @ ${computedGst.sgstRate}%`, <Input inputMode="decimal" aria-label="SGST amount" value={form.gstManual ? form.sgstAmount : String(components.sgstAmount)} onChange={(event) => editComponent('sgstAmount', event.target.value)} />)}
                    </>
                  ) : (
                    field(`IGST @ ${computedGst.igstRate}%`, <Input inputMode="decimal" aria-label="IGST amount" value={form.gstManual ? form.igstAmount : String(components.igstAmount)} onChange={(event) => editComponent('igstAmount', event.target.value)} />)
                  )}
                  {field(
                    'Total GST',
                    <div className="flex h-10 items-center justify-between rounded-md border bg-slate-50 px-3 text-sm font-semibold">
                      <Amount value={gstTotal} signed />
                      {form.gstManual ? (
                        <button type="button" className="text-xs font-normal text-emerald-700 hover:underline" onClick={() => set('gstManual', false)}>
                          Recalculate
                        </button>
                      ) : null}
                    </div>,
                    form.gstManual ? 'Typed from the invoice.' : 'Calculated from the taxable value — type over a component to match the invoice.',
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-white/60 bg-white/85 shadow-sm">
            <CardContent className="space-y-3 p-4">
              <SectionHeader
                title="Deductions"
                as="h3"
                description="A % line follows its configured base (e.g. Income TDS on taxable less mobilisation advance); typing an amount makes it fixed. Signed: a negative deduction adds to the net."
                actions={
                  <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={addDeduction}>
                    <Plus className="h-4 w-4" /> Add deduction
                  </Button>
                }
              />
              {form.deductions.length === 0 ? <p className="text-sm text-muted-foreground">No deductions on this bill.</p> : null}
              <div className="space-y-2">
                {form.deductions.map((line) => {
                  const type = activeTypes.find((entry) => entry.id === line.deductionTypeId);
                  const computed = lineById.get(line.id);
                  const percent = line.percentage !== '';
                  const lessNames = (type?.baseLessTypeIds ?? []).map((id) => config.deductionTypes.find((entry) => entry.id === id)?.name).filter(Boolean);
                  const gstApplicable = Boolean(type?.gstApplicable);
                  const baseValue = computed ? (computed.baseAmount ?? computed.amount) : 0;
                  return (
                    <div key={line.id} className="space-y-1 rounded-lg border border-slate-200 bg-white p-2">
                      <div className={`grid grid-cols-2 items-center gap-2 ${gstApplicable ? 'lg:grid-cols-[minmax(0,1.4fr)_80px_minmax(0,1fr)_70px_minmax(0,0.9fr)_minmax(0,1fr)_auto]' : 'lg:grid-cols-[minmax(0,1.4fr)_80px_minmax(0,1fr)_minmax(0,1fr)_auto]'}`}>
                        <div className="col-span-2 lg:col-span-1">
                          <Select value={line.deductionTypeId} onValueChange={(value) => updateDeduction(line.id, { deductionTypeId: value })}>
                            <SelectTrigger aria-label="Deduction type">
                              <SelectValue placeholder="Deduction type" />
                            </SelectTrigger>
                            <SelectContent className="max-h-80">
                              {activeTypes.map((entry) => (
                                <SelectItem key={entry.id} value={entry.id}>
                                  {entry.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <Input aria-label="Percent" inputMode="decimal" placeholder="%" value={line.percentage} onChange={(event) => updateDeduction(line.id, { percentage: event.target.value })} />
                        <Input
                          aria-label={gstApplicable ? 'Deduction before GST' : 'Deduction amount'}
                          inputMode="decimal"
                          placeholder={gstApplicable ? 'Base ₹' : 'Amount ₹'}
                          value={percent ? String(baseValue) : line.baseAmount}
                          className={percent ? 'bg-slate-50' : undefined}
                          onChange={(event) => updateDeduction(line.id, { baseAmount: event.target.value, percentage: '' })}
                        />
                        {gstApplicable ? (
                          <>
                            <Input aria-label="GST % on deduction" inputMode="decimal" placeholder="GST %" value={line.gstRate} onChange={(event) => updateDeduction(line.id, { gstRate: event.target.value })} />
                            <div className="flex h-10 items-center justify-end rounded-md border bg-slate-50 px-2 text-sm" title="GST on the deduction">
                              <Amount value={computed?.gstAmount ?? 0} />
                            </div>
                          </>
                        ) : null}
                        <Input aria-label="Remarks" placeholder="Remarks" value={line.remarks} onChange={(event) => updateDeduction(line.id, { remarks: event.target.value })} />
                        <Button type="button" variant="ghost" size="icon" aria-label="Remove deduction" onClick={() => setForm((current) => ({ ...current, deductions: current.deductions.filter((entry) => entry.id !== line.id) }))}>
                          <Trash2 className="h-4 w-4 text-rose-600" />
                        </Button>
                      </div>
                      {type && (percent || gstApplicable) ? (
                        <p className="px-1 text-[11px] text-muted-foreground">
                          {percent ? `${line.percentage}% of ${formatINR(computed?.calculationBase ?? 0)} (${type.percentBase === 'gross' ? 'Gross' : 'Taxable'}${lessNames.length ? ` − ${lessNames.join(' − ')}` : ''}) = ${formatINR(baseValue)}` : null}
                          {percent && gstApplicable ? ' · ' : null}
                          {gstApplicable ? `+ GST ${line.gstRate || 0}% = total ${formatINR(computed?.amount ?? 0)}` : null}
                        </p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <Card className="border-white/60 bg-white/85 shadow-sm">
            <CardContent className="space-y-4 p-4">
              <SectionHeader title="Dates & planning" as="h3" />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {field('Submission date', <Input type="date" value={form.submissionDate} onChange={(event) => set('submissionDate', event.target.value)} />)}
                {field('Bill passed date', <Input type="date" value={form.passedDate} onChange={(event) => set('passedDate', event.target.value)} />)}
                {existing
                  ? field('Due date', <div className="flex h-10 items-center rounded-md border bg-slate-50 px-3 text-sm">{dateText(existing.dueDate)}</div>, 'Revise it from the bill page (with a reason).')
                  : field('Due date', <Input type="date" value={form.dueDate} onChange={(event) => set('dueDate', event.target.value)} />, computedDue ? `Blank = ${dateText(computedDue)} (${creditDays} credit days)` : undefined)}
                {field('Expected payment date', <Input type="date" value={form.expectedPaymentDate} onChange={(event) => set('expectedPaymentDate', event.target.value)} />)}
                {field('Target week', <Input value={form.targetWeek} onChange={(event) => set('targetWeek', event.target.value)} placeholder="2026-W41" />)}
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
                )}
                {totals.retentionDeducted !== 0 ? field('Retention release expected', <Input type="date" value={form.retentionExpectedReleaseDate} onChange={(event) => set('retentionExpectedReleaseDate', event.target.value)} />) : null}
                {field('Bill / PI', <Input value={form.taxableOrAdvance} onChange={(event) => set('taxableOrAdvance', event.target.value.toUpperCase())} placeholder={`BILL or ${config.settings.piMarker}`} />, 'Legacy “TAXABLE / ADVANCE” — PI rows feed the PI report.')}
              </div>
              {field('Remarks', <Textarea rows={2} value={form.remarks} onChange={(event) => set('remarks', event.target.value)} />)}
              {!existing ? <p className="text-xs text-muted-foreground">Attach the invoice and supporting documents from the bill page after saving.</p> : null}
            </CardContent>
          </Card>

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
          <Card className="border-emerald-200 bg-white shadow-sm">
            <CardContent className="space-y-2 p-4 text-sm">
              <SectionHeader title="Calculation" icon={Calculator} as="h3" />
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
              <Row label="Total deduction" value={-totals.totalDeduction} />
              <div className="my-1 h-px bg-slate-200" />
              <Row label={config.settings.roundNetToRupee ? 'Net receivable (rounded)' : 'Net receivable'} value={totals.netReceivable} strong />
              {existing ? (
                <>
                  <Row label="Received" value={totals.totalReceived} />
                  <Row label="Outstanding" value={totals.outstandingAmount} strong />
                </>
              ) : null}
              <p className="pt-1 text-[11px] text-muted-foreground">Preview only — the server recalculates every figure on save.</p>
            </CardContent>
          </Card>
          <BtError message={saveError} />
          <div className="flex gap-2">
            <Button asChild variant="outline" className="flex-1">
              <Link href={existing ? `/bill-tracking/bills/${existing.id}` : '/bill-tracking/bills'}>Cancel</Link>
            </Button>
            <Button type="submit" className="flex-1 gap-1.5" disabled={saving || !canSave || !form.projectId || !form.categoryId || !form.billTypeId || (needsInvoice && !form.againstBillId)}>
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
