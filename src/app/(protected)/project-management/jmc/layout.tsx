import { Suspense, type ReactNode } from "react";
import JmcModuleLayoutShell from "@/components/jmc/module-layout-shell";

/**
 * JMC runs inside its own module sidebar, like the other sidebar modules; the screens it lists are
 * project-scoped through `?project=`, which the shell reads (hence the Suspense boundary
 * `useSearchParams` needs).
 */
export default function JmcLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={null}>
      <JmcModuleLayoutShell>{children}</JmcModuleLayoutShell>
    </Suspense>
  );
}
