'use client';

/**
 * Table & Field Configuration — where the module's column layout, form fields and data rules live.
 *
 * These were toolbar controls each user set for themselves. Here they are an organisation default
 * an administrator sets once, so a fresh user, a printout and a support conversation all start
 * from the same register. A user's own column arrangement still wins where they have made one.
 *
 * Nothing is written until Save, the configuration is validated before it can be written, and the
 * column tab previews the result rather than describing it.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Columns3,
  Database,
  Eye,
  EyeOff,
  Info,
  ListChecks,
  Loader2,
  Lock,
  RotateCcw,
  Save,
  ShieldAlert,
  SlidersHorizontal,
} from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import { logUserActivity } from '@/lib/activity-logger';
import {
  EXPENSES_SETTINGS_PATH,
  EXPENSE_DATE_PRESETS,
  EXPENSE_FORM_FIELDS,
  EXPENSE_REGISTERS,
  LOCKED_COLUMNS,
  defaultExpensesSettings,
  hasBlockingIssue,
  moveColumn,
  resolveExpensesSettings,
  setColumnVisibility,
  validateExpensesSettings,
  type ExpenseDatePreset,
  type ExpenseRegisterId,
  type ExpensesModuleSettings,
} from '@/lib/expenses-settings';
import { ExpensesPageHeader } from '@/components/expenses/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

export default function ExpensesTableAndFieldsPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { can, isLoading: isAuthLoading } = useAuthorization();

  const canViewPage = can('View', 'Expenses.Settings');
  // Whoever already administers this module's settings administers these too. A brand-new
  // permission would be granted to nobody, so the screen would ship read-only for everyone.
  const canEdit = can('Manage Accounts', 'Expenses.Settings') || can('Edit Serial Nos', 'Expenses.Settings');

  const [settings, setSettings] = useState<ExpensesModuleSettings>(() => defaultExpensesSettings());
  const [baseline, setBaseline] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [register, setRegister] = useState<ExpenseRegisterId>('department');

  useEffect(() => {
    if (isAuthLoading || !canViewPage) {
      setIsLoading(false);
      return;
    }
    const load = async () => {
      try {
        const snapshot = await getDoc(doc(db, EXPENSES_SETTINGS_PATH.collection, EXPENSES_SETTINGS_PATH.doc));
        const resolved = resolveExpensesSettings(snapshot.data());
        setSettings(resolved);
        setBaseline(JSON.stringify(resolved));
      } catch (error) {
        console.error('Could not load Expenses settings:', error);
        toast({ title: 'Error', description: 'Could not load the configuration.', variant: 'destructive' });
      }
      setIsLoading(false);
    };
    void load();
  }, [isAuthLoading, canViewPage, toast]);

  const issues = useMemo(() => validateExpensesSettings(settings), [settings]);
  const blocked = hasBlockingIssue(issues);
  const isDirty = baseline !== '' && JSON.stringify(settings) !== baseline;

  const columns = settings.registers[register];
  const visibleColumns = columns.filter(column => column.visible);

  const updateColumns = (next: typeof columns) =>
    setSettings(previous => ({ ...previous, registers: { ...previous.registers, [register]: next } }));

  const handleSave = async () => {
    if (!user || blocked) return;
    setIsSaving(true);
    try {
      const payload: ExpensesModuleSettings = {
        ...settings,
        updatedAt: new Date().toISOString(),
        updatedBy: user.name || user.email || user.id,
      };
      await setDoc(doc(db, EXPENSES_SETTINGS_PATH.collection, EXPENSES_SETTINGS_PATH.doc), payload);
      await logUserActivity({
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        module: 'Expenses',
        action: 'Update Table & Field Configuration',
        details: {
          visibleColumns: Object.fromEntries(
            EXPENSE_REGISTERS.map(entry => [
              entry.id,
              settings.registers[entry.id].filter(column => column.visible).length,
            ]),
          ),
          hiddenFields: settings.fields.filter(field => !field.visible).map(field => field.key),
          defaultDateRange: settings.data.defaultDateRange,
        },
      });
      setSettings(payload);
      setBaseline(JSON.stringify(payload));
      toast({ title: 'Configuration saved', description: 'Everyone in the module picks this up straight away.' });
    } catch (error) {
      console.error('Could not save Expenses settings:', error);
      toast({ title: 'Save failed', description: 'The configuration was not written.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  if (isAuthLoading || isLoading) {
    return (
      <div className="w-full space-y-4">
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }

  if (!canViewPage) {
    return (
      <div className="w-full space-y-4">
        <ExpensesPageHeader
          icon={SlidersHorizontal}
          title="Table & Field Configuration"
          accent="teal"
          backHref="/expenses/settings"
        />
        <Card className="border-destructive/30">
          <CardHeader className="pb-2 text-center">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
              <ShieldAlert className="h-7 w-7 text-destructive" />
            </div>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>You do not have permission to view these settings.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="w-full space-y-4">
      <ExpensesPageHeader
        icon={SlidersHorizontal}
        title="Table & Field Configuration"
        description={
          settings.updatedAt
            ? `Last changed by ${settings.updatedBy ?? 'someone'} on ${new Date(settings.updatedAt).toLocaleDateString('en-IN')}`
            : 'Registers, form fields and data rules for the whole module'
        }
        accent="teal"
        backHref="/expenses/settings"
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              disabled={!canEdit || isSaving}
              onClick={() => setSettings(defaultExpensesSettings())}
            >
              <RotateCcw className="h-3.5 w-3.5" /> Reset to defaults
            </Button>
            <Button size="sm" className="gap-2" disabled={!canEdit || !isDirty || blocked || isSaving} onClick={() => void handleSave()}>
              {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              {isSaving ? 'Saving…' : 'Save'}
            </Button>
          </>
        }
      />

      {!canEdit && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-400">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          You can see this configuration but not change it. Managing accounts or serial numbers carries that right.
        </div>
      )}

      {issues.length > 0 && (
        <div
          className={cn(
            'space-y-1 rounded-xl border p-3 text-xs',
            blocked
              ? 'border-destructive/30 bg-destructive/5 text-destructive'
              : 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400',
          )}
        >
          {issues.map((issue, index) => (
            <p key={index} className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {issue.message}
            </p>
          ))}
        </div>
      )}

      <Tabs defaultValue="columns" className="w-full">
        <TabsList className="grid w-full grid-cols-3 sm:w-auto sm:inline-grid">
          <TabsTrigger value="columns" className="gap-1.5 text-xs sm:text-sm">
            <Columns3 className="h-3.5 w-3.5" /> Columns
          </TabsTrigger>
          <TabsTrigger value="fields" className="gap-1.5 text-xs sm:text-sm">
            <ListChecks className="h-3.5 w-3.5" /> Fields
          </TabsTrigger>
          <TabsTrigger value="data" className="gap-1.5 text-xs sm:text-sm">
            <Database className="h-3.5 w-3.5" /> Data
          </TabsTrigger>
        </TabsList>

        {/* ── Columns: order and visibility, per register ── */}
        <TabsContent value="columns" className="mt-4 space-y-4">
          <Card className="overflow-hidden border-white/60 bg-white/70 shadow-sm backdrop-blur-sm">
            <div className="h-[3px] bg-gradient-to-r from-teal-500 via-emerald-500 to-transparent" />
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-bold">Register columns</CardTitle>
              <CardDescription className="text-xs">
                The order and visibility every user starts from. Anyone who has arranged a register for
                themselves keeps their own arrangement.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {EXPENSE_REGISTERS.map(entry => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => setRegister(entry.id)}
                    className={cn(
                      'rounded-lg border px-3 py-2 text-left text-xs transition-colors',
                      register === entry.id
                        ? 'border-teal-300 bg-teal-50 text-teal-800'
                        : 'border-border/60 hover:bg-muted/50',
                    )}
                  >
                    <span className="block font-semibold">{entry.label}</span>
                    <span className="block text-[11px] text-muted-foreground">{entry.description}</span>
                  </button>
                ))}
              </div>

              <div className="overflow-hidden rounded-xl border border-border/60">
                <div className="flex items-center justify-between border-b border-border/60 bg-muted/40 px-4 py-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Column
                  </span>
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Order · Shown
                  </span>
                </div>
                <div className="divide-y divide-border/60">
                  {columns.map((column, index) => {
                    const locked = LOCKED_COLUMNS.includes(column.key);
                    return (
                      <div key={column.key} className="flex items-center gap-3 px-4 py-2">
                        <span className="w-6 text-xs tabular-nums text-muted-foreground">{index + 1}.</span>
                        <span className={cn('flex-1 text-sm', !column.visible && 'text-muted-foreground line-through')}>
                          {column.key}
                        </span>
                        {locked && (
                          <Badge variant="outline" className="gap-1 border-slate-200 bg-slate-50 text-[10px] text-slate-600">
                            <Lock className="h-2.5 w-2.5" /> Always shown
                          </Badge>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          disabled={!canEdit || index === 0}
                          onClick={() => updateColumns(moveColumn(columns, index, 'up'))}
                          aria-label={`Move ${column.key} up`}
                        >
                          <ArrowUp className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          disabled={!canEdit || index === columns.length - 1}
                          onClick={() => updateColumns(moveColumn(columns, index, 'down'))}
                          aria-label={`Move ${column.key} down`}
                        >
                          <ArrowDown className="h-3.5 w-3.5" />
                        </Button>
                        <Switch
                          checked={column.visible}
                          disabled={!canEdit || locked}
                          onCheckedChange={value => updateColumns(setColumnVisibility(columns, column.key, value))}
                          aria-label={`Show ${column.key}`}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Preview, so the arrangement is shown rather than described. */}
              <div>
                <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <Eye className="h-3 w-3" /> Preview — {visibleColumns.length} of {columns.length} columns
                </p>
                <div className="overflow-x-auto rounded-xl border border-border/60">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/40">
                      <tr>
                        {visibleColumns.map(column => (
                          <th
                            key={column.key}
                            className="whitespace-nowrap px-3 py-2 text-left font-semibold uppercase tracking-wide text-muted-foreground"
                          >
                            {column.key}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        {visibleColumns.map(column => (
                          <td key={column.key} className="whitespace-nowrap px-3 py-2 text-muted-foreground/60">
                            —
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Fields: what the request form asks for ── */}
        <TabsContent value="fields" className="mt-4 space-y-4">
          <Card className="overflow-hidden border-white/60 bg-white/70 shadow-sm backdrop-blur-sm">
            <div className="h-[3px] bg-gradient-to-r from-teal-500 via-emerald-500 to-transparent" />
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-bold">Request form fields</CardTitle>
              <CardDescription className="text-xs">
                What the New Expense Request form asks for, what it insists on, and what it calls it.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {EXPENSE_FORM_FIELDS.map(definition => {
                const field = settings.fields.find(entry => entry.key === definition.key);
                if (!field) return null;
                const lockedVisibility = definition.locked || definition.alwaysVisible;
                return (
                  <div key={definition.key} className="rounded-xl border border-border/60 p-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium">{definition.label}</span>
                          {definition.locked && (
                            <Badge variant="outline" className="gap-1 border-slate-200 bg-slate-50 text-[10px] text-slate-600">
                              <Lock className="h-2.5 w-2.5" /> Required by the record
                            </Badge>
                          )}
                        </div>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">{definition.hint}</p>
                      </div>
                      <div className="flex items-center gap-4">
                        <label className="flex items-center gap-1.5 text-xs">
                          {field.visible ? <Eye className="h-3.5 w-3.5 text-emerald-600" /> : <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />}
                          <span className="text-muted-foreground">Shown</span>
                          <Switch
                            checked={field.visible}
                            disabled={!canEdit || lockedVisibility}
                            onCheckedChange={value =>
                              setSettings(previous => ({
                                ...previous,
                                fields: previous.fields.map(entry =>
                                  entry.key === definition.key
                                    ? { ...entry, visible: value, required: value ? entry.required : false }
                                    : entry,
                                ),
                              }))
                            }
                          />
                        </label>
                        <label className="flex items-center gap-1.5 text-xs">
                          <span className="text-muted-foreground">Required</span>
                          <Switch
                            checked={field.required}
                            disabled={!canEdit || definition.locked || !field.visible}
                            onCheckedChange={value =>
                              setSettings(previous => ({
                                ...previous,
                                fields: previous.fields.map(entry =>
                                  entry.key === definition.key ? { ...entry, required: value } : entry,
                                ),
                              }))
                            }
                          />
                        </label>
                      </div>
                    </div>
                    {field.visible && (
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        <Input
                          className="h-8 text-xs"
                          placeholder={`Label on the form — default "${definition.label}"`}
                          disabled={!canEdit}
                          value={field.label ?? ''}
                          onChange={event =>
                            setSettings(previous => ({
                              ...previous,
                              fields: previous.fields.map(entry =>
                                entry.key === definition.key ? { ...entry, label: event.target.value } : entry,
                              ),
                            }))
                          }
                        />
                        <Input
                          className="h-8 text-xs"
                          placeholder="Help text under the field (optional)"
                          disabled={!canEdit}
                          value={field.helpText ?? ''}
                          onChange={event =>
                            setSettings(previous => ({
                              ...previous,
                              fields: previous.fields.map(entry =>
                                entry.key === definition.key ? { ...entry, helpText: event.target.value } : entry,
                              ),
                            }))
                          }
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Data: the rules the module enforces ── */}
        <TabsContent value="data" className="mt-4 space-y-4">
          <Card className="overflow-hidden border-white/60 bg-white/70 shadow-sm backdrop-blur-sm">
            <div className="h-[3px] bg-gradient-to-r from-teal-500 via-emerald-500 to-transparent" />
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-bold">Data rules</CardTitle>
              <CardDescription className="text-xs">
                How the registers open, what may be changed after the fact, and what the module treats as
                worth flagging.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5 rounded-xl border border-border/60 p-3">
                  <Label className="text-xs font-semibold">Registers open on</Label>
                  <Select
                    value={settings.data.defaultDateRange}
                    disabled={!canEdit}
                    onValueChange={value =>
                      setSettings(previous => ({
                        ...previous,
                        data: { ...previous.data, defaultDateRange: value as ExpenseDatePreset },
                      }))
                    }
                  >
                    <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {EXPENSE_DATE_PRESETS.map(preset => (
                        <SelectItem key={preset.value} value={preset.value}>{preset.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">
                    Anything but “All time” hides older requests until the user widens the range.
                  </p>
                </div>

                <div className="space-y-1.5 rounded-xl border border-border/60 p-3">
                  <Label className="text-xs font-semibold">High-value threshold (₹)</Label>
                  <Input
                    type="number"
                    className="h-9 text-sm"
                    disabled={!canEdit}
                    value={settings.data.highValueThreshold}
                    onChange={event =>
                      setSettings(previous => ({
                        ...previous,
                        data: { ...previous.data, highValueThreshold: Number(event.target.value) || 0 },
                      }))
                    }
                  />
                  <p className="text-[11px] text-muted-foreground">What the High Value report flags by default.</p>
                </div>
              </div>

              {[
                {
                  key: 'allowEditAfterReception' as const,
                  title: 'Allow editing after reception',
                  hint: 'A request that already carries a reception number can still be changed.',
                },
                {
                  key: 'restrictPartyToExisting' as const,
                  title: 'Restrict parties to existing names',
                  hint: 'The party picker stops offering to create a new name, which keeps the ledger tidy.',
                },
                {
                  key: 'importDuplicateDetection' as const,
                  title: 'Detect duplicates on import',
                  hint: 'A row matching a request already recorded is skipped rather than created twice.',
                },
              ].map(rule => (
                <label
                  key={rule.key}
                  className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-border/60 p-3"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{rule.title}</span>
                    <span className="block text-[11px] text-muted-foreground">{rule.hint}</span>
                  </span>
                  <Switch
                    checked={settings.data[rule.key]}
                    disabled={!canEdit}
                    onCheckedChange={value =>
                      setSettings(previous => ({ ...previous, data: { ...previous.data, [rule.key]: value } }))
                    }
                  />
                </label>
              ))}

              <div className="space-y-1.5 rounded-xl border border-border/60 p-3">
                <Label className="text-xs font-semibold">Imports take request numbers from</Label>
                <Select
                  value={settings.data.importRequestNoSource}
                  disabled={!canEdit}
                  onValueChange={value =>
                    setSettings(previous => ({
                      ...previous,
                      data: { ...previous.data, importRequestNoSource: value as 'generate' | 'file' },
                    }))
                  }
                >
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="generate">The department series</SelectItem>
                    <SelectItem value="file">The imported file</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  Which option the import wizard opens on. It can still be changed per import.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {isDirty && (
        <div className="sticky bottom-0 -mx-1 flex flex-wrap items-center justify-between gap-3 border-t border-border/40 bg-background/85 px-1 py-3 backdrop-blur-sm">
          <p className="text-xs text-muted-foreground">
            {blocked ? 'Fix the errors above before saving.' : 'Unsaved changes.'}
          </p>
          <div className="flex items-center gap-2">
            <Link href="/expenses/settings">
              <Button variant="ghost" size="sm">Cancel</Button>
            </Link>
            <Button size="sm" className="gap-2" disabled={!canEdit || blocked || isSaving} onClick={() => void handleSave()}>
              {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Save configuration
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
