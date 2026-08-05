"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from "firebase/firestore";
import {
  getDownloadURL,
  ref as storageRef,
  uploadBytes,
} from "firebase/storage";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Download,
  ExternalLink,
  FileText,
  Filter,
  IndianRupee,
  Loader2,
  Plus,
  ReceiptText,
  Search,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import { db, storage } from "@/lib/firebase";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useToast } from "@/hooks/use-toast";
import {
  PaymentMode,
  PaymentObligation,
  PaymentTransaction,
  RecurringPaymentAuditLog,
  RP_COLLECTIONS,
  currency,
  effectiveStatus,
} from "@/lib/recurring-payments";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useGlobalScopes } from "./use-global-scopes";

type Filters = {
  search: string;
  status: string;
  category: string;
  vendor: string;
  owner: string;
  project: string;
  department: string;
  from: string;
  to: string;
  varianceOnly: boolean;
};
const initialFilters: Filters = {
  search: "",
  status: "all",
  category: "all",
  vendor: "all",
  owner: "all",
  project: "all",
  department: "all",
  from: "",
  to: "",
  varianceOnly: false,
};
const finalStatuses = ["Paid", "Closed", "Cancelled", "Waived"];

export default function RecurringPaymentRegister() {
  const router = useRouter();
  const { user, users } = useAuth();
  const { can } = useAuthorization();
  const { toast } = useToast();
  const organizationId = user?.organizationId || "default";
  const { activeProjects, activeDepartments } = useGlobalScopes();
  const [payments, setPayments] = useState<PaymentObligation[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [selected, setSelected] = useState<PaymentObligation | null>(null);
  const [recordOpen, setRecordOpen] = useState(false);
  useEffect(
    () =>
      onSnapshot(
        query(
          collection(db, RP_COLLECTIONS.payments),
          where("organizationId", "==", organizationId),
        ),
        (snap) => {
          setPayments(
            snap.docs.map(
              (d) => ({ id: d.id, ...d.data() }) as PaymentObligation,
            ),
          );
          setLoading(false);
        },
        () => setLoading(false),
      ),
    [organizationId],
  );
  const normalized = useMemo(
    () =>
      payments.map((p) => {
        const baseline = p.expectedAmount || 0;
        const actual = p.billAmount || baseline;
        const variance = baseline ? ((actual - baseline) / baseline) * 100 : 0;
        return {
          ...p,
          status: effectiveStatus(p),
          variancePercent: p.variancePercent ?? variance,
          varianceWarning: p.varianceWarning ?? Math.abs(variance) >= 20,
        };
      }),
    [payments],
  );
  const categories = useMemo(
    () =>
      [...new Set(normalized.map((x) => x.category).filter(Boolean))].sort(),
    [normalized],
  );
  const vendors = useMemo(
    () =>
      [...new Set(normalized.map((x) => x.vendorName).filter(Boolean))].sort(),
    [normalized],
  );
  const rows = useMemo(
    () =>
      normalized
        .filter((p) => {
          if (filters.status !== "all" && p.status !== filters.status)
            return false;
          if (filters.category !== "all" && p.category !== filters.category)
            return false;
          if (filters.vendor !== "all" && p.vendorName !== filters.vendor)
            return false;
          if (filters.owner !== "all" && p.assignedTo !== filters.owner)
            return false;
          if (
            filters.project !== "all" &&
            p.projectId !== filters.project &&
            p.projectName !==
              activeProjects.find((item) => item.id === filters.project)
                ?.projectName
          )
            return false;
          if (
            filters.department !== "all" &&
            p.departmentId !== filters.department &&
            p.department !==
              activeDepartments.find((item) => item.id === filters.department)
                ?.name
          )
            return false;
          if (filters.from && p.dueDate < filters.from) return false;
          if (filters.to && p.dueDate > filters.to) return false;
          if (filters.varianceOnly && !p.varianceWarning) return false;
          return `${p.title} ${p.vendorName} ${p.category} ${p.cycleKey} ${p.billNumber || ""} ${p.branchName || ""} ${p.projectName || ""} ${p.department || ""} ${p.costCentre || ""}`
            .toLowerCase()
            .includes(filters.search.toLowerCase());
        })
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    [normalized, filters, activeProjects, activeDepartments],
  );
  const totals = useMemo(
    () => ({
      due: rows.reduce((s, p) => s + (p.billAmount || p.expectedAmount), 0),
      paid: rows.reduce((s, p) => s + (p.paidAmount || 0), 0),
      overdue: rows.filter((p) => p.status === "Overdue").length,
      variance: rows.filter((p) => p.varianceWarning).length,
    }),
    [rows],
  );
  const canRecord =
    can("Record Payment", "Recurring Payments.Payment Processing") ||
    can("Record Payment", "Recurring Payments.Payments");
  const exportCsv = () => {
    const data = [
      [
        "Cycle",
        "Title",
        "Vendor",
        "Category",
        "Due Date",
        "Expected",
        "Bill",
        "Paid",
        "Outstanding",
        "Status",
        "Stage",
      ],
      ...rows.map((p) => [
        p.cycleKey,
        p.title,
        p.vendorName,
        p.category,
        p.dueDate,
        p.expectedAmount,
        p.billAmount || "",
        p.paidAmount,
        Math.max(
          0,
          (p.billAmount || p.expectedAmount) -
            (p.settledAmount || p.paidAmount),
        ),
        p.status,
        p.stage || "",
      ]),
    ];
    const blob = new Blob(
      [
        data
          .map((row) =>
            row.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(","),
          )
          .join("\n"),
      ],
      { type: "text/csv" },
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `recurring-payments-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  if (loading)
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-indigo-600" />
      </div>
    );
  return (
    <div className="space-y-5">
      <Card className="border-0 bg-gradient-to-r from-slate-900 via-indigo-900 to-violet-900 text-white">
        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-widest text-indigo-200">
              Finance operations
            </p>
            <h1 className="text-2xl font-bold">Payment Obligation Register</h1>
            <p className="text-sm text-indigo-100">
              Controlled register with workflow, documents, transactions and audit history
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={exportCsv}>
              <Download className="mr-2 h-4 w-4" />
              Export register
            </Button>
            {can("Add", "Recurring Payments.Payments") && (
              <Link href="/recurring-payments/payments/new">
                <Button className="bg-white text-indigo-900 hover:bg-indigo-50">
                  <Plus className="mr-2 h-4 w-4" />
                  Add manual payment
                </Button>
              </Link>
            )}
          </div>
        </CardContent>
      </Card>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric
          icon={WalletCards}
          label="Register value"
          value={currency(totals.due)}
          tone="blue"
        />
        <Metric
          icon={IndianRupee}
          label="Paid"
          value={currency(totals.paid)}
          tone="green"
        />
        <Metric
          icon={AlertTriangle}
          label="Overdue"
          value={totals.overdue}
          tone="red"
        />
        <Metric
          icon={ShieldCheck}
          label="Variance alerts"
          value={totals.variance}
          tone="amber"
        />
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Filter className="h-4 w-4" />
            Operational filters
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="relative sm:col-span-2">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Search title, bill number, vendor or cycle…"
              value={filters.search}
              onChange={(e) =>
                setFilters((f) => ({ ...f, search: e.target.value }))
              }
            />
          </div>
          <FilterSelect
            value={filters.status}
            onChange={(status) => setFilters((f) => ({ ...f, status }))}
            placeholder="All statuses"
            options={[...new Set(normalized.map((x) => x.status))]}
          />
          <FilterSelect
            value={filters.category}
            onChange={(category) => setFilters((f) => ({ ...f, category }))}
            placeholder="All categories"
            options={categories}
          />
          <FilterSelect
            value={filters.vendor}
            onChange={(vendor) => setFilters((f) => ({ ...f, vendor }))}
            placeholder="All vendors"
            options={vendors}
          />
          <Select
            value={filters.owner}
            onValueChange={(owner) => setFilters((f) => ({ ...f, owner }))}
          >
            <SelectTrigger>
              <SelectValue placeholder="All owners" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All owners</SelectItem>
              {users.map((x) => (
                <SelectItem value={x.id} key={x.id}>
                  {x.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={filters.project}
            onValueChange={(project) =>
              setFilters((current) => ({ ...current, project }))
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="All projects" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All global projects</SelectItem>
              {activeProjects.map((project) => (
                <SelectItem value={project.id} key={project.id}>
                  {project.projectName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={filters.department}
            onValueChange={(department) =>
              setFilters((current) => ({ ...current, department }))
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="All departments" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All global departments</SelectItem>
              {activeDepartments.map((department) => (
                <SelectItem value={department.id} key={department.id}>
                  {department.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="date"
            value={filters.from}
            onChange={(e) =>
              setFilters((f) => ({ ...f, from: e.target.value }))
            }
          />
          <Input
            type="date"
            value={filters.to}
            onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))}
          />
          <div className="flex items-center justify-between rounded-md border px-3">
            <span className="text-sm">Variance alerts only</span>
            <input
              type="checkbox"
              checked={filters.varianceOnly}
              onChange={(e) =>
                setFilters((f) => ({ ...f, varianceOnly: e.target.checked }))
              }
            />
          </div>
          <Button variant="ghost" onClick={() => setFilters(initialFilters)}>
            Clear filters
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>All payment obligations</CardTitle>
          <CardDescription>{rows.length} matching record(s)</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Payment</TableHead>
                  <TableHead>Vendor / Owner</TableHead>
                  <TableHead>Due date</TableHead>
                  <TableHead className="text-right">Bill amount</TableHead>
                  <TableHead className="text-right">
                    Paid / outstanding
                  </TableHead>
                  <TableHead>Workflow</TableHead>
                  <TableHead>Controls</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((payment) => {
                  const outstanding = Math.max(
                    0,
                    (payment.billAmount || payment.expectedAmount) -
                      (payment.settledAmount || payment.paidAmount),
                  );
                  return (
                    <TableRow
                      key={payment.id}
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() =>
                        router.push(
                          `/recurring-payments/payments/${payment.id}`,
                        )
                      }
                    >
                      <TableCell>
                        <div className="flex items-start gap-2">
                          {payment.varianceWarning && (
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                          )}
                          <div>
                            <p className="font-medium">{payment.title}</p>
                            <p className="text-xs text-muted-foreground">
                              {payment.category} · {payment.cycleKey}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <p>{payment.vendorName}</p>
                        <p className="text-xs text-muted-foreground">
                          {users.find((x) => x.id === payment.assignedTo)
                            ?.name || "Unassigned"}
                        </p>
                      </TableCell>
                      <TableCell>
                        <p>
                          {new Date(
                            `${payment.dueDate}T00:00:00`,
                          ).toLocaleDateString("en-IN")}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {daysLabel(payment.dueDate)}
                        </p>
                      </TableCell>
                      <TableCell className="text-right">
                        <p className="font-semibold">
                          {currency(
                            payment.billAmount || payment.expectedAmount,
                          )}
                        </p>
                        {payment.varianceWarning && (
                          <p className="text-xs text-amber-600">
                            {Number(payment.variancePercent).toFixed(1)}%
                            variance
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <p>{currency(payment.paidAmount || 0)}</p>
                        <p className="text-xs text-muted-foreground">
                          {currency(outstanding)} outstanding
                        </p>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{payment.status}</Badge>
                        <p className="mt-1 max-w-40 truncate text-xs text-muted-foreground">
                          {payment.stage || "—"}
                        </p>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {canRecord &&
                            !payment.currentStepId &&
                            !finalStatuses.includes(payment.status) && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelected(payment);
                                  setRecordOpen(true);
                                }}
                              >
                                <Plus className="mr-1 h-3 w-3" />
                                Payment
                              </Button>
                            )}
                          {payment.currentStepId && (
                            <Link
                              href={`/recurring-payments/stage/${payment.currentStepId}`}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Button size="icon" variant="ghost">
                                <ExternalLink className="h-4 w-4" />
                              </Button>
                            </Link>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {!rows.length && (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="h-36 text-center text-muted-foreground"
                    >
                      <CheckCircle2 className="mx-auto mb-2 h-9 w-9 text-emerald-400" />
                      No matching payment obligations.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
      <PaymentDetail
        payment={selected}
        users={users}
        onClose={() => {
          setSelected(null);
          setRecordOpen(false);
        }}
        canRecord={canRecord}
        recordOpen={recordOpen}
        setRecordOpen={setRecordOpen}
      />
    </div>
  );
}

function PaymentDetail({
  payment,
  users,
  onClose,
  canRecord,
  recordOpen,
  setRecordOpen,
}: {
  payment: PaymentObligation | null;
  users: Array<{ id: string; name: string }>;
  onClose: () => void;
  canRecord: boolean;
  recordOpen: boolean;
  setRecordOpen: (v: boolean) => void;
}) {
  const [transactions, setTransactions] = useState<PaymentTransaction[]>([]);
  const [audit, setAudit] = useState<RecurringPaymentAuditLog[]>([]);
  useEffect(() => {
    if (!payment) return;
    const stops = [
      onSnapshot(
        query(
          collection(
            db,
            RP_COLLECTIONS.payments,
            payment.id,
            RP_COLLECTIONS.transactions,
          ),
          orderBy("createdAt", "desc"),
        ),
        (s) =>
          setTransactions(
            s.docs.map(
              (d) => ({ id: d.id, ...d.data() }) as PaymentTransaction,
            ),
          ),
      ),
      onSnapshot(
        query(
          collection(
            db,
            RP_COLLECTIONS.payments,
            payment.id,
            RP_COLLECTIONS.auditLogs,
          ),
          orderBy("createdAt", "desc"),
        ),
        (s) =>
          setAudit(
            s.docs.map(
              (d) => ({ id: d.id, ...d.data() }) as RecurringPaymentAuditLog,
            ),
          ),
      ),
    ];
    return () => stops.forEach((stop) => stop());
  }, [payment]);
  if (!payment) return null;
  const amount = payment.billAmount || payment.expectedAmount;
  const outstanding = Math.max(
    0,
    amount - (payment.settledAmount || payment.paidAmount),
  );
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[94vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{payment.title}</DialogTitle>
          <DialogDescription>
            {payment.vendorName} · {payment.cycleKey}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Summary label="Bill amount" value={currency(amount)} />
          <Summary label="Paid" value={currency(payment.paidAmount)} />
          <Summary label="Outstanding" value={currency(outstanding)} />
          <Summary label="Status" value={payment.status} />
        </div>
        <Tabs defaultValue="overview">
          <TabsList className="grid h-auto grid-cols-5">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="workflow">Workflow</TabsTrigger>
            <TabsTrigger value="transactions">Transactions</TabsTrigger>
            <TabsTrigger value="documents">Documents</TabsTrigger>
            <TabsTrigger value="audit">Audit</TabsTrigger>
          </TabsList>
          <TabsContent
            value="overview"
            className="grid gap-4 pt-3 sm:grid-cols-2"
          >
            <Info label="Category" value={payment.category} />
            <Info
              label="Payment owner"
              value={
                users.find((x) => x.id === payment.assignedTo)?.name ||
                "Unassigned"
              }
            />
            <Info
              label="Billing period"
              value={`${payment.billingPeriodStart} to ${payment.billingPeriodEnd}`}
            />
            <Info label="Due date" value={payment.dueDate} />
            <Info
              label="Expected amount"
              value={currency(payment.expectedAmount)}
            />
            <Info
              label="Variance"
              value={`${Number(payment.variancePercent || 0).toFixed(1)}%`}
            />
            <Info label="Current stage" value={payment.stage || "—"} />
            <Info
              label="Approval mode"
              value={payment.approvalMode || "Standard workflow"}
            />
          </TabsContent>
          <TabsContent value="workflow" className="space-y-2 pt-3">
            {(payment.workflowHistory || []).map((item, index) => (
              <div key={index} className="flex gap-3 rounded-lg border p-3">
                <div className="rounded-full bg-indigo-100 p-2">
                  <ShieldCheck className="h-4 w-4 text-indigo-600" />
                </div>
                <div>
                  <p className="font-medium">
                    {item.action} · {item.stepName}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {item.userName}
                    {item.comment ? ` — ${item.comment}` : ""} ·{" "}
                    {formatTimestamp(item.timestamp)}
                  </p>
                </div>
              </div>
            ))}
            {!(payment.workflowHistory || []).length && (
              <Empty text="Workflow has not started." />
            )}
          </TabsContent>
          <TabsContent value="transactions" className="space-y-3 pt-3">
            <div className="flex justify-end">
              {canRecord &&
                !payment.currentStepId &&
                !finalStatuses.includes(payment.status) && (
                  <Button onClick={() => setRecordOpen(true)}>
                    <Plus className="mr-2 h-4 w-4" />
                    Record legacy transaction
                  </Button>
                )}
              {payment.currentStepId && (
                <Link
                  href={`/recurring-payments/stage/${payment.currentStepId}`}
                >
                  <Button variant="outline">
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Open assigned workflow step
                  </Button>
                </Link>
              )}
            </div>
            {transactions.map((tx) => (
              <div
                key={tx.id}
                className="grid gap-2 rounded-xl border p-4 sm:grid-cols-[1fr_1fr_1fr_auto]"
              >
                <div>
                  <p className="font-medium">{tx.paymentDate}</p>
                  <p className="text-xs text-muted-foreground">{tx.mode}</p>
                </div>
                <div>
                  <p className="font-semibold">{currency(tx.amount)}</p>
                  <p className="text-xs text-muted-foreground">
                    TDS {currency(tx.tdsAmount)}
                  </p>
                </div>
                <div>
                  <p className="font-mono text-sm">{tx.transactionReference}</p>
                  <p className="text-xs text-muted-foreground">
                    {tx.paidByName}
                  </p>
                </div>
                {tx.receiptUrl ? (
                  <a href={tx.receiptUrl} target="_blank" rel="noreferrer">
                    <Button variant="outline" size="sm">
                      <ReceiptText className="mr-1 h-3 w-3" />
                      Receipt
                    </Button>
                  </a>
                ) : (
                  <Badge variant="outline">No receipt</Badge>
                )}
              </div>
            ))}
            {!transactions.length && (
              <Empty text="No payment transactions recorded." />
            )}
          </TabsContent>
          <TabsContent
            value="documents"
            className="grid gap-3 pt-3 sm:grid-cols-2"
          >
            {(payment.documentReferences || []).map((file, index) => (
              <a
                href={file.reference}
                target="_blank"
                rel="noreferrer"
                key={index}
                className="flex items-center gap-3 rounded-lg border p-3 hover:bg-muted"
              >
                <FileText className="h-5 w-5 text-indigo-600" />
                <div>
                  <p className="font-medium">{file.action}</p>
                  <p className="text-xs text-muted-foreground">
                    Step {file.stepId} · {formatTimestamp(file.addedAt)}
                  </p>
                </div>
              </a>
            ))}
            {!(payment.documentReferences || []).length && (
              <Empty text="No supporting documents attached." />
            )}
          </TabsContent>
          <TabsContent value="audit" className="space-y-2 pt-3">
            {audit.map((log) => (
              <div
                key={log.id}
                className="flex items-start justify-between rounded-lg border p-3"
              >
                <div>
                  <p className="font-medium">{log.action}</p>
                  <p className="text-sm text-muted-foreground">{log.summary}</p>
                  <p className="text-xs text-muted-foreground">
                    {log.userName}
                  </p>
                </div>
                <span className="text-xs text-muted-foreground">
                  {formatTimestamp(log.createdAt)}
                </span>
              </div>
            ))}
            {!audit.length && <Empty text="No audit events recorded yet." />}
          </TabsContent>
        </Tabs>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
        <TransactionDialog
          open={recordOpen}
          onClose={() => setRecordOpen(false)}
          payment={payment}
        />
      </DialogContent>
    </Dialog>
  );
}

function TransactionDialog({
  open,
  onClose,
  payment,
}: {
  open: boolean;
  onClose: () => void;
  payment: PaymentObligation;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!user) return;
    const form = new FormData(e.currentTarget);
    const amount = Number(form.get("amount") || 0);
    const tdsAmount = Number(form.get("tdsAmount") || 0);
    const gstAmount = Number(form.get("gstAmount") || 0);
    const deductionAmount = Number(form.get("deductionAmount") || 0);
    const adjustmentAmount = Number(form.get("adjustmentAmount") || 0);
    const transactionReference = String(
      form.get("transactionReference") || "",
    ).trim();
    if (amount <= 0 || !transactionReference)
      return toast({
        title: "Amount and transaction reference are required",
        variant: "destructive",
      });
    setSaving(true);
    try {
      const txCollection = collection(
        db,
        RP_COLLECTIONS.payments,
        payment.id,
        RP_COLLECTIONS.transactions,
      );
      const duplicate = await getDocs(
        query(
          txCollection,
          where("transactionReference", "==", transactionReference),
        ),
      );
      if (!duplicate.empty)
        throw new Error(
          "This transaction reference is already recorded against the payment.",
        );
      let receiptUrl = "";
      const receipt = form.get("receipt");
      if (receipt instanceof File && receipt.size) {
        const safe = receipt.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const uploadRef = storageRef(
          storage,
          `recurring-payments/${payment.organizationId}/${payment.id}/transactions/${Date.now()}-${safe}`,
        );
        await uploadBytes(uploadRef, receipt);
        receiptUrl = await getDownloadURL(uploadRef);
      }
      const appliedAmount =
        amount + tdsAmount + deductionAmount + adjustmentAmount;
      const paymentDate = form.get("paymentDate");
      const mode = form.get("mode");
      const paymentRef = doc(db, RP_COLLECTIONS.payments, payment.id);
      const txRef = doc(txCollection);
      const auditRef = doc(
        collection(
          db,
          RP_COLLECTIONS.payments,
          payment.id,
          RP_COLLECTIONS.auditLogs,
        ),
      );
      // Read the payment inside the transaction so settledAmount/status/outstandingAmount
      // are derived from a fresh value, not the possibly-stale `payment` prop — otherwise two
      // near-simultaneous transactions could leave the totals and status out of sync.
      const newStatus = await runTransaction(db, async (transaction) => {
        const snapshot = await transaction.get(paymentRef);
        if (!snapshot.exists()) throw new Error("Payment no longer exists.");
        const current = { id: snapshot.id, ...snapshot.data() } as PaymentObligation;
        const billAmount = current.billAmount || current.expectedAmount;
        const newSettled =
          (current.settledAmount || current.paidAmount || 0) + appliedAmount;
        const newStatus: "Paid" | "Partially Paid" = newSettled >= billAmount ? "Paid" : "Partially Paid";
        transaction.set(txRef, {
          organizationId: current.organizationId,
          paymentId: payment.id,
          paymentDate,
          amount,
          mode,
          bankAccount: form.get("bankAccount") || "",
          transactionReference,
          chequeNumber: form.get("chequeNumber") || "",
          tdsAmount,
          gstAmount,
          deductionAmount,
          adjustmentAmount,
          remarks: form.get("remarks") || "",
          receiptUrl,
          paidBy: user.id,
          paidByName: user.name,
          createdAt: serverTimestamp(),
        });
        transaction.update(paymentRef, {
          paidAmount: (current.paidAmount || 0) + amount,
          settledAmount: newSettled,
          outstandingAmount: Math.max(0, billAmount - newSettled),
          status: newStatus,
          paymentDate,
          transactionReference,
          updatedAt: serverTimestamp(),
        });
        transaction.set(auditRef, {
          organizationId: current.organizationId,
          paymentId: payment.id,
          action: "Payment transaction recorded",
          summary: `${currency(amount)} via ${mode} (${transactionReference})`,
          userId: user.id,
          userName: user.name,
          metadata: { amount, appliedAmount, mode, transactionReference },
          createdAt: serverTimestamp(),
        });
        return newStatus;
      });
      toast({
        title: "Payment transaction recorded",
        description:
          newStatus === "Paid"
            ? "The bill is fully settled."
            : "The bill remains partially paid.",
      });
      onClose();
    } catch (error) {
      toast({
        title: "Transaction could not be saved",
        description:
          error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Record payment transaction</DialogTitle>
          <DialogDescription>
            {payment.title} · outstanding{" "}
            {currency(
              Math.max(
                0,
                (payment.billAmount || payment.expectedAmount) -
                  (payment.settledAmount || payment.paidAmount),
              ),
            )}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <Field label="Payment date">
            <Input
              name="paymentDate"
              type="date"
              defaultValue={new Date().toISOString().slice(0, 10)}
              required
            />
          </Field>
          <Field label="Paid amount">
            <Input
              name="amount"
              type="number"
              min="0.01"
              step="0.01"
              required
            />
          </Field>
          <Field label="Payment mode">
            <Select name="mode" defaultValue="NEFT">
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(
                  [
                    "NEFT",
                    "RTGS",
                    "IMPS",
                    "UPI",
                    "Cheque",
                    "Cash",
                    "Credit Card",
                    "Auto-debit",
                    "Bank Transfer",
                    "Other",
                  ] as PaymentMode[]
                ).map((x) => (
                  <SelectItem value={x} key={x}>
                    {x}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Bank account">
            <Input name="bankAccount" />
          </Field>
          <Field label="Transaction / UTR reference">
            <Input name="transactionReference" required />
          </Field>
          <Field label="Cheque number">
            <Input name="chequeNumber" />
          </Field>
          <Field label="TDS amount">
            <Input name="tdsAmount" type="number" min="0" defaultValue="0" />
          </Field>
          <Field label="GST amount">
            <Input name="gstAmount" type="number" min="0" defaultValue="0" />
          </Field>
          <Field label="Other deduction">
            <Input
              name="deductionAmount"
              type="number"
              min="0"
              defaultValue="0"
            />
          </Field>
          <Field label="Adjustment amount">
            <Input name="adjustmentAmount" type="number" defaultValue="0" />
          </Field>
          <Field label="Payment receipt">
            <Input
              name="receipt"
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.webp"
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Remarks">
              <Textarea name="remarks" />
            </Field>
          </div>
          <DialogFooter className="sm:col-span-2">
            <Button variant="outline" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Record transaction
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
function FilterSelect({
  value,
  onChange,
  placeholder,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  options: string[];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{placeholder}</SelectItem>
        {options.map((x) => (
          <SelectItem value={x} key={x}>
            {x}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
function Metric({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  tone: "blue" | "green" | "red" | "amber";
}) {
  const colors = {
    blue: "bg-blue-100 text-blue-600",
    green: "bg-emerald-100 text-emerald-600",
    red: "bg-red-100 text-red-600",
    amber: "bg-amber-100 text-amber-600",
  };
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className={`rounded-xl p-2.5 ${colors[tone]}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-xl font-bold">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}
function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-semibold">{value}</p>
    </div>
  );
}
function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <div className="col-span-full rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
function formatTimestamp(value: unknown) {
  const data = value as { toDate?: () => Date; seconds?: number } | null;
  if (data?.toDate) return data.toDate().toLocaleString("en-IN");
  if (data?.seconds)
    return new Date(data.seconds * 1000).toLocaleString("en-IN");
  return "—";
}
function daysLabel(date: string) {
  const due = new Date(`${date}T00:00:00`);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((due.getTime() - today.getTime()) / 86400000);
  return days < 0
    ? `${Math.abs(days)} day(s) overdue`
    : days === 0
      ? "Due today"
      : `Due in ${days} day(s)`;
}
