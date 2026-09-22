using System;
using System.Collections.Generic;
using Sel.Agent.Core.Contracts;
using Sel.Agent.Core.Tracking;

namespace Sel.Agent.Core.Platform
{
    /// <summary>
    /// The seams between OS-agnostic logic and the parts that differ by Windows release.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The instruction is that no feature may be silently dropped on an older Windows — where a
    /// modern API is unavailable there must be a documented fallback. These interfaces are how
    /// that is enforced structurally rather than remembered: <c>SEL.Agent.Core</c> references only
    /// the interfaces, so a capability cannot quietly disappear on Windows 7. It can only be
    /// implemented differently, and the implementation has to exist for the project to compile.
    /// </para>
    /// <para>
    /// Only two things genuinely differ across Windows 7 → 11, which is worth stating because it
    /// is fewer than the compatibility table suggests:
    /// </para>
    /// <list type="bullet">
    /// <item><description>
    /// <b>Notifications.</b> The Action Center toast API arrived in Windows 10.
    /// <c>SEL.Agent.WindowsModern</c> uses it; <c>SEL.Agent.WindowsLegacy</c> draws an equivalent
    /// WPF window with the same buttons and the same deep-link behaviour.
    /// </description></item>
    /// <item><description>
    /// <b>The access gate.</b> Windows 10/11 Enterprise can enforce a controlled shell;
    /// everything else gets a topmost window, which is a weaker guarantee and is documented as
    /// one.
    /// </description></item>
    /// </list>
    /// <para>
    /// Everything else — foreground tracking, idle detection, lock/unlock, the service, the
    /// offline queue, deep links, auto-update — uses APIs that have been present since Windows
    /// Vista or earlier and needs no adapter at all. <c>SetWinEventHook</c>,
    /// <c>GetLastInputInfo</c>, <c>WTSRegisterSessionNotification</c> and
    /// <c>QueryFullProcessImageName</c> all behave identically on Windows 7 and Windows 11, which
    /// is why the Win32 implementations live in Core rather than being duplicated per release.
    /// </para>
    /// </remarks>
    public interface IForegroundWatcher : IDisposable
    {
        /// <summary>Raised when a different top-level window takes focus.</summary>
        event EventHandler<ForegroundSnapshot> ForegroundChanged;

        /// <summary>What is in front right now. Null when nothing can be determined.</summary>
        ForegroundSnapshot Capture();

        /// <summary>
        /// Read the address bar of a browser in front, to record time per website (§14).
        /// </summary>
        /// <remarks>
        /// Off unless the effective policy says otherwise, and off is the default. It is a
        /// *collection* switch rather than a reporting one: with it off the address bar is never
        /// read at all, so there is no copy of it in the agent's memory to leak, and none of the
        /// accessibility work it costs is done.
        /// </remarks>
        bool CollectBrowserDomains { get; set; }

        /// <summary>
        /// Record which document is open in Excel, Word and the rest (§13).
        /// </summary>
        /// <remarks>
        /// Also off by default, and also a collection switch. Separate from browser domains
        /// because an installation may reasonably want one without the other.
        /// </remarks>
        bool CollectDocumentNames { get; set; }

        void Start();
        void Stop();
    }

    /// <summary>How long since the user last touched the keyboard or mouse.</summary>
    public interface IIdleMonitor
    {
        /// <summary>
        /// Seconds since the last input, session-wide.
        /// </summary>
        /// <remarks>
        /// Returns zero rather than throwing when it cannot be determined — which happens when
        /// the calling process has no window station, as in a service running in session 0. That
        /// is why idle detection lives in the desktop agent and not in the service.
        /// </remarks>
        double GetIdleSeconds();
    }

    /// <summary>Locks the workstation.</summary>
    /// <remarks>
    /// An interface for one P/Invoke, so the idle-lock rules can be exercised in tests against a
    /// recording double instead of locking the machine running them. That is the whole reason it
    /// exists; there will never be a second production implementation.
    /// </remarks>
    public interface IWorkstationLock
    {
        /// <summary>Lock now. False when Windows refused, which is reported, not thrown.</summary>
        bool Lock();
    }

    public enum SessionStateChange
    {
        Locked,
        Unlocked,
        Suspending,
        Resumed,
        LogOff,
        Shutdown
    }

    /// <summary>Lock, unlock, sleep, resume, log off and shutdown.</summary>
    public interface ISessionStateMonitor : IDisposable
    {
        event EventHandler<SessionStateChange> StateChanged;
        void Start();
        void Stop();
    }

    /// <summary>What the user did with a notification.</summary>
    public sealed class NotificationOutcome
    {
        public string NotificationId { get; set; }

        /// <summary>One of <see cref="ReceiptStatuses"/>.</summary>
        public string Status { get; set; }

        /// <summary>Where to navigate, when the outcome was a click on an action.</summary>
        public string DeepLink { get; set; }

        public int? SnoozeMinutes { get; set; }
    }

    /// <summary>
    /// Shows a notification, however this Windows can.
    /// </summary>
    /// <remarks>
    /// The contract is the same on every release, which is the point: the coordinator raises a
    /// notification and reports a receipt, and has no idea whether what appeared was an Action
    /// Center toast or the agent's own window. §39's delivery statistics are therefore comparable
    /// across a mixed fleet — a Windows 7 PC reports DISPLAYED and CLICKED exactly as a Windows 11
    /// one does.
    /// </remarks>
    public interface INotificationPresenter : IDisposable
    {
        /// <summary>A short name for the agent status panel: "Windows notifications", "SEL LIVE popup".</summary>
        string DisplayName { get; }

        /// <summary>Whether this presenter can work on this machine right now.</summary>
        bool IsAvailable { get; }

        /// <summary>Raised when the user acts on a notification, or when it is dismissed.</summary>
        event EventHandler<NotificationOutcome> Outcome;

        /// <summary>
        /// Show one notification.
        /// </summary>
        /// <returns>
        /// True when it was displayed. False means the caller should report a FAILED receipt —
        /// §39 counts failures, and a notification that silently never appeared is the failure
        /// most worth knowing about.
        /// </returns>
        bool Show(AgentNotification notification);

        /// <summary>Remove anything still on screen. Called at sign-out.</summary>
        void ClearAll();
    }

    /// <summary>Opens ERP deep links in the user's browser.</summary>
    public interface IDeepLinkLauncher
    {
        /// <summary>
        /// Open <paramref name="path"/> against the ERP base URL.
        /// </summary>
        /// <remarks>
        /// Takes a path, never a full URL, and composes it against the configured base. A
        /// notification arrives over the network and ends up as an argument to
        /// <c>Process.Start</c>; accepting an absolute URL there would let a compromised or
        /// spoofed notification launch anything the shell can handle, which on Windows includes
        /// rather more than web pages.
        /// </remarks>
        void Open(string path);
    }

    /// <summary>Machine facts for the device record.</summary>
    public interface IMachineFactsProvider
    {
        DeviceMachineFacts Collect();
    }

    /// <summary>
    /// The durable queue of spans waiting to be uploaded.
    /// </summary>
    /// <remarks>
    /// Abstracted so the span-flush logic can be tested against an in-memory queue, and so a
    /// future change of storage does not reach the coordinator. The production implementation is
    /// SQLite with DPAPI-encrypted payloads.
    /// </remarks>
    public interface IOfflineQueue : IDisposable
    {
        void Enqueue(string sessionId, IEnumerable<ActivitySpan> spans);

        /// <summary>The oldest pending spans, up to <paramref name="max"/>.</summary>
        IList<QueuedSpan> Peek(int max);

        /// <summary>Remove spans the server accepted or reported as duplicates.</summary>
        void Acknowledge(IEnumerable<long> rowIds);

        /// <summary>
        /// Record a failed attempt.
        /// </summary>
        /// <remarks>
        /// Spans rejected outright by the server are dropped rather than retried for ever — a
        /// malformed span will be malformed next time too, and a queue that never drains is a
        /// queue that eventually fills a disk.
        /// </remarks>
        void MarkFailed(IEnumerable<long> rowIds, string reason, bool permanent);

        int PendingCount();

        /// <summary>Delete spans older than the retention window, matching §51 on the server.</summary>
        int Prune(TimeSpan olderThan);
    }

    public sealed class QueuedSpan
    {
        public long RowId { get; set; }
        public string SessionId { get; set; }
        public ActivitySpan Span { get; set; }
        public int Attempts { get; set; }
    }
}
