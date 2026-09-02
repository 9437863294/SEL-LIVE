'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, FileSignature, Loader2, PenLine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import type { EApprovalAttachment, EApprovalSignatureRecord } from '@/lib/e-approval';
import {
  loadEApprovalSignature,
  proxiedEApprovalFileUrl,
  signEApprovalAttachment,
  type EApprovalServiceActor,
} from '@/lib/e-approval-service';
import {
  E_APPROVAL_SIGNATURE_POSITIONS,
  getEApprovalPdfPageCount,
  type EApprovalSignaturePosition,
} from '@/lib/e-approval-pdf-signing';
import { eApprovalDialogClass } from './shared';
import { EApprovalSignaturePad } from './signature-pad';

/**
 * "Sign" on a PDF attachment — burns the actor's saved signature onto a chosen spot of a chosen
 * page, producing a new attachment rather than editing the one that was there (spec: nothing an
 * attachment carries is ever overwritten).
 *
 * No live page preview: rather than pull in a PDF-rendering dependency to draw the actual page for a
 * drag-and-drop placement, this offers the nine positions a stamp is conventionally placed at
 * (corners, edges, centre) plus a fine offset — accurate enough for "sign near the bottom right of
 * page 2" without needing to see the page to say it. A WYSIWYG placement is a reasonable follow-up
 * if this turns out not to be precise enough in practice.
 */
export function EApprovalSignAttachmentDialog({
  open,
  onOpenChange,
  approvalId,
  attachment,
  serviceActor,
  onSigned,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  approvalId: string;
  attachment: EApprovalAttachment | null;
  serviceActor: EApprovalServiceActor | null;
  onSigned: () => void;
}) {
  const { toast } = useToast();
  const [signature, setSignature] = useState<EApprovalSignatureRecord | null>(null);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [position, setPosition] = useState<EApprovalSignaturePosition>('bottom-right');
  const [widthPct, setWidthPct] = useState(20);
  const [fineTune, setFineTune] = useState(false);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [signing, setSigning] = useState(false);

  const load = useCallback(async () => {
    if (!serviceActor || !attachment) return;
    setLoading(true);
    setLoadError(null);
    try {
      const [savedSignature, response] = await Promise.all([
        loadEApprovalSignature(serviceActor.userId),
        fetch(proxiedEApprovalFileUrl(attachment.url)),
      ]);
      setSignature(savedSignature);
      if (!response.ok) throw new Error('Could not read this document.');
      const bytes = await response.arrayBuffer();
      setPageCount(await getEApprovalPdfPageCount(bytes));
      setPageIndex(0);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Could not open this document.');
    } finally {
      setLoading(false);
    }
  }, [serviceActor, attachment]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const canSign = Boolean(signature) && pageCount != null && !loadError;

  const sign = async () => {
    if (!serviceActor || !attachment || !canSign) return;
    setSigning(true);
    try {
      await signEApprovalAttachment(
        approvalId,
        attachment,
        { pageIndex, position, widthPct, offsetX, offsetY },
        serviceActor,
      );
      toast({ title: 'Signed', description: `${attachment.name} — page ${pageIndex + 1}` });
      onOpenChange(false);
      onSigned();
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Could not sign this document',
        description: error instanceof Error ? error.message : 'Something went wrong.',
      });
    } finally {
      setSigning(false);
    }
  };

  const pageOptions = useMemo(() => Array.from({ length: pageCount ?? 0 }, (_, index) => index), [pageCount]);

  return (
    <Dialog open={open} onOpenChange={(next) => !signing && onOpenChange(next)}>
      <DialogContent className={eApprovalDialogClass.content}>
        <DialogHeader className={eApprovalDialogClass.header}>
          <DialogTitle className="flex items-center gap-1.5">
            <FileSignature className="h-4 w-4" /> Sign document
          </DialogTitle>
          <DialogDescription className="text-xs">
            {attachment?.name} — this creates a new, signed copy. The original is kept exactly as it was
            uploaded.
          </DialogDescription>
        </DialogHeader>

        <div className={eApprovalDialogClass.body}>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : loadError ? (
            <p className="rounded-md border border-rose-200 bg-rose-50 px-2.5 py-2 text-xs text-rose-800">
              {loadError}
            </p>
          ) : (
            <>
              <EApprovalSignaturePad existing={signature} serviceActor={serviceActor} onSaved={setSignature} />

              {signature && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Page</Label>
                      <Select value={String(pageIndex)} onValueChange={(value) => setPageIndex(Number(value))}>
                        <SelectTrigger className="mt-1 h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {pageOptions.map((index) => (
                            <SelectItem key={index} value={String(index)}>
                              Page {index + 1} of {pageCount}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Size</Label>
                      <div className="mt-2.5 flex items-center gap-2">
                        <Slider
                          value={[widthPct]}
                          onValueChange={([value]) => setWidthPct(value)}
                          min={10}
                          max={40}
                          step={1}
                          className="flex-1"
                        />
                        <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                          {widthPct}%
                        </span>
                      </div>
                    </div>
                  </div>

                  <div>
                    <Label className="mb-1.5 block text-xs">Position on the page</Label>
                    <div className="grid w-fit grid-cols-3 gap-1.5 rounded-lg border bg-muted/20 p-2">
                      {E_APPROVAL_SIGNATURE_POSITIONS.map((option) => (
                        <button
                          key={option}
                          type="button"
                          onClick={() => setPosition(option)}
                          aria-label={option.replace('-', ' ')}
                          aria-pressed={position === option}
                          className={cn(
                            'flex h-9 w-14 items-center justify-center rounded-md border text-[10px] transition-colors',
                            position === option
                              ? 'border-sky-400 bg-sky-100 text-sky-800'
                              : 'border-transparent bg-background text-muted-foreground hover:bg-muted',
                          )}
                        >
                          <PenLine className={cn('h-3.5 w-3.5', position === option ? 'opacity-100' : 'opacity-30')} />
                        </button>
                      ))}
                    </div>
                  </div>

                  <button
                    type="button"
                    className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
                    onClick={() => setFineTune((value) => !value)}
                  >
                    <ChevronDown className={cn('h-3 w-3 transition-transform', fineTune && 'rotate-180')} />
                    Fine-tune position
                  </button>
                  {fineTune && (
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs">Horizontal offset (points)</Label>
                        <Input
                          type="number"
                          value={offsetX}
                          onChange={(event) => setOffsetX(Number(event.target.value) || 0)}
                          className="mt-1 h-8 text-xs"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Vertical offset (points)</Label>
                        <Input
                          type="number"
                          value={offsetY}
                          onChange={(event) => setOffsetY(Number(event.target.value) || 0)}
                          className="mt-1 h-8 text-xs"
                        />
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>

        <DialogFooter className={eApprovalDialogClass.footer}>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={signing}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void sign()} disabled={!canSign || signing} className="gap-1.5">
            {signing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSignature className="h-4 w-4" />}
            Sign & save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
