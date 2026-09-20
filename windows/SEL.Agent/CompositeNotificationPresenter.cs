using System;
using System.Windows.Threading;
using Sel.Agent.Core;
using Sel.Agent.Core.Contracts;
using Sel.Agent.Core.Platform;
using Sel.Agent.WindowsLegacy;
using Sel.Agent.WindowsModern;

namespace Sel.Agent
{
    /// <summary>
    /// Picks the best notification surface this machine has, and falls back if it fails.
    /// </summary>
    /// <remarks>
    /// <para>
    /// This class is where the compatibility requirement is actually kept. The instruction is
    /// that a feature must not be silently disabled on an older Windows — so notifications are
    /// never "unavailable"; they are either native or they are the SEL LIVE popup, and the
    /// caller cannot tell the difference from the outside.
    /// </para>
    ///
    /// <para><b>Selection is at runtime, not at build time.</b></para>
    /// <para>
    /// One binary ships to the whole fleet and decides per machine. The alternative — separate
    /// legacy and modern installers — would mean IT choosing the right one per PC, getting it
    /// wrong occasionally, and every subsequent update having to make the same choice again.
    /// </para>
    ///
    /// <para><b>The fallback is not only for old Windows.</b></para>
    /// <para>
    /// A Windows 11 machine can fail to raise a toast: no Start Menu shortcut after a
    /// hand-copied install, notifications disabled by Group Policy, a broken WinRT registration.
    /// Each of those would lose every notification for that user. Falling back to the popup on
    /// the first failure means the alert still arrives, and the agent status panel reports which
    /// surface is in use so somebody can notice and fix the underlying problem.
    /// </para>
    /// </remarks>
    public sealed class CompositeNotificationPresenter : INotificationPresenter
    {
        private readonly ModernNotificationPresenter _modern;
        private readonly LegacyNotificationPresenter _legacy;
        private readonly Action<string> _log;
        private bool _disposed;
        private bool _fellBack;

        public CompositeNotificationPresenter(Dispatcher dispatcher, Action<string> log)
        {
            _log = log ?? (message => { });
            _legacy = new LegacyNotificationPresenter(dispatcher);
            _legacy.Outcome += Forward;

            // Constructed even on Windows 7: the constructor touches nothing, and IsAvailable
            // short-circuits on the OS check without loading any WinRT type.
            _modern = new ModernNotificationPresenter(_log);
            _modern.Outcome += Forward;
        }

        public event EventHandler<NotificationOutcome> Outcome;

        /// <summary>Which surface is in use, for the agent status panel.</summary>
        public string DisplayName
        {
            get { return Active.DisplayName; }
        }

        /// <summary>Always true — see the class remarks. The popup cannot itself fall back.</summary>
        public bool IsAvailable { get { return true; } }

        private INotificationPresenter Active
        {
            get
            {
                if (_fellBack) return _legacy;
                return _modern.IsAvailable ? (INotificationPresenter)_modern : _legacy;
            }
        }

        public bool Show(AgentNotification notification)
        {
            INotificationPresenter chosen = Active;
            if (chosen.Show(notification)) return true;

            if (!ReferenceEquals(chosen, _legacy))
            {
                _log("Native notification failed; using the SEL LIVE popup from now on.");
                _fellBack = true;
                return _legacy.Show(notification);
            }

            return false;
        }

        private void Forward(object sender, NotificationOutcome outcome)
        {
            EventHandler<NotificationOutcome> handler = Outcome;
            if (handler != null) handler(this, outcome);
        }

        public void ClearAll()
        {
            _modern.ClearAll();
            _legacy.ClearAll();
        }

        /// <summary>A line for the agent status panel and the installation log.</summary>
        public string DescribeSelection()
        {
            OsCompatibility os = OsCompatibility.Current;
            if (_fellBack)
            {
                return "SEL LIVE popup (native notifications failed on this machine)";
            }
            if (!os.SupportsNativeToast)
            {
                return "SEL LIVE popup (" + os.FriendlyName + " has no Action Center)";
            }
            return _modern.IsAvailable
                ? "Windows notifications"
                : "SEL LIVE popup (no registered Start Menu shortcut)";
        }

        public void Dispose()
        {
            if (_disposed) return;
            _disposed = true;
            _modern.Outcome -= Forward;
            _legacy.Outcome -= Forward;
            _modern.Dispose();
            _legacy.Dispose();
        }
    }
}
