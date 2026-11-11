import { Suspense } from 'react';

import NewItem from '@/components/master-drawing-list/new-item';
import { MdlLoading } from '@/components/master-drawing-list/mdl-ui';

export default function Page() {
  return (
    <Suspense fallback={<MdlLoading />}>
      <NewItem />
    </Suspense>
  );
}
