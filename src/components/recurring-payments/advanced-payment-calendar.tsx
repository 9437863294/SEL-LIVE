"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Loader2,
  Upload,
  WalletCards,
} from "lucide-react";
import { db } from "@/lib/firebase";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import {
  type PaymentObligation,
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
import { useGlobalScopes } from "./use-global-scopes";
const weekDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export default function AdvancedPaymentCalendar() {
  const { user, users } = useAuth();
  const { can } = useAuthorization();
  const organizationId = user?.organizationId || "default";
  const { activeProjects, activeDepartments } = useGlobalScopes();
  const [payments, setPayments] = useState<PaymentObligation[]>([]);
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  );
  const [selected, setSelected] = useState<PaymentObligation | null>(null);
  const [filters, setFilters] = useState({
    category: "all",
    vendor: "all",
    status: "all",
    owner: "all",
    project: "all",
    department: "all",
  });
  useEffect(
    () =>
      onSnapshot(
        query(
          collection(db, RP_COLLECTIONS.payments),
          where("organizationId", "==", organizationId),
        ),
        (snapshot) => {
          setPayments(
            snapshot.docs.map(
              (item) =>
                ({
                  id: item.id,
                  ...item.data(),
                  status: effectiveStatus({
                    id: item.id,
                    ...item.data(),
                  } as PaymentObligation),
                }) as PaymentObligation,
            ),
          );
          setLoading(false);
        },
        () => setLoading(false),
      ),
    [organizationId],
  );
  const visible = useMemo(
    () =>
      payments.filter(
        (item) =>
          (filters.category === "all" || item.category === filters.category) &&
          (filters.vendor === "all" || item.vendorName === filters.vendor) &&
          (filters.status === "all" || item.status === filters.status) &&
          (filters.owner === "all" || item.assignedTo === filters.owner) &&
          (filters.project === "all" ||
            item.projectId === filters.project ||
            item.projectName ===
              activeProjects.find((project) => project.id === filters.project)
                ?.projectName) &&
          (filters.department === "all" ||
            item.departmentId === filters.department ||
            item.department ===
              activeDepartments.find(
                (department) => department.id === filters.department,
              )?.name),
      ),
    [filters, payments, activeProjects, activeDepartments],
  );
  const monthRows = useMemo(
    () =>
      visible.filter((item) => {
        const date = new Date(`${item.dueDate}T00:00:00`);
        return (
          date.getFullYear() === month.getFullYear() &&
          date.getMonth() === month.getMonth()
        );
      }),
    [month, visible],
  );
  const cells = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
    const values: Array<Date | null> = Array(first.getDay()).fill(null);
    for (let day = 1; day <= last.getDate(); day++)
      values.push(new Date(month.getFullYear(), month.getMonth(), day));
    while (values.length % 7) values.push(null);
    return values;
  }, [month]);
  const options = (key: keyof PaymentObligation) =>
    [
      ...new Set(
        payments.map((item) => String(item[key] || "")).filter(Boolean),
      ),
    ].sort();
  const weekStart = useMemo(() => {
    const date = new Date();
    date.setDate(date.getDate() - date.getDay());
    date.setHours(0, 0, 0, 0);
    return date;
  }, []);
  const weekEnd = new Date(weekStart.getTime() + 6 * 86400000);
  const weekRows = visible.filter((item) => {
    const date = new Date(`${item.dueDate}T00:00:00`);
    return date >= weekStart && date <= weekEnd;
  });
  if (loading)
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin" />
      </div>
    );
  return (
    <div className="space-y-5">
      <Card className="border-0 bg-gradient-to-r from-cyan-800 to-indigo-800 text-white">
        <CardContent className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-2xl font-bold">Payment Calendar</h1>
            <p className="text-sm text-cyan-100">
              Monthly, weekly, list and agenda views of due-date commitments
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-cyan-100">Visible monthly value</p>
            <p className="text-2xl font-bold">
              {currency(
                monthRows.reduce(
                  (sum, item) =>
                    sum + Number(item.billAmount || item.expectedAmount),
                  0,
                ),
              )}
            </p>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
          <Filter
            value={filters.category}
            label="All categories"
            options={options("category")}
            onChange={(category) =>
              setFilters((current) => ({ ...current, category }))
            }
          />
          <Filter
            value={filters.vendor}
            label="All vendors"
            options={options("vendorName")}
            onChange={(vendor) =>
              setFilters((current) => ({ ...current, vendor }))
            }
          />
          <Filter
            value={filters.status}
            label="All statuses"
            options={options("status")}
            onChange={(status) =>
              setFilters((current) => ({ ...current, status }))
            }
          />
          <Select
            value={filters.owner}
            onValueChange={(owner) =>
              setFilters((current) => ({ ...current, owner }))
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="All users" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All users</SelectItem>
              {users.map((item) => (
                <SelectItem value={item.id} key={item.id}>
                  {item.name}
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
        </CardContent>
      </Card>
      <Tabs defaultValue="month">
        <TabsList>
          <TabsTrigger value="month">Monthly</TabsTrigger>
          <TabsTrigger value="week">Weekly</TabsTrigger>
          <TabsTrigger value="list">List</TabsTrigger>
          <TabsTrigger value="agenda">Agenda</TabsTrigger>
        </TabsList>
        <TabsContent value="month">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>
                  {month.toLocaleString("en-IN", {
                    month: "long",
                    year: "numeric",
                  })}
                </CardTitle>
                <CardDescription>{monthRows.length} payment(s)</CardDescription>
              </div>
              <div className="flex gap-2">
                <Button
                  size="icon"
                  variant="outline"
                  onClick={() =>
                    setMonth(
                      (current) =>
                        new Date(
                          current.getFullYear(),
                          current.getMonth() - 1,
                          1,
                        ),
                    )
                  }
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  onClick={() =>
                    setMonth(
                      new Date(
                        new Date().getFullYear(),
                        new Date().getMonth(),
                        1,
                      ),
                    )
                  }
                >
                  Today
                </Button>
                <Button
                  size="icon"
                  variant="outline"
                  onClick={() =>
                    setMonth(
                      (current) =>
                        new Date(
                          current.getFullYear(),
                          current.getMonth() + 1,
                          1,
                        ),
                    )
                  }
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-7 border-l border-t">
                {weekDays.map((day) => (
                  <div
                    className="border-b border-r bg-muted/40 p-2 text-center text-xs font-semibold"
                    key={day}
                  >
                    {day}
                  </div>
                ))}
                {cells.map((date, index) => {
                  const key = date ? dateOnly(date) : "";
                  const due = monthRows.filter((item) => item.dueDate === key);
                  return (
                    <div
                      className={`min-h-32 border-b border-r p-2 ${date ? "" : "bg-muted/20"}`}
                      key={index}
                    >
                      {date && (
                        <>
                          <div
                            className={`mb-2 flex h-7 w-7 items-center justify-center rounded-full text-xs ${key === dateOnly(new Date()) ? "bg-indigo-600 font-bold text-white" : ""}`}
                          >
                            {date.getDate()}
                          </div>
                          <div className="space-y-1">
                            {due.slice(0, 4).map((item) => (
                              <button
                                type="button"
                                key={item.id}
                                onClick={() => setSelected(item)}
                                className={`block w-full rounded-md border px-2 py-1 text-left text-[11px] ${tone(item.status)}`}
                              >
                                <p className="truncate font-medium">
                                  {item.title}
                                </p>
                                <p className="truncate">
                                  {currency(
                                    item.billAmount || item.expectedAmount,
                                  )}
                                </p>
                              </button>
                            ))}
                            {due.length > 4 && (
                              <Badge variant="secondary">
                                +{due.length - 4}
                              </Badge>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="week">
          <CalendarTable rows={weekRows} onOpen={setSelected} />
        </TabsContent>
        <TabsContent value="list">
          <CalendarTable
            rows={[...visible].sort((a, b) =>
              a.dueDate.localeCompare(b.dueDate),
            )}
            onOpen={setSelected}
          />
        </TabsContent>
        <TabsContent value="agenda">
          <Card>
            <CardContent className="space-y-5 p-5">
              {Object.entries(groupByDate(visible))
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([date, rows]) => (
                  <div key={date}>
                    <p className="mb-2 font-semibold">
                      {new Date(`${date}T00:00:00`).toLocaleDateString(
                        "en-IN",
                        { weekday: "long", day: "numeric", month: "long" },
                      )}
                    </p>
                    <div className="space-y-2">
                      {rows.map((item) => (
                        <button
                          type="button"
                          onClick={() => setSelected(item)}
                          key={item.id}
                          className="flex w-full items-center justify-between rounded-xl border p-3 text-left hover:bg-muted"
                        >
                          <div>
                            <p className="font-medium">{item.title}</p>
                            <p className="text-xs text-muted-foreground">
                              {item.vendorName} · {item.category}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="font-semibold">
                              {currency(item.billAmount || item.expectedAmount)}
                            </p>
                            <Badge variant="outline">{item.status}</Badge>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              {!visible.length && (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  No calendar events match the filters.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      <PaymentSummary
        payment={selected}
        onClose={() => setSelected(null)}
        canEdit={can("Edit", "Recurring Payments.Payments")}
        canRecord={
          can("Record Payment", "Recurring Payments.Payment Processing") ||
          can("Record Payment", "Recurring Payments.Payments")
        }
      />
    </div>
  );
}
function CalendarTable({
  rows,
  onOpen,
}: {
  rows: PaymentObligation[];
  onOpen: (item: PaymentObligation) => void;
}) {
  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Due date</TableHead>
              <TableHead>Payment</TableHead>
              <TableHead>Vendor</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((item) => (
              <TableRow
                key={item.id}
                className="cursor-pointer"
                onClick={() => onOpen(item)}
              >
                <TableCell>{item.dueDate}</TableCell>
                <TableCell>{item.title}</TableCell>
                <TableCell>{item.vendorName}</TableCell>
                <TableCell>{item.assignedTo || "—"}</TableCell>
                <TableCell className="text-right">
                  {currency(item.billAmount || item.expectedAmount)}
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{item.status}</Badge>
                </TableCell>
              </TableRow>
            ))}
            {!rows.length && (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="h-24 text-center text-muted-foreground"
                >
                  No payment events.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
function PaymentSummary({
  payment,
  onClose,
  canEdit,
  canRecord,
}: {
  payment: PaymentObligation | null;
  onClose: () => void;
  canEdit: boolean;
  canRecord: boolean;
}) {
  return (
    <Dialog open={!!payment} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{payment?.title}</DialogTitle>
          <DialogDescription>
            {payment?.vendorName} · due {payment?.dueDate}
          </DialogDescription>
        </DialogHeader>
        {payment && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Info
              label="Amount"
              value={currency(payment.billAmount || payment.expectedAmount)}
            />
            <Info label="Status" value={payment.status} />
            <Info
              label="Assigned person"
              value={payment.assignedTo || "Unassigned"}
            />
            <Info
              label="Scope"
              value={
                payment.projectName || payment.branchName || "Organization-wide"
              }
            />
          </div>
        )}
        <DialogFooter className="flex-wrap">
          {payment && (
            <Link href={`/recurring-payments/payments/${payment.id}`}>
              <Button>
                <ExternalLink className="mr-2 h-4 w-4" />
                View payment
              </Button>
            </Link>
          )}
          {payment &&
            canEdit &&
            ["Awaiting Bill", "Generated"].includes(payment.status) &&
            payment.currentStepId && (
              <Link href={`/recurring-payments/stage/${payment.currentStepId}`}>
                <Button variant="outline">
                  <Upload className="mr-2 h-4 w-4" />
                  Upload bill
                </Button>
              </Link>
            )}
          {payment &&
            canRecord &&
            ["Approved", "Payment Processing", "Partially Paid"].includes(
              payment.status,
            ) && (
              <Link
                href={`/recurring-payments/payments/${payment.id}/record-payment`}
              >
                <Button variant="outline">
                  <WalletCards className="mr-2 h-4 w-4" />
                  Record payment
                </Button>
              </Link>
            )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
function Filter({
  value,
  label,
  options,
  onChange,
}: {
  value: string;
  label: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{label}</SelectItem>
        {options.map((item) => (
          <SelectItem value={item} key={item}>
            {item}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  );
}
function dateOnly(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function tone(status: string) {
  return status === "Overdue"
    ? "border-red-200 bg-red-50 text-red-700"
    : status === "Paid" || status === "Closed"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : status === "Pending Approval"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : status === "On Hold"
          ? "border-slate-300 bg-slate-100 text-slate-700"
          : "border-indigo-200 bg-indigo-50 text-indigo-700";
}
function groupByDate(rows: PaymentObligation[]) {
  return rows.reduce<Record<string, PaymentObligation[]>>(
    (accumulator, item) => {
      (accumulator[item.dueDate] ??= []).push(item);
      return accumulator;
    },
    {},
  );
}
