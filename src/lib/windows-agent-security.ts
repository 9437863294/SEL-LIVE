/**
 * Windows device-security policy resolution.
 *
 * Every device starts strict. A SEL LIVE administrator can persist a different policy for one PC
 * through the authenticated API. Keeping resolution pure lets the API, UI, login gate and tests
 * agree without trusting a browser or the endpoint's own `compliant` claim.
 */

import type {
  IsoInstant,
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
 * What one finding code means, in a sentence, and what to do about it.
 *
 * The codes exist so findings can be counted and filtered across a fleet; they are not what
 * somebody should be shown. The device page was printing them raw —
 * `AGENT_BINARY_UNSIGNED · SECURE_BOOT_OFF` — under a heading saying attention was required,
 * which tells the person who has to act neither what is wrong nor whether they caused it. Two of
 * these in particular are *expected* states rather than faults (unsigned binaries until a
 * certificate is bought, an unreadable Secure Boot flag on a legacy-boot PC), and saying so is
 * the difference between a page that prompts a fix and one that is ignored as noisy.
 */
export function describeSecurityFinding(code: string): string {
  switch (code) {
    case 'TASK_MANAGER_UNLOCKED':
      return 'Task Manager is open on this PC although the policy locks it.';
    case 'AGENT_STOP_ALLOWED':
      return 'A local administrator can stop the SEL LIVE service.';
    case 'SERVICE_MODIFIABLE':
      return 'The service can be reconfigured or deleted on this PC.';
    case 'SECURE_BOOT_OFF':
      return 'Secure Boot is switched off in this PC’s firmware.';
    case 'SECURE_BOOT_UNKNOWN':
      return 'Secure Boot cannot be read — normal on an older PC that boots in legacy/BIOS mode.';
    case 'AGENT_BINARY_UNSIGNED':
      return 'The installed agent files carry no code signature. Expected until the installer is signed with the company certificate.';
    case 'SIGNED_APP_CONTROL_POLICY_MISSING':
      return 'No enforced signed App Control (WDAC) policy is active on this PC.';
    case 'POSTURE_CHECK_FAILED':
      return 'The security check itself could not finish on this PC — see the agent’s event log.';
    default:
      // A code from a newer agent than this server. Better shown than swallowed.
      return code;
  }
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
  policyChangedAt: IsoInstant | null = null,
): boolean {
  // Report-only, which is the default. The checks still run on the PC, the findings are still
  // stored and still listed on the device page — they simply do not stand between an employee
  // and their work until somebody decides they should.
  if (!resolveDeviceSecurityPolicy(policyInput).loginBlockedOnFindings) return true;

  // Delegated rather than re-derived. This used to be a second copy of the same rules, whose
  // only job was to return a boolean — and a device page that warns "this will lock people
  // out" while the server quietly allows the sign-in, or the reverse, is worse than no warning
  // at all. One implementation means the two cannot disagree by construction.
  return securityLoginRefusalReasons(posture, maintenance, policyInput, { now, policyChangedAt })
    .length === 0;
}

/**
 * Why this device would refuse a sign-in, as sentences. Empty when it would not.
 *
 * ── Why this is separate from the gate ────────────────────────────────────────────────────────
 *
 * {@link securityPostureAllowsLogin} answers yes or no, which is all the gate needs and not
 * nearly enough for the two people who have to deal with the answer. The employee at the PC was
 * told "this computer has no fresh, compliant device-security report — contact IT", which names
 * neither the check that failed nor anything they could do. And the administrator ticking the
 * box was told nothing at all until somebody rang to say they could not sign in.
 *
 * So both now read from here: the API puts these sentences in the 403, and the device page runs
 * the same function against the *unsaved* policy to warn before the tick is saved. One source, so
 * the warning cannot promise something different from what the gate then does.
 *
 * Note what this deliberately reports even when enforcement is off: pass `assumeEnforced` and it
 * answers "what would happen if you switched this on", which is exactly the question the device
 * page needs and the gate never asks.
 */
export function securityLoginRefusalReasons(
  posture: WindowsDeviceSecurityPosture | null | undefined,
  maintenance: WindowsDeviceMaintenanceAccess | null | undefined,
  policyInput: unknown,
  options: {
    now?: Date;
    assumeEnforced?: boolean;
    /** {@link WindowsDevice.securityPolicyChangedAt} — a report older than this is not a failure. */
    policyChangedAt?: IsoInstant | null;
  } = {},
): string[] {
  const now = options.now ?? new Date();
  const policy = resolveDeviceSecurityPolicy(policyInput);
  if (!policy.loginBlockedOnFindings && !options.assumeEnforced) return [];

  // No report is unknown, not failing — the same judgement the gate makes, and for the same
  // reason: an agent older than these checks cannot produce one.
  if (!posture) return [];

  const checkedAt = Date.parse(posture.checkedAt);

  // A report taken before the rules changed has not been measured against them. Task Manager,
  // the service stop right and the service ACL all read false until the SYSTEM service applies
  // them on its next pass, so treating the last report as a failure means saving a policy the PC
  // will satisfy in under a minute still locks everybody out of it in the meantime. The device
  // page shows this as waiting for the first report under the new policy.
  const changedAt = options.policyChangedAt ? Date.parse(options.policyChangedAt) : NaN;
  if (Number.isFinite(changedAt) && Number.isFinite(checkedAt) && checkedAt < changedAt) return [];
  if (!Number.isFinite(checkedAt)) {
    return ['The security report from this computer cannot be read.'];
  }
  const age = now.getTime() - checkedAt;
  if (age < -60_000) return ['The security report from this computer is dated in the future.'];
  if (age > WINDOWS_DEVICE_SECURITY_POSTURE_MAX_AGE_MS) {
    return [
      `This computer last reported its security ${Math.round(age / 60_000)} minutes ago; a report `
      + 'older than 15 minutes is not trusted. Check that the SEL LIVE service is running.',
    ];
  }

  const activeGrant = activeMaintenanceAccess(maintenance, now);
  const allowTaskManagerUnlocked = activeGrant?.allowTaskManager === true;
  const derived = securityFindings(posture, { allowTaskManagerUnlocked, policy });
  const reported = posture.findings.filter((finding) =>
    !(finding === 'TASK_MANAGER_UNLOCKED' && allowTaskManagerUnlocked));

  return [...new Set([...derived, ...reported])].map(describeSecurityFinding);
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
