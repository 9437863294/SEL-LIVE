"use client";

/**
 * Per-project Tower Progress configuration.
 *
 * Two settings here change how the whole feature behaves and are worth understanding before touching:
 * evidence enforcement decides whether a completion without photographs is refused or merely flagged,
 * and the activity weights decide what "68% complete" means on this project.
 */

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Info, Loader2, RotateCcw, Save, Settings as SettingsIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  DEFAULT_ACTIVITY_WEIGHTS,
  TOWER_ACTIVITIES,
  TOWER_ACTIVITY_LIST,
  TOWER_PHOTO_KIND_LABELS,
  towerProgressHref,
  validateTowerProgressSettings,
  type EvidenceEnforcementMode,
  type TowerProgressSettings,
} from "@/lib/project-management-tower-progress";
import { saveTowerProgressSettings } from "@/lib/project-management-tower-service";
import { useTowerProgress } from "@/components/project-management/tower-progress/tower-progress-provider";
import {
  TowerProgressGuard,
  TowerProgressHeader,
  TowerProgressNav,
  TowerProgressShell,
} from "@/components/project-management/tower-progress/tower-progress-ui";

export default function TowerProgressSettingsPage() {
  const { permissions } = useTowerProgress();
  return (
    <TowerProgressGuard requires={permissions.viewSettings} requiresLabel="Tower Progress settings">
      <SettingsScreen />
    </TowerProgressGuard>
  );
}

function SettingsScreen() {
  const { mappingId, project, settings, permissions, actor, reload } = useTowerProgress();
  const { toast } = useToast();
  const [draft, setDraft] = useState<TowerProgressSettings>(settings);
  const [isSaving, setIsSaving] = useState(false);

  // Re-seeds when a fresh load lands, so the form shows what is stored rather than a stale copy.
  useEffect(() => setDraft(settings), [settings]);

  const errors = useMemo(() => validateTowerProgressSettings(draft), [draft]);
  const weightTotal = useMemo(
    () =>
      Math.round(
        TOWER_ACTIVITIES.reduce(
          (sum, activity) => sum + (Number(draft.activityWeights[activity]) || 0),
          0,
        ) * 100,
      ) / 100,
    [draft.activityWeights],
  );

  const canEdit = permissions.editSettings;

  const set = <K extends keyof TowerProgressSettings>(key: K, value: TowerProgressSettings[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const handleSave = async () => {
    if (!project || !actor) return;
    if (errors.length) {
      toast({ title: "Fix before saving", description: errors[0].message, variant: "destructive" });
      return;
    }
    setIsSaving(true);
    try {
      await saveTowerProgressSettings(project, draft, actor);
      toast({ title: "Tower Progress settings saved" });
      await reload();
    } catch (error) {
      console.error("Failed to save Tower Progress settings:", error);
      toast({ title: "Could not save the settings", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <TowerProgressShell>
      <TowerProgressHeader
        title="Tower Progress settings"
        subtitle={
          project
            ? `Evidence rules, progress weighting and report watermark for ${project.projectName}.`
            : "Evidence rules, progress weighting and report watermark."
        }
        icon={SettingsIcon}
        backHref={towerProgressHref(mappingId)}
        actions={
          canEdit ? (
            <Button onClick={() => void handleSave()} disabled={isSaving || errors.length > 0}>
              {isSaving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Save settings
            </Button>
          ) : undefined
        }
      />

      <TowerProgressNav />

      {!canEdit ? (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>Read-only</AlertTitle>
          <AlertDescription>
            You can see how this project is configured but not change it.
          </AlertDescription>
        </Alert>
      ) : null}

      {/* ── Evidence ─────────────────────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Photographic evidence</CardTitle>
          <CardDescription>
            What happens when somebody marks an activity complete without its minimum photographs.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <RadioGroup
            value={draft.evidenceEnforcement}
            onValueChange={(value) => set("evidenceEnforcement", value as EvidenceEnforcementMode)}
            disabled={!canEdit}
            className="gap-3"
          >
            <label
              className={cn(
                "flex cursor-pointer gap-3 rounded-lg border p-3",
                draft.evidenceEnforcement === "block" && "border-primary bg-primary/5",
              )}
            >
              <RadioGroupItem value="block" className="mt-0.5" />
              <div>
                <p className="text-sm font-medium">Block the completion</p>
                <p className="text-xs text-muted-foreground">
                  The activity cannot be set to Completed until every required photograph is uploaded.
                  The strongest control, and the one to aim for.
                </p>
              </div>
            </label>
            <label
              className={cn(
                "flex cursor-pointer gap-3 rounded-lg border p-3",
                draft.evidenceEnforcement === "warn" && "border-primary bg-primary/5",
              )}
            >
              <RadioGroupItem value="warn" className="mt-0.5" />
              <div>
                <p className="text-sm font-medium">Warn but allow</p>
                <p className="text-xs text-muted-foreground">
                  Completion is recorded with a warning, the tower is flagged, and it stays in the No
                  Evidence report until the photographs arrive. For sites where the crew moves on
                  before the upload can finish.
                </p>
              </div>
            </label>
          </RadioGroup>

          <div className="grid gap-3 sm:grid-cols-2">
            <SettingSwitch
              id="require-gps"
              label="Require a GPS fix"
              description="Every progress update must carry coordinates from the device."
              checked={draft.requireGps}
              onChange={(value) => set("requireGps", value)}
              disabled={!canEdit}
            />
            <SettingSwitch
              id="require-verification"
              label="Require verification"
              description="Updates go to the verification queue before they count as approved."
              checked={draft.requireVerification}
              onChange={(value) => set("requireVerification", value)}
              disabled={!canEdit}
            />
            <SettingSwitch
              id="client-approved-only"
              label="Client reports use verified photographs only"
              description="Unverified photographs are held back from client-facing reports."
              checked={draft.clientReportsRequireApprovedPhotos}
              onChange={(value) => set("clientReportsRequireApprovedPhotos", value)}
              disabled={!canEdit}
            />
            <div className="space-y-1.5 rounded-lg border p-3">
              <Label htmlFor="delay-threshold" className="text-sm font-medium">
                Delay threshold (days)
              </Label>
              <Input
                id="delay-threshold"
                type="number"
                min={1}
                max={365}
                value={draft.delayThresholdDays}
                disabled={!canEdit}
                onChange={(event) =>
                  set("delayThresholdDays", Number(event.target.value) || 0)
                }
                className="h-9 w-28"
              />
              <p className="text-xs text-muted-foreground">
                How long an activity may sit in one status before the Delayed report picks it up.
              </p>
            </div>
          </div>

          {draft.clientReportsRequireApprovedPhotos && !draft.requireVerification ? (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertTitle>These two settings work together</AlertTitle>
              <AlertDescription>
                With verification switched off, updates are recorded as approved on save — so
                requiring verified photographs in client reports has no practical effect.
              </AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      {/* ── Weights ──────────────────────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-base">Progress weighting</CardTitle>
              <CardDescription>
                What each activity contributes to a tower&apos;s overall percentage. Work in progress
                earns half its weight; blocked and rejected work earns none.
              </CardDescription>
            </div>
            {canEdit ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => set("activityWeights", { ...DEFAULT_ACTIVITY_WEIGHTS })}
              >
                <RotateCcw className="mr-2 h-4 w-4" />
                Reset to defaults
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {TOWER_ACTIVITY_LIST.map((definition) => (
              <div key={definition.key} className="space-y-1.5">
                <Label htmlFor={`weight-${definition.key}`} className="text-xs">
                  {definition.label}
                </Label>
                <Input
                  id={`weight-${definition.key}`}
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={draft.activityWeights[definition.key]}
                  disabled={!canEdit}
                  onChange={(event) =>
                    set("activityWeights", {
                      ...draft.activityWeights,
                      [definition.key]: Number(event.target.value) || 0,
                    })
                  }
                  className="h-9"
                />
              </div>
            ))}
          </div>
          <p
            className={cn(
              "text-sm font-medium",
              weightTotal === 100 ? "text-emerald-700" : "text-red-700",
            )}
          >
            Total: {weightTotal} {weightTotal === 100 ? "✓" : "— must be 100"}
          </p>
          <p className="text-xs text-muted-foreground">
            The defaults are the weights that reproduce a standard transmission-line progress table:
            a tower with survey complete reads 15%, through structure with erection under way reads
            65%, and through erection with stringing and OPGW under way reads 85%.
          </p>
        </CardContent>
      </Card>

      {/* ── Watermark ────────────────────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Report watermark</CardTitle>
          <CardDescription>
            Stamped onto every report photograph alongside the project, tower, activity, date and GPS.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Label htmlFor="watermark-org">Organisation</Label>
          <Input
            id="watermark-org"
            value={draft.watermarkOrganisation}
            disabled={!canEdit}
            maxLength={120}
            onChange={(event) => set("watermarkOrganisation", event.target.value)}
            className="sm:max-w-md"
          />
          <div className="mt-3 max-w-md rounded-md bg-black/80 p-2 text-[11px] leading-tight text-white">
            <span className="block font-bold tracking-wide">
              {draft.watermarkOrganisation.toUpperCase() || "ORGANISATION"}
            </span>
            <span className="block">Project: {project?.projectName ?? "—"}</span>
            <span className="block">Tower: T-037</span>
            <span className="block">Activity: Tower Erection</span>
            <span className="block">Date: 24-Aug-2026 11:32</span>
            <span className="block">GPS: 20.3456, 85.4567</span>
          </div>
        </CardContent>
      </Card>

      {/* ── Evidence requirements reference ──────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Minimum photographs per activity</CardTitle>
          <CardDescription>
            Fixed by the module, because these are the photographs that cannot be taken after the
            fact. Foundation carries four: excavation, reinforcement and concreting all disappear once
            the pit is backfilled.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Activity</TableHead>
                  <TableHead>Measured per</TableHead>
                  <TableHead>Required photographs</TableHead>
                  <TableHead>Also offered</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {TOWER_ACTIVITY_LIST.map((definition) => (
                  <TableRow key={definition.key}>
                    <TableCell className="font-medium">{definition.label}</TableCell>
                    <TableCell className="text-xs capitalize">{definition.measure}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {definition.requiredPhotoKinds.map((kind) => (
                          <Badge
                            key={kind}
                            variant="outline"
                            className="border-red-200 bg-red-50 text-[10px] text-red-700"
                          >
                            {TOWER_PHOTO_KIND_LABELS[kind]}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {definition.optionalPhotoKinds.map((kind) => (
                          <Badge key={kind} variant="outline" className="text-[10px]">
                            {TOWER_PHOTO_KIND_LABELS[kind]}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {errors.length ? (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Fix before saving</AlertTitle>
          <AlertDescription>
            <ul className="list-inside list-disc space-y-1">
              {errors.map((issue) => (
                <li key={`${String(issue.field)}-${issue.message}`}>{issue.message}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
    </TowerProgressShell>
  );
}

function SettingSwitch({
  id,
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border p-3">
      <div className="min-w-0">
        <Label htmlFor={id} className="text-sm font-medium">
          {label}
        </Label>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );
}
