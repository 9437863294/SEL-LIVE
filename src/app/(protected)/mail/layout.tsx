import { Suspense, type ReactNode } from 'react';

import MailHubLayoutShell from '@/components/mail-hub/module-layout-shell';

// The shell reads search params (selected mailbox, folder and thread), which needs a Suspense
// boundary so the route can still be prerendered around it.
export default function MailHubLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={null}>
      <MailHubLayoutShell>{children}</MailHubLayoutShell>
    </Suspense>
  );
}
