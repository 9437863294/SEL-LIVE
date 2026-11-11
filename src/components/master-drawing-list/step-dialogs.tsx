'use client';

/**
 * The item page's next-step forms: record a submission (date, optional transmittal number), the
 * client's comments, or the approval. Each checks the date with `derive.ts`'s own rule as you type —
 * not in the future (India time), not earlier than the last recorded date — and the API checks it
 * again inside its transaction.
 */

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { FormDialog } from '@/components/shared/form-dialog';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { formatDate, isIsoDate } from '@/lib/master-drawing-list/derive';
import { lastEventDate, nextRevision, stepError, type MdlStep } from '@/lib/master-drawing-list/steps';
import type { MdlItem } from '@/lib/master-drawing-list/types';

import { mdlFetch } from './mdl-client';

const formSchema = z.object({
  date: z.string().refine(isIsoDate, 'Enter a valid date.'),
  transmittalNo: z.string().trim().max(120, 'Keep the transmittal number under 120 characters.'),
});
type StepForm = z.infer<typeof formSchema>;

function copy(step: MdlStep, item: MdlItem) {
  const last = item.revisions[item.revisions.length - 1];
  if (step === 'submission') {
    const rev = nextRevision(item);
    return {
      title: `Record submission — R${rev}`,
      description: rev === 0 ? 'The first submission of this drawing to the client.' : `A revised drawing after the client's comments on R${rev - 1}.`,
      dateLabel: 'Submitted on',
      submit: `Save R${rev} submission`,
    };
  }
  if (step === 'comments') {
    return {
      title: `Record comments on R${last?.rev ?? 0}`,
      description: `The date the client returned comments on R${last?.rev ?? 0}. The drawing then waits with SEL for a revision.`,
      dateLabel: 'Comments received on',
      submit: 'Save comments',
    };
  }
  return {
    title: 'Record approval',
    description: `The client's approval of ${last ? `R${last.rev}` : 'the drawing'}. This closes the item: no further submissions or comments can be recorded.`,
    dateLabel: 'Approved on',
    submit: 'Save approval',
  };
}

export function StepDialog({
  item,
  step,
  today,
  open,
  onOpenChange,
  onSaved,
}: {
  item: MdlItem;
  step: MdlStep;
  today: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (item: MdlItem) => void;
}) {
  const { toast } = useToast();
  const text = copy(step, item);
  const earliest = lastEventDate(item);
  const form = useForm<StepForm>({
    resolver: zodResolver(
      formSchema.superRefine((values, context) => {
        if (!isIsoDate(values.date)) return;
        const error = stepError(item, step, values.date, today);
        if (error) context.addIssue({ code: z.ZodIssueCode.custom, path: ['date'], message: error });
      }),
    ),
    defaultValues: { date: today, transmittalNo: '' },
  });

  // A fresh form each time it opens, dated today.
  useEffect(() => {
    if (open) form.reset({ date: today, transmittalNo: '' });
  }, [open, today, form]);

  const submit = form.handleSubmit(async (values) => {
    try {
      const body = step === 'submission' ? { date: values.date, transmittalNo: values.transmittalNo } : { date: values.date };
      const result = await mdlFetch<{ item: MdlItem }>(`items/${encodeURIComponent(item.id)}/${step}`, { method: 'POST', body });
      toast({ title: 'Saved', description: `${text.dateLabel} ${formatDate(values.date)}.` });
      onSaved(result.item);
      onOpenChange(false);
    } catch (error) {
      form.setError('root', { message: error instanceof Error ? error.message : 'Could not save.' });
    }
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={text.title}
      description={text.description}
      size="sm"
      onSubmit={submit}
      submitLabel={text.submit}
      submitting={form.formState.isSubmitting}
    >
      <Form {...form}>
        <FormField
          control={form.control}
          name="date"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{text.dateLabel}</FormLabel>
              <FormControl>
                <Input type="date" max={today} min={earliest ?? undefined} {...field} />
              </FormControl>
              <FormDescription>{earliest ? `Between ${formatDate(earliest)} (the last recorded date) and today.` : 'Today or earlier.'}</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        {step === 'submission' && (
          <FormField
            control={form.control}
            name="transmittalNo"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Transmittal no. (optional)</FormLabel>
                <FormControl>
                  <Input autoComplete="off" placeholder="Covering letter reference" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}
        {form.formState.errors.root?.message && (
          <p role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            {form.formState.errors.root.message}
          </p>
        )}
      </Form>
    </FormDialog>
  );
}
