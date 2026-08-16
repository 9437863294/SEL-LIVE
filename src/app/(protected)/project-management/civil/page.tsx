"use client";

import { useSearchParams } from "next/navigation";
import ScopeExecutionWorkspace from "@/components/project-management/scope-execution-workspace";

export default function CivilPage() {
  const searchParams = useSearchParams();
  return (
    <ScopeExecutionWorkspace
      mappingId={searchParams?.get("project") ?? ""}
      scope="Civil"
    />
  );
}
