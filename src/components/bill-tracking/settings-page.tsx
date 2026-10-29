'use client';

/**
 * Bill Tracking settings (`/bill-tracking/settings`): module settings, ageing buckets, the bill-type,
 * deduction-type and stage masters, per-project DGM office / billing client / credit days, month
 * closure, the post-migration data-quality list, a security-rules check and the permission map.
 *
 * Everything here is configuration, so an administrator can add a deduction head or a bill type
 * without a code change. Deduction types can be deactivated but not deleted — the importer and old
 * bills refer to them by code.
 */

import { useState } from 'react';
import Link from 'next/link';
import { collection, getDocs, limit, query } from 'firebase/firestore';
import { BellRing, CalendarClock, Coins, Database, Hash, Lock, Plus, Save, Settings, ShieldCheck, Trash2, Unlock } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader, SectionHeader } from '@/components/shared/page-header';
import { StatusBadge } from '@/components/shared/status-badge';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { financialYearMonths, monthLabel, validateAgeingBuckets } from '@/lib/bill-tracking/calculations';
import { formatBillNumber } from '@/lib/bill-tracking/defaults';
import { formatINR } from '@/lib/bill-tracking/money';
import { cn } from '@/lib/utils';
import {
  AGEING_BASIS_LABELS,
  DEDUCTION_KINDS,
  type BillTrackingConfig,
  type DeductionTypeMaster,
} from '@/lib/bill-tracking/types';

import { validateCategoryConfig } from '@/lib/bill-tracking/categories';

import { BillCategoriesEditor } from './bill-categories-settings';
import { WorkflowSettings } from './workflow-settings';
import { btFetch, useBt, useBtQuery, useLookups } from './bt-client';
import { BtError, BtLoading, FySelect, InfoTip, Notice, BT_TAB, BT_TABS_LIST, FormField } from './bt-ui';

const KIND_LABELS: Record<string, string> = {
  statutory: 'Statutory (Cess / TDS)',
  mobilization_advance: 'Mobilisation advance',
  mobilization_interest: 'Interest on mobilisation advance',
  retention_cpbg: 'Retention — against CPBG',
  retention_invoice: 'Retention — against invoice',
  retention_time_extension: 'Retention — time extension',
  retention_other: 'Retention — other',
  lc_commission: 'LC commission',
  other: 'Other',
};

const newId = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 9)}`;

export default function SettingsPage() {
  const lookups = useLookups();
  const { can, reload } = useBt();
  const { toast } = useToast();
  const [config, setConfig] = useState<BillTrackingConfig>(() => JSON.parse(JSON.stringify(lookups.config)) as BillTrackingConfig);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const manage = can('Settings', 'Manage');
  const settings = config.settings;
  const setSettings = (patch: Partial<BillTrackingConfig['settings']>) => setConfig((current) => ({ ...current, settings: { ...current.settings, ...patch } }));

  const save = async () => {
    const bucketError = validateAgeingBuckets(settings.ageingBuckets) ?? validateCategoryConfig(config.billCategories, config.billTypes);
    if (bucketError) {
      setError(bucketError);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await btFetch('config', {
        method: 'PUT',
        body: {
          settings: { tolerance: settings.tolerance, roundNetToRupee: settings.roundNetToRupee, defaultGstRate: settings.defaultGstRate, roundDeductionsToRupee: settings.roundDeductionsToRupee, defaultCreditDays: settings.defaultCreditDays, defaultAgeingBasis: settings.defaultAgeingBasis, ageingBuckets: settings.ageingBuckets, noFollowUpDays: settings.noFollowUpDays, oldOutstandingDays: settings.oldOutstandingDays, highValueThreshold: settings.highValueThreshold, numbering: settings.numbering, certificationBeforeReceipt: settings.certificationBeforeReceipt, workflowSteps: settings.workflowSteps, piMarker: settings.piMarker },
          billCategories: config.billCategories,
          billTypes: config.billTypes,
          deductionTypes: config.deductionTypes,
          stages: config.stages,
          projectProfiles: config.projectProfiles.filter((profile) => profile.dgmOffice || profile.clientId || profile.creditDays !== undefined),
          projectMappings: config.projectMappings,
        },
      });
      toast({ title: 'Settings saved' });
      await reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  const number = (value: string) => (value === '' ? 0 : Number(value));

  return (
    <div className="space-y-4">
      <PageHeader
        icon={Settings}
        title="Bill Tracking settings"
        description="Tolerances, ageing, masters, project attributes and controls."
        actions={
          manage ? (
            <Button size="sm" className="gap-1.5" disabled={saving} onClick={() => void save()}>
              <Save className="h-4 w-4" /> {saving ? 'Saving…' : 'Save settings'}
            </Button>
          ) : null
        }
      />
      {!manage ? <Notice tone="blue">You can view these settings; changing them needs Bill Tracking · Settings · Manage.</Notice> : null}
      <BtError message={error} />

      <Tabs defaultValue="general">
        <TabsList className={BT_TABS_LIST}>
          <TabsTrigger className={BT_TAB} value="general">General</TabsTrigger>
          <TabsTrigger className={BT_TAB} value="workflow">Workflow</TabsTrigger>
          <TabsTrigger className={BT_TAB} value="ageing">Ageing</TabsTrigger>
          <TabsTrigger className={BT_TAB} value="billTypes">Bill categories</TabsTrigger>
          <TabsTrigger className={BT_TAB} value="deductions">Deduction types</TabsTrigger>
          <TabsTrigger className={BT_TAB} value="stages">Stages</TabsTrigger>
          <TabsTrigger className={BT_TAB} value="projects">Projects & DGM offices</TabsTrigger>
          <TabsTrigger className={BT_TAB} value="months">Month closure</TabsTrigger>
          <TabsTrigger className={BT_TAB} value="quality">Data quality</TabsTrigger>
          <TabsTrigger className={BT_TAB} value="security">Security & permissions</TabsTrigger>
        </TabsList>

        {/*
          Four groups a finance admin looks for — amounts and GST, due dates and ageing, alerts, and
          numbering — each a list: what the setting does on the left, its control on the right, so a
          long explanation no longer pushes the grid out of line. Amounts, rates and days carry their
          unit beside the figure.
        */}
        <TabsContent value="general" className="space-y-4">
          <SettingsGroup icon={Coins} title="Amounts & GST" description="How bills are worked out and when a bill counts as paid.">
            <SettingRow title="Amount tolerance" description="Receipts within this of the net count as fully received; net mismatches within it are not flagged.">
              <AffixInput prefix="₹" inputMode="decimal" disabled={!manage} value={settings.tolerance} onChange={(value) => setSettings({ tolerance: number(value) })} aria-label="Amount tolerance" />
            </SettingRow>
            <SettingRow title="Default GST rate" description="The rate a new bill starts with. CGST and SGST each take half; IGST the whole.">
              <AffixInput suffix="%" inputMode="decimal" disabled={!manage} value={settings.defaultGstRate} onChange={(value) => setSettings({ defaultGstRate: number(value) })} aria-label="Default GST rate" />
            </SettingRow>
            <SettingRow title="Round percentage deductions to the rupee" description="TDS, cess and other percentage deductions — as clients usually deduct them.">
              <Switch disabled={!manage} checked={settings.roundDeductionsToRupee} onCheckedChange={(value) => setSettings({ roundDeductionsToRupee: value })} aria-label="Round percentage deductions to the rupee" />
            </SettingRow>
            <SettingRow title="Round net to the rupee" description="As the legacy sheet's ROUND(Taxable + GST − Deductions, 0).">
              <Switch disabled={!manage} checked={settings.roundNetToRupee} onCheckedChange={(value) => setSettings({ roundNetToRupee: value })} aria-label="Round net to the rupee" />
            </SettingRow>
          </SettingsGroup>

          <SettingsGroup icon={CalendarClock} title="Due dates & ageing" description="When a bill falls due, and how its age is counted.">
            <SettingRow title="Default credit days" description="Due date = bill (or submission) date + credit days, unless the project or client sets its own.">
              <AffixInput suffix="days" inputMode="numeric" disabled={!manage} value={settings.defaultCreditDays} onChange={(value) => setSettings({ defaultCreditDays: number(value) })} aria-label="Default credit days" />
            </SettingRow>
            <SettingRow title="Default ageing basis" description="The date a bill's age is counted from in reports, unless a report picks another.">
              <Select disabled={!manage} value={settings.defaultAgeingBasis} onValueChange={(value) => setSettings({ defaultAgeingBasis: value as BillTrackingConfig['settings']['defaultAgeingBasis'] })}>
                <SelectTrigger aria-label="Default ageing basis">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(AGEING_BASIS_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingRow>
            <SettingRow title="Old outstanding after" description="An unpaid bill older than this is listed in Exceptions as old outstanding.">
              <AffixInput suffix="days" inputMode="numeric" disabled={!manage} value={settings.oldOutstandingDays} onChange={(value) => setSettings({ oldOutstandingDays: number(value) })} aria-label="Old outstanding after (days)" />
            </SettingRow>
          </SettingsGroup>

          <SettingsGroup icon={BellRing} title="Alerts & exceptions" description="What the Exceptions list and reminders flag.">
            <SettingRow title="No follow-up alert after" description="An unpaid bill with no follow-up recorded for this long — since its last follow-up, or since billing — is flagged.">
              <AffixInput suffix="days" inputMode="numeric" disabled={!manage} value={settings.noFollowUpDays} onChange={(value) => setSettings({ noFollowUpDays: number(value) })} aria-label="No follow-up alert after (days)" />
            </SettingRow>
            <SettingRow
              title="High-value bill threshold"
              description="Unpaid bills at or above this appear in Exceptions."
              note={settings.highValueThreshold ? <span className="font-medium text-slate-700">Now {formatINR(settings.highValueThreshold)}</span> : undefined}
            >
              <AffixInput prefix="₹" inputMode="decimal" disabled={!manage} value={settings.highValueThreshold} onChange={(value) => setSettings({ highValueThreshold: number(value) })} aria-label="High-value bill threshold" />
            </SettingRow>
          </SettingsGroup>

          <SettingsGroup icon={Hash} title="Numbering & markers" description="How new bills are numbered, and how proforma invoices are recognised.">
            <SettingRow
              title="Number new bills automatically"
              description={
                <>
                  Tokens <code className="rounded bg-slate-100 px-1 text-[11px]">{'{FY}'}</code> and <code className="rounded bg-slate-100 px-1 text-[11px]">{'{SEQ}'}</code>, the sequence padded to the digits set. Imported bills always keep their own numbers.
                </>
              }
            >
              <Switch disabled={!manage} checked={settings.numbering.enabled} onCheckedChange={(value) => setSettings({ numbering: { ...settings.numbering, enabled: value } })} aria-label="Number new bills automatically" />
            </SettingRow>
            {settings.numbering.enabled ? (
              <div className="grid grid-cols-1 gap-3 border-t border-slate-100 px-4 py-3.5 sm:grid-cols-[minmax(0,1fr)_8rem] sm:px-5">
                <FormField label="Pattern" htmlFor="numbering-pattern">
                  <Input id="numbering-pattern" className="font-mono text-[13px]" disabled={!manage} value={settings.numbering.pattern} onChange={(event) => setSettings({ numbering: { ...settings.numbering, pattern: event.target.value } })} />
                </FormField>
                <FormField label="Sequence digits" htmlFor="numbering-padding">
                  <Input id="numbering-padding" inputMode="numeric" className="text-right tabular-nums" disabled={!manage} value={settings.numbering.padding} onChange={(event) => setSettings({ numbering: { ...settings.numbering, padding: number(event.target.value) } })} />
                </FormField>
                <p className="flex flex-wrap items-center gap-2 text-xs text-slate-500 sm:col-span-2">
                  Next number looks like
                  <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-mono text-[12px] font-medium text-emerald-800">
                    {formatBillNumber(settings.numbering.pattern, lookups.currentFy, 1, settings.numbering.padding)}
                  </span>
                </p>
              </div>
            ) : null}
            <SettingRow title="PI marker" description="The “Bill / PI” value (legacy TAXABLE / ADVANCE) that marks a proforma invoice for the PI report.">
              <Input className="text-center font-medium uppercase" disabled={!manage} value={settings.piMarker} onChange={(event) => setSettings({ piMarker: event.target.value.toUpperCase() })} aria-label="PI marker" />
            </SettingRow>
          </SettingsGroup>
        </TabsContent>

        <TabsContent value="workflow">
          <WorkflowSettings rule={settings.certificationBeforeReceipt} onRuleChange={(rule) => setSettings({ certificationBeforeReceipt: rule })} steps={settings.workflowSteps} onStepsChange={(workflowSteps) => setSettings({ workflowSteps })} users={lookups.users} disabled={!manage} />
        </TabsContent>

        <TabsContent value="ageing">
          <Card className="border-slate-200 bg-white shadow-sm">
            <CardContent className="space-y-3 p-4">
              <SectionHeader descriptionAs="info" title="Ageing buckets" as="h3" description="Contiguous from day 0; the last bucket is open-ended. Changing them re-buckets every report immediately." />
              {settings.ageingBuckets.map((bucket, index) => (
                <div key={index} className="grid grid-cols-[1fr_1fr_1fr_auto] items-center gap-2">
                  <Input aria-label="From day" inputMode="numeric" disabled={!manage} value={bucket.from} onChange={(event) => setSettings({ ageingBuckets: settings.ageingBuckets.map((entry, position) => (position === index ? { ...entry, from: number(event.target.value) } : entry)) })} />
                  <Input aria-label="To day" inputMode="numeric" disabled={!manage} placeholder="open-ended" value={bucket.to ?? ''} onChange={(event) => setSettings({ ageingBuckets: settings.ageingBuckets.map((entry, position) => (position === index ? { ...entry, to: event.target.value === '' ? null : number(event.target.value) } : entry)) })} />
                  <Input aria-label="Label" disabled={!manage} value={bucket.label} onChange={(event) => setSettings({ ageingBuckets: settings.ageingBuckets.map((entry, position) => (position === index ? { ...entry, label: event.target.value } : entry)) })} />
                  <Button variant="ghost" size="icon" disabled={!manage || settings.ageingBuckets.length <= 1} aria-label="Remove bucket" onClick={() => setSettings({ ageingBuckets: settings.ageingBuckets.filter((_, position) => position !== index) })}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              {manage ? (
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setSettings({ ageingBuckets: [...settings.ageingBuckets, { from: 0, to: null, label: 'New' }] })}>
                  <Plus className="h-4 w-4" /> Add bucket
                </Button>
              ) : null}
              <p className="text-xs text-muted-foreground">{validateAgeingBuckets(settings.ageingBuckets) ?? 'Buckets are valid.'}</p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="billTypes">
          <BillCategoriesEditor categories={config.billCategories} types={config.billTypes} disabled={!manage} onChange={(billCategories, billTypes) => setConfig((current) => ({ ...current, billCategories, billTypes }))} />
        </TabsContent>

        <TabsContent value="deductions">
          <Card className="border-slate-200 bg-white shadow-sm">
            <CardContent className="space-y-3 p-4">
              <SectionHeader descriptionAs="info"
                title="Deduction type master"
                as="h3"
                description="Add a new deduction head here — no code change. Kind decides how it is reported (statutory, retention ledger…). Codes BCESS … OTHER are what the importer posts legacy columns to."
                actions={manage ? <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setConfig((current) => ({ ...current, deductionTypes: [...current.deductionTypes, { id: newId('dt'), name: '', code: '', kind: 'other', calculation: 'fixed', percentBase: 'taxable', sequence: current.deductionTypes.length + 1, active: true }] }))}><Plus className="h-4 w-4" /> Add deduction</Button> : null}
              />
              <MasterTable<DeductionTypeMaster>
                rows={config.deductionTypes}
                disabled={!manage}
                allowDelete={(row) => !lookups.config.deductionTypes.some((type) => type.id === row.id)}
                onChange={(rows) => setConfig((current) => ({ ...current, deductionTypes: rows }))}
                columns={[
                  { label: 'Order', render: (row, set) => <Input className="w-16" inputMode="numeric" value={row.sequence} onChange={(event) => set({ sequence: Number(event.target.value) || 0 })} /> },
                  { label: 'Name', render: (row, set) => <Input value={row.name} onChange={(event) => set({ name: event.target.value })} /> },
                  { label: 'Code', render: (row, set) => <Input value={row.code} onChange={(event) => set({ code: event.target.value.toUpperCase() })} /> },
                  {
                    label: 'Kind',
                    render: (row, set) => (
                      <Select value={row.kind} onValueChange={(value) => set({ kind: value as DeductionTypeMaster['kind'] })}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {DEDUCTION_KINDS.map((kind) => (
                            <SelectItem key={kind} value={kind}>
                              {KIND_LABELS[kind]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ),
                  },
                  {
                    label: 'Calculation',
                    render: (row, set) => (
                      <Select value={row.calculation} onValueChange={(value) => set({ calculation: value as DeductionTypeMaster['calculation'] })}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="fixed">Fixed amount</SelectItem>
                          <SelectItem value="percentage">Percentage</SelectItem>
                        </SelectContent>
                      </Select>
                    ),
                  },
                  { label: 'Default %', render: (row, set) => <Input className="w-20" inputMode="decimal" value={row.defaultPercent ?? ''} onChange={(event) => set({ defaultPercent: event.target.value === '' ? undefined : Number(event.target.value) })} /> },
                  {
                    label: '% of',
                    render: (row, set) => (
                      <Select value={row.percentBase} onValueChange={(value) => set({ percentBase: value as DeductionTypeMaster['percentBase'] })}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="taxable">Taxable</SelectItem>
                          <SelectItem value="gross">Gross</SelectItem>
                        </SelectContent>
                      </Select>
                    ),
                  },
                  {
                    label: 'Less (base)',
                    render: (row, set) => <BaseLessPicker type={row} types={config.deductionTypes} onChange={(baseLessTypeIds) => set({ baseLessTypeIds })} disabled={!manage} />,
                  },
                  { label: 'GST on it', render: (row, set) => <Switch checked={Boolean(row.gstApplicable)} onCheckedChange={(value) => set({ gstApplicable: value, gstRate: value ? (row.gstRate ?? settings.defaultGstRate) : row.gstRate })} aria-label="GST applicable on this deduction" /> },
                  { label: 'GST %', render: (row, set) => <Input className="w-16" inputMode="decimal" disabled={!row.gstApplicable} value={row.gstApplicable ? (row.gstRate ?? '') : ''} onChange={(event) => set({ gstRate: event.target.value === '' ? undefined : Number(event.target.value) })} aria-label="GST rate on this deduction" /> },
                  { label: 'Active', render: (row, set) => <Switch checked={row.active} onCheckedChange={(value) => set({ active: value })} /> },
                ]}
              />
              <p className="text-xs text-muted-foreground">
                A percentage deduction is taken of <b>Taxable</b> or <b>Gross</b>, less the deductions ticked under “Less (base)” — e.g. Income TDS = (Taxable − Mobilisation Advance) × rate. “GST on it” adds GST at the given % on top of the deduction (for charges the client recovers with GST).
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="stages">
          <Card className="border-slate-200 bg-white shadow-sm">
            <CardContent className="space-y-3 p-4">
              <SectionHeader descriptionAs="info" title="Bill stage master" as="h3" description="Free-form stages (the legacy STAGES column) shown on the bill — separate from the approval workflow." actions={manage ? <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setConfig((current) => ({ ...current, stages: [...current.stages, { id: newId('st'), name: '', sequence: current.stages.length + 1, active: true }] }))}><Plus className="h-4 w-4" /> Add stage</Button> : null} />
              <MasterTable
                rows={config.stages}
                disabled={!manage}
                allowDelete={() => true}
                onChange={(rows) => setConfig((current) => ({ ...current, stages: rows }))}
                columns={[
                  { label: 'Order', render: (row, set) => <Input className="w-16" inputMode="numeric" value={row.sequence} onChange={(event) => set({ sequence: Number(event.target.value) || 0 })} /> },
                  { label: 'Name', render: (row, set) => <Input value={row.name} onChange={(event) => set({ name: event.target.value })} /> },
                  { label: 'Active', render: (row, set) => <Switch checked={row.active} onCheckedChange={(value) => set({ active: value })} /> },
                ]}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="projects">
          <Card className="border-slate-200 bg-white shadow-sm">
            <CardContent className="space-y-3 p-4">
              <SectionHeader descriptionAs="info" title="Project attributes for billing" as="h3" description="The project master has no DGM office, and its client link is optional — set them here (keyed to the master's project, never a second project list). Credit days override the client's payment terms." />
              <div className="max-h-[60vh] overflow-auto rounded-lg border border-slate-200">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="px-3 py-2 text-left">Project</th>
                      <th className="px-3 py-2 text-left">DGM office</th>
                      <th className="px-3 py-2 text-left">Billing client</th>
                      <th className="px-3 py-2 text-left">Credit days</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lookups.projects.map((project) => {
                      const profile = config.projectProfiles.find((entry) => entry.projectId === project.id) ?? { projectId: project.id };
                      const setProfile = (patch: Partial<typeof profile>) =>
                        setConfig((current) => ({ ...current, projectProfiles: [...current.projectProfiles.filter((entry) => entry.projectId !== project.id), { ...profile, ...patch }] }));
                      return (
                        <tr key={project.id} className="border-t border-slate-100">
                          <td className="px-3 py-1.5">{project.name}</td>
                          <td className="px-3 py-1.5">
                            <Input className="h-8" disabled={!manage} value={profile.dgmOffice ?? ''} onChange={(event) => setProfile({ dgmOffice: event.target.value || undefined })} list="bt-settings-dgm" />
                          </td>
                          <td className="px-3 py-1.5">
                            <Select disabled={!manage} value={profile.clientId || 'none'} onValueChange={(value) => setProfile({ clientId: value === 'none' ? undefined : value, clientName: lookups.clients.find((client) => client.id === value)?.name })}>
                              <SelectTrigger className="h-8">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent className="max-h-72">
                                <SelectItem value="none">From project master{project.clientName ? ` (${project.clientName})` : ''}</SelectItem>
                                {lookups.clients.map((client) => (
                                  <SelectItem key={client.id} value={client.id}>
                                    {client.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </td>
                          <td className="px-3 py-1.5">
                            <Input className="h-8 w-24" inputMode="numeric" disabled={!manage} value={profile.creditDays ?? ''} onChange={(event) => setProfile({ creditDays: event.target.value === '' ? undefined : Number(event.target.value) })} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <datalist id="bt-settings-dgm">
                  {['Rayagada', 'Cuttack', 'Jeypore', 'Angul', 'Berhampur', 'Bhubaneswar', ...lookups.dgmOffices].filter((value, index, all) => all.indexOf(value) === index).map((office) => (
                    <option key={office} value={office} />
                  ))}
                </datalist>
              </div>
              {lookups.allProjects ? null : <p className="text-xs text-muted-foreground">Only your assigned projects are listed.</p>}
              <SectionHeader descriptionAs="info" title={`Remembered import mappings (${config.projectMappings.length})`} as="h3" description="Excel project names the importer maps without asking." />
              {config.projectMappings.length === 0 ? <p className="text-sm text-muted-foreground">None yet — they are saved when you confirm a mapping during import.</p> : null}
              <ul className="divide-y divide-slate-100 text-sm">
                {config.projectMappings.map((mapping) => (
                  <li key={mapping.key} className="flex items-center justify-between gap-2 py-1.5">
                    <span>
                      <b>{mapping.excelName}</b> → {mapping.projectName}
                    </span>
                    {manage ? (
                      <Button variant="ghost" size="icon" aria-label="Forget mapping" onClick={() => setConfig((current) => ({ ...current, projectMappings: current.projectMappings.filter((entry) => entry.key !== mapping.key) }))}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="months">
          <MonthClosure />
        </TabsContent>

        <TabsContent value="quality">
          <DataQuality />
        </TabsContent>

        <TabsContent value="security">
          <SecurityPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/** Which other deductions are subtracted from a percentage deduction's base. */
function BaseLessPicker({ type, types, onChange, disabled }: { type: DeductionTypeMaster; types: DeductionTypeMaster[]; onChange: (ids: string[]) => void; disabled?: boolean }) {
  const selected = type.baseLessTypeIds ?? [];
  const others = types.filter((entry) => entry.id !== type.id);
  const label = type.calculation !== 'percentage' ? '—' : selected.length ? selected.map((id) => types.find((entry) => entry.id === id)?.name ?? id).join(', ') : 'Nothing';
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={disabled || type.calculation !== 'percentage'} className="h-9 max-w-[200px] justify-start truncate font-normal" title={label}>
          <span className="truncate">{type.calculation === 'percentage' ? `− ${label}` : '—'}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-2">
        <p className="px-2 pb-1 text-xs text-muted-foreground">
          {type.name || 'This deduction'} = ({type.percentBase === 'gross' ? 'Gross' : 'Taxable'} − ticked) × %
        </p>
        <ul className="max-h-64 overflow-y-auto">
          {others.map((entry) => (
            <li key={entry.id}>
              <label className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-slate-50">
                <Checkbox checked={selected.includes(entry.id)} onCheckedChange={(checked) => onChange(checked ? [...selected, entry.id] : selected.filter((id) => id !== entry.id))} />
                {entry.name}
              </label>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

/** A titled group of settings: a card with an icon header and its rows. */
function SettingsGroup({ icon: Icon, title, description, children }: { icon: typeof Coins; title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <header className="flex items-start gap-3 border-b border-slate-200 bg-slate-50/70 px-4 py-3 sm:px-5">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700" aria-hidden="true">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
            {title}
            <InfoTip label={`About “${title}”`}>{description}</InfoTip>
          </h3>

        </div>
      </header>
      <div className="divide-y divide-slate-100">{children}</div>
    </section>
  );
}

/** One setting: its name and (i) on the left, its control on the right (beneath it on a phone). */
function SettingRow({ title, description, note, children }: { title: string; description?: React.ReactNode; /** Shown under the name — for a live figure, not an explanation. */ note?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-5">
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-sm font-medium text-slate-800">
          {title}
          {description ? <InfoTip label={`About “${title}”`}>{description}</InfoTip> : null}
        </p>
        {note ? <p className="mt-0.5 text-xs text-slate-600">{note}</p> : null}
      </div>
      <div className="flex shrink-0 sm:w-56 sm:justify-end [&>button[role=switch]]:ml-auto sm:[&>button[role=switch]]:ml-0">{children}</div>
    </div>
  );
}

/** A number with its unit beside it: ₹ before an amount, % or "days" after. */
function AffixInput({ prefix, suffix, value, onChange, ...props }: { prefix?: string; suffix?: string; value: string | number; onChange: (value: string) => void; disabled?: boolean; inputMode?: 'decimal' | 'numeric'; 'aria-label': string }) {
  return (
    <div className="relative w-full">
      {prefix ? <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400" aria-hidden="true">{prefix}</span> : null}
      <Input {...props} value={value} onChange={(event) => onChange(event.target.value)} className={cn('text-right tabular-nums', prefix && 'pl-7', suffix && (suffix.length > 1 ? 'pr-12' : 'pr-7'))} />
      {suffix ? <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400" aria-hidden="true">{suffix}</span> : null}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <FormField label={label} hint={hint}>
      {children}
    </FormField>
  );
}

function MasterTable<T extends { id: string }>({ rows, columns, onChange, disabled, allowDelete }: { rows: T[]; columns: { label: string; render: (row: T, set: (patch: Partial<T>) => void) => React.ReactNode }[]; onChange: (rows: T[]) => void; disabled?: boolean; allowDelete?: (row: T) => boolean }) {
  return (
    <div className="max-h-[60vh] overflow-auto rounded-lg border border-slate-200">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          <tr>
            {columns.map((column) => (
              <th key={column.label} className="px-2 py-2 text-left">
                {column.label}
              </th>
            ))}
            <th className="w-10" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-slate-100">
              {columns.map((column) => (
                <td key={column.label} className="px-2 py-1.5">
                  <fieldset disabled={disabled} className="contents">
                    {column.render(row, (patch) => onChange(rows.map((entry) => (entry.id === row.id ? { ...entry, ...patch } : entry))))}
                  </fieldset>
                </td>
              ))}
              <td className="px-2">
                {!disabled && allowDelete?.(row) ? (
                  <Button variant="ghost" size="icon" aria-label="Remove" onClick={() => onChange(rows.filter((entry) => entry.id !== row.id))}>
                    <Trash2 className="h-4 w-4 text-rose-600" />
                  </Button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MonthClosure() {
  const lookups = useLookups();
  const { can, reload } = useBt();
  const { toast } = useToast();
  const [fy, setFy] = useState(lookups.currentFy);
  const [closed, setClosed] = useState<string[]>(lookups.config.settings.closedMonths);
  const allowed = can('Settings', 'Close Month');
  const toggle = async (month: string, action: 'close' | 'reopen') => {
    const reason = action === 'reopen' ? window.prompt(`Reason for reopening ${monthLabel(month)}?`) : undefined;
    if (action === 'reopen' && !reason) return;
    try {
      const result = await btFetch<{ closedMonths: string[] }>('config/months', { body: { month, action, reason } });
      setClosed(result.closedMonths);
      toast({ title: `${monthLabel(month)} ${action === 'close' ? 'closed' : 'reopened'}` });
      await reload();
    } catch (caught) {
      toast({ title: 'Failed', description: caught instanceof Error ? caught.message : undefined, variant: 'destructive' });
    }
  };
  return (
    <Card className="border-slate-200 bg-white shadow-sm">
      <CardContent className="space-y-3 p-4">
        <SectionHeader descriptionAs="info" title="Month closure" as="h3" description="A closed month accepts no new, changed, deleted or cancelled bills and receipts dated in it — except by someone holding Close Month. Reopening needs a reason; both are audited." actions={<FySelect value={fy} onChange={setFy} allowAll={false} />} />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {financialYearMonths(fy).map((month) => {
            const isClosed = closed.includes(month);
            return (
              <div key={month} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
                <span className="text-sm font-medium">{monthLabel(month)}</span>
                <span className="flex items-center gap-2">
                  {isClosed ? <StatusBadge tone="neutral">Closed</StatusBadge> : <StatusBadge tone="success">Open</StatusBadge>}
                  {allowed ? (
                    <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={isClosed ? `Reopen ${monthLabel(month)}` : `Close ${monthLabel(month)}`} onClick={() => void toggle(month, isClosed ? 'reopen' : 'close')}>
                      {isClosed ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
                    </Button>
                  ) : null}
                </span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function DataQuality() {
  const { data, loading, error, reload } = useBtQuery<{ checks: { key: string; label: string; count: number; billIds: string[] }[]; billCount: number }>('config/data-quality');
  if (loading && !data) return <BtLoading />;
  return (
    <Card className="border-slate-200 bg-white shadow-sm">
      <CardContent className="space-y-3 p-4">
        <SectionHeader descriptionAs="info" title="Data quality" icon={Database} as="h3" description={data ? `Checks over all ${data.billCount} live bills in your scope — most useful straight after a workbook migration.` : undefined} />
        <BtError message={error} onRetry={reload} />
        <ul className="divide-y divide-slate-100">
          {data?.checks.map((check) => (
            <li key={check.key} className="flex items-center justify-between gap-2 py-2 text-sm">
              <span>{check.label}</span>
              {check.count ? (
                <Link className="font-semibold text-amber-700 hover:underline" href={`/bill-tracking/bills?fy=all&ids=${check.billIds.slice(0, 150).join(',')}`}>
                  {check.count} bill{check.count === 1 ? '' : 's'} →
                </Link>
              ) : (
                <StatusBadge tone="success">OK</StatusBadge>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

const PROBE_COLLECTIONS = ['billTrackingBills', 'billTrackingCollections', 'billTrackingRetention', 'billTrackingFollowUps', 'billTrackingComments', 'billTrackingDocuments', 'billTrackingTargets', 'billTrackingActivity', 'billTrackingImportJobs', 'billTrackingConfig'];

const PERMISSION_MAP: [string, string][] = [
  ['billTracking.view', 'Bills · View (and the module)'],
  ['billTracking.create / edit / delete', 'Bills · Add / Edit / Delete'],
  ['billTracking.verify / approve', 'Bills · Verify / Approve'],
  ['billTracking.statusOverride', 'Bills · Override Status'],
  ['(change after approval)', 'Bills · Edit After Approval'],
  ['(client certification)', 'Bills · Certify — record, change or remove the client’s certified figures'],
  ['billTracking.import / rollbackImport', 'Import · Import / Rollback'],
  ['billTracking.collection.view / create / edit / verify', 'Collections · View / Add / Edit / Verify (+ Cancel, Hold Unallocated)'],
  ['billTracking.retention.view / manage', 'Retention · View / Manage'],
  ['billTracking.report.view / export', 'Reports · View / Export'],
  ['billTracking.settings.manage', 'Settings · Manage (+ Close Month)'],
  ['billTracking.allProjects', 'All Projects · View'],
  ['billTracking.assignedProjects', 'No All Projects — the projects granted in Access Management'],
];

function SecurityPanel() {
  const [results, setResults] = useState<{ name: string; open: boolean; message: string }[] | null>(null);
  const [running, setRunning] = useState(false);
  const run = async () => {
    setRunning(true);
    const outcome = [];
    for (const name of PROBE_COLLECTIONS) {
      try {
        const snapshot = await getDocs(query(collection(db, name), limit(1)));
        outcome.push({ name, open: true, message: snapshot.empty ? 'Readable from the browser (empty)' : 'READABLE from the browser' });
      } catch (caught) {
        const code = (caught as { code?: string }).code ?? '';
        outcome.push({ name, open: false, message: code === 'permission-denied' ? 'Closed to clients' : code || 'Closed' });
      }
    }
    setResults(outcome);
    setRunning(false);
  };
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card className="border-slate-200 bg-white shadow-sm">
        <CardContent className="space-y-3 p-4">
          <SectionHeader descriptionAs="info" title="Check security rules" icon={ShieldCheck} as="h3" description="Bill Tracking reads and writes only through its API. This tries each collection directly from your browser — every one should be closed. If any answer, copy the Bill Tracking blocks from firestore.rules into the Firebase console." />
          <Button size="sm" variant="outline" disabled={running} onClick={() => void run()}>
            {running ? 'Checking…' : 'Check security rules'}
          </Button>
          {results ? (
            <ul className="space-y-1 text-sm">
              {results.map((result) => (
                <li key={result.name} className="flex items-center justify-between gap-2">
                  <code className="text-xs">{result.name}</code>
                  <StatusBadge tone={result.open ? 'danger' : 'success'}>{result.message}</StatusBadge>
                </li>
              ))}
            </ul>
          ) : null}
          {results?.some((result) => result.open) ? <Notice tone="rose" title="Rules need updating">Some collections can be read directly by any signed-in user, bypassing project scope. Deploy the Bill Tracking blocks in firestore.rules to the console.</Notice> : null}
        </CardContent>
      </Card>
      <Card className="border-slate-200 bg-white shadow-sm">
        <CardContent className="space-y-3 p-4">
          <SectionHeader descriptionAs="info" title="Permissions" as="h3" description="Granted per role in Settings → Access Management under “Bill Tracking”. Project-scoped grants limit a user to those projects." />
          <table className="w-full text-xs">
            <tbody>
              {PERMISSION_MAP.map(([spec, actual]) => (
                <tr key={spec} className="border-t border-slate-100">
                  <td className="py-1.5 pr-2 font-mono text-[11px] text-slate-600">{spec}</td>
                  <td className="py-1.5">{actual}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Link className="text-xs font-medium text-emerald-700 hover:underline" href="/settings/access-management">
            Open Access Management →
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
