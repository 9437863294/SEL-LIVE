"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { Loader2, Send, ShieldAlert } from "lucide-react";
import { db } from "@/lib/firebase";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useToast } from "@/hooks/use-toast";
import {
  issueBankGuarantee,
  type BGActor,
  type BGIssuanceInput,
} from "@/lib/bank-guarantee-service";
import {
  BG_COLLECTIONS,
  BG_PERMISSION_MODULE,
  bgLabel,
  calculateBgMargin,
  formatBgCurrency,
  toBgDateInput,
  type BGRequest,
} from "@/lib/bank-guarantee";
import type { BankAccount } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

type Limit = Record<string, any> & { id: string };
const today = () => new Date().toISOString().slice(0, 10);
const blank = (): BGIssuanceInput => ({
  requestId: "",
  bankBgNumber: "",
  bankId: "",
  bankName: "",
  branchId: "",
  branchName: "",
  bankLimitId: "",
  issueDate: today(),
  effectiveDate: today(),
  startDate: today(),
  expiryDate: "",
  claimExpiryDate: "",
  issuedAmount: 0,
  currency: "INR",
  exchangeRate: 1,
  marginPercentage: 0,
  fdMarginAmount: 0,
  cashMarginAmount: 0,
  otherCollateralAmount: 0,
  bankCommission: 0,
  gstAmount: 0,
  stampDuty: 0,
  swiftCharges: 0,
  courierCharges: 0,
  otherCharges: 0,
  debitAccountId: "",
  originalReceived: false,
  originalReceivedDate: "",
  numberOfOriginals: 1,
  numberOfCopies: 1,
  dispatchRequired: true,
  documentComplete: false,
  remarks: "",
});
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

export default function BGIssuanceWorkspace({
  initialRequestId,
}: {
  initialRequestId?: string;
}) {
  const { user } = useAuth();
  const { can, isLoading: authLoading } = useAuthorization();
  const { toast } = useToast();
  const organizationId = user?.organizationId || "default";
  const canView = can("View", `${BG_PERMISSION_MODULE}.BG Issuance`),
    canIssue =
      can("Issue", `${BG_PERMISSION_MODULE}.BG Issuance`) ||
      can("Add", `${BG_PERMISSION_MODULE}.BG Issuance`);
  const [requests, setRequests] = useState<BGRequest[]>([]),
    [banks, setBanks] = useState<BankAccount[]>([]),
    [limits, setLimits] = useState<Limit[]>([]),
    [draft, setDraft] = useState<BGIssuanceInput>(blank),
    [loading, setLoading] = useState(true),
    [working, setWorking] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [requestSnap, bankSnap, limitSnap] = await Promise.all([
        getDocs(
          query(
            collection(db, BG_COLLECTIONS.requests),
            where("organizationId", "==", organizationId),
          ),
        ),
        getDocs(collection(db, "bankAccounts")),
        getDocs(
          query(
            collection(db, BG_COLLECTIONS.bankLimits),
            where("organizationId", "==", organizationId),
          ),
        ),
      ]);
      const rows = requestSnap.docs
        .map((item) => ({ id: item.id, ...item.data() }) as BGRequest)
        .filter((item) => item.status === "APPROVED");
      setRequests(rows);
      setBanks(
        bankSnap.docs
          .map((item) => ({ id: item.id, ...item.data() }) as BankAccount)
          .filter((item) => item.status === "Active"),
      );
      setLimits(
        limitSnap.docs
          .map((item) => ({ id: item.id, ...item.data() }) as Limit)
          .filter(
            (item) =>
              ["BG", "COMBINED_BG_LC"].includes(String(item.limitType)) &&
              item.status === "ACTIVE",
          ),
      );
      if (initialRequestId && rows.some((item) => item.id === initialRequestId))
        selectRequest(initialRequestId, rows);
    } catch (error) {
      console.error(error);
      toast({
        title: "Unable to load issuance workspace",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [initialRequestId, organizationId, toast]);
  useEffect(() => {
    if (!authLoading && canView) void load();
    else if (!authLoading) setLoading(false);
  }, [authLoading, canView, load]);
  const selectRequest = (id: string, source = requests) => {
    const request = source.find((item) => item.id === id);
    if (!request) return;
    const bank = banks.find((item) => item.id === request.preferredBankId);
    setDraft((current) => ({
      ...current,
      requestId: id,
      bankId: request.preferredBankId,
      bankName: request.preferredBankName,
      branchName: bank?.branch || "",
      bankLimitId: request.bankLimitId || "",
      startDate: toBgDateInput(request.proposedStartDate),
      expiryDate: toBgDateInput(request.proposedExpiryDate),
      claimExpiryDate: toBgDateInput(request.proposedClaimExpiryDate),
      issuedAmount: request.requestedAmount,
      currency: request.currency,
      exchangeRate: request.exchangeRate,
      marginPercentage: request.marginPercentage,
      fdMarginAmount:
        request.fdMarginAmount ||
        (["FD", "COMBINED"].includes(request.marginType)
          ? request.requiredMarginAmount
          : 0),
      cashMarginAmount: request.cashMarginAmount || 0,
      otherCollateralAmount: request.otherCollateralAmount || 0,
      bankCommission: request.estimatedCommission,
      gstAmount: request.estimatedGst,
      otherCharges: request.estimatedOtherCharges,
    }));
  };
  const set = <K extends keyof BGIssuanceInput>(
    key: K,
    value: BGIssuanceInput[K],
  ) => setDraft((current) => ({ ...current, [key]: value }));
  const selectedRequest = useMemo(
    () => requests.find((item) => item.id === draft.requestId),
    [draft.requestId, requests],
  );
  const requiredMargin = calculateBgMargin(
      draft.issuedAmount,
      draft.marginPercentage,
    ),
    totalMargin =
      draft.fdMarginAmount +
      draft.cashMarginAmount +
      draft.otherCollateralAmount,
    totalCharges =
      draft.bankCommission +
      draft.gstAmount +
      draft.stampDuty +
      draft.swiftCharges +
      draft.courierCharges +
      draft.otherCharges;
  const issue = async () => {
    if (!user || !canIssue) return;
    setWorking(true);
    try {
      const bank = banks.find((item) => item.id === draft.bankId),
        actor: BGActor = {
          userId: user.id,
          userName: user.name,
          role: user.role,
          organizationId,
          organizationName: user.organizationName,
        };
      const id = await issueBankGuarantee(
        {
          ...draft,
          bankName: bank?.bankName || draft.bankName,
          branchName: bank?.branch || draft.branchName,
        },
        actor,
      );
      toast({
        title: "Bank Guarantee issued",
        description: `${draft.bankBgNumber} is active and linked collateral has been converted.`,
      });
      location.href = `/bank-guarantee/${id}`;
    } catch (error) {
      toast({
        title: "BG issuance failed",
        description:
          error instanceof Error ? error.message : "Review issuance controls.",
        variant: "destructive",
      });
    } finally {
      setWorking(false);
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
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">BG Issuance</h1>
        <p className="text-sm text-muted-foreground">
          Convert an approved request and reserved bank/FD margin into an issued
          Bank Guarantee.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Approved request</CardTitle>
          <CardDescription>
            Only fully approved requests are available for issuance.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Approved BG request">
            <Select value={draft.requestId} onValueChange={selectRequest}>
              <SelectTrigger>
                <SelectValue placeholder="Select approved request" />
              </SelectTrigger>
              <SelectContent>
                {requests.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.referenceNumber} · {item.beneficiaryName} ·{" "}
                    {formatBgCurrency(item.requestedAmount)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Beneficiary">
            <Input disabled value={selectedRequest?.beneficiaryName || ""} />
          </Field>
          <Field label="Project">
            <Input disabled value={selectedRequest?.projectName || ""} />
          </Field>
          <Field label="Bank BG number">
            <Input
              value={draft.bankBgNumber}
              onChange={(e) => set("bankBgNumber", e.target.value)}
            />
          </Field>
          <Field label="Bank">
            <Select
              value={draft.bankId}
              onValueChange={(value) => set("bankId", value)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {banks.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.bankName} · {item.branch}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Shared BG / LC limit">
            <Select
              value={draft.bankLimitId || "none"}
              onValueChange={(value) =>
                set("bankLimitId", value === "none" ? "" : value)
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No linked limit</SelectItem>
                {limits
                  .filter(
                    (item) => !draft.bankId || item.bankId === draft.bankId,
                  )
                  .map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.bankName} · {bgLabel(String(item.limitType))} ·{" "}
                      {formatBgCurrency(Number(item.availableAmount || 0))}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </Field>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Final amount and validity</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Issue date">
            <Input
              type="date"
              value={draft.issueDate}
              onChange={(e) => set("issueDate", e.target.value)}
            />
          </Field>
          <Field label="Effective date">
            <Input
              type="date"
              value={draft.effectiveDate || ""}
              onChange={(e) => set("effectiveDate", e.target.value)}
            />
          </Field>
          <Field label="Start date">
            <Input
              type="date"
              value={draft.startDate}
              onChange={(e) => set("startDate", e.target.value)}
            />
          </Field>
          <Field label="Expiry date">
            <Input
              type="date"
              value={draft.expiryDate}
              onChange={(e) => set("expiryDate", e.target.value)}
            />
          </Field>
          <Field label="Claim expiry date">
            <Input
              type="date"
              value={draft.claimExpiryDate}
              onChange={(e) => set("claimExpiryDate", e.target.value)}
            />
          </Field>
          <Field label="Issued amount">
            <Input
              type="number"
              min="0"
              value={draft.issuedAmount || ""}
              onChange={(e) => set("issuedAmount", Number(e.target.value))}
            />
          </Field>
          <Field label="Currency">
            <Input
              value={draft.currency}
              onChange={(e) => set("currency", e.target.value.toUpperCase())}
            />
          </Field>
          <Field label="Exchange rate">
            <Input
              type="number"
              step="0.0001"
              value={draft.exchangeRate || ""}
              onChange={(e) => set("exchangeRate", Number(e.target.value))}
            />
          </Field>
          <Field label="Base exposure">
            <Input
              disabled
              value={formatBgCurrency(draft.issuedAmount * draft.exchangeRate)}
            />
          </Field>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Collateral and charges</CardTitle>
          <CardDescription>
            Required margin {formatBgCurrency(requiredMargin)} · assigned{" "}
            {formatBgCurrency(totalMargin)} · shortfall{" "}
            {formatBgCurrency(Math.max(0, requiredMargin - totalMargin))}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Margin %">
            <Input
              type="number"
              value={draft.marginPercentage || ""}
              onChange={(e) => set("marginPercentage", Number(e.target.value))}
            />
          </Field>
          <Field label="FD margin">
            <Input
              type="number"
              value={draft.fdMarginAmount || ""}
              onChange={(e) => set("fdMarginAmount", Number(e.target.value))}
            />
          </Field>
          <Field label="Cash margin">
            <Input
              type="number"
              value={draft.cashMarginAmount || ""}
              onChange={(e) => set("cashMarginAmount", Number(e.target.value))}
            />
          </Field>
          <Field label="Other collateral">
            <Input
              type="number"
              value={draft.otherCollateralAmount || ""}
              onChange={(e) =>
                set("otherCollateralAmount", Number(e.target.value))
              }
            />
          </Field>
          <Field label="Bank commission">
            <Input
              type="number"
              value={draft.bankCommission || ""}
              onChange={(e) => set("bankCommission", Number(e.target.value))}
            />
          </Field>
          <Field label="GST">
            <Input
              type="number"
              value={draft.gstAmount || ""}
              onChange={(e) => set("gstAmount", Number(e.target.value))}
            />
          </Field>
          <Field label="Stamp duty">
            <Input
              type="number"
              value={draft.stampDuty || ""}
              onChange={(e) => set("stampDuty", Number(e.target.value))}
            />
          </Field>
          <Field label="SWIFT charges">
            <Input
              type="number"
              value={draft.swiftCharges || ""}
              onChange={(e) => set("swiftCharges", Number(e.target.value))}
            />
          </Field>
          <Field label="Courier / other">
            <Input
              type="number"
              value={draft.courierCharges + draft.otherCharges || ""}
              onChange={(e) => set("otherCharges", Number(e.target.value))}
            />
          </Field>
          <Field label="Total charges">
            <Input disabled value={formatBgCurrency(totalCharges)} />
          </Field>
          <Field label="Debit account">
            <Input
              value={draft.debitAccountId || ""}
              onChange={(e) => set("debitAccountId", e.target.value)}
            />
          </Field>
          <div className="grid gap-3">
            <label className="flex items-center justify-between rounded-lg border p-3 text-sm">
              <span>Original BG received</span>
              <Switch
                checked={draft.originalReceived}
                onCheckedChange={(value) => set("originalReceived", value)}
              />
            </label>
            <label className="flex items-center justify-between rounded-lg border p-3 text-sm">
              <span>Mandatory documents complete</span>
              <Switch
                checked={draft.documentComplete}
                onCheckedChange={(value) => set("documentComplete", value)}
              />
            </label>
          </div>
          <Field label="Original received date">
            <Input
              type="date"
              disabled={!draft.originalReceived}
              value={draft.originalReceivedDate || ""}
              onChange={(e) => set("originalReceivedDate", e.target.value)}
            />
          </Field>
          <Field label="Originals / copies">
            <div className="grid grid-cols-2 gap-2">
              <Input
                type="number"
                value={draft.numberOfOriginals}
                onChange={(e) =>
                  set("numberOfOriginals", Number(e.target.value))
                }
              />
              <Input
                type="number"
                value={draft.numberOfCopies}
                onChange={(e) => set("numberOfCopies", Number(e.target.value))}
              />
            </div>
          </Field>
          <div className="sm:col-span-2 lg:col-span-3">
            <Field label="Remarks">
              <Textarea
                value={draft.remarks || ""}
                onChange={(e) => set("remarks", e.target.value)}
              />
            </Field>
          </div>
        </CardContent>
      </Card>
      {canIssue && (
        <div className="flex justify-end">
          <Button
            size="lg"
            disabled={working || !draft.requestId || !draft.bankBgNumber}
            onClick={() => void issue()}
          >
            {working && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            <Send className="mr-2 h-4 w-4" />
            Issue Bank Guarantee
          </Button>
        </div>
      )}
    </div>
  );
}
