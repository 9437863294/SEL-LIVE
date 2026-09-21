/**
 * Policy resolution for the Windows Agent (§35).
 *
 * Pure and dependency-free, like `windows-agent-rules.ts`: the heartbeat route resolves a policy on
 * every beat, the policy screen resolves one to preview it, and `node --test` resolves dozens
 * without a Firestore emulator.
 *
 * ── Why inheritance is per field, not per document ─────────────────────────────────────────────
 *
 * §35 asks for Company → Department → User → Device with "most specific rule wins". The obvious
 * reading — find the narrowest policy that applies and use it — is wrong in a way that only shows
 * up in production. An administrator opens a department policy to raise its idle threshold to ten
 * minutes, saves, and every other setting for that department silently reverts to the built-in
 * default: application tracking, the heartbeat interval, the offline grace period, all of it. The
 * company policy that was carefully agreed is still there, still enabled, and no longer reaching
 * anybody in that department.
 *
 * So the unit of inheritance is the *setting*, not the document. `AgentPolicySettings` has every
 * field optional precisely so that "not set here" is expressible and distinct from "set to false".
 * A department policy carrying one key overrides one key.
 *
 * ── Two consequences worth knowing ─────────────────────────────────────────────────────────────
 *
 *  1. **The resolver reports its own workings.** `ResolvedAgentPolicy.sources` names the scope that
 *     supplied each value, so the policy screen can answer "why is this PC's idle threshold ten
 *     minutes?" without anybody reading four documents. It costs nothing to produce and it is the
 *     difference between a policy system people trust and one they work around.
 *
 *  2. **Defaults are deliberately cautious.** `requireMorningLogin` is **off**. §60 is emphatic
 *     that the access gate must not be switched on fleet-wide before the agent, the authentication
 *     and the recovery path have been tested — and a default of `true` means the first PC that
 *     installs the agent is gated by an untested gate. Window titles and browser domains are off
 *     for the same reason §12 wants them off: capture that nobody consciously enabled is capture
 *     nobody consented to.
 */

import type {
  AgentPolicySettings,
  PolicyScopeKind,
  ResolvedAgentPolicy,
  WindowsAgentPolicy,
} from './windows-agent-model.ts';

/**
 * What every setting is when nothing overrides it.
 *
 * These are the values a freshly installed agent runs on, so each one is chosen to be safe on a PC
 * nobody has configured yet — see the header on why `requireMorningLogin` in particular is false.
 */
export const DEFAULT_AGENT_POLICY: Required<AgentPolicySettings> = {
  // Off until §60's staged rollout says otherwise. Monitoring first, enforcement later.
  requireMorningLogin: false,
  requireLoginAfterRestart: false,
  // §11's stated defaults: five minutes to idle, fifteen to extended idle.
  idleThresholdSeconds: 300,
  extendedIdleThresholdSeconds: 900,
  // §27: a day's worth. Long enough to survive a site's internet outage, short enough that a
  // laptop taken home does not keep opening sessions for a week.
  offlineGraceMinutes: 720,
  // §16 asks for 60–180s. 90 is two beats a minute per PC — on 200 machines that is ~192k writes a
  // day against one document each, which is the cheapest useful liveness signal available.
  heartbeatIntervalSeconds: 90,
  // §31 asks for 2–5 minutes. Three balances Firestore cost against how much a crash can lose.
  activityBatchIntervalSeconds: 180,
  applicationTrackingEnabled: true,
  // §12 and §14: both off, and both additionally enforced server-side at ingest.
  windowTitleTrackingEnabled: false,
  browserDomainTrackingEnabled: false,
  notificationMode: 'TOAST_AND_TRAY',
  autoUpdateEnabled: true,
  workdayStart: '09:00',
  workdayEnd: '18:00',
  lateLoginGraceMinutes: 15,
  allowUserPauseTracking: false,
  // Off, with the timings already sensible for whoever switches it on. Ten minutes is long
  // enough to survive a phone call or a long read; a minute's warning is long enough to notice
  // and short enough that an empty desk is not left open for another five.
  lockOnIdleEnabled: false,
  idleLockSeconds: 600,
  idleLockWarningSeconds: 60,
  lockOnErpWindowClose: false,
  lockOnSignOut: false,
  // Half an hour. A walk to the printer resumes silently; a lunch break asks again.
  reauthAfterLockSeconds: 1800,
  // §51's shortest offered option. An organisation that wants 180 days can say so; one that has
  // not thought about it yet keeps the least data, which is the right way round.
  rawActivityRetentionDays: 90,
};

/** Every setting key, so the resolver and the settings form iterate the same list. */
export const AGENT_POLICY_KEYS = Object.keys(DEFAULT_AGENT_POLICY) as (keyof AgentPolicySettings)[];

/** Bounds each numeric setting is clamped to. A policy cannot configure the agent into the ground. */
const NUMERIC_BOUNDS: Partial<Record<keyof AgentPolicySettings, { min: number; max: number }>> = {
  // Below a minute, "idle" catches somebody reading their own screen.
  idleThresholdSeconds: { min: 60, max: 3600 },
  extendedIdleThresholdSeconds: { min: 120, max: 14_400 },
  offlineGraceMinutes: { min: 0, max: 10_080 },
  // §16's range, enforced. A 5-second heartbeat would be a self-inflicted denial of service on
  // Firestore; an hourly one would make the live board fiction.
  heartbeatIntervalSeconds: { min: 30, max: 900 },
  activityBatchIntervalSeconds: { min: 30, max: 1800 },
  lateLoginGraceMinutes: { min: 0, max: 240 },
  rawActivityRetentionDays: { min: 7, max: 730 },
  // A two-minute floor on the idle lock. Anything shorter locks people mid-sentence, and the
  // first thing a fleet does with a setting like that is demand it be switched off entirely.
  idleLockSeconds: { min: 120, max: 14_400 },
  // At least fifteen seconds to react. A warning nobody can read is just a lock with extra steps.
  idleLockWarningSeconds: { min: 15, max: 600 },
  // Zero is meaningful here (ask on every unlock), so the floor is zero rather than a minimum.
  reauthAfterLockSeconds: { min: 0, max: 86_400 },
};

const CLOCK_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

const NOTIFICATION_MODES = new Set(['TOAST_AND_TRAY', 'TRAY_ONLY', 'CRITICAL_ONLY', 'OFF']);

/**
 * Accept only the settings that are well-formed, dropping the rest.
 *
 * Dropping rather than defaulting is the point: a malformed value must fall through to whatever
 * the next-broader scope says, not reset to the built-in default. A department policy with a typo
 * in its heartbeat interval should leave the company's interval in force, not override it with 90.
 */
export function sanitizePolicySettings(raw: unknown): AgentPolicySettings {
  if (!raw || typeof raw !== 'object') return {};
  const input = raw as Record<string, unknown>;
  const out: AgentPolicySettings = {};

  for (const key of AGENT_POLICY_KEYS) {
    const value = input[key];
    if (value === undefined || value === null) continue;
    const fallback = DEFAULT_AGENT_POLICY[key];

    if (typeof fallback === 'boolean') {
      if (typeof value === 'boolean') (out as Record<string, unknown>)[key] = value;
      continue;
    }

    if (typeof fallback === 'number') {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) continue;
      const bounds = NUMERIC_BOUNDS[key];
      const clamped = bounds
        ? Math.min(bounds.max, Math.max(bounds.min, Math.round(numeric)))
        : Math.round(numeric);
      (out as Record<string, unknown>)[key] = clamped;
      continue;
    }

    if (key === 'notificationMode') {
      if (typeof value === 'string' && NOTIFICATION_MODES.has(value)) {
        out.notificationMode = value as AgentPolicySettings['notificationMode'];
      }
      continue;
    }

    if (key === 'workdayStart' || key === 'workdayEnd') {
      if (typeof value === 'string' && CLOCK_PATTERN.test(value)) out[key] = value;
      continue;
    }
  }

  return out;
}

/**
 * Which policies apply to one agent, and in what order.
 *
 * A device belongs to a department, is used by a user, and is itself a device — so up to four
 * documents apply, and they are ordered from most general to most specific because that is the
 * order `resolveAgentPolicy` overwrites in.
 */
export interface PolicySubject {
  userId: string | null;
  deviceId: string | null;
  /** The device's department, the user's department, or both — all of them apply. */
  departmentIds: string[];
}

/** True when this policy document is in force for this subject. */
export function policyApplies(policy: WindowsAgentPolicy, subject: PolicySubject): boolean {
  if (policy.enabled === false) return false;
  switch (policy.scopeKind) {
    case 'COMPANY':
      return true;
    case 'DEPARTMENT':
      return Boolean(policy.scopeId) && subject.departmentIds.includes(policy.scopeId as string);
    case 'USER':
      return Boolean(policy.scopeId) && policy.scopeId === subject.userId;
    case 'DEVICE':
      return Boolean(policy.scopeId) && policy.scopeId === subject.deviceId;
    default:
      return false;
  }
}

const SCOPE_RANK: Record<PolicyScopeKind, number> = {
  COMPANY: 0,
  DEPARTMENT: 1,
  USER: 2,
  DEVICE: 3,
};

/**
 * Fold every applicable policy into one, field by field, narrowest scope last.
 *
 * Two policies at the same scope — two department policies for a user who belongs to two
 * departments — are applied in document-id order so the answer is stable rather than dependent on
 * how Firestore happened to return them. It is an unusual configuration and the resolver does not
 * pretend to know which one an administrator meant; what it guarantees is that it will not change
 * its mind between two reads.
 */
export function resolveAgentPolicy(
  policies: readonly WindowsAgentPolicy[],
  subject: PolicySubject,
): ResolvedAgentPolicy {
  const applicable = policies
    .filter((policy) => policyApplies(policy, subject))
    .sort((left, right) => {
      const byScope = SCOPE_RANK[left.scopeKind] - SCOPE_RANK[right.scopeKind];
      return byScope !== 0 ? byScope : left.id.localeCompare(right.id);
    });

  const settings = { ...DEFAULT_AGENT_POLICY };
  const sources = Object.fromEntries(
    AGENT_POLICY_KEYS.map((key) => [key, 'DEFAULT']),
  ) as ResolvedAgentPolicy['sources'];
  const appliedPolicyIds: string[] = [];

  for (const policy of applicable) {
    const clean = sanitizePolicySettings(policy.settings);
    let contributed = false;
    for (const key of AGENT_POLICY_KEYS) {
      const value = clean[key];
      if (value === undefined) continue;
      (settings as Record<string, unknown>)[key] = value;
      sources[key] = policy.scopeKind;
      contributed = true;
    }
    if (contributed) appliedPolicyIds.push(policy.id);
  }

  return { settings: enforceInvariants(settings), sources, appliedPolicyIds };
}

/**
 * Fix the combinations that are individually valid and jointly nonsense.
 *
 * Settings are inherited independently, so a company policy's extended-idle threshold can end up
 * below a department policy's idle threshold with nobody having made an obviously wrong choice.
 * Left alone, every idle second would classify as extended-idle and the two buckets on every
 * report would stop meaning anything. Raising the extended threshold is the repair that loses no
 * information: it keeps both administrators' intent visible and only overrides the impossible part.
 */
function enforceInvariants(settings: Required<AgentPolicySettings>): Required<AgentPolicySettings> {
  const out = { ...settings };
  if (out.extendedIdleThresholdSeconds <= out.idleThresholdSeconds) {
    out.extendedIdleThresholdSeconds = out.idleThresholdSeconds * 2;
  }
  // A batch interval shorter than the heartbeat means the agent talks to the server twice as often
  // as it needs to for no extra fidelity — the batch already carries everything the beat does.
  if (out.activityBatchIntervalSeconds < out.heartbeatIntervalSeconds) {
    out.activityBatchIntervalSeconds = out.heartbeatIntervalSeconds;
  }
  // Browser domains require the managed extension, which reports through the agent; capturing them
  // with application tracking off is not a configuration that can produce anything.
  if (!out.applicationTrackingEnabled) {
    out.windowTitleTrackingEnabled = false;
    out.browserDomainTrackingEnabled = false;
  }
  return out;
}

/** The thresholds in the shape `windows-agent-rules.ts` wants them. */
export function thresholdsOf(policy: ResolvedAgentPolicy): {
  idleThresholdSeconds: number;
  extendedIdleThresholdSeconds: number;
} {
  return {
    idleThresholdSeconds: policy.settings.idleThresholdSeconds,
    extendedIdleThresholdSeconds: policy.settings.extendedIdleThresholdSeconds,
  };
}

/** The default resolution, for the paths that have no policy documents to hand. */
export function defaultResolvedPolicy(): ResolvedAgentPolicy {
  return {
    settings: { ...DEFAULT_AGENT_POLICY },
    sources: Object.fromEntries(
      AGENT_POLICY_KEYS.map((key) => [key, 'DEFAULT']),
    ) as ResolvedAgentPolicy['sources'],
    appliedPolicyIds: [],
  };
}

/**
 * A human sentence for one setting's provenance, for the policy screen's tooltip.
 *
 * `DEFAULT` says so explicitly rather than naming a scope, because "inherited from Company" when
 * no company policy exists is the kind of small lie that costs an hour of somebody's afternoon.
 */
export function describePolicySource(source: PolicyScopeKind | 'DEFAULT'): string {
  switch (source) {
    case 'DEFAULT':
      return 'Built-in default — no policy sets this.';
    case 'COMPANY':
      return 'From the company policy.';
    case 'DEPARTMENT':
      return 'From a department policy.';
    case 'USER':
      return 'From a user policy.';
    case 'DEVICE':
      return 'From this device’s own policy.';
    default:
      return 'Unknown source.';
  }
}
