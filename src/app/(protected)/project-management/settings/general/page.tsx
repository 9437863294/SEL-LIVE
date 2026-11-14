"use client";

/**
 * Settings › General Settings — the container: permissions, the stored values, and the save.
 * Everything on screen is `GeneralSettingsView` (props-only, so it can be rendered with fabricated
 * data).
 */

import { useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { DEFAULT_VARIATION_TOLERANCE_PCT } from "@/lib/project-management-variations";
import { DEFAULT_PLAUSIBILITY_LIMIT_PCT } from "@/lib/project-management-survey";
import { DEFAULT_LEAD_TIME_DAYS } from "@/lib/project-management-requirement-planner";
import { DEFAULT_STALL_DAYS } from "@/lib/project-management-dashboard";
import {
  GeneralSettingsView,
  type GeneralSettingsValues,
} from "@/components/project-management/general-settings-view";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/shared/page-header";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useToast } from "@/hooks/use-toast";

const SETTINGS_PERMISSION = "Project Management.Settings";
const SETTINGS_COLLECTION = "projectManagementSettings";
const GENERAL_SETTINGS_DOC = "general";

const DEFAULTS: GeneralSettingsValues = {
  variationTolerancePct: DEFAULT_VARIATION_TOLERANCE_PCT,
  plausibilityLimitPct: DEFAULT_PLAUSIBILITY_LIMIT_PCT,
  leadTimeDays: DEFAULT_LEAD_TIME_DAYS,
  stallDays: DEFAULT_STALL_DAYS,
};

export default function ProjectManagementGeneralSettingsPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { toast } = useToast();
  const canView = can("View", SETTINGS_PERMISSION);
  const canEdit = can("Edit", SETTINGS_PERMISSION);

  const [saved, setSaved] = useState<GeneralSettingsValues>(DEFAULTS);
  const [isLoading, setIsLoading] = useState(true);

  // Without View the page shows Access Denied and never reads, so "loading" only matters with it.
  useEffect(() => {
    if (isAuthLoading || !canView) return;
    const load = async () => {
      try {
        const data = (await getDoc(doc(db, SETTINGS_COLLECTION, GENERAL_SETTINGS_DOC))).data() ?? {};
        const read = (key: keyof GeneralSettingsValues) =>
          typeof data[key] === "number" ? (data[key] as number) : DEFAULTS[key];
        setSaved({
          variationTolerancePct: read("variationTolerancePct"),
          plausibilityLimitPct: read("plausibilityLimitPct"),
          leadTimeDays: read("leadTimeDays"),
          stallDays: read("stallDays"),
        });
      } catch (error) {
        console.error("Failed to load Project Management general settings:", error);
      } finally {
        setIsLoading(false);
      }
    };
    void load();
  }, [canView, isAuthLoading]);

  const handleSave = async (values: GeneralSettingsValues): Promise<boolean> => {
    if (!canEdit) return false;
    // The view holds each value to these limits as it is typed; they stay here as the last word.
    const pct = values.variationTolerancePct;
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      toast({ title: "Enter a tolerance between 0 and 100", variant: "destructive" });
      return false;
    }
    const plausibility = values.plausibilityLimitPct;
    if (!Number.isFinite(plausibility) || plausibility <= 0) {
      toast({ title: "Enter a valid plausibility limit", variant: "destructive" });
      return false;
    }
    const leadTime = values.leadTimeDays;
    if (!Number.isFinite(leadTime) || leadTime < 0) {
      toast({ title: "Enter a valid lead time", variant: "destructive" });
      return false;
    }
    const stall = values.stallDays;
    if (!Number.isFinite(stall) || stall < 1) {
      toast({ title: "Enter a stall threshold of at least 1 day", variant: "destructive" });
      return false;
    }
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
      setSaved({ variationTolerancePct: pct, plausibilityLimitPct: plausibility, leadTimeDays: leadTime, stallDays: stall });
      toast({ title: "Settings saved" });
      return true;
    } catch (error) {
      console.error("Failed to save Project Management general settings:", error);
      toast({ title: "Unable to save settings", variant: "destructive" });
      return false;
    }
  };

  if (isAuthLoading || (canView && isLoading)) {
    return (
      <main className="min-h-[calc(100dvh-4rem)] p-4 sm:p-6">
        <Skeleton className="mb-4 h-28 w-full rounded-3xl" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-56 rounded-[22px]" />
          ))}
        </div>
      </main>
    );
  }

  if (!canView) {
    return (
      <main className="min-h-[calc(100dvh-4rem)] p-4 sm:p-6">
        <PageHeader title="General Settings" />
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
    <main className="min-h-[calc(100dvh-4rem)] p-4 max-sm:[--card-pad:1rem] sm:p-6">
      <GeneralSettingsView saved={saved} canEdit={canEdit} onSave={handleSave} />
    </main>
  );
}
