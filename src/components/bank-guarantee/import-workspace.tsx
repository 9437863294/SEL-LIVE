"use client";

import { useMemo, useState } from "react";
import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  Timestamp,
  where,
  writeBatch,
} from "firebase/firestore";
import { FileSpreadsheet, Loader2, ShieldAlert, Upload } from "lucide-react";
import { db } from "@/lib/firebase";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useToast } from "@/hooks/use-toast";
import {
  BG_COLLECTIONS,
  BG_PERMISSION_MODULE,
  calculateBgMargin,
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
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
type ImportRow = {
  row: number;
  bankBgNumber: string;
  internalReference: string;
  bankName: string;
  beneficiaryName: string;
  projectName: string;
  purpose: string;
  currentAmount: number;
  currency: string;
  issueDate: string;
  expiryDate: string;
  claimExpiryDate: string;
  fdMargin: number;
  cashMargin: number;
  commission: number;
  status: string;
  errors: string[];
};
const text = (value: unknown) => String(value ?? "").trim(),
  number = (value: unknown) =>
    Number(String(value ?? "").replace(/[,₹$]/g, "")) || 0,
  date = (value: unknown) => {
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    if (typeof value === "number")
      return new Date(Date.UTC(1899, 11, 30) + value * 86400000)
        .toISOString()
        .slice(0, 10);
    const parsed = new Date(String(value || ""));
    return Number.isNaN(parsed.getTime())
      ? ""
      : parsed.toISOString().slice(0, 10);
  };
export default function BGImportWorkspace() {
  const { user } = useAuth();
  const { can, isLoading } = useAuthorization();
  const { toast } = useToast();
  const organizationId = user?.organizationId || "default",
    canView = can("View", `${BG_PERMISSION_MODULE}.Import & Reconciliation`),
    canImport = can(
      "Import",
      `${BG_PERMISSION_MODULE}.Import & Reconciliation`,
    );
  const [rows, setRows] = useState<ImportRow[]>([]),
    [fileName, setFileName] = useState(""),
    [working, setWorking] = useState(false);
  const valid = useMemo(() => rows.filter((row) => !row.errors.length), [rows]);
  const parse = async (file: File) => {
    setWorking(true);
    try {
      const ExcelJS = (await import("exceljs")).default,
        workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load((await file.arrayBuffer()) as never);
      const sheet = workbook.worksheets[0];
      if (!sheet) throw new Error("Workbook has no worksheet.");
      const headers = new Map<string, number>();
      sheet
        .getRow(1)
        .eachCell((cell, column) =>
          headers.set(text(cell.value).toLowerCase(), column),
        );
      const find = (...labels: string[]) =>
          labels
            .map((label) => headers.get(label.toLowerCase()))
            .find(Boolean) || 0,
        value = (row: number, ...labels: string[]) =>
          sheet.getRow(row).getCell(find(...labels)).value,
        parsed: ImportRow[] = [];
      for (let index = 2; index <= sheet.rowCount; index++) {
        const bankBgNumber = text(
          value(index, "Bank BG Number", "BG Number", "BG No"),
        );
        if (!bankBgNumber && !text(value(index, "Bank"))) continue;
        const next: ImportRow = {
          row: index,
          bankBgNumber,
          internalReference:
            text(value(index, "Internal Reference", "Reference Number")) ||
            `BG/MIG/${String(index).padStart(5, "0")}`,
          bankName: text(value(index, "Bank")),
          beneficiaryName: text(value(index, "Beneficiary", "Client")),
          projectName: text(value(index, "Project")),
          purpose: text(value(index, "Purpose")) || "OTHER",
          currentAmount: number(
            value(index, "Current Amount", "BG Amount", "Issued Amount"),
          ),
          currency: text(value(index, "Currency")) || "INR",
          issueDate: date(value(index, "Issue Date")),
          expiryDate: date(value(index, "Expiry Date", "Current Expiry Date")),
          claimExpiryDate: date(value(index, "Claim Expiry Date")),
          fdMargin: number(value(index, "FD Margin")),
          cashMargin: number(value(index, "Cash Margin")),
          commission: number(value(index, "Commission", "Bank Commission")),
          status:
            text(value(index, "Status")).toUpperCase().replace(/\W+/g, "_") ||
            "ACTIVE",
          errors: [],
        };
        if (!next.bankBgNumber) next.errors.push("BG number required");
        if (!next.bankName) next.errors.push("Bank required");
        if (!next.beneficiaryName) next.errors.push("Beneficiary required");
        if (!next.projectName) next.errors.push("Project required");
        if (next.currentAmount <= 0)
          next.errors.push("Amount must be positive");
        if (!next.issueDate || !next.expiryDate || !next.claimExpiryDate)
          next.errors.push("Issue, expiry and claim dates required");
        if (next.expiryDate && next.expiryDate <= next.issueDate)
          next.errors.push("Expiry must follow issue");
        if (next.claimExpiryDate && next.claimExpiryDate < next.expiryDate)
          next.errors.push("Claim date before expiry");
        parsed.push(next);
      }
      const seen = new Set<string>();
      parsed.forEach((row) => {
        const key = `${row.bankName}|${row.bankBgNumber}`.toLowerCase();
        if (seen.has(key)) row.errors.push("Duplicate in workbook");
        seen.add(key);
      });
      const existing = await getDocs(
          query(
            collection(db, BG_COLLECTIONS.guarantees),
            where("organizationId", "==", organizationId),
          ),
        ),
        existingKeys = new Set(
          existing.docs.map((item) =>
            `${item.data().bankName}|${item.data().bankBgNumber}`.toLowerCase(),
          ),
        );
      parsed.forEach((row) => {
        if (
          existingKeys.has(`${row.bankName}|${row.bankBgNumber}`.toLowerCase())
        )
          row.errors.push("Already exists");
      });
      setRows(parsed);
      setFileName(file.name);
      toast({
        title: "BG workbook validated",
        description: `${parsed.filter((row) => !row.errors.length).length} valid, ${parsed.filter((row) => row.errors.length).length} exceptions.`,
      });
    } catch (error) {
      toast({
        title: "Unable to read BG workbook",
        description: error instanceof Error ? error.message : "",
        variant: "destructive",
      });
    } finally {
      setWorking(false);
    }
  };
  const importRows = async () => {
    if (!user || !valid.length) return;
    setWorking(true);
    try {
      for (let offset = 0; offset < valid.length; offset += 150) {
        const batch = writeBatch(db);
        valid.slice(offset, offset + 150).forEach((row) => {
          const reference = doc(collection(db, BG_COLLECTIONS.guarantees)),
            now = Timestamp.now(),
            margin = row.fdMargin + row.cashMargin;
          batch.set(reference, {
            organizationId,
            organizationName: user.organizationName || "",
            requestId: "",
            requestReference: row.internalReference,
            internalReferenceNumber: row.internalReference,
            bankBgNumber: row.bankBgNumber,
            bankId: row.bankName.toLowerCase().replace(/\W+/g, "-"),
            bankName: row.bankName,
            beneficiaryId: row.beneficiaryName
              .toLowerCase()
              .replace(/\W+/g, "-"),
            beneficiaryName: row.beneficiaryName,
            projectId: row.projectName.toLowerCase().replace(/\W+/g, "-"),
            projectName: row.projectName,
            purpose: row.purpose,
            currency: row.currency,
            exchangeRate: 1,
            originalAmount: row.currentAmount,
            currentAmount: row.currentAmount,
            baseCurrencyAmount: row.currentAmount,
            issueDate: Timestamp.fromDate(
              new Date(`${row.issueDate}T12:00:00`),
            ),
            startDate: Timestamp.fromDate(
              new Date(`${row.issueDate}T12:00:00`),
            ),
            originalExpiryDate: Timestamp.fromDate(
              new Date(`${row.expiryDate}T12:00:00`),
            ),
            currentExpiryDate: Timestamp.fromDate(
              new Date(`${row.expiryDate}T12:00:00`),
            ),
            originalClaimExpiryDate: Timestamp.fromDate(
              new Date(`${row.claimExpiryDate}T12:00:00`),
            ),
            currentClaimExpiryDate: Timestamp.fromDate(
              new Date(`${row.claimExpiryDate}T12:00:00`),
            ),
            claimPeriodDays: Math.max(
              0,
              Math.round(
                (new Date(row.claimExpiryDate).getTime() -
                  new Date(row.expiryDate).getTime()) /
                  86400000,
              ),
            ),
            autoExtensionClause: false,
            marginPercentage: row.currentAmount
              ? (margin / row.currentAmount) * 100
              : 0,
            requiredMarginAmount: margin,
            fdMarginAmount: row.fdMargin,
            cashMarginAmount: row.cashMargin,
            otherCollateralAmount: 0,
            openingCommission: row.commission,
            extensionCommission: 0,
            amendmentCommission: 0,
            internalCommission: row.commission,
            bankCommission: row.commission,
            commissionDifference: 0,
            gstAmount: 0,
            otherCharges: 0,
            totalCharges: row.commission,
            originalReceived: false,
            numberOfOriginals: 0,
            numberOfCopies: 0,
            originalDispatched: false,
            beneficiaryAcknowledged: false,
            originalReturned: false,
            currentCustodian: "Unknown",
            invocationAmount: 0,
            marginReleasedAmount: 0,
            status: row.status,
            extensionDecision: "NO_ACTION_YET",
            bankCancellationConfirmed: ["CLOSED", "CANCELLED"].includes(
              row.status,
            ),
            documentComplete: false,
            migratedFrom: fileName,
            createdBy: user.id,
            createdByName: user.name,
            createdAt: now,
            updatedBy: user.id,
            updatedByName: user.name,
            updatedAt: now,
            isDeleted: false,
          });
          batch.set(doc(collection(db, BG_COLLECTIONS.audit)), {
            organizationId,
            module: BG_PERMISSION_MODULE,
            recordType: "IMPORT",
            recordId: reference.id,
            bgId: reference.id,
            action: "BG_IMPORTED",
            summary: `${row.bankBgNumber} imported from ${fileName}`,
            newValue: { sourceRow: row.row, currentAmount: row.currentAmount },
            userId: user.id,
            userName: user.name,
            userRole: user.role || "",
            page: `/bank-guarantee/${reference.id}`,
            createdAt: serverTimestamp(),
          });
        });
        await batch.commit();
      }
      toast({ title: `${valid.length} Bank Guarantees imported` });
      setRows([]);
      setFileName("");
    } catch (error) {
      toast({
        title: "BG import failed",
        description: error instanceof Error ? error.message : "",
        variant: "destructive",
      });
    } finally {
      setWorking(false);
    }
  };
  if (isLoading) return <div className="min-h-[40vh]" />;
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
      <div>
        <h1 className="text-2xl font-bold">BG Import & Reconciliation</h1>
        <p className="text-sm text-muted-foreground">
          Validate legacy Bank Guarantee workbooks before activating clean
          organization-scoped records.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-emerald-700" />
            Upload BG Workbook
          </CardTitle>
          <CardDescription>
            Recognized headers include BG Number, Bank, Beneficiary, Project,
            Amount, Issue Date, Expiry Date, Claim Expiry Date, FD Margin, Cash
            Margin, Commission, and Status.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row">
          <Input
            type="file"
            accept=".xlsx,.xls"
            disabled={!canImport || working}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void parse(file);
              event.target.value = "";
            }}
          />
          <Button
            disabled={!canImport || !valid.length || working}
            onClick={() => void importRows()}
          >
            {working ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="mr-2 h-4 w-4" />
            )}
            Import {valid.length} Valid Rows
          </Button>
        </CardContent>
      </Card>
      {rows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Validation Result</CardTitle>
            <CardDescription>
              {valid.length} valid · {rows.length - valid.length} exceptions
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="max-h-[520px] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Row</TableHead>
                    <TableHead>BG Number</TableHead>
                    <TableHead>Bank / Beneficiary</TableHead>
                    <TableHead>Project</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Dates</TableHead>
                    <TableHead>Validation</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.row}>
                      <TableCell>{row.row}</TableCell>
                      <TableCell className="font-medium">
                        {row.bankBgNumber}
                      </TableCell>
                      <TableCell>
                        {row.bankName}
                        <p className="text-xs text-muted-foreground">
                          {row.beneficiaryName}
                        </p>
                      </TableCell>
                      <TableCell>{row.projectName}</TableCell>
                      <TableCell className="text-right">
                        {row.currentAmount.toLocaleString("en-IN")}
                      </TableCell>
                      <TableCell>
                        {row.issueDate}
                        <p className="text-xs text-muted-foreground">
                          Exp {row.expiryDate} · Claim {row.claimExpiryDate}
                        </p>
                      </TableCell>
                      <TableCell>
                        {row.errors.length ? (
                          <div className="flex flex-wrap gap-1">
                            {row.errors.map((error) => (
                              <Badge key={error} variant="destructive">
                                {error}
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          <Badge className="bg-emerald-600">Valid</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
