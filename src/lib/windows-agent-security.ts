/**
 * Windows device-security policy resolution.
 *
 * Every device starts strict. A SEL LIVE administrator can persist a different policy for one PC
 * through the authenticated API. Keeping resolution pure lets the API, UI, login gate and tests
 * agree without trusting a browser or the endpoint's own `compliant` claim.
 */

import type {
  WindowsDeviceMaintenanceAccess,
  WindowsDeviceSecurityPolicy,
  WindowsDeviceSecurityPosture,
} from './windows-agent-model.ts';

export const WINDOWS_DEVICE_SECURITY_POLICY: WindowsDeviceSecurityPolicy = {
  taskManagerLocked: true,
  agentStopBlocked: true,
  serviceModificationBlocked: true,
  uninstallBlocked: true,
  monitoringPolicyLocallyMutable: false,
  signedAgentBinariesRequired: true,
  signedAppControlPolicyRequired: true,
  secureBootRequired: true,
  tamperMonitoringEnabled: true,
  auditRequired: true,
  // Off. See the field's note in the model: every other enforcing behaviour here ships off, and
  // with the strict baseline above this one refused a sign-in on every PC in the company.
  loginBlockedOnFindings: false,
  enforcementIntervalSeconds: 60,
};

const POLICY_BOOLEAN_KEYS: (keyof Omit<WindowsDeviceSecurityPolicy, 'enforcementIntervalSeconds'>)[] = [
  'taskManagerLocked',
  'agentStopBlocked',
  'serviceModificationBlocked',
  'uninstallBlocked',
  'monitoringPolicyLocallyMutable',
  'signedAgentBinariesRequired',
  'signedAppControlPolicyRequired',
  'secureBootRequired',
  'tamperMonitoringEnabled',
  'auditRequired',
  'loginBlockedOnFindings',
];

/** Resolve a partial or untrusted stored policy over the strict defaults. */
export function resolveDeviceSecurityPolicy(raw: unknown): WindowsDeviceSecurityPolicy {
  const input = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const resolved = { ...WINDOWS_DEVICE_SECURITY_POLICY };
  for (const key of POLICY_BOOLEAN_KEYS) {
    if (typeof input[key] === 'boolean') resolved[key] = input[key];
  }
  // Audit remains mandatory even when every enforcement control is deliberately relaxed.
  resolved.auditRequired = true;
  const interval = Math.round(Number(input.enforcementIntervalSeconds));
  resolved.enforcementIntervalSeconds = Number.isFinite(interval)
    ? Math.min(300, Math.max(30, interval))
    : WINDOWS_DEVICE_SECURITY_POLICY.enforcementIntervalSeconds;
  return resolved;
}

/** A login may tolerate a few missed one-minute reports, but never an indefinitely stale claim. */
export const WINDOWS_DEVICE_SECURITY_POSTURE_MAX_AGE_MS = 5 * 60_000;

export function activeMaintenanceAccess(
  grant: WindowsDeviceMaintenanceAccess | null | undefined,
  now: Date = new Date(),
): WindowsDeviceMaintenanceAccess | null {
  if (!grant || grant.status !== 'ACTIVE') return null;
  const expiresAt = Date.parse(grant.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime()) return null;
  return grant;
}

/** Treat service input as hostile: retain only bounded, known posture fields. */
export function sanitizeSecurityPosture(
  raw: unknown,
  now: Date = new Date(),
  options: {
    allowTaskManagerUnlocked?: boolean;
    policy?: WindowsDeviceSecurityPolicy;
  } = {},
): WindowsDeviceSecurityPosture {
  const input = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const secureBootEnabled =
    typeof input.secureBootEnabled === 'boolean' ? input.secureBootEnabled : null;
  // Control findings are derived below from measured booleans and the server policy. Retain only
  // a generic measurement failure so an older client cannot keep a disabled requirement failing.
  const findings = Array.isArray(input.findings) && input.findings.includes('POSTURE_CHECK_FAILED')
    ? ['POSTURE_CHECK_FAILED']
    : [];

  const posture: WindowsDeviceSecurityPosture = {
    checkedAt: now.toISOString(),
    secureBootEnabled,
    taskManagerLocked: input.taskManagerLocked === true,
    agentStopBlocked: input.agentStopBlocked === true,
    serviceModificationBlocked: input.serviceModificationBlocked === true,
    agentBinariesSigned: input.agentBinariesSigned === true,
    signedAppControlPolicyActive: input.signedAppControlPolicyActive === true,
    compliant: false,
    findings,
    windowsAccounts: Array.isArray(input.windowsAccounts)
      ? [...new Set(input.windowsAccounts
          .filter((value): value is string => typeof value === 'string')
          .map((value) => value.trim())
          .filter((value) => value.length > 0 && value.length <= 128))]
          .slice(0, 8)
      : [],
  };

  const derived = securityFindings(posture, options);
  if (options.allowTaskManagerUnlocked) {
    const suppliedIndex = posture.findings.indexOf('TASK_MANAGER_UNLOCKED');
    if (suppliedIndex >= 0) posture.findings.splice(suppliedIndex, 1);
  }
  posture.findings = [...new Set([...posture.findings, ...derived])];
  posture.compliant = posture.findings.length === 0;
  return posture;
}

export function securityFindings(
  posture: Pick<
    WindowsDeviceSecurityPosture,
    'secureBootEnabled' | 'taskManagerLocked' | 'agentStopBlocked' | 'serviceModificationBlocked' | 'agentBinariesSigned' | 'signedAppControlPolicyActive'
  >,
  options: {
    allowTaskManagerUnlocked?: boolean;
    policy?: WindowsDeviceSecurityPolicy;
  } = {},
): string[] {
  const policy = options.policy ?? WINDOWS_DEVICE_SECURITY_POLICY;
  const findings: string[] = [];
  if (policy.secureBootRequired && posture.secureBootEnabled === false) findings.push('SECURE_BOOT_OFF');
  if (policy.secureBootRequired && posture.secureBootEnabled === null) findings.push('SECURE_BOOT_UNKNOWN');
  if (policy.taskManagerLocked && !posture.taskManagerLocked && !options.allowTaskManagerUnlocked) {
    findings.push('TASK_MANAGER_UNLOCKED');
  }
  if (policy.agentStopBlocked && !posture.agentStopBlocked) findings.push('AGENT_STOP_ALLOWED');
  if (policy.serviceModificationBlocked && !posture.serviceModificationBlocked) findings.push('SERVICE_MODIFIABLE');
  if (policy.signedAgentBinariesRequired && !posture.agentBinariesSigned) findings.push('AGENT_BINARY_UNSIGNED');
  if (policy.signedAppControlPolicyRequired && !posture.signedAppControlPolicyActive) {
    findings.push('SIGNED_APP_CONTROL_POLICY_MISSING');
  }
  return findings;
}

/**
 * Decide whether the server may open a work session on this device.
 *
 * This deliberately re-derives the baseline instead of trusting the device-supplied `compliant`
 * bit. An invalid, future-dated or stale report from a device that has reported before fails
 * closed; a device that has never reported is allowed through, because it cannot be told apart
 * from an agent older than the feature. The only finding an active maintenance grant may excuse
 * is Task Manager being open.
 *
 * Returns true unconditionally unless `loginBlockedOnFindings` has been switched on for the
 * device — see the field's note in the model for what happened when that was the default.
 */
export function securityPostureAllowsLogin(
  posture: WindowsDeviceSecurityPosture | null | undefined,
  maintenance: WindowsDeviceMaintenanceAccess | null | undefined,
  policyInput: unknown,
  now: Date = new Date(),
): boolean {
  const policy = resolveDeviceSecurityPolicy(policyInput);

  // Report-only, which is the default. The checks still run on the PC, the findings are still
  // stored and still listed on the device page — they simply do not stand between an employee
  // and their work until somebody decides they should.
  if (!policy.loginBlockedOnFindings) return true;

  // No report at all is *unknown*, not *failing*, and the difference matters enormously: the
  // agents already installed across the fleet predate these checks and cannot produce one, so
  // treating absence as a failure would mean switching enforcement on locked out every machine
  // that had not yet been updated — which is the whole reason this setting exists. The device
  // page shows "awaiting the first security report" for exactly this state.
  if (!posture) return true;

  const checkedAt = Date.parse(posture.checkedAt);
  if (!Number.isFinite(checkedAt)) return false;

  // A device that *was* reporting and has stopped is a different matter. That is what tampering
  // looks like, so a stale or future-dated report from a machine known to be capable of
  // reporting is refused.
  const age = now.getTime() - checkedAt;
  if (age < -60_000 || age > WINDOWS_DEVICE_SECURITY_POSTURE_MAX_AGE_MS) return false;

  const activeGrant = activeMaintenanceAccess(maintenance, now);
  const allowTaskManagerUnlocked = activeGrant?.allowTaskManager === true;
  if (securityFindings(posture, { allowTaskManagerUnlocked, policy }).length > 0) return false;

  return posture.findings.every((finding) =>
    finding === 'TASK_MANAGER_UNLOCKED' && allowTaskManagerUnlocked);
}

export function postureChanged(
  previous: WindowsDeviceSecurityPosture | null | undefined,
  next: WindowsDeviceSecurityPosture,
): boolean {
  if (!previous) return true;
  return previous.compliant !== next.compliant
    || previous.secureBootEnabled !== next.secureBootEnabled
    || previous.taskManagerLocked !== next.taskManagerLocked
    || previous.agentStopBlocked !== next.agentStopBlocked
    || previous.serviceModificationBlocked !== next.serviceModificationBlocked
    || previous.agentBinariesSigned !== next.agentBinariesSigned
    || previous.signedAppControlPolicyActive !== next.signedAppControlPolicyActive
    || previous.findings.join('|') !== next.findings.join('|');
}
