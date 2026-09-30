'use client';

/**
 * Expenses › Settings › Field Control — what the New Request form asks for and what the registers
 * show.
 *
 * Two halves of one organisation default: the request form's fields (label, help text, required,
 * shown) and the column layout of the department and consolidated registers. A user's own column
 * arrangement still wins where they have made one.
 *
 * Saves only its own part of `expensesSettings/module-config` (registers + fields), so it can
 * never undo a Data Control change. Each save is logged with a readable before/after.
 */

import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Columns3, Eye, ListChecks, Lock, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { useAuth } from '@/components/auth/AuthProvider';
import { useToast } from '@/hooks/use-toast';
import { useActivityLogger } from '@/hooks/useActivityLogger';
import { ACTIVITY_MODULES } from '@/lib/activity-modules';
import { diffFields } from '@/lib/activity-logger';
import {
  DEFAULT_EXPENSE_FIELDS,
  EXPENSE_FORM_FIELDS,
  EXPENSE_REGISTERS,
  LOCKED_COLUMNS,
  defaultExpensesSettings,
  fieldControlPayload,
  flattenFieldControl,
  hasBlockingIssue,
  moveColumn,
  resolveExpensesSettings,
  setColumnVisibility,
  settingsStampFor,
  validateFieldControl,
  type ExpenseColumnSetting,
  type ExpenseFieldSetting,
  type ExpenseRegisterId,
  type ExpensesModuleSettings,
} from '@/lib/expenses-settings';
import {
  CONTROL_LABEL,
  ControlAccessDenied,
  ControlCard,
  ControlSaveBar,
  IssueList,
  ReadOnlyNotice,
  saveExpensesSettingsPart,
  stampLine,
  useExpensesControlAccess,
  useSettingsPartDraft,
} from '@/components/expenses/settings-control-kit';
import { PageHeader } from '@/components/shared/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

type FieldControl = Pick<ExpensesModuleSettings, 'registers' | 'fields'>;

const pickFieldControl = (settings: ExpensesModuleSettings): FieldControl => ({
  registers: settings.registers,
  fields: settings.fields,
});

const defaultFieldControl = (): FieldControl => pickFieldControl(defaultExpensesSettings());

export default function ExpensesFieldControlPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { log } = useActivityLogger(ACTIVITY_MODULES.EXPENSES);
  const { canView, canEdit, isLoading: isAuthLoading } = useExpensesControlAccess('Field Control');
  const draft = useSettingsPartDraft(pickFieldControl);
  const { value, isDirty, update } = draft;

  const [register, setRegister] = useState<ExpenseRegisterId>('department');
  const [isSaving, setIsSaving] = useState(false);

  const issues = useMemo(() => validateFieldControl(value), [value]);
  const blocked = hasBlockingIssue(issues);
  const stamp = settingsStampFor(draft.settings, 'fieldControl');

  const columns = value.registers[register];
  const visibleColumns = columns.filter(column => column.visible);
  const registerMeta = EXPENSE_REGISTERS.find(entry => entry.id === register)!;

  const setColumns = (next: ExpenseColumnSetting[]) =>
    update(current => ({ ...current, registers: { ...current.registers, [register]: next } }));

  const setField = (key: ExpenseFieldSetting['key'], change: Partial<ExpenseFieldSetting>) =>
    update(current => ({
      ...current,
      fields: current.fields.map(entry => {
        if (entry.key !== key) return entry;
        const next = { ...entry, ...change };
        // A cleared box is no override, not an empty one — so clearing it is not a pending change.
        if (next.label === '') delete next.label;
        if (next.helpText === '') delete next.helpText;
        return next;
      }),
    }));

  const handleSave = async () => {
    if (!user || !canEdit || blocked) return;
    setIsSaving(true);
    try {
      const payload = fieldControlPayload(value);
      const before = await saveExpensesSettingsPart('fieldControl', payload, user);
      const changes = diffFields(flattenFieldControl(before), flattenFieldControl(payload));
      await log(
        'Update Expenses Field Control',
        { changes, changedCount: Object.keys(changes).length },
        { recordId: 'module-config', recordRef: 'Field Control' },
      );
      draft.markSaved(pickFieldControl(resolveExpensesSettings(payload)));
      toast({ title: 'Field Control saved', description: 'Everyone in the module picks this up straight away.' });
    } catch (error) {
      console.error('Could not save Expenses Field Control:', error);
      toast({ title: 'Save failed', description: 'The configuration was not written.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  if (isAuthLoading || draft.isLoading) {
    return (
      <div className="w-full space-y-4">
        <Skeleton className="h-14 w-full rounded-xl" />
        <Skeleton className="h-96 w-full rounded-xl" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="w-full space-y-4">
        <PageHeader icon={SlidersHorizontal} title="Field Control" backHref="/expenses/settings" backLabel="Back to settings" />
        <ControlAccessDenied />
      </div>
    );
  }

  return (
    <div className="w-full space-y-4">
      <PageHeader
        icon={SlidersHorizontal}
        title="Field Control"
        description={stampLine(stamp, 'Request form fields and register columns for the whole module')}
        backHref="/expenses/settings"
        backLabel="Back to settings"
      />

      {!canEdit && <ReadOnlyNotice section="Field Control" />}
      <IssueList issues={issues} />

      {/* ── Request form fields ── */}
      <ControlCard
        icon={ListChecks}
        title="Request form fields"
        description="What the New Expense Request form asks for, what it insists on, and what it calls it."
        contentClassName="p-0"
      >
        <div className="hidden grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1.3fr)_4.5rem_4.5rem_2.25rem] items-center gap-3 border-b bg-muted/30 px-4 py-2 lg:grid">
          {['Field', 'Label on the form', 'Help text', 'Required', 'Shown', ''].map(heading => (
            <span key={heading || 'reset'} className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {heading}
            </span>
          ))}
        </div>
        <div className="divide-y">
          {EXPENSE_FORM_FIELDS.map(definition => {
            const field = value.fields.find(entry => entry.key === definition.key);
            if (!field) return null;
            const lockedVisibility = definition.locked || definition.alwaysVisible;
            const shipped = DEFAULT_EXPENSE_FIELDS.find(entry => entry.key === definition.key)!;
            const isDefault =
              field.visible === shipped.visible && field.required === shipped.required && !field.label && !field.helpText;
            return (
              <div
                key={definition.key}
                className="grid grid-cols-1 items-center gap-3 px-4 py-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1.3fr)_4.5rem_4.5rem_2.25rem]"
              >
                <div className="min-w-0 sm:col-span-2 lg:col-span-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={cn('text-sm font-medium text-slate-800', !field.visible && 'text-muted-foreground line-through')}>
                      {definition.label}
                    </span>
                    {definition.locked && (
                      <Badge variant="neutral" className="gap-1 px-1.5 py-0 text-[10px]">
                        <Lock className="h-2.5 w-2.5" /> Locked
                      </Badge>
                    )}
                  </div>
                  <span className="block text-[11px] text-muted-foreground">{definition.hint}</span>
                </div>

                <div className="min-w-0 space-y-1">
                  <label htmlFor={`label-${definition.key}`} className={cn(CONTROL_LABEL, 'lg:sr-only')}>
                    Label on the form
                  </label>
                  <Input
                    id={`label-${definition.key}`}
                    className="h-9 text-sm"
                    placeholder={definition.label}
                    disabled={!canEdit}
                    value={field.label ?? ''}
                    onChange={event => setField(definition.key, { label: event.target.value })}
                  />
                </div>

                <div className="min-w-0 space-y-1">
                  <label htmlFor={`help-${definition.key}`} className={cn(CONTROL_LABEL, 'lg:sr-only')}>
                    Help text
                  </label>
                  <Input
                    id={`help-${definition.key}`}
                    className="h-9 text-sm"
                    placeholder="Shown under the field (optional)"
                    disabled={!canEdit}
                    value={field.helpText ?? ''}
                    onChange={event => setField(definition.key, { helpText: event.target.value })}
                  />
                </div>

                <div className="flex items-center gap-4 sm:col-span-2 lg:contents">
                  <label className="flex items-center gap-2 text-xs text-muted-foreground lg:justify-start">
                    <Switch
                      checked={field.required}
                      disabled={!canEdit || definition.locked || !field.visible}
                      onCheckedChange={checked => setField(definition.key, { required: checked })}
                      aria-label={`${definition.label} required`}
                    />
                    <span className="lg:sr-only">Required</span>
                  </label>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Switch
                      checked={field.visible}
                      disabled={!canEdit || lockedVisibility}
                      // A hidden field can never be required — the form could not be submitted.
                      onCheckedChange={checked =>
                        setField(definition.key, { visible: checked, required: checked ? field.required : false })
                      }
                      aria-label={`${definition.label} shown`}
                    />
                    <span className="lg:sr-only">Shown</span>
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="ml-auto h-8 w-8 lg:ml-0"
                    disabled={!canEdit || isDefault}
                    onClick={() => setField(definition.key, { ...shipped, label: undefined, helpText: undefined })}
                    aria-label={`Reset ${definition.label}`}
                    title="Reset this field"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </ControlCard>

      {/* ── Register columns ── */}
      <ControlCard
        icon={Columns3}
        title="Register columns"
        description="The order and visibility every user starts from. Anyone who has arranged a register for themselves keeps their own arrangement."
        actions={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            disabled={!canEdit}
            onClick={() => setColumns(defaultFieldControl().registers[register])}
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reset this register
          </Button>
        }
      >
        <div className="space-y-4">
          <div className="inline-flex w-full rounded-lg border bg-muted/40 p-0.5 sm:w-auto" role="tablist">
            {EXPENSE_REGISTERS.map(entry => (
              <button
                key={entry.id}
                type="button"
                role="tab"
                aria-selected={register === entry.id}
                onClick={() => setRegister(entry.id)}
                className={cn(
                  'flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors sm:flex-none',
                  register === entry.id ? 'bg-white text-slate-900 shadow-sm' : 'text-muted-foreground hover:text-slate-800',
                )}
              >
                {entry.label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">{registerMeta.description}</p>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="overflow-hidden rounded-lg border">
              <div className="flex items-center justify-between border-b bg-muted/30 px-3 py-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Column</span>
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Order · Shown</span>
              </div>
              <div className="divide-y">
                {columns.map((column, index) => {
                  const locked = LOCKED_COLUMNS.includes(column.key);
                  return (
                    <div key={column.key} className="flex items-center gap-2 px-3 py-1.5">
                      <span className="w-6 shrink-0 text-xs tabular-nums text-muted-foreground">{index + 1}.</span>
                      <span className={cn('min-w-0 flex-1 truncate text-sm', !column.visible && 'text-muted-foreground line-through')}>
                        {column.key}
                      </span>
                      {locked && (
                        <span className="inline-flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground" title="Always shown">
                          <Lock className="h-2.5 w-2.5" /> Fixed
                        </span>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        disabled={!canEdit || index === 0}
                        onClick={() => setColumns(moveColumn(columns, index, 'up'))}
                        aria-label={`Move ${column.key} up`}
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        disabled={!canEdit || index === columns.length - 1}
                        onClick={() => setColumns(moveColumn(columns, index, 'down'))}
                        aria-label={`Move ${column.key} down`}
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </Button>
                      <Switch
                        checked={column.visible}
                        disabled={!canEdit || locked}
                        onCheckedChange={checked => setColumns(setColumnVisibility(columns, column.key, checked))}
                        aria-label={`Show ${column.key}`}
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Preview, so the arrangement is shown rather than described. */}
            <div className="min-w-0 space-y-2">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <Eye className="h-3 w-3" /> Preview — {visibleColumns.length} of {columns.length} columns
              </p>
              <div className="min-w-0 overflow-x-auto rounded-lg border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/30">
                    <tr>
                      {visibleColumns.map(column => (
                        <th key={column.key} className="whitespace-nowrap px-3 py-2 text-left font-semibold text-slate-700">
                          {column.key}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[0, 1].map(row => (
                      <tr key={row} className="border-t">
                        {visibleColumns.map(column => (
                          <td key={column.key} className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                            —
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </ControlCard>

      <ControlSaveBar
        isDirty={isDirty}
        blocked={blocked}
        isSaving={isSaving}
        canEdit={canEdit}
        onSave={() => void handleSave()}
        onDiscard={draft.discard}
        onReset={() => draft.replace(defaultFieldControl())}
      />
    </div>
  );
}
