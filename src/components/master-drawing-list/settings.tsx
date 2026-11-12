'use client';

/**
 * Master Drawing List › Settings: which ERP project each drawing list belongs to. The link decides
 * access — a user sees a drawing list when its ERP project is granted to them in Access Management,
 * or when they hold All Projects — and the screens show the ERP project's name and client.
 */

import { useState } from 'react';
import { Link2, Loader2, Plus, Settings2 } from 'lucide-react';

import { DataList, type ListColumn } from '@/components/shared/data-list';
import { PageHeader } from '@/components/shared/page-header';
import { SettingsNotice, SettingsPage, SettingsSection } from '@/components/settings/settings-ui';
import { StatusBadge } from '@/components/shared/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';

import { mdlFetch, useMdl, useMdlQuery, type MdlProjectView } from './mdl-client';
import { MdlError, MdlLoading } from './mdl-ui';
import { NewProjectDialog, type ErpProjectOption } from './new-project-dialog';

interface SettingsData {
  projects: MdlProjectView[];
  erpProjects: ErpProjectOption[];
  canManage: boolean;
}

const NONE = 'none';

export default function Settings() {
  const { reload: reloadLookups } = useMdl();
  const { toast } = useToast();
  const query = useMdlQuery<SettingsData>('projects');
  const [saving, setSaving] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const data = query.data;

  /** Saves a review period when the field is left, if it changed: whole days 1–365, blank for none. */
  const savePeriod = async (project: MdlProjectView, field: 'reviewDays' | 'resubmitDays', raw: string) => {
    const value = raw.trim() === '' ? null : Math.round(Number(raw));
    if (value === (project[field] ?? null)) return;
    if (value !== null && (!Number.isFinite(value) || value < 1 || value > 365)) {
      toast({ variant: 'destructive', title: 'Enter whole days from 1 to 365', description: 'Or leave it blank for none.' });
      return;
    }
    setSaving(project.code);
    try {
      await mdlFetch('projects/' + encodeURIComponent(project.code), { method: 'PATCH', body: { [field]: value } });
      toast({ title: 'Saved', description: project.short + ': ' + (field === 'reviewDays' ? 'client review period' : 'resubmission period') + (value ? ' ' + value + ' days.' : ' cleared.') });
      query.reload();
      void reloadLookups();
    } catch (error) {
      toast({ variant: 'destructive', title: 'Could not save', description: error instanceof Error ? error.message : 'Try again.' });
    } finally {
      setSaving(null);
    }
  };

  const link = async (project: MdlProjectView, value: string) => {
    const projectId = value === NONE ? null : value;
    if (projectId === project.projectId) return;
    setSaving(project.code);
    try {
      await mdlFetch(`projects/${encodeURIComponent(project.code)}`, { method: 'PATCH', body: { projectId } });
      toast({ title: projectId ? 'Linked' : 'Unlinked', description: `${project.short} ${projectId ? 'now follows that ERP project’s access.' : 'is visible to All Projects holders only.'}` });
      query.reload();
      void reloadLookups();
    } catch (error) {
      toast({ variant: 'destructive', title: 'Could not save', description: error instanceof Error ? error.message : 'Try again.' });
    } finally {
      setSaving(null);
    }
  };

  if (query.loading && !data) return <MdlLoading />;

  const erpName = new Map((data?.erpProjects ?? []).map((project) => [project.id, project.name]));
  const columns: ListColumn<MdlProjectView & { id: string }>[] = [
    { header: 'Drawing list', mobile: 'title', cell: (project) => <span className="font-medium">{project.short}</span> },
    {
      header: 'Link',
      mobile: 'aside',
      cell: (project) =>
        project.linkMissing ? (
          <StatusBadge tone="danger">ERP project missing</StatusBadge>
        ) : project.projectId ? (
          <StatusBadge tone="success">Linked</StatusBadge>
        ) : (
          <StatusBadge tone="warning">Not linked</StatusBadge>
        ),
    },
    { header: 'Name in the workbook', cell: (project) => <span className="break-words">{project.name}</span> },
    { header: 'Client', cell: (project) => project.client ?? '—' },
    { header: 'Drg. prefix', cell: (project) => project.drgPrefix ?? '—' },
    {
      header: 'Client review (days)',
      cell: (project) =>
        data?.canManage ? (
          <Input key={'r-' + project.code + '-' + (project.reviewDays ?? '')} type="number" min={1} max={365} inputMode="numeric" className="h-8 w-24" defaultValue={project.reviewDays ?? ''} placeholder="Days" aria-label={'Client review period for ' + project.short} onBlur={(event) => void savePeriod(project, 'reviewDays', event.target.value)} disabled={saving !== null} />
        ) : (
          (project.reviewDays ?? '—')
        ),
    },
    {
      header: 'Resubmission (days)',
      cell: (project) =>
        data?.canManage ? (
          <Input key={'s-' + project.code + '-' + (project.resubmitDays ?? '')} type="number" min={1} max={365} inputMode="numeric" className="h-8 w-24" defaultValue={project.resubmitDays ?? ''} placeholder="Days" aria-label={'Resubmission period for ' + project.short} onBlur={(event) => void savePeriod(project, 'resubmitDays', event.target.value)} disabled={saving !== null} />
        ) : (
          (project.resubmitDays ?? '—')
        ),
    },
    {
      header: 'ERP project',
      mobile: 'footer',
      className: 'min-w-[16rem]',
      cell: (project) =>
        data?.canManage ? (
          <span className="flex w-full items-center gap-2">
            <Select value={project.projectId ?? NONE} onValueChange={(value) => void link(project, value)} disabled={saving !== null}>
              <SelectTrigger className="min-w-0 flex-1 text-left" aria-label={`ERP project for ${project.short}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value={NONE}>Not linked</SelectItem>
                {data.erpProjects.map((erp) => (
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
            {saving === project.code && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-label="Saving" />}
          </span>
        ) : project.projectId ? (
          (erpName.get(project.projectId) ?? project.projectId)
        ) : (
          '—'
        ),
    },
  ];

  return (
    <SettingsPage>
      <PageHeader icon={Settings2} title="Drawing Lists" description="Create drawing lists, link each to its ERP project, and set the client review and resubmission periods." backHref="/master-drawing-list/settings" backLabel="Back to Settings" />
      <MdlError message={query.error} onRetry={query.reload} />
      {data && (
        <SettingsSection
          title="Projects"
          icon={Link2}
          description="Link each drawing list to its ERP project: engineers see the lists of the projects granted to them in Access Management, and holders of All Projects see every list. Set the contract's client review period and SEL's resubmission period in days to flag drawings overdue at the client or with SEL."
          action={
            data.canManage ? (
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
                New drawing list
              </Button>
            ) : undefined
          }
          flush
        >
          {!data.projects.length ? (
            <div className="p-4">
              <SettingsNotice tone="info" title="No drawing list yet">
                Create one with New drawing list (then add its items one by one), or load the consolidated workbook on the Excel Import page.
              </SettingsNotice>
            </div>
          ) : (
            <DataList rows={data.projects.map((project) => ({ ...project, id: project.code }))} columns={columns} frameless dense />
          )}
        </SettingsSection>
      )}
      {data?.canManage && (
        <NewProjectDialog
          open={creating}
          onOpenChange={setCreating}
          erpProjects={data.erpProjects}
          takenCodes={data.projects.map((project) => project.code)}
          onCreated={() => {
            query.reload();
            void reloadLookups();
          }}
        />
      )}
    </SettingsPage>
  );
}
