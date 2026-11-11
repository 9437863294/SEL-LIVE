import { Suspense } from 'react';

import Pending from '@/components/master-drawing-list/pending';
import { MdlLoading } from '@/components/master-drawing-list/mdl-ui';

export default function Page() {
  return (
    <Suspense fallback={<MdlLoading />}>
      <Pending />
    </Suspense>
  );
}
