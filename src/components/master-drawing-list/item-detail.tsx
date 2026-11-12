'use client';

/**
 * `/master-drawing-list/register/<itemId>`: a link to one drawing item. Items open in the Drawing
 * Details dialog on the register, as in Project Management, so this finds the item's drawing list
 * and goes there with the dialog open.
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { useMdlQuery } from './mdl-client';
import { MdlError, MdlLoading } from './mdl-ui';

export default function OpenItem({ itemId }: { itemId: string }) {
  const router = useRouter();
  const query = useMdlQuery<{ item: { id: string; projectCode: string } }>(`items/${encodeURIComponent(itemId)}`);
  const projectCode = query.data?.item.projectCode;
  useEffect(() => {
    if (projectCode) router.replace(`/master-drawing-list/register?project=${encodeURIComponent(projectCode)}&open=${encodeURIComponent(itemId)}`);
  }, [projectCode, itemId, router]);
  if (query.error) return <MdlError message={query.error} onRetry={query.reload} />;
  return <MdlLoading label="Opening the drawing…" />;
}
