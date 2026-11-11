import { Suspense } from 'react';

import Register from '@/components/master-drawing-list/register';
import { MdlLoading } from '@/components/master-drawing-list/mdl-ui';

export default function Page() {
  return (
    <Suspense fallback={<MdlLoading />}>
      <Register />
    </Suspense>
  );
}
