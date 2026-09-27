"use client";

/**
 * Survey Log — every entry raised on this project and where it stands, including the action trail
 * each one has accumulated.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { History, Search } from "lucide-react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useToast } from "@/hooks/use-toast";
import { useProjectManagementSurveyContext } from "@/components/survey/use-survey-host-context";
import {
  SURVEY_GRADIENT,
  SurveyAccessDenied,
  SurveyLoadingState,
  SurveyPageHeader,
  SurveyPageShell,
  SurveyProjectNotFound,
} from "@/components/survey/survey-page-shell";
import {
  SURVEY_ENTRY_COLLECTION,
  SURVEY_ENTRY_STATUSES,
  surveyStatusStyles,
  type SurveyEntry,
  type SurveyEntryStatus,
} from "@/lib/project-management-survey-workflow";
import {
  PmDataList,
  PmEmptyState,
  PmToolbar,
  type PmListColumn,
} from "@/components/project-management/pm-shell";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const formatQuantity = (value: number) =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 }).format(value);

const toDateSafe = (value: unknown): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "object" && value !== null && "toDate" in value) {
    try {
      return (value as { toDate: () => Date }).toDate();
    } catch {
      return null;
    }
  }
  return null;
};

export default function SurveyLogPage() {
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { toast } = useToast();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { context, isResolving, notFound, projectName } = useProjectManagementSurveyContext(mappingId);

  const [entries, setEntries] = useState<SurveyEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<SurveyEntryStatus | "All">("All");

  const canViewModule = useMemo(() => {
    if (isAuthLoading) return false;
    try {
      return can("View", context.permissionResource);
    } catch {
      return false;
    }
  }, [isAuthLoading, can, context.permissionResource]);

  const globalProjectId = context.globalProjectId;

  const loadData = useCallback(async () => {
    if (!globalProjectId) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const snapshot = await getDocs(collection(db, "projects", globalProjectId, SURVEY_ENTRY_COLLECTION));
      const next = snapshot.docs.map((entryDoc) => ({ id: entryDoc.id, ...entryDoc.data() } as SurveyEntry));
      next.sort((a, b) => {
        const left = toDateSafe(a.createdAt)?.getTime() ?? 0;
        const right = toDateSafe(b.createdAt)?.getTime() ?? 0;
        return right - left;
      });
      setEntries(next);
    } catch (error) {
      console.error("Failed to load the survey log:", error);
      toast({ title: "Unable to load the survey log", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [globalProjectId, toast]);

  useEffect(() => {
    if (isAuthLoading || isResolving || !canViewModule) {
      if (!isAuthLoading && !isResolving) setIsLoading(false);
      return;
    }
    void loadData();
  }, [canViewModule, isAuthLoading, isResolving, loadData]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return entries.filter((entry) => {
      if (statusFilter !== "All" && entry.status !== statusFilter) return false;
      if (
        term &&
        !entry.boqSlNo.toLowerCase().includes(term) &&
        !entry.description.toLowerCase().includes(term) &&
        !entry.surveyedByName.toLowerCase().includes(term)
      ) {
        return false;
      }
      return true;
    });
  }, [entries, search, statusFilter]);

  const columns: PmListColumn<SurveyEntry>[] = [
    { header: "BOQ SL No", className: "whitespace-nowrap", mobile: "title", cell: (entry) => entry.boqSlNo || "—" },
    {
      header: "Description",
      className: "max-w-xs truncate",
      mobile: "title",
      cell: (entry) => <span title={entry.description}>{entry.description}</span>,
    },
    { header: "BOQ Qty", align: "right", cell: (entry) => formatQuantity(entry.boqQty) },
    {
      header: "Surveyed Qty",
      align: "right",
      cell: (entry) => (
        <span className="font-medium">
          {formatQuantity(entry.surveyedQty)} {entry.unit}
        </span>
      ),
    },
    { header: "Surveyed By", cell: (entry) => entry.surveyedByName || "—" },
    { header: "Stage", cell: (entry) => entry.currentStepName || "—" },
    {
      header: "Status",
      mobile: "aside",
      cell: (entry) => (
        <Badge variant="outline" className={surveyStatusStyles[entry.status]}>
          {entry.status}
        </Badge>
      ),
    },
    {
      header: "Trail",
      className: "min-w-[220px]",
      // The footer rather than a detail: a detail truncates to one line, which would clip the
      // expanded trail.
      mobile: "footer",
      cell: (entry) =>
        entry.actionLogs?.length ? (
          <Accordion type="single" collapsible className="w-full">
            <AccordionItem value={entry.id} className="border-0">
              <AccordionTrigger className="py-1 text-xs">
                {entry.actionLogs.length} {entry.actionLogs.length === 1 ? "action" : "actions"}
              </AccordionTrigger>
              <AccordionContent>
                <ul className="space-y-1.5">
                  {entry.actionLogs.map((log, index) => (
                    <li key={index} className="text-xs">
                      <span className="font-medium">{log.action}</span>
                      {log.stepName ? ` at ${log.stepName}` : ""} — {log.userName}
                      {toDateSafe(log.timestamp)
                        ? ` · ${toDateSafe(log.timestamp)!.toLocaleString()}`
                        : ""}
                      {log.comment ? (
                        <p className="text-muted-foreground">{log.comment}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        ) : (
          <span className="text-xs text-muted-foreground">No actions yet</span>
        ),
    },
  ];

  if (isAuthLoading || isResolving || (isLoading && canViewModule)) {
    return <SurveyLoadingState />;
  }

  if (!canViewModule) {
    return <SurveyAccessDenied description="You do not have permission to access the Survey module." />;
  }

  if (notFound) {
    return (
      <SurveyProjectNotFound
        description="Return to Project Management and choose a project before opening Survey."
        href="/project-management"
      />
    );
  }

  return (
    <SurveyPageShell>
      <SurveyPageHeader
        title="Survey Log"
        subtitle={
          projectName
            ? `${entries.length} survey ${entries.length === 1 ? "entry" : "entries"} on ${projectName}.`
            : `${entries.length} survey ${entries.length === 1 ? "entry" : "entries"}.`
        }
        icon={History}
        backHref={context.surveyHref()}
        backLabel="Back to Survey"
        gradient={SURVEY_GRADIENT}
      />


      <PmToolbar>
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search BOQ SL No, description or surveyor..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <Select value={statusFilter} onValueChange={(value: SurveyEntryStatus | "All") => setStatusFilter(value)}>
          <SelectTrigger className="w-full sm:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="All">All statuses</SelectItem>
            {SURVEY_ENTRY_STATUSES.map((status) => (
              <SelectItem key={status} value={status}>
                {status}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </PmToolbar>

      <PmDataList
        rows={filtered}
        columns={columns}
        empty={
          <PmEmptyState
            icon={History}
            title="No survey entries"
            description="Surveys submitted from Record Survey will appear here."
          />
        }
      />
    </SurveyPageShell>
  );
}
