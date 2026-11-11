'use client';

/**
 * Settings › Projects › New drawing list: starts a drawing list for an ERP project so items can be
 * added by hand, without an Excel import. Choosing the ERP project fills in the name, client and a
 * code from its site code; each can be changed before saving.
 */

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { FormDialog } from '@/components/shared/form-dialog';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';

import { mdlFetch } from './mdl-client';

export interface ErpProjectOption {
  id: string;
  name: string;
  siteCode: string | null;
  clientName: string | null;
  status: string | null;
}

const formSchema = z.object({
  projectId: z.string().min(1, 'Choose the ERP project.'),
  code: z
    .string()
    .trim()
    .min(1, 'Enter a code.')
    .max(40, 'Keep the code under 40 characters.')
    .regex(/^[A-Za-z0-9_-]+$/, 'Use letters, digits, - and _ only in the code.'),
  short: z.string().trim().min(1, 'Enter a short name.').max(60, 'Keep the short name under 60 characters.'),
  name: z.string().trim().min(1, 'Enter the full name.').max(300),
  client: z.string().trim().max(200),
  drgPrefix: z.string().trim().max(60),
});
type NewProjectForm = z.infer<typeof formSchema>;

const EMPTY: NewProjectForm = { projectId: '', code: '', short: '', name: '', client: '', drgPrefix: '' };

/** A code from the site code or name: letters and digits, words joined by "-". */
const codeFrom = (text: string) =>
  text
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

export function NewProjectDialog({
  open,
  onOpenChange,
  erpProjects,
  takenCodes,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  erpProjects: ErpProjectOption[];
  takenCodes: string[];
  onCreated: (code: string) => void;
}) {
  const { toast } = useToast();
  const form = useForm<NewProjectForm>({
    resolver: zodResolver(
      formSchema.refine((values) => !takenCodes.includes(values.code.trim()), { path: ['code'], message: 'A drawing list already uses this code.' }),
    ),
    defaultValues: EMPTY,
  });

  useEffect(() => {
    if (open) form.reset(EMPTY);
  }, [open, form]);

  const pick = (projectId: string) => {
    const erp = erpProjects.find((project) => project.id === projectId);
    form.setValue('projectId', projectId, { shouldValidate: true });
    if (!erp) return;
    form.setValue('code', codeFrom(erp.siteCode ?? erp.name));
    form.setValue('short', (erp.siteCode ?? erp.name).slice(0, 60));
    form.setValue('name', erp.name);
    form.setValue('client', erp.clientName ?? '');
  };

  const submit = form.handleSubmit(async (values) => {
    try {
      const result = await mdlFetch<{ code: string }>('projects', { method: 'POST', body: values });
      toast({ title: 'Drawing list created', description: `${values.short} is ready for drawing items.` });
      onCreated(result.code);
      onOpenChange(false);
    } catch (error) {
      form.setError('root', { message: error instanceof Error ? error.message : 'Could not create the drawing list.' });
    }
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="New drawing list"
      description="A drawing list for one ERP project. Its items can then be added one by one, or loaded from the Excel import."
      size="md"
      onSubmit={submit}
      submitLabel="Create drawing list"
      submitting={form.formState.isSubmitting}
    >
      <Form {...form}>
        <FormField
          control={form.control}
          name="projectId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>ERP project</FormLabel>
              <Select value={field.value} onValueChange={pick}>
                <FormControl>
                  <SelectTrigger className="text-left">
                    <SelectValue placeholder="Choose a project" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent className="max-h-72">
                  {erpProjects.map((erp) => (
                    <SelectItem key={erp.id} value={erp.id}>
                      <span className="truncate">
                        {erp.name}
                        {erp.siteCode ? ` · ${erp.siteCode}` : ''}
                        {erp.status === 'Inactive' ? ' (inactive)' : ''}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormDescription>Who sees the list follows this project&apos;s access in Access Management.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="short"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Short name</FormLabel>
                <FormControl>
                  <Input autoComplete="off" {...field} />
                </FormControl>
                <FormDescription>Shown in the project switcher.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="code"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Code</FormLabel>
                <FormControl>
                  <Input autoComplete="off" {...field} />
                </FormControl>
                <FormDescription>Fixed once saved. Use the workbook&apos;s code if it will be imported later.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Full name</FormLabel>
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
            name="client"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Client (optional)</FormLabel>
                <FormControl>
                  <Input autoComplete="off" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="drgPrefix"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Drawing no. prefix (optional)</FormLabel>
                <FormControl>
                  <Input autoComplete="off" {...field} />
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
