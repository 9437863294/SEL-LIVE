'use client';

/**
 * Moved. This printed a SUBCONTRACTOR proforma bill (`projects/{id}/proformaBills`) from under
 * Billing Recon's URL; it now lives at
 * /subcontractors-management/[project]/proforma-bill/[proformaId]/print. Kept as a redirect so
 * bookmarked and already-shared links keep working — the path parameters and query carry over.
 */

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

export default function LegacyProformaBillPrintRedirect() {
  const router = useRouter();
  const { project, proformaId } = useParams() as { project?: string; proformaId?: string };

  useEffect(() => {
    if (!project || !proformaId) return;
    const { search, hash } = window.location;
    router.replace(`/subcontractors-management/${project}/proforma-bill/${proformaId}/print${search}${hash}`);
  }, [router, project, proformaId]);

  return <div className="p-8 text-sm text-muted-foreground">Opening the proforma bill…</div>;
}
