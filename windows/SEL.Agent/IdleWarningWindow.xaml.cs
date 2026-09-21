using System;
using System.Windows;

namespace Sel.Agent
{
    /// <summary>
    /// The countdown shown before an unattended PC locks.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Driven entirely from outside: the controller owns the timer and calls
    /// <see cref="UpdateCountdown"/> each tick. The window has no clock of its own, so there is
    /// one source of truth for how long is left and no way for the number on screen to disagree
    /// with the moment the lock actually happens.
    /// </para>
    ///
    /// <para><b>It must not take focus.</b></para>
    /// <para>
    /// <see cref="Window.ShowActivated"/> is false. This window appears precisely when somebody
    /// has stopped typing, and the most likely next event is that they start again — into
    /// whatever they were working in. A window that grabbed the keyboard at that moment would
    /// swallow the first few characters of the sentence that proves they are still there.
    /// </para>
    /// </remarks>
    public partial class IdleWarningWindow : Window
    {
        /// <summary>Raised when the person says they are still here.</summary>
        public event EventHandler KeepWorkingRequested;

        public IdleWarningWindow()
        {
            // Before InitializeComponent so it is in force for the first Show.
            ShowActivated = false;
            InitializeComponent();

            DetailText.Text = "This computer has been idle, so SEL LIVE is about to lock it. "
                + "Your work stays open — you will sign back in with your Windows password.";
        }

        /// <summary>Set the remaining time and the bar. Called once a second by the controller.</summary>
        public void UpdateCountdown(int secondsRemaining, int totalSeconds)
        {
            if (secondsRemaining < 0) secondsRemaining = 0;

            CountdownText.Text = secondsRemaining == 1
                ? "1 second"
                : secondsRemaining + " seconds";

            double fraction = totalSeconds > 0 ? (double)secondsRemaining / totalSeconds : 0;
            if (fraction < 0) fraction = 0;
            if (fraction > 1) fraction = 1;

            // Measured off the track rather than the window, so padding and border widths do not
            // have to be repeated here and kept in step with the XAML.
            double track = CountdownTrack.ActualWidth;
            CountdownBar.Width = track > 0 ? track * fraction : 0;
        }

        private void OnKeepWorking(object sender, RoutedEventArgs e)
        {
            // Clicking is itself input, so GetLastInputInfo has already reset and the next tick
            // would take this window down anyway. Raised explicitly so the response is immediate
            // rather than up to a second later.
            EventHandler handler = KeepWorkingRequested;
            if (handler != null) handler(this, EventArgs.Empty);
        }
    }
}
