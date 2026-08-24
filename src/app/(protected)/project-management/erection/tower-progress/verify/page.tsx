"use client";

/**
 * The verification queue (§19).
 *
 * A site engineer records progress; whoever holds the Verify right decides whether it is evidence.
 * Until that decision an update's photographs stay out of client-facing reports, and a rejection
 * keeps them out permanently while leaving the claim and the reason on the record — which is what
 * makes the gate worth having rather than a rubber stamp.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Crosshair, Loader2, ShieldCheck, ThumbsDown, ThumbsUp } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  TOWER_ACTIVITY_DEFINITIONS,
  TOWER_ACTIVITY_LIST,
  TOWER_PHOTO_KIND_LABELS,
  formatGps,
  formatKm,
  formatTowerDate,
  missingRequiredPhotoKinds,
  towerProgressHref,
  type TowerActivity,
  type TowerProgressUpdate,
} from "@/lib/project-management-tower-progress";
import { pendingVerificationUpdates } from "@/lib/project-management-tower-reports";
import { decideTowerProgressUpdate } from "@/lib/project-management-tower-service";
import { useTowerProgress } from "@/components/project-management/tower-progress/tower-progress-provider";
import {
  ActivityStatusBadge,
  EmptyState,
  MetricCard,
  TowerProgressGuard,
  TowerProgressHeader,
  TowerProgressNav,
  TowerProgressShell,
  TowerReportPhoto,
  VerificationBadge,
} from "@/components/project-management/tower-progress/tower-progress-ui";

export default function VerifyProgressPage() {
  const { permissions } = useTowerProgress();
  return (
    <TowerProgressGuard requires={permissions.verifyProgress} requiresLabel="progress verification">
      <VerifyQueue />
    </TowerProgressGuard>
  );
}

function VerifyQueue() {
  const { mappingId, project, updates, settings, actor, reload } = useTowerProgress();
  const { toast } = useToast();

  const [search, setSearch] = useState("");
  const [activity, setActivity] = useState<TowerActivity | "All">("All");
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState("");

  const pending = useMemo(() => {
    const queue = pendingVerificationUpdates(updates);
    const term = search.trim().toLowerCase();
    return queue.filter((update) => {
      if (activity !== "All" && update.activity !== activity) return false;
      if (!term) return true;
      return (
        update.towerNo.toLowerCase().includes(term) ||
        String(update.location ?? "").toLowerCase().includes(term) ||
        update.createdByName.toLowerCase().includes(term)
      );
    });
  }, [updates, search, activity]);

  const decided = useMemo(
    () =>
      updates
        .filter((update) => update.verificationState !== "Pending" && update.verifiedAt)
        .sort((a, b) => String(b.verifiedAt).localeCompare(String(a.verifiedAt)))
        .slice(0, 15),
    [updates],
  );

  const decide = async (update: TowerProgressUpdate, decision: "Approved" | "Rejected") => {
    if (!project || !actor) return;
    const note = remarks[update.id] ?? "";
    if (decision === "Rejected" && !note.trim()) {
      toast({
        title: "A rejection needs a reason",
        description: "The site has to know what to re-photograph or re-do.",
        variant: "destructive",
      });
      return;
    }
    setBusyId(update.id);
    try {
      await decideTowerProgressUpdate(project, update, decision, note, settings, actor);
      toast({
        title: `${update.towerNo} · ${TOWER_ACTIVITY_DEFINITIONS[update.activity].label} ${decision.toLowerCase()}`,
        description:
          decision === "Approved"
            ? "Its photographs can now appear in official reports."
            : "Its photographs will not appear in client reports, and the activity is back in the No Evidence report.",
      });
      setRemarks((current) => {
        const next = { ...current };
        delete next[update.id];
        return next;
      });
      await reload();
    } catch (error) {
      console.error("Failed to record the verification decision:", error);
      toast({
        title: "Could not record the decision",
        description: "Somebody may have decided it already. Refresh and check.",
        variant: "destructive",
      });
    } finally {
      setBusyId("");
    }
  };

  return (
    <TowerProgressShell>
      <TowerProgressHeader
        title="Verify progress"
        subtitle={
          project
            ? `Site claims awaiting sign-off on ${project.projectName}.`
            : "Site claims awaiting sign-off."
        }
        icon={ShieldCheck}
        backHref={towerProgressHref(mappingId)}
      />

      <TowerProgressNav />

      {!settings.requireVerification ? (
        <Alert>
          <AlertTitle>Verification is switched off for this project</AlertTitle>
          <AlertDescription>
            New updates are recorded as approved and reach reports immediately. Anything already in the
            queue is still shown below, and the gate can be switched back on in settings.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard
          label="Awaiting decision"
          value={pending.length}
          detail="Oldest shown first"
          tone={pending.length ? "warn" : "good"}
        />
        <MetricCard
          label="Approved"
          value={updates.filter((update) => update.verificationState === "Approved").length}
          detail="Cleared for client reports"
        />
        <MetricCard
          label="Rejected"
          value={updates.filter((update) => update.verificationState === "Rejected").length}
          detail="Excluded from evidence"
          tone={
            updates.some((update) => update.verificationState === "Rejected") ? "bad" : "neutral"
          }
        />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-base">Queue</CardTitle>
              <CardDescription>
                Check the photographs match the tower, the activity and the date claimed.
              </CardDescription>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Tower, location or engineer..."
                className="sm:w-56"
              />
              <Select
                value={activity}
                onValueChange={(value) => setActivity(value as TowerActivity | "All")}
              >
                <SelectTrigger className="sm:w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All activities</SelectItem>
                  {TOWER_ACTIVITY_LIST.map((definition) => (
                    <SelectItem key={definition.key} value={definition.key}>
                      {definition.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {!pending.length ? (
            <EmptyState
              title="Nothing waiting"
              description="Every recorded update has been decided. New site claims will appear here."
            />
          ) : (
            pending.map((update) => {
              const definition = TOWER_ACTIVITY_DEFINITIONS[update.activity];
              const missing = missingRequiredPhotoKinds(
                update.activity,
                update.photos.map((photo) => photo.kind),
              );
              const isBusy = busyId === update.id;
              return (
                <div key={update.id} className="space-y-3 rounded-lg border p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={towerProgressHref(mappingId, `towers/${update.towerId}`)}
                      className="text-base font-semibold hover:underline"
                    >
                      {update.towerNo}
                    </Link>
                    <span className="text-muted-foreground">·</span>
                    <span className="text-sm">{definition.label}</span>
                    <ActivityStatusBadge status={update.fromStatus} className="opacity-60" />
                    <span className="text-muted-foreground">→</span>
                    <ActivityStatusBadge status={update.toStatus} />
                    <Badge variant="outline" className="text-[11px]">
                      {formatTowerDate(update.progressDate)}
                    </Badge>
                    {update.quantityM ? (
                      <Badge variant="outline" className="text-[11px]">
                        {formatKm(update.quantityM)}
                      </Badge>
                    ) : null}
                    {update.evidenceShortfall ? (
                      <Badge className="bg-amber-100 text-[11px] text-amber-800">
                        Saved short of evidence
                      </Badge>
                    ) : null}
                  </div>

                  <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>Recorded by {update.createdByName || "unknown"}</span>
                    <span className="inline-flex items-center gap-1">
                      <Crosshair className="h-3 w-3" />
                      {update.gps
                        ? `${formatGps(update.gps)}${update.gps.accuracyM ? ` ±${update.gps.accuracyM}m` : ""}`
                        : "No GPS recorded"}
                    </span>
                    {update.location ? <span>{update.location}</span> : null}
                    {update.contractor ? <span>{update.contractor}</span> : null}
                  </p>

                  {update.reason ? (
                    <p className="text-sm font-medium text-red-700">{update.reason}</p>
                  ) : null}
                  {update.remarks ? <p className="text-sm">{update.remarks}</p> : null}

                  {missing.length ? (
                    <p className="text-xs text-amber-700">
                      This update does not carry the full set on its own — still missing{" "}
                      {missing.map((kind) => TOWER_PHOTO_KIND_LABELS[kind]).join(", ")}. Earlier
                      updates on this activity may cover them.
                    </p>
                  ) : null}

                  {update.photos.length ? (
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      {update.photos.map((photo) => (
                        <div key={photo.id} className="space-y-1">
                          <TowerReportPhoto
                            url={photo.url}
                            towerNo={update.towerNo}
                            activity={update.activity}
                            progressDate={update.progressDate}
                            gps={photo.gps}
                            uploadedByName={update.createdByName}
                          />
                          <p className="truncate text-[11px] text-muted-foreground">
                            {TOWER_PHOTO_KIND_LABELS[photo.kind]}
                            {photo.isReportPhoto ? " · report photo" : ""}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">No photographs on this update.</p>
                  )}

                  <div className="space-y-2">
                    <Label htmlFor={`verify-remarks-${update.id}`} className="text-xs">
                      Decision note (required to reject)
                    </Label>
                    <Textarea
                      id={`verify-remarks-${update.id}`}
                      value={remarks[update.id] ?? ""}
                      onChange={(event) =>
                        setRemarks((current) => ({ ...current, [update.id]: event.target.value }))
                      }
                      maxLength={500}
                      rows={2}
                    />
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      onClick={() => void decide(update, "Approved")}
                      disabled={isBusy}
                    >
                      {isBusy ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <ThumbsUp className="mr-2 h-4 w-4" />
                      )}
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-destructive text-destructive hover:bg-destructive/10"
                      onClick={() => void decide(update, "Rejected")}
                      disabled={isBusy}
                    >
                      <ThumbsDown className="mr-2 h-4 w-4" />
                      Reject
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      {decided.length ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Recent decisions</CardTitle>
            <CardDescription>The last {decided.length} verifications on this project.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {decided.map((update) => (
              <div
                key={update.id}
                className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm"
              >
                <CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground" />
                <Link
                  href={towerProgressHref(mappingId, `towers/${update.towerId}`)}
                  className="font-medium hover:underline"
                >
                  {update.towerNo}
                </Link>
                <span className="text-muted-foreground">
                  {TOWER_ACTIVITY_DEFINITIONS[update.activity].label}
                </span>
                <VerificationBadge state={update.verificationState} />
                <span className="text-xs text-muted-foreground">
                  by {update.verifiedByName || "—"}
                </span>
                {update.verificationRemarks ? (
                  <span className="text-xs italic text-muted-foreground">
                    “{update.verificationRemarks}”
                  </span>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </TowerProgressShell>
  );
}
