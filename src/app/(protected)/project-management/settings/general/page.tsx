"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Save, Settings2, ShieldAlert } from "lucide-react";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { DEFAULT_VARIATION_TOLERANCE_PCT } from "@/lib/project-management-variations";
import { DEFAULT_PLAUSIBILITY_LIMIT_PCT } from "@/lib/project-management-survey";
import { DEFAULT_LEAD_TIME_DAYS } from "@/lib/project-management-requirement-planner";
import { DEFAULT_STALL_DAYS } from "@/lib/project-management-dashboard";
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
import { Skeleton } from "@/components/ui/skeleton";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useToast } from "@/hooks/use-toast";

const SETTINGS_PERMISSION = "Project Management.Settings";
const SETTINGS_COLLECTION = "projectManagementSettings";
const GENERAL_SETTINGS_DOC = "general";

export default function ProjectManagementGeneralSettingsPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { toast } = useToast();
  const canView = can("View", SETTINGS_PERMISSION);
  const canEdit = can("Edit", SETTINGS_PERMISSION);

  const [variationTolerancePct, setVariationTolerancePct] = useState(String(DEFAULT_VARIATION_TOLERANCE_PCT));
  const [plausibilityLimitPct, setPlausibilityLimitPct] = useState(String(DEFAULT_PLAUSIBILITY_LIMIT_PCT));
  const [leadTimeDays, setLeadTimeDays] = useState(String(DEFAULT_LEAD_TIME_DAYS));
  const [stallDays, setStallDays] = useState(String(DEFAULT_STALL_DAYS));
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isAuthLoading || !canView) {
      setIsLoading(false);
      return;
    }
    const load = async () => {
      try {
        const snapshot = await getDoc(doc(db, SETTINGS_COLLECTION, GENERAL_SETTINGS_DOC));
        const stored = snapshot.data()?.variationTolerancePct;
        if (typeof stored === "number") setVariationTolerancePct(String(stored));
        const storedPlausibility = snapshot.data()?.plausibilityLimitPct;
        if (typeof storedPlausibility === "number") setPlausibilityLimitPct(String(storedPlausibility));
        const storedLeadTime = snapshot.data()?.leadTimeDays;
        if (typeof storedLeadTime === "number") setLeadTimeDays(String(storedLeadTime));
        const storedStallDays = snapshot.data()?.stallDays;
        if (typeof storedStallDays === "number") setStallDays(String(storedStallDays));
      } catch (error) {
        console.error("Failed to load Project Management general settings:", error);
      } finally {
        setIsLoading(false);
      }
    };
    void load();
  }, [canView, isAuthLoading]);

  const handleSave = async () => {
    const pct = Number(variationTolerancePct);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      toast({ title: "Enter a tolerance between 0 and 100", variant: "destructive" });
      return;
    }
    const plausibility = Number(plausibilityLimitPct);
    if (!Number.isFinite(plausibility) || plausibility <= 0) {
      toast({ title: "Enter a valid plausibility limit", variant: "destructive" });
      return;
    }
    const leadTime = Number(leadTimeDays);
    if (!Number.isFinite(leadTime) || leadTime < 0) {
      toast({ title: "Enter a valid lead time", variant: "destructive" });
      return;
    }
    const stall = Number(stallDays);
    if (!Number.isFinite(stall) || stall < 1) {
      toast({ title: "Enter a stall threshold of at least 1 day", variant: "destructive" });
      return;
    }
    setIsSaving(true);
    try {
      await setDoc(
        doc(db, SETTINGS_COLLECTION, GENERAL_SETTINGS_DOC),
        {
          variationTolerancePct: pct,
          plausibilityLimitPct: plausibility,
          leadTimeDays: leadTime,
          stallDays: stall,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      toast({ title: "Settings saved" });
    } catch (error) {
      console.error("Failed to save Project Management general settings:", error);
      toast({ title: "Unable to save settings", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  if (isAuthLoading || isLoading) {
    return (
      <main className="min-h-[calc(100dvh-4rem)] p-4 sm:p-6">
        <Skeleton className="h-9 w-64" />
      </main>
    );
  }

  if (!canView) {
    return (
      <main className="min-h-[calc(100dvh-4rem)] p-4 sm:p-6">
        <h1 className="mb-6 text-2xl font-bold sm:text-3xl">General Settings</h1>
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>
              You do not have permission to access Project Management settings.
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
    <main className="min-h-[calc(100dvh-4rem)] p-4 sm:p-6">
      <div className="mb-6 flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/project-management/settings" aria-label="Back to Settings">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-slate-500 to-slate-700 shadow-sm">
          <Settings2 className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold sm:text-3xl">General Settings</h1>
          <p className="mt-1 text-sm text-muted-foreground">Module-wide defaults for Project Management.</p>
        </div>
      </div>

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle className="text-lg">Variation Order Tolerance</CardTitle>
          <CardDescription>
            When a surveyed or required quantity exceeds a BOQ item&apos;s stated quantity by more than this
            percentage, it can&apos;t be indented, ordered, or billed until an approved{" "}
            <Link href="/project-management/settings/variation-orders" className="underline underline-offset-2">
              variation order
            </Link>{" "}
            covers the excess.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="max-w-xs space-y-2">
            <Label htmlFor="variation-tolerance">Tolerance (%)</Label>
            <Input
              id="variation-tolerance"
              type="number"
              min="0"
              max="100"
              step="0.5"
              value={variationTolerancePct}
              disabled={!canEdit}
              onChange={(event) => setVariationTolerancePct(event.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <Card className="mt-4 max-w-xl">
        <CardHeader>
          <CardTitle className="text-lg">Survey Plausibility Limit</CardTitle>
          <CardDescription>
            A surveyed quantity deviating from the BOQ by more than this percentage is treated as a likely
            measurement error rather than a real variation — it&apos;s blocked pending re-survey instead of being
            approved.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="max-w-xs space-y-2">
            <Label htmlFor="plausibility-limit">Plausibility Limit (%)</Label>
            <Input
              id="plausibility-limit"
              type="number"
              min="1"
              step="10"
              value={plausibilityLimitPct}
              disabled={!canEdit}
              onChange={(event) => setPlausibilityLimitPct(event.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <Card className="mt-4 max-w-xl">
        <CardHeader>
          <CardTitle className="text-lg">Procurement Lead Time</CardTitle>
          <CardDescription>
            Default total lead time (RFQ → quotes → PO → manufacturing → inspection → dispatch → transit) used
            by the{" "}
            <Link href="/project-management/requirement-planner" className="underline underline-offset-2">
              Requirement Planner
            </Link>{" "}
            to back-calculate each BOQ line&apos;s indent-by date from its required-at-site date.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="max-w-xs space-y-2">
            <Label htmlFor="lead-time-days">Lead Time (days)</Label>
            <Input
              id="lead-time-days"
              type="number"
              min="0"
              step="1"
              value={leadTimeDays}
              disabled={!canEdit}
              onChange={(event) => setLeadTimeDays(event.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <Card className="mt-4 max-w-xl">
        <CardHeader>
          <CardTitle className="text-lg">Stall Threshold</CardTitle>
          <CardDescription>
            How many days a waiting record (an RFQ sent, an inspection or MDCC requested, a DI issued,
            an MVAC with the client) may age before the project control tower reports it as stalled.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="max-w-xs space-y-2">
            <Label htmlFor="stall-days">Stall Threshold (days)</Label>
            <Input
              id="stall-days"
              type="number"
              min="1"
              step="1"
              value={stallDays}
              disabled={!canEdit}
              onChange={(event) => setStallDays(event.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {canEdit && (
        <Button className="mt-4" onClick={handleSave} disabled={isSaving}>
          {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Save
        </Button>
      )}
    </main>
  );
}
