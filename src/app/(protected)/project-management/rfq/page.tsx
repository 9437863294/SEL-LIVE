"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  FileSearch,
  Plus,
  ShieldAlert,
  Users,
} from "lucide-react";
import { Fragment } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAuthorization } from "@/hooks/useAuthorization";
import {
  RFQ_COLLECTION,
  RFQ_PERMISSION_RESOURCE,
  formatDate,
  rfqStatusStyles,
  type Rfq,
} from "@/lib/rfq";

type ProjectMapping = {
  id: string;
  projectName: string;
  globalProjectId: string;
  globalProjectName: string;
};

export default function RfqListPage() {
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { toast } = useToast();
  const { can, isLoading: isAuthLoading } = useAuthorization();

  const canView = can("View", RFQ_PERMISSION_RESOURCE) || can("View", "Project Management.BOQ");
  const canAdd = can("Add", RFQ_PERMISSION_RESOURCE);

  const [mapping, setMapping] = useState<ProjectMapping | null>(null);
  const [rfqs, setRfqs] = useState<Rfq[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);

  const loadData = useCallback(async () => {
    if (!mappingId) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const mappingSnapshot = await getDoc(doc(db, "projectManagementProjects", mappingId));
      if (!mappingSnapshot.exists()) throw new Error("Project mapping not found");
      const mappingData = { id: mappingSnapshot.id, ...mappingSnapshot.data() } as ProjectMapping;
      if (!mappingData.globalProjectId) throw new Error("Global project is not mapped");

      const rfqSnapshot = await getDocs(collection(db, "projects", mappingData.globalProjectId, RFQ_COLLECTION));
      const rows = rfqSnapshot.docs
        .map((d) => ({ id: d.id, ...d.data() }) as Rfq)
        .sort((a, b) => (b.rfqDate || "").localeCompare(a.rfqDate || ""));

      setMapping(mappingData);
      setRfqs(rows);
    } catch (error) {
      console.error("Failed to load RFQs:", error);
      toast({
        title: "Unable to load RFQs",
        description: error instanceof Error ? error.message : "Project RFQ data could not be loaded.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [mappingId, toast]);

  useEffect(() => {
    if (isAuthLoading) return;
    if (!canView) {
      setIsLoading(false);
      return;
    }
    void loadData();
  }, [canView, isAuthLoading, loadData]);

  const toggleExpanded = (id: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const totalOpen = useMemo(
    () => rfqs.filter((rfq) => !["Closed", "Cancelled"].includes(rfq.status)).length,
    [rfqs],
  );

  if (isAuthLoading || isLoading) {
    return (
      <main className="min-h-[calc(100vh-4rem)] space-y-5 p-4 sm:p-6">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-80 w-full" />
      </main>
    );
  }

  if (!canView) {
    return (
      <main className="min-h-[calc(100vh-4rem)] p-4 sm:p-6">
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>You do not have permission to view RFQs.</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center p-8">
            <ShieldAlert className="h-16 w-16 text-destructive" />
          </CardContent>
        </Card>
      </main>
    );
  }

  if (!mappingId || !mapping) {
    return (
      <main className="min-h-[calc(100vh-4rem)] p-4 sm:p-6">
        <Card>
          <CardHeader>
            <CardTitle>Select a project first</CardTitle>
            <CardDescription>Return to Project Management and choose a project before opening RFQs.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild><Link href="/project-management">Select Project</Link></Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] space-y-5 p-4 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link href={`/project-management?project=${encodeURIComponent(mappingId)}`} aria-label="Back to Project Management">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 shadow-sm">
            <FileSearch className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">RFQ</h1>
            <p className="text-sm text-muted-foreground">Request quotations from vendors for {mapping.projectName}.</p>
          </div>
        </div>
        {canAdd && (
          <Button asChild>
            <Link href={`/project-management/rfq/new?project=${encodeURIComponent(mappingId)}`}>
              <Plus className="mr-2 h-4 w-4" /> New RFQ
            </Link>
          </Button>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card><CardContent className="flex items-center gap-3 p-4"><FileSearch className="h-8 w-8 text-violet-600" /><div><p className="text-2xl font-bold">{rfqs.length}</p><p className="text-xs text-muted-foreground">Total RFQs</p></div></CardContent></Card>
        <Card><CardContent className="flex items-center gap-3 p-4"><ClipboardList className="h-8 w-8 text-blue-600" /><div><p className="text-2xl font-bold">{totalOpen}</p><p className="text-xs text-muted-foreground">Open RFQs</p></div></CardContent></Card>
        <Card><CardContent className="flex items-center gap-3 p-4"><Users className="h-8 w-8 text-emerald-600" /><div><p className="text-2xl font-bold">{rfqs.reduce((sum, rfq) => sum + (rfq.vendorIds?.length ?? 0), 0)}</p><p className="text-xs text-muted-foreground">Vendor Invitations Sent</p></div></CardContent></Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>RFQs</CardTitle>
          <CardDescription>Each RFQ can bundle items from multiple indents and go out to multiple vendors.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10" />
                  <TableHead>RFQ No.</TableHead>
                  <TableHead>RFQ Date</TableHead>
                  <TableHead>Due Date</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead>Vendors</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Open</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rfqs.length ? rfqs.map((rfq) => {
                  const isExpanded = expandedIds.has(rfq.id);
                  return (
                    <Fragment key={rfq.id}>
                      <TableRow className="cursor-pointer" onClick={() => toggleExpanded(rfq.id)}>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <Button variant="ghost" size="icon" onClick={() => toggleExpanded(rfq.id)} aria-label={isExpanded ? "Collapse" : "Expand"}>
                            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </Button>
                        </TableCell>
                        <TableCell className="font-medium">{rfq.rfqNumber}</TableCell>
                        <TableCell className="whitespace-nowrap">{formatDate(rfq.rfqDate)}</TableCell>
                        <TableCell className="whitespace-nowrap">{formatDate(rfq.dueDate)}</TableCell>
                        <TableCell>{rfq.items?.length ?? 0}</TableCell>
                        <TableCell>{rfq.vendorIds?.length ?? 0}</TableCell>
                        <TableCell>
                          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${rfqStatusStyles[rfq.status]}`}>{rfq.status}</span>
                        </TableCell>
                        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                          <Link href={`/project-management/rfq/${rfq.id}?project=${encodeURIComponent(mappingId)}`} className="text-sm font-medium text-primary hover:underline">
                            Open
                          </Link>
                        </TableCell>
                      </TableRow>
                      {isExpanded && (
                        <TableRow className="bg-muted/40 hover:bg-muted/40">
                          <TableCell colSpan={8} className="p-0">
                            <div className="p-3">
                              <p className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Vendors invited</p>
                              <div className="mb-3 flex flex-wrap gap-1.5 px-1">
                                {(rfq.vendorNames ?? []).map((name) => (
                                  <span key={name} className="rounded-full border bg-background px-2.5 py-1 text-xs">{name}</span>
                                ))}
                              </div>
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead>BOQ SL No</TableHead>
                                    <TableHead>Description</TableHead>
                                    <TableHead>Qty</TableHead>
                                    <TableHead>Source Indent</TableHead>
                                    <TableHead>Awarded To</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {(rfq.items ?? []).map((item) => (
                                    <TableRow key={item.rfqItemId}>
                                      <TableCell>{item.boqSlNo || "—"}</TableCell>
                                      <TableCell className="max-w-sm truncate" title={item.description}>{item.description}</TableCell>
                                      <TableCell>{item.qty} {item.unit}</TableCell>
                                      <TableCell>{item.sourceIndentNumber}</TableCell>
                                      <TableCell>{item.awardedVendorName || "—"}</TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                }) : (
                  <TableRow>
                    <TableCell colSpan={8} className="h-36 text-center">
                      <FileSearch className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
                      <p className="font-medium">No RFQs created</p>
                      <p className="text-sm text-muted-foreground">Create an RFQ from one or more indents to invite vendor quotes.</p>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
