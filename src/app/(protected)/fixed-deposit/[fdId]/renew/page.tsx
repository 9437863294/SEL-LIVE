import FDRenewalWorkspace from '@/components/fixed-deposit/renewal-workspace';
export default async function FDRenewPage({ params }: { params: Promise<{ fdId: string }> }) { const { fdId } = await params; return <FDRenewalWorkspace initialFdId={fdId} />; }
