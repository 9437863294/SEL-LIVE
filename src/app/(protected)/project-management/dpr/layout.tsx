import { Suspense, type ReactNode } from "react";
import DprModuleLayoutShell from "@/components/project-management/dpr/module-layout-shell";

/**
 * Daily Progress runs inside its own module sidebar, like the other sidebar modules; the screens
 * it lists are project-scoped through `?project=`, which the shell reads (hence the Suspense
 * boundary `useSearchParams` needs).
 */
export default function DailyProgressLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={null}>
      <DprModuleLayoutShell>{children}</DprModuleLayoutShell>
    </Suspense>
  );
}
