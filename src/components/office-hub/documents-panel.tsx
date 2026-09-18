'use client';

/**
 * Attachments (§36).
 *
 * ── Why a download URL is never stored ──────────────────────────────────────────────────────────
 *
 * A Firebase Storage download URL is a bearer token with no expiry: anybody holding the string can
 * fetch the file, signed in or not, forever. §36 says files must not be exposed publicly, so the
 * service stores only the object *path* and this component mints a fresh URL per click against the
 * viewer's own credentials. That costs one extra round trip on download and means a link copied out
 * of the DOM stops working when the user's session does.
 *
 * Validation runs here for the message and in the Storage rules for the enforcement — §49's point
 * that a front-end check is a courtesy, not a control.
 */

import { useRef, useState } from 'react';
import {
  Download,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Loader2,
  Paperclip,
  Presentation,
  Trash2,
  Upload,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import {
  fileExtension,
  formatFileSize,
  validateOfficeHubUpload,
  type OfficeHubDocument,
  type OfficeHubEntityType,
} from '@/lib/office-hub';
import {
  getOfficeHubDocumentUrl,
  removeOfficeHubDocument,
  uploadOfficeHubDocument,
} from '@/lib/office-hub-service';
import { useOfficeHub, useOfficeHubAction } from './hooks';
import { OfficeHubEmptyState } from './ui';

function iconFor(fileName: string): React.ElementType {
  const extension = fileExtension(fileName);
  if (['xls', 'xlsx', 'csv'].includes(extension)) return FileSpreadsheet;
  if (['ppt', 'pptx'].includes(extension)) return Presentation;
  if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(extension)) return ImageIcon;
  return FileText;
}

export function DocumentsPanel({
  entityType,
  entityId,
  meetingId,
  documents,
  canUpload,
  canRemove,
  onChanged,
  emptyDescription,
}: {
  entityType: OfficeHubEntityType;
  entityId: string;
  meetingId?: string | null;
  documents: OfficeHubDocument[];
  canUpload: boolean;
  canRemove: boolean;
  onChanged: () => void;
  emptyDescription?: string;
}) {
  const { actor, settings } = useOfficeHub();
  const { isBusy, run } = useOfficeHubAction();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [note, setNote] = useState('');
  const [rejected, setRejected] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  const upload = async (files: FileList | null) => {
    if (!files?.length || !actor) return;
    setRejected(null);

    // Validated before anything is sent: a 40 MB file that the rules will reject should not be
    // uploaded first and refused afterwards.
    const rejections: string[] = [];
    const accepted: File[] = [];
    for (const file of Array.from(files)) {
      const verdict = validateOfficeHubUpload({ name: file.name, size: file.size }, settings);
      if (verdict.ok) accepted.push(file);
      else rejections.push(`${file.name}: ${verdict.reason}`);
    }
    if (rejections.length) setRejected(rejections.join(' · '));
    if (!accepted.length) return;

    await run(
      async () => {
        for (const file of accepted) {
          await uploadOfficeHubDocument(
            actor,
            { file, entityType, entityId, meetingId: meetingId ?? null, note: note.trim() || null },
            { settings },
          );
        }
      },
      {
        success: accepted.length === 1 ? 'File attached' : `${accepted.length} files attached`,
        failure: 'Could not attach the file',
      },
    );

    setNote('');
    if (inputRef.current) inputRef.current.value = '';
    onChanged();
  };

  const download = async (document: OfficeHubDocument) => {
    setDownloading(document.id);
    try {
      const url = await getOfficeHubDocumentUrl(document.storagePath);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (error) {
      console.error('[office-hub] Download failed', error);
      setRejected('That file could not be opened. It may have been removed from storage.');
    } finally {
      setDownloading(null);
    }
  };

  const remove = async (document: OfficeHubDocument) => {
    if (!actor) return;
    await run(() => removeOfficeHubDocument(actor, document.id), {
      success: 'Attachment removed',
      failure: 'Could not remove the attachment',
    });
    onChanged();
  };

  return (
    <div className="space-y-3">
      {documents.length === 0 ? (
        <OfficeHubEmptyState
          icon={Paperclip}
          title="No documents attached."
          description={emptyDescription ?? (canUpload ? 'Attach anything participants should read.' : undefined)}
        />
      ) : (
        <ul className="divide-y rounded-lg border bg-white">
          {documents.map((document) => {
            const Icon = iconFor(document.fileName);
            return (
              <li key={document.id} className="flex items-center gap-3 px-3 py-2">
                <Icon className="h-4 w-4 shrink-0 text-slate-400" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-800">{document.fileName}</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {formatFileSize(document.fileSize)} · {document.uploadedByName}
                    {document.note ? ` · ${document.note}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    disabled={downloading === document.id}
                    onClick={() => void download(document)}
                    aria-label={`Download ${document.fileName}`}
                  >
                    {downloading === document.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Download className="h-3.5 w-3.5" />
                    )}
                  </Button>
                  {canRemove && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-destructive"
                      disabled={isBusy}
                      onClick={() => void remove(document)}
                      aria-label={`Remove ${document.fileName}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {canUpload && (
        <div className="space-y-2 rounded-lg border border-dashed bg-white/60 p-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <div>
              <Label className="mb-1 block text-xs">Note (optional)</Label>
              <Input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="e.g. Signed copy"
                className="bg-white"
              />
            </div>
            <div className="flex items-end">
              <Button
                type="button"
                variant="outline"
                disabled={isBusy}
                onClick={() => inputRef.current?.click()}
                className="w-full gap-2 sm:w-auto"
              >
                {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                Attach files
              </Button>
            </div>
          </div>

          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            accept={settings.allowedUploadExtensions.map((extension) => `.${extension}`).join(',')}
            onChange={(event) => void upload(event.target.files)}
          />

          <p className={cn('text-[11px]', rejected ? 'text-destructive' : 'text-muted-foreground')}>
            {rejected ??
              `Up to ${settings.maxUploadMb} MB each. Allowed: ${settings.allowedUploadExtensions.join(', ')}.`}
          </p>
        </div>
      )}
    </div>
  );
}
