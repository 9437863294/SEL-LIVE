'use client';

import { Skeleton } from '@/components/ui/skeleton';
import { useAuthorization } from '@/hooks/useAuthorization';
import { AccessDenied } from '@/components/insurance/insurance-ui';
import { PersonalPolicyForm } from '@/components/insurance/PersonalPolicyForm';

export default function NewPolicyPage() {
  const { can, isLoading } = useAuthorization();
  if (isLoading) return <Skeleton className="h-[500px] w-full rounded-xl" />;
  if (!can('Add', 'Insurance.Personal Insurance')) return <AccessDenied what="add personal insurance policies" />;
  return <PersonalPolicyForm />;
}
