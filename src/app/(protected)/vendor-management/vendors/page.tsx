"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Loader2,
  Pencil,
  Plus,
  ShieldAlert,
  Trash2,
  Truck,
} from "lucide-react";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useToast } from "@/hooks/use-toast";
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
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { Skeleton } from "@/components/ui/skeleton";
import {
  VENDOR_CATEGORIES,
  VENDOR_COLLECTIONS,
  generateVendorCode,
  type Vendor,
  type VendorCategory,
  type VendorStatus,
} from "@/lib/vendor-management";

const MODULE_NAME = "Vendor Management";

type VendorForm = {
  vendorName: string;
  category: VendorCategory;
  contactPerson: string;
  phone: string;
  email: string;
  address: string;
  gstin: string;
  pan: string;
  bankName: string;
  accountNumber: string;
  ifsc: string;
  status: VendorStatus;
  notes: string;
};

const emptyForm = (): VendorForm => ({
  vendorName: "",
  category: "Material Supplier",
  contactPerson: "",
  phone: "",
  email: "",
  address: "",
  gstin: "",
  pan: "",
  bankName: "",
  accountNumber: "",
  ifsc: "",
  status: "Active",
  notes: "",
});

export default function VendorsPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { user } = useAuth();
  const { toast } = useToast();

  const canView = can("View", `${MODULE_NAME}.Vendors`);
  const canAdd = can("Add", `${MODULE_NAME}.Vendors`);
  const canEdit = can("Edit", `${MODULE_NAME}.Vendors`);
  const canDelete = can("Delete", `${MODULE_NAME}.Vendors`);

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingVendor, setEditingVendor] = useState<Vendor | null>(null);
  const [form, setForm] = useState<VendorForm>(emptyForm());

  const loadVendors = useCallback(async () => {
    setIsLoading(true);
    try {
      const snapshot = await getDocs(collection(db, VENDOR_COLLECTIONS.vendors));
      const rows = snapshot.docs
        .map((d) => ({ id: d.id, ...d.data() }) as Vendor)
        .sort((a, b) => a.vendorName.localeCompare(b.vendorName));
      setVendors(rows);
    } catch (error) {
      console.error("Failed to load vendors:", error);
      toast({ title: "Unable to load vendors", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (isAuthLoading) return;
    if (!canView) {
      setIsLoading(false);
      return;
    }
    void loadVendors();
  }, [canView, isAuthLoading, loadVendors]);

  const openCreateDialog = () => {
    setEditingVendor(null);
    setForm(emptyForm());
    setIsDialogOpen(true);
  };

  const openEditDialog = (vendor: Vendor) => {
    setEditingVendor(vendor);
    setForm({
      vendorName: vendor.vendorName,
      category: vendor.category,
      contactPerson: vendor.contactPerson ?? "",
      phone: vendor.phone ?? "",
      email: vendor.email ?? "",
      address: vendor.address ?? "",
      gstin: vendor.gstin ?? "",
      pan: vendor.pan ?? "",
      bankName: vendor.bankName ?? "",
      accountNumber: vendor.accountNumber ?? "",
      ifsc: vendor.ifsc ?? "",
      status: vendor.status,
      notes: vendor.notes ?? "",
    });
    setIsDialogOpen(true);
  };

  const handleSave = async () => {
    const vendorName = form.vendorName.trim();
    if (!vendorName) {
      toast({ title: "Vendor name is required", variant: "destructive" });
      return;
    }

    setIsSaving(true);
    try {
      const payload = {
        vendorName,
        category: form.category,
        contactPerson: form.contactPerson.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        address: form.address.trim(),
        gstin: form.gstin.trim(),
        pan: form.pan.trim(),
        bankName: form.bankName.trim(),
        accountNumber: form.accountNumber.trim(),
        ifsc: form.ifsc.trim(),
        status: form.status,
        notes: form.notes.trim(),
        updatedAt: serverTimestamp(),
      };

      if (editingVendor) {
        await updateDoc(doc(db, VENDOR_COLLECTIONS.vendors, editingVendor.id), payload);
        toast({ title: "Vendor updated" });
      } else {
        const vendorRef = doc(collection(db, VENDOR_COLLECTIONS.vendors));
        await setDoc(vendorRef, {
          ...payload,
          vendorCode: generateVendorCode(vendorRef.id),
          createdAt: serverTimestamp(),
          createdBy: user?.id ?? "",
          createdByName: user?.name ?? "",
        });
        toast({ title: "Vendor created" });
      }

      setIsDialogOpen(false);
      setEditingVendor(null);
      setForm(emptyForm());
      await loadVendors();
    } catch (error) {
      console.error("Failed to save vendor:", error);
      toast({ title: "Unable to save vendor", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (vendor: Vendor) => {
    try {
      await deleteDoc(doc(db, VENDOR_COLLECTIONS.vendors, vendor.id));
      toast({ title: "Vendor deleted" });
      await loadVendors();
    } catch (error) {
      console.error("Failed to delete vendor:", error);
      toast({ title: "Unable to delete vendor", variant: "destructive" });
    }
  };

  if (isAuthLoading || (isLoading && canView)) {
    return (
      <main className="min-h-[calc(100vh-4rem)] p-4 sm:p-6">
        <Skeleton className="mb-6 h-9 w-64" />
        <Skeleton className="h-80 w-full" />
      </main>
    );
  }

  if (!canView) {
    return (
      <main className="min-h-[calc(100vh-4rem)] p-4 sm:p-6">
        <h1 className="mb-6 text-2xl font-bold sm:text-3xl">Vendors</h1>
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>You do not have permission to view the vendor registry.</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center p-8">
            <ShieldAlert className="h-16 w-16 text-destructive" />
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] p-4 sm:p-6">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/vendor-management" aria-label="Back to Vendor Management">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-blue-600 shadow-sm">
            <Truck className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold sm:text-3xl">Vendors</h1>
            <p className="mt-1 text-sm text-muted-foreground">Global vendor registry used across purchase orders.</p>
          </div>
        </div>

        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={openCreateDialog} disabled={!canAdd}>
              <Plus className="mr-2 h-4 w-4" /> New Vendor
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>{editingVendor ? "Edit Vendor" : "Create Vendor"}</DialogTitle>
              <DialogDescription>Vendor details are shared globally across all projects.</DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-2">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="vendor-name">Vendor Name *</Label>
                  <Input id="vendor-name" value={form.vendorName} onChange={(e) => setForm((c) => ({ ...c, vendorName: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="vendor-category">Category</Label>
                  <Select value={form.category} onValueChange={(category: VendorCategory) => setForm((c) => ({ ...c, category }))}>
                    <SelectTrigger id="vendor-category"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {VENDOR_CATEGORIES.map((category) => (
                        <SelectItem key={category} value={category}>{category}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="contact-person">Contact Person</Label>
                  <Input id="contact-person" value={form.contactPerson} onChange={(e) => setForm((c) => ({ ...c, contactPerson: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone">Phone</Label>
                  <Input id="phone" value={form.phone} onChange={(e) => setForm((c) => ({ ...c, phone: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" value={form.email} onChange={(e) => setForm((c) => ({ ...c, email: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="status">Status</Label>
                  <Select value={form.status} onValueChange={(status: VendorStatus) => setForm((c) => ({ ...c, status }))}>
                    <SelectTrigger id="status"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Active">Active</SelectItem>
                      <SelectItem value="Inactive">Inactive</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="address">Address</Label>
                <Textarea id="address" value={form.address} onChange={(e) => setForm((c) => ({ ...c, address: e.target.value }))} />
              </div>

              <div className="h-px bg-border" />

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="gstin">GSTIN</Label>
                  <Input id="gstin" value={form.gstin} onChange={(e) => setForm((c) => ({ ...c, gstin: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pan">PAN</Label>
                  <Input id="pan" value={form.pan} onChange={(e) => setForm((c) => ({ ...c, pan: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="bank-name">Bank Name</Label>
                  <Input id="bank-name" value={form.bankName} onChange={(e) => setForm((c) => ({ ...c, bankName: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="account-number">Account Number</Label>
                  <Input id="account-number" value={form.accountNumber} onChange={(e) => setForm((c) => ({ ...c, accountNumber: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ifsc">IFSC</Label>
                  <Input id="ifsc" value={form.ifsc} onChange={(e) => setForm((c) => ({ ...c, ifsc: e.target.value }))} />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="notes">Notes</Label>
                <Textarea id="notes" placeholder="Optional" value={form.notes} onChange={(e) => setForm((c) => ({ ...c, notes: e.target.value }))} />
              </div>
            </div>

            <DialogFooter>
              <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
              <Button onClick={() => void handleSave()} disabled={isSaving}>
                {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {editingVendor ? "Save Changes" : "Create Vendor"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="overflow-hidden border-border/60">
        <div className="h-1 w-full bg-gradient-to-r from-indigo-500 to-blue-600" />
        <CardHeader>
          <CardTitle className="text-lg">Vendor Registry</CardTitle>
          <CardDescription>{vendors.length} vendor{vendors.length === 1 ? "" : "s"} on file.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vendor Code</TableHead>
                  <TableHead>Vendor Name</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>GSTIN</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vendors.length ? vendors.map((vendor) => (
                  <TableRow key={vendor.id}>
                    <TableCell className="font-mono text-xs">{vendor.vendorCode}</TableCell>
                    <TableCell className="font-medium">{vendor.vendorName}</TableCell>
                    <TableCell>{vendor.category}</TableCell>
                    <TableCell>
                      <div className="flex flex-col text-sm">
                        <span>{vendor.contactPerson || "—"}</span>
                        <span className="text-xs text-muted-foreground">{vendor.phone || vendor.email || ""}</span>
                      </div>
                    </TableCell>
                    <TableCell>{vendor.gstin || "—"}</TableCell>
                    <TableCell>
                      <span
                        className={
                          vendor.status === "Active"
                            ? "rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700"
                            : "rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground"
                        }
                      >
                        {vendor.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="icon" onClick={() => openEditDialog(vendor)} disabled={!canEdit} aria-label={`Edit ${vendor.vendorName}`}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="destructive" size="icon" disabled={!canDelete} aria-label={`Delete ${vendor.vendorName}`}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete vendor?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This removes “{vendor.vendorName}” from the vendor registry. Existing purchase orders keep their own copy of the vendor name.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => void handleDelete(vendor)}>Delete Vendor</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </TableCell>
                  </TableRow>
                )) : (
                  <TableRow>
                    <TableCell colSpan={7} className="h-32 text-center">
                      <p className="font-medium">No vendors yet</p>
                      <p className="mt-1 text-sm text-muted-foreground">Create your first vendor to start raising purchase orders.</p>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
