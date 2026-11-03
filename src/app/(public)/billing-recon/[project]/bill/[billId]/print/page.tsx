'use client';

/**
 * Moved. This printed a SUBCONTRACTOR bill (`projects/{id}/bills`) from under Billing Recon's URL;
 * it now lives at /subcontractors-management/[project]/bill/[billId]/print. Kept as a redirect so
 * bookmarked and already-shared links keep working — the path parameters and query carry over.
 */

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

export default function LegacyBillPrintRedirect() {
  const router = useRouter();
  const { project, billId } = useParams() as { project?: string; billId?: string };

  useEffect(() => {
    if (!project || !billId) return;
    const { search, hash } = window.location;
    router.replace(`/subcontractors-management/${project}/bill/${billId}/print${search}${hash}`);
  }, [router, project, billId]);

  return <div className="p-8 text-sm text-muted-foreground">Opening the bill…</div>;
}
