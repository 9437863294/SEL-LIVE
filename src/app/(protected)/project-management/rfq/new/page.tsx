"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  FileSearch,
  Loader2,
  Save,
  Send,
  ShieldAlert,
} from "lucide-react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  RFQ_COLLECTION,
  RFQ_PERMISSION_RESOURCE,
  RFQ_QUOTES_SUBCOLLECTION,
  formatQuantity,
  generateRfqNumber,
  toNumber,
  type RfqItem,
} from "@/lib/rfq";
import { VENDOR_COLLECTIONS, type Vendor } from "@/lib/vendor-management";

type ProjectMapping = {
  id: string;
  projectName: string;
  globalProjectId: string;
  globalProjectName: string;
};

type IndentLineItem = {
  boqItemId: string;
  boqSlNo: string;
  description: string;
  unit: string;
  requestedQty: number;
};

type IndentRecord = {
  id: string;
  indentNumber: string;
  status: string;
  items: IndentLineItem[];
};

const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

const itemKey = (indentId: string, boqItemId: string) => `${indentId}__${boqItemId}`;

export default function NewRfqPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { toast } = useToast();
  const { user } = useAuth();
  const { can, isLoading: isAuthLoading } = useAuthorization();

  const canAdd = can("Add", RFQ_PERMISSION_RESOURCE);
  const canSend = can("Send", RFQ_PERMISSION_RESOURCE);

  const [mapping, setMapping] = useState<ProjectMapping | null>(null);
  const [indents, setIndents] = useState<IndentRecord[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [expandedIndents, setExpandedIndents] = useState<Set<string>>(new Set());

  const [rfqDate, setRfqDate] = useState(today());
  const [dueDate, setDueDate] = useState("");
  const [remarks, setRemarks] = useState("");
  const [selectedItemKeys, setSelectedItemKeys] = useState<Set<string>>(new Set());
  const [selectedVendorIds, setSelectedVendorIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (isAuthLoading || !canAdd || !mappingId) {
      setIsLoading(false);
      return;
    }

    const load = async () => {
      setIsLoading(true);
      try {
        const mappingSnapshot = await getDoc(doc(db, "projectManagementProjects", mappingId));
        if (!mappingSnapshot.exists()) throw new Error("Project mapping not found");
        const mappingData = { id: mappingSnapshot.id, ...mappingSnapshot.data() } as ProjectMapping;
        if (!mappingData.globalProjectId) throw new Error("Global project is not mapped");

        const [projectSnapshot, indentSnapshot, vendorSnapshot] = await Promise.all([
          getDoc(doc(db, "projects", mappingData.globalProjectId)),
          getDocs(collection(db, "projects", mappingData.globalProjectId, "indents")),
          getDocs(collection(db, VENDOR_COLLECTIONS.vendors)),
        ]);
        const globalProjectName =
          (projectSnapshot.data()?.projectName as string | undefined) ?? mappingData.globalProjectName;

        const relevantIndents = indentSnapshot.docs
          .map((d) => ({ id: d.id, ...d.data() }) as IndentRecord)
          .filter((indent) => !["Rejected", "Cancelled"].includes(indent.status) && indent.items?.length);

        setMapping({ ...mappingData, globalProjectName });
        setIndents(relevantIndents);
        setExpandedIndents(new Set(relevantIndents.map((i) => i.id)));
        setVendors(
          vendorSnapshot.docs
            .map((d) => ({ id: d.id, ...d.data() }) as Vendor)
            .filter((v) => v.status === "Active")
            .sort((a, b) => a.vendorName.localeCompare(b.vendorName)),
        );
      } catch (error) {
        console.error("Failed to load data for new RFQ:", error);
        toast({
          title: "Unable to load project data",
          description: error instanceof Error ? error.message : "Please try again.",
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };

    void load();
  }, [canAdd, isAuthLoading, mappingId, toast]);

  const toggleIndentExpanded = (indentId: string) => {
    setExpandedIndents((current) => {
      const next = new Set(current);
      next.has(indentId) ? next.delete(indentId) : next.add(indentId);
      return next;
    });
  };

  const toggleItem = (indentId: string, boqItemId: string, checked: boolean) => {
    setSelectedItemKeys((current) => {
      const next = new Set(current);
      const key = itemKey(indentId, boqItemId);
      checked ? next.add(key) : next.delete(key);
      return next;
    });
  };

  const toggleIndentAll = (indent: IndentRecord, checked: boolean) => {
    setSelectedItemKeys((current) => {
      const next = new Set(current);
      indent.items.forEach((item) => {
        const key = itemKey(indent.id, item.boqItemId);
        checked ? next.add(key) : next.delete(key);
      });
      return next;
    });
  };

  const toggleVendor = (vendorId: string, checked: boolean) => {
    setSelectedVendorIds((current) => {
      const next = new Set(current);
      checked ? next.add(vendorId) : next.delete(vendorId);
      return next;
    });
  };

  const selectedCount = selectedItemKeys.size;

  const buildRfqItems = (): RfqItem[] => {
    const items: RfqItem[] = [];
    indents.forEach((indent) => {
      indent.items.forEach((item) => {
        const key = itemKey(indent.id, item.boqItemId);
        if (!selectedItemKeys.has(key)) return;
        items.push({
          rfqItemId: Math.random().toString(36).slice(2),
          sourceIndentId: indent.id,
          sourceIndentNumber: indent.indentNumber,
          boqItemId: item.boqItemId,
          boqSlNo: item.boqSlNo,
          description: item.description,
          unit: item.unit,
          qty: toNumber(item.requestedQty),
        });
      });
    });
    return items;
  };

  const persistRfq = async (send: boolean) => {
    if (!mapping || !user) return;

    const items = buildRfqItems();
    if (!items.length) {
      toast({ title: "Select at least one item", variant: "destructive" });
      return;
    }
    const chosenVendors = vendors.filter((v) => selectedVendorIds.has(v.id));
    if (!chosenVendors.length) {
      toast({ title: "Select at least one vendor", variant: "destructive" });
      return;
    }
    if (!rfqDate) {
      toast({ title: "Select the RFQ date", variant: "destructive" });
      return;
    }

    setIsSaving(true);
    try {
      const rfqRef = doc(collection(db, "projects", mapping.globalProjectId, RFQ_COLLECTION));
      await setDoc(rfqRef, {
        rfqNumber: generateRfqNumber(rfqDate, rfqRef.id),
        rfqDate,
        dueDate,
        projectMappingId: mapping.id,
        projectManagementProjectName: mapping.projectName,
        globalProjectId: mapping.globalProjectId,
        globalProjectName: mapping.globalProjectName,
        items,
        vendorIds: chosenVendors.map((v) => v.id),
        vendorNames: chosenVendors.map((v) => v.vendorName),
        remarks: remarks.trim(),
        status: "Draft",
        createdAt: serverTimestamp(),
        createdBy: user.id,
        createdByName: user.name ?? "",
        updatedAt: serverTimestamp(),
      });

      await Promise.all(
        chosenVendors.map((vendor) =>
          setDoc(doc(db, "projects", mapping.globalProjectId, RFQ_COLLECTION, rfqRef.id, RFQ_QUOTES_SUBCOLLECTION, vendor.id), {
            vendorId: vendor.id,
            vendorName: vendor.vendorName,
            status: "Pending",
            items: [],
            totalAmount: 0,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          }),
        ),
      );

      if (send && canSend) {
        try {
          const response = await fetch("/api/rfq/send", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              rfqNumber: generateRfqNumber(rfqDate, rfqRef.id),
              rfqDate,
              dueDate,
              projectName: mapping.globalProjectName,
              remarks: remarks.trim(),
              items: items.map((item) => ({ description: item.description, unit: item.unit, qty: item.qty })),
              vendors: chosenVendors.map((v) => ({ vendorId: v.id, name: v.vendorName, email: v.email })),
            }),
          });
          const result = await response.json();
          const succeeded = (result.results ?? []).filter((r: { success: boolean }) => r.success).length;
          await setDoc(rfqRef, { status: "Sent", updatedAt: serverTimestamp() }, { merge: true });
          toast({
            title: "RFQ sent",
            description: `Emailed ${succeeded} of ${chosenVendors.length} vendor(s).`,
          });
        } catch (sendError) {
          console.error("Failed to send RFQ emails:", sendError);
          toast({
            title: "RFQ saved, but sending failed",
            description: "The RFQ was created as a draft. You can retry sending from the RFQ detail page.",
            variant: "destructive",
          });
        }
      } else {
        toast({ title: "RFQ saved as draft" });
      }

      router.push(`/project-management/rfq/${rfqRef.id}?project=${encodeURIComponent(mappingId)}`);
    } catch (error) {
      console.error("Failed to create RFQ:", error);
      toast({ title: "Unable to create RFQ", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  if (isAuthLoading || isLoading) {
    return (
      <main className="min-h-[calc(100vh-4rem)] space-y-5 p-4 sm:p-6">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-64 w-full" />
      </main>
    );
  }

  if (!canAdd) {
    return (
      <main className="min-h-[calc(100vh-4rem)] p-4 sm:p-6">
        <h1 className="mb-6 text-2xl font-bold sm:text-3xl">Create RFQ</h1>
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>You do not have permission to create RFQs.</CardDescription>
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
            <CardDescription>Return to Project Management and choose a project before creating an RFQ.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild><Link href="/project-management">Select Project</Link></Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="w-full space-y-5 px-4 py-4 sm:px-6 sm:py-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href={`/project-management/rfq?project=${encodeURIComponent(mappingId)}`} aria-label="Back to RFQs">
            <ArrowLeft className="h-6 w-6" />
          </Link>
        </Button>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 shadow-sm">
          <FileSearch className="h-4 w-4 text-white" />
        </div>
        <h1 className="text-xl font-bold">Create RFQ</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>RFQ Details</CardTitle>
          <CardDescription>Set the RFQ date and the deadline for vendors to respond.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="rfq-date">RFQ Date</Label>
              <Input id="rfq-date" type="date" value={rfqDate} max={dueDate || undefined} onChange={(e) => setRfqDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="due-date">Quote Due Date</Label>
              <Input id="due-date" type="date" value={dueDate} min={rfqDate || undefined} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>
          <div className="mt-4 space-y-2">
            <Label htmlFor="remarks">Remarks / Instructions to vendors</Label>
            <Textarea id="remarks" placeholder="Optional" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Select Items ({selectedCount} selected)</CardTitle>
          <CardDescription>Choose whole indents or individual items across one or more indents.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {indents.length ? indents.map((indent) => {
            const allSelected = indent.items.every((item) => selectedItemKeys.has(itemKey(indent.id, item.boqItemId)));
            const someSelected = !allSelected && indent.items.some((item) => selectedItemKeys.has(itemKey(indent.id, item.boqItemId)));
            const isExpanded = expandedIndents.has(indent.id);
            return (
              <div key={indent.id} className="rounded-lg border">
                <div className="flex items-center gap-2 border-b bg-muted/30 px-3 py-2">
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => toggleIndentExpanded(indent.id)}>
                    {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </Button>
                  <Checkbox
                    checked={someSelected ? "indeterminate" : allSelected}
                    onCheckedChange={(checked) => toggleIndentAll(indent, checked === true)}
                  />
                  <span className="text-sm font-semibold">{indent.indentNumber}</span>
                  <span className="text-xs text-muted-foreground">({indent.items.length} item{indent.items.length === 1 ? "" : "s"})</span>
                </div>
                {isExpanded && (
                  <div className="divide-y">
                    {indent.items.map((item) => {
                      const key = itemKey(indent.id, item.boqItemId);
                      return (
                        <label key={key} className="flex items-center gap-3 px-4 py-2 hover:bg-muted/30 cursor-pointer">
                          <Checkbox
                            checked={selectedItemKeys.has(key)}
                            onCheckedChange={(checked) => toggleItem(indent.id, item.boqItemId, checked === true)}
                          />
                          <span className="w-20 shrink-0 text-xs text-muted-foreground">{item.boqSlNo || "—"}</span>
                          <span className="flex-1 truncate text-sm">{item.description}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">{formatQuantity(toNumber(item.requestedQty))} {item.unit}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          }) : (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              No open indents with items were found for this project.{" "}
              <Link href={`/project-management/indent/new?project=${encodeURIComponent(mappingId)}`} className="text-primary underline-offset-4 hover:underline">
                Create an indent first
              </Link>.
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Select Vendors ({selectedVendorIds.size} selected)</CardTitle>
          <CardDescription>The RFQ will be sent to every vendor selected here.</CardDescription>
        </CardHeader>
        <CardContent>
          {vendors.length ? (
            <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
              {vendors.map((vendor) => (
                <label key={vendor.id} className="flex items-center gap-2.5 rounded-lg border p-2.5 hover:bg-muted/30 cursor-pointer">
                  <Checkbox
                    checked={selectedVendorIds.has(vendor.id)}
                    onCheckedChange={(checked) => toggleVendor(vendor.id, checked === true)}
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{vendor.vendorName}</p>
                    <p className="truncate text-xs text-muted-foreground">{vendor.email || "No email on file"}</p>
                  </div>
                </label>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              No active vendors found.{" "}
              <Link href="/vendor-management/vendors" className="text-primary underline-offset-4 hover:underline">Add a vendor first</Link>.
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap justify-end gap-3">
        <Button variant="outline" onClick={() => void persistRfq(false)} disabled={isSaving}>
          {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Save as Draft
        </Button>
        {canSend && (
          <Button onClick={() => void persistRfq(true)} disabled={isSaving}>
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            Send RFQ to Vendors
          </Button>
        )}
      </div>
    </main>
  );
}
