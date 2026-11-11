'use client';

/**
 * Add Drawing Item (`/master-drawing-list/new`): project, schedule, scope, group (the project's
 * existing groups are suggested), description, and the optional drawing number and planned dates.
 * The Sl. No. is not typed: the server gives the next number in that project for the schedule and
 * scope, and the form shows which number that will be.
 */

import { useEffect, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { FilePlus2, Loader2 } from 'lucide-react';
import { z } from 'zod';

import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useBackNavigation } from '@/hooks/use-back-navigation';
import { useToast } from '@/hooks/use-toast';
import { isIsoDate } from '@/lib/master-drawing-list/derive';
import { SCHEDULES, SCOPES } from '@/lib/master-drawing-list/types';

import { mdlFetch, useMdl, useMdlQuery } from './mdl-client';
import { MdlLoading, NoDrawingList } from './mdl-ui';
import { MDL_BASE } from './module-layout-shell';
import { itemHref } from './register';

const optionalDate = z.string().refine((value) => value === '' || isIsoDate(value), 'Enter a valid date.');

const formSchema = z.object({
  projectCode: z.string().min(1, 'Choose a project.'),
  schedule: z.enum(SCHEDULES, { errorMap: () => ({ message: 'Choose a schedule.' }) }),
  scope: z.enum(SCOPES, { errorMap: () => ({ message: 'Choose a scope.' }) }),
  group: z.string().trim().max(200, 'Keep the group under 200 characters.'),
  description: z.string().trim().min(3, 'Enter a description.').max(2000, 'Keep the description under 2000 characters.'),
  drgNo: z.string().trim().max(200, 'Keep the drawing number under 200 characters.'),
  plannedSubmission: optionalDate,
  targetApproval: optionalDate,
  vendorFinalised: z.boolean(),
});
type NewItemForm = z.input<typeof formSchema>;

interface GroupsData {
  groups: { schedule: string; scope: string; group: string }[];
  nextSlNo: Record<string, string>;
}

export default function NewItem() {
  const { lookups } = useMdl();
  const router = useRouter();
  const params = useSearchParams();
  const { toast } = useToast();
  const back = useBackNavigation(`${MDL_BASE}/register`);

  // The project the user may add to: the one asked for, else the first.
  const projects = lookups?.projects ?? [];
  const wanted = params.get('project');
  const initialProject = projects.find((project) => project.code === wanted)?.code ?? projects[0]?.code ?? '';

  const form = useForm<NewItemForm>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      projectCode: initialProject,
      schedule: 'Supply',
      scope: 'Substation',
      group: '',
      description: '',
      drgNo: '',
      plannedSubmission: '',
      targetApproval: '',
      vendorFinalised: false,
    },
  });
  // Lookups arrive after the first render; fill the project in once they do.
  useEffect(() => {
    if (initialProject && !form.getValues('projectCode')) form.setValue('projectCode', initialProject);
  }, [initialProject, form]);

  const [projectCode, schedule, scope] = useWatch({ control: form.control, name: ['projectCode', 'schedule', 'scope'] });
  const groups = useMdlQuery<GroupsData>(projectCode ? `groups?project=${encodeURIComponent(projectCode)}` : null);
  const suggestions = useMemo(
    () => (groups.data?.groups ?? []).filter((entry) => entry.schedule === schedule && entry.scope === scope).map((entry) => entry.group),
    [groups.data, schedule, scope],
  );
  const nextSlNo = groups.data?.nextSlNo[`${schedule}|${scope}`];

  const submit = form.handleSubmit(async (values) => {
    try {
      const result = await mdlFetch<{ id: string; slNo: string }>('items', { method: 'POST', body: values });
      toast({ title: 'Drawing item added', description: `Sl. No. ${result.slNo} in ${values.schedule} › ${values.scope}.` });
      router.push(itemHref(result.id));
    } catch (error) {
      form.setError('root', { message: error instanceof Error ? error.message : 'Could not add the item.' });
    }
  });

  if (!lookups) return <MdlLoading />;

  return (
    <>
      <PageHeader
        icon={FilePlus2}
        title="Add Drawing Item"
        description="A new drawing or document for the client's approval. It joins the end of its schedule and scope with the next Sl. No."
        backHref={back.href}
        backLabel={back.label}
        onBackClick={back.onClick}
      />
      {!projects.length ? (
        <NoDrawingList />
      ) : (
        <Card className="min-w-0">
          <CardContent className="p-4 sm:p-6">
            <Form {...form}>
              <form onSubmit={submit} className="space-y-5">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <FormField
                    control={form.control}
                    name="projectCode"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Project</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl>
                            <SelectTrigger className="text-left">
                              <SelectValue placeholder="Choose a project" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent className="max-h-72">
                            {projects.map((project) => (
                              <SelectItem key={project.code} value={project.code}>
                                {project.short}
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
                      <FormDescription>
                        {suggestions.length ? `${suggestions.length} existing group${suggestions.length === 1 ? '' : 's'} in ${schedule} › ${scope} are suggested as you type.` : 'No groups in this schedule and scope yet.'}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Description</FormLabel>
                      <FormControl>
                        <Textarea rows={3} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <FormField
                    control={form.control}
                    name="drgNo"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Drawing / document no. (optional)</FormLabel>
                        <FormControl>
                          <Input autoComplete="off" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="plannedSubmission"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Planned submission (optional)</FormLabel>
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
                        <FormLabel>Target approval (optional)</FormLabel>
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
                  name="vendorFinalised"
                  render={({ field }) => (
                    <FormItem className="flex items-start justify-between gap-4 rounded-lg border p-3">
                      <div className="space-y-0.5">
                        <FormLabel>Vendor finalised</FormLabel>
                        <FormDescription>Off: the item starts as “Vendor not finalised”, with procurement. On: “Not submitted”, with SEL.</FormDescription>
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

                <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
                  <Button type="button" variant="outline" onClick={() => back.go()} disabled={form.formState.isSubmitting}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={form.formState.isSubmitting}>
                    {form.formState.isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                    Add item
                  </Button>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>
      )}
    </>
  );
}
