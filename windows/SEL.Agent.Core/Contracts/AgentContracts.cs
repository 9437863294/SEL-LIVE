using System;
using System.Collections.Generic;
using Newtonsoft.Json;

namespace Sel.Agent.Core.Contracts
{
    /// <summary>
    /// The wire contract with <c>/api/windows-agent/*</c>.
    /// </summary>
    /// <remarks>
    /// <para>
    /// A transcription of <c>src/lib/windows-agent-model.ts</c>, and it must change with it. The
    /// TypeScript side is the source of truth because that is where the shapes are validated and
    /// where the rules that consume them live; this file is the client's view of the same
    /// contract.
    /// </para>
    /// <para>
    /// Every instant is an ISO-8601 string in UTC rather than a <see cref="DateTime"/> on the
    /// wire. That is not laziness about types — it is because the agent runs on machines whose
    /// clocks and time zones are frequently wrong, and a string that says <c>Z</c> cannot be
    /// silently reinterpreted as local time by a serialiser setting somebody changes in two years.
    /// The <see cref="DateTimeOffset"/> conversions happen in one place, in
    /// <see cref="IsoTime"/>, and are the only place the ambiguity exists.
    /// </para>
    /// <para>
    /// Newtonsoft.Json rather than System.Text.Json: the latter is a separate package on .NET
    /// Framework, drags in four System.* assemblies that need binding redirects, and has a history
    /// of assembly-load problems in Windows services on 4.x. Newtonsoft is already everywhere and
    /// works identically from Windows 7 to Windows 11.
    /// </para>
    /// </remarks>
    public static class IsoTime
    {
        /// <summary>Format an instant the way every route in the module expects it.</summary>
        public static string Format(DateTime value)
        {
            return value.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'",
                System.Globalization.CultureInfo.InvariantCulture);
        }

        /// <summary>Now, as the wire wants it.</summary>
        public static string Now()
        {
            return Format(DateTime.UtcNow);
        }

        /// <summary>Parse an instant, returning <see cref="DateTime.MinValue"/> if it is unusable.</summary>
        public static DateTime Parse(string value)
        {
            DateTime parsed;
            if (string.IsNullOrEmpty(value)) return DateTime.MinValue;
            if (DateTime.TryParse(value, System.Globalization.CultureInfo.InvariantCulture,
                System.Globalization.DateTimeStyles.AdjustToUniversal |
                System.Globalization.DateTimeStyles.AssumeUniversal, out parsed))
            {
                return parsed;
            }
            return DateTime.MinValue;
        }
    }

    /* ── Device ──────────────────────────────────────────────────────────────────────────── */

    public sealed class DeviceMachineFacts
    {
        [JsonProperty("hostname")] public string Hostname { get; set; }
        [JsonProperty("machineGuid")] public string MachineGuid { get; set; }
        [JsonProperty("windowsVersion")] public string WindowsVersion { get; set; }
        [JsonProperty("architecture")] public string Architecture { get; set; }
        [JsonProperty("manufacturer")] public string Manufacturer { get; set; }
        [JsonProperty("model")] public string Model { get; set; }
        [JsonProperty("serialNumber")] public string SerialNumber { get; set; }
        [JsonProperty("totalMemoryMb")] public long? TotalMemoryMb { get; set; }
        [JsonProperty("timeZoneId")] public string TimeZoneId { get; set; }
    }

    public sealed class DeviceRegisterRequest
    {
        [JsonProperty("enrollmentCode")] public string EnrollmentCode { get; set; }
        [JsonProperty("facts")] public DeviceMachineFacts Facts { get; set; }
        [JsonProperty("agentVersion")] public string AgentVersion { get; set; }
        [JsonProperty("deviceId")] public string DeviceId { get; set; }
    }

    public sealed class DeviceRegisterResponse
    {
        [JsonProperty("deviceId")] public string DeviceId { get; set; }
        [JsonProperty("deviceSecret")] public string DeviceSecret { get; set; }
        [JsonProperty("secretVersion")] public int SecretVersion { get; set; }
        [JsonProperty("deviceName")] public string DeviceName { get; set; }
        [JsonProperty("status")] public string Status { get; set; }
        [JsonProperty("approved")] public bool Approved { get; set; }
    }

    /// <summary>
    /// The answer to "will this enrolment code work?", asked before a code is redeemed.
    /// </summary>
    /// <remarks>
    /// A refusal never arrives as one of these — the server returns 403 and the client throws
    /// <see cref="Api.SelApiException"/> carrying the reason, so the four different refusals
    /// (unknown, disabled, expired, limit reached) reach the person installing intact.
    /// </remarks>
    public sealed class EnrollmentCodeCheckResponse
    {
        [JsonProperty("valid")] public bool Valid { get; set; }
        [JsonProperty("code")] public string Code { get; set; }
        [JsonProperty("departmentName")] public string DepartmentName { get; set; }
        [JsonProperty("assignedLocation")] public string AssignedLocation { get; set; }

        /// <summary>False when this code leaves a new PC waiting for an administrator (§45).</summary>
        [JsonProperty("autoApprove")] public bool AutoApprove { get; set; }

        /// <summary>Null when the code has no registration limit.</summary>
        [JsonProperty("remainingRegistrations")] public int? RemainingRegistrations { get; set; }
    }

    /* ── Policy ──────────────────────────────────────────────────────────────────────────── */

    /// <summary>
    /// The resolved policy. Every field is present — the server does the inheritance.
    /// </summary>
    /// <remarks>
    /// Defaults here match <c>DEFAULT_AGENT_POLICY</c> in <c>windows-agent-policy.ts</c> and
    /// matter in exactly one situation: the agent has started, has not yet reached the server,
    /// and has no cached policy. It then behaves as the cautious default says — tracking on, the
    /// access gate off, window titles off — rather than as an uninitialised struct would, where
    /// every interval would be zero and the agent would beat in a tight loop.
    /// </remarks>
    public sealed class AgentPolicySettings
    {
        [JsonProperty("requireMorningLogin")] public bool RequireMorningLogin { get; set; }
        [JsonProperty("requireLoginAfterRestart")] public bool RequireLoginAfterRestart { get; set; }
        [JsonProperty("idleThresholdSeconds")] public int IdleThresholdSeconds { get; set; }
        [JsonProperty("extendedIdleThresholdSeconds")] public int ExtendedIdleThresholdSeconds { get; set; }
        [JsonProperty("offlineGraceMinutes")] public int OfflineGraceMinutes { get; set; }
        [JsonProperty("heartbeatIntervalSeconds")] public int HeartbeatIntervalSeconds { get; set; }
        [JsonProperty("activityBatchIntervalSeconds")] public int ActivityBatchIntervalSeconds { get; set; }
        [JsonProperty("applicationTrackingEnabled")] public bool ApplicationTrackingEnabled { get; set; }
        [JsonProperty("windowTitleTrackingEnabled")] public bool WindowTitleTrackingEnabled { get; set; }
        [JsonProperty("browserDomainTrackingEnabled")] public bool BrowserDomainTrackingEnabled { get; set; }
        [JsonProperty("documentNameTrackingEnabled")] public bool DocumentNameTrackingEnabled { get; set; }
        [JsonProperty("notificationMode")] public string NotificationMode { get; set; }
        [JsonProperty("autoUpdateEnabled")] public bool AutoUpdateEnabled { get; set; }
        [JsonProperty("workdayStart")] public string WorkdayStart { get; set; }
        [JsonProperty("workdayEnd")] public string WorkdayEnd { get; set; }
        [JsonProperty("lateLoginGraceMinutes")] public int LateLoginGraceMinutes { get; set; }
        [JsonProperty("allowUserPauseTracking")] public bool AllowUserPauseTracking { get; set; }
        [JsonProperty("rawActivityRetentionDays")] public int RawActivityRetentionDays { get; set; }

        /* ── Session lifecycle ──────────────────────────────────────────────────────────────
         *
         * Whether an unattended desk becomes a locked one, and whether the SEL LIVE sign-in is
         * the way back in. Locking means LockWorkStation: the ordinary Windows lock screen the
         * person clears with their own Windows password, not a surface the agent invented.
         */

        [JsonProperty("lockOnIdleEnabled")] public bool LockOnIdleEnabled { get; set; }

        /// <summary>
        /// Seconds of no input before the lock countdown starts.
        /// </summary>
        /// <remarks>
        /// Deliberately not <see cref="IdleThresholdSeconds"/>, which only classifies recorded
        /// time and never acts. One number deciding both what a timesheet says and when
        /// somebody's screen goes dark could not be tuned for either.
        /// </remarks>
        [JsonProperty("idleLockSeconds")] public int IdleLockSeconds { get; set; }

        /// <summary>How long the "still working?" prompt counts down. Any input cancels it.</summary>
        [JsonProperty("idleLockWarningSeconds")] public int IdleLockWarningSeconds { get; set; }

        /// <summary>Closing the embedded SEL LIVE window locks the PC.</summary>
        [JsonProperty("lockOnErpWindowClose")] public bool LockOnErpWindowClose { get; set; }

        /// <summary>Signing out of SEL LIVE also locks the PC.</summary>
        [JsonProperty("lockOnSignOut")] public bool LockOnSignOut { get; set; }

        /// <summary>
        /// Seconds locked beyond which unlocking Windows also needs a fresh SEL LIVE sign-in.
        /// Zero asks every time; a very large value never does.
        /// </summary>
        [JsonProperty("reauthAfterLockSeconds")] public int ReauthAfterLockSeconds { get; set; }

        /// <summary>Whether closing the agent needs a SEL LIVE administrator.</summary>
        [JsonProperty("requireAdminToExit")] public bool RequireAdminToExit { get; set; }

        /// <summary>How long one activity span may run before it is closed. The granularity
        /// of the record, so it is a policy rather than a constant in the builder.</summary>
        [JsonProperty("maxSpanMinutes")] public int MaxSpanMinutes { get; set; }

        /// <summary>Seconds to wait for a reply before abandoning one request.</summary>
        [JsonProperty("requestTimeoutSeconds")] public int RequestTimeoutSeconds { get; set; }

        public static AgentPolicySettings Defaults()
        {
            return new AgentPolicySettings
            {
                RequireMorningLogin = false,
                RequireLoginAfterRestart = false,
                IdleThresholdSeconds = 300,
                ExtendedIdleThresholdSeconds = 900,
                OfflineGraceMinutes = 720,
                HeartbeatIntervalSeconds = 90,
                ActivityBatchIntervalSeconds = 180,
                ApplicationTrackingEnabled = true,
                WindowTitleTrackingEnabled = false,
                BrowserDomainTrackingEnabled = false,
                DocumentNameTrackingEnabled = false,
                NotificationMode = "TOAST_AND_TRAY",
                AutoUpdateEnabled = true,
                WorkdayStart = "09:00",
                WorkdayEnd = "18:00",
                LateLoginGraceMinutes = 15,
                AllowUserPauseTracking = false,
                RawActivityRetentionDays = 90,
                LockOnIdleEnabled = false,
                IdleLockSeconds = 600,
                IdleLockWarningSeconds = 60,
                LockOnErpWindowClose = false,
                LockOnSignOut = false,
                ReauthAfterLockSeconds = 1800,
                RequireAdminToExit = true,
                MaxSpanMinutes = 10,
                RequestTimeoutSeconds = 30
            };
        }
    }

    public sealed class ResolvedAgentPolicy
    {
        [JsonProperty("settings")] public AgentPolicySettings Settings { get; set; }
        [JsonProperty("sources")] public Dictionary<string, string> Sources { get; set; }
        [JsonProperty("appliedPolicyIds")] public List<string> AppliedPolicyIds { get; set; }

        public static ResolvedAgentPolicy Defaults()
        {
            return new ResolvedAgentPolicy
            {
                Settings = AgentPolicySettings.Defaults(),
                Sources = new Dictionary<string, string>(),
                AppliedPolicyIds = new List<string>()
            };
        }
    }

    /* ── Login ───────────────────────────────────────────────────────────────────────────── */

    public sealed class AgentLoginRequest
    {
        [JsonProperty("idToken")] public string IdToken { get; set; }
        [JsonProperty("sentAt")] public string SentAt { get; set; }
        [JsonProperty("agentVersion")] public string AgentVersion { get; set; }
        [JsonProperty("offlineLogin")] public bool OfflineLogin { get; set; }
        [JsonProperty("facts")] public DeviceMachineFacts Facts { get; set; }
    }

    public sealed class MorningMeeting
    {
        [JsonProperty("id")] public string Id { get; set; }
        [JsonProperty("title")] public string Title { get; set; }
        [JsonProperty("startAt")] public string StartAt { get; set; }
        [JsonProperty("link")] public string Link { get; set; }
    }

    public sealed class MorningSummary
    {
        [JsonProperty("greeting")] public string Greeting { get; set; }
        [JsonProperty("checkInAt")] public string CheckInAt { get; set; }
        [JsonProperty("pendingTasks")] public int PendingTasks { get; set; }
        [JsonProperty("overdueTasks")] public int OverdueTasks { get; set; }
        [JsonProperty("pendingApprovals")] public int PendingApprovals { get; set; }
        [JsonProperty("meetingsToday")] public int MeetingsToday { get; set; }
        [JsonProperty("reminders")] public int Reminders { get; set; }
        [JsonProperty("unreadNotifications")] public int UnreadNotifications { get; set; }
        [JsonProperty("nextMeetings")] public List<MorningMeeting> NextMeetings { get; set; }
    }

    public sealed class AgentLoginResponse
    {
        [JsonProperty("sessionId")] public string SessionId { get; set; }
        [JsonProperty("userId")] public string UserId { get; set; }
        [JsonProperty("userName")] public string UserName { get; set; }
        [JsonProperty("employeeId")] public string EmployeeId { get; set; }
        [JsonProperty("departmentName")] public string DepartmentName { get; set; }
        [JsonProperty("photoURL")] public string PhotoUrl { get; set; }
        [JsonProperty("loginAt")] public string LoginAt { get; set; }
        [JsonProperty("resumed")] public bool Resumed { get; set; }
        [JsonProperty("lateLogin")] public bool LateLogin { get; set; }
        [JsonProperty("policy")] public ResolvedAgentPolicy Policy { get; set; }
        [JsonProperty("morningSummary")] public MorningSummary MorningSummary { get; set; }
        [JsonProperty("selfViewEnabled")] public bool SelfViewEnabled { get; set; }
    }

    /* ── Activity ────────────────────────────────────────────────────────────────────────── */

    /// <summary>One stretch of foreground time, as recorded on the PC.</summary>
    /// <remarks>
    /// <see cref="SpanId"/> is generated here and becomes the server's document id, which is what
    /// makes a retried upload idempotent (§27). It must therefore be stable across a retry — it is
    /// assigned when the span is <i>closed</i>, stored with it in the queue, and never regenerated.
    /// </remarks>
    public sealed class ActivitySpan
    {
        [JsonProperty("spanId")] public string SpanId { get; set; }
        [JsonProperty("eventType")] public string EventType { get; set; }
        [JsonProperty("processName")] public string ProcessName { get; set; }
        [JsonProperty("applicationName")] public string ApplicationName { get; set; }
        [JsonProperty("executablePath")] public string ExecutablePath { get; set; }
        [JsonProperty("startedAt")] public string StartedAt { get; set; }
        [JsonProperty("endedAt")] public string EndedAt { get; set; }
        [JsonProperty("idleSeconds")] public int IdleSeconds { get; set; }
        [JsonProperty("recordedOffline")] public bool RecordedOffline { get; set; }
        [JsonProperty("windowTitle")] public string WindowTitle { get; set; }
        [JsonProperty("browserDomain")] public string BrowserDomain { get; set; }

        /// <summary>
        /// The name of the document that was open — never its contents. §13.
        /// </summary>
        /// <remarks>
        /// Separate from <see cref="WindowTitle"/> and gated by its own policy switch, because
        /// they are different disclosures: a title can be an email subject or a chat message,
        /// while this is only ever a file name, from a fixed list of document applications.
        /// See <c>DocumentNameRules</c>.
        /// </remarks>
        [JsonProperty("documentName")] public string DocumentName { get; set; }
    }

    public static class ActivityEventTypes
    {
        public const string AppActive = "APP_ACTIVE";
        public const string IdleStart = "IDLE_START";
        public const string IdleEnd = "IDLE_END";
        public const string Lock = "LOCK";
        public const string Unlock = "UNLOCK";
        public const string Sleep = "SLEEP";
        public const string Resume = "RESUME";
        public const string Login = "LOGIN";
        public const string Logout = "LOGOUT";
    }

    public sealed class ActivityBatchRequest
    {
        [JsonProperty("sessionId")] public string SessionId { get; set; }
        [JsonProperty("idToken")] public string IdToken { get; set; }
        [JsonProperty("sentAt")] public string SentAt { get; set; }
        [JsonProperty("spans")] public List<ActivitySpan> Spans { get; set; }
    }

    public sealed class SpanRejection
    {
        [JsonProperty("spanId")] public string SpanId { get; set; }
        [JsonProperty("reason")] public string Reason { get; set; }
    }

    public sealed class SessionTotals
    {
        [JsonProperty("totalSeconds")] public int TotalSeconds { get; set; }
        [JsonProperty("activeSeconds")] public int ActiveSeconds { get; set; }
        [JsonProperty("idleSeconds")] public int IdleSeconds { get; set; }
        [JsonProperty("extendedIdleSeconds")] public int ExtendedIdleSeconds { get; set; }
        [JsonProperty("lockedSeconds")] public int LockedSeconds { get; set; }
    }

    public sealed class ActivityBatchResponse
    {
        [JsonProperty("accepted")] public int Accepted { get; set; }
        [JsonProperty("rejected")] public List<SpanRejection> Rejected { get; set; }
        [JsonProperty("duplicates")] public List<string> Duplicates { get; set; }
        [JsonProperty("sessionTotals")] public SessionTotals SessionTotals { get; set; }
    }

    /* ── Heartbeat ───────────────────────────────────────────────────────────────────────── */

    public static class PresenceStates
    {
        public const string Active = "ACTIVE";
        public const string Idle = "IDLE";
        public const string ExtendedIdle = "EXTENDED_IDLE";
        public const string Locked = "LOCKED";
        public const string Offline = "OFFLINE";
    }

    public sealed class HeartbeatRequest
    {
        [JsonProperty("sessionId")] public string SessionId { get; set; }
        [JsonProperty("idToken")] public string IdToken { get; set; }
        [JsonProperty("sentAt")] public string SentAt { get; set; }
        [JsonProperty("presence")] public string Presence { get; set; }
        [JsonProperty("processName")] public string ProcessName { get; set; }
        [JsonProperty("applicationName")] public string ApplicationName { get; set; }
        [JsonProperty("agentVersion")] public string AgentVersion { get; set; }
        [JsonProperty("queuedSpanCount")] public int QueuedSpanCount { get; set; }
        [JsonProperty("idleSeconds")] public int IdleSeconds { get; set; }
    }

    public sealed class AgentDirective
    {
        [JsonProperty("directiveId")] public string DirectiveId { get; set; }
        [JsonProperty("kind")] public string Kind { get; set; }
        [JsonProperty("issuedAt")] public string IssuedAt { get; set; }
        [JsonProperty("reason")] public string Reason { get; set; }
        [JsonProperty("message")] public string Message { get; set; }
    }

    public static class DirectiveKinds
    {
        public const string SignOut = "SIGN_OUT";
        public const string ForceReauth = "FORCE_REAUTH";
        public const string LockWorkstation = "LOCK_WORKSTATION";
        public const string SyncNow = "SYNC_NOW";
        public const string RestartAgent = "RESTART_AGENT";
        public const string ApplyUpdate = "APPLY_UPDATE";
        public const string ShowMessage = "SHOW_MESSAGE";
    }

    public sealed class AvailableVersion
    {
        [JsonProperty("version")] public string Version { get; set; }
        [JsonProperty("packageUrl")] public string PackageUrl { get; set; }
        [JsonProperty("packageSha256")] public string PackageSha256 { get; set; }
        [JsonProperty("signatureSubject")] public string SignatureSubject { get; set; }
        [JsonProperty("releaseNotes")] public string ReleaseNotes { get; set; }
        [JsonProperty("packageSizeBytes")] public long? PackageSizeBytes { get; set; }
    }

    public sealed class HeartbeatResponse
    {
        [JsonProperty("serverTime")] public string ServerTime { get; set; }
        [JsonProperty("policy")] public ResolvedAgentPolicy Policy { get; set; }
        [JsonProperty("directives")] public List<AgentDirective> Directives { get; set; }
        [JsonProperty("pendingNotificationIds")] public List<string> PendingNotificationIds { get; set; }
        [JsonProperty("availableVersion")] public AvailableVersion AvailableVersion { get; set; }
    }

    /* ── Logout ──────────────────────────────────────────────────────────────────────────── */

    public sealed class SessionLogoutRequest
    {
        [JsonProperty("sessionId")] public string SessionId { get; set; }
        [JsonProperty("idToken")] public string IdToken { get; set; }
        [JsonProperty("endReason")] public string EndReason { get; set; }
        [JsonProperty("endedAt")] public string EndedAt { get; set; }
        [JsonProperty("finalSpans")] public List<ActivitySpan> FinalSpans { get; set; }
    }

    public static class SessionEndReasons
    {
        public const string UserSignout = "USER_SIGNOUT";
        public const string WindowsLogoff = "WINDOWS_LOGOFF";
        public const string WindowsShutdown = "WINDOWS_SHUTDOWN";
        public const string WindowsRestart = "WINDOWS_RESTART";
        public const string AgentStopped = "AGENT_STOPPED";
    }

    /* ── Notifications ───────────────────────────────────────────────────────────────────── */

    public sealed class NotificationAction
    {
        [JsonProperty("label")] public string Label { get; set; }
        [JsonProperty("action")] public string Action { get; set; }
        [JsonProperty("deepLink")] public string DeepLink { get; set; }
        [JsonProperty("snoozeMinutes")] public int? SnoozeMinutes { get; set; }
    }

    public sealed class AgentNotification
    {
        [JsonProperty("id")] public string Id { get; set; }
        [JsonProperty("type")] public string Type { get; set; }
        [JsonProperty("priority")] public string Priority { get; set; }
        [JsonProperty("title")] public string Title { get; set; }
        [JsonProperty("message")] public string Message { get; set; }
        [JsonProperty("deepLink")] public string DeepLink { get; set; }
        [JsonProperty("actions")] public List<NotificationAction> Actions { get; set; }
        [JsonProperty("requireAcknowledgement")] public bool RequireAcknowledgement { get; set; }
        [JsonProperty("module")] public string Module { get; set; }
        [JsonProperty("itemRef")] public string ItemRef { get; set; }
        [JsonProperty("startAt")] public string StartAt { get; set; }
    }

    public sealed class NotificationListResponse
    {
        [JsonProperty("notifications")] public List<AgentNotification> Notifications { get; set; }
    }

    public sealed class NotificationAckRequest
    {
        [JsonProperty("notificationId")] public string NotificationId { get; set; }
        [JsonProperty("idToken")] public string IdToken { get; set; }
        [JsonProperty("status")] public string Status { get; set; }
        [JsonProperty("snoozeMinutes")] public int? SnoozeMinutes { get; set; }
        [JsonProperty("failureReason")] public string FailureReason { get; set; }
    }

    public static class ReceiptStatuses
    {
        public const string Displayed = "DISPLAYED";
        public const string Clicked = "CLICKED";
        public const string Acknowledged = "ACKNOWLEDGED";
        public const string Snoozed = "SNOOZED";
        public const string Dismissed = "DISMISSED";
        public const string Failed = "FAILED";
    }

    /* ── Version check ───────────────────────────────────────────────────────────────────── */

    public sealed class VersionCheckResponse
    {
        [JsonProperty("update")] public AvailableVersion Update { get; set; }
        [JsonProperty("mandatory")] public bool Mandatory { get; set; }
        [JsonProperty("current")] public string Current { get; set; }
    }

    /* ── Errors ──────────────────────────────────────────────────────────────────────────── */

    public sealed class ApiErrorBody
    {
        [JsonProperty("error")] public string Error { get; set; }
        [JsonProperty("code")] public string Code { get; set; }
    }

    /// <summary>
    /// A refusal from the server, carrying the machine-readable code the gate branches on.
    /// </summary>
    /// <remarks>
    /// The distinction between <see cref="IsTransient"/> and everything else is what stops the
    /// agent hammering a server that has told it "no". A blocked device retrying its sign-in every
    /// thirty seconds for a week is a self-inflicted denial of service; a network blip retrying is
    /// correct behaviour.
    /// </remarks>
    public class SelApiException : Exception
    {
        public SelApiException(string message, int statusCode, string code)
            : base(message)
        {
            StatusCode = statusCode;
            Code = code ?? "BAD_REQUEST";
        }

        public int StatusCode { get; private set; }
        public string Code { get; private set; }

        /// <summary>True when retrying later might work: timeouts, 5xx, and rate limiting.</summary>
        public bool IsTransient
        {
            get { return StatusCode == 0 || StatusCode >= 500 || StatusCode == 429; }
        }

        /// <summary>True when the device credential is no longer accepted and must be re-enrolled.</summary>
        public bool RequiresReenrollment
        {
            get { return Code == "DEVICE_UNKNOWN"; }
        }

        /// <summary>True when the user must sign in again, but the device is fine.</summary>
        public bool RequiresReauthentication
        {
            get { return Code == "UNAUTHORIZED" || StatusCode == 401; }
        }
    }
}
