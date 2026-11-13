"use client";

/**
 * The Work breakdown screen became Daily Progress's BOQ register (`/project-management/dpr/boq`).
 * This address forwards there, project and scope included, so an old link or bookmark still lands.
 */

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { DPR_BASE_PATH } from "@/lib/project-management-dpr";
import { DprLoadingState } from "@/components/project-management/dpr/dpr-shell";

export default function DprWorkBreakdownRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const query = searchParams?.toString() ?? "";

  useEffect(() => {
    router.replace(`${DPR_BASE_PATH}/boq${query ? `?${query}` : ""}`);
  }, [router, query]);

  return <DprLoadingState blocks={1} />;
}
