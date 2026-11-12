'use client';

/**
 * The Excel Import's history: the last 30 imports — who, when, which file, into which drawing list,
 * and what each wrote — with Undo, which removes the items an import created as long as nobody has
 * edited them since (edited ones are kept and counted).
 */

import { useState } from 'react';
import { History, Loader2, Undo2 } from 'lucide-react';

import { DataList, type ListColumn } from '@/components/shared/data-list';
import { TableCard } from '@/components/shared/table-card';
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
import type { ImportRecord } from '@/lib/master-drawing-list/server/import';

import { mdlFetch, useMdl } from './mdl-client';
import { MdlStatus } from './mdl-ui';

const when = (iso: string) => (iso ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(iso)) : '—');

export function ImportHistory({ records, loading, onChanged }: { records: ImportRecord[]; loading: boolean; onChanged: () => void }) {
  const { lookups, can, reload } = useMdl();
  const { toast } = useToast();
  const [target, setTarget] = useState<ImportRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const shortOf = (code: string) => lookups?.projects.find((project) => project.code === code)?.short ?? code;
  const canUndo = can('Import', 'Import');

  const undo = async () => {
    if (!target) return;
    setBusy(true);
    try {
      const { import: done } = await mdlFetch<{ import: ImportRecord }>(`import/history/${encodeURIComponent(target.id)}`, { method: 'DELETE' });
      toast({ title: 'Import undone', description: `${done.removed ?? 0} items removed${done.kept ? `; ${done.kept} kept because they were edited since` : ''}.` });
      setTarget(null);
      onChanged();
      void reload();
    } catch (error) {
      toast({ variant: 'destructive', title: 'Could not undo the import', description: error instanceof Error ? error.message : 'Try again.' });
    } finally {
      setBusy(false);
    }
  };

  const columns: ListColumn<ImportRecord>[] = [
    { header: 'When', mobile: 'title', className: 'whitespace-nowrap', cell: (record) => when(record.at) },
    { header: 'File', className: 'max-w-[16rem] truncate', cell: (record) => <span title={record.fileName}>{record.fileName}</span> },
    { header: 'Drawing list', cell: (record) => record.projectCodes.map(shortOf).join(', ') || '—' },
    { header: 'By', cell: (record) => record.byName },
    { header: 'Written', align: 'right', cell: (record) => <span className="tabular-nums">{record.written}</span> },
    { header: 'New / replaced', align: 'right', cell: (record) => <span className="tabular-nums">{record.created} / {record.replaced}</span> },
    {
      header: 'Status',
      mobile: 'aside',
      cell: (record) =>
        record.undoneAt ? (
          <MdlStatus status="Cancelled" title={`Undone ${when(record.undoneAt)} by ${record.undoneByName ?? ''}`}>
            Undone · {record.removed ?? 0} removed
          </MdlStatus>
        ) : (
          <MdlStatus status="Completed">Imported</MdlStatus>
        ),
    },
    {
      header: '',
      mobile: 'footer',
      cell: (record) =>
        canUndo && !record.undoneAt && record.created > 0 ? (
          <Button variant="outline" size="sm" onClick={() => setTarget(record)}>
            <Undo2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Undo
          </Button>
        ) : null,
    },
  ];

  return (
    <>
      <TableCard title="Import history" description="Every import, newest first. Undo removes the items an import added, if nobody has edited them since." icon={History} count={records.length} noun="import" scroll="natural">
        {loading && !records.length ? (
          <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading…
          </p>
        ) : records.length ? (
          <DataList rows={records} columns={columns} frameless dense />
        ) : (
          <p className="p-4 text-sm text-muted-foreground">No imports yet.</p>
        )}
      </TableCard>
      <AlertDialog open={Boolean(target)} onOpenChange={(open) => !open && !busy && setTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Undo this import?</AlertDialogTitle>
            <AlertDialogDescription>
              {target ? `${target.fileName} · ${when(target.at)}. ` : ''}The {target?.created ?? 0} items it added are removed, unless someone has edited them since. Items it replaced keep their imported version.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void undo();
              }}
              disabled={busy}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              Undo import
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
