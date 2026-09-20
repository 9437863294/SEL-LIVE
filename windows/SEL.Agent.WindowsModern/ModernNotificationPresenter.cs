using System;
using System.Collections.Generic;
using Microsoft.Toolkit.Uwp.Notifications;
using Sel.Agent.Core;
using Sel.Agent.Core.Contracts;
using Sel.Agent.Core.Platform;

namespace Sel.Agent.WindowsModern
{
    /// <summary>
    /// Action Center toasts, on Windows 10 and 11.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The native path. Toasts land in Action Center, survive Focus Assist properly, respect the
    /// user's notification settings, and persist after they leave the screen — none of which the
    /// legacy popup can offer, which is why this is preferred wherever it works.
    /// </para>
    ///
    /// <para><b>Activation needs a Start Menu shortcut, and that is the failure mode to know about.</b></para>
    /// <para>
    /// A Win32 application can only raise a toast if it has an Application User Model ID, and it
    /// can only be <i>called back</i> when one is clicked if a COM server is registered against
    /// that AUMID. <c>ToastNotificationManagerCompat</c> handles the COM plumbing, but the
    /// shortcut is the installer's job — see the <c>SelAgentShortcut</c> component in the WiX
    /// source. Without it, <c>Show</c> throws, and the agent falls back to the legacy popup
    /// rather than losing the notification. That fallback is the reason
    /// <see cref="IsAvailable"/> probes rather than simply returning "is this Windows 10".
    /// </para>
    ///
    /// <para><b>Buttons carry arguments, not state.</b></para>
    /// <para>
    /// Everything the activation handler needs — the notification id, what was pressed, the deep
    /// link — is encoded into the toast's arguments. The alternative, keeping a dictionary of
    /// pending toasts in memory, breaks in the case that matters most: a toast clicked from
    /// Action Center an hour later, possibly after the agent has restarted. Arguments survive
    /// that; a dictionary does not.
    /// </para>
    /// </remarks>
    public sealed class ModernNotificationPresenter : INotificationPresenter
    {
        private const string ArgNotificationId = "selNotificationId";
        private const string ArgAction = "selAction";
        private const string ArgDeepLink = "selDeepLink";
        private const string ArgSnooze = "selSnooze";

        private readonly Action<string> _log;
        private bool _subscribed;
        private bool _disposed;
        private bool? _available;

        public ModernNotificationPresenter(Action<string> log)
        {
            _log = log ?? (message => { });
        }

        public string DisplayName { get { return "Windows notifications"; } }

        public event EventHandler<NotificationOutcome> Outcome;

        /// <summary>
        /// Whether toasts can actually be raised on this machine.
        /// </summary>
        /// <remarks>
        /// Probed once and cached. The OS check alone is not enough: a Windows 10 machine with no
        /// registered shortcut, or with notifications disabled by policy, throws on the first
        /// <c>Show</c>. Discovering that at the point of the first real alert — and dropping it —
        /// is exactly the silent feature loss the compatibility requirement forbids.
        /// </remarks>
        public bool IsAvailable
        {
            get
            {
                if (_available.HasValue) return _available.Value;
                if (!OsCompatibility.Current.SupportsNativeToast)
                {
                    _available = false;
                    return false;
                }
                try
                {
                    EnsureSubscribed();
                    // Touching the history is enough to force the COM registration to resolve
                    // without putting anything on screen.
                    ToastNotificationManagerCompat.History.Clear();
                    _available = true;
                }
                catch (Exception error)
                {
                    _log("Native toasts unavailable (" + error.Message + "); falling back to the SEL LIVE popup.");
                    _available = false;
                }
                return _available.Value;
            }
        }

        private void EnsureSubscribed()
        {
            if (_subscribed) return;
            ToastNotificationManagerCompat.OnActivated += OnToastActivated;
            _subscribed = true;
        }

        public bool Show(AgentNotification notification)
        {
            if (notification == null) return false;
            if (!IsAvailable) return false;

            try
            {
                var builder = new ToastContentBuilder();
                builder.AddArgument(ArgNotificationId, notification.Id);
                builder.AddArgument(ArgAction, ReceiptStatuses.Clicked);
                if (!string.IsNullOrEmpty(notification.DeepLink))
                {
                    builder.AddArgument(ArgDeepLink, notification.DeepLink);
                }

                builder.AddText(notification.Title);
                builder.AddText(notification.Message);

                string attribution = string.IsNullOrEmpty(notification.ItemRef)
                    ? notification.Module
                    : notification.Module + " · " + notification.ItemRef;
                if (!string.IsNullOrEmpty(attribution)) builder.AddAttributionText(attribution);

                AddButtons(builder, notification);

                if (notification.RequireAcknowledgement || notification.Priority == "CRITICAL")
                {
                    // Reminder scenario: the toast stays until it is acted on rather than
                    // sliding away after five seconds. §39 counts acknowledgements, and one that
                    // expired unseen would be counted as unacknowledged for the wrong reason.
                    builder.SetToastScenario(ToastScenario.Reminder);
                }

                builder.Show();
                return true;
            }
            catch (Exception error)
            {
                _log("Toast failed: " + error.Message);
                // One failure disables the path for the session and the composite presenter
                // takes over, rather than the same exception being thrown on every alert.
                _available = false;
                return false;
            }
        }

        private static void AddButtons(ToastContentBuilder builder, AgentNotification notification)
        {
            List<NotificationAction> actions = notification.Actions;

            if (actions == null || actions.Count == 0)
            {
                if (!string.IsNullOrEmpty(notification.DeepLink))
                {
                    builder.AddButton(new ToastButton()
                        .SetContent("Open")
                        .AddArgument(ArgNotificationId, notification.Id)
                        .AddArgument(ArgAction, ReceiptStatuses.Clicked)
                        .AddArgument(ArgDeepLink, notification.DeepLink));
                }
                if (notification.RequireAcknowledgement)
                {
                    builder.AddButton(new ToastButton()
                        .SetContent("Acknowledge")
                        .AddArgument(ArgNotificationId, notification.Id)
                        .AddArgument(ArgAction, ReceiptStatuses.Acknowledged));
                }
                return;
            }

            // Windows renders at most five buttons and silently drops the rest, so the list is
            // capped here — better a predictable first five than an arbitrary truncation.
            int count = 0;
            foreach (NotificationAction action in actions)
            {
                if (count++ >= 5) break;

                var button = new ToastButton()
                    .SetContent(action.Label)
                    .AddArgument(ArgNotificationId, notification.Id);

                switch (action.Action)
                {
                    case "SNOOZE":
                        button.AddArgument(ArgAction, ReceiptStatuses.Snoozed);
                        button.AddArgument(ArgSnooze, (action.SnoozeMinutes ?? 15).ToString());
                        break;
                    case "ACKNOWLEDGE":
                        button.AddArgument(ArgAction, ReceiptStatuses.Acknowledged);
                        break;
                    case "DISMISS":
                        button.AddArgument(ArgAction, ReceiptStatuses.Dismissed);
                        break;
                    default:
                        button.AddArgument(ArgAction, ReceiptStatuses.Clicked);
                        string link = action.DeepLink ?? notification.DeepLink;
                        if (!string.IsNullOrEmpty(link)) button.AddArgument(ArgDeepLink, link);
                        break;
                }

                builder.AddButton(button);
            }
        }

        private void OnToastActivated(ToastNotificationActivatedEventArgsCompat args)
        {
            try
            {
                ToastArguments parsed = ToastArguments.Parse(args.Argument);
                string notificationId = Value(parsed, ArgNotificationId);
                if (string.IsNullOrEmpty(notificationId)) return;

                int snoozeMinutes;
                string snoozeRaw = Value(parsed, ArgSnooze);
                bool hasSnooze = int.TryParse(snoozeRaw, out snoozeMinutes);

                EventHandler<NotificationOutcome> handler = Outcome;
                if (handler == null) return;

                handler(this, new NotificationOutcome
                {
                    NotificationId = notificationId,
                    Status = Value(parsed, ArgAction) ?? ReceiptStatuses.Clicked,
                    DeepLink = Value(parsed, ArgDeepLink),
                    SnoozeMinutes = hasSnooze ? (int?)snoozeMinutes : null
                });
            }
            catch (Exception error)
            {
                // This callback arrives from COM. An exception escaping it takes the process
                // down, and the process is somebody's tray agent.
                _log("Toast activation could not be handled: " + error.Message);
            }
        }

        private static string Value(ToastArguments arguments, string key)
        {
            string value;
            return arguments.TryGetValue(key, out value) ? value : null;
        }

        public void ClearAll()
        {
            try
            {
                if (_available == true) ToastNotificationManagerCompat.History.Clear();
            }
            catch (Exception)
            {
                // Nothing depends on the history being empty.
            }
        }

        public void Dispose()
        {
            if (_disposed) return;
            _disposed = true;
            if (_subscribed)
            {
                try { ToastNotificationManagerCompat.OnActivated -= OnToastActivated; }
                catch (Exception) { }
                _subscribed = false;
            }
        }
    }
}
