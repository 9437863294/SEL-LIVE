import { redirect } from 'next/navigation';
export default async function Page({ params }: { params: Promise<{ lcId: string }> }) { const { lcId } = await params; redirect(`/letter-of-credit/hundis?lcId=${lcId}`); }
