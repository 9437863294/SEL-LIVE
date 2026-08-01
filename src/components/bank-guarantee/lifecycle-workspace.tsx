"use client";

import { useCallback, useEffect, useState } from "react";
import {
  collection,
  doc,
  getDocs,
  query,
  updateDoc,
  where,
} from "firebase/firestore";
import { Check, Loader2, Plus, RefreshCw, ShieldAlert } from "lucide-react";
import { db } from "@/lib/firebase";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useToast } from "@/hooks/use-toast";
import {
  completeBGCancellation,
  completeBGExtension,
  createBGExtension,
  createBGInvocation,
  requestBGCancellation,
  type BGActor,
} from "@/lib/bank-guarantee-service";
import {
  BG_COLLECTIONS,
  BG_PERMISSION_MODULE,
  bgLabel,
  bgStatusTone,
  formatBgCurrency,
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

type Kind = "extensions" | "invocations" | "cancellations";
type Row = Record<string, any> & { id: string };
const today = () => new Date().toISOString().slice(0, 10);
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
export default function BGLifecycleWorkspace({ kind }: { kind: Kind }) {
  const { user } = useAuth();
  const { can, isLoading: authLoading } = useAuthorization();
  const { toast } = useToast();
  const organizationId = user?.organizationId || "default",
    resource =
      kind === "extensions"
        ? "Extension & Amendment"
        : kind === "invocations"
          ? "Invocation & Claims"
          : "Cancellation & Release",
    canView = can("View", `${BG_PERMISSION_MODULE}.${resource}`),
    canAdd = can(
      kind === "cancellations" ? "Request" : "Add",
      `${BG_PERMISSION_MODULE}.${resource}`,
    ),
    canComplete =
      can(
        kind === "cancellations" ? "Complete" : "Complete",
        `${BG_PERMISSION_MODULE}.${resource}`,
      ) || can("Close", `${BG_PERMISSION_MODULE}.${resource}`);
  const [guarantees, setGuarantees] = useState<BankGuarantee[]>([]),
    [rows, setRows] = useState<Row[]>([]),
    [loading, setLoading] = useState(true),
    [open, setOpen] = useState(false),
    [working, setWorking] = useState(false),
    [bgId, setBgId] = useState(""),
    [form, setForm] = useState<Record<string, any>>({}),
    [completeRow, setCompleteRow] = useState<Row | null>(null);
  const collectionName =
    kind === "extensions"
      ? BG_COLLECTIONS.extensions
      : kind === "invocations"
        ? BG_COLLECTIONS.invocations
        : BG_COLLECTIONS.cancellations;
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [bgSnap, rowSnap] = await Promise.all([
        getDocs(
          query(
            collection(db, BG_COLLECTIONS.guarantees),
            where("organizationId", "==", organizationId),
          ),
        ),
        getDocs(
          query(
            collection(db, collectionName),
            where("organizationId", "==", organizationId),
          ),
        ),
      ]);
      setGuarantees(
        bgSnap.docs
          .map((item) => ({ id: item.id, ...item.data() }) as BankGuarantee)
          .filter(
            (item) =>
              !item.isDeleted && !["CLOSED", "CANCELLED"].includes(item.status),
          ),
      );
      setRows(
        rowSnap.docs
          .map((item) => ({ id: item.id, ...item.data() }) as Row)
          .sort((a, b) =>
            String(b.createdAt || b.requestDate).localeCompare(
              String(a.createdAt || a.requestDate),
            ),
          ),
      );
    } catch {
      toast({ title: `Unable to load BG ${kind}`, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [collectionName, kind, organizationId, toast]);
  useEffect(() => {
    if (!authLoading && canView) void load();
    else if (!authLoading) setLoading(false);
  }, [authLoading, canView, load]);
  const bg = guarantees.find((item) => item.id === bgId);
  const actor: BGActor | undefined = user
    ? {
        userId: user.id,
        userName: user.name,
        role: user.role,
        organizationId,
        organizationName: user.organizationName,
      }
    : undefined;
  const newRecord = () => {
    setForm(
      kind === "extensions"
        ? {
            proposedExpiryDate: "",
            proposedClaimExpiryDate: "",
            reason: "",
            clientRequestReference: "",
            additionalMarginAmount: 0,
            additionalCommission: 0,
            gstAmount: 0,
            otherCharges: 0,
          }
        : kind === "invocations"
          ? {
              noticeNumber: "",
              noticeDate: today(),
              receivedDate: today(),
              claimType: "PARTIAL",
              claimedAmount: 0,
              claimReason: "",
              legalReviewRequired: true,
              projectResponse: "",
              commercialResponse: "",
              legalOpinion: "",
              financeResponse: "",
              bankReference: "",
            }
          : {
              reason: "",
              projectCompletionConfirmed: false,
              clientReleaseReceived: false,
              originalBgReturned: false,
              noClaimConfirmationReceived: false,
              bankSubmissionDate: "",
              bankReference: "",
              fdReleaseAmount: 0,
              cashMarginReleaseAmount: 0,
              otherCollateralReleaseAmount: 0,
              remarks: "",
            },
    );
    setBgId("");
    setOpen(true);
  };
  const save = async () => {
    if (!actor || !bgId) return;
    setWorking(true);
    try {
      if (kind === "extensions")
        await createBGExtension({ bgId, ...form } as any, actor);
      else if (kind === "invocations")
        await createBGInvocation({ bgId, ...form } as any, actor);
      else await requestBGCancellation({ bgId, ...form } as any, actor);
      toast({
        title: `BG ${kind === "extensions" ? "extension" : kind === "invocations" ? "invocation" : "cancellation"} recorded`,
      });
      setOpen(false);
      await load();
    } catch (error) {
      toast({
        title: "Action failed",
        description: error instanceof Error ? error.message : "",
        variant: "destructive",
      });
    } finally {
      setWorking(false);
    }
  };
  const updateStatus = async (row: Row, status: string) => {
    try {
      await updateDoc(doc(db, collectionName, row.id), {
        status,
        updatedBy: user?.id || "",
        updatedByName: user?.name || "",
        updatedAt: new Date(),
      });
      toast({ title: "Status updated" });
      await load();
    } catch {
      toast({ title: "Status update failed", variant: "destructive" });
    }
  };
  const complete = async () => {
    if (!actor || !completeRow) return;
    setWorking(true);
    try {
      if (kind === "extensions")
        await completeBGExtension(completeRow.id, actor);
      else if (kind === "cancellations")
        await completeBGCancellation(
          completeRow.id,
          {
            bankConfirmationDate: String(form.bankConfirmationDate || ""),
            cancellationEffectiveDate: String(
              form.cancellationEffectiveDate || "",
            ),
            bankReference: String(form.bankReference || ""),
            comments: String(form.comments || ""),
            authorizedOverride: Boolean(form.authorizedOverride),
          },
          actor,
        );
      else {
        await updateDoc(doc(db, BG_COLLECTIONS.invocations, completeRow.id), {
          status: "CLOSED",
          settlementAmount: Number(form.settlementAmount || 0),
          settlementDate: form.settlementDate || today(),
          updatedBy: user?.id || "",
          updatedAt: new Date(),
        });
        await updateDoc(
          doc(db, BG_COLLECTIONS.guarantees, String(completeRow.bgId)),
          {
            status: "ACTIVE",
            updatedBy: user?.id || "",
            updatedAt: new Date(),
          },
        );
      }
      toast({ title: `BG ${kind.slice(0, -1)} completed` });
      setCompleteRow(null);
      await load();
    } catch (error) {
      toast({
        title: "Completion failed",
        description: error instanceof Error ? error.message : "",
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
  const title =
    kind === "extensions"
      ? "BG Extension Management"
      : kind === "invocations"
        ? "Invocation & Claim Management"
        : "BG Cancellation & Margin Release";
  const statusValues =
    kind === "extensions"
      ? [
          "PENDING_APPROVAL",
          "APPROVED",
          "SUBMITTED_TO_BANK",
          "AMENDMENT_RECEIVED",
          "ACKNOWLEDGEMENT_PENDING",
          "COMPLETED",
          "REJECTED",
          "CANCELLED",
        ]
      : kind === "invocations"
        ? [
            "NOTICE_RECEIVED",
            "UNDER_REVIEW",
            "RESPONSE_SUBMITTED",
            "CLAIM_ACCEPTED",
            "CLAIM_DISPUTED",
            "PARTIALLY_INVOKED",
            "FULLY_INVOKED",
            "SETTLED",
            "CLOSED",
          ]
        : [
            "PENDING_APPROVAL",
            "CLIENT_RELEASE_AWAITED",
            "ORIGINAL_BG_AWAITED",
            "SUBMITTED_TO_BANK",
            "BANK_CONFIRMATION_AWAITED",
            "MARGIN_RELEASE_PENDING",
            "COMPLETED",
            "REJECTED",
            "CANCELLED",
          ];
  return (
    <div className="space-y-4">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-2xl font-bold">{title}</h1>
          <p className="text-sm text-muted-foreground">
            Separate event history with controlled approvals, bank confirmation,
            and consolidated BG updates.
          </p>
        </div>
        <div className="flex gap-2">
          {canAdd && (
            <Button onClick={newRecord}>
              <Plus className="mr-2 h-4 w-4" />
              New{" "}
              {kind === "extensions"
                ? "Extension"
                : kind === "invocations"
                  ? "Invocation"
                  : "Cancellation"}
            </Button>
          )}
          <Button variant="outline" size="icon" onClick={() => void load()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>BG</TableHead>
                  <TableHead>
                    {kind === "extensions"
                      ? "Previous / Proposed Expiry"
                      : kind === "invocations"
                        ? "Notice / Claim"
                        : "Request / Reason"}
                  </TableHead>
                  <TableHead className="text-right">
                    {kind === "extensions"
                      ? "Commission / Margin"
                      : kind === "invocations"
                        ? "Claimed"
                        : "FD / Cash Release"}
                  </TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <p className="font-medium">{row.bgNumber}</p>
                      <p className="text-xs text-muted-foreground">
                        {row.beneficiaryName || ""}
                      </p>
                    </TableCell>
                    <TableCell>
                      {kind === "extensions" ? (
                        <>
                          <p>
                            {toBgDateInput(row.previousExpiryDate)} →{" "}
                            {toBgDateInput(row.proposedExpiryDate)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Claim {toBgDateInput(row.proposedClaimExpiryDate)}
                          </p>
                        </>
                      ) : kind === "invocations" ? (
                        <>
                          <p>
                            {row.noticeNumber} ·{" "}
                            {toBgDateInput(row.receivedDate)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {row.claimReason}
                          </p>
                        </>
                      ) : (
                        <>
                          <p>{toBgDateInput(row.requestDate)}</p>
                          <p className="text-xs text-muted-foreground">
                            {row.reason}
                          </p>
                        </>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {kind === "extensions" ? (
                        <>
                          {formatBgCurrency(
                            Number(row.additionalCommission || 0),
                          )}
                          <p className="text-xs text-muted-foreground">
                            Margin{" "}
                            {formatBgCurrency(
                              Number(row.additionalMarginAmount || 0),
                            )}
                          </p>
                        </>
                      ) : kind === "invocations" ? (
                        formatBgCurrency(Number(row.claimedAmount || 0))
                      ) : (
                        <>
                          {formatBgCurrency(Number(row.fdReleaseAmount || 0))}
                          <p className="text-xs text-muted-foreground">
                            Cash{" "}
                            {formatBgCurrency(
                              Number(row.cashMarginReleaseAmount || 0),
                            )}
                          </p>
                        </>
                      )}
                    </TableCell>
                    <TableCell>
                      <Select
                        value={String(row.status)}
                        onValueChange={(value) => void updateStatus(row, value)}
                      >
                        <SelectTrigger className="min-w-48">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {statusValues.map((value) => (
                            <SelectItem key={value} value={value}>
                              {bgLabel(value)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        {canComplete &&
                          kind === "extensions" &&
                          [
                            "APPROVED",
                            "AMENDMENT_RECEIVED",
                            "ACKNOWLEDGEMENT_PENDING",
                          ].includes(row.status) && (
                            <Button
                              size="sm"
                              onClick={() => {
                                setForm({});
                                setCompleteRow(row);
                              }}
                            >
                              Complete
                            </Button>
                          )}
                        {canComplete &&
                          kind === "invocations" &&
                          !["CLOSED"].includes(row.status) && (
                            <Button
                              size="sm"
                              onClick={() => {
                                setForm({
                                  settlementAmount: row.settlementAmount || 0,
                                  settlementDate: today(),
                                });
                                setCompleteRow(row);
                              }}
                            >
                              Settle & Close
                            </Button>
                          )}
                        {canComplete &&
                          kind === "cancellations" &&
                          !["COMPLETED", "REJECTED"].includes(row.status) && (
                            <Button
                              size="sm"
                              onClick={() => {
                                setForm({
                                  bankConfirmationDate: today(),
                                  cancellationEffectiveDate: today(),
                                  bankReference: row.bankReference || "",
                                  comments: "",
                                  authorizedOverride: false,
                                });
                                setCompleteRow(row);
                              }}
                            >
                              Complete Release
                            </Button>
                          )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {!rows.length && (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="h-28 text-center text-muted-foreground"
                    >
                      No {kind} recorded.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
      <Dialog open={open} onOpenChange={(value) => !working && setOpen(value)}>
        <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              New{" "}
              {kind === "extensions"
                ? "BG Extension"
                : kind === "invocations"
                  ? "Invocation Notice"
                  : "BG Cancellation Request"}
            </DialogTitle>
            <DialogDescription>
              All actions are organization-scoped and audited.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Bank Guarantee">
              <Select value={bgId} onValueChange={setBgId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select active BG" />
                </SelectTrigger>
                <SelectContent>
                  {guarantees.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.bankBgNumber} · {item.beneficiaryName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {kind === "extensions" ? (
              <>
                <Field label="Current Expiry">
                  <Input
                    disabled
                    value={bg ? toBgDateInput(bg.currentExpiryDate) : ""}
                  />
                </Field>
                <Field label="Proposed Expiry">
                  <Input
                    type="date"
                    value={form.proposedExpiryDate || ""}
                    onChange={(e) =>
                      setForm({ ...form, proposedExpiryDate: e.target.value })
                    }
                  />
                </Field>
                <Field label="Proposed Claim Expiry">
                  <Input
                    type="date"
                    value={form.proposedClaimExpiryDate || ""}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        proposedClaimExpiryDate: e.target.value,
                      })
                    }
                  />
                </Field>
                <Field label="Client Request Reference">
                  <Input
                    value={form.clientRequestReference || ""}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        clientRequestReference: e.target.value,
                      })
                    }
                  />
                </Field>
                <Field label="Additional Margin">
                  <Input
                    type="number"
                    value={form.additionalMarginAmount || ""}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        additionalMarginAmount: Number(e.target.value),
                      })
                    }
                  />
                </Field>
                <Field label="Additional Commission">
                  <Input
                    type="number"
                    value={form.additionalCommission || ""}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        additionalCommission: Number(e.target.value),
                      })
                    }
                  />
                </Field>
                <Field label="GST / Other Charges">
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      type="number"
                      value={form.gstAmount || ""}
                      onChange={(e) =>
                        setForm({ ...form, gstAmount: Number(e.target.value) })
                      }
                    />
                    <Input
                      type="number"
                      value={form.otherCharges || ""}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          otherCharges: Number(e.target.value),
                        })
                      }
                    />
                  </div>
                </Field>
              </>
            ) : kind === "invocations" ? (
              <>
                <Field label="Notice Number">
                  <Input
                    value={form.noticeNumber || ""}
                    onChange={(e) =>
                      setForm({ ...form, noticeNumber: e.target.value })
                    }
                  />
                </Field>
                <Field label="Notice Date">
                  <Input
                    type="date"
                    value={form.noticeDate || ""}
                    onChange={(e) =>
                      setForm({ ...form, noticeDate: e.target.value })
                    }
                  />
                </Field>
                <Field label="Received Date">
                  <Input
                    type="date"
                    value={form.receivedDate || ""}
                    onChange={(e) =>
                      setForm({ ...form, receivedDate: e.target.value })
                    }
                  />
                </Field>
                <Field label="Claim Type">
                  <Select
                    value={form.claimType || "PARTIAL"}
                    onValueChange={(value) =>
                      setForm({ ...form, claimType: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PARTIAL">Partial</SelectItem>
                      <SelectItem value="FULL">Full</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Claimed Amount">
                  <Input
                    type="number"
                    value={form.claimedAmount || ""}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        claimedAmount: Number(e.target.value),
                      })
                    }
                  />
                </Field>
                <Field label="Bank Reference">
                  <Input
                    value={form.bankReference || ""}
                    onChange={(e) =>
                      setForm({ ...form, bankReference: e.target.value })
                    }
                  />
                </Field>
                <label className="flex items-center gap-2 rounded-lg border p-3 text-sm">
                  <Checkbox
                    checked={Boolean(form.legalReviewRequired)}
                    onCheckedChange={(value) =>
                      setForm({ ...form, legalReviewRequired: Boolean(value) })
                    }
                  />
                  Legal review required
                </label>
              </>
            ) : (
              <>
                <Field label="Bank Submission Date">
                  <Input
                    type="date"
                    value={form.bankSubmissionDate || ""}
                    onChange={(e) =>
                      setForm({ ...form, bankSubmissionDate: e.target.value })
                    }
                  />
                </Field>
                <Field label="Bank Reference">
                  <Input
                    value={form.bankReference || ""}
                    onChange={(e) =>
                      setForm({ ...form, bankReference: e.target.value })
                    }
                  />
                </Field>
                <Field label="FD Release Amount">
                  <Input
                    type="number"
                    value={form.fdReleaseAmount || ""}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        fdReleaseAmount: Number(e.target.value),
                      })
                    }
                  />
                </Field>
                <Field label="Cash Margin Release">
                  <Input
                    type="number"
                    value={form.cashMarginReleaseAmount || ""}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        cashMarginReleaseAmount: Number(e.target.value),
                      })
                    }
                  />
                </Field>
                {[
                  [
                    "projectCompletionConfirmed",
                    "Project completion confirmed",
                  ],
                  ["clientReleaseReceived", "Beneficiary release received"],
                  ["originalBgReturned", "Original BG returned"],
                  [
                    "noClaimConfirmationReceived",
                    "No-claim confirmation received",
                  ],
                ].map(([key, label]) => (
                  <label
                    key={key}
                    className="flex items-center gap-2 rounded-lg border p-3 text-sm"
                  >
                    <Checkbox
                      checked={Boolean(form[key])}
                      onCheckedChange={(value) =>
                        setForm({ ...form, [key]: Boolean(value) })
                      }
                    />
                    {label}
                  </label>
                ))}
              </>
            )}
            <div className="sm:col-span-2">
              <Field
                label={
                  kind === "extensions"
                    ? "Extension Reason"
                    : kind === "invocations"
                      ? "Claim Reason"
                      : "Cancellation Reason"
                }
              >
                <Textarea
                  value={
                    form[
                      kind === "extensions"
                        ? "reason"
                        : kind === "invocations"
                          ? "claimReason"
                          : "reason"
                    ] || ""
                  }
                  onChange={(e) =>
                    setForm({
                      ...form,
                      [kind === "invocations" ? "claimReason" : "reason"]:
                        e.target.value,
                    })
                  }
                />
              </Field>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={working || !bgId} onClick={() => void save()}>
              {working && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Submit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(completeRow)}
        onOpenChange={(value) => !value && !working && setCompleteRow(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Complete{" "}
              {kind === "extensions"
                ? "Extension"
                : kind === "invocations"
                  ? "Invocation Settlement"
                  : "Cancellation and Release"}
            </DialogTitle>
            <DialogDescription>{completeRow?.bgNumber}</DialogDescription>
          </DialogHeader>
          {kind === "cancellations" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Bank Confirmation Date">
                <Input
                  type="date"
                  value={form.bankConfirmationDate || ""}
                  onChange={(e) =>
                    setForm({ ...form, bankConfirmationDate: e.target.value })
                  }
                />
              </Field>
              <Field label="Cancellation Effective Date">
                <Input
                  type="date"
                  value={form.cancellationEffectiveDate || ""}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      cancellationEffectiveDate: e.target.value,
                    })
                  }
                />
              </Field>
              <Field label="Bank Reference">
                <Input
                  value={form.bankReference || ""}
                  onChange={(e) =>
                    setForm({ ...form, bankReference: e.target.value })
                  }
                />
              </Field>
              <label className="flex items-center gap-2 rounded-lg border p-3 text-sm">
                <Checkbox
                  checked={Boolean(form.authorizedOverride)}
                  onCheckedChange={(value) =>
                    setForm({ ...form, authorizedOverride: Boolean(value) })
                  }
                />
                Authorised release exception
              </label>
            </div>
          ) : kind === "invocations" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Settlement Amount">
                <Input
                  type="number"
                  value={form.settlementAmount || ""}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      settlementAmount: Number(e.target.value),
                    })
                  }
                />
              </Field>
              <Field label="Settlement Date">
                <Input
                  type="date"
                  value={form.settlementDate || ""}
                  onChange={(e) =>
                    setForm({ ...form, settlementDate: e.target.value })
                  }
                />
              </Field>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              This updates the current expiry and claim expiry while preserving
              the original dates and extension history.
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCompleteRow(null)}>
              Cancel
            </Button>
            <Button disabled={working} onClick={() => void complete()}>
              {working && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              <Check className="mr-2 h-4 w-4" />
              Complete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
