'use client';

import { useCallback, useRef, useState } from 'react';
import { Loader2, PenLine, RotateCcw, Save, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { saveEApprovalSignature, type EApprovalServiceActor } from '@/lib/e-approval-service';
import type { EApprovalSignatureRecord } from '@/lib/e-approval';

/**
 * Capturing a signature — drawn with a finger, stylus or mouse, or a scanned image uploaded instead.
 * Saved once to `eApprovalSignatures` and reused every time this person signs a document afterwards.
 *
 * A visual mark, not a cryptographic one: this is a scanned-signature stand-in, the same trust model
 * as signing a paper note-sheet by hand — the record shows who placed it and when, not a certificate
 * chain. See docs/e-approval.md for what a cryptographic signature (DSC) would additionally require.
 */

const PAD_WIDTH = 500;
const PAD_HEIGHT = 180;
const INK_COLOR = '#1e293b';
const ALPHA_THRESHOLD = 16;

/**
 * Crops a transparent-background canvas to the bounding box of its actual ink, with a small margin.
 *
 * Without this, every drawn signature has the pad's fixed 500×180 aspect ratio baked in — a small,
 * wide scrawl in the corner of the pad would otherwise be placed on a PDF stretched to fill that
 * whole rectangle. Only applied to drawn signatures: an uploaded image is used as the person provided
 * it, since "trim to non-white" is a much less reliable guess than "trim to non-transparent."
 */
function trimToInk(source: HTMLCanvasElement): HTMLCanvasElement | null {
  const context = source.getContext('2d');
  if (!context) return null;
  const { data, width, height } = context.getImageData(0, 0, source.width, source.height);

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = data[(y * width + x) * 4 + 3];
      if (alpha > ALPHA_THRESHOLD) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX || maxY < minY) return null; // nothing drawn

  const margin = 6;
  const cropX = Math.max(0, minX - margin);
  const cropY = Math.max(0, minY - margin);
  const cropWidth = Math.min(width, maxX + margin) - cropX;
  const cropHeight = Math.min(height, maxY + margin) - cropY;

  const trimmed = document.createElement('canvas');
  trimmed.width = cropWidth;
  trimmed.height = cropHeight;
  trimmed.getContext('2d')?.drawImage(source, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
  return trimmed;
}

export function EApprovalSignaturePad({
  existing,
  serviceActor,
  onSaved,
}: {
  existing: EApprovalSignatureRecord | null;
  serviceActor: EApprovalServiceActor | null;
  onSaved: (signature: EApprovalSignatureRecord) => void;
}) {
  const { toast } = useToast();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [hasInk, setHasInk] = useState(false);
  const [mode, setMode] = useState<'draw' | 'upload'>('draw');
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [replacing, setReplacing] = useState(!existing);
  const [busy, setBusy] = useState(false);

  const context = useCallback(() => canvasRef.current?.getContext('2d') ?? null, []);

  const pointFromEvent = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * PAD_WIDTH,
      y: ((event.clientY - rect.top) / rect.height) * PAD_HEIGHT,
    };
  };

  const startStroke = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    drawing.current = true;
    const ctx = context();
    const { x, y } = pointFromEvent(event);
    if (!ctx) return;
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const continueStroke = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = context();
    if (!ctx) return;
    const { x, y } = pointFromEvent(event);
    ctx.lineTo(x, y);
    ctx.strokeStyle = INK_COLOR;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    setHasInk(true);
  };

  const endStroke = () => {
    drawing.current = false;
  };

  const clear = () => {
    const ctx = context();
    if (ctx) ctx.clearRect(0, 0, PAD_WIDTH, PAD_HEIGHT);
    setHasInk(false);
  };

  const canSave = mode === 'draw' ? hasInk : Boolean(uploadedFile);

  const save = async () => {
    if (!serviceActor || !canSave) return;
    setBusy(true);
    try {
      let blob: Blob;
      let width: number;
      let height: number;

      if (mode === 'draw') {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const trimmed = trimToInk(canvas);
        if (!trimmed) {
          toast({ variant: 'destructive', title: 'Nothing drawn', description: 'Draw your signature first.' });
          return;
        }
        blob = await new Promise<Blob>((resolve, reject) =>
          trimmed.toBlob((result) => (result ? resolve(result) : reject(new Error('Could not export the signature.'))), 'image/png'),
        );
        width = trimmed.width;
        height = trimmed.height;
      } else {
        if (!uploadedFile) return;
        const image = await loadImage(uploadedFile);
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        canvas.getContext('2d')?.drawImage(image, 0, 0);
        blob = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob((result) => (result ? resolve(result) : reject(new Error('Could not read the image.'))), 'image/png'),
        );
        width = image.naturalWidth;
        height = image.naturalHeight;
      }

      const saved = await saveEApprovalSignature(blob, { width, height }, serviceActor);
      toast({ title: 'Signature saved' });
      clear();
      setUploadedFile(null);
      setReplacing(false);
      onSaved(saved);
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Could not save your signature',
        description: error instanceof Error ? error.message : 'Something went wrong.',
      });
    } finally {
      setBusy(false);
    }
  };

  if (existing && !replacing) {
    return (
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Your saved signature</p>
        <div className="flex items-center gap-3 rounded-lg border bg-muted/20 p-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- a Storage URL, not a local/optimizable asset */}
          <img src={existing.url} alt="Your signature" className="h-12 max-w-[200px] object-contain" />
          <Button type="button" size="sm" variant="outline" className="ml-auto h-8 gap-1.5" onClick={() => setReplacing(true)}>
            <PenLine className="h-3.5 w-3.5" /> Replace
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {existing ? 'Draw a new signature' : 'Save your signature'}
        </p>
        <div className="flex gap-1">
          <Button
            type="button"
            size="sm"
            variant={mode === 'draw' ? 'secondary' : 'ghost'}
            className="h-7 px-2 text-[11px]"
            onClick={() => setMode('draw')}
          >
            Draw
          </Button>
          <Button
            type="button"
            size="sm"
            variant={mode === 'upload' ? 'secondary' : 'ghost'}
            className="h-7 px-2 text-[11px]"
            onClick={() => setMode('upload')}
          >
            Upload image
          </Button>
        </div>
      </div>

      {mode === 'draw' ? (
        <div className="space-y-1.5">
          <canvas
            ref={canvasRef}
            width={PAD_WIDTH}
            height={PAD_HEIGHT}
            className="w-full touch-none rounded-lg border-2 border-dashed bg-white"
            style={{ aspectRatio: `${PAD_WIDTH} / ${PAD_HEIGHT}` }}
            onPointerDown={startStroke}
            onPointerMove={continueStroke}
            onPointerUp={endStroke}
            onPointerLeave={endStroke}
          />
          <div className="flex items-center justify-between">
            <p className="text-[11px] text-muted-foreground">Draw with your finger, stylus or mouse.</p>
            <Button type="button" size="sm" variant="ghost" className="h-7 gap-1 px-2 text-[11px]" onClick={clear} disabled={!hasInk}>
              <RotateCcw className="h-3 w-3" /> Clear
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-1.5">
          <label className="flex h-[100px] w-full cursor-pointer items-center justify-center rounded-lg border-2 border-dashed bg-muted/20 text-xs text-muted-foreground hover:bg-muted/30">
            <Upload className="mr-1.5 h-4 w-4" />
            {uploadedFile ? uploadedFile.name : 'Choose an image of your signature'}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => setUploadedFile(event.target.files?.[0] ?? null)}
            />
          </label>
        </div>
      )}

      <div className="flex justify-end gap-2">
        {existing && (
          <Button type="button" size="sm" variant="outline" onClick={() => setReplacing(false)} disabled={busy}>
            Cancel
          </Button>
        )}
        <Button type="button" size="sm" onClick={() => void save()} disabled={!canSave || busy} className="gap-1.5">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Save signature
        </Button>
      </div>
    </div>
  );
}

const loadImage = (file: File): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read that image.'));
    };
    image.src = url;
  });
