import FDDetailPage from '@/components/fixed-deposit/fd-detail-page';
export default async function FixedDepositDetailRoute({ params }: { params: Promise<{ fdId: string }> }) { const { fdId } = await params; return <FDDetailPage fdId={fdId} />; }
