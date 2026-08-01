import EditFixedDepositForm from '@/components/fixed-deposit/edit-fd-form';
export default async function EditFDPage({ params }: { params: Promise<{ fdId: string }> }) { const { fdId } = await params; return <EditFixedDepositForm fdId={fdId} />; }
