"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import ExcelJS from "exceljs";
import { collection, getDocs, query, where } from "firebase/firestore";
import {
  Check,
  Download,
  Eye,
  FilePlus2,
  Loader2,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  X,
} from "lucide-react";
import { db } from "@/lib/firebase";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useToast } from "@/hooks/use-toast";
import { decideBGRequest, type BGActor } from "@/lib/bank-guarantee-service";
import {
  BG_COLLECTIONS,
  BG_PERMISSION_MODULE,
  bgLabel,
  bgStatusTone,
  daysToBgDate,
  formatBgCurrency,
  toBgDate,
  toBgDateInput,
  type BGRequest,
  type BankGuarantee,
} from "@/lib/bank-guarantee";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

type Decision = {
  request: BGRequest;
  action: "APPROVE" | "REJECT" | "RETURN";
} | null;

export default function BGRegister({
  mode = "register",
}: {
  mode?: "register" | "approvals";
}) {
  const { user } = useAuth();
  const { can, isLoading: authLoading } = useAuthorization();
  const { toast } = useToast();
  const [requests, setRequests] = useState<BGRequest[]>([]);
  const [guarantees, setGuarantees] = useState<BankGuarantee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ALL");
  const [decision, setDecision] = useState<Decision>(null);
  const [comments, setComments] = useState("");
  const [working, setWorking] = useState(false);
  const resource = mode === "approvals" ? "Pending Approvals" : "BG Register";
  const canView = can("View", `${BG_PERMISSION_MODULE}.${resource}`);
  const canAdd = can("Add", `${BG_PERMISSION_MODULE}.BG Requests`);
  const canApprove = can(
    "Approve",
    `${BG_PERMISSION_MODULE}.Pending Approvals`,
  );
  const canReject = can("Reject", `${BG_PERMISSION_MODULE}.Pending Approvals`);
  const canReturn = can("Return", `${BG_PERMISSION_MODULE}.Pending Approvals`);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const scoped = (name: string) =>
        user?.role === "Super Admin" || !user?.organizationId
          ? collection(db, name)
          : query(
              collection(db, name),
              where("organizationId", "==", user.organizationId),
            );
      const [requestSnap, bgSnap] = await Promise.all([
        getDocs(scoped(BG_COLLECTIONS.requests)),
        getDocs(scoped(BG_COLLECTIONS.guarantees)),
      ]);
      setRequests(
        requestSnap.docs
          .map((item) => ({ id: item.id, ...item.data() }) as BGRequest)
          .filter((item) => !item.isDeleted),
      );
      setGuarantees(
        bgSnap.docs
          .map((item) => ({ id: item.id, ...item.data() }) as BankGuarantee)
          .filter((item) => !item.isDeleted),
      );
    } catch (error) {
      console.error(error);
      toast({ title: "Unable to load BG register", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast, user?.organizationId, user?.role]);
  useEffect(() => {
    if (!authLoading && canView) void load();
    else if (!authLoading) setLoading(false);
  }, [authLoading, canView, load]);
  const token = search.trim().toLowerCase();
  const visibleRequests = useMemo(
    () =>
      requests
        .filter(
          (item) =>
            (mode !== "approvals" || item.status.startsWith("PENDING_")) &&
            (status === "ALL" || item.status === status) &&
            (!token ||
              `${item.referenceNumber} ${item.beneficiaryName} ${item.projectName} ${item.contractNumber} ${item.preferredBankName} ${item.status}`
                .toLowerCase()
                .includes(token)),
        )
        .sort(
          (a, b) =>
            (toBgDate(b.requestDate)?.getTime() || 0) -
            (toBgDate(a.requestDate)?.getTime() || 0),
        ),
    [mode, requests, status, token],
  );
  const visibleGuarantees = useMemo(
    () =>
      guarantees
        .filter(
          (item) =>
            (status === "ALL" || item.status === status) &&
            (!token ||
              `${item.bankBgNumber} ${item.internalReferenceNumber} ${item.beneficiaryName} ${item.projectName} ${item.bankName} ${item.status}`
                .toLowerCase()
                .includes(token)),
        )
        .sort(
          (a, b) =>
            (toBgDate(b.issueDate)?.getTime() || 0) -
            (toBgDate(a.issueDate)?.getTime() || 0),
        ),
    [guarantees, status, token],
  );
  const decide = async () => {
    if (!decision || !user) return;
    setWorking(true);
    try {
      const actor: BGActor = {
        userId: user.id,
        userName: user.name,
        role: user.role,
        organizationId: user.organizationId || "default",
        organizationName: user.organizationName,
      };
      const next = await decideBGRequest(
        decision.request.id,
        decision.action,
        comments,
        actor,
      );
      toast({
        title: `BG request ${decision.action.toLowerCase()}d`,
        description: `${decision.request.referenceNumber} · ${bgLabel(next)}`,
      });
      setDecision(null);
      setComments("");
      await load();
    } catch (error) {
      toast({
        title: "Decision failed",
        description: error instanceof Error ? error.message : "",
        variant: "destructive",
      });
    } finally {
      setWorking(false);
    }
  };
  const exportRows = async () => {
    const workbook = new ExcelJS.Workbook(),
      register = workbook.addWorksheet("BG Register"),
      requestSheet = workbook.addWorksheet("BG Requests");
    register.columns = [
      ["BG Number", "number", 24],
      ["Internal Reference", "reference", 25],
      ["Bank", "bank", 22],
      ["Beneficiary", "beneficiary", 28],
      ["Project", "project", 25],
      ["Purpose", "purpose", 25],
      ["Current Amount", "amount", 18],
      ["Issue Date", "issue", 15],
      ["Expiry Date", "expiry", 15],
      ["Claim Expiry", "claim", 15],
      ["Status", "status", 24],
    ].map(([header, key, width]) => ({
      header: String(header),
      key: String(key),
      width: Number(width),
    }));
    visibleGuarantees.forEach((item) =>
      register.addRow({
        number: item.bankBgNumber,
        reference: item.internalReferenceNumber,
        bank: item.bankName,
        beneficiary: item.beneficiaryName,
        project: item.projectName,
        purpose: bgLabel(item.purpose),
        amount: item.currentAmount,
        issue: toBgDateInput(item.issueDate),
        expiry: toBgDateInput(item.currentExpiryDate),
        claim: toBgDateInput(item.currentClaimExpiryDate),
        status: bgLabel(item.status),
      }),
    );
    requestSheet.columns = [
      ["Reference", "reference", 25],
      ["Beneficiary", "beneficiary", 28],
      ["Project", "project", 25],
      ["Contract", "contract", 22],
      ["Bank", "bank", 22],
      ["Amount", "amount", 18],
      ["Margin", "margin", 18],
      ["Status", "status", 25],
    ].map(([header, key, width]) => ({
      header: String(header),
      key: String(key),
      width: Number(width),
    }));
    visibleRequests.forEach((item) =>
      requestSheet.addRow({
        reference: item.referenceNumber,
        beneficiary: item.beneficiaryName,
        project: item.projectName,
        contract: item.contractNumber,
        bank: item.preferredBankName,
        amount: item.requestedAmount,
        margin: item.requiredMarginAmount,
        status: bgLabel(item.status),
      }),
    );
    [register, requestSheet].forEach((sheet) => {
      sheet.getRow(1).font = { bold: true };
      sheet.views = [{ state: "frozen", ySplit: 1 }];
    });
    const buffer = await workbook.xlsx.writeBuffer(),
      url = URL.createObjectURL(new Blob([buffer]));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `bank-guarantee-register-${new Date().toISOString().slice(0, 10)}.xlsx`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  if (authLoading || loading)
    return (
      <div className="flex min-h-[45vh] items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-indigo-600" />
      </div>
    );
  if (!canView)
    return (
      <Card>
        <CardHeader>
          <CardTitle>Access Denied</CardTitle>
          <CardDescription>You cannot view this BG workspace.</CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center py-8">
          <ShieldAlert className="h-14 w-14 text-destructive" />
        </CardContent>
      </Card>
    );
  const RequestTable = (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Request</TableHead>
                <TableHead>Beneficiary / Project</TableHead>
                <TableHead>Bank / Contract</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Margin</TableHead>
                <TableHead>Validity</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleRequests.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <p className="font-medium">{item.referenceNumber}</p>
                    <p className="text-xs text-muted-foreground">
                      {bgLabel(item.purpose)}
                    </p>
                  </TableCell>
                  <TableCell>
                    {item.beneficiaryName}
                    <p className="text-xs text-muted-foreground">
                      {item.projectName}
                    </p>
                  </TableCell>
                  <TableCell>
                    {item.preferredBankName}
                    <p className="text-xs text-muted-foreground">
                      {item.contractNumber || item.contractReference || "-"}
                    </p>
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {formatBgCurrency(item.requestedAmount, item.currency)}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatBgCurrency(item.requiredMarginAmount, item.currency)}
                    <p className="text-xs text-muted-foreground">
                      {item.marginPercentage}% {bgLabel(item.marginType)}
                    </p>
                  </TableCell>
                  <TableCell>
                    <p>Exp {toBgDateInput(item.proposedExpiryDate)}</p>
                    <p className="text-xs text-muted-foreground">
                      Claim {toBgDateInput(item.proposedClaimExpiryDate)}
                    </p>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={bgStatusTone(item.status)}
                    >
                      {bgLabel(item.status)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button asChild variant="ghost" size="icon">
                        <Link href={`/bank-guarantee/${item.id}`}>
                          <Eye className="h-4 w-4" />
                        </Link>
                      </Button>
                      {mode === "approvals" && canApprove && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-emerald-700"
                          onClick={() =>
                            setDecision({ request: item, action: "APPROVE" })
                          }
                        >
                          <Check className="h-4 w-4" />
                        </Button>
                      )}
                      {mode === "approvals" && canReturn && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-amber-700"
                          onClick={() =>
                            setDecision({ request: item, action: "RETURN" })
                          }
                        >
                          <RotateCcw className="h-4 w-4" />
                        </Button>
                      )}
                      {mode === "approvals" && canReject && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-rose-700"
                          onClick={() =>
                            setDecision({ request: item, action: "REJECT" })
                          }
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {!visibleRequests.length && (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="h-28 text-center text-muted-foreground"
                  >
                    No BG requests match this view.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
  const GuaranteeTable = (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>BG</TableHead>
                <TableHead>Bank / Beneficiary</TableHead>
                <TableHead>Project / Purpose</TableHead>
                <TableHead className="text-right">Current Amount</TableHead>
                <TableHead className="text-right">Margin</TableHead>
                <TableHead>Expiry / Claim</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleGuarantees.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <p className="font-medium">{item.bankBgNumber}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.internalReferenceNumber}
                    </p>
                  </TableCell>
                  <TableCell>
                    {item.bankName}
                    <p className="text-xs text-muted-foreground">
                      {item.beneficiaryName}
                    </p>
                  </TableCell>
                  <TableCell>
                    {item.projectName}
                    <p className="text-xs text-muted-foreground">
                      {bgLabel(item.purpose)}
                    </p>
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {formatBgCurrency(item.currentAmount, item.currency)}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatBgCurrency(item.requiredMarginAmount, item.currency)}
                  </TableCell>
                  <TableCell>
                    <p>
                      {toBgDateInput(item.currentExpiryDate)} (
                      {daysToBgDate(item.currentExpiryDate)}d)
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Claim {toBgDateInput(item.currentClaimExpiryDate)}
                    </p>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={bgStatusTone(item.status)}
                    >
                      {bgLabel(item.status)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Button asChild variant="ghost" size="icon">
                      <Link href={`/bank-guarantee/${item.id}`}>
                        <Eye className="h-4 w-4" />
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {!visibleGuarantees.length && (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="h-28 text-center text-muted-foreground"
                  >
                    No issued Bank Guarantees match this view.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
  return (
    <div className="space-y-4">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-2xl font-bold">
            {mode === "approvals" ? "Pending BG Approvals" : "BG Register"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {mode === "approvals"
              ? "Project, commercial, finance, and director-stage decisions."
              : "Complete request and issued Bank Guarantee register."}
          </p>
        </div>
        <div className="flex gap-2">
          {canAdd && (
            <Button asChild>
              <Link href="/bank-guarantee/new">
                <FilePlus2 className="mr-2 h-4 w-4" />
                New Request
              </Link>
            </Button>
          )}
          <Button variant="outline" onClick={() => void exportRows()}>
            <Download className="mr-2 h-4 w-4" />
            Export
          </Button>
          <Button variant="outline" size="icon" onClick={() => void load()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Requests</p>
            <p className="text-2xl font-bold">{visibleRequests.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Issued BGs</p>
            <p className="text-2xl font-bold">{visibleGuarantees.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Active Exposure</p>
            <p className="text-xl font-bold text-indigo-700">
              {formatBgCurrency(
                visibleGuarantees
                  .filter(
                    (item) => !["CLOSED", "CANCELLED"].includes(item.status),
                  )
                  .reduce((sum, item) => sum + item.currentAmount, 0),
              )}
            </p>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardContent className="flex flex-col gap-2 p-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search BG, beneficiary, project, bank, contract…"
            />
          </div>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="sm:w-60">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All statuses</SelectItem>
              {Array.from(
                new Set([
                  ...requests.map((item) => item.status),
                  ...guarantees.map((item) => item.status),
                ]),
              )
                .sort()
                .map((item) => (
                  <SelectItem key={item} value={item}>
                    {bgLabel(item)}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>
      {mode === "approvals" ? (
        RequestTable
      ) : (
        <Tabs defaultValue="guarantees">
          <TabsList>
            <TabsTrigger value="guarantees">
              Issued BGs ({visibleGuarantees.length})
            </TabsTrigger>
            <TabsTrigger value="requests">
              Requests ({visibleRequests.length})
            </TabsTrigger>
          </TabsList>
          <TabsContent value="guarantees">{GuaranteeTable}</TabsContent>
          <TabsContent value="requests">{RequestTable}</TabsContent>
        </Tabs>
      )}
      <Dialog
        open={Boolean(decision)}
        onOpenChange={(open) => {
          if (!open && !working) setDecision(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {decision
                ? `${bgLabel(decision.action)} BG request`
                : "BG decision"}
            </DialogTitle>
            <DialogDescription>
              {decision?.request.referenceNumber} ·{" "}
              {decision?.request.beneficiaryName} ·{" "}
              {formatBgCurrency(decision?.request.requestedAmount || 0)}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={comments}
            onChange={(event) => setComments(event.target.value)}
            placeholder={
              decision?.action === "APPROVE"
                ? "Approval conditions (optional)"
                : "Decision reason (required)"
            }
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDecision(null)}>
              Cancel
            </Button>
            <Button
              disabled={
                working || (decision?.action !== "APPROVE" && !comments.trim())
              }
              onClick={() => void decide()}
            >
              {working && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
