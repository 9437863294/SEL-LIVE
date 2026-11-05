"use client";

/**
 * Daily Progress log — every sheet filed on this project, newest first.
 *
 * The register's audit view: which days are filed, which are still drafts, and what each one
 * booked. Opening a row returns to the entry screen for that date and scope.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CalendarDays, History, Plus } from "lucide-react";
import { useAuthorization } from "@/hooks/useAuthorization";
import {
  DPR_BASE_PATH,
  DPR_PERMISSION_RESOURCE,
  DPR_STATUSES,
  dprNumber,
  type DprScope,
  type DprStatus,
} from "@/lib/project-management-dpr";
import { useDprData } from "@/components/project-management/dpr/use-dpr-data";
import {
  DprAccessDenied,
  DprLoadingState,
  DprPageShell,
  DprProjectNotFound,
  DprScopeTabs,
  formatDisplayDate,
  formatQty,
} from "@/components/project-management/dpr/dpr-shell";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { PmEmptyState } from "@/components/project-management/pm-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default function DprLogPage() {
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const canView = !isAuthLoading && can("View", DPR_PERMISSION_RESOURCE);

  const { projectName, isResolving, notFound, entries, isLoading } = useDprData(mappingId, canView);

  const [scope, setScope] = useState<DprScope | "All">("All");
  const [status, setStatus] = useState<DprStatus | "All">("All");
  const [search, setSearch] = useState("");

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return entries
      .filter((entry) => (scope === "All" ? true : entry.scope === scope))
      .filter((entry) => (status === "All" ? true : entry.status === status))
      .filter((entry) => {
        if (!needle) return true;
        const haystack = [
          entry.date,
          entry.scope,
          entry.preparedByName ?? "",
          entry.remarks ?? "",
          entry.hindrances ?? "",
          ...(entry.lines ?? []).map((line) => `${line.boqSlNo} ${line.description}`),
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(needle);
      })
      .map((entry) => ({
        entry,
        plannedQty: (entry.lines ?? []).reduce((sum, line) => sum + dprNumber(line.plannedQty), 0),
        actualQty: (entry.lines ?? []).reduce((sum, line) => sum + dprNumber(line.actualQty), 0),
        manpower: (entry.manpower ?? []).reduce((sum, line) => sum + dprNumber(line.count), 0),
      }));
  }, [entries, scope, status, search]);

  const withProject = (path: string) =>
    `${path}${path.includes("?") ? "&" : "?"}project=${encodeURIComponent(mappingId)}`;

  if (isAuthLoading || isResolving) return <DprLoadingState blocks={1} />;
  if (!canView) {
    return <DprAccessDenied description="You do not have permission to view daily progress." />;
  }
  if (notFound) {
    return (
      <DprProjectNotFound
        description="Return to Project Management and choose a project before opening the log."
        href="/project-management"
      />
    );
  }

  return (
    <DprPageShell>
      <PageHeader
        title="Daily Progress log"
        description="Every sheet filed on this project, newest first."
        icon={History}
        breadcrumbs={[
          { label: "Project Management", href: "/project-management" },
          { label: "Daily Progress", href: withProject(DPR_BASE_PATH) },
          { label: projectName || "Project" },
        ]}
        backHref={withProject(DPR_BASE_PATH)}
        backLabel="Daily Progress"
        actions={
          <Button asChild>
            <Link href={withProject(`${DPR_BASE_PATH}/entry`)}>
              <Plus className="mr-2 h-4 w-4" /> Record progress
            </Link>
          </Button>
        }
      />

      <Card className="border-border/60">
        <CardContent className="space-y-4 p-4">
          <DprScopeTabs value={scope} onChange={setScope} includeAll />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input
              placeholder="Search by date, BOQ line, recorder or remarks…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <Select value={status} onValueChange={(next) => setStatus(next as DprStatus | "All")}>
              <SelectTrigger className="text-left">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="All">All statuses</SelectItem>
                {DPR_STATUSES.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 5 }).map((_, index) => (
                <div key={index} className="h-12 animate-pulse rounded bg-muted/50" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <PmEmptyState
              icon={CalendarDays}
              title={entries.length === 0 ? "No daily progress recorded yet" : "Nothing matches these filters"}
              description={
                entries.length === 0
                  ? "Record a day's work against this project's Civil or Erection BOQ lines."
                  : "Clear the search or change the scope and status filters."
              }
              action={
                entries.length === 0 ? (
                  <Button asChild>
                    <Link href={withProject(`${DPR_BASE_PATH}/entry`)}>
                      <Plus className="mr-2 h-4 w-4" /> Record progress
                    </Link>
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Scope</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Lines</TableHead>
                  <TableHead className="text-right">Projected</TableHead>
                  <TableHead className="text-right">Actual</TableHead>
                  <TableHead className="text-right">Manpower</TableHead>
                  <TableHead className="text-right">Lost hrs</TableHead>
                  <TableHead>Recorded by</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(({ entry, plannedQty, actualQty, manpower }) => (
                  <TableRow key={entry.id}>
                    <TableCell className="whitespace-nowrap font-medium">
                      {formatDisplayDate(entry.date)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge
                        status={entry.scope}
                        tone={entry.scope === "Civil" ? "info" : "progress"}
                      />
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={entry.status} dot />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {(entry.lines ?? []).length}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatQty(plannedQty)}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {formatQty(actualQty)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatQty(manpower)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatQty(dprNumber(entry.lostTimeHours))}
                    </TableCell>
                    <TableCell className="max-w-[160px] truncate">
                      {entry.preparedByName || entry.createdByName || "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button asChild size="sm" variant="outline">
                        <Link
                          href={withProject(
                            `${DPR_BASE_PATH}/entry?scope=${entry.scope}&date=${entry.date}`,
                          )}
                        >
                          Open
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </DprPageShell>
  );
}
