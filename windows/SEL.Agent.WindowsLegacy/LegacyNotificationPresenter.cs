using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Threading;
using Sel.Agent.Core;
using Sel.Agent.Core.Contracts;
using Sel.Agent.Core.Platform;

namespace Sel.Agent.WindowsLegacy
{
    /// <summary>
    /// Applies <c>WS_EX_NOACTIVATE</c> to a window so it can never take focus.
    /// </summary>
    /// <remarks>
    /// WPF's <c>ShowActivated="False"</c> only governs the <i>first</i> show. A window shown
    /// again, or raised by <c>Topmost</c>, can still activate — and a notification that grabs
    /// focus mid-sentence is the single most irritating thing a desktop agent can do. The
    /// extended style is set on the native handle, where Windows itself enforces it.
    /// </remarks>
    internal static class NoActivateWindow
    {
        private const int GWL_EXSTYLE = -20;
        private const int WS_EX_NOACTIVATE = 0x08000000;
        private const int WS_EX_TOOLWINDOW = 0x00000080;

        [DllImport("user32.dll", EntryPoint = "GetWindowLong", SetLastError = true)]
        private static extern int GetWindowLong32(IntPtr hWnd, int index);

        [DllImport("user32.dll", EntryPoint = "GetWindowLongPtr", SetLastError = true)]
        private static extern IntPtr GetWindowLongPtr64(IntPtr hWnd, int index);

        [DllImport("user32.dll", EntryPoint = "SetWindowLong", SetLastError = true)]
        private static extern int SetWindowLong32(IntPtr hWnd, int index, int newLong);

        [DllImport("user32.dll", EntryPoint = "SetWindowLongPtr", SetLastError = true)]
        private static extern IntPtr SetWindowLongPtr64(IntPtr hWnd, int index, IntPtr newLong);

        public static void Apply(Window window)
        {
            try
            {
                IntPtr handle = new WindowInteropHelper(window).Handle;
                if (handle == IntPtr.Zero) return;

                // The 32/64-bit split is not cosmetic: SetWindowLong truncates a pointer-sized
                // value on x64, and although the agent is built x86 the same code is used by the
                // tests and could be built either way.
                if (IntPtr.Size == 8)
                {
                    long style = GetWindowLongPtr64(handle, GWL_EXSTYLE).ToInt64();
                    SetWindowLongPtr64(handle, GWL_EXSTYLE, new IntPtr(style | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW));
                }
                else
                {
                    int style = GetWindowLong32(handle, GWL_EXSTYLE);
                    SetWindowLong32(handle, GWL_EXSTYLE, style | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW);
                }
            }
            catch (Exception)
            {
                // Cosmetic at worst: the window may steal focus once. Not worth failing a
                // notification over.
            }
        }
    }

    /// <summary>
    /// The Windows 7 / 8 / 8.1 notification presenter (§23, legacy path).
    /// </summary>
    /// <remarks>
    /// <para>
    /// Draws stacked panels above the system tray. It exists because the Action Center toast API
    /// is Windows 10 and later, and the instruction is that a feature must not be dropped on an
    /// older machine — so Windows 7 gets an equivalent surface rather than a degraded one.
    /// </para>
    ///
    /// <para><b>Positioning uses the working area, not the screen.</b></para>
    /// <para>
    /// <c>SystemParameters.WorkArea</c> excludes the taskbar wherever the user has put it, so the
    /// stack sits correctly for a taskbar on the left, top or right — all of which are common on
    /// machines set up by somebody with a preference. Using the full screen bounds would tuck
    /// notifications behind a bottom taskbar on most PCs and off-screen on some.
    /// </para>
    ///
    /// <para><b>Three at a time.</b></para>
    /// <para>
    /// A morning sync can deliver a dozen queued notifications at once. Showing all of them
    /// would cover the desktop; the rest stay in the tray's notification list, which is where
    /// somebody would look for them anyway. Three is what fits comfortably above a taskbar at
    /// 768px, which is still a real screen height on the older hardware this path serves.
    /// </para>
    /// </remarks>
    public sealed class LegacyNotificationPresenter : INotificationPresenter
    {
        private const int MaxVisible = 3;
        private const double StackGap = 4;

        private readonly Dispatcher _dispatcher;
        private readonly List<SelNotificationWindow> _visible = new List<SelNotificationWindow>();
        private readonly object _gate = new object();
        private bool _disposed;

        public LegacyNotificationPresenter(Dispatcher dispatcher)
        {
            _dispatcher = dispatcher ?? throw new ArgumentNullException("dispatcher");
        }

        public string DisplayName
        {
            get { return "SEL LIVE popup (" + OsCompatibility.Current.FriendlyName + ")"; }
        }

        /// <summary>
        /// Always available.
        /// </summary>
        /// <remarks>
        /// Unlike the modern presenter, this has no external dependency to be missing — it draws
        /// its own window with WPF, which is present wherever the agent is. That is the point of
        /// having it: it is the fallback that cannot itself fall back.
        /// </remarks>
        public bool IsAvailable { get { return true; } }

        public event EventHandler<NotificationOutcome> Outcome;

        public bool Show(AgentNotification notification)
        {
            if (notification == null) return false;

            try
            {
                if (_dispatcher.CheckAccess()) ShowCore(notification);
                else _dispatcher.Invoke(new Action(() => ShowCore(notification)));
                return true;
            }
            catch (Exception)
            {
                // Reported as a FAILED receipt by the caller. §39 counts failures, and a
                // notification that silently never appeared is the one most worth knowing about.
                return false;
            }
        }

        private void ShowCore(AgentNotification notification)
        {
            lock (_gate)
            {
                // Oldest first, so the newest alert is the one that survives the cap.
                while (_visible.Count >= MaxVisible)
                {
                    SelNotificationWindow oldest = _visible[0];
                    _visible.RemoveAt(0);
                    try { oldest.Close(); } catch (InvalidOperationException) { }
                }
            }

            var window = new SelNotificationWindow(notification);
            window.Outcome += OnWindowOutcome;
            window.Closed += OnWindowClosed;

            // Shown before positioning so SizeToContent has produced a real height; positioning
            // against a zero-height window puts every panel in the same place.
            window.Show();
            lock (_gate) { _visible.Add(window); }
            Reflow();
        }

        private void OnWindowOutcome(object sender, NotificationOutcome outcome)
        {
            EventHandler<NotificationOutcome> handler = Outcome;
            if (handler != null) handler(this, outcome);
        }

        private void OnWindowClosed(object sender, EventArgs e)
        {
            var window = sender as SelNotificationWindow;
            if (window == null) return;
            window.Outcome -= OnWindowOutcome;
            window.Closed -= OnWindowClosed;
            lock (_gate) { _visible.Remove(window); }
            Reflow();
        }

        /// <summary>Restack the visible panels from the bottom-right corner upwards.</summary>
        private void Reflow()
        {
            if (!_dispatcher.CheckAccess())
            {
                _dispatcher.BeginInvoke(new Action(Reflow));
                return;
            }

            List<SelNotificationWindow> snapshot;
            lock (_gate) { snapshot = new List<SelNotificationWindow>(_visible); }

            Rect area = SystemParameters.WorkArea;
            double bottom = area.Bottom;

            // Newest at the bottom, nearest the tray, which is where the eye goes.
            for (int index = snapshot.Count - 1; index >= 0; index--)
            {
                SelNotificationWindow window = snapshot[index];
                try
                {
                    double height = window.ActualHeight > 0 ? window.ActualHeight : 120;
                    window.Left = area.Right - window.Width;
                    window.Top = bottom - height;
                    bottom -= height + StackGap;
                }
                catch (InvalidOperationException)
                {
                    // Closed underneath us; the Closed handler will drop it from the list.
                }
            }
        }

        public void ClearAll()
        {
            if (!_dispatcher.CheckAccess())
            {
                _dispatcher.Invoke(new Action(ClearAll));
                return;
            }

            List<SelNotificationWindow> snapshot;
            lock (_gate)
            {
                snapshot = new List<SelNotificationWindow>(_visible);
                _visible.Clear();
            }
            foreach (SelNotificationWindow window in snapshot)
            {
                try { window.Close(); } catch (InvalidOperationException) { }
            }
        }

        public void Dispose()
        {
            if (_disposed) return;
            _disposed = true;
            ClearAll();
        }
    }
}
