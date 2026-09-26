'use client';

import { useId, useRef, useState } from 'react';
import { ImageUp, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ASSET_RULES } from '@/lib/appearance/image-probe';
import type { BrandAsset, BrandAssetKind } from '@/lib/appearance/model';
import { cn } from '@/lib/utils';

const ACCEPT = 'image/png,image/jpeg,image/webp';

/** Read the pixel size in the browser, so an obviously wrong file is refused before it uploads. */
async function measure(file: File): Promise<{ width: number; height: number } | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return null;
  }
}

/**
 * One brand image: a preview on the background it is meant for, Upload/Replace and Remove, and
 * the rules stated up front. The browser checks type, size and dimensions first for a quick
 * answer; the server checks the actual bytes again and has the final say.
 */
export function BrandAssetField({
  kind,
  value,
  onChange,
  upload,
  background,
  disabled,
  description,
}: {
  kind: BrandAssetKind;
  value: BrandAsset | null;
  onChange: (asset: BrandAsset | null) => void;
  upload: (kind: BrandAssetKind, file: File) => Promise<BrandAsset>;
  background: 'light' | 'dark';
  disabled?: boolean;
  description?: string;
}) {
  const rule = ASSET_RULES[kind];
  const inputRef = useRef<HTMLInputElement>(null);
  const errorId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function choose(file: File | undefined) {
    if (!file) return;
    setError(null);
    const problems: string[] = [];
    if (!(rule.types as readonly string[]).includes(file.type)) problems.push(`Use ${rule.types.map((t) => t.split('/')[1].toUpperCase()).join(', ')}.`);
    if (file.size > rule.maxBytes) problems.push(`Keep it under ${Math.round(rule.maxBytes / 1024)} KB.`);
    const size = await measure(file);
    if (size) {
      if (size.width < rule.minWidth || size.height < rule.minHeight) problems.push(`At least ${rule.minWidth}×${rule.minHeight} px.`);
      if (size.width > rule.maxWidth || size.height > rule.maxHeight) problems.push(`At most ${rule.maxWidth}×${rule.maxHeight} px.`);
      if (rule.square && size.width !== size.height) problems.push('It must be square.');
    }
    if (problems.length) {
      setError(problems.join(' '));
      return;
    }
    setBusy(true);
    try {
      onChange(await upload(kind, file));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The image could not be uploaded.');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  const square = rule.square;
  return (
    <div className="space-y-2 rounded-xl border p-3">
      <div>
        <p className="text-sm font-semibold">{rule.label}</p>
        <p className="text-xs text-muted-foreground">
          {description ? `${description} ` : ''}
          {rule.types.map((t) => t.split('/')[1].toUpperCase()).join(', ')} · up to {Math.round(rule.maxBytes / 1024)} KB · {rule.minWidth}–{rule.maxWidth}px
          {square ? ', square' : ' wide'}
        </p>
      </div>
      <div
        className={cn(
          'keep-light flex h-24 items-center justify-center rounded-lg border',
          background === 'dark' ? 'bg-zinc-900' : 'bg-white',
        )}
        aria-label={`${rule.label} preview on a ${background} background`}
        role="img"
      >
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element -- a token URL to our own bucket, previewed at its natural ratio
          <img src={value.url} alt="" className={cn('max-h-20 max-w-[85%] object-contain', square && 'h-16 w-16')} />
        ) : (
          <span className={cn('text-xs', background === 'dark' ? 'text-zinc-400' : 'text-slate-500')}>Using the built-in image</span>
        )}
      </div>
      {value && (
        <p className="text-xs text-muted-foreground">
          {value.width}×{value.height}px · {Math.round(value.size / 1024)} KB
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs font-medium text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => void choose(event.target.files?.[0])}
        />
        <Button type="button" size="sm" variant="outline" className="gap-1.5" disabled={disabled || busy} aria-describedby={error ? errorId : undefined} onClick={() => inputRef.current?.click()}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <ImageUp className="h-3.5 w-3.5" aria-hidden="true" />}
          {value ? 'Replace' : 'Upload'}
        </Button>
        {value && (
          <Button type="button" size="sm" variant="ghost" className="gap-1.5" disabled={disabled || busy} onClick={() => onChange(null)}>
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Use built-in
          </Button>
        )}
      </div>
    </div>
  );
}
