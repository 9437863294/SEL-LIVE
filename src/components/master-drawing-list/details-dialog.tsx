'use client';

/**
 * The item's Edit form: drawing number, planned submission and target approval dates, remarks,
 * vendor finalised and on hold. Recorded submission, comment and approval dates are not edited here
 * (out of scope: correct an imported date in the workbook and import again).
 */

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { FormDialog } from '@/components/shared/form-dialog';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { isIsoDate } from '@/lib/master-drawing-list/derive';
import type { MdlItem } from '@/lib/master-drawing-list/types';

import { mdlFetch } from './mdl-client';

const optionalDate = z.string().refine((value) => value === '' || isIsoDate(value), 'Enter a valid date.');

const formSchema = z.object({
  drgNo: z.string().trim().max(200, 'Keep the drawing number under 200 characters.'),
  plannedSubmission: optionalDate,
  targetApproval: optionalDate,
  remarks: z.string().trim().max(2000, 'Keep the remarks under 2000 characters.'),
  vendorFinalised: z.boolean(),
  onHold: z.boolean(),
});
type DetailsForm = z.infer<typeof formSchema>;

const valuesOf = (item: MdlItem): DetailsForm => ({
  drgNo: item.drgNo ?? '',
  plannedSubmission: item.plannedSubmission ?? '',
  targetApproval: item.targetApproval ?? '',
  remarks: item.remarks ?? '',
  vendorFinalised: item.vendorFinalised,
  onHold: item.onHold,
});

export function DetailsDialog({ item, open, onOpenChange, onSaved }: { item: MdlItem; open: boolean; onOpenChange: (open: boolean) => void; onSaved: (item: MdlItem) => void }) {
  const { toast } = useToast();
  const form = useForm<DetailsForm>({ resolver: zodResolver(formSchema), defaultValues: valuesOf(item) });

  useEffect(() => {
    if (open) form.reset(valuesOf(item));
  }, [open, item, form]);

  const submit = form.handleSubmit(async (values) => {
    try {
      const result = await mdlFetch<{ item: MdlItem }>(`items/${encodeURIComponent(item.id)}`, { method: 'PATCH', body: values });
      toast({ title: 'Saved', description: 'The drawing item is updated.' });
      onSaved(result.item);
      onOpenChange(false);
    } catch (error) {
      form.setError('root', { message: error instanceof Error ? error.message : 'Could not save.' });
    }
  });

  const submitted = item.revisions.some((revision) => revision.submittedOn);

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Edit drawing item"
      description="Drawing number, planned dates, remarks and the item's flags."
      size="md"
      onSubmit={submit}
      submitting={form.formState.isSubmitting}
    >
      <Form {...form}>
        <FormField
          control={form.control}
          name="drgNo"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Drawing / document no.</FormLabel>
              <FormControl>
                <Input autoComplete="off" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="plannedSubmission"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Planned submission</FormLabel>
                <FormControl>
                  <Input type="date" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="targetApproval"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Target approval</FormLabel>
                <FormControl>
                  <Input type="date" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <FormField
          control={form.control}
          name="remarks"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Remarks</FormLabel>
              <FormControl>
                <Textarea rows={3} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="vendorFinalised"
          render={({ field }) => (
            <FormItem className="flex items-start justify-between gap-4 rounded-lg border p-3">
              <div className="space-y-0.5">
                <FormLabel>Vendor finalised</FormLabel>
                <FormDescription>{submitted ? 'Already submitted, so this no longer changes the status.' : 'Off: the item shows as "Vendor not finalised", with procurement.'}</FormDescription>
              </div>
              <FormControl>
                <Switch checked={field.value} onCheckedChange={field.onChange} />
              </FormControl>
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="onHold"
          render={({ field }) => (
            <FormItem className="flex items-start justify-between gap-4 rounded-lg border p-3">
              <div className="space-y-0.5">
                <FormLabel>On hold</FormLabel>
                <FormDescription>Parks the item: it leaves the pending lists until taken off hold.</FormDescription>
              </div>
              <FormControl>
                <Switch checked={field.value} onCheckedChange={field.onChange} />
              </FormControl>
            </FormItem>
          )}
        />
        {form.formState.errors.root?.message && (
          <p role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            {form.formState.errors.root.message}
          </p>
        )}
      </Form>
    </FormDialog>
  );
}
