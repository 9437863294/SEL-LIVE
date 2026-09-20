using System;
using System.Runtime.InteropServices;

namespace Sel.Agent.Core.Platform.Win32
{
    /// <summary>
    /// Idle time from <c>GetLastInputInfo</c>.
    /// </summary>
    /// <remarks>
    /// <para>
    /// §11 asks for Windows' own last-input API, which is the right call: it reports genuine
    /// keyboard and mouse input at the raw-input layer, so it is not fooled by a window
    /// redrawing, a video playing or a build running — and equally, it is not a keylogger. It
    /// knows <i>when</i> input last happened and nothing whatsoever about <i>what</i> was typed.
    /// That property is worth naming explicitly because it is the reason this API satisfies both
    /// §11 and §12 at once.
    /// </para>
    ///
    /// <para><b>The tick-count wraparound, which is real and does bite.</b></para>
    /// <para>
    /// <c>GetLastInputInfo</c> and <c>GetTickCount</c> both return a 32-bit millisecond counter
    /// that wraps to zero after 49.7 days of uptime. Naive subtraction produces a negative
    /// number — or, unsigned, an enormous one — for a window of a few seconds around each wrap.
    /// A PC left on for two months is entirely normal in an office, and the symptom is that
    /// somebody appears to have been idle for 49 days, which the server would clamp and the
    /// report would show as a missing morning.
    /// </para>
    /// <para>
    /// Unsigned arithmetic handles it correctly on its own: <c>(uint)(now - last)</c> wraps the
    /// same way the counters do and yields the right small difference. <c>GetTickCount64</c>
    /// would avoid the question entirely, but <c>LASTINPUTINFO.dwTime</c> is 32-bit regardless,
    /// so the two would have to be reconciled anyway. Staying in 32-bit unsigned space is the
    /// simpler correct answer and works identically from Windows 7 onwards.
    /// </para>
    ///
    /// <para><b>Session 0 returns nothing, deliberately.</b></para>
    /// <para>
    /// A Windows service has no window station, so <c>GetLastInputInfo</c> fails there. It
    /// returns zero — "not idle" — rather than throwing, because the alternative would be for the
    /// service to record everybody as permanently idle. Idle detection therefore belongs to the
    /// desktop agent, and the service never calls this.
    /// </para>
    /// </remarks>
    public sealed class Win32IdleMonitor : IIdleMonitor
    {
        [StructLayout(LayoutKind.Sequential)]
        private struct LastInputInfo
        {
            public uint cbSize;
            public uint dwTime;
        }

        [DllImport("user32.dll")]
        private static extern bool GetLastInputInfo(ref LastInputInfo info);

        [DllImport("kernel32.dll")]
        private static extern uint GetTickCount();

        public double GetIdleSeconds()
        {
            var info = new LastInputInfo();
            info.cbSize = (uint)Marshal.SizeOf(typeof(LastInputInfo));

            if (!GetLastInputInfo(ref info)) return 0;

            // Unsigned subtraction: correct across the 49.7-day wrap. See the remarks.
            uint elapsedMilliseconds = unchecked(GetTickCount() - info.dwTime);

            // A difference beyond a few days is not idleness, it is a counter that has just
            // wrapped in a way this arithmetic did not catch, or a system clock adjustment.
            // Reporting zero is the conservative reading: it credits the time as active rather
            // than deducting hours nobody can evidence.
            if (elapsedMilliseconds > 7u * 24u * 60u * 60u * 1000u) return 0;

            return elapsedMilliseconds / 1000.0;
        }
    }
}
