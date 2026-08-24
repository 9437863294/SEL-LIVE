import { Suspense, type ReactNode } from "react";
import { TowerProgressProvider } from "@/components/project-management/tower-progress/tower-progress-provider";
import { TowerProgressLoading } from "@/components/project-management/tower-progress/tower-progress-ui";

/**
 * Mounted above every Tower Progress screen so the tower register, the update history and the
 * project settings are read once and shared. The App Router keeps this layout alive while the user
 * moves between the dashboard, a tower and the reports, so those navigations do not re-read a
 * 186-tower register — they all project the same arrays.
 *
 * The Suspense boundary is required: the provider reads `?project=` through `useSearchParams`, which
 * suspends during prerender.
 */
export default function TowerProgressLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<TowerProgressLoading />}>
      <TowerProgressProvider>{children}</TowerProgressProvider>
    </Suspense>
  );
}
