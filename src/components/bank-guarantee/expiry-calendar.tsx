"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import ExcelJS from "exceljs";
import {
  collection,
  doc,
  getDocs,
  query,
  updateDoc,
  where,
} from "firebase/firestore";
import {
  CalendarClock,
  Download,
  Loader2,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import { db } from "@/lib/firebase";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useToast } from "@/hooks/use-toast";
import {
  BG_COLLECTIONS,
  BG_PERMISSION_MODULE,
  bgLabel,
  bgStatusTone,
  daysToBgDate,
  formatBgCurrency,
  toBgDate,
  toBgDateInput,
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

const band = (days: number | null, status: string) =>
  status === "CLOSED" || status === "CANCELLED"
    ? "bg-slate-100 text-slate-600"
    : status === "CLAIM_PERIOD_ACTIVE"
      ? "bg-violet-100 text-violet-700"
      : days === null
        ? "bg-slate-100"
        : days < 0
          ? "bg-red-950 text-white"
          : days <= 7
            ? "bg-rose-100 text-rose-800"
            : days <= 30
              ? "bg-orange-100 text-orange-800"
              : days <= 90
                ? "bg-amber-100 text-amber-800"
                : "bg-blue-50 text-blue-700";
export default function BGExpiryCalendar() {
  const { user } = useAuth();
  const { can, isLoading: authLoading } = useAuthorization();
  const { toast } = useToast();
  const organizationId = user?.organizationId || "default",
    canView = can("View", `${BG_PERMISSION_MODULE}.Expiry Calendar`),
    canDecide = can(
      "Record Decision",
      `${BG_PERMISSION_MODULE}.Expiry Calendar`,
    ),
    canExport = can("Export", `${BG_PERMISSION_MODULE}.Expiry Calendar`);
  const [rows, setRows] = useState<BankGuarantee[]>([]),
    [loading, setLoading] = useState(true),
    [windowDays, setWindowDays] = useState("120"),
    [bank, setBank] = useState("ALL"),
    [project, setProject] = useState("ALL");
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const snapshot = await getDocs(
        query(
          collection(db, BG_COLLECTIONS.guarantees),
          where("organizationId", "==", organizationId),
        ),
      );
      setRows(
        snapshot.docs
          .map((item) => ({ id: item.id, ...item.data() }) as BankGuarantee)
          .filter((item) => !item.isDeleted),
      );
    } catch {
      toast({ title: "Unable to load BG calendar", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [organizationId, toast]);
  useEffect(() => {
    if (!authLoading && canView) void load();
    else if (!authLoading) setLoading(false);
  }, [authLoading, canView, load]);
  const visible = useMemo(
    () =>
      rows
        .filter((item) => {
          const days = daysToBgDate(item.currentExpiryDate);
          return (
            (bank === "ALL" || item.bankId === bank) &&
            (project === "ALL" || item.projectId === project) &&
            (windowDays === "ALL" ||
              (days !== null && days <= Number(windowDays)))
          );
        })
        .sort(
          (a, b) =>
            (toBgDate(a.currentExpiryDate)?.getTime() || 0) -
            (toBgDate(b.currentExpiryDate)?.getTime() || 0),
        ),
    [bank, project, rows, windowDays],
  );
  const decide = async (item: BankGuarantee, value: string) => {
    try {
      await updateDoc(doc(db, BG_COLLECTIONS.guarantees, item.id), {
        extensionDecision: value,
        extensionDecisionDate: new Date(),
        extensionDecisionBy: user?.id || "",
        extensionDecisionByName: user?.name || "",
        updatedAt: new Date(),
      });
      toast({ title: "Expiry decision recorded" });
      await load();
    } catch {
      toast({ title: "Unable to record decision", variant: "destructive" });
    }
  };
  const exportRows = async () => {
    const workbook = new ExcelJS.Workbook(),
      sheet = workbook.addWorksheet("BG Expiry Calendar");
    sheet.columns = [
      { header: "BG Number", key: "number", width: 24 },
      { header: "Bank", key: "bank", width: 22 },
      { header: "Beneficiary", key: "beneficiary", width: 28 },
      { header: "Project", key: "project", width: 25 },
      { header: "Amount", key: "amount", width: 18 },
      { header: "Expiry", key: "expiry", width: 15 },
      { header: "Claim Expiry", key: "claim", width: 15 },
      { header: "Days", key: "days", width: 10 },
      { header: "Decision", key: "decision", width: 24 },
      { header: "Status", key: "status", width: 24 },
    ];
    visible.forEach((item) =>
      sheet.addRow({
        number: item.bankBgNumber,
        bank: item.bankName,
        beneficiary: item.beneficiaryName,
        project: item.projectName,
        amount: item.currentAmount,
        expiry: toBgDateInput(item.currentExpiryDate),
        claim: toBgDateInput(item.currentClaimExpiryDate),
        days: daysToBgDate(item.currentExpiryDate),
        decision: bgLabel(item.extensionDecision),
        status: bgLabel(item.status),
      }),
    );
    const buffer = await workbook.xlsx.writeBuffer(),
      url = URL.createObjectURL(new Blob([buffer]));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "bg-expiry-calendar.xlsx";
    anchor.click();
    URL.revokeObjectURL(url);
  };
  if (authLoading || loading)
    return (
      <div className="flex min-h-[45vh] items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin" />
      </div>
    );
  if (!canView)
    return (
      <Card>
        <CardHeader>
          <CardTitle>Access Denied</CardTitle>
        </CardHeader>
        <CardContent className="flex justify-center py-8">
          <ShieldAlert className="h-12 w-12 text-destructive" />
        </CardContent>
      </Card>
    );
  return (
    <div className="space-y-4">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <CalendarClock className="h-6 w-6 text-indigo-600" />
            BG Expiry Calendar
          </h1>
          <p className="text-sm text-muted-foreground">
            Validity, claim periods, owner decisions, and extension/cancellation
            actions.
          </p>
        </div>
        <div className="flex gap-2">
          {canExport && (
            <Button variant="outline" onClick={() => void exportRows()}>
              <Download className="mr-2 h-4 w-4" />
              Export
            </Button>
          )}
          <Button variant="outline" size="icon" onClick={() => void load()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <Card>
        <CardContent className="grid gap-2 p-3 sm:grid-cols-3">
          <Select value={windowDays} onValueChange={setWindowDays}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Within 7 days</SelectItem>
              <SelectItem value="30">Within 30 days</SelectItem>
              <SelectItem value="60">Within 60 days</SelectItem>
              <SelectItem value="90">Within 90 days</SelectItem>
              <SelectItem value="120">Within 120 days</SelectItem>
              <SelectItem value="ALL">All BGs</SelectItem>
            </SelectContent>
          </Select>
          <Select value={bank} onValueChange={setBank}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Banks</SelectItem>
              {Array.from(
                new Map(
                  rows.map((item) => [item.bankId, item.bankName]),
                ).entries(),
              ).map(([id, name]) => (
                <SelectItem key={id} value={id}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={project} onValueChange={setProject}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Projects</SelectItem>
              {Array.from(
                new Map(
                  rows.map((item) => [item.projectId, item.projectName]),
                ).entries(),
              ).map(([id, name]) => (
                <SelectItem key={id} value={id}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>BG</TableHead>
                  <TableHead>Beneficiary / Project</TableHead>
                  <TableHead>Bank</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Expiry</TableHead>
                  <TableHead>Claim Expiry</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="min-w-60">Required Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((item) => {
                  const days = daysToBgDate(item.currentExpiryDate);
                  return (
                    <TableRow key={item.id}>
                      <TableCell>
                        <Link
                          href={`/bank-guarantee/${item.id}`}
                          className="font-medium text-indigo-700 hover:underline"
                        >
                          {item.bankBgNumber}
                        </Link>
                      </TableCell>
                      <TableCell>
                        {item.beneficiaryName}
                        <p className="text-xs text-muted-foreground">
                          {item.projectName}
                        </p>
                      </TableCell>
                      <TableCell>{item.bankName}</TableCell>
                      <TableCell className="text-right">
                        {formatBgCurrency(item.currentAmount, item.currency)}
                      </TableCell>
                      <TableCell>
                        <Badge className={band(days, item.status)}>
                          {toBgDateInput(item.currentExpiryDate)} · {days}d
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {toBgDateInput(item.currentClaimExpiryDate)}
                        <p className="text-xs text-muted-foreground">
                          {daysToBgDate(item.currentClaimExpiryDate)} days
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
                        {canDecide ? (
                          <Select
                            value={item.extensionDecision || "NO_ACTION_YET"}
                            onValueChange={(value) => void decide(item, value)}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {[
                                "EXTENSION_REQUIRED",
                                "CANCELLATION_REQUIRED",
                                "REPLACEMENT_REQUIRED",
                                "NO_ACTION_YET",
                                "UNDER_CLIENT_CONFIRMATION",
                              ].map((value) => (
                                <SelectItem key={value} value={value}>
                                  {bgLabel(value)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          bgLabel(item.extensionDecision || "NO_ACTION_YET")
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {!visible.length && (
                  <TableRow>
                    <TableCell
                      colSpan={8}
                      className="h-28 text-center text-muted-foreground"
                    >
                      No BGs match this expiry view.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
