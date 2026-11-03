'use client';

/**
 * Where the Subcontractors screens link to, depending on which module is showing them.
 *
 * The screens live in Subcontractors Management (`/subcontractors-management/[project]/…`) and are
 * also mounted inside Billing Recon (`/billing-recon/[project]/subcontractors/…`), in Billing
 * Recon's own frame. They are the same screens over the same records — the subcontractor register,
 * `projects/{id}/workOrders`, `bills`, `proformaBills` — not a second copy of the data. Every link a
 * screen builds goes through this, so a user who opened them from Billing Recon stays in Billing
 * Recon: Add → Save → back to the list never drops them into the other module.
 *
 * Outside a <SubcontractorsHost> (the Subcontractors module itself) the paths are the module's own.
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useParams } from 'next/navigation';

export type SubcontractorsHostModule = 'subcontractors-management' | 'billing-recon';

export interface SubcontractorsPaths {
  host: SubcontractorsHostModule;
  /** This project's Subcontractors screens, e.g. `${base}/manage`. */
  base: string;
  /** Another project's — for rows of the all-projects registers. */
  baseFor: (projectSlug: string) => string;
  /** Where "back" from the project's Subcontractors home goes. */
  root: string;
  rootLabel: string;
}

/** The paths for a host module and project slug. Pure, so it can be tested. */
export function subcontractorsPathsFor(host: SubcontractorsHostModule, projectSlug: string): SubcontractorsPaths {
  const baseFor =
    host === 'billing-recon'
      ? (slug: string) => `/billing-recon/${slug}/subcontractors`
      : (slug: string) => `/subcontractors-management/${slug}`;
  return {
    host,
    base: baseFor(projectSlug),
    baseFor,
    root: host === 'billing-recon' ? `/billing-recon/${projectSlug}` : '/subcontractors-management',
    rootLabel: host === 'billing-recon' ? 'Back to Billing Recon' : 'Back to Projects',
  };
}

const HostContext = createContext<SubcontractorsHostModule>('subcontractors-management');

/** Mounts the Subcontractors screens inside another module, so their links stay in it. */
export function SubcontractorsHost({ module, children }: { module: SubcontractorsHostModule; children: ReactNode }) {
  return <HostContext.Provider value={module}>{children}</HostContext.Provider>;
}

/** The module showing the Subcontractors screens. */
export function useSubcontractorsHost(): SubcontractorsHostModule {
  return useContext(HostContext);
}

/**
 * The link paths for this project's Subcontractors screens.
 * @param projectSlug the `[project]` segment; defaults to the URL's.
 */
export function useSubcontractorsPaths(projectSlug?: string): SubcontractorsPaths {
  const host = useContext(HostContext);
  const params = useParams();
  const slug = projectSlug ?? (typeof params?.project === 'string' ? params.project : '');
  return useMemo(() => subcontractorsPathsFor(host, slug), [host, slug]);
}
