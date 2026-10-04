'use client';

/**
 * Create / edit a bill (`/bill-tracking/bills/new`, `/bill-tracking/bills/[id]/edit`).
 *
 * The calculation panel previews gross, deductions and net with the same functions the server uses,
 * but it is only a preview: the API recomputes every derived figure from the submitted source values
 * and ignores anything else. Editing sends the version the form loaded, so a bill changed by someone
 * else in the meantime is refused instead of silently overwritten.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Calculator, Plus, ReceiptIndianRupee, Save, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader, SectionHeader } from '@/components/shared/page-header';
import { useToast } from '@/hooks/use-toast';
import { addDays, deriveBillTotals, financialYearOf, isPastApproval, percentOf } from '@/lib/bill-tracking/calculations';
import { TRANSACTION_TYPE_LABELS, TRANSACTION_TYPES, type Bill, type BillTransactionType } from '@/lib/bill-tracking/types';

import { btFetch, useBt, useBtQuery, useLookups } from './bt-client';
import { Amount, BtError, BtLoading, Notice, Term, dateText } from './bt-ui';

interface DeductionRow {
  id: string;
  deductionTypeId: string;
  percentage: string;
  amount: string;
  remarks: string;
}

interface FormState {
  billSerialNumber: string;
  autoNumber: boolean;
  transactionType: BillTransactionType;
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
  billTypeId: string;
  taxableAmount: string;
  gstMode: string;
  gstAmount: string;
  deductions: DeductionRow[];
  targetWeek: string;
  collectionOwnerId: string;
  currentStage: string;
  remarks: string;
  retentionExpectedReleaseDate: string;
  taxableOrAdvance: string;
  changeReason: string;
}

const GST_PRESETS = ['0', '5', '12', '18', '28'];
const newId = () => `d${Math.random().toString(36).slice(2, 9)}`;
const num = (value: string) => {
  const parsed = Number(String(value).replace(/[,₹\s]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
};

function fromBill(bill: Bill): FormState {
  return {
    billSerialNumber: bill.billSerialNumber ?? '',
    autoNumber: false,
    transactionType: bill.transactionType,
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
    billTypeId: bill.billTypeId ?? '',
    taxableAmount: String(bill.taxableAmount ?? ''),
    gstMode: bill.gstPercent !== undefined && GST_PRESETS.includes(String(bill.gstPercent)) ? String(bill.gstPercent) : 'manual',
    gstAmount: String(bill.gstAmount ?? ''),
    deductions: (bill.deductions ?? []).map((line) => ({ id: line.id, deductionTypeId: line.deductionTypeId, percentage: line.percentage !== undefined ? String(line.percentage) : '', amount: String(line.amount), remarks: line.remarks ?? '' })),
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
      ? fromBill(existing)
      : {
          billSerialNumber: '',
          autoNumber: config.settings.numbering.enabled,
          transactionType: 'invoice',
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
          billTypeId: '',
          taxableAmount: '',
          gstMode: '18',
          gstAmount: '',
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
  const client = lookups.clients.find((entry) => entry.id === (form.clientId || project?.clientId));

  // Project → client and DGM office (only fills blanks, never overwrites a choice).
  useEffect(() => {
    if (!project || existing) return;
    setForm((current) => ({ ...current, clientId: current.clientId || project.clientId || '', dgmOffice: current.dgmOffice || project.dgmOffice || '' }));
  }, [project, existing]);

  // GST from a preset percentage.
  const taxable = num(form.taxableAmount);
  useEffect(() => {
    if (form.gstMode === 'manual') return;
    set('gstAmount', String(Math.round((taxable * Number(form.gstMode)) / 100)));
  }, [taxable, form.gstMode]);

  const gross = taxable + num(form.gstAmount);
  const deductionLines = form.deductions.map((line) => {
    const type = activeTypes.find((entry) => entry.id === line.deductionTypeId);
    return { id: line.id, deductionTypeId: line.deductionTypeId, deductionTypeName: type?.name ?? '', kind: type?.kind ?? 'other', amount: num(line.amount) };
  });
  const totals = useMemo(
    () => deriveBillTotals({ taxableAmount: taxable, gstAmount: num(form.gstAmount), deductions: deductionLines, collections: existing?.collections ?? [] }, { tolerance: config.settings.tolerance, roundNetToRupee: config.settings.roundNetToRupee }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [taxable, form.gstAmount, JSON.stringify(deductionLines), existing, config.settings.tolerance, config.settings.roundNetToRupee],
  );

  const creditDays = project?.creditDays ?? client?.paymentTermsDays ?? config.settings.defaultCreditDays;
  const computedDue = form.billDate ? addDays(form.submissionDate || form.billDate, creditDays) : '';
  const derivedFy = form.billDate ? financialYearOf(form.billDate) : '';

  const updateDeduction = (id: string, patch: Partial<DeductionRow>) =>
    setForm((current) => ({
      ...current,
      deductions: current.deductions.map((line) => {
        if (line.id !== id) return line;
        const next = { ...line, ...patch };
        const type = activeTypes.find((entry) => entry.id === next.deductionTypeId);
        // A percentage drives the amount; typing an amount directly clears the percentage.
        if ('percentage' in patch && next.percentage !== '' && type) {
          const base = type.percentBase === 'gross' ? gross : taxable;
          next.amount = String(percentOf(base, num(next.percentage)));
        }
        if ('deductionTypeId' in patch && type?.calculation === 'percentage' && type.defaultPercent !== undefined && !line.amount) {
          next.percentage = String(type.defaultPercent);
          next.amount = String(percentOf(type.percentBase === 'gross' ? gross : taxable, type.defaultPercent));
        }
        return next;
      }),
    }));

  const protectedChanged =
    existing &&
    isPastApproval(existing.workflowStatus) &&
    (num(form.taxableAmount) !== existing.taxableAmount || num(form.gstAmount) !== existing.gstAmount || form.billDate !== existing.billDate || form.projectId !== existing.projectId || (form.gstInvoiceNumber || undefined) !== existing.gstInvoiceNumber || JSON.stringify(deductionLines.map((line) => [line.deductionTypeId, line.amount])) !== JSON.stringify(existing.deductions.map((line) => [line.deductionTypeId, line.amount])));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setSaveError(null);
    const body = {
      billSerialNumber: form.autoNumber && !existing ? undefined : form.billSerialNumber,
      autoNumber: !existing && form.autoNumber,
      serialNumber: existing?.serialNumber,
      transactionType: form.transactionType,
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
      gstAmount: num(form.gstAmount),
      gstPercent: form.gstMode === 'manual' ? undefined : Number(form.gstMode),
      deductions: form.deductions.filter((line) => line.deductionTypeId && line.amount !== '').map((line) => ({ id: line.id, deductionTypeId: line.deductionTypeId, amount: num(line.amount), percentage: line.percentage === '' ? undefined : num(line.percentage), remarks: line.remarks })),
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

  const field = (label: React.ReactNode, control: React.ReactNode, hint?: string, id?: string) => (
    <div className="min-w-0 space-y-1">
      <Label htmlFor={id} className="text-xs font-medium text-slate-600">
        {label}
      </Label>
      {control}
      {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );

  const canSave = existing ? can('Bills', 'Edit') : can('Bills', 'Add');

  return (
    <form onSubmit={submit} className="space-y-4">
      <PageHeader
        icon={ReceiptIndianRupee}
        title={existing ? `Edit bill ${existing.billSerialNumber ?? ''}` : 'New bill'}
        backHref={existing ? `/bill-tracking/bills/${existing.id}` : '/bill-tracking/bills'}
        backLabel={existing ? 'Bill' : 'Bill register'}
        description={existing?.source === 'excel_import' ? 'Imported from the legacy workbook — the original bill number is preserved.' : undefined}
      />

      {existing && isPastApproval(existing.workflowStatus) ? (
        <Notice tone="amber" title="This bill is approved">
          Changing amounts, deductions, the invoice number, date or project needs the <b>Edit After Approval</b> permission and a reason. Other fields can be edited freely.
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
                {field('GST invoice no.', <Input id="gst-invoice" value={form.gstInvoiceNumber} onChange={(event) => set('gstInvoiceNumber', event.target.value)} placeholder="Leave blank for non-GST (NA)" />, undefined, 'gst-invoice')}
                {field('Bill date *', <Input id="bill-date" type="date" required value={form.billDate} onChange={(event) => set('billDate', event.target.value)} />, derivedFy ? `FY ${derivedFy}` : undefined, 'bill-date')}
                {field(
                  'Transaction type',
                  <Select value={form.transactionType} onValueChange={(value) => set('transactionType', value as BillTransactionType)}>
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
                  form.transactionType === 'credit_note' ? 'Enter credit-note amounts as negative values.' : undefined,
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
                  <Select value={form.projectId} onValueChange={(value) => set('projectId', value)}>
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
                )}
                {field('DGM office', <Input value={form.dgmOffice} onChange={(event) => set('dgmOffice', event.target.value)} placeholder={project?.dgmOffice ?? 'e.g. Rayagada'} list="bt-dgm-offices" />)}
                <datalist id="bt-dgm-offices">
                  {lookups.dgmOffices.map((office) => (
                    <option key={office} value={office} />
                  ))}
                </datalist>
                {field(
                  'Bill type *',
                  <Select value={form.billTypeId} onValueChange={(value) => set('billTypeId', value)}>
                    <SelectTrigger aria-label="Bill type">
                      <SelectValue placeholder="Choose a type" />
                    </SelectTrigger>
                    <SelectContent className="max-h-80">
                      {config.billTypes
                        .filter((type) => type.active || type.id === form.billTypeId)
                        .map((type) => (
                          <SelectItem key={type.id} value={type.id}>
                            {type.name}
                            {type.isRetentionBill ? ' · retention' : ''}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>,
                )}
                <div className="sm:col-span-2">{field('Description', <Input value={form.description} onChange={(event) => set('description', event.target.value)} placeholder="e.g. RA Bill 4 — civil works" />)}</div>
                {field(<Term tip="Pre-GST value of the work or supply billed. Negative for a credit note.">Taxable amount (₹) *</Term>, <Input inputMode="decimal" required value={form.taxableAmount} onChange={(event) => set('taxableAmount', event.target.value)} />)}
                {field(
                  'GST',
                  <div className="flex gap-2">
                    <Select value={form.gstMode} onValueChange={(value) => set('gstMode', value)}>
                      <SelectTrigger className="w-28" aria-label="GST rate">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {GST_PRESETS.map((rate) => (
                          <SelectItem key={rate} value={rate}>
                            {rate}%
                          </SelectItem>
                        ))}
                        <SelectItem value="manual">Custom</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input inputMode="decimal" aria-label="GST amount" value={form.gstAmount} readOnly={form.gstMode !== 'manual'} onChange={(event) => set('gstAmount', event.target.value)} className={form.gstMode !== 'manual' ? 'bg-slate-50' : undefined} />
                  </div>,
                  form.gstMode !== 'manual' ? 'Rounded to the rupee. Choose Custom to type the invoice’s GST.' : undefined,
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="border-white/60 bg-white/85 shadow-sm">
            <CardContent className="space-y-3 p-4">
              <SectionHeader
                title="Deductions"
                as="h3"
                description="Signed amounts: a negative deduction adds to the net (as the legacy compensation rows do)."
                actions={
                  <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={() => setForm((current) => ({ ...current, deductions: [...current.deductions, { id: newId(), deductionTypeId: '', percentage: '', amount: '', remarks: '' }] }))}>
                    <Plus className="h-4 w-4" /> Add deduction
                  </Button>
                }
              />
              {form.deductions.length === 0 ? <p className="text-sm text-muted-foreground">No deductions on this bill.</p> : null}
              <div className="space-y-2">
                {form.deductions.map((line) => {
                  const type = activeTypes.find((entry) => entry.id === line.deductionTypeId);
                  return (
                    <div key={line.id} className="grid grid-cols-1 gap-2 rounded-lg border border-slate-200 bg-white p-2 sm:grid-cols-[minmax(0,1.4fr)_90px_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-center">
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
                      <Input aria-label="Percent" inputMode="decimal" placeholder="%" value={line.percentage} onChange={(event) => updateDeduction(line.id, { percentage: event.target.value })} title={type ? `Percent of ${type.percentBase === 'gross' ? 'gross' : 'taxable'}` : undefined} />
                      <Input aria-label="Deduction amount" inputMode="decimal" placeholder="Amount ₹" value={line.amount} onChange={(event) => updateDeduction(line.id, { amount: event.target.value, percentage: '' })} />
                      <Input aria-label="Remarks" placeholder="Remarks" value={line.remarks} onChange={(event) => updateDeduction(line.id, { remarks: event.target.value })} />
                      <Button type="button" variant="ghost" size="icon" aria-label="Remove deduction" onClick={() => setForm((current) => ({ ...current, deductions: current.deductions.filter((entry) => entry.id !== line.id) }))}>
                        <Trash2 className="h-4 w-4 text-rose-600" />
                      </Button>
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
              <Row label="GST" value={num(form.gstAmount)} />
              <Row label="Gross" value={totals.grossAmount} strong />
              <Row label="Total deduction" value={-totals.totalDeduction} />
              {totals.statutoryDeduction ? <Row label="· Statutory" value={totals.statutoryDeduction} muted /> : null}
              {totals.retentionDeducted ? <Row label="· Retention" value={totals.retentionDeducted} muted /> : null}
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
            <Button type="submit" className="flex-1 gap-1.5" disabled={saving || !canSave || !form.projectId || !form.billTypeId}>
              <Save className="h-4 w-4" />
              {saving ? 'Saving…' : existing ? 'Save changes' : 'Create bill'}
            </Button>
          </div>
        </div>
      </div>
    </form>
  );
}

function Row({ label, value, strong, muted }: { label: string; value: number; strong?: boolean; muted?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-2 ${muted ? 'text-xs text-muted-foreground' : ''}`}>
      <span>{label}</span>
      <Amount value={value} className={strong ? 'font-semibold text-slate-900' : undefined} signed />
    </div>
  );
}
