'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

function NotFoundInner() {
  const searchParams = useSearchParams();
  // ...
  return <div>Page not found</div>;
}

export default function NotFoundPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <NotFoundInner />
    </Suspense>
  );
}
