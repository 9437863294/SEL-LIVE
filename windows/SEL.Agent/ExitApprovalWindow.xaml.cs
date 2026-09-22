using System;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Media;

namespace Sel.Agent
{
    /// <summary>
    /// Asks a SEL LIVE administrator to authorise closing the agent.
    /// </summary>
    /// <remarks>
    /// <para>
    /// UI only. The decision is the server's — see
    /// <see cref="AgentHost.RequestExitApprovalAsync"/> — and this window's job is to collect a
    /// sign-in, report the answer in a sentence, and set <see cref="Window.DialogResult"/>.
    /// </para>
    /// <para>
    /// Nothing is remembered. The password is never copied out of the PasswordBox except to be
    /// sent, the administrator's token is discarded by the host when the call returns, and the
    /// employee's own agent session is untouched throughout.
    /// </para>
    /// </remarks>
    public partial class ExitApprovalWindow : Window
    {
        private readonly AgentHost _host;
        private readonly ApprovalPurpose _purpose;
        private bool _busy;

        /// <summary>Set when approval was granted, for the agent log.</summary>
        public string ApprovedByName { get; private set; }

        public ExitApprovalWindow(AgentHost host)
            : this(host, ApprovalPurpose.Exit)
        {
        }

        public ExitApprovalWindow(AgentHost host, ApprovalPurpose purpose)
        {
            _host = host ?? throw new ArgumentNullException("host");
            _purpose = purpose;
            InitializeComponent();

            bool uninstalling = purpose == ApprovalPurpose.Uninstall;
            string signedIn = host.CurrentLogin != null ? host.CurrentLogin.UserName : null;

            if (uninstalling)
            {
                // Stated in the strongest terms the situation deserves. Removing the agent is not
                // a pause: the PC afterwards is indistinguishable from one that was never
                // enrolled, and somebody approving this at four in the afternoon should know that
                // before they type a password rather than discover it from a report in October.
                Title = "SEL LIVE Agent — Approval to remove the agent";
                IntroText.Text = "Removing the agent ends attendance and activity recording on this "
                    + "computer permanently, so a SEL LIVE administrator has to approve it.";
                ApproveButton.Content = "Approve and remove agent";
                // "Keep running" is the right words for the tray's Exit and the wrong ones here:
                // the question being cancelled is an uninstall, not whether to stop the agent.
                CancelButton.Content = "Cancel removal";
            }
            else
            {
                IntroText.Text = string.IsNullOrEmpty(signedIn)
                    ? "Closing the agent stops attendance and activity recording on this computer, "
                      + "so a SEL LIVE administrator has to approve it."
                    : "Closing the agent stops recording attendance and activity for " + signedIn
                      + " on this computer, so a SEL LIVE administrator has to approve it.";
            }

            FooterText.Text = "Your Windows account is not what is checked here — this needs a SEL LIVE "
                + "sign-in with permission to manage computers. The approval is recorded in the audit trail.";

            Loaded += (sender, args) => EmailBox.Focus();
        }

        private async void OnApproveClicked(object sender, RoutedEventArgs e)
        {
            if (_busy) return;

            string email = (EmailBox.Text ?? string.Empty).Trim();
            string password = PasswordBox.Password ?? string.Empty;

            if (string.IsNullOrEmpty(email) || string.IsNullOrEmpty(password))
            {
                ShowStatus("Enter the administrator's SEL LIVE email address and password.", false);
                return;
            }

            SetBusy(true);
            try
            {
                ExitApprovalOutcome outcome = await _host
                    .RequestExitApprovalAsync(email, password, (ReasonBox.Text ?? string.Empty).Trim(),
                        _purpose == ApprovalPurpose.Uninstall ? "UNINSTALL" : "EXIT")
                    .ConfigureAwait(true);

                if (!outcome.Approved)
                {
                    ShowStatus(outcome.Message ?? "That approval was not accepted.", false);
                    PasswordBox.Clear();
                    PasswordBox.Focus();
                    return;
                }

                ApprovedByName = outcome.ApprovedByName;
                ShowStatus("Approved by " + outcome.ApprovedByName + ". "
                    + (_purpose == ApprovalPurpose.Uninstall ? "Continuing the removal…" : "Closing the agent…"), true);

                // A beat so the confirmation is readable. Closing the instant the server answers
                // makes an approval that worked look identical to a button that did nothing.
                await Task.Delay(900).ConfigureAwait(true);

                DialogResult = true;
                Close();
            }
            finally
            {
                // Only meaningful on the failure paths; on success the window is already closing.
                if (IsLoaded && DialogResult != true) SetBusy(false);
            }
        }

        private void OnCancelClicked(object sender, RoutedEventArgs e)
        {
            DialogResult = false;
            Close();
        }

        private void SetBusy(bool busy)
        {
            _busy = busy;
            ApproveButton.IsEnabled = !busy;
            EmailBox.IsEnabled = !busy;
            PasswordBox.IsEnabled = !busy;
            ReasonBox.IsEnabled = !busy;
            ApproveButton.Content = busy
                ? "Checking…"
                : _purpose == ApprovalPurpose.Uninstall ? "Approve and remove agent" : "Approve and close agent";
        }

        private void ShowStatus(string message, bool good)
        {
            StatusText.Text = message;
            StatusText.Foreground = new SolidColorBrush(good
                ? Color.FromRgb(0x16, 0x65, 0x34)
                : Color.FromRgb(0x99, 0x1B, 0x1B));
            StatusPanel.Background = new SolidColorBrush(good
                ? Color.FromRgb(0xF0, 0xFD, 0xF4)
                : Color.FromRgb(0xFE, 0xF2, 0xF2));
            StatusPanel.Visibility = Visibility.Visible;
        }
    }
}
