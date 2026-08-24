"use client";

import { TowerDetailView } from "@/components/project-management/tower-progress/tower-detail-view";

/** `.../towers/{towerId}/timeline` — the same tower page opened on its photo timeline. */
export default function TowerTimelinePage() {
  return <TowerDetailView defaultTab="timeline" />;
}
