#!/usr/bin/env bash
#
# Create the scheduled jobs this application needs, on Google Cloud Scheduler.
#
# ── Why this script exists ──────────────────────────────────────────────────────────────────────
#
# All six scheduled jobs were declared in `vercel.json`. This app is deployed on **Firebase App
# Hosting**, which never reads that file — confirmed from the live response headers of
# https://seltech.store (`server: envoy`, `via: 1.1 google`, and no `x-vercel-*`). Vercel's cron
# runner is the only thing that consumes `vercel.json`, so on App Hosting every one of those
# schedules was inert: nothing had been firing at all.
#
# That is the root cause of the stale greytHR employee mirror, and it silently affected five other
# modules too — workflow escalations, recurring-payment generation, the vehicle insurance workflow,
# fixed-deposit daily controls, and the HR SLA sweep.
#
# App Hosting has no built-in scheduler, so the supported answer is Cloud Scheduler pointed at the
# same HTTP endpoints. `vercel.json` is left in place deliberately: if this app is ever also
# deployed to Vercel, that file is still the correct configuration there. The two are not in
# conflict — they are two runners for the same set of endpoints, and each route is idempotent.
#
# ── Authentication ─────────────────────────────────────────────────────────────────────────────
#
# Every cron route checks `CRON_SECRET`:
#
#     if (!secret) return true;   // ← no secret configured means the endpoint is OPEN
#
# `CRON_SECRET` is currently set **nowhere** in this project, so those endpoints are publicly
# callable right now. Anyone could trigger a payroll generation run or an HR sync. This script
# therefore creates the secret as well as the jobs, and step 1 is not optional.
#
# ── Usage ──────────────────────────────────────────────────────────────────────────────────────
#
#   ./scripts/setup-cloud-scheduler.sh --dry-run    # print what would happen, change nothing
#   ./scripts/setup-cloud-scheduler.sh              # create/update the secret and all six jobs
#
# Safe to re-run: each job is created if missing and updated if present.
#
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-module-hub-uc7tw}"
BASE_URL="${BASE_URL:-https://seltech.store}"
LOCATION="${LOCATION:-asia-south1}"

# The existing cron expressions were written for Vercel, which runs them in **UTC**. Cloud Scheduler
# makes the zone explicit, so it has to be chosen rather than inherited. Asia/Kolkata is the
# deliberate choice: these are an Indian company's overnight batch jobs and the times read as local
# ones ("00:15", "01:00"). Set TIME_ZONE=Etc/UTC if you would rather preserve the previous
# (unintended) UTC behaviour exactly.
TIME_ZONE="${TIME_ZONE:-Asia/Kolkata}"

SECRET_NAME="${SECRET_NAME:-cron-secret}"
DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

run() {
  if [[ $DRY_RUN -eq 1 ]]; then
    printf '  [dry-run] %s\n' "$*"
  else
    "$@"
  fi
}

command -v gcloud >/dev/null 2>&1 || {
  echo "ERROR: gcloud is not installed. See https://cloud.google.com/sdk/docs/install" >&2
  exit 1
}

echo "Project:   $PROJECT_ID"
echo "Base URL:  $BASE_URL"
echo "Location:  $LOCATION"
echo "Time zone: $TIME_ZONE"
[[ $DRY_RUN -eq 1 ]] && echo "MODE:      dry run — nothing will be created"
echo

# ── 1. Enable the APIs ─────────────────────────────────────────────────────────────────────────

echo "→ Enabling required APIs (no-op if already enabled)…"
run gcloud services enable cloudscheduler.googleapis.com secretmanager.googleapis.com \
  --project "$PROJECT_ID"

# ── 2. The shared secret ───────────────────────────────────────────────────────────────────────
#
# Generated here rather than chosen by hand so it is not something memorable, reused, or pasted into
# a chat window. Printed once at the end for you to add to App Hosting.

echo "→ Ensuring Secret Manager secret '$SECRET_NAME' exists…"
if gcloud secrets describe "$SECRET_NAME" --project "$PROJECT_ID" >/dev/null 2>&1; then
  echo "  already exists — reusing its current value"
  if [[ $DRY_RUN -eq 0 ]]; then
    CRON_SECRET="$(gcloud secrets versions access latest --secret "$SECRET_NAME" --project "$PROJECT_ID")"
  else
    CRON_SECRET="<existing-value>"
  fi
else
  echo "  creating"
  if [[ $DRY_RUN -eq 0 ]]; then
    CRON_SECRET="$(openssl rand -hex 32)"
    printf '%s' "$CRON_SECRET" \
      | gcloud secrets create "$SECRET_NAME" --project "$PROJECT_ID" --data-file=- --replication-policy=automatic
  else
    CRON_SECRET="<generated-on-real-run>"
    run gcloud secrets create "$SECRET_NAME" --project "$PROJECT_ID" --data-file=- --replication-policy=automatic
  fi
fi

# ── 3. The jobs ────────────────────────────────────────────────────────────────────────────────
#
# name|path|schedule  — schedules copied verbatim from vercel.json so behaviour is unchanged apart
# from the runner and the (now explicit) time zone.

JOBS=(
  "greythr-sync|/api/greythr/sync|5 * * * *"
  "workflow-escalations|/api/workflow/check-escalations|0 * * * *"
  "recurring-payments|/api/recurring-payments/generate|15 0 * * *"
  "insurance-workflow|/api/vehicle-management/insurance-workflow|30 0 * * *"
  "fixed-deposit-controls|/api/fixed-deposit/daily-controls|45 0 * * *"
  "hr-sla|/api/hr/sla|0 1 * * *"
)

echo
echo "→ Creating/updating ${#JOBS[@]} scheduler jobs…"
for entry in "${JOBS[@]}"; do
  IFS='|' read -r name path schedule <<< "$entry"
  url="${BASE_URL}${path}"

  # `describe` decides create-vs-update so the script is idempotent — re-running after adding a new
  # job does not error on the five that already exist.
  if gcloud scheduler jobs describe "$name" --location "$LOCATION" --project "$PROJECT_ID" >/dev/null 2>&1; then
    action="update"
  else
    action="create"
  fi

  echo "  [$action] $name  ($schedule $TIME_ZONE)  → $path"
  run gcloud scheduler jobs "$action" http "$name" \
    --location "$LOCATION" \
    --project "$PROJECT_ID" \
    --schedule "$schedule" \
    --time-zone "$TIME_ZONE" \
    --uri "$url" \
    --http-method GET \
    --update-headers "Authorization=Bearer ${CRON_SECRET}" \
    --attempt-deadline 600s \
    --max-retry-attempts 3 \
    --min-backoff 30s
done

# ── 4. What you still have to do by hand ───────────────────────────────────────────────────────

cat <<EOF

────────────────────────────────────────────────────────────────────────────────
Done creating jobs. Two manual steps remain — the schedules will 401 until you
finish step 1.

1. Give App Hosting the same secret, so the routes can verify the caller.
   Add this to apphosting.yaml under 'env:' and redeploy:

     - variable: CRON_SECRET
       secret: ${SECRET_NAME}
       availability:
         - RUNTIME

   Then grant App Hosting's service account read access:

     gcloud secrets add-iam-policy-binding ${SECRET_NAME} \\
       --project ${PROJECT_ID} \\
       --member "serviceAccount:firebase-app-hosting-compute@${PROJECT_ID}.iam.gserviceaccount.com" \\
       --role roles/secretmanager.secretAccessor

2. Turn the greytHR sync schedule on. The cron will now fire hourly, but the
   route asks isSyncDue() first, and DEFAULT_SYNC_SCHEDULE has enabled: false —
   so every tick will answer "Automatic sync is switched off" and do nothing.
   Enable it at /employee/sync → Schedule. This is deliberately a decision
   rather than a default: the exit policy defaults to 'Flag for review', which
   changes nobody's access, so switching the schedule on is safe.

Verify a job end to end without waiting for the clock:

     gcloud scheduler jobs run greythr-sync --location ${LOCATION} --project ${PROJECT_ID}

Then check /employee/sync → Runs for a new record.
────────────────────────────────────────────────────────────────────────────────
EOF
