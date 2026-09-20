using System;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;
using Sel.Agent.Core.Contracts;
using Sel.Agent.Core.Platform;

namespace Sel.Agent.WindowsLegacy
{
    /// <summary>
    /// One notification panel on Windows 7 / 8 / 8.1.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Behaviourally equivalent to an Action Center toast, which is the requirement: same
    /// buttons, same deep link, same §39 receipts. The differences are cosmetic and are listed in
    /// the compatibility matrix rather than being pretended away.
    /// </para>
    ///
    /// <para><b>It must never steal focus.</b></para>
    /// <para>
    /// A window that activates itself while somebody is typing sends the next keystrokes
    /// somewhere unintended — into a notification, and out of the Excel formula they were half
    /// way through. On a machine that raises a dozen alerts a day that is not a cosmetic
    /// complaint, it is data loss. <c>ShowActivated="False"</c> is set before the first show and
    /// <c>WS_EX_NOACTIVATE</c> is applied to the handle, because the WPF property alone does not
    /// prevent activation on a later <c>Show</c>.
    /// </para>
    ///
    /// <para><b>Auto-dismiss, except when acknowledgement is required.</b></para>
    /// <para>
    /// Ordinary alerts fade after twelve seconds — long enough to read two lines, short enough
    /// not to occlude a spreadsheet. A notification flagged <c>requireAcknowledgement</c> stays
    /// until it is acted on, because §39 counts acknowledgements and a timer silently clearing
    /// one would make that number meaningless. Hovering pauses the timer, so a notification
    /// cannot expire while it is being read.
    /// </para>
    /// </remarks>
    public partial class SelNotificationWindow : Window
    {
        private static readonly TimeSpan AutoDismissAfter = TimeSpan.FromSeconds(12);

        private readonly AgentNotification _notification;
        private readonly DispatcherTimer _dismissTimer;
        private bool _outcomeReported;

        /// <summary>Raised exactly once, whatever the user does or does not do.</summary>
        public event EventHandler<NotificationOutcome> Outcome;

        public SelNotificationWindow(AgentNotification notification)
        {
            _notification = notification ?? throw new ArgumentNullException("notification");

            InitializeComponent();
            ShowActivated = false;

            ModuleLabel.Text = string.IsNullOrEmpty(notification.ItemRef)
                ? notification.Module
                : notification.Module + " · " + notification.ItemRef;
            TitleText.Text = notification.Title;
            MessageText.Text = notification.Message;
            PriorityStripe.Background = BrushForPriority(notification.Priority);

            BuildActions();

            // The body is clickable as well as the Open button — the whole panel behaving as the
            // primary action is what people expect from a notification, and it is what Action
            // Center does on Windows 10.
            MouseLeftButtonUp += OnBodyClicked;
            MouseEnter += (s, e) => _dismissTimer.Stop();
            MouseLeave += (s, e) => { if (!_notification.RequireAcknowledgement) _dismissTimer.Start(); };

            _dismissTimer = new DispatcherTimer { Interval = AutoDismissAfter };
            _dismissTimer.Tick += (s, e) => Report(ReceiptStatuses.Dismissed, null, null);

            Loaded += OnLoaded;
        }

        private void OnLoaded(object sender, RoutedEventArgs e)
        {
            NoActivateWindow.Apply(this);
            if (!_notification.RequireAcknowledgement) _dismissTimer.Start();
        }

        /// <summary>
        /// Build the buttons from the notification's own action list.
        /// </summary>
        /// <remarks>
        /// A notification with no actions still gets an Open button when it has a deep link, and
        /// a Dismiss when it does not — an alert with nothing to press is a dead end, and the
        /// server should not have to remember to add one.
        /// </remarks>
        private void BuildActions()
        {
            var actions = _notification.Actions;
            if (actions == null || actions.Count == 0)
            {
                if (!string.IsNullOrEmpty(_notification.DeepLink))
                {
                    ActionPanel.Children.Add(MakeButton("Open", true,
                        (s, e) => Report(ReceiptStatuses.Clicked, _notification.DeepLink, null)));
                }
                if (_notification.RequireAcknowledgement)
                {
                    ActionPanel.Children.Add(MakeButton("Acknowledge", true,
                        (s, e) => Report(ReceiptStatuses.Acknowledged, null, null)));
                }
                return;
            }

            bool first = true;
            foreach (NotificationAction action in actions)
            {
                NotificationAction captured = action;
                bool primary = first;
                first = false;
                ActionPanel.Children.Add(MakeButton(captured.Label, primary, (s, e) => Invoke(captured)));
            }
        }

        private void Invoke(NotificationAction action)
        {
            switch (action.Action)
            {
                case "SNOOZE":
                    Report(ReceiptStatuses.Snoozed, null, action.SnoozeMinutes ?? 15);
                    break;
                case "ACKNOWLEDGE":
                    Report(ReceiptStatuses.Acknowledged, null, null);
                    break;
                case "DISMISS":
                    Report(ReceiptStatuses.Dismissed, null, null);
                    break;
                default:
                    Report(ReceiptStatuses.Clicked, action.DeepLink ?? _notification.DeepLink, null);
                    break;
            }
        }

        private Button MakeButton(string label, bool primary, RoutedEventHandler onClick)
        {
            var button = new Button
            {
                Content = label,
                Margin = new Thickness(6, 0, 0, 0),
                Padding = new Thickness(12, 5, 12, 5),
                FontSize = 12,
                Cursor = Cursors.Hand,
                BorderThickness = new Thickness(1),
                Foreground = primary ? Brushes.White : new SolidColorBrush(Color.FromRgb(0x33, 0x41, 0x55)),
                Background = primary
                    ? new SolidColorBrush(Color.FromRgb(0x25, 0x63, 0xEB))
                    : new SolidColorBrush(Color.FromRgb(0xF1, 0xF5, 0xF9)),
                BorderBrush = primary
                    ? new SolidColorBrush(Color.FromRgb(0x1D, 0x4E, 0xD8))
                    : new SolidColorBrush(Color.FromRgb(0xD4, 0xD9, 0xE0))
            };
            button.Click += onClick;
            // Stops the panel-wide click handler firing as well and reporting a second outcome.
            button.Click += (s, e) => e.Handled = true;
            return button;
        }

        private void OnBodyClicked(object sender, MouseButtonEventArgs e)
        {
            if (e.Handled) return;
            if (string.IsNullOrEmpty(_notification.DeepLink)) return;
            Report(ReceiptStatuses.Clicked, _notification.DeepLink, null);
        }

        private void OnDismissClicked(object sender, RoutedEventArgs e)
        {
            e.Handled = true;
            Report(ReceiptStatuses.Dismissed, null, null);
        }

        /// <summary>
        /// Report the outcome and close. Guarded so exactly one receipt is ever sent.
        /// </summary>
        /// <remarks>
        /// The guard matters because several paths can race: the auto-dismiss timer can tick in
        /// the same instant a button is clicked. Two receipts for one notification would make the
        /// §39 delivery report count a click and a dismissal for the same person.
        /// </remarks>
        private void Report(string status, string deepLink, int? snoozeMinutes)
        {
            if (_outcomeReported) return;
            _outcomeReported = true;
            _dismissTimer.Stop();

            EventHandler<NotificationOutcome> handler = Outcome;
            if (handler != null)
            {
                handler(this, new NotificationOutcome
                {
                    NotificationId = _notification.Id,
                    Status = status,
                    DeepLink = deepLink,
                    SnoozeMinutes = snoozeMinutes
                });
            }

            try
            {
                Close();
            }
            catch (InvalidOperationException)
            {
                // Already closing, most likely because the application is shutting down.
            }
        }

        private static Brush BrushForPriority(string priority)
        {
            switch (priority)
            {
                case "CRITICAL": return new SolidColorBrush(Color.FromRgb(0xDC, 0x26, 0x26));
                case "HIGH": return new SolidColorBrush(Color.FromRgb(0xEA, 0x58, 0x0C));
                case "LOW": return new SolidColorBrush(Color.FromRgb(0x94, 0xA3, 0xB8));
                default: return new SolidColorBrush(Color.FromRgb(0x25, 0x63, 0xEB));
            }
        }
    }
}
