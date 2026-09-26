'use client';

import { useEffect, useState } from 'react';
import { AppearanceGallery } from '@/components/appearance/AppearanceGallery';
import { useAppearance } from '@/components/theme/ThemeProvider';
import { sanitizeConfig, type NavStyle } from '@/lib/appearance/model';

// Kept in step with ThemePreviewFrame. (A page file may only export the page.)
const PREVIEW_MESSAGE = 'sel-appearance-preview';
const PREVIEW_READY = 'sel-appearance-preview-ready';

/**
 * Representative ERP screens under a theme that is not live yet — the frame Theme Management
 * shows a draft in. Deliberately outside the app shell (no header, no module chrome) and, being
 * outside the public routes, only for signed-in users.
 *
 * The draft arrives by `postMessage` from the parent page, accepted only from this same origin and
 * only from the window that framed it, and is re-validated before use. It is shown as everyone
 * would see it — the administrator's own preferences are ignored here — in the scheme and
 * contrast the frame's URL asks for. Nothing about it is saved or cached.
 */
export default function AppearancePreviewPage() {
  const { setPreview, company } = useAppearance();
  const [navStyle, setNavStyle] = useState<NavStyle>(company.defaults.navStyle);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const mode = params.get('scheme') === 'dark' ? 'dark' : 'light';
    const contrast = params.get('contrast') === 'high' ? 'high' : 'standard';
    // Until a draft arrives, show the published theme the same way.
    setPreview({ config: company, mode, contrast, ignorePreferences: true });

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== window.parent) return;
      const data = event.data as { type?: string; config?: unknown } | null;
      if (!data || data.type !== PREVIEW_MESSAGE) return;
      const config = sanitizeConfig(data.config);
      setPreview({ config, mode, contrast, ignorePreferences: true });
      setNavStyle(config.defaults.navStyle);
    };
    window.addEventListener('message', onMessage);
    if (window.parent !== window) window.parent.postMessage({ type: PREVIEW_READY }, window.location.origin);
    return () => {
      window.removeEventListener('message', onMessage);
      setPreview(null);
    };
    // The published theme is only the placeholder until the parent posts the draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setPreview]);

  return (
    <main className="min-h-screen bg-background p-4 text-foreground sm:p-6">
      <AppearanceGallery navStyle={navStyle} />
    </main>
  );
}
