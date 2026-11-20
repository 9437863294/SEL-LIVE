"use client";
export const dynamic = "force-dynamic";

/**
 * The MVAC summary: every certificate, what it holds, and where it has got to.
 *
 * It reads the module's shared register rather than its own copy of Firestore, so the figures here
 * and the dashboard's are the same figures — a report that disagrees with the screen it was opened
 * from is worse than no report.
 *
 * Three readings, in the order a person asks for them: the totals, where the register is sitting,
 * and then the certificates themselves.
 */

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { BarChart4, Layers, PackageCheck, PackageX, Users } from "lucide-react";
import { useAuthorization } from "@/hooks/useAuthorization";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/shared/page-header";
import {
  PmDataList,
  PmEmptyState,
  type PmListColumn,
} from "@/components/project-management/pm-shell";
import { ModuleSectionHeading, ModuleStatTile } from "@/components/project-management/module-dashboard-kit";
import { useSupplyProject } from "@/components/project-management/supply-document-screens";
import { useMvacRegister } from "@/components/mvac/mvac-shell";
import {
  MvacAccessDenied,
  MvacLoadingState,
  MvacPageShell,
  MvacProjectNotFound,
} from "@/components/mvac/mvac-page-shell";
import {
  PM_MVAC_PERMISSION_RESOURCE,
  mvacTabHref,
} from "@/lib/project-management-mvac-module";
import {
  formatMvacQty,
  mvacDocTotals,
  mvacRaisedOn,
  mvacStagePosition,
  type MvacItemLike,
} from "@/lib/project-management-mvac-dashboard";

interface SummaryRow {
  id: string;
  docNumber: string;
  date: string;
  sortKey: number;
  vendorName: string;
  lines: number;
  presented: number;
  accepted: number;
  rejected: number;
  status: string;
  where: string;
}

const formatDate = (value: Date | null): string =>
  value
    ? value.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
    : "—";

export default function MvacSummaryPage() {
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { projectName, isResolving, notFound } = useSupplyProject(mappingId);
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { steps, docs, items, reading, isLoading, loadError } = useMvacRegister();

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");

  const canViewPage = useMemo(() => {
    if (isAuthLoading) return false;
    try {
      return can("View Reports", PM_MVAC_PERMISSION_RESOURCE);
    } catch {
      return false;
    }
  }, [isAuthLoading, can]);

  const rows: SummaryRow[] = useMemo(() => {
    const byDoc = new Map<string, MvacItemLike[]>();
    for (const item of items) {
      const docId = String(item.docId ?? "");
      if (!docId) continue;
      const list = byDoc.get(docId);
      if (list) list.push(item);
      else byDoc.set(docId, [item]);
    }

    return docs
      .map((record) => {
        const totals = mvacDocTotals(byDoc.get(record.id) ?? []);
        const raised = mvacRaisedOn(record);
        const position = mvacStagePosition(record, steps);
        const docStatus = String(record.status ?? "");
        return {
          id: record.id,
          docNumber: String(record.docNumber ?? ""),
          date: formatDate(raised),
          sortKey: raised?.getTime() ?? 0,
          vendorName: String(record.vendorName ?? "—"),
          lines: totals.lines,
          presented: totals.presented,
          accepted: totals.accepted,
          rejected: totals.rejected,
          status: docStatus,
          where:
            docStatus === "Draft" || docStatus === "Cancelled"
              ? docStatus
              : steps.length === 0
                ? "No workflow configured"
                : position >= steps.length
                  ? "Through every stage"
                  : `Waiting at ${steps[position]!.name}`,
        };
      })
      .sort((a, b) => b.sortKey - a.sortKey || b.docNumber.localeCompare(a.docNumber));
  }, [docs, items, steps]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (status !== "all" && row.status !== status) return false;
      if (!needle) return true;
      return `${row.docNumber} ${row.vendorName} ${row.where}`.toLowerCase().includes(needle);
    });
  }, [rows, query, status]);

  const statuses = useMemo(
    () => [...new Set(rows.map((row) => row.status).filter(Boolean))].sort(),
    [rows],
  );

  /** What each vendor's material comes to, by the vendor named on the certificate. */
  const byVendor = useMemo(() => {
    const map = new Map<string, { vendorName: string; count: number; presented: number; accepted: number }>();
    for (const row of rows) {
      if (row.status === "Draft" || row.status === "Cancelled") continue;
      const entry = map.get(row.vendorName) ?? {
        vendorName: row.vendorName,
        count: 0,
        presented: 0,
        accepted: 0,
      };
      entry.count += 1;
      entry.presented += row.presented;
      entry.accepted += row.accepted;
      map.set(row.vendorName, entry);
    }
    return [...map.values()]
      .sort((a, b) => b.presented - a.presented)
      .map((entry) => ({ ...entry, id: entry.vendorName }));
  }, [rows]);

  const stageRows = useMemo(
    () => reading.stages.map((stage) => ({ ...stage, id: stage.id })),
    [reading.stages],
  );

  if (isAuthLoading || isResolving) return <MvacLoadingState />;

  if (!canViewPage) {
    return <MvacAccessDenied description="You do not have permission to view MVAC reports." />;
  }

  if (notFound) {
    return (
      <MvacProjectNotFound description="This link does not identify a mapped Project Management project, so the MVAC summary cannot be opened." />
    );
  }

  const certificateColumns: PmListColumn<SummaryRow>[] = [
    { header: "MVAC No.", mobile: "title", className: "font-medium", cell: (row) => row.docNumber || "—" },
    { header: "Date", className: "whitespace-nowrap", cell: (row) => row.date },
    { header: "Vendor", cell: (row) => row.vendorName },
    { header: "Lines", align: "right", cell: (row) => <span className="tabular-nums">{row.lines}</span> },
    {
      header: "Presented",
      align: "right",
      cell: (row) => <span className="tabular-nums">{formatMvacQty(row.presented)}</span>,
    },
    {
      header: "Accepted",
      align: "right",
      cell: (row) => (
        <span className="font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
          {row.accepted ? formatMvacQty(row.accepted) : "—"}
        </span>
      ),
    },
    {
      header: "Not accepted",
      align: "right",
      cell: (row) => (
        <span className="tabular-nums text-rose-700 dark:text-rose-400">
          {row.rejected ? formatMvacQty(row.rejected) : "—"}
        </span>
      ),
    },
    { header: "Status", mobile: "aside", className: "whitespace-nowrap", cell: (row) => row.status || "—" },
    { header: "Where it is", cell: (row) => row.where },
  ];

  const acceptedShare =
    reading.presentedQty > 0 ? (reading.acceptedQty / reading.presentedQty) * 100 : 0;

  return (
    <MvacPageShell>
      <PageHeader
        title="MVAC Summary"
        description={
          projectName
            ? `Every joint acceptance certificate on ${projectName}.`
            : "Every joint acceptance certificate on this project."
        }
        icon={BarChart4}
        backHref={mvacTabHref("reports", mappingId)}
        backLabel="Back to MVAC reports"
      />

      {loadError ? (
        <Card className="border-destructive/40">
          <CardContent className="p-6 text-sm font-semibold text-muted-foreground">
            {loadError}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <ModuleStatTile
          icon={Layers}
          label="Certificates"
          value={String(reading.count)}
          note={`${reading.lines} line${reading.lines === 1 ? "" : "s"} · ${reading.drafts} draft${reading.drafts === 1 ? "" : "s"}`}
          tone={["#f9a8d4", "#db2777"]}
        />
        <ModuleStatTile
          icon={PackageCheck}
          label="Accepted"
          value={formatMvacQty(reading.acceptedQty)}
          note={`${acceptedShare.toFixed(0)}% of ${formatMvacQty(reading.presentedQty)} presented`}
          tone={["#6ee7b7", "#059669"]}
        />
        <ModuleStatTile
          icon={PackageX}
          label="Not accepted"
          value={formatMvacQty(reading.rejectedQty)}
          note="Back in the pool, and re-presentable"
          tone={["#fcd34d", "#d97706"]}
        />
        <ModuleStatTile
          icon={Users}
          label="Vendors covered"
          value={String(reading.vendors)}
          note={`${reading.inWorkflow} certificate${reading.inWorkflow === 1 ? "" : "s"} still in the workflow`}
          tone={["#93c5fd", "#2563eb"]}
        />
      </div>

      <ModuleSectionHeading
        title="Where the register is sitting"
        hint={steps.length === 0 ? "No workflow stages configured" : `${steps.length} stages`}
      />
      <PmDataList
        rows={stageRows}
        columns={[
          { header: "Stage", mobile: "title", cell: (row) => row.name },
          {
            header: "Waiting",
            align: "right",
            cell: (row) => <span className="tabular-nums">{row.waiting}</span>,
          },
          {
            header: "Quantity held",
            align: "right",
            cell: (row) => <span className="tabular-nums">{formatMvacQty(row.waitingQty)}</span>,
          },
          {
            header: "Cleared",
            align: "right",
            cell: (row) => <span className="tabular-nums">{row.cleared}</span>,
          },
        ]}
        empty={
          <PmEmptyState
            title="No workflow stages configured"
            description="Certificates are raised and signed off on the register."
          />
        }
      />

      <ModuleSectionHeading title="By vendor" hint="As named on the certificate" />
      <PmDataList
        rows={byVendor}
        columns={[
          { header: "Vendor", mobile: "title", cell: (row) => row.vendorName },
          {
            header: "Certificates",
            align: "right",
            cell: (row) => <span className="tabular-nums">{row.count}</span>,
          },
          {
            header: "Presented",
            align: "right",
            cell: (row) => <span className="tabular-nums">{formatMvacQty(row.presented)}</span>,
          },
          {
            header: "Accepted",
            align: "right",
            cell: (row) => <span className="tabular-nums">{formatMvacQty(row.accepted)}</span>,
          },
        ]}
        empty={<PmEmptyState title="Nothing raised yet" />}
      />

      <ModuleSectionHeading
        title="Certificates"
        hint={`${shown.length} of ${rows.length} shown`}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="MVAC no., vendor or stage"
          aria-label="Search certificates"
          className="h-9 w-full sm:w-[260px]"
        />
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-9 w-full text-left sm:w-[180px]">
            <SelectValue placeholder="Every status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Every status</SelectItem>
            {statuses.map((entry) => (
              <SelectItem key={entry} value={entry}>
                {entry}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <MvacLoadingState />
      ) : (
        <PmDataList
          rows={shown}
          columns={certificateColumns}
          empty={
            <PmEmptyState
              title={rows.length === 0 ? "Nothing raised yet" : "Nothing matches that filter"}
            />
          }
        />
      )}
    </MvacPageShell>
  );
}
