'use client';

/**
 * Company Profile › GST: the registrations the letterhead can print. The primary one prints on
 * the standard letterhead; a designed one can list them all (`{{allGstins}}`). Each row shows at
 * once whether Save will keep it, and the state fills itself in from a valid GSTIN.
 */

import { CheckCircle2, Download, Plus, Receipt, Star, Trash2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SettingsNotice, SettingsSection } from '@/components/settings/settings-ui';
import { checkGstin, normaliseTaxId } from '@/lib/statutory';
import { gstRowStatuses, registrationsNotListed, type ImportableRegistration } from '@/lib/company-profile-checks';
import type { CompanyGstRegistration } from '@/lib/company-profile';
import { cn } from '@/lib/utils';
import { INVALID_CONTROL, fieldDomId } from './profile-parts';

export function GstTab({
  rows,
  readOnly,
  importable,
  addLabel,
  deleteLabel,
  onChange,
  onImport,
}: {
  rows: CompanyGstRegistration[];
  readOnly: boolean;
  /** Expenses › GST registrations' active entries. */
  importable: ImportableRegistration[];
  addLabel: string;
  deleteLabel: string;
  onChange: (rows: CompanyGstRegistration[]) => void;
  onImport: () => void;
}) {
  const statuses = gstRowStatuses(rows);
  const notListed = registrationsNotListed(rows, importable);
  const kept = statuses.filter((status) => status.state === 'valid').length;

  const change = (index: number, patch: Partial<CompanyGstRegistration>) => onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  const setGstin = (index: number, value: string) => {
    const gstin = value.toUpperCase();
    const check = checkGstin(gstin);
    // A valid GSTIN names its state; fill it in unless the person has typed one.
    change(index, check.valid && !rows[index].state.trim() ? { gstin, state: check.stateName ?? '' } : { gstin });
  };
  const add = () => onChange([...rows, { gstin: '', state: '', label: '', primary: rows.length === 0 }]);
  const remove = (index: number) => {
    const next = rows.filter((_, i) => i !== index);
    // Removing the primary passes the mark to the first that is left.
    if (rows[index].primary && next.length && !next.some((row) => row.primary)) next[0] = { ...next[0], primary: true };
    onChange(next);
  };

  const actions = readOnly ? undefined : (
    <>
      {importable.length > 0 && (
        <Button variant="outline" size="sm" onClick={onImport}>
          <Download className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Import from Expenses
        </Button>
      )}
      <Button size="sm" onClick={add}>
        <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
        {addLabel} GSTIN
      </Button>
    </>
  );

  return (
    <SettingsSection
      title="GST registrations"
      icon={Receipt}
      description={rows.length ? `${kept} of ${rows.length} will be kept. The primary one prints on the letterhead.` : 'The primary registration prints on the letterhead.'}
      action={actions}
      contentClassName="space-y-3"
    >
      {!readOnly && notListed.length > 0 && rows.length > 0 && (
        <SettingsNotice
          title={`${notListed.length} more in Expenses`}
          action={<Button size="sm" variant="outline" onClick={onImport}>Import</Button>}
        >
          Expenses › GST registrations has {notListed.map((entry) => entry.label || entry.stateName).join(', ')}, not listed here yet.
        </SettingsNotice>
      )}

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-10 text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary" aria-hidden="true">
            <Receipt className="h-5 w-5" />
          </span>
          <p className="text-sm font-semibold">No GST registrations yet</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            {importable.length > 0
              ? `Import the ${importable.length} set up in Expenses › GST registrations, or add one by hand.`
              : 'Add the company’s GSTINs. Expenses › GST registrations has none to import.'}
          </p>
          {actions && <div className="mt-1 flex flex-wrap justify-center gap-2">{actions}</div>}
        </div>
      ) : (
        <ol className="space-y-2">
          {rows.map((row, index) => {
            const status = statuses[index];
            const ok = status.state === 'valid';
            const id = fieldDomId(`gst.${index}`);
            const typed = normaliseTaxId(row.gstin);
            return (
              <li key={index} className={cn('rounded-lg border p-3', row.primary ? 'border-primary/40 bg-primary/5' : 'bg-card')}>
                {/* A fixed width for the buttons, so "Primary" and "Make primary" rows keep the same columns. */}
                <div className="grid grid-cols-2 gap-x-3 gap-y-2.5 md:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_minmax(0,1fr)_10.5rem] md:items-start">
                  <div className="col-span-2 min-w-0 space-y-1.5 md:col-span-1">
                    <Label htmlFor={id} className="text-xs font-semibold">GSTIN</Label>
                    <Input
                      id={id}
                      aria-invalid={(!ok && Boolean(typed)) || undefined}
                      aria-describedby={`${id}-note`}
                      value={row.gstin}
                      onChange={(event) => setGstin(index, event.target.value)}
                      disabled={readOnly}
                      maxLength={15}
                      placeholder="21AAAAA0000A1Z5"
                      className={cn('font-mono uppercase tracking-wide', !ok && typed && INVALID_CONTROL)}
                    />
                    <p id={`${id}-note`} className={cn('flex items-start gap-1 text-[11px] leading-snug', ok ? 'text-emerald-600' : typed ? 'text-rose-600' : 'text-muted-foreground')}>
                      {ok ? <CheckCircle2 className="mt-px h-3 w-3 shrink-0" aria-hidden="true" /> : typed ? <XCircle className="mt-px h-3 w-3 shrink-0" aria-hidden="true" /> : null}
                      <span className="min-w-0">{typed || ok ? status.message : '15 characters; the state and PAN are read from it.'}</span>
                    </p>
                  </div>
                  <div className="min-w-0 space-y-1.5">
                    <Label htmlFor={`${id}-state`} className="text-xs font-semibold">State</Label>
                    <Input id={`${id}-state`} value={row.state} onChange={(event) => change(index, { state: event.target.value })} disabled={readOnly} placeholder={status.stateName ?? 'From the GSTIN'} maxLength={60} />
                  </div>
                  <div className="min-w-0 space-y-1.5">
                    <Label htmlFor={`${id}-label`} className="text-xs font-semibold">Label</Label>
                    <Input id={`${id}-label`} value={row.label} onChange={(event) => change(index, { label: event.target.value })} disabled={readOnly} placeholder={row.state || status.stateName || 'e.g. Head office'} maxLength={80} />
                  </div>
                  <div className="col-span-2 flex items-center justify-end gap-1 md:col-span-1 md:pt-6">
                    {readOnly ? (
                      row.primary && (
                        <span className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-primary">
                          <Star className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                          Primary
                        </span>
                      )
                    ) : (
                      <>
                        <Button
                          type="button"
                          size="sm"
                          variant={row.primary ? 'secondary' : 'ghost'}
                          aria-pressed={row.primary}
                          className={cn('h-9', row.primary && 'text-primary')}
                          onClick={() => onChange(rows.map((entry, i) => ({ ...entry, primary: i === index })))}
                        >
                          <Star className={cn('mr-1.5 h-3.5 w-3.5', row.primary && 'fill-current')} aria-hidden="true" />
                          {row.primary ? 'Primary' : 'Make primary'}
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-9 w-9 text-muted-foreground hover:text-rose-600"
                          title={`${deleteLabel} ${row.gstin || 'this row'}`}
                          aria-label={`${deleteLabel} ${row.gstin || `row ${index + 1}`}`}
                          onClick={() => remove(index)}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </SettingsSection>
  );
}
