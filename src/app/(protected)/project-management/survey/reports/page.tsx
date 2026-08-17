"use client";

/**
 * Survey Reports — coverage and where surveyed value is sitting in the approval pipeline.
 *
 * Deliberately a summary over the entry register rather than a report builder: the numbers that
 * matter here are how much of the BOQ has been certified, and how much value is still waiting on
 * review, since that is what gates variations and procurement downstream.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { BarChart3 } from "lucide-react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { BoqItem } from "@/lib/types";
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
  isTerminalSurveyStatus,
  surveyStatusStyles,
  type SurveyEntry,
  type SurveyEntryStatus,
} from "@/lib/project-management-survey-workflow";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const toNumber = (value: unknown) => {
  const parsed = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);

export default function SurveyReportsPage() {
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { toast } = useToast();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { context, isResolving, notFound, projectName } = useProjectManagementSurveyContext(mappingId);

  const [boqItems, setBoqItems] = useState<BoqItem[]>([]);
  const [entries, setEntries] = useState<SurveyEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const canViewReports = useMemo(() => {
    if (isAuthLoading) return false;
    try {
      return can("View Reports", context.permissionResource);
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
      const [boqSnapshot, entrySnapshot] = await Promise.all([
        getDocs(collection(db, "projects", globalProjectId, "boqItems")),
        getDocs(collection(db, "projects", globalProjectId, SURVEY_ENTRY_COLLECTION)),
      ]);
      setBoqItems(boqSnapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() } as BoqItem)));
      setEntries(entrySnapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() } as SurveyEntry)));
    } catch (error) {
      console.error("Failed to load survey reports:", error);
      toast({ title: "Unable to load survey reports", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [globalProjectId, toast]);

  useEffect(() => {
    if (isAuthLoading || isResolving || !canViewReports) {
      if (!isAuthLoading && !isResolving) setIsLoading(false);
      return;
    }
    void loadData();
  }, [canViewReports, isAuthLoading, isResolving, loadData]);

  const summary = useMemo(() => {
    const totalValue = boqItems.reduce(
      (sum, item) => sum + toNumber(item["QTY"]) * toNumber(item["Budget Price"]),
      0,
    );
    const certifiedValue = boqItems
      .filter((item) => typeof item.surveyedQty === "number")
      .reduce((sum, item) => sum + toNumber(item["QTY"]) * toNumber(item["Budget Price"]), 0);

    const byStatus = SURVEY_ENTRY_STATUSES.map((status) => {
      const matching = entries.filter((entry) => entry.status === status);
      return {
        status,
        count: matching.length,
        value: matching.reduce((sum, entry) => sum + entry.boqQty * entry.budgetPrice, 0),
      };
    });

    const inReview = entries.filter((entry) => !isTerminalSurveyStatus(entry.status));

    return {
      totalValue,
      certifiedValue,
      certifiedPct: totalValue ? Math.round((certifiedValue / totalValue) * 100) : 0,
      byStatus,
      inReviewCount: inReview.length,
      inReviewValue: inReview.reduce((sum, entry) => sum + entry.boqQty * entry.budgetPrice, 0),
    };
  }, [boqItems, entries]);

  if (isAuthLoading || isResolving || (isLoading && canViewReports)) {
    return <SurveyLoadingState />;
  }

  if (!canViewReports) {
    return <SurveyAccessDenied description="You do not have permission to view Survey reports." />;
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
        title="Survey Reports"
        subtitle={projectName ? `Coverage and pipeline for ${projectName}.` : "Coverage and pipeline."}
        icon={BarChart3}
        backHref={context.surveyHref()}
        backLabel="Back to Survey"
        gradient={SURVEY_GRADIENT}
      />

      <SurveyNav context={context} active="hub" />

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Certified coverage</CardDescription>
            <CardTitle className="text-2xl">{summary.certifiedPct}%</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 text-xs text-muted-foreground">
            {formatCurrency(summary.certifiedValue)} of {formatCurrency(summary.totalValue)} BOQ value
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Awaiting review</CardDescription>
            <CardTitle className="text-2xl">{summary.inReviewCount}</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 text-xs text-muted-foreground">
            {formatCurrency(summary.inReviewValue)} of BOQ value in the pipeline
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total entries</CardDescription>
            <CardTitle className="text-2xl">{entries.length}</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 text-xs text-muted-foreground">
            Across {boqItems.length} BOQ {boqItems.length === 1 ? "item" : "items"}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Entries by status</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Entries</TableHead>
                <TableHead className="text-right">BOQ value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summary.byStatus.map((row) => (
                <TableRow key={row.status}>
                  <TableCell>
                    <Badge variant="outline" className={surveyStatusStyles[row.status as SurveyEntryStatus]}>
                      {row.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">{row.count}</TableCell>
                  <TableCell className="text-right">{formatCurrency(row.value)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </SurveyPageShell>
  );
}
