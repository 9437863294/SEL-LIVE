
'use client';

import * as React from 'react';

export default function SubcontractorsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex w-full h-full">
        <main className="flex-1 p-4 sm:p-6 lg:p-8">
            {children}
        </main>
    </div>
  );
}
