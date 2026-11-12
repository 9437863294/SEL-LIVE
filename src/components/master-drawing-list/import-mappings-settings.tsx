'use client';

/**
 * Settings › Saved Column Mappings: the column layouts the Excel Import remembered. When a workbook
 * is imported with "Remember these column mappings" on, each sheet's mapping is kept against its
 * heading row, and the next sheet with the same headings opens with that mapping instead of the
 * detected one (the one saved for the same drawing list first, else the newest). Removing one here
 * sends that layout back to detection.
 */

import { useState } from 'react';
import { BookmarkCheck, Loader2, Trash2 } from 'lucide-react';

import { DataList, type ListColumn } from '@/components/shared/data-list';
import { PageHeader } from '@/components/shared/page-header';
import { TableCard } from '@/components/shared/table-card';
import { SettingsNotice, SettingsPage } from '@/components/settings/settings-ui';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { ROLE_LABEL, type MappingTemplate } from '@/lib/master-drawing-list/workbook-import';

import { mdlFetch, useMdl, useMdlQuery } from './mdl-client';
import { MdlError, MdlLoading } from './mdl-ui';
import { MDL_BASE } from './module-layout-shell';

const colName = (index: number) => (index < 26 ? String.fromCharCode(65 + index) : `${String.fromCharCode(64 + Math.floor(index / 26))}${String.fromCharCode(65 + (index % 26))}`);
const savedOn = (iso: string) => (iso ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(iso)) : '—');

/** "A Sl. No. · B Description · D R0 submitted …" — the columns the mapping reads. */
export const mappedColumns = (template: MappingTemplate) =>
  template.columns
    .map((role, index) => (role === 'ignore' ? null : `${colName(index)} ${ROLE_LABEL(role)}`))
    .filter(Boolean)
    .join(' · ');

export default function ImportMappingsSettings() {
  const { lookups, can } = useMdl();
  const { toast } = useToast();
  const canView = can('Import', 'View');
  const canRemove = can('Import', 'Import') || can('Settings', 'Manage');
  const query = useMdlQuery<{ templates: MappingTemplate[] }>(canView ? 'import/mappings' : null);
  const [target, setTarget] = useState<MappingTemplate | null>(null);
  const [busy, setBusy] = useState(false);
  const shortOf = (code: string | null) => (code ? (lookups?.projects.find((project) => project.code === code)?.short ?? code) : 'Any list');

  const remove = async () => {
    if (!target) return;
    setBusy(true);
    try {
      await mdlFetch(`import/mappings/${encodeURIComponent(target.id)}`, { method: 'DELETE' });
      toast({ title: 'Saved mapping removed', description: `The next “${target.sheetName.trim()}” sheet with these headings will be detected afresh.` });
      setTarget(null);
      query.reload();
    } catch (error) {
      toast({ variant: 'destructive', title: 'Could not remove the mapping', description: error instanceof Error ? error.message : 'Try again.' });
    } finally {
      setBusy(false);
    }
  };

  const templates = query.data?.templates ?? [];
  const columns: ListColumn<MappingTemplate>[] = [
    { header: 'Drawing list', mobile: 'title', cell: (t) => shortOf(t.projectCode) },
    { header: 'Sheet', cell: (t) => <span title={t.fileName}>{t.sheetName.trim()}</span> },
    { header: 'Files into', cell: (t) => `${t.schedule} › ${t.scope}` },
    { header: 'Heading row', align: 'right', cell: (t) => <span className="tabular-nums">{t.headerRow}</span> },
    {
      header: 'Columns read',
      mobile: 'detail',
      className: 'max-w-[28rem]',
      cell: (t) => <span className="block whitespace-normal text-xs leading-relaxed text-muted-foreground">{mappedColumns(t)}</span>,
    },
    { header: 'Saved', mobile: 'aside', className: 'whitespace-nowrap', cell: (t) => <span title={t.fileName}>{savedOn(t.savedAt)} · {t.savedByName}</span> },
    {
      header: '',
      mobile: 'footer',
      cell: (t) =>
        canRemove ? (
          <Button variant="ghost" size="sm" className="text-rose-700 hover:bg-rose-50 hover:text-rose-800" onClick={() => setTarget(t)}>
            <Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Remove
          </Button>
        ) : null,
    },
  ];

  return (
    <SettingsPage>
      <PageHeader
        icon={BookmarkCheck}
        title="Saved Column Mappings"
        description="Column layouts the Excel Import remembered. A workbook sheet with the same headings opens with its saved mapping — the one saved for the drawing list being imported into first, else the newest."
        backHref={`${MDL_BASE}/settings`}
        backLabel="Back to Settings"
      />
      {!canView ? (
        <SettingsNotice tone="warning">View permission on Master Drawing List · Import is needed to see the saved mappings.</SettingsNotice>
      ) : query.error ? (
        <MdlError message={query.error} onRetry={query.reload} />
      ) : query.loading && !query.data ? (
        <MdlLoading />
      ) : (
        <TableCard title="Saved mappings" description="Newest first. One per drawing list and heading layout; a newer confirmation replaces the older one." icon={BookmarkCheck} count={templates.length} noun="mapping" scroll="natural">
          {templates.length ? (
            <DataList rows={templates} columns={columns} frameless dense />
          ) : (
            <p className="p-4 text-sm text-muted-foreground">No saved mappings yet. Import a project workbook with “Remember these column mappings” on, and its layout is kept here.</p>
          )}
        </TableCard>
      )}
      <AlertDialog open={Boolean(target)} onOpenChange={(open) => !open && !busy && setTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this saved mapping?</AlertDialogTitle>
            <AlertDialogDescription>
              {target ? `${shortOf(target.projectCode)} · “${target.sheetName.trim()}” of ${target.fileName}. ` : ''}The next workbook with these headings opens with the detected layout instead. Drawings already imported are not touched.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void remove();
              }}
              disabled={busy}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              Remove mapping
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsPage>
  );
}
