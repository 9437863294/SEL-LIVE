'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthorization } from '@/hooks/useAuthorization';
import { AccessDenied } from '@/components/insurance/insurance-ui';
import { ProjectPolicyForm } from '@/components/insurance/ProjectPolicyForm';

function NewProjectPolicy() {
  // An asset's page links here with ?assetId= so the policy lands on that asset.
  const assetId = useSearchParams().get('assetId') ?? undefined;
  const { can, isLoading } = useAuthorization();
  if (isLoading) return <Skeleton className="h-[500px] w-full rounded-xl" />;
  if (!can('Add', 'Insurance.Project Insurance')) return <AccessDenied what="add project insurance policies" />;
  return <ProjectPolicyForm defaultAssetId={assetId} />;
}

export default function NewProjectPolicyPage() {
  return (
    <Suspense fallback={<Skeleton className="h-[500px] w-full rounded-xl" />}>
      <NewProjectPolicy />
    </Suspense>
  );
}
