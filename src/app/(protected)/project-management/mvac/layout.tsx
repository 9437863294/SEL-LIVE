import { Suspense, type ReactNode } from "react";
import MvacModuleLayoutShell from "@/components/mvac/module-layout-shell";

/**
 * MVAC runs inside its own module sidebar, like JMC and the other sidebar modules; the screens it
 * lists are project-scoped through `?project=`, which the shell reads (hence the Suspense boundary
 * `useSearchParams` needs).
 */
export default function MvacLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={null}>
      <MvacModuleLayoutShell>{children}</MvacModuleLayoutShell>
    </Suspense>
  );
}
