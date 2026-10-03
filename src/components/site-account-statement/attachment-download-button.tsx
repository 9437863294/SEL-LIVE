'use client';

import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { auth } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Save an attachment as a file.
 *
 * A plain `<a download>` does nothing here: the file lives on Firebase Storage, a different origin,
 * so browsers ignore `download` and just open it. The bytes come through `/api/sas/attachment`
 * instead, which returns them from this origin as a download.
 */
export async function downloadSasAttachment(url: string, name: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('Your session has expired. Please sign in again.');
  const token = await user.getIdToken();
  const query = new URLSearchParams({ url, name });
  const res = await fetch(`/api/sas/attachment?${query.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error || `Download failed (HTTP ${res.status}).`);
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = name || 'attachment';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoking straight away can cancel the save in some browsers.
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}

export function AttachmentDownloadButton({
  url,
  name,
  className,
  iconClassName = 'h-3.5 w-3.5',
}: {
  url: string;
  name: string;
  className?: string;
  iconClassName?: string;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  async function handleClick(event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      await downloadSasAttachment(url, name);
    } catch (error) {
      toast({
        title: 'Download failed',
        description: error instanceof Error ? error.message : 'The file could not be downloaded.',
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn('h-7 w-7 shrink-0 text-blue-600 hover:bg-blue-50 hover:text-blue-700', className)}
      onClick={handleClick}
      disabled={busy}
      title={`Download ${name}`}
      aria-label={`Download ${name}`}
    >
      {busy ? <Loader2 className={cn(iconClassName, 'animate-spin')} /> : <Download className={iconClassName} />}
    </Button>
  );
}
