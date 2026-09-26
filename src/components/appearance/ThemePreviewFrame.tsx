'use client';

import { useEffect, useRef, useState } from 'react';
import type { CompanyAppearanceConfig } from '@/lib/appearance/model';

const PREVIEW_MESSAGE = 'sel-appearance-preview';
const PREVIEW_READY = 'sel-appearance-preview-ready';

/**
 * A live frame of `/appearance-preview` showing `config` — including unsaved edits — in one
 * scheme and contrast, at a device width. The frame is its own document, so its light or dark
 * mode is exact regardless of the mode the administrator is using.
 */
export function ThemePreviewFrame({
  config,
  scheme,
  contrast,
  width,
  height = 760,
  title,
}: {
  config: CompanyAppearanceConfig;
  scheme: 'light' | 'dark';
  contrast: 'standard' | 'high';
  width: number;
  height?: number;
  title: string;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow) return;
      if ((event.data as { type?: string } | null)?.type === PREVIEW_READY) setReady(true);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    if (ready) frame.current?.contentWindow?.postMessage({ type: PREVIEW_MESSAGE, config }, window.location.origin);
  }, [ready, config]);

  return (
    <div className="overflow-x-auto rounded-xl border bg-muted/40 p-2">
      <iframe
        ref={frame}
        title={title}
        src={`/appearance-preview?scheme=${scheme}&contrast=${contrast}`}
        style={{ width, height }}
        className="mx-auto block max-w-none rounded-lg border bg-background"
      />
    </div>
  );
}
