"use client";

/**
 * The one form a site engineer fills in: a tower's activity moved to a new status, with the
 * photographs that prove it.
 *
 * Everything else in this feature is a read of what this dialog writes, so it carries the whole
 * control surface — allowed transitions only, evidence checked against the activity's minimum set,
 * GPS captured where the project demands it, and out-of-sequence work flagged but not refused. The
 * rules themselves live in the domain library; this is the form around them.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Crosshair,
  Info,
  Loader2,
  X,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  TOWER_ACTIVITY_DEFINITIONS,
  TOWER_ACTIVITY_LIST,
  TOWER_PHOTO_KIND_LABELS,
  activityStatusNeedsReason,
  formatGps,
  isActivityComplete,
  missingRequiredPhotoKinds,
  nextActivityStatuses,
  photoKindsForActivity,
  validateTowerProgressUpdate,
  type ProjectTower,
  type TowerActivity,
  type TowerActivityStatus,
  type TowerGpsFix,
  type TowerPhotoKind,
} from "@/lib/project-management-tower-progress";
import {
  captureGpsFix,
  recordTowerProgressUpdate,
  todayKey,
  type PhotoUploadInput,
} from "@/lib/project-management-tower-service";
import { useTowerProgress } from "./tower-progress-provider";
import { ActivityStatusBadge } from "./tower-progress-ui";

/** A file the user has chosen, with the evidence slot they assigned it to. */
interface StagedPhoto {
  id: string;
  file: File;
  kind: TowerPhotoKind;
  isReportPhoto: boolean;
  previewUrl: string;
}

/**
 * Upload limits. A modern phone produces 4–8 MB per frame and a foundation completion carries four
 * of them, over a site link that is frequently 2G — so the cap is generous enough for a full-quality
 * camera photo but low enough that a mis-selected video or scanned PDF-as-image is refused before it
 * ties the connection up for ten minutes. Photographs are stored as uploaded, without re-encoding,
 * because a re-compressed photograph is weaker evidence than the original.
 */
const MAX_PHOTO_BYTES = 12 * 1024 * 1024;
const MAX_PHOTOS_PER_UPDATE = 10;

export function ProgressUpdateDialog({
  tower,
  activity,
  open,
  onOpenChange,
  onSaved,
}: {
  tower: ProjectTower | null;
  activity: TowerActivity;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}) {
  const { project, settings, actor, reload } = useTowerProgress();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [selectedActivity, setSelectedActivity] = useState<TowerActivity>(activity);
  const [toStatus, setToStatus] = useState<TowerActivityStatus>("In Progress");
  const [progressDate, setProgressDate] = useState(todayKey());
  const [remarks, setRemarks] = useState("");
  const [reason, setReason] = useState("");
  const [quantity, setQuantity] = useState("");
  const [gps, setGps] = useState<TowerGpsFix | null>(null);
  const [isCapturingGps, setIsCapturingGps] = useState(false);
  const [photos, setPhotos] = useState<StagedPhoto[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const state = tower?.activities[selectedActivity];
  const fromStatus = state?.status ?? "Not Started";
  const definition = TOWER_ACTIVITY_DEFINITIONS[selectedActivity];

  /** Object URLs have to be released by hand or every dialog open leaks its previews. */
  const clearPhotos = useCallback(() => {
    setPhotos((current) => {
      current.forEach((photo) => URL.revokeObjectURL(photo.previewUrl));
      return [];
    });
  }, []);

  // Reset on open so a second update never inherits the first one's date, remarks or photographs.
  useEffect(() => {
    if (!open) return;
    setSelectedActivity(activity);
    setProgressDate(todayKey());
    setRemarks("");
    setReason("");
    setQuantity("");
    setGps(null);
    clearPhotos();
  }, [open, activity, clearPhotos]);

  // The default next status is the most likely one: the first allowed transition, which for an
  // activity in progress is Completed and for a fresh one is Ready.
  useEffect(() => {
    const allowed = nextActivityStatuses(fromStatus);
    setToStatus(allowed[0] ?? fromStatus);
  }, [fromStatus, selectedActivity]);

  useEffect(() => () => clearPhotos(), [clearPhotos]);

  // A project that mandates GPS gets the fix requested as the dialog opens, so the engineer is not
  // left pressing a button after filling the form in.
  useEffect(() => {
    if (!open || !settings.requireGps || gps) return;
    let cancelled = false;
    setIsCapturingGps(true);
    void captureGpsFix().then((fix) => {
      if (cancelled) return;
      setGps(fix);
      setIsCapturingGps(false);
    });
    return () => {
      cancelled = true;
    };
  }, [open, settings.requireGps, gps]);

  const stagedKinds = useMemo(() => photos.map((photo) => photo.kind), [photos]);

  const validation = useMemo(() => {
    if (!tower) return { errors: [], warnings: [], evidenceShortfall: false };
    return validateTowerProgressUpdate(
      {
        activity: selectedActivity,
        fromStatus,
        toStatus,
        progressDate,
        remarks,
        reason,
        quantityM: quantity.trim() ? Number(quantity) : undefined,
        gps,
        photoKinds: stagedKinds,
      },
      { tower, settings },
    );
  }, [
    tower,
    selectedActivity,
    fromStatus,
    toStatus,
    progressDate,
    remarks,
    reason,
    quantity,
    gps,
    stagedKinds,
    settings,
  ]);

  /** Evidence checklist: which required photographs the activity holds, will hold, or still lacks. */
  const evidence = useMemo(() => {
    const alreadyPresent = new Set(state?.presentPhotoKinds ?? []);
    const staged = new Set(stagedKinds);
    return definition.requiredPhotoKinds.map((kind) => ({
      kind,
      label: TOWER_PHOTO_KIND_LABELS[kind],
      onRecord: alreadyPresent.has(kind),
      staged: staged.has(kind),
    }));
  }, [definition.requiredPhotoKinds, state?.presentPhotoKinds, stagedKinds]);

  const nextUnfilledKind = useMemo(() => {
    const covered = new Set([...(state?.presentPhotoKinds ?? []), ...stagedKinds]);
    return definition.requiredPhotoKinds.find((kind) => !covered.has(kind)) ?? "other";
  }, [definition.requiredPhotoKinds, state?.presentPhotoKinds, stagedKinds]);

  const handleFiles = (files: FileList | null) => {
    if (!files?.length) return;
    const accepted: StagedPhoto[] = [];
    const rejected: string[] = [];
    Array.from(files).forEach((file, index) => {
      if (photos.length + accepted.length >= MAX_PHOTOS_PER_UPDATE) {
        rejected.push(`${file.name} (limit is ${MAX_PHOTOS_PER_UPDATE} photographs per update)`);
        return;
      }
      if (!file.type.startsWith("image/")) {
        rejected.push(`${file.name} (not an image)`);
        return;
      }
      if (file.size > MAX_PHOTO_BYTES) {
        rejected.push(`${file.name} (over ${Math.round(MAX_PHOTO_BYTES / 1024 / 1024)} MB)`);
        return;
      }
      accepted.push({
        id: `${Date.now()}-${index}-${file.name}`,
        file,
        // First file lands in the first unfilled required slot; the engineer can change any of them.
        kind: index === 0 ? nextUnfilledKind : "other",
        isReportPhoto: false,
        previewUrl: URL.createObjectURL(file),
      });
    });
    if (accepted.length) setPhotos((current) => [...current, ...accepted]);
    if (rejected.length) {
      toast({
        title: `${rejected.length} file${rejected.length === 1 ? "" : "s"} not attached`,
        description: rejected.join("; "),
        variant: "destructive",
      });
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removePhoto = (id: string) => {
    setPhotos((current) => {
      const target = current.find((photo) => photo.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return current.filter((photo) => photo.id !== id);
    });
  };

  const updatePhoto = (id: string, patch: Partial<Pick<StagedPhoto, "kind" | "isReportPhoto">>) => {
    setPhotos((current) =>
      current.map((photo) => {
        if (photo.id !== id) {
          // Only one photograph per update can be the report photo.
          return patch.isReportPhoto ? { ...photo, isReportPhoto: false } : photo;
        }
        return { ...photo, ...patch };
      }),
    );
  };

  const handleCaptureGps = async () => {
    setIsCapturingGps(true);
    const fix = await captureGpsFix();
    setIsCapturingGps(false);
    setGps(fix);
    if (!fix) {
      toast({
        title: "No GPS fix",
        description:
          "Location was refused or unavailable. Allow location access, or move into the open and try again.",
        variant: "destructive",
      });
    }
  };

  const handleSave = async () => {
    if (!tower || !project || !actor) return;
    if (validation.errors.length) {
      toast({ title: "Cannot save yet", description: validation.errors[0], variant: "destructive" });
      return;
    }
    setIsSaving(true);
    try {
      const uploads: PhotoUploadInput[] = photos.map((photo) => ({
        file: photo.file,
        kind: photo.kind,
        gps,
        isReportPhoto: photo.isReportPhoto,
      }));
      const { verificationState } = await recordTowerProgressUpdate(
        project,
        {
          tower,
          activity: selectedActivity,
          fromStatus,
          toStatus,
          progressDate,
          remarks,
          reason,
          quantityM: quantity.trim() ? Number(quantity) : undefined,
          gps,
          photos: uploads,
          evidenceShortfall: validation.evidenceShortfall,
        },
        settings,
        actor,
      );
      toast({
        title: `${tower.towerNo} · ${definition.label} → ${toStatus}`,
        description:
          verificationState === "Pending"
            ? "Recorded. It will appear in client reports once the site in-charge verifies it."
            : validation.evidenceShortfall
              ? "Recorded, but flagged in the No Evidence report until the photographs arrive."
              : "Recorded.",
      });
      clearPhotos();
      onOpenChange(false);
      await reload();
      onSaved?.();
    } catch (error) {
      console.error("Failed to record the tower progress update:", error);
      toast({
        title: "Could not save the update",
        description:
          "Nothing was recorded — the photographs did not upload. Check your connection and try again.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (!tower) return null;

  const showQuantity = definition.measure === "span";
  const needsReason = activityStatusNeedsReason(toStatus);

  return (
    <Dialog open={open} onOpenChange={(next) => (isSaving ? undefined : onOpenChange(next))}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {tower.towerNo} · {definition.label}
          </DialogTitle>
          <DialogDescription>
            {[tower.location, tower.towerType, tower.contractor].filter(Boolean).join(" · ") ||
              "Record progress with photographic evidence."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Activity</Label>
            <Select
              value={selectedActivity}
              onValueChange={(value) => setSelectedActivity(value as TowerActivity)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TOWER_ACTIVITY_LIST.map((entry) => (
                  <SelectItem key={entry.key} value={entry.key}>
                    {entry.label} — {tower.activities[entry.key].status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>New status</Label>
            <div className="flex items-center gap-2">
              <ActivityStatusBadge status={fromStatus} />
              <span className="text-muted-foreground">→</span>
              <Select
                value={toStatus}
                onValueChange={(value) => setToStatus(value as TowerActivityStatus)}
              >
                <SelectTrigger className="flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {nextActivityStatuses(fromStatus).map((status) => (
                    <SelectItem key={status} value={status}>
                      {status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="progress-date">Progress date *</Label>
            <Input
              id="progress-date"
              type="date"
              value={progressDate}
              max={todayKey()}
              onChange={(event) => setProgressDate(event.target.value)}
            />
          </div>

          {showQuantity ? (
            <div className="space-y-2">
              <Label htmlFor="progress-quantity">
                Length completed (m){isActivityComplete(toStatus) ? " *" : ""}
              </Label>
              <Input
                id="progress-quantity"
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                placeholder={
                  tower.spanToNextM ? `Span to next tower: ${tower.spanToNextM}` : "e.g. 320"
                }
              />
            </div>
          ) : null}

          <div className="space-y-2">
            <Label>
              Location fix{settings.requireGps ? " *" : ""}
            </Label>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void handleCaptureGps()}
                disabled={isCapturingGps}
              >
                {isCapturingGps ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Crosshair className="mr-2 h-4 w-4" />
                )}
                {gps ? "Recapture" : "Capture GPS"}
              </Button>
              <span className="truncate text-xs text-muted-foreground">
                {gps ? `${formatGps(gps)}${gps.accuracyM ? ` ±${gps.accuracyM}m` : ""}` : "Not recorded"}
              </span>
            </div>
          </div>

          {needsReason ? (
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="progress-reason">Reason *</Label>
              <Textarea
                id="progress-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                maxLength={500}
                placeholder="Why is this on hold, blocked or rejected? This appears in the exception reports."
              />
            </div>
          ) : null}

          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="progress-remarks">Remarks</Label>
            <Textarea
              id="progress-remarks"
              value={remarks}
              onChange={(event) => setRemarks(event.target.value)}
              maxLength={500}
            />
          </div>
        </div>

        {/* ── Evidence ───────────────────────────────────────────────────────────────────── */}
        <div className="space-y-3 rounded-lg border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold">Site photographs</p>
              <p className="text-xs text-muted-foreground">
                {settings.evidenceEnforcement === "block"
                  ? "This project requires the full set before an activity can be completed."
                  : "Completion is allowed without the full set, but the tower is flagged until it arrives."}
              </p>
            </div>
            <div className="flex gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                className="hidden"
                onChange={(event) => handleFiles(event.target.files)}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={photos.length >= MAX_PHOTOS_PER_UPDATE}
              >
                <Camera className="mr-2 h-4 w-4" />
                Add photographs
              </Button>
            </div>
          </div>

          {evidence.length ? (
            <div className="flex flex-wrap gap-1.5">
              {evidence.map((entry) => (
                <Badge
                  key={entry.kind}
                  variant="outline"
                  className={cn(
                    "text-[11px]",
                    entry.onRecord
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : entry.staged
                        ? "border-blue-200 bg-blue-50 text-blue-700"
                        : "border-red-200 bg-red-50 text-red-700",
                  )}
                >
                  {entry.onRecord || entry.staged ? "✓" : "✗"} {entry.label}
                  {entry.staged && !entry.onRecord ? " (attaching)" : ""}
                </Badge>
              ))}
            </div>
          ) : null}

          {photos.length ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {photos.map((photo) => (
                <div key={photo.id} className="flex gap-2 rounded-md border p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={photo.previewUrl}
                    alt={photo.file.name}
                    className="h-20 w-24 shrink-0 rounded object-cover"
                  />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <Select
                      value={photo.kind}
                      onValueChange={(value) => updatePhoto(photo.id, { kind: value as TowerPhotoKind })}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {photoKindsForActivity(selectedActivity).map((kind) => (
                          <SelectItem key={kind} value={kind}>
                            {TOWER_PHOTO_KIND_LABELS[kind]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="flex items-center justify-between gap-2">
                      <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <Checkbox
                          checked={photo.isReportPhoto}
                          onCheckedChange={(checked) =>
                            updatePhoto(photo.id, { isReportPhoto: checked === true })
                          }
                        />
                        Report photo
                      </label>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => removePhoto(photo.id)}
                        aria-label={`Remove ${photo.file.name}`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {validation.errors.length ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Fix before saving</AlertTitle>
            <AlertDescription>
              <ul className="list-inside list-disc space-y-1">
                {validation.errors.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        ) : null}

        {validation.warnings.length ? (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertTitle>Worth knowing</AlertTitle>
            <AlertDescription>
              <ul className="list-inside list-disc space-y-1">
                {validation.warnings.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        ) : null}

        {!validation.errors.length &&
        isActivityComplete(toStatus) &&
        !missingRequiredPhotoKinds(selectedActivity, [
          ...(state?.presentPhotoKinds ?? []),
          ...stagedKinds,
        ]).length ? (
          <p className="flex items-center gap-1.5 text-xs text-emerald-700">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Evidence set complete
            {settings.requireVerification ? " — goes to the verification queue on save." : "."}
          </p>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button
            onClick={() => void handleSave()}
            disabled={isSaving || validation.errors.length > 0}
          >
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isSaving
              ? photos.length
                ? `Uploading ${photos.length} photograph${photos.length === 1 ? "" : "s"}…`
                : "Saving…"
              : "Record progress"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
