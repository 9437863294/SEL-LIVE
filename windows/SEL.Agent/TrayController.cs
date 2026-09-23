using System;
using System.Drawing;
using System.Windows.Forms;
using Sel.Agent.Core;
using Sel.Agent.Core.Contracts;

namespace Sel.Agent
{
    /// <summary>
    /// The system tray icon and its menu (§26).
    /// </summary>
    /// <remarks>
    /// <para>
    /// <c>System.Windows.Forms.NotifyIcon</c> in a WPF application, because WPF has never had a
    /// tray API and every alternative is a wrapper around this same class. Referencing
    /// WindowsForms alongside WPF is well-trodden and costs one assembly; writing a Shell_NotifyIcon
    /// wrapper by hand would cost a hidden window, a window procedure and the taskbar-restart
    /// message nobody remembers to handle until the icon disappears after Explorer crashes.
    /// </para>
    ///
    /// <para><b>The menu changes with the policy, not just with its enabled state.</b></para>
    /// <para>
    /// §26 says an employee must not be able to stop tracking during a mandatory session unless
    /// their role permits it. "Pause tracking" is therefore <i>absent</i> when
    /// <c>allowUserPauseTracking</c> is off rather than present and disabled — a greyed-out
    /// control invites somebody to find out how to un-grey it, whereas an absent one does not
    /// advertise that the capability exists. The coordinator refuses the call independently, so
    /// the menu is a courtesy and not the control.
    /// </para>
    ///
    /// <para><b>The icon carries state.</b></para>
    /// <para>
    /// Colour and tooltip reflect signed-out, working, idle, locked and offline. It is the only
    /// always-visible surface the agent has, and somebody wondering whether their hours are being
    /// recorded should be able to answer that by looking at it rather than by opening a window.
    /// </para>
    /// </remarks>
    public sealed class TrayController : IDisposable
    {
        private readonly AgentHost _host;
        private readonly NotifyIcon _icon;
        private readonly ContextMenuStrip _menu;
        private readonly System.Windows.Forms.Timer _refresh;
        private AgentStatusWindow _statusWindow;
        private bool _disposed;

        public event EventHandler ExitRequested;
        public event EventHandler SignOutRequested;

        /// <summary>Raised when a signed-out user asks to sign in from the menu.</summary>
        public event EventHandler SignInRequested;

        /// <summary>
        /// Raised by the Shift-revealed "Stop background service" item.
        /// </summary>
        /// <remarks>
        /// The service's Stop button is refused by Windows to everybody but SYSTEM, so this is
        /// the supported way to stop it on a machine somebody is standing at. It leads to the
        /// same approval window as Exit.
        /// </remarks>
        public event EventHandler StopServiceRequested;

        public TrayController(AgentHost host)
        {
            _host = host ?? throw new ArgumentNullException("host");

            _menu = new ContextMenuStrip();
            _icon = new NotifyIcon
            {
                Text = "SEL LIVE Agent",
                Icon = BuildIcon(Color.FromArgb(0x94, 0xA3, 0xB8)),
                ContextMenuStrip = _menu,
                Visible = false
            };
            // A left click opens SEL LIVE. MouseClick rather than Click, because Click fires for
            // the right button too and would open a window behind the context menu.
            //
            // This used to open Agent status on a double click, which put the diagnostics panel
            // in the most discoverable gesture on the icon and left the application itself
            // needing a right click and a menu.
            _icon.MouseClick += (s, e) =>
            {
                if (e.Button == MouseButtons.Left) _host.OpenErp("/");
            };

            // Rebuilt on open rather than once: the policy can change between heartbeats, and a
            // menu built at start-up would still be offering "Pause tracking" an hour after an
            // administrator switched it off.
            _menu.Opening += (s, e) => BuildMenu();

            _refresh = new System.Windows.Forms.Timer { Interval = 15000 };
            _refresh.Tick += (s, e) => RefreshIcon();

            _host.StatusChanged += (s, e) => RefreshIcon();
        }

        public void Show()
        {
            _icon.Visible = true;
            _refresh.Start();
            RefreshIcon();
        }

        public void ShowBalloon(string title, string message)
        {
            try
            {
                _icon.BalloonTipTitle = title;
                _icon.BalloonTipText = message;
                _icon.BalloonTipIcon = ToolTipIcon.Info;
                _icon.ShowBalloonTip(6000);
            }
            catch (Exception)
            {
                // Balloons are suppressible by policy and by Focus Assist. Never worth an error.
            }
        }

        private void BuildMenu()
        {
            _menu.Items.Clear();
            AgentStatus status = _host.Coordinator.Status;

            // Who is signed in, and whether anything is being recorded. Kept because signing in
            // as the wrong person is otherwise invisible until the timesheet is wrong.
            //
            // Without the foreground application, which the tooltip still carries: naming the
            // program somebody is looking at, back to them, on their own screen, tells them
            // nothing they cannot see and reads like being watched rather than being informed.
            var header = new ToolStripMenuItem(status.SignedIn
                ? status.UserName + " — " + DescribePresence(status, false)
                : "Not signed in — nothing is being recorded")
            { Enabled = false };
            _menu.Items.Add(header);
            _menu.Items.Add(new ToolStripSeparator());

            // The entry that was missing. Without it a signed-out agent offered no way back to
            // the sign-in screen, so it sat in the tray recording nothing with no visible cause.
            if (!status.SignedIn)
            {
                var signIn = Item("Sign in…", () =>
                {
                    EventHandler handler = SignInRequested;
                    if (handler != null) handler(this, EventArgs.Empty);
                });
                signIn.Font = new Font(signIn.Font, FontStyle.Bold);
                _menu.Items.Add(signIn);
                _menu.Items.Add(new ToolStripSeparator());
            }

            // Three items, and that is the whole menu.
            //
            // It used to carry shortcuts to My work, Tasks, Approvals and Meetings. Every one of
            // them opened a page of SEL LIVE, which "Open SEL LIVE" already reaches and which
            // the ERP's own navigation is better at listing — so they were a second, worse menu
            // for the application, kept in step by hand, in a place nobody looks for navigation.
            _menu.Items.Add(Item("Open SEL LIVE", () => _host.OpenErp("/")));

            // §26: absent, not disabled, when the policy forbids it. Off by default, so this is
            // normally not present at all. See the class remarks.
            if (_host.Coordinator.Policy.Settings.AllowUserPauseTracking)
            {
                _menu.Items.Add(Item("Pause tracking", () =>
                {
                    if (!_host.Coordinator.TryPauseTracking())
                    {
                        ShowBalloon("Tracking", "Tracking cannot be paused during a mandatory session.");
                    }
                }));
            }

            // Diagnostics, behind Shift.
            //
            // Sync now, Agent status and Monitoring policy are support tools, not things an
            // employee needs on a Tuesday. But the activity log in Agent status is held in
            // memory and is not written to disk unless verboseLogging is on, so dropping the
            // item outright would have made the agent's own log unreachable at the moment
            // somebody is trying to work out why it misbehaved.
            //
            // Shift to reveal extra menu entries is Explorer's own convention, so it is
            // discoverable to the people who would think to try it and invisible to everyone
            // else. The alternatives were leaving clutter in front of four hundred employees,
            // or telling support to enable file logging and reproduce the fault again.
            if ((Control.ModifierKeys & Keys.Shift) == Keys.Shift)
            {
                _menu.Items.Add(new ToolStripSeparator());

                _menu.Items.Add(Item("Sync now", async () =>
                {
                    await _host.Coordinator.SyncNowAsync().ConfigureAwait(false);
                }));
                _menu.Items.Add(Item("Agent status", ShowStatus));
                _menu.Items.Add(Item("Monitoring policy", () => _host.OpenErp("/windows-agent/monitoring-policy")));

                // Behind Shift because it is an IT action, not an employee one — and because
                // the Stop button in services.msc no longer works, so this is the only way to
                // stop the service on a machine somebody is standing at. It asks for the same
                // SEL LIVE approval as Exit, and the service checks that approval itself.
                _menu.Items.Add(Item("Stop background service…", () =>
                {
                    EventHandler handler = StopServiceRequested;
                    if (handler != null) handler(this, EventArgs.Empty);
                }));
            }

            _menu.Items.Add(new ToolStripSeparator());

            if (status.SignedIn)
            {
                _menu.Items.Add(Item("Sign out", () =>
                {
                    EventHandler handler = SignOutRequested;
                    if (handler != null) handler(this, EventArgs.Empty);
                }));
            }

            // Exit is offered because a tray application without one is a support call. It does
            // not defeat the agent: the Windows service restarts it, and the session it closes
            // is recorded as a proper sign-out rather than left dangling.
            _menu.Items.Add(Item("Exit", () =>
            {
                EventHandler handler = ExitRequested;
                if (handler != null) handler(this, EventArgs.Empty);
            }));
        }

        private static ToolStripMenuItem Item(string text, Action onClick)
        {
            var item = new ToolStripMenuItem(text);
            item.Click += (s, e) =>
            {
                try
                {
                    onClick();
                }
                catch (Exception)
                {
                    // A menu handler that throws would surface as a crash dialog over whatever
                    // the person is doing. Swallowed here; the action itself logs its failures.
                }
            };
            return item;
        }

        private void ShowStatus()
        {
            if (_statusWindow == null)
            {
                _statusWindow = new AgentStatusWindow(_host);
                _statusWindow.Closed += (s, e) => _statusWindow = null;
                _statusWindow.Show();
            }
            else
            {
                _statusWindow.Activate();
            }
        }

        private void RefreshIcon()
        {
            try
            {
                AgentStatus status = _host.Coordinator.Status;
                _icon.Icon = BuildIcon(ColourFor(status));

                string line = status.SignedIn
                    ? "SEL LIVE — " + status.UserName + Environment.NewLine + DescribePresence(status, true)
                    : "SEL LIVE Agent — not signed in";
                if (status.QueuedSpans > 0) line += Environment.NewLine + status.QueuedSpans + " pending upload";
                if (!status.Online) line += Environment.NewLine + "Offline — recording locally";

                // NotifyIcon truncates at 63 characters on Windows 7 and throws on longer values
                // in some framework versions, so it is trimmed rather than trusted.
                _icon.Text = line.Length > 62 ? line.Substring(0, 62) : line;
            }
            catch (Exception)
            {
                // A failed icon refresh must not take the agent down.
            }
        }

        private static string DescribePresence(AgentStatus status, bool includeApplication)
        {
            if (!status.Online) return "Offline";
            switch (status.Presence)
            {
                case PresenceStates.Locked: return "Locked";
                case PresenceStates.Idle: return "Idle";
                case PresenceStates.ExtendedIdle: return "Idle (extended)";
                default:
                    return !includeApplication || string.IsNullOrEmpty(status.CurrentApplication)
                        ? "Working"
                        : "Working — " + status.CurrentApplication;
            }
        }

        private static Color ColourFor(AgentStatus status)
        {
            if (!status.SignedIn) return Color.FromArgb(0x94, 0xA3, 0xB8);
            if (!status.Online) return Color.FromArgb(0xF5, 0x9E, 0x0B);
            switch (status.Presence)
            {
                case PresenceStates.Locked: return Color.FromArgb(0x64, 0x74, 0x8B);
                case PresenceStates.Idle:
                case PresenceStates.ExtendedIdle: return Color.FromArgb(0xEA, 0xB3, 0x08);
                default: return Color.FromArgb(0x22, 0xC5, 0x5E);
            }
        }

        /// <summary>
        /// Draw the tray icon rather than shipping five .ico files.
        /// </summary>
        /// <remarks>
        /// The icon is a filled disc in a state colour, which is all the information it carries.
        /// Drawing it means no embedded resources, no scaling artefacts at 125% and 150% DPI —
        /// where a 16px icon looks noticeably wrong — and no five-icon set to keep in step when
        /// somebody changes the palette. <c>DestroyIcon</c> is called on the intermediate handle
        /// because <c>Icon.FromHandle</c> does not own it, and leaking one GDI handle every
        /// fifteen seconds exhausts the desktop heap in about a day.
        /// </remarks>
        /// <summary>
        /// The application icon, extracted once from our own executable.
        /// </summary>
        /// <remarks>
        /// Null when it cannot be read, which is handled rather than thrown: an agent that
        /// refused to start because it could not draw its own tray icon would be a poor trade.
        /// </remarks>
        private static readonly Bitmap BrandMark = LoadBrandMark();

        private static Bitmap LoadBrandMark()
        {
            try
            {
                string executable = System.Diagnostics.Process.GetCurrentProcess().MainModule.FileName;
                using (Icon extracted = Icon.ExtractAssociatedIcon(executable))
                {
                    return extracted == null ? null : extracted.ToBitmap();
                }
            }
            catch (Exception)
            {
                return null;
            }
        }

        /// <summary>
        /// The tray icon: the company mark, with a status dot in the corner.
        /// </summary>
        /// <remarks>
        /// This used to be the status dot alone, filling the whole 16 pixels. It read clearly
        /// but said nothing about which application it belonged to — somebody with a dozen tray
        /// icons had no way to find SEL LIVE except by hovering over each in turn.
        ///
        /// The dot is kept because it carries real information — signed out, working, idle,
        /// offline — and moving it to a corner badge loses none of that while making the icon
        /// identifiable. Where the mark cannot be loaded this falls back to the original dot.
        /// </remarks>
        private static Icon BuildIcon(Color colour)
        {
            using (var bitmap = new Bitmap(16, 16))
            {
                using (Graphics graphics = Graphics.FromImage(bitmap))
                {
                    graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
                    graphics.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
                    graphics.Clear(Color.Transparent);

                    if (BrandMark != null)
                    {
                        // The mark is a wide wordmark, so it occupies the upper band and leaves
                        // the lower-right corner free for the badge rather than being centred.
                        graphics.DrawImage(BrandMark, new Rectangle(0, 2, 16, 8));

                        using (var brush = new SolidBrush(colour))
                        {
                            graphics.FillEllipse(brush, 8, 8, 8, 8);
                        }
                        using (var pen = new Pen(Color.FromArgb(200, 255, 255, 255)))
                        {
                            graphics.DrawEllipse(pen, 8, 8, 8, 8);
                        }
                    }
                    else
                    {
                        using (var brush = new SolidBrush(colour))
                        {
                            graphics.FillEllipse(brush, 2, 2, 12, 12);
                        }
                        using (var pen = new Pen(Color.FromArgb(120, 15, 23, 42)))
                        {
                            graphics.DrawEllipse(pen, 2, 2, 12, 12);
                        }
                    }
                }

                IntPtr handle = bitmap.GetHicon();
                try
                {
                    // Cloned so the returned Icon does not depend on the handle staying alive.
                    using (Icon temporary = Icon.FromHandle(handle))
                    {
                        return (Icon)temporary.Clone();
                    }
                }
                finally
                {
                    DestroyIcon(handle);
                }
            }
        }

        [System.Runtime.InteropServices.DllImport("user32.dll", SetLastError = true)]
        private static extern bool DestroyIcon(IntPtr handle);

        public void Dispose()
        {
            if (_disposed) return;
            _disposed = true;
            _refresh.Stop();
            _refresh.Dispose();
            _icon.Visible = false;
            _icon.Dispose();
            _menu.Dispose();
        }
    }
}
