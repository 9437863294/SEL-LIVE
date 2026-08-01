"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import { ArrowLeft, Loader2 } from "lucide-react";
import { db } from "@/lib/firebase";
import { useAuth } from "@/components/auth/AuthProvider";
import {
  BG_COLLECTIONS,
  bgLabel,
  bgStatusTone,
  daysToBgDate,
  formatBgCurrency,
  toBgDateInput,
  type BGRequest,
  type BankGuarantee,
} from "@/lib/bank-guarantee";
import { FD_COLLECTIONS } from "@/lib/fixed-deposit";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
type Row = Record<string, any> & { id: string };
export default function BGDetailPage({ id }: { id: string }) {
  const { user } = useAuth();
  const [bg, setBg] = useState<BankGuarantee | null>(null),
    [request, setRequest] = useState<BGRequest | null>(null),
    [related, setRelated] = useState<Record<string, Row[]>>({}),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [bgSnap, requestSnap] = await Promise.all([
          getDoc(doc(db, BG_COLLECTIONS.guarantees, id)),
          getDoc(doc(db, BG_COLLECTIONS.requests, id)),
        ]);
        let bgRow = bgSnap.exists()
            ? ({ id: bgSnap.id, ...bgSnap.data() } as BankGuarantee)
            : null,
          requestRow = requestSnap.exists()
            ? ({ id: requestSnap.id, ...requestSnap.data() } as BGRequest)
            : null;
        if (bgRow && !requestRow && bgRow.requestId) {
          const source = await getDoc(
            doc(db, BG_COLLECTIONS.requests, bgRow.requestId),
          );
          if (source.exists())
            requestRow = { id: source.id, ...source.data() } as BGRequest;
        }
        if (!bgRow && requestRow && (requestRow as unknown as Row).bgId) {
          const source = await getDoc(
            doc(
              db,
              BG_COLLECTIONS.guarantees,
              String((requestRow as unknown as Row).bgId),
            ),
          );
          if (source.exists())
            bgRow = { id: source.id, ...source.data() } as BankGuarantee;
        }
        if (!bgRow && !requestRow)
          throw new Error("Bank Guarantee record was not found.");
        const organizationId =
          bgRow?.organizationId || requestRow?.organizationId;
        if (
          user?.role !== "Super Admin" &&
          user?.organizationId &&
          organizationId !== user.organizationId
        )
          throw new Error("You cannot view another organization’s BG.");
        const bgId = bgRow?.id || "",
          requestId = requestRow?.id || "";
        const names = [
          BG_COLLECTIONS.movements,
          BG_COLLECTIONS.acknowledgements,
          BG_COLLECTIONS.extensions,
          BG_COLLECTIONS.amendments,
          BG_COLLECTIONS.commissions,
          BG_COLLECTIONS.invocations,
          BG_COLLECTIONS.cancellations,
          BG_COLLECTIONS.documents,
          FD_COLLECTIONS.assignments,
          BG_COLLECTIONS.approvals,
          BG_COLLECTIONS.audit,
        ];
        const snapshots = await Promise.all(
          names.map((name) => {
            const key =
              name === BG_COLLECTIONS.approvals || name === BG_COLLECTIONS.audit
                ? "module"
                : name === FD_COLLECTIONS.assignments
                  ? "instrumentId"
                  : "bgId";
            if (key === "module")
              return getDocs(
                query(
                  collection(db, name),
                  where("organizationId", "==", organizationId),
                ),
              );
            return getDocs(
              query(collection(db, name), where(key, "==", bgId || requestId)),
            );
          }),
        );
        if (!active) return;
        setBg(bgRow);
        setRequest(requestRow);
        setRelated(
          Object.fromEntries(
            names.map((name, index) => [
              name,
              snapshots[index].docs
                .map((item) => ({ id: item.id, ...item.data() }) as Row)
                .filter(
                  (item) =>
                    (name !== BG_COLLECTIONS.approvals &&
                      name !== BG_COLLECTIONS.audit) ||
                    item.bgId === bgId ||
                    item.requestId === requestId ||
                    item.recordId === bgId ||
                    item.recordId === requestId,
                ),
            ]),
          ),
        );
      } catch (value) {
        if (active)
          setError(
            value instanceof Error ? value.message : "Unable to load BG.",
          );
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [id, user?.organizationId, user?.role]);
  if (loading)
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin" />
      </div>
    );
  if (error || (!bg && !request))
    return (
      <Card>
        <CardHeader>
          <CardTitle>BG unavailable</CardTitle>
          <CardDescription>{error}</CardDescription>
        </CardHeader>
      </Card>
    );
  const title = bg?.bankBgNumber || request?.referenceNumber || id,
    status = bg?.status || request?.status || "";
  const table = (
    name: string,
    columns: Array<[string, string, ((value: any) => React.ReactNode)?]>,
  ) => <SimpleTable rows={related[name] || []} columns={columns} />;
  return (
    <div className="space-y-4">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <Button asChild variant="outline" size="icon">
            <Link href="/bank-guarantee/register">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold">{title}</h1>
              <Badge variant="outline" className={bgStatusTone(status)}>
                {bgLabel(status)}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {bg?.beneficiaryName || request?.beneficiaryName} ·{" "}
              {bg?.projectName || request?.projectName}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {request?.status === "APPROVED" && !bg && (
            <Button asChild>
              <Link href={`/bank-guarantee/${request.id}/issue`}>Issue BG</Link>
            </Button>
          )}
          {bg && (
            <>
              <Button asChild variant="outline">
                <Link href={`/bank-guarantee/${bg.id}/extend`}>Extend</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href={`/bank-guarantee/${bg.id}/invoke`}>Invoke</Link>
              </Button>
              <Button asChild>
                <Link href={`/bank-guarantee/${bg.id}/cancel`}>
                  Cancel / Release
                </Link>
              </Button>
            </>
          )}
        </div>
      </div>
      {bg && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Metric
            label="Current Amount"
            value={formatBgCurrency(bg.currentAmount, bg.currency)}
          />
          <Metric
            label="Expiry"
            value={`${toBgDateInput(bg.currentExpiryDate)} · ${daysToBgDate(bg.currentExpiryDate)}d`}
          />
          <Metric
            label="Claim Expiry"
            value={toBgDateInput(bg.currentClaimExpiryDate)}
          />
          <Metric
            label="Required Margin"
            value={formatBgCurrency(bg.requiredMarginAmount, bg.currency)}
          />
          <Metric
            label="Current Custodian"
            value={bg.currentCustodian || "Not recorded"}
          />
        </div>
      )}
      <Tabs defaultValue="overview">
        <TabsList className="flex h-auto flex-wrap justify-start">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="contract">Contract</TabsTrigger>
          <TabsTrigger value="validity">Validity</TabsTrigger>
          <TabsTrigger value="margin">Margin</TabsTrigger>
          <TabsTrigger value="commission">Commission</TabsTrigger>
          <TabsTrigger value="extensions">Extensions</TabsTrigger>
          <TabsTrigger value="movement">Movement</TabsTrigger>
          <TabsTrigger value="invocation">Invocation</TabsTrigger>
          <TabsTrigger value="cancellation">Cancellation</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="approvals">Approvals</TabsTrigger>
          <TabsTrigger value="audit">Audit</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <Info
            items={
              bg
                ? {
                    Reference: bg.internalReferenceNumber,
                    "BG Number": bg.bankBgNumber,
                    Bank: bg.bankName,
                    Beneficiary: bg.beneficiaryName,
                    Project: bg.projectName,
                    Purpose: bgLabel(bg.purpose),
                    Amount: formatBgCurrency(bg.currentAmount, bg.currency),
                    "Issue Date": toBgDateInput(bg.issueDate),
                    Status: bgLabel(bg.status),
                  }
                : {
                    Reference: request?.referenceNumber,
                    Beneficiary: request?.beneficiaryName,
                    Project: request?.projectName,
                    Bank: request?.preferredBankName,
                    Amount: formatBgCurrency(
                      request?.requestedAmount || 0,
                      request?.currency,
                    ),
                    Status: bgLabel(request?.status),
                  }
            }
          />
        </TabsContent>
        <TabsContent value="contract">
          <Info
            items={{
              Tender: request?.tenderNumber,
              Contract: request?.contractNumber,
              "Work Order": request?.workOrderNumber,
              "Contract Value": formatBgCurrency(request?.contractValue || 0),
              "BG Percentage": `${request?.bgPercentage || 0}%`,
              "Required BG": formatBgCurrency(request?.requiredBgAmount || 0),
              "Balance Requirement": formatBgCurrency(
                request?.balanceBgRequirement || 0,
              ),
            }}
          />
        </TabsContent>
        <TabsContent value="validity">
          <Info
            items={{
              "Original Expiry": toBgDateInput(
                bg?.originalExpiryDate || request?.proposedExpiryDate,
              ),
              "Current Expiry": toBgDateInput(
                bg?.currentExpiryDate || request?.proposedExpiryDate,
              ),
              "Original Claim Expiry": toBgDateInput(
                bg?.originalClaimExpiryDate || request?.proposedClaimExpiryDate,
              ),
              "Current Claim Expiry": toBgDateInput(
                bg?.currentClaimExpiryDate || request?.proposedClaimExpiryDate,
              ),
              "Claim Period": `${bg?.claimPeriodDays || request?.claimPeriodDays || 0} days`,
              "Extension Decision": bgLabel(bg?.extensionDecision),
            }}
          />
        </TabsContent>
        <TabsContent value="margin">
          {table(FD_COLLECTIONS.assignments, [
            ["fdNumber", "FD Number"],
            ["bankName", "Bank"],
            ["assignmentAmount", "Assigned", money],
            ["activeAmount", "Active", money],
            ["obligationEndDate", "Claim End", dateText],
            ["status", "Status", labelText],
          ])}
        </TabsContent>
        <TabsContent value="commission">
          {table(BG_COLLECTIONS.commissions, [
            ["commissionType", "Type", labelText],
            ["calculatedCommission", "Internal", money],
            ["bankChargedCommission", "Bank", money],
            ["gstAmount", "GST", money],
            ["differenceAmount", "Difference", money],
            ["reconciliationStatus", "Status", labelText],
          ])}
        </TabsContent>
        <TabsContent value="extensions">
          {table(BG_COLLECTIONS.extensions, [
            ["extensionReference", "Reference"],
            ["previousExpiryDate", "Previous", dateText],
            ["proposedExpiryDate", "Proposed", dateText],
            ["additionalCommission", "Commission", money],
            ["status", "Status", labelText],
          ])}
          {table(BG_COLLECTIONS.amendments, [
            ["amendmentNumber", "Amendment"],
            ["amendmentType", "Type", labelText],
            ["existingValue", "Existing"],
            ["proposedValue", "Proposed"],
            ["status", "Status", labelText],
          ])}
        </TabsContent>
        <TabsContent value="movement">
          {table(BG_COLLECTIONS.movements, [
            ["movementType", "Movement", labelText],
            ["fromLocation", "From"],
            ["toLocation", "To"],
            ["dispatchDate", "Dispatch", dateText],
            ["trackingNumber", "Tracking"],
            ["currentCustodian", "Custodian"],
          ])}
          {table(BG_COLLECTIONS.acknowledgements, [
            ["acknowledgementNumber", "Acknowledgement"],
            ["deliveryDate", "Delivery", dateText],
            ["receivedBy", "Received By"],
            ["status", "Status", labelText],
          ])}
        </TabsContent>
        <TabsContent value="invocation">
          {table(BG_COLLECTIONS.invocations, [
            ["noticeNumber", "Notice"],
            ["receivedDate", "Received", dateText],
            ["claimedAmount", "Claimed", money],
            ["claimReason", "Reason"],
            ["settlementAmount", "Settlement", money],
            ["status", "Status", labelText],
          ])}
        </TabsContent>
        <TabsContent value="cancellation">
          {table(BG_COLLECTIONS.cancellations, [
            ["requestDate", "Requested", dateText],
            ["reason", "Reason"],
            ["bankReference", "Bank Ref"],
            ["bankConfirmationDate", "Confirmation", dateText],
            ["fdReleaseAmount", "FD Release", money],
            ["status", "Status", labelText],
          ])}
        </TabsContent>
        <TabsContent value="documents">
          {table(BG_COLLECTIONS.documents, [
            ["documentType", "Type", labelText],
            ["fileName", "File"],
            ["version", "Version"],
            ["referenceNumber", "Reference"],
            ["status", "Status", labelText],
          ])}
        </TabsContent>
        <TabsContent value="approvals">
          {table(BG_COLLECTIONS.approvals, [
            ["recordType", "Record"],
            ["stage", "Stage", labelText],
            ["requiredRole", "Required Role"],
            ["status", "Status", labelText],
            ["decidedByName", "Decided By"],
            ["comments", "Comments"],
          ])}
        </TabsContent>
        <TabsContent value="audit">
          {table(BG_COLLECTIONS.audit, [
            ["createdAt", "Date", dateText],
            ["action", "Action", labelText],
            ["summary", "Summary"],
            ["userName", "User"],
            ["reason", "Reason"],
          ])}
        </TabsContent>
      </Tabs>
    </div>
  );
}
const money = (value: any) => formatBgCurrency(Number(value || 0)),
  dateText = (value: any) => toBgDateInput(value),
  labelText = (value: any) => bgLabel(value);
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 font-bold">{value}</p>
      </CardContent>
    </Card>
  );
}
function Info({ items }: { items: Record<string, unknown> }) {
  return (
    <Card>
      <CardContent className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
        {Object.entries(items).map(([key, value]) => (
          <div key={key}>
            <p className="text-xs text-muted-foreground">{key}</p>
            <p className="font-medium">{String(value ?? "-")}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
function SimpleTable({
  rows,
  columns,
}: {
  rows: Row[];
  columns: Array<[string, string, ((value: any) => React.ReactNode)?]>;
}) {
  return (
    <Card className="mb-4">
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map(([key, label]) => (
                  <TableHead key={key}>{label}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  {columns.map(([key, , formatter]) => (
                    <TableCell key={key}>
                      {formatter
                        ? formatter(row[key])
                        : String(row[key] ?? "-")}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
              {!rows.length && (
                <TableRow>
                  <TableCell
                    colSpan={columns.length}
                    className="h-24 text-center text-muted-foreground"
                  >
                    No records.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
