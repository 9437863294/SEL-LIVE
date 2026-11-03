'use client';

/**
 * The old Billing Log listed Subcontractors' bills, which are not Billing Recon's. Its place is
 * the RA bill register, so old links and bookmarks land there.
 */

import { useEffect } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';

export default function BillingLogRedirectPage() {
  const { project: projectSlug } = useParams() as { project: string };
  const router = useRouter();
  const target = `/billing-recon/${projectSlug}/billing`;

  useEffect(() => {
    router.replace(target);
  }, [router, target]);

  return (
    <p className="py-12 text-center text-sm text-muted-foreground">
      The billing log is now the{' '}
      <Link href={target} className="font-medium text-primary hover:underline">
        RA bill register
      </Link>
      …
    </p>
  );
}
