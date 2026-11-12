'use client';

/**
 * Add Drawing Item — where Project Management's register adds BOQ items, this one adds its own:
 * schedule, scope, group (the project's existing groups are suggested), description, and the
 * optional Doc No., Drawing No. and planned window. The Sl. No. is not typed: the server gives the
 * next number in the project for that schedule and scope, and the form shows which one it will be.
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
import { SCHEDULES, SCOPES } from '@/lib/master-drawing-list/types';

import { mdlFetch, useMdlQuery } from './mdl-client';

const optionalDate = z.string().refine((value) => value === '' || isIsoDate(value), 'Enter a valid date.');

const formSchema = z
  .object({
    schedule: z.enum(SCHEDULES, { errorMap: () => ({ message: 'Choose a schedule.' }) }),
    scope: z.enum(SCOPES, { errorMap: () => ({ message: 'Choose a scope.' }) }),
    group: z.string().trim().max(200, 'Keep the group under 200 characters.'),
    description: z.string().trim().min(3, 'Enter a description.').max(2000, 'Keep the description under 2000 characters.'),
    docNo: z.string().trim().max(200),
    drawingNo: z.string().trim().max(200),
    plannedStartDate: optionalDate,
    plannedEndDate: optionalDate,
  })
  .refine((values) => !values.plannedStartDate || !values.plannedEndDate || values.plannedEndDate >= values.plannedStartDate, {
    path: ['plannedEndDate'],
    message: 'Planned end date cannot be before the planned start date.',
  });
type NewItemForm = z.input<typeof formSchema>;

const EMPTY: NewItemForm = { schedule: 'Supply', scope: 'Substation', group: '', description: '', docNo: '', drawingNo: '', plannedStartDate: '', plannedEndDate: '' };

interface GroupsData {
  groups: { schedule: string; scope: string; group: string }[];
  nextSlNo: Record<string, string>;
}

export function AddItemDialog({ projectCode, open, onOpenChange, onAdded }: { projectCode: string; open: boolean; onOpenChange: (open: boolean) => void; onAdded: (id: string) => void }) {
  const { toast } = useToast();
  const form = useForm<NewItemForm>({ resolver: zodResolver(formSchema), defaultValues: EMPTY });
  useEffect(() => {
    if (open) form.reset(EMPTY);
  }, [open, form]);

  const [schedule, scope] = useWatch({ control: form.control, name: ['schedule', 'scope'] });
  const groups = useMdlQuery<GroupsData>(open ? `groups?project=${encodeURIComponent(projectCode)}` : null);
  const suggestions = useMemo(
    () => (groups.data?.groups ?? []).filter((entry) => entry.schedule === schedule && entry.scope === scope).map((entry) => entry.group),
    [groups.data, schedule, scope],
  );
  const nextSlNo = groups.data?.nextSlNo[`${schedule}|${scope}`];

  const submit = form.handleSubmit(async (values) => {
    try {
      const result = await mdlFetch<{ id: string; slNo: string }>('items', { method: 'POST', body: { ...values, projectCode } });
      toast({ title: 'Drawing item added', description: `Sl. No. ${result.slNo} in ${values.schedule} › ${values.scope}.` });
      onAdded(result.id);
      onOpenChange(false);
    } catch (error) {
      form.setError('root', { message: error instanceof Error ? error.message : 'Could not add the item.' });
    }
  });

  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title="Add Drawing Item" description="A drawing or document for the client's approval. It joins the end of its schedule and scope." size="lg" onSubmit={submit} submitLabel="Add Item" submitting={form.formState.isSubmitting}>
      <Form {...form}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="schedule"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Schedule</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger className="text-left">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {SCHEDULES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="scope"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Scope</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger className="text-left">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {SCOPES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormDescription>{nextSlNo ? `This item will be Sl. No. ${nextSlNo}.` : groups.loading ? 'Working out the Sl. No.…' : ' '}</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <FormField
          control={form.control}
          name="group"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Group (optional)</FormLabel>
              <FormControl>
                <Input list="mdl-group-suggestions" autoComplete="off" placeholder="The heading the item sits under" {...field} />
              </FormControl>
              <datalist id="mdl-group-suggestions">
                {suggestions.map((group) => (
                  <option key={group} value={group} />
                ))}
              </datalist>
              <FormDescription>{suggestions.length ? `${suggestions.length} existing group${suggestions.length === 1 ? '' : 's'} in ${schedule} › ${scope} are suggested as you type.` : 'No groups in this schedule and scope yet.'}</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Item Description</FormLabel>
              <FormControl>
                <Textarea rows={3} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="docNo"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Doc No. (optional)</FormLabel>
                <FormControl>
                  <Input autoComplete="off" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="drawingNo"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Drawing No. (optional)</FormLabel>
                <FormControl>
                  <Input autoComplete="off" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="plannedStartDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Planned Start Date (optional)</FormLabel>
                <FormControl>
                  <Input type="date" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="plannedEndDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Planned End Date (optional)</FormLabel>
                <FormControl>
                  <Input type="date" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
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
