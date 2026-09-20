import type { ReactNode } from 'react';
import WindowsAgentLayoutShell from '@/components/windows-agent/module-layout-shell';

export default function WindowsAgentLayout({ children }: { children: ReactNode }) {
  return <WindowsAgentLayoutShell>{children}</WindowsAgentLayoutShell>;
}
