import LCDetailPage from '@/components/letter-of-credit/detail-page';
export default async function Page({ params }: { params: Promise<{ lcId: string }> }) { const { lcId } = await params; return <LCDetailPage lcId={lcId} />; }
