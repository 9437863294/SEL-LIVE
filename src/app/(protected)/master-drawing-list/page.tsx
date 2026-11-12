import { Suspense } from 'react';

import { MdlLoading } from '@/components/master-drawing-list/mdl-ui';
import MdlWorkspace from '@/components/master-drawing-list/workspace';

/** The module opens on Reports: the drawing list's figures and charts. */
export default function Page() {
  return (
    <Suspense fallback={<MdlLoading />}>
      <MdlWorkspace view="reports" />
    </Suspense>
  );
}
