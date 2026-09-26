'use client';

import { useState } from 'react';
import { History, Loader2, RotateCcw } from 'lucide-react';
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
import type { VersionSummary } from './use-appearance-admin';

const KIND_LABEL: Record<VersionSummary['kind'], string> = { publish: 'Theme published', branding: 'Branding saved', restore: 'Restored' };

function when(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * Published versions, newest first, each restorable. A restore publishes a new version, so the
 * list only ever grows and every restore can itself be undone. Every row is also in Audit Logs.
 */
export function VersionHistory({
  versions,
  currentVersion,
  scopes,
  onRestore,
  canRestore,
}: {
  versions: VersionSummary[];
  currentVersion: number;
  /** Which restore buttons to offer on this screen. */
  scopes: { scope: 'all' | 'theme' | 'branding'; label: string }[];
  onRestore: (version: number, scope: 'all' | 'theme' | 'branding') => Promise<unknown>;
  canRestore: (scope: 'all' | 'theme' | 'branding') => boolean;
}) {
  const [pending, setPending] = useState<{ version: number; scope: 'all' | 'theme' | 'branding'; label: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!versions.length) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <History className="h-4 w-4" aria-hidden="true" /> Nothing has been published yet — the built-in SEL Live appearance applies.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {error && (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      )}
      <ol className="divide-y rounded-xl border">
        {versions.map((v) => (
          <li key={v.version} className="flex flex-wrap items-start gap-3 p-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">
                Version {v.version} · {KIND_LABEL[v.kind]}
                {v.version === currentVersion && <span className="ml-2 rounded-full border px-1.5 py-0.5 text-[11px] font-medium">Live</span>}
              </p>
              <p className="text-xs text-muted-foreground">
                {when(v.publishedAt)} · {v.publishedBy ?? 'Unknown'}
                {v.note ? ` · “${v.note}”` : ''}
              </p>
              {v.changes.length > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Changed: {v.changes.slice(0, 6).join(', ')}
                  {v.changes.length > 6 ? ` and ${v.changes.length - 6} more` : ''}
                </p>
              )}
            </div>
            {v.version !== currentVersion && (
              <div className="flex flex-wrap gap-1.5">
                {scopes
                  .filter(({ scope }) => canRestore(scope))
                  .map(({ scope, label }) => (
                    <Button key={scope} type="button" size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setPending({ version: v.version, scope, label })}>
                      <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> {label}
                    </Button>
                  ))}
              </div>
            )}
          </li>
        ))}
      </ol>

      <AlertDialog open={pending !== null} onOpenChange={(open) => !open && !busy && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore version {pending?.version}?</AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.label} goes live for everyone as a new version. Nobody&apos;s personal preferences change, and you can restore the
              current version again afterwards.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={async (event) => {
                event.preventDefault();
                if (!pending) return;
                setBusy(true);
                setError(null);
                try {
                  await onRestore(pending.version, pending.scope);
                  setPending(null);
                } catch (e) {
                  setError(e instanceof Error ? e.message : 'The version could not be restored.');
                  setPending(null);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />}
              Restore
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
