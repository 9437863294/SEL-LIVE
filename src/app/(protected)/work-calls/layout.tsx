import type { ReactNode } from 'react';
import WindowsAgentLayoutShell from '@/components/windows-agent/module-layout-shell';

/**
 * Work calls sits inside the Windows Agent module's frame, at its own top-level URL.
 *
 * The page belongs to the module — it is listed in its sidebar, its data feeds the same
 * timeline — and without this layout it rendered bare, with no sidebar and none of the module's
 * chrome, which is exactly how it looked.
 *
 * It keeps `/work-calls` rather than moving under `/windows-agent/` because it is the one screen
 * here an employee opens on their phone, several times a day. A short URL is worth something for
 * that, and the shell is the same object either way — it carries its own provider, so it works
 * at any path.
 */
export default function WorkCallsLayout({ children }: { children: ReactNode }) {
  return <WindowsAgentLayoutShell>{children}</WindowsAgentLayoutShell>;
}
