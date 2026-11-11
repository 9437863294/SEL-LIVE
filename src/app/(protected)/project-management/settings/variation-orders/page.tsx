"use client";

/**
 * Where Project Management › Settings › Variation Orders used to be. The register moved under BOQ
 * (`/project-management/boq/variation-orders`), because approving a variation changes a BOQ
 * quantity — that is work on the register, not configuration of it. This address stays because it
 * is in bookmarks and in links sent around; it has no menu entry and only points onward.
 *
 * The one part that really is a setting — the tolerance a request is judged against — is on
 * Settings › General.
 */

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowRight, GitPullRequestArrow, SlidersHorizontal } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";

export default function VariationOrdersMovedPage() {
  const searchParams = useSearchParams();
  const query = searchParams?.toString() ?? "";
  const registerHref = `/project-management/boq/variation-orders${query ? `?${query}` : ""}`;

  const onward = [
    {
      title: "Variation Orders",
      description: "Request, approve and reject BOQ quantity variations.",
      detail: "Project Management › BOQ › Variation Orders",
      href: registerHref,
      icon: GitPullRequestArrow,
      gradient: "from-amber-500 to-orange-600",
    },
    {
      title: "Variation tolerance",
      description: "The percentage a surveyed quantity may exceed the BOQ before a variation is needed.",
      detail: "Project Management › Settings › General",
      href: "/project-management/settings/general",
      icon: SlidersHorizontal,
      gradient: "from-slate-500 to-slate-700",
    },
  ];

  return (
    <main className="min-h-[calc(100dvh-4rem)] space-y-5 p-4 sm:p-6">
      <PageHeader
        title="Variation Orders"
        description="This register now lives under BOQ."
        icon={GitPullRequestArrow}
        backHref="/project-management/settings"
        backLabel="Back to Settings"
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {onward.map((item) => {
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href} className="group no-underline">
              <Card className="h-full overflow-hidden border-border/60 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
                <div className={`h-1 w-full bg-gradient-to-r ${item.gradient}`} />
                <CardContent className="flex items-center gap-2.5 p-3">
                  <div
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br shadow-sm ${item.gradient}`}
                  >
                    <Icon className="h-4 w-4 text-white" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold leading-tight">{item.title}</p>
                    <p className="text-xs text-muted-foreground">{item.description}</p>
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground/80">{item.detail}</p>
                  </div>
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1" />
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </main>
  );
}
