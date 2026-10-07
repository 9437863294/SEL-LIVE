'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CompanyBranding } from '@/lib/appearance/model';

// Kept in step with src/app/appearance-preview/login/page.tsx.
const PREVIEW_MESSAGE = 'sel-login-preview';
const PREVIEW_READY = 'sel-login-preview-ready';

export const LOGIN_PREVIEW_DEVICES = {
  desktop: { width: 1280, height: 800, label: 'Desktop' },
  phone: { width: 390, height: 780, label: 'Phone' },
} as const;
export type LoginPreviewDevice = keyof typeof LOGIN_PREVIEW_DEVICES;

/** The tallest a phone preview is drawn, so it never needs the page scrolled to see it whole. */
const PHONE_MAX_HEIGHT = 560;

/**
 * A live, scaled-down frame of the sign-in page showing `branding` — unsaved edits included — at a
 * real device width, so each design lays out exactly as it will for a visitor on that device.
 */
export function LoginPreviewFrame({ branding, device }: { branding: CompanyBranding; device: LoginPreviewDevice }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [boxWidth, setBoxWidth] = useState(0);
  const { width, height } = LOGIN_PREVIEW_DEVICES[device];

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    setBoxWidth(el.clientWidth);
    const observer = new ResizeObserver(([entry]) => setBoxWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow) return;
      if ((event.data as { type?: string } | null)?.type === PREVIEW_READY) setReady(true);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    if (ready) frame.current?.contentWindow?.postMessage({ type: PREVIEW_MESSAGE, branding }, window.location.origin);
  }, [ready, branding]);

  const scale = boxWidth ? Math.min(1, boxWidth / width, device === 'phone' ? PHONE_MAX_HEIGHT / height : 1) : 0;
  const left = Math.max(0, (boxWidth - width * scale) / 2);

  return (
    <div ref={box} className="relative w-full overflow-hidden rounded-xl border bg-muted/40" style={{ height: scale ? height * scale : 240 }}>
      {!ready && <div className="absolute inset-0 animate-pulse bg-muted" aria-hidden="true" />}
      <iframe
        ref={frame}
        title={`Sign-in page preview, ${LOGIN_PREVIEW_DEVICES[device].label.toLowerCase()}`}
        src="/appearance-preview/login"
        tabIndex={-1}
        style={{ width, height, transform: `scale(${scale})`, left, opacity: ready ? 1 : 0 }}
        className="pointer-events-none absolute top-0 origin-top-left border-0 transition-opacity duration-300"
      />
    </div>
  );
}
