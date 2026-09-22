using System;
using System.Threading;
using System.Windows.Automation;
using Sel.Agent.Core.Tracking;

namespace Sel.Agent.Core.Platform.Win32
{
    /// <summary>
    /// Reads the host of the page a browser is showing, through UI Automation.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Why the address bar and not the browser.</b> Time per website needs to know which site
    /// is in front, and a desktop agent has three ways to find out. The browser's history
    /// database is out — §1 promises the agent does not collect browsing history, and the file is
    /// locked while the browser runs. An extension is the accurate answer and is a separate
    /// deployment with a separate approval per browser. That leaves the accessibility tree, which
    /// is how a screen reader learns the same thing, needs nothing installed, and works on Chrome,
    /// Edge, Firefox and the Chromium forks alike.
    /// </para>
    /// <para>
    /// <b>What leaves this class is a host name.</b> The address bar's raw text goes straight into
    /// <see cref="BrowserDomainRules.HostOf"/> and only its result is returned, so a path, a query
    /// or a half-typed search cannot escape even by accident. Nothing keeps the raw value.
    /// </para>
    ///
    /// <para><b>Three defences against the cost of asking.</b></para>
    /// <para>
    /// UI Automation is a cross-process call into an application that may be busy, and Chrome
    /// builds its accessibility tree on demand. None of that is acceptable on a loop that runs
    /// every few seconds on four hundred PCs, so:
    /// </para>
    /// <list type="number">
    /// <item><description>
    /// <b>The window title is the cache key.</b> Chrome's title is the active tab's title, so an
    /// unchanged title means the tab has not changed and the previous host still stands. In
    /// practice the tree is walked once per tab switch rather than once per tick.
    /// </description></item>
    /// <item><description>
    /// <b>One reader at a time, and never a queue.</b> A second caller that finds the lock held
    /// takes the cached value instead of waiting, so neither the tick loop nor the window-event
    /// pump can be blocked by a browser that has stopped responding.
    /// </description></item>
    /// <item><description>
    /// <b>Failure is remembered.</b> Where accessibility is unavailable — disabled by policy, or a
    /// browser that refuses — asking again every tick achieves nothing. After a few consecutive
    /// failures it stops asking for five minutes.
    /// </description></item>
    /// </list>
    /// </remarks>
    internal sealed class BrowserAddressBarReader
    {
        private static readonly TimeSpan FailureBackoff = TimeSpan.FromMinutes(5);
        private const int FailuresBeforeBackoff = 3;

        private readonly object _gate = new object();

        private IntPtr _cachedWindow;
        private string _cachedTitle;
        private string _cachedHost;

        private int _consecutiveFailures;
        private DateTime _quietUntilUtc = DateTime.MinValue;

        /// <summary>
        /// The host of the page in front of <paramref name="hwnd"/>, or null.
        /// </summary>
        /// <param name="title">
        /// The window's title, used only as a cache key — it is never parsed for an address,
        /// because a page title is not a URL and guessing from it produces confident nonsense.
        /// </param>
        internal string HostFor(IntPtr hwnd, string title)
        {
            if (hwnd == IntPtr.Zero) return null;

            // A cached answer for this exact window and title needs no call at all.
            lock (_gate)
            {
                if (hwnd == _cachedWindow && string.Equals(title, _cachedTitle, StringComparison.Ordinal))
                {
                    return _cachedHost;
                }
                if (DateTime.UtcNow < _quietUntilUtc) return null;
            }

            // Held by another caller: take the stale value rather than wait behind a browser that
            // may be mid-print-dialog.
            if (!Monitor.TryEnter(_gate)) return CachedHost();
            try
            {
                string host = ReadHost(hwnd);

                _cachedWindow = hwnd;
                _cachedTitle = title;
                _cachedHost = host;
                return host;
            }
            finally
            {
                Monitor.Exit(_gate);
            }
        }

        private string CachedHost()
        {
            // Deliberately not locked: a torn read here returns either the old host or the new
            // one, and both are truthful answers to "what site is in front".
            return _cachedHost;
        }

        private string ReadHost(IntPtr hwnd)
        {
            try
            {
                AutomationElement window = AutomationElement.FromHandle(hwnd);
                if (window == null) return Failed();

                // The omnibox is an Edit that supports ValuePattern. Asking for both in one
                // condition is what keeps this to a single tree walk: Chrome's tree has thousands
                // of nodes once a page has rendered, and the toolbar is near the top of it.
                var condition = new AndCondition(
                    new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Edit),
                    new PropertyCondition(AutomationElement.IsValuePatternAvailableProperty, true),
                    new PropertyCondition(AutomationElement.IsOffscreenProperty, false));

                AutomationElement addressBar = window.FindFirst(TreeScope.Descendants, condition);
                if (addressBar == null) return Failed();

                object raw = addressBar.GetCurrentPropertyValue(ValuePattern.ValueProperty);
                string text = raw as string;

                _consecutiveFailures = 0;

                // The one place a raw address exists in this process, and it does not outlive
                // this line.
                return BrowserDomainRules.HostOf(text);
            }
            catch (ElementNotAvailableException)
            {
                // The window went away between the handle and the query — a tab closed, or the
                // browser exited. Not a failure worth counting.
                return null;
            }
            catch (Exception)
            {
                // Everything else: accessibility unavailable, a COM timeout, a refused call.
                return Failed();
            }
        }

        private string Failed()
        {
            _consecutiveFailures++;
            if (_consecutiveFailures >= FailuresBeforeBackoff)
            {
                _quietUntilUtc = DateTime.UtcNow.Add(FailureBackoff);
                _consecutiveFailures = 0;
            }
            return null;
        }
    }
}
