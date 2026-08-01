import FDClosureWorkspace from '@/components/fixed-deposit/closure-workspace';
export default async function FDClosePage({ params }: { params: Promise<{ fdId: string }> }) { const { fdId } = await params; return <FDClosureWorkspace initialFdId={fdId} />; }
