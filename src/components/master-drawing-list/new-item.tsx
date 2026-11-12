'use client';

/**
 * Add Drawing Item — where Project Management's register adds BOQ items, this one adds its own.
 * Everything on it follows the module's Settings:
 *   - Schedule and Scope offer the values switched on in Settings › Schedules & Scopes;
 *   - each field's label, whether it is shown and whether it is required come from Settings ›
 *     Field Control (Drawing Item and Drawing Details forms);
 * and the API checks the same again. The Sl. No. is not typed: the server gives the next number in
 * the project for that schedule and scope, and the form shows which one it will be.
 */

import { useEffect, useMemo } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { FormDialog } from '@/components/shared/form-dialog';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { isIsoDate } from '@/lib/master-drawing-list/derive';
import { activeNames, fieldSetting, type FieldSetting } from '@/lib/master-drawing-list/settings';

import { mdlFetch, useMdlQuery, useMdlSettings } from './mdl-client';

type NewItemForm = {
  schedule: string;
  scope: string;
  group: string;
  description: string;
  docNo: string;
  drawingNo: string;
  plannedStartDate: string;
  plannedEndDate: string;
};

interface GroupsData {
  groups: { schedule: string; scope: string; group: string }[];
  nextSlNo: Record<string, string>;
}

/** The label as Field Control names it, with the required mark or "(optional)". */
function FieldLabel({ setting }: { setting: FieldSetting }) {
  return (
    <FormLabel>
      {setting.label}
      {setting.required ? <span className="text-destructive"> *</span> : <span className="font-normal text-muted-foreground"> (optional)</span>}
    </FormLabel>
  );
}

export function AddItemDialog({ projectCode, open, onOpenChange, onAdded }: { projectCode: string; open: boolean; onOpenChange: (open: boolean) => void; onAdded: (id: string) => void }) {
  const { toast } = useToast();
  const settings = useMdlSettings();
  const schedules = activeNames(settings.masterData.schedules);
  const scopes = activeNames(settings.masterData.scopes);
  const f = useMemo(
    () => ({
      schedule: fieldSetting(settings.fieldControl, 'item', 'schedule'),
      scope: fieldSetting(settings.fieldControl, 'item', 'scope'),
      group: fieldSetting(settings.fieldControl, 'item', 'group'),
      description: fieldSetting(settings.fieldControl, 'item', 'description'),
      docNo: fieldSetting(settings.fieldControl, 'drawing', 'docNo'),
      drawingNo: fieldSetting(settings.fieldControl, 'drawing', 'drawingNo'),
      plannedStartDate: fieldSetting(settings.fieldControl, 'drawing', 'plannedStartDate'),
      plannedEndDate: fieldSetting(settings.fieldControl, 'drawing', 'plannedEndDate'),
    }),
    [settings.fieldControl],
  );

  const schema = useMemo(() => {
    const text = (setting: FieldSetting, max: number) => {
      const base = z.string().trim().max(max, `Keep this under ${max} characters.`);
      return setting.required ? base.min(1, `${setting.label} is required.`) : base;
    };
    const date = (setting: FieldSetting) =>
      z.string().refine((value) => (setting.required ? Boolean(value) : true), `${setting.label} is required.`).refine((value) => value === '' || isIsoDate(value), 'Enter a valid date.');
    return z
      .object({
        schedule: z.string().refine((value) => schedules.includes(value), `Choose a ${f.schedule.label.toLowerCase()}.`),
        scope: z.string().refine((value) => scopes.includes(value), `Choose a ${f.scope.label.toLowerCase()}.`),
        group: text(f.group, 200),
        description: z.string().trim().min(3, `Enter the ${f.description.label.toLowerCase()}.`).max(2000),
        docNo: text(f.docNo, 200),
        drawingNo: text(f.drawingNo, 200),
        plannedStartDate: date(f.plannedStartDate),
        plannedEndDate: date(f.plannedEndDate),
      })
      .refine((values) => !values.plannedStartDate || !values.plannedEndDate || values.plannedEndDate >= values.plannedStartDate, {
        path: ['plannedEndDate'],
        message: `${f.plannedEndDate.label} cannot be before the ${f.plannedStartDate.label.toLowerCase()}.`,
      });
  }, [f, schedules, scopes]);

  const empty = (): NewItemForm => ({ schedule: schedules[0] ?? '', scope: scopes[0] ?? '', group: '', description: '', docNo: '', drawingNo: '', plannedStartDate: '', plannedEndDate: '' });
  const form = useForm<NewItemForm>({ resolver: zodResolver(schema), defaultValues: empty() });
  useEffect(() => {
    if (open) form.reset(empty());
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const [schedule, scope] = useWatch({ control: form.control, name: ['schedule', 'scope'] });
  const groups = useMdlQuery<GroupsData>(open ? `groups?project=${encodeURIComponent(projectCode)}` : null);
  const suggestions = useMemo(() => (groups.data?.groups ?? []).filter((entry) => entry.schedule === schedule && entry.scope === scope).map((entry) => entry.group), [groups.data, schedule, scope]);
  const nextSlNo = groups.data?.nextSlNo[`${schedule}|${scope}`];

  const submit = form.handleSubmit(async (values) => {
    try {
      const body = {
        ...values,
        projectCode,
        // A hidden field is sent empty, whatever was typed before it was hidden.
        group: f.group.visible ? values.group : '',
        docNo: f.docNo.visible ? values.docNo : '',
        drawingNo: f.drawingNo.visible ? values.drawingNo : '',
        plannedStartDate: f.plannedStartDate.visible ? values.plannedStartDate : '',
        plannedEndDate: f.plannedEndDate.visible ? values.plannedEndDate : '',
      };
      const result = await mdlFetch<{ id: string; slNo: string }>('items', { method: 'POST', body });
      toast({ title: 'Drawing item added', description: `Sl. No. ${result.slNo} in ${values.schedule} › ${values.scope}.` });
      onAdded(result.id);
      onOpenChange(false);
    } catch (error) {
      form.setError('root', { message: error instanceof Error ? error.message : 'Could not add the item.' });
    }
  });

  const textField = (name: 'docNo' | 'drawingNo', setting: FieldSetting) =>
    setting.visible ? (
      <FormField
        control={form.control}
        name={name}
        render={({ field }) => (
          <FormItem>
            <FieldLabel setting={setting} />
            <FormControl>
              <Input autoComplete="off" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    ) : null;
  const dateField = (name: 'plannedStartDate' | 'plannedEndDate', setting: FieldSetting) =>
    setting.visible ? (
      <FormField
        control={form.control}
        name={name}
        render={({ field }) => (
          <FormItem>
            <FieldLabel setting={setting} />
            <FormControl>
              <Input type="date" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    ) : null;
  const listField = (name: 'schedule' | 'scope', setting: FieldSetting, values: string[], description?: React.ReactNode) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>
            {setting.label} <span className="text-destructive">*</span>
          </FormLabel>
          <Select value={field.value} onValueChange={field.onChange}>
            <FormControl>
              <SelectTrigger className="text-left">
                <SelectValue placeholder={`Choose a ${setting.label.toLowerCase()}`} />
              </SelectTrigger>
            </FormControl>
            <SelectContent className="max-h-72">
              {values.map((value) => (
                <SelectItem key={value} value={value}>
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {description}
          <FormMessage />
        </FormItem>
      )}
    />
  );

  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title="Add Drawing Item" description="A drawing or document for the client's approval. It joins the end of its schedule and scope." size="lg" onSubmit={submit} submitLabel="Add Item" submitting={form.formState.isSubmitting}>
      <Form {...form}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {listField('schedule', f.schedule, schedules)}
          {listField('scope', f.scope, scopes, <FormDescription>{nextSlNo ? `This item will be Sl. No. ${nextSlNo}.` : groups.loading ? 'Working out the Sl. No.…' : ' '}</FormDescription>)}
        </div>
        {f.group.visible && (
          <FormField
            control={form.control}
            name="group"
            render={({ field }) => (
              <FormItem>
                <FieldLabel setting={f.group} />
                <FormControl>
                  <Input list="mdl-group-suggestions" autoComplete="off" placeholder="The heading the item sits under" {...field} />
                </FormControl>
                <datalist id="mdl-group-suggestions">
                  {suggestions.map((group) => (
                    <option key={group} value={group} />
                  ))}
                </datalist>
                <FormDescription>{suggestions.length ? `${suggestions.length} existing group${suggestions.length === 1 ? '' : 's'} in ${schedule} › ${scope} are suggested as you type.` : `No groups in ${schedule} › ${scope} yet.`}</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        )}
        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                {f.description.label} <span className="text-destructive">*</span>
              </FormLabel>
              <FormControl>
                <Textarea rows={3} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {textField('docNo', f.docNo)}
          {textField('drawingNo', f.drawingNo)}
          {dateField('plannedStartDate', f.plannedStartDate)}
          {dateField('plannedEndDate', f.plannedEndDate)}
        </div>
        {form.formState.errors.root?.message && (
          <p role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            {form.formState.errors.root.message}
          </p>
        )}
      </Form>
    </FormDialog>
  );
}
