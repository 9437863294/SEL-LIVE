'use client';

import Link from 'next/link';
import { ExternalLink, Link2Off, PanelsTopLeft } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { isMirroredEApproval, type EApprovalSourceLink } from '@/lib/e-approval';

/**
 * The banner on a request that mirrors another module's workflow.
 *
 * An approver opening one of these needs two things said plainly before they act. First, that this
 * is not a note-sheet somebody typed — it is a live record elsewhere, and the link goes to it.
 * Second, whether the stage in front of them is theirs to decide here or theirs to complete on the
 * source module's own form. A 'Visibility' stage exists because completing it needs data this screen
 * has no field for — a bill number, a bank reference — and an approver who is not told that will sit
 * looking for an Approve button that is deliberately absent.
 */
export function EApprovalSourceCard({ source }: { source: EApprovalSourceLink | null | undefined }) {
  if (!source?.recordId) return null;
  const live = isMirroredEApproval(source);
  const visibilityOnly = live && source.mirrorMode === 'Visibility';

  return (
    <div
      className={`flex flex-wrap items-start gap-3 rounded-lg border px-3 py-2 ${
        live ? 'border-sky-200 bg-sky-50' : 'border-dashed bg-muted/40'
      }`}
    >
      <PanelsTopLeft className={`mt-0.5 h-4 w-4 shrink-0 ${live ? 'text-sky-600' : 'text-muted-foreground'}`} />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold">
          {live ? `Mirrored from ${source.module}` : `No longer linked to ${source.module}`}
          {source.recordLabel && <span className="font-normal text-muted-foreground"> · {source.recordLabel}</span>}
        </p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {!live
            ? source.detachedReason || 'The two records now run independently. This approval keeps its own record.'
            : visibilityOnly
              ? `“${source.stepName || 'This stage'}” is completed on the ${source.module} form — it needs details this screen does not collect. It is shown here so you can see and comment on it.`
              : 'Either side can act: a decision here moves the source record on, and a step completed there is recorded here.'}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {visibilityOnly && <Badge variant="outline" className="text-[10px]">Complete at source</Badge>}
        {!live && <Link2Off className="h-3.5 w-3.5 text-muted-foreground" />}
        {source.recordPath && (
          <Button asChild size="sm" variant="outline" className="h-7 gap-1.5 text-xs">
            <Link href={source.recordPath}>
              <ExternalLink className="h-3 w-3" /> Open in {source.module}
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
}
