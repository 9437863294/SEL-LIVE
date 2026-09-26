'use client';

import { useCallback, useEffect, useState } from 'react';
import { auth } from '@/lib/firebase';
import { useAppearance } from '@/components/theme/ThemeProvider';
import {
  sanitizeConfig,
  sanitizePublished,
  type BrandAsset,
  type BrandAssetKind,
  type CompanyAppearanceConfig,
  type CompanyBranding,
  type PublishedAppearance,
} from '@/lib/appearance/model';
import type { AppearanceAdminRights } from '@/lib/appearance/permissions';

export interface VersionSummary {
  version: number;
  kind: 'publish' | 'branding' | 'restore';
  publishedAt: string | null;
  publishedBy: string | null;
  note: string;
  changes: string[];
  restoredFrom: number | null;
}

export interface DraftState {
  config: CompanyAppearanceConfig;
  updatedAt: string | null;
  updatedBy: string | null;
  basedOnVersion: number;
}

interface AdminData {
  rights: AppearanceAdminRights;
  published: PublishedAppearance;
  draft: DraftState;
  versions: VersionSummary[];
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in again to continue.');
  const token = await user.getIdToken();
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (!(init.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const response = await fetch(path, { ...init, headers: { ...headers, ...(init.headers as Record<string, string> | undefined) } });
  const body = (await response.json().catch(() => ({}))) as { error?: string } & T;
  if (!response.ok) throw new Error(body.error || `The server answered ${response.status}.`);
  return body;
}

/**
 * Company appearance for the Branding and Theme Management screens. Every call carries the
 * signed-in user's token; the routes check their rights and write the audit trail. After anything
 * goes live the app's own appearance is refreshed, so the administrator sees the result at once.
 */
export function useAppearanceAdmin() {
  const { refreshCompany } = useAppearance();
  const [data, setData] = useState<AdminData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const body = await call<{ rights: AppearanceAdminRights; published: unknown; draft: DraftState; versions: VersionSummary[] }>('/api/appearance/admin');
      const published = sanitizePublished(body.published);
      setData({
        rights: body.rights,
        published,
        draft: { ...body.draft, config: sanitizeConfig(body.draft.config, published) },
        versions: body.versions,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Company appearance could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Wait for the auth session to be restored before the first request.
    return auth.onAuthStateChanged((user) => {
      if (user) void load();
    });
  }, [load]);

  const afterLive = useCallback(async () => {
    await Promise.all([load(), refreshCompany()]);
  }, [load, refreshCompany]);

  const saveDraft = useCallback(
    async (config: CompanyAppearanceConfig) => {
      const body = await call<{ draft: DraftState }>('/api/appearance/admin/draft', {
        method: 'PUT',
        body: JSON.stringify({ draft: { theme: config.theme, defaults: config.defaults } }),
      });
      setData((current) => (current ? { ...current, draft: { ...body.draft, config: sanitizeConfig(body.draft.config, current.published) } } : current));
      return body.draft;
    },
    [],
  );

  const publish = useCallback(
    async (note: string) => {
      const result = await call<{ published: unknown; changes: string[] }>('/api/appearance/admin/publish', { method: 'POST', body: JSON.stringify({ note }) });
      await afterLive();
      return result;
    },
    [afterLive],
  );

  const restore = useCallback(
    async (version: number, scope: 'all' | 'theme' | 'branding') => {
      const result = await call<{ published: unknown; changes: string[] }>('/api/appearance/admin/restore', {
        method: 'POST',
        body: JSON.stringify({ version, scope }),
      });
      await afterLive();
      return result;
    },
    [afterLive],
  );

  const saveBranding = useCallback(
    async (branding: CompanyBranding, note: string) => {
      const result = await call<{ published: unknown; changes: string[] }>('/api/appearance/admin/branding', {
        method: 'PUT',
        body: JSON.stringify({ branding, note }),
      });
      await afterLive();
      return result;
    },
    [afterLive],
  );

  const uploadAsset = useCallback(async (kind: BrandAssetKind, file: File) => {
    const form = new FormData();
    form.append('kind', kind);
    form.append('file', file);
    const body = await call<{ asset: BrandAsset }>('/api/appearance/admin/assets', { method: 'POST', body: form });
    return body.asset;
  }, []);

  return { data, error, loading, reload: load, saveDraft, publish, restore, saveBranding, uploadAsset };
}
