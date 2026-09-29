'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import { useAuthorization } from '@/hooks/useAuthorization';
import type { ProjectInsurancePolicy } from '@/lib/types';
import { PROJECT_POLICIES } from '@/lib/insurance-service';
import { Skeleton } from '@/components/ui/skeleton';
import { AccessDenied } from '@/components/insurance/insurance-ui';
import { ProjectPolicyForm } from '@/components/insurance/ProjectPolicyForm';

export default function EditProjectPolicyPage() {
  const { policyId } = useParams() as { policyId: string };
  const router = useRouter();
  const { toast } = useToast();
  const { can, isLoading: authLoading } = useAuthorization();
  const canEdit = can('Edit', 'Insurance.Project Insurance');
  const [policy, setPolicy] = useState<ProjectInsurancePolicy | null>(null);

  useEffect(() => {
    if (authLoading || !canEdit || !policyId) return;
    (async () => {
      try {
        const snap = await getDoc(doc(db, PROJECT_POLICIES, policyId));
        if (!snap.exists()) {
          toast({ title: 'Error', description: 'Policy not found.', variant: 'destructive' });
          router.push('/insurance/project');
          return;
        }
        setPolicy({ id: snap.id, ...snap.data() } as ProjectInsurancePolicy);
      } catch (error) {
        console.error('Error loading project policy:', error);
        toast({ title: 'Error', description: 'Failed to load the policy.', variant: 'destructive' });
      }
    })();
  }, [authLoading, canEdit, policyId, router, toast]);

  if (authLoading) return <Skeleton className="h-[500px] w-full rounded-xl" />;
  if (!canEdit) return <AccessDenied what="edit project insurance policies" />;
  if (!policy) return <Skeleton className="h-[500px] w-full rounded-xl" />;
  return <ProjectPolicyForm policy={policy} />;
}
