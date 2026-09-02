'use client';

import { useMemo, useState } from 'react';
import { Download, FileSignature, FileText, Loader2, Paperclip, Upload } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import type { EApprovalAttachment } from '@/lib/e-approval';
import { uploadEApprovalAttachment, type EApprovalServiceActor } from '@/lib/e-approval-service';
import { EApprovalEmptyState } from './shared';
import { formatEApprovalDateTime } from './hooks';
import { EApprovalSignAttachmentDialog } from './sign-attachment-dialog';

/** Content-type sniffing is unreliable for older uploads; the extension is the honest fallback. */
const isPdf = (attachment: EApprovalAttachment): boolean =>
  attachment.contentType === 'application/pdf' || /\.pdf$/i.test(attachment.name);

const prettySize = (size: number | undefined) => {
  if (!size) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

/**
 * The attachment list of spec section 8, grouped by request version.
 *
 * Grouping by version is the point: a revised quotation is a new file beside the original, tied to
 * the figure it priced, so an auditor reading version 1's approvals sees the document those
 * approvals were given against — not the one that replaced it afterwards.
 */
export function AttachmentList({
  approvalId,
  attachments,
  serviceActor,
  canUpload,
  onChanged,
}: {
  approvalId: string;
  attachments: EApprovalAttachment[];
  serviceActor: EApprovalServiceActor | null;
  canUpload: boolean;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [signing, setSigning] = useState<EApprovalAttachment | null>(null);

  const byVersion = useMemo(() => {
    const groups = new Map<number, EApprovalAttachment[]>();
    attachments.forEach((attachment) => {
      const version = attachment.version ?? 1;
      groups.set(version, [...(groups.get(version) ?? []), attachment]);
    });
    return Array.from(groups.entries()).sort((a, b) => b[0] - a[0]);
  }, [attachments]);

  const upload = async (files: FileList | null) => {
    if (!serviceActor || !files?.length) return;
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        await uploadEApprovalAttachment(approvalId, file, serviceActor);
      }
      onChanged();
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Upload failed',
        description: error instanceof Error ? error.message : 'Something went wrong.',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      {canUpload && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/20 p-2.5">
          <Upload className="h-4 w-4 shrink-0 text-muted-foreground" />
          <Input
            type="file"
            multiple
            disabled={busy}
            className="h-9 max-w-sm cursor-pointer text-xs"
            onChange={(event) => void upload(event.target.files)}
          />
          {busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          <p className="text-[11px] text-muted-foreground">
            Uploads are added, never replaced — the original file always stays on the record.
          </p>
        </div>
      )}

      {byVersion.length === 0 ? (
        <EApprovalEmptyState icon={Paperclip} title="No attachments" description="Supporting documents appear here." />
      ) : (
        byVersion.map(([version, rows]) => (
          <div key={version}>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Version {version}
            </p>
            <div className="divide-y rounded-lg border">
              {rows.map((attachment) => (
                <div key={attachment.id} className="flex items-center gap-2.5 px-2.5 py-2">
                  <FileText className="h-4 w-4 shrink-0 text-sky-600" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{attachment.name}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {attachment.uploadedByName || 'Uploaded'} · {formatEApprovalDateTime(attachment.uploadedAt)}
                      {attachment.size ? ` · ${prettySize(attachment.size)}` : ''}
                      {attachment.stepName ? ` · at ${attachment.stepName}` : ''}
                    </p>
                    {attachment.signedByName && (
                      <p className="truncate text-[11px] text-emerald-700">
                        Signed by {attachment.signedByName} · {formatEApprovalDateTime(attachment.signedAt)}
                        {attachment.signedPage ? ` · page ${attachment.signedPage}` : ''}
                      </p>
                    )}
                    {attachment.description && (
                      <p className="truncate text-[11px] italic text-muted-foreground">{attachment.description}</p>
                    )}
                  </div>
                  {attachment.supersedesAttachmentId && (
                    <Badge variant="outline" className="shrink-0 text-[10px]">
                      Revision
                    </Badge>
                  )}
                  {attachment.signedByName && (
                    <Badge variant="outline" className="shrink-0 gap-1 border-emerald-200 bg-emerald-50 text-[10px] text-emerald-800">
                      <FileSignature className="h-3 w-3" /> Signed
                    </Badge>
                  )}
                  {canUpload && isPdf(attachment) && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-8 shrink-0 gap-1 px-2 text-xs"
                      onClick={() => setSigning(attachment)}
                    >
                      <FileSignature className="h-3.5 w-3.5" /> Sign
                    </Button>
                  )}
                  <Button asChild size="sm" variant="ghost" className="h-8 shrink-0 gap-1 px-2 text-xs">
                    <a href={attachment.url} target="_blank" rel="noopener noreferrer">
                      <Download className="h-3.5 w-3.5" /> Open
                    </a>
                  </Button>
                </div>
              ))}
            </div>
          </div>
        ))
      )}

      <EApprovalSignAttachmentDialog
        open={signing !== null}
        onOpenChange={(next) => !next && setSigning(null)}
        approvalId={approvalId}
        attachment={signing}
        serviceActor={serviceActor}
        onSigned={onChanged}
      />
    </div>
  );
}
