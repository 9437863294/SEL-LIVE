'use client';

/**
 * One message body, displayed safely — the browser half of the three layers described in
 * `src/lib/mail-hub/sanitize.ts`:
 *
 *   - the HTML has already been through the server's allowlist;
 *   - DOMPurify runs over it again here, with every form, frame and handler forbidden;
 *   - it renders in `<iframe sandbox>` **without `allow-scripts`**, under the frame's own CSP.
 *     `allow-same-origin` is kept only so this component can read the document's height; with no
 *     script, the framed document cannot use that origin for anything.
 *
 * Remote images stay blocked until the reader presses "Load images" for this one message.
 */

import { useEffect, useRef, useState } from 'react';
import { Download, Eye, ImageOff, Loader2, Paperclip, ShieldAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { mailApi, mailBlob, type BodyView, type MessageItem } from '@/lib/mail-hub/client';
import { mailFrameDocument } from '@/lib/mail-hub/frame';
import type { MailAttachmentMeta } from '@/lib/mail-hub/model';
import { previewKind } from '@/lib/mail-hub/rules';
import { cn } from '@/lib/utils';
import { formatBytes } from './ui';

async function purify(html: string): Promise<string> {
  const { default: DOMPurify } = await import('dompurify');
  return DOMPurify.sanitize(html, {
    WHOLE_DOCUMENT: false,
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select', 'base', 'meta', 'link', 'svg', 'math'],
    FORBID_ATTR: ['srcset', 'action', 'formaction', 'xlink:href'],
    ALLOW_DATA_ATTR: true,
    ADD_ATTR: ['target'],
  });
}

export function MailFrame({ html, allowRemote }: { html: string; allowRemote: boolean }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [doc, setDoc] = useState<string | null>(null);
  const [height, setHeight] = useState(120);

  useEffect(() => {
    let cancelled = false;
    void purify(html).then((clean) => {
      if (!cancelled) setDoc(mailFrameDocument(clean, allowRemote));
    });
    return () => {
      cancelled = true;
    };
  }, [html, allowRemote]);

  const measure = () => {
    const body = ref.current?.contentDocument?.body;
    if (body) setHeight(Math.min(Math.max(body.scrollHeight + 16, 60), 20_000));
  };

  if (!doc) return <div className="h-16 animate-pulse rounded bg-slate-100" />;
  return (
    <iframe
      ref={ref}
      title="Message"
      srcDoc={doc}
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
      className="w-full border-0 bg-white"
      style={{ height }}
      onLoad={() => {
        measure();
        // Late-loading images change the height once.
        setTimeout(measure, 400);
      }}
    />
  );
}

export function AttachmentList({ message, attachments }: { message: Pick<MessageItem, 'id'>; attachments: MailAttachmentMeta[] }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ url: string; kind: string; name: string; scan: string | null } | null>(null);
  const visible = attachments.filter((entry) => !entry.inline || !entry.contentId);
  if (!visible.length) return null;

  const open = async (attachment: MailAttachmentMeta, mode: 'download' | 'preview') => {
    setBusy(attachment.id);
    try {
      const { blob, scanStatus } = await mailBlob(mailApi.attachmentUrl(message.id, attachment.id, mode === 'preview'));
      const kind = previewKind(attachment.contentType, attachment.filename);
      // The blob's type is chosen here, from the safe list — never the sender's claim.
      const typed = new Blob([blob], { type: mode === 'preview' ? (kind === 'pdf' ? 'application/pdf' : kind === 'text' ? 'text/plain' : blob.type) : 'application/octet-stream' });
      const url = URL.createObjectURL(typed);
      if (mode === 'preview') setPreview({ url, kind, name: attachment.filename, scan: scanStatus });
      else {
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = attachment.filename;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
        if (scanStatus === 'not-scanned') toast({ title: 'Downloaded', description: 'This server does not scan attachments. Open files only from senders you trust.' });
      }
    } catch (error) {
      toast({ variant: 'destructive', title: 'Could not open the attachment', description: error instanceof Error ? error.message : undefined });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {visible.map((attachment) => {
        const kind = previewKind(attachment.contentType, attachment.filename);
        return (
          <div key={attachment.id} className={cn('flex max-w-full items-center gap-2 rounded-lg border bg-white px-2.5 py-1.5 text-xs', attachment.blocked && 'border-rose-200 bg-rose-50')}>
            {attachment.blocked ? <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-rose-600" /> : <Paperclip className="h-3.5 w-3.5 shrink-0 text-slate-500" />}
            <span className="max-w-[14rem] truncate font-medium" title={attachment.filename}>{attachment.filename}</span>
            <span className="text-muted-foreground">{formatBytes(attachment.size)}</span>
            {attachment.blocked ? (
              <span className="text-rose-700" title={attachment.blockedReason ?? undefined}>Blocked</span>
            ) : (
              <>
                {kind !== 'none' && (
                  <Button size="icon" variant="ghost" className="h-6 w-6" aria-label={`Preview ${attachment.filename}`} disabled={busy === attachment.id} onClick={() => open(attachment, 'preview')}>
                    <Eye className="h-3.5 w-3.5" />
                  </Button>
                )}
                <Button size="icon" variant="ghost" className="h-6 w-6" aria-label={`Download ${attachment.filename}`} disabled={busy === attachment.id} onClick={() => open(attachment, 'download')}>
                  {busy === attachment.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                </Button>
              </>
            )}
          </div>
        );
      })}
      <Dialog open={Boolean(preview)} onOpenChange={(next) => { if (!next && preview) { URL.revokeObjectURL(preview.url); setPreview(null); } }}>
        <DialogContent className="max-h-[92vh] max-w-4xl overflow-hidden">
          <DialogHeader>
            <DialogTitle className="truncate">{preview?.name}</DialogTitle>
            <DialogDescription>{preview?.scan === 'clean' ? 'Scanned — no threats found.' : preview?.scan === 'not-scanned' ? 'Not scanned on this server.' : 'Preview'}</DialogDescription>
          </DialogHeader>
          {preview?.kind === 'image' && <img src={preview.url} alt={preview.name} className="mx-auto max-h-[75vh] object-contain" />}
          {preview?.kind === 'pdf' && <iframe title={preview.name} src={preview.url} className="h-[75vh] w-full rounded border" />}
          {preview?.kind === 'text' && <iframe title={preview.name} src={preview.url} sandbox="" className="h-[75vh] w-full rounded border bg-white" />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function MessageBody({ message }: { message: MessageItem }) {
  const [body, setBody] = useState<BodyView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [remote, setRemote] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    mailApi
      .body(message.id, remote)
      .then((next) => {
        if (!cancelled) setBody(next);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'The message could not be loaded.');
      });
    return () => {
      cancelled = true;
    };
  }, [message.id, remote]);

  if (error) return <p className="rounded bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>;
  if (!body) return <div className="space-y-2"><div className="h-4 w-3/4 animate-pulse rounded bg-slate-100" /><div className="h-4 w-1/2 animate-pulse rounded bg-slate-100" /></div>;

  return (
    <div>
      {(body.remoteContentBlocked > 0 && !body.remoteAllowed) || body.suspiciousLinks > 0 ? (
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
          {body.remoteContentBlocked > 0 && !body.remoteAllowed && (
            <span className="flex items-center gap-1.5 rounded-md bg-slate-100 px-2 py-1 text-slate-600">
              <ImageOff className="h-3.5 w-3.5" /> {body.remoteContentBlocked} remote image{body.remoteContentBlocked === 1 ? '' : 's'} blocked
              <button type="button" className="font-medium text-indigo-700 underline" onClick={() => setRemote(true)}>Load images</button>
            </span>
          )}
          {body.suspiciousLinks > 0 && (
            <span className="flex items-center gap-1.5 rounded-md bg-amber-50 px-2 py-1 text-amber-800">
              <ShieldAlert className="h-3.5 w-3.5" /> {body.suspiciousLinks} link{body.suspiciousLinks === 1 ? '' : 's'} go somewhere other than {body.suspiciousLinks === 1 ? 'its' : 'their'} text says
            </span>
          )}
        </div>
      ) : null}
      {body.html ? <MailFrame html={body.html} allowRemote={body.remoteAllowed} /> : <pre className="whitespace-pre-wrap break-words font-sans text-sm text-slate-800">{body.text ?? message.snippet}</pre>}
      <AttachmentList message={message} attachments={body.attachments.length ? body.attachments : message.attachments} />
    </div>
  );
}
