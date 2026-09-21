using System;
using System.Collections.Generic;
using System.Windows;
using System.Windows.Media;
using Forms = System.Windows.Forms;

namespace Sel.Agent
{
    /// <summary>
    /// A blank panel covering every monitor except the one showing the gate.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The gate was a maximised window, and a maximised window covers one monitor. On the
    /// two-screen desks that most office PCs now have, that left the second screen showing the
    /// desktop with every icon on it live — so "you must sign in to use this PC" meant "you
    /// must sign in to use the left half of this PC".
    /// </para>
    /// <para>
    /// The alternative was to stretch the gate itself across the whole virtual screen, which
    /// puts the sign-in form in the gap between two monitors. Covering the others with plain
    /// panels keeps the form where somebody is looking.
    /// </para>
    /// <para>
    /// Deliberately inert: no content, no buttons, no keyboard handling. Clicking one does
    /// nothing, and because the gate re-asserts focus whenever it loses it, a click here bounces
    /// straight back to the sign-in form.
    /// </para>
    /// </remarks>
    internal static class ScreenCover
    {
        /// <summary>
        /// Cover every screen except the one containing <paramref name="except"/>.
        /// </summary>
        /// <remarks>
        /// Returns what it created so the caller can close them again. A single-monitor PC gets
        /// an empty list and no windows at all.
        /// </remarks>
        internal static List<Window> CoverOtherScreens(Window except, Action<string> log)
        {
            var covers = new List<Window>();

            try
            {
                Forms.Screen primary = ScreenFor(except);

                foreach (Forms.Screen screen in Forms.Screen.AllScreens)
                {
                    if (primary != null && screen.DeviceName == primary.DeviceName) continue;

                    // Bounds, not WorkingArea: the working area stops at the taskbar, and a
                    // panel that leaves the taskbar showing defeats the point.
                    Forms.Screen captured = screen;
                    var cover = new Window
                    {
                        WindowStyle = WindowStyle.None,
                        ResizeMode = ResizeMode.NoResize,
                        ShowInTaskbar = false,
                        Topmost = true,
                        Background = new SolidColorBrush(Color.FromRgb(0x02, 0x06, 0x17)),
                        WindowStartupLocation = WindowStartupLocation.Manual,
                        Left = captured.Bounds.Left,
                        Top = captured.Bounds.Top,
                        Width = captured.Bounds.Width,
                        Height = captured.Bounds.Height,
                        Title = "SEL LIVE",
                    };

                    cover.Show();
                    covers.Add(cover);
                }

                if (covers.Count > 0) log("Covered " + covers.Count + " further screen(s) behind the gate.");
            }
            catch (Exception error)
            {
                // A second screen left uncovered is worse than the gate not appearing at all,
                // but only slightly — and refusing to sign anybody in would be worse than both.
                log("Could not cover the other screens: " + error.Message);
            }

            return covers;
        }

        /// <summary>Which physical screen a window is on, by its top-left corner.</summary>
        private static Forms.Screen ScreenFor(Window window)
        {
            try
            {
                var helper = new System.Windows.Interop.WindowInteropHelper(window);
                if (helper.Handle != IntPtr.Zero) return Forms.Screen.FromHandle(helper.Handle);
            }
            catch (Exception)
            {
                // Not shown yet, or no handle. Fall through to the primary.
            }
            return Forms.Screen.PrimaryScreen;
        }

        internal static void Remove(List<Window> covers)
        {
            if (covers == null) return;
            foreach (Window cover in covers)
            {
                try { cover.Close(); } catch (Exception) { /* already closing */ }
            }
            covers.Clear();
        }
    }
}
