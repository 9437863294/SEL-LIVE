"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
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
import { PageHeader } from "@/components/shared/page-header";
import { ModuleTile, ModuleTileGrid } from "@/components/shared/module-tile";
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
        <PageHeader title={MODULE_NAME} icon={ShoppingCart} />
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
      <PageHeader
        title={MODULE_NAME}
        description="Global vendor registry shared across all projects"
        icon={ShoppingCart}
      />

      {/* ── Stats + Quick access ────────────────────────────────────────── */}
      {canViewVendors && (
        <div className="space-y-3">
          {!isLoading && (
            <Card className="overflow-hidden border-border/60 sm:max-w-xs">
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

          <ModuleTileGrid>
            <ModuleTile
              item={{
                icon: Truck,
                title: "Vendors",
                description: "Manage the global vendor registry.",
                href: "/vendor-management/vendors",
                gradient: "from-indigo-500 to-blue-600",
              }}
            />
          </ModuleTileGrid>
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
