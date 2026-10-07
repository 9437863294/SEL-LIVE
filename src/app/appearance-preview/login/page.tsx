'use client';

import { useEffect, useState } from 'react';
import { LoginDesignFrame, LoginFormSample } from '@/components/auth/login/designs';
import { useAppearance } from '@/components/theme/ThemeProvider';
import { sanitizeBranding, type CompanyBranding } from '@/lib/appearance/model';

// Kept in step with LoginPreviewFrame. (A page file may only export the page.)
const PREVIEW_MESSAGE = 'sel-login-preview';
const PREVIEW_READY = 'sel-login-preview-ready';

/**
 * The sign-in page in a design that may not be published yet — the frame Company Branding shows
 * its draft in. The real /login cannot be framed for this: it sends a signed-in visitor away, and
 * whoever is editing branding is signed in. Outside the public routes, so signed-in users only.
 *
 * The draft branding arrives by `postMessage`, accepted only from this same origin and only from
 * the window that framed it, and is re-validated before use. It is shown with the published theme
 * as a signed-out visitor would see it — company defaults, never the administrator's own
 * preferences. The form is a drawing: nothing on it can be clicked, and nothing is saved.
 */
export default function LoginAppearancePreviewPage() {
  const { setPreview, company } = useAppearance();
  const [draft, setDraft] = useState<CompanyBranding | null>(null);
  const branding = draft ?? company.branding;

  useEffect(() => {
    setPreview({ config: { branding, theme: company.theme, defaults: company.defaults }, ignorePreferences: true });
  }, [setPreview, branding, company.theme, company.defaults]);

  useEffect(() => () => setPreview(null), [setPreview]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== window.parent) return;
      const data = event.data as { type?: string; branding?: unknown } | null;
      if (!data || data.type !== PREVIEW_MESSAGE) return;
      setDraft(sanitizeBranding(data.branding));
    };
    window.addEventListener('message', onMessage);
    if (window.parent !== window) window.parent.postMessage({ type: PREVIEW_READY }, window.location.origin);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return (
    <div inert className="select-none">
      <LoginDesignFrame branding={branding}>
        <LoginFormSample branding={branding} />
      </LoginDesignFrame>
    </div>
  );
}
