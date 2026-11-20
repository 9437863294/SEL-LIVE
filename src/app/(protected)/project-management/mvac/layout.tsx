import { Suspense, type ReactNode } from "react";
import MvacModuleLayoutShell from "@/components/mvac/module-layout-shell";
import { PmInModuleShell } from "@/components/project-management/pm-shell";

/**
 * MVAC runs inside its own module sidebar, like JMC and the other sidebar modules; the screens it
 * lists are project-scoped through `?project=`, which the shell reads (hence the Suspense boundary
 * `useSearchParams` needs).
 *
 * The register is a Project Management kit screen (`PmShell`, `PmContent`), which pads and rails
 * itself when it stands alone. `PmInModuleShell` tells it not to: the module already supplies the
 * sidebar and the padding, and two rails side by side is two sets of navigation for one screen.
 */
export default function MvacLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={null}>
      <MvacModuleLayoutShell>
        <PmInModuleShell>{children}</PmInModuleShell>
      </MvacModuleLayoutShell>
    </Suspense>
  );
}
