import { Suspense } from 'react';

import { MdlLoading } from '@/components/master-drawing-list/mdl-ui';
import MdlWorkspace from '@/components/master-drawing-list/workspace';

export default function Page() {
  return (
    <Suspense fallback={<MdlLoading />}>
      <MdlWorkspace view="gantt" />
    </Suspense>
  );
}
