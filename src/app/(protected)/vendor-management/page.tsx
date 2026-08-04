"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Building2,
  ShieldAlert,
  ShoppingCart,
  Truck,
} from "lucide-react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuthorization } from "@/hooks/useAuthorization";
import { VENDOR_COLLECTIONS, type Vendor } from "@/lib/vendor-management";

const MODULE_NAME = "Vendor Management";

export default function VendorManagementPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const canViewModule = can("View Module", MODULE_NAME);
  const canViewVendors = can("View", `${MODULE_NAME}.Vendors`);

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (isAuthLoading || !canViewModule || !canViewVendors) {
      setIsLoading(false);
      return;
    }

    const load = async () => {
      setIsLoading(true);
      try {
        const snapshot = await getDocs(collection(db, VENDOR_COLLECTIONS.vendors));
        setVendors(snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as Vendor));
      } catch (error) {
        console.error("Failed to load Vendor Management overview:", error);
      } finally {
        setIsLoading(false);
      }
    };

    void load();
  }, [canViewModule, canViewVendors, isAuthLoading]);

  const activeVendorCount = useMemo(
    () => vendors.filter((vendor) => vendor.status === "Active").length,
    [vendors],
  );

  if (isAuthLoading) {
    return (
      <main className="min-h-[calc(100vh-4rem)] space-y-5 p-4 sm:p-6">
        <Skeleton className="h-28 w-full rounded-xl" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {[1, 2].map((i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      </main>
    );
  }

  if (!canViewModule) {
    return (
      <main className="min-h-[calc(100vh-4rem)] p-4 sm:p-6">
        <h1 className="mb-6 text-2xl font-bold sm:text-3xl">{MODULE_NAME}</h1>
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>
              You do not have permission to access this module.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center p-8">
            <ShieldAlert className="h-16 w-16 text-destructive" />
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] space-y-5 p-4 sm:p-6">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <Card className="relative overflow-hidden border-0 bg-gradient-to-r from-indigo-600 via-blue-600 to-teal-600 text-white shadow-lg">
        <div className="absolute inset-0 opacity-10 bg-[radial-gradient(ellipse_at_top_right,_white_0%,_transparent_60%)]" />
        <CardContent className="relative flex items-center gap-4 p-5">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/20 backdrop-blur-sm">
            <ShoppingCart className="h-7 w-7 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{MODULE_NAME}</h1>
            <p className="mt-0.5 text-sm text-blue-100">
              Global vendor registry shared across all projects
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ── Stats + Quick access ────────────────────────────────────────── */}
      {canViewVendors && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {!isLoading && (
            <Card className="overflow-hidden border-border/60">
              <CardContent className="flex items-center gap-3 p-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-blue-600 shadow-sm">
                  <Building2 className="h-5 w-5 text-white" />
                </div>
                <div>
                  <p className="text-2xl font-bold leading-tight">{activeVendorCount}</p>
                  <p className="text-xs text-muted-foreground">Active Vendors ({vendors.length} total)</p>
                </div>
              </CardContent>
            </Card>
          )}

          <Link href="/vendor-management/vendors" className="group no-underline">
            <Card className="h-full overflow-hidden border-border/60 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
              <div className="h-1 w-full bg-gradient-to-r from-indigo-500 to-blue-600" />
              <CardContent className="flex items-center gap-3 p-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-blue-600 shadow-sm">
                  <Truck className="h-5 w-5 text-white" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold leading-tight">Vendors</p>
                  <p className="truncate text-xs text-muted-foreground">Manage the global vendor registry.</p>
                </div>
                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1" />
              </CardContent>
            </Card>
          </Link>
        </div>
      )}

      <Card className="border-dashed">
        <CardContent className="p-4 text-sm text-muted-foreground">
          Purchase orders are now managed inside{" "}
          <Link href="/project-management" className="font-medium text-primary underline-offset-4 hover:underline">
            Project Management
          </Link>
          , scoped to each project&apos;s indents and RFQs.
        </CardContent>
      </Card>
    </main>
  );
}
