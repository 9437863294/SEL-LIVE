"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { Check, Loader2, Plus, RefreshCw, ShieldAlert } from "lucide-react";
import { db } from "@/lib/firebase";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useToast } from "@/hooks/use-toast";
import { reserveBGFdMargin, type BGActor } from "@/lib/bank-guarantee-service";
import {
  BG_COLLECTIONS,
  BG_PERMISSION_MODULE,
  bgLabel,
  bgStatusTone,
  formatBgCurrency,
  toBgDate,
  toBgDateInput,
  type BGRequest,
} from "@/lib/bank-guarantee";
import {
  FD_COLLECTIONS,
  calculateAvailableAmount,
  calculateEligibleValue,
  isActiveFd,
  type FDAssignment,
  type FixedDeposit,
} from "@/lib/fixed-deposit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Textarea } from "@/components/ui/textarea";

export default function BGMarginWorkspace() {
  const { user } = useAuth();
  const { can, isLoading: authLoading } = useAuthorization();
  const { toast } = useToast();
  const organizationId = user?.organizationId || "default";
  const [requests, setRequests] = useState<BGRequest[]>([]),
    [fds, setFds] = useState<FixedDeposit[]>([]),
    [assignments, setAssignments] = useState<FDAssignment[]>([]),
    [requestId, setRequestId] = useState(""),
    [selected, setSelected] = useState<Record<string, number>>({}),
    [open, setOpen] = useState(false),
    [remarks, setRemarks] = useState(""),
    [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false);
  const canView = can("View", `${BG_PERMISSION_MODULE}.Margin & FD Linkage`),
    canReserve =
      can("Reserve", `${BG_PERMISSION_MODULE}.Margin & FD Linkage`) ||
      can("Assign", `${BG_PERMISSION_MODULE}.Margin & FD Linkage`);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [requestSnap, fdSnap, assignmentSnap] = await Promise.all([
        getDocs(
          query(
            collection(db, BG_COLLECTIONS.requests),
            where("organizationId", "==", organizationId),
          ),
        ),
        getDocs(
          query(
            collection(db, FD_COLLECTIONS.deposits),
            where("organizationId", "==", organizationId),
          ),
        ),
        getDocs(
          query(
            collection(db, FD_COLLECTIONS.assignments),
            where("organizationId", "==", organizationId),
          ),
        ),
      ]);
      setRequests(
        requestSnap.docs
          .map((item) => ({ id: item.id, ...item.data() }) as BGRequest)
          .filter(
            (item) =>
              [
                "APPROVED",
                "PENDING_FINANCE_APPROVAL",
                "PENDING_DIRECTOR_APPROVAL",
              ].includes(item.status) &&
              ["FD", "COMBINED"].includes(item.marginType),
          ),
      );
      setFds(
        fdSnap.docs
          .map((item) => ({ id: item.id, ...item.data() }) as FixedDeposit)
          .filter((item) => !item.isDeleted && isActiveFd(item)),
      );
      setAssignments(
        assignmentSnap.docs
          .map((item) => ({ id: item.id, ...item.data() }) as FDAssignment)
          .filter((item) => item.instrumentType === "BG"),
      );
    } catch {
      toast({
        title: "Unable to load BG collateral data",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [organizationId, toast]);
  useEffect(() => {
    if (!authLoading && canView) void load();
    else if (!authLoading) setLoading(false);
  }, [authLoading, canView, load]);
  const request = requests.find((item) => item.id === requestId),
    existing = assignments
      .filter(
        (item) =>
          item.instrumentId === requestId &&
          ["RESERVED", "PENDING_APPROVAL", "ACTIVE"].includes(item.status),
      )
      .reduce(
        (sum, item) =>
          sum +
          Math.max(
            0,
            Number(item.activeAmount || item.assignmentAmount || 0) -
              Number(item.releasedAmount || 0),
          ),
        0,
      ),
    required = Math.max(
      0,
      Number(request?.requiredMarginAmount || 0) -
        Number(request?.cashMarginAmount || 0) -
        Number(request?.otherCollateralAmount || 0),
    ),
    selectedTotal = Object.values(selected).reduce(
      (sum, value) => sum + Number(value || 0),
      0,
    );
  const available = useMemo(
    () =>
      fds
        .map((fd) => ({
          ...fd,
          currentAvailable: Number(
            fd.availableAmount ||
              calculateAvailableAmount(
                fd.eligibleValue ||
                  calculateEligibleValue(
                    fd.principalAmount,
                    fd.eligibleMarginPercentage,
                  ),
                fd.bgUtilizedAmount,
                fd.lcUtilizedAmount,
                fd.reservedAmount,
              ),
          ),
        }))
        .filter((fd) => fd.currentAvailable > 0)
        .sort(
          (a, b) =>
            (toBgDate(a.maturityDate)?.getTime() || 0) -
            (toBgDate(b.maturityDate)?.getTime() || 0),
        ),
    [fds],
  );
  const reserve = async () => {
    if (!user || !request || !canReserve) return;
    setSaving(true);
    try {
      const actor: BGActor = {
        userId: user.id,
        userName: user.name,
        role: user.role,
        organizationId,
        organizationName: user.organizationName,
      };
      await reserveBGFdMargin(
        {
          requestId: request.id,
          instrumentId: request.id,
          instrumentNumber: request.referenceNumber,
          bankId: request.preferredBankId,
          bankName: request.preferredBankName,
          projectId: request.projectId,
          projectName: request.projectName,
          partyName: request.beneficiaryName,
          instrumentAmount: request.requestedAmount,
          marginPercentage: request.marginPercentage,
          requiredMarginAmount: required,
          assignmentDate: new Date().toISOString().slice(0, 10),
          obligationEndDate: toBgDateInput(request.proposedClaimExpiryDate),
          expectedReleaseDate: toBgDateInput(request.proposedClaimExpiryDate),
          purpose: request.purpose,
          remarks,
          items: Object.entries(selected)
            .filter(([, amount]) => amount > 0)
            .map(([fdId, amount]) => ({ fdId, amount })),
        },
        actor,
      );
      toast({
        title: "BG FD margin reserved",
        description: `${formatBgCurrency(selectedTotal)} against ${request.referenceNumber}`,
      });
      setSelected({});
      setRemarks("");
      setOpen(false);
      await load();
    } catch (error) {
      toast({
        title: "FD reservation failed",
        description: error instanceof Error ? error.message : "",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
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
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-2xl font-bold">Margin & FD Linkage</h1>
          <p className="text-sm text-muted-foreground">
            Reserve eligible FD value through claim expiry and monitor active
            collateral.
          </p>
        </div>
        <div className="flex gap-2">
          {canReserve && (
            <Button onClick={() => setOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Reserve FD Margin
            </Button>
          )}
          <Button variant="outline" size="icon" onClick={() => void load()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <Metric label="Available FDs" value={String(available.length)} />
        <Metric
          label="Eligible Available"
          value={formatBgCurrency(
            available.reduce((sum, item) => sum + item.currentAvailable, 0),
          )}
        />
        <Metric
          label="BG Reserved"
          value={formatBgCurrency(
            assignments
              .filter((item) =>
                ["RESERVED", "PENDING_APPROVAL"].includes(item.status),
              )
              .reduce(
                (sum, item) =>
                  sum + Number(item.activeAmount || item.assignmentAmount || 0),
                0,
              ),
          )}
        />
        <Metric
          label="BG Active Utilisation"
          value={formatBgCurrency(
            assignments
              .filter((item) =>
                ["ACTIVE", "PARTIALLY_RELEASED"].includes(item.status),
              )
              .reduce(
                (sum, item) =>
                  sum +
                  Math.max(
                    0,
                    Number(item.activeAmount || item.assignmentAmount || 0) -
                      Number(item.releasedAmount || 0),
                  ),
                0,
              ),
          )}
        />
      </div>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>FD / Bank</TableHead>
                  <TableHead>BG Request / Number</TableHead>
                  <TableHead>Beneficiary / Project</TableHead>
                  <TableHead className="text-right">Assigned</TableHead>
                  <TableHead className="text-right">Active</TableHead>
                  <TableHead>Claim End</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {assignments.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <p className="font-medium">{item.fdNumber}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.bankName}
                      </p>
                    </TableCell>
                    <TableCell>{item.instrumentNumber}</TableCell>
                    <TableCell>
                      {item.partyName || "-"}
                      <p className="text-xs text-muted-foreground">
                        {item.projectName || "-"}
                      </p>
                    </TableCell>
                    <TableCell className="text-right">
                      {formatBgCurrency(item.assignmentAmount)}
                    </TableCell>
                    <TableCell className="text-right font-semibold">
                      {formatBgCurrency(
                        Math.max(
                          0,
                          Number(item.activeAmount || item.assignmentAmount) -
                            Number(item.releasedAmount || 0),
                        ),
                      )}
                    </TableCell>
                    <TableCell>
                      {toBgDateInput(item.obligationEndDate)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={bgStatusTone(item.status)}
                      >
                        {bgLabel(item.status)}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
                {!assignments.length && (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="h-28 text-center text-muted-foreground"
                    >
                      No BG FD reservations or assignments.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
      <Dialog open={open} onOpenChange={(value) => !saving && setOpen(value)}>
        <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Reserve BG FD Margin</DialogTitle>
            <DialogDescription>
              FD maturity must cover the BG claim expiry date. Cross-bank use
              requires an approved exception.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-xs">BG request</Label>
              <Select
                value={requestId}
                onValueChange={(value) => {
                  setRequestId(value);
                  setSelected({});
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select request" />
                </SelectTrigger>
                <SelectContent>
                  {requests.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.referenceNumber} · {item.beneficiaryName} ·{" "}
                      {formatBgCurrency(item.requiredMarginAmount)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {request && (
              <>
                <div className="grid gap-3 sm:grid-cols-4">
                  <Metric
                    label="Required FD"
                    value={formatBgCurrency(required)}
                  />
                  <Metric
                    label="Already Reserved"
                    value={formatBgCurrency(existing)}
                  />
                  <Metric
                    label="Selected"
                    value={formatBgCurrency(selectedTotal)}
                  />
                  <Metric
                    label="Shortfall"
                    value={formatBgCurrency(
                      Math.max(0, required - existing - selectedTotal),
                    )}
                  />
                </div>
                <Card>
                  <CardContent className="p-0">
                    <div className="max-h-80 overflow-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead />
                            <TableHead>FD / Bank</TableHead>
                            <TableHead>Maturity</TableHead>
                            <TableHead className="text-right">
                              Available
                            </TableHead>
                            <TableHead className="w-44">
                              Reserve Amount
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {available.map((fd) => {
                            const checked = fd.id in selected,
                              bankMismatch =
                                fd.bankId !== request.preferredBankId,
                              maturityRisk =
                                (toBgDate(fd.maturityDate)?.getTime() || 0) <
                                (toBgDate(
                                  request.proposedClaimExpiryDate,
                                )?.getTime() || 0);
                            return (
                              <TableRow key={fd.id}>
                                <TableCell>
                                  <Checkbox
                                    checked={checked}
                                    onCheckedChange={(value) =>
                                      setSelected((current) => {
                                        const next = { ...current };
                                        if (value)
                                          next[fd.id] = Math.min(
                                            fd.currentAvailable,
                                            Math.max(
                                              0,
                                              required -
                                                existing -
                                                selectedTotal,
                                            ),
                                          );
                                        else delete next[fd.id];
                                        return next;
                                      })
                                    }
                                  />
                                </TableCell>
                                <TableCell>
                                  <p className="font-medium">{fd.fdNumber}</p>
                                  <p className="text-xs text-muted-foreground">
                                    {fd.bankName}
                                    {bankMismatch ? " · cross-bank" : ""}
                                  </p>
                                </TableCell>
                                <TableCell>
                                  {toBgDateInput(fd.maturityDate)}
                                  {maturityRisk && (
                                    <p className="text-xs text-rose-600">
                                      Before claim expiry
                                    </p>
                                  )}
                                </TableCell>
                                <TableCell className="text-right">
                                  {formatBgCurrency(fd.currentAvailable)}
                                </TableCell>
                                <TableCell>
                                  <Input
                                    type="number"
                                    disabled={!checked}
                                    max={fd.currentAvailable}
                                    value={selected[fd.id] || ""}
                                    onChange={(event) =>
                                      setSelected((current) => ({
                                        ...current,
                                        [fd.id]: Math.min(
                                          fd.currentAvailable,
                                          Number(event.target.value),
                                        ),
                                      }))
                                    }
                                  />
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
                <div>
                  <Label className="text-xs">Remarks / exception reason</Label>
                  <Textarea
                    value={remarks}
                    onChange={(event) => setRemarks(event.target.value)}
                  />
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={
                saving ||
                !request ||
                selectedTotal <= 0 ||
                existing + selectedTotal < required
              }
              onClick={() => void reserve()}
            >
              {saving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Check className="mr-2 h-4 w-4" />
              )}
              Reserve Margin
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 text-lg font-bold">{value}</p>
      </CardContent>
    </Card>
  );
}
