'use client';

import { CalendarClock, FileText, Loader2, Undo2 } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { mailApi } from '@/lib/mail-hub/client';
import { formatAddress } from '@/lib/mail-hub/rules';
import { useLoader, useMailHub } from './hooks';
import { EmptyState, ErrorNotice, Spinner, formatLong } from './ui';

/** The caller's own drafts, failed sends or scheduled messages, from the ERP's outbound store. */
export function OutboundList({ statuses, emptyTitle, emptyBody }: { statuses: string; emptyTitle: string; emptyBody?: string }) {
  const { toast } = useToast();
  const { openComposer, version, bump } = useMailHub();
  const { value, loading, error, reload } = useLoader(() => mailApi.outbound(statuses), [statuses, version]);
  const [busy, setBusy] = useState<string | null>(null);

  if (error) return <ErrorNotice message={error} onRetry={reload} />;
  if (loading && !value) return <Spinner />;
  const rows = value?.outbound ?? [];
  if (!rows.length) return <EmptyState icon={statuses.includes('scheduled') ? <CalendarClock className="h-9 w-9" /> : <FileText className="h-9 w-9" />} title={emptyTitle} body={emptyBody} />;

  return (
    <ul className="divide-y overflow-hidden rounded-xl border bg-white">
      {rows.map((row) => (
        <li key={row.id} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center">
          <button type="button" className="min-w-0 flex-1 text-left" onClick={() => openComposer({ mode: row.mode, outboundId: row.id, accountId: row.sourceAccountId ?? row.accountId, sourceMessageId: row.sourceMessageId })}>
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-medium">{row.subject || '(no subject)'}</span>
              {row.status === 'failed' && <Badge variant="outline" className="border-rose-200 bg-rose-50 text-[10px] text-rose-700">Not sent</Badge>}
              {row.sharedMailboxId && <Badge variant="outline" className="text-[10px]">{row.fromAddress}</Badge>}
            </div>
            <p className="truncate text-xs text-muted-foreground">
              To {row.to.map(formatAddress).join(', ') || '—'}
              {row.status === 'scheduled' && row.scheduledAt ? ` · sends ${formatLong(row.scheduledAt)}` : ` · edited ${formatLong(row.updatedAt)}`}
            </p>
            {row.status === 'failed' && row.lastError && <p className="text-xs text-rose-700">{row.lastError}</p>}
          </button>
          {row.status === 'scheduled' && (
            <Button
              size="sm"
              variant="outline"
              className="shrink-0 gap-1.5"
              disabled={busy === row.id}
              onClick={async () => {
                setBusy(row.id);
                try {
                  const result = await mailApi.cancelScheduled(row.id);
                  toast({ title: result.message });
                  bump();
                } catch (caught) {
                  toast({ variant: 'destructive', title: 'Could not unschedule', description: caught instanceof Error ? caught.message : undefined });
                } finally {
                  setBusy(null);
                }
              }}
            >
              {busy === row.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />} Unschedule
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
