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
import { SurveyNav } from "@/components/survey/survey-nav";
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
import { Badge } from "@/components/ui/badge";
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

      <SurveyNav context={context} active="log" />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
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
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>BOQ SL No</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">BOQ Qty</TableHead>
                  <TableHead className="text-right">Surveyed Qty</TableHead>
                  <TableHead>Surveyed By</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Trail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length ? (
                  filtered.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="whitespace-nowrap">{entry.boqSlNo || "—"}</TableCell>
                      <TableCell className="max-w-xs truncate" title={entry.description}>
                        {entry.description}
                      </TableCell>
                      <TableCell className="text-right">{formatQuantity(entry.boqQty)}</TableCell>
                      <TableCell className="text-right font-medium">
                        {formatQuantity(entry.surveyedQty)} {entry.unit}
                      </TableCell>
                      <TableCell className="text-sm">{entry.surveyedByName || "—"}</TableCell>
                      <TableCell className="text-sm">{entry.currentStepName || "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={surveyStatusStyles[entry.status]}>
                          {entry.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="min-w-[220px]">
                        {entry.actionLogs?.length ? (
                          <Accordion type="single" collapsible>
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
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={8} className="h-32 text-center">
                      <History className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
                      <p className="font-medium">No survey entries</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Surveys submitted from Record Survey will appear here.
                      </p>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </SurveyPageShell>
  );
}
