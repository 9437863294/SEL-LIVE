"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ExcelJS from "exceljs";
import { collection, getDocs, query, where } from "firebase/firestore";
import { Download, Loader2, RefreshCw, ShieldAlert } from "lucide-react";
import { db } from "@/lib/firebase";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useToast } from "@/hooks/use-toast";
import {
  ACTIVE_ASSIGNMENT_STATUSES,
  FD_COLLECTIONS,
  assignmentOutstanding,
  type FDAssignment,
} from "@/lib/fixed-deposit";
import {
  BG_COLLECTIONS,
  BG_PERMISSION_MODULE,
  bgLabel,
  daysToBgDate,
  formatBgCurrency,
  toBgDateInput,
  type BankGuarantee,
} from "@/lib/bank-guarantee";
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
type Row = Record<string, any> & { id?: string };
type Dataset = { label: string; columns: Array<[string, string]>; rows: Row[] };
const reports = [
  ["register", "BG Register"],
  ["bank", "Bank-wise BG Utilisation"],
  ["project", "Project-wise BG Exposure"],
  ["beneficiary", "Beneficiary-wise BG"],
  ["purpose", "Purpose-wise BG"],
  ["expiry", "Expiry Report"],
  ["extension", "Extension Report"],
  ["cancellation", "Cancellation Report"],
  ["fd", "FD Margin Report"],
  ["cash", "Cash Margin Report"],
  ["commission", "Commission Report"],
  ["invocation", "Invocation Report"],
  ["movement", "Original Movement Report"],
  ["exception", "Exception Report"],
] as const;
export default function BGReports() {
  const { user } = useAuth();
  const { can, isLoading: authLoading } = useAuthorization();
  const { toast } = useToast();
  const organizationId = user?.organizationId || "default",
    canView = can("View", `${BG_PERMISSION_MODULE}.Reports`),
    canExport = can("Export", `${BG_PERMISSION_MODULE}.Reports`);
  const [data, setData] = useState<Record<string, Row[]>>({}),
    [type, setType] = useState<string>("register"),
    [loading, setLoading] = useState(true),
    [exporting, setExporting] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const names = [
        BG_COLLECTIONS.guarantees,
        BG_COLLECTIONS.bankLimits,
        BG_COLLECTIONS.extensions,
        BG_COLLECTIONS.cancellations,
        FD_COLLECTIONS.assignments,
        BG_COLLECTIONS.cashMargins,
        BG_COLLECTIONS.commissions,
        BG_COLLECTIONS.invocations,
        BG_COLLECTIONS.movements,
      ];
      const snapshots = await Promise.all(
        names.map((name) =>
          getDocs(
            query(
              collection(db, name),
              where("organizationId", "==", organizationId),
            ),
          ),
        ),
      );
      setData(
        Object.fromEntries(
          names.map((name, index) => [
            name,
            snapshots[index].docs.map((item) => ({
              id: item.id,
              ...item.data(),
            })),
          ]),
        ),
      );
    } catch {
      toast({ title: "Unable to load BG reports", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [organizationId, toast]);
  useEffect(() => {
    if (!authLoading && canView) void load();
    else if (!authLoading) setLoading(false);
  }, [authLoading, canView, load]);
  const datasets = useMemo<Record<string, Dataset>>(() => {
    const bgs = (data[BG_COLLECTIONS.guarantees] ||
        []) as unknown as BankGuarantee[],
      limits = data[BG_COLLECTIONS.bankLimits] || [],
      extensions = data[BG_COLLECTIONS.extensions] || [],
      cancellations = data[BG_COLLECTIONS.cancellations] || [],
      assignments = (data[FD_COLLECTIONS.assignments] ||
        []) as unknown as FDAssignment[],
      cash = data[BG_COLLECTIONS.cashMargins] || [],
      commissions = data[BG_COLLECTIONS.commissions] || [],
      invocations = data[BG_COLLECTIONS.invocations] || [],
      movements = data[BG_COLLECTIONS.movements] || [];
    const group = (key: keyof BankGuarantee) =>
      Array.from(
        bgs
          .reduce((map, item) => {
            const name = String(item[key] || "Unassigned"),
              row = map.get(name) || {
                name,
                count: 0,
                activeAmount: 0,
                expiredAmount: 0,
                marginAmount: 0,
              };
            row.count++;
            if (!["CLOSED", "CANCELLED"].includes(item.status))
              row.activeAmount += item.currentAmount;
            if ((daysToBgDate(item.currentExpiryDate) || 0) < 0)
              row.expiredAmount += item.currentAmount;
            row.marginAmount += item.requiredMarginAmount;
            map.set(name, row);
            return map;
          }, new Map<string, Row>())
          .values(),
      );
    const register = bgs.map((item) => ({
      bgNumber: item.bankBgNumber,
      bank: item.bankName,
      beneficiary: item.beneficiaryName,
      project: item.projectName,
      purpose: bgLabel(item.purpose),
      amount: item.currentAmount,
      issueDate: toBgDateInput(item.issueDate),
      expiryDate: toBgDateInput(item.currentExpiryDate),
      claimExpiry: toBgDateInput(item.currentClaimExpiryDate),
      status: bgLabel(item.status),
    }));
    const exceptions: Row[] = [];
    bgs.forEach((item) => {
      if (
        (daysToBgDate(item.currentExpiryDate) || 0) < 0 &&
        !["CLOSED", "CANCELLED"].includes(item.status)
      )
        exceptions.push({
          bgNumber: item.bankBgNumber,
          exception: "Expired without closure",
          amount: item.currentAmount,
          severity: "High",
        });
      if (
        item.requiredMarginAmount >
        item.fdMarginAmount + item.cashMarginAmount + item.otherCollateralAmount
      )
        exceptions.push({
          bgNumber: item.bankBgNumber,
          exception: "Margin shortfall",
          amount:
            item.requiredMarginAmount -
            item.fdMarginAmount -
            item.cashMarginAmount -
            item.otherCollateralAmount,
          severity: "Critical",
        });
      if (item.originalDispatched && !item.beneficiaryAcknowledged)
        exceptions.push({
          bgNumber: item.bankBgNumber,
          exception: "Beneficiary acknowledgement pending",
          amount: item.currentAmount,
          severity: "Medium",
        });
    });
    const groupColumns: Array<[string, string]> = [
      ["name", "Name"],
      ["count", "Count"],
      ["activeAmount", "Active Amount"],
      ["expiredAmount", "Expired Amount"],
      ["marginAmount", "Margin"],
    ];
    return {
      register: {
        label: "BG Register",
        columns: [
          ["bgNumber", "BG Number"],
          ["bank", "Bank"],
          ["beneficiary", "Beneficiary"],
          ["project", "Project"],
          ["purpose", "Purpose"],
          ["amount", "Current Amount"],
          ["issueDate", "Issue Date"],
          ["expiryDate", "Expiry"],
          ["claimExpiry", "Claim Expiry"],
          ["status", "Status"],
        ],
        rows: register,
      },
      bank: {
        label: "Bank-wise BG Utilisation",
        columns: [
          ["bankName", "Bank"],
          ["limitType", "Limit Type"],
          ["sanctionedAmount", "Sanctioned"],
          ["temporaryLimit", "Temporary"],
          ["bgUtilizedAmount", "BG Utilised"],
          ["lcUtilizedAmount", "LC Utilised"],
          ["reservedAmount", "Reserved"],
          ["availableAmount", "Available"],
        ],
        rows: limits,
      },
      project: {
        label: "Project-wise BG Exposure",
        columns: groupColumns.map((item, index) =>
          index === 0 ? ["name", "Project"] : item,
        ) as Array<[string, string]>,
        rows: group("projectName"),
      },
      beneficiary: {
        label: "Beneficiary-wise BG",
        columns: groupColumns.map((item, index) =>
          index === 0 ? ["name", "Beneficiary"] : item,
        ) as Array<[string, string]>,
        rows: group("beneficiaryName"),
      },
      purpose: {
        label: "Purpose-wise BG",
        columns: groupColumns.map((item, index) =>
          index === 0 ? ["name", "Purpose"] : item,
        ) as Array<[string, string]>,
        rows: group("purpose").map((row) => ({
          ...row,
          name: bgLabel(row.name),
        })),
      },
      expiry: {
        label: "Expiry Report",
        columns: [
          ["bgNumber", "BG Number"],
          ["beneficiary", "Beneficiary"],
          ["project", "Project"],
          ["expiryDate", "Expiry"],
          ["claimExpiry", "Claim Expiry"],
          ["days", "Days"],
          ["status", "Status"],
        ],
        rows: bgs.map((item) => ({
          bgNumber: item.bankBgNumber,
          beneficiary: item.beneficiaryName,
          project: item.projectName,
          expiryDate: toBgDateInput(item.currentExpiryDate),
          claimExpiry: toBgDateInput(item.currentClaimExpiryDate),
          days: daysToBgDate(item.currentExpiryDate),
          status: bgLabel(item.status),
        })),
      },
      extension: {
        label: "Extension Report",
        columns: [
          ["bgNumber", "BG Number"],
          ["previousExpiryDate", "Previous Expiry"],
          ["proposedExpiryDate", "New Expiry"],
          ["additionalCommission", "Commission"],
          ["additionalMarginAmount", "Margin"],
          ["status", "Status"],
        ],
        rows: extensions.map((item) => ({
          ...item,
          previousExpiryDate: toBgDateInput(item.previousExpiryDate),
          proposedExpiryDate: toBgDateInput(item.proposedExpiryDate),
          status: bgLabel(item.status),
        })),
      },
      cancellation: {
        label: "Cancellation Report",
        columns: [
          ["bgNumber", "BG Number"],
          ["requestDate", "Request Date"],
          ["bankConfirmationDate", "Bank Confirmation"],
          ["fdReleaseAmount", "FD Release"],
          ["cashMarginReleaseAmount", "Cash Release"],
          ["status", "Status"],
        ],
        rows: cancellations.map((item) => ({
          ...item,
          requestDate: toBgDateInput(item.requestDate),
          bankConfirmationDate: toBgDateInput(item.bankConfirmationDate),
          status: bgLabel(item.status),
        })),
      },
      fd: {
        label: "FD Margin Report",
        columns: [
          ["instrumentNumber", "BG Number"],
          ["fdNumber", "FD Number"],
          ["bankName", "Bank"],
          ["assignmentAmount", "Assigned"],
          ["activeAmount", "Active"],
          ["obligationEndDate", "Claim End"],
          ["status", "Status"],
        ],
        rows: assignments
          .filter((item) => item.instrumentType === "BG")
          .map((item) => ({
            ...item,
            activeAmount: assignmentOutstanding(item),
            obligationEndDate: toBgDateInput(item.obligationEndDate),
            status: bgLabel(item.status),
          })),
      },
      cash: {
        label: "Cash Margin Report",
        columns: [
          ["bgNumber", "BG Number"],
          ["bankName", "Bank"],
          ["amount", "Margin"],
          ["blockDate", "Block Date"],
          ["releaseDate", "Release Date"],
          ["status", "Status"],
        ],
        rows: cash.map((item) => ({
          ...item,
          blockDate: toBgDateInput(item.blockDate),
          releaseDate: toBgDateInput(item.releaseDate),
          status: bgLabel(item.status),
        })),
      },
      commission: {
        label: "Commission Report",
        columns: [
          ["bgNumber", "BG Number"],
          ["bankName", "Bank"],
          ["calculatedCommission", "Internal"],
          ["bankChargedCommission", "Bank"],
          ["gstAmount", "GST"],
          ["differenceAmount", "Difference"],
          ["reconciliationStatus", "Status"],
        ],
        rows: commissions.map((item) => ({
          ...item,
          reconciliationStatus: bgLabel(item.reconciliationStatus),
        })),
      },
      invocation: {
        label: "Invocation Report",
        columns: [
          ["bgNumber", "BG Number"],
          ["beneficiaryName", "Beneficiary"],
          ["claimedAmount", "Claim"],
          ["noticeDate", "Notice Date"],
          ["status", "Status"],
          ["settlementAmount", "Settlement"],
          ["legalOpinion", "Legal Status"],
        ],
        rows: invocations.map((item) => ({
          ...item,
          noticeDate: toBgDateInput(item.noticeDate),
          status: bgLabel(item.status),
        })),
      },
      movement: {
        label: "Original Movement Report",
        columns: [
          ["bgNumber", "BG Number"],
          ["movementType", "Movement"],
          ["currentCustodian", "Custodian"],
          ["dispatchDate", "Dispatch"],
          ["trackingNumber", "Tracking"],
          ["acknowledgementReceived", "Acknowledgement"],
        ],
        rows: movements.map((item) => ({
          ...item,
          movementType: bgLabel(item.movementType),
          dispatchDate: toBgDateInput(item.dispatchDate),
        })),
      },
      exception: {
        label: "Exception Report",
        columns: [
          ["bgNumber", "BG Number"],
          ["exception", "Exception"],
          ["amount", "Affected Amount"],
          ["severity", "Severity"],
        ],
        rows: exceptions,
      },
    };
  }, [data]);
  const dataset = datasets[type] || datasets.register;
  const exportData = async (all = false) => {
    setExporting(true);
    try {
      const workbook = new ExcelJS.Workbook();
      for (const entry of all ? Object.values(datasets) : [dataset]) {
        const sheet = workbook.addWorksheet(entry.label.slice(0, 31));
        sheet.columns = entry.columns.map(([key, label]) => ({
          key,
          header: label,
          width: 22,
        }));
        entry.rows.forEach((row) => sheet.addRow(row));
        sheet.getRow(1).font = { bold: true };
        sheet.views = [{ state: "frozen", ySplit: 1 }];
      }
      const buffer = await workbook.xlsx.writeBuffer(),
        url = URL.createObjectURL(new Blob([buffer]));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = all ? "bg-all-reports.xlsx" : `bg-${type}-report.xlsx`;
      anchor.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
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
  const isMoney = (key: string) =>
    [
      "amount",
      "activeAmount",
      "expiredAmount",
      "marginAmount",
      "sanctionedAmount",
      "temporaryLimit",
      "bgUtilizedAmount",
      "lcUtilizedAmount",
      "reservedAmount",
      "availableAmount",
      "additionalCommission",
      "additionalMarginAmount",
      "fdReleaseAmount",
      "cashMarginReleaseAmount",
      "assignmentAmount",
      "activeAmount",
      "calculatedCommission",
      "bankChargedCommission",
      "gstAmount",
      "differenceAmount",
      "claimedAmount",
      "settlementAmount",
    ].includes(key);
  return (
    <div className="space-y-4">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-2xl font-bold">BG Reports</h1>
          <p className="text-sm text-muted-foreground">
            Exposure, validity, collateral, commission, custody, claims,
            closure, and exceptions.
          </p>
        </div>
        <div className="flex gap-2">
          {canExport && (
            <>
              <Button
                variant="outline"
                disabled={exporting}
                onClick={() => void exportData(false)}
              >
                <Download className="mr-2 h-4 w-4" />
                Selected
              </Button>
              <Button
                disabled={exporting}
                onClick={() => void exportData(true)}
              >
                <Download className="mr-2 h-4 w-4" />
                All Reports
              </Button>
            </>
          )}
          <Button variant="outline" size="icon" onClick={() => void load()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <Card>
        <CardContent className="p-3">
          <Select value={type} onValueChange={setType}>
            <SelectTrigger className="max-w-md">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {reports.map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{dataset.label}</CardTitle>
          <CardDescription>
            {dataset.rows.length} rows · organization-scoped live data
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {dataset.columns.map(([key, label]) => (
                    <TableHead
                      key={key}
                      className={isMoney(key) ? "text-right" : ""}
                    >
                      {label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {dataset.rows.map((row, index) => (
                  <TableRow key={row.id || index}>
                    {dataset.columns.map(([key]) => (
                      <TableCell
                        key={key}
                        className={isMoney(key) ? "text-right" : ""}
                      >
                        {isMoney(key)
                          ? formatBgCurrency(Number(row[key] || 0))
                          : String(row[key] ?? "-")}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
                {!dataset.rows.length && (
                  <TableRow>
                    <TableCell
                      colSpan={dataset.columns.length}
                      className="h-28 text-center text-muted-foreground"
                    >
                      No data for this report.
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
