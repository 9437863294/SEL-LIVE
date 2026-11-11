import ItemDetail from '@/components/master-drawing-list/item-detail';
import { decodeParam } from '@/lib/master-drawing-list/params';

export default async function Page({ params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await params;
  return <ItemDetail itemId={decodeParam(itemId)} />;
}
