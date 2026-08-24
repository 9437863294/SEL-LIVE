"use client";

import { TowerDetailView } from "@/components/project-management/tower-progress/tower-detail-view";

/** `.../towers/{towerId}/photos` — the same tower page opened on its photographs. */
export default function TowerPhotosPage() {
  return <TowerDetailView defaultTab="photos" />;
}
