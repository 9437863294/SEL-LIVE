using System;
using Microsoft.Web.WebView2.Core;
using Sel.Agent.Core;

namespace Sel.Agent
{
    /// <summary>
    /// Decides whether the ERP opens in a window inside the agent or in the user's own browser.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The same shape as <see cref="CompositeNotificationPresenter"/>, and for the same reason:
    /// the capability is never absent, only delivered differently. A caller asks for a path and
    /// gets it opened; it does not ask which browser exists.
    /// </para>
    ///
    /// <para><b>Why WebView2 is probed rather than inferred from the Windows version.</b></para>
    /// <para>
    /// WebView2 is not part of Windows. It is the Edge WebView2 Runtime, an installable component
    /// that happens to be present on most Windows 11 machines and many Windows 10 ones, and
    /// absent on a freshly imaged SOE. Microsoft also ended WebView2 support for Windows 7 and
    /// 8.1 in 2023, so a version check alone would be wrong in both directions — claiming it on
    /// a Windows 10 box that lacks the runtime, and denying it on the odd Windows 8.1 machine
    /// that still has a working one.
    /// </para>
    /// <para>
    /// <c>GetAvailableBrowserVersionString</c> answers the actual question and throws when the
    /// runtime is missing, which is the whole check.
    /// </para>
    ///
    /// <para><b>One window, reused.</b></para>
    /// <para>
    /// Opening a task and then an approval should move one window, not stack two. The window is
    /// kept and re-navigated; closing it forgets it, so the next request builds a fresh one
    /// rather than resurrecting a disposed WebView.
    /// </para>
    /// </remarks>
    public sealed class ErpBrowser : IDisposable
    {
        private readonly AgentHost _host;
        private readonly Action<string> _log;
        private ErpWindow _window;
        private bool? _embeddedAvailable;
        private bool _disposed;

        public ErpBrowser(AgentHost host, Action<string> log)
        {
            _host = host ?? throw new ArgumentNullException("host");
            _log = log ?? (message => { });
        }

        /// <summary>Whether an embedded window can be used on this machine. Probed once.</summary>
        public bool EmbeddedAvailable
        {
            get
            {
                if (_embeddedAvailable.HasValue) return _embeddedAvailable.Value;

                if (!OsCompatibility.Current.IsModernWindows)
                {
                    // Not a hard block — the probe below would answer anyway — but it avoids
                    // loading WebView2's native loader on a release Microsoft no longer supports
                    // it for, where the failure mode is less predictable than an exception.
                    _log("Embedded ERP window not used on " + OsCompatibility.Current.FriendlyName
                        + "; SEL LIVE opens in the default browser.");
                    _embeddedAvailable = false;
                    return false;
                }

                try
                {
                    string version = CoreWebView2Environment.GetAvailableBrowserVersionString();
                    _embeddedAvailable = !string.IsNullOrEmpty(version);
                    _log(_embeddedAvailable.Value
                        ? "Embedded ERP window available (WebView2 " + version + ")."
                        : "WebView2 reported no version; using the default browser.");
                }
                catch (Exception error)
                {
                    _log("WebView2 runtime is not installed (" + error.Message
                        + "); SEL LIVE opens in the default browser.");
                    _embeddedAvailable = false;
                }

                return _embeddedAvailable.Value;
            }
        }

        /// <summary>A sentence for the agent status panel.</summary>
        public string Describe()
        {
            return EmbeddedAvailable
                ? "Opens in a SEL LIVE window"
                : "Opens in your default browser";
        }

        /// <summary>Open an ERP path, wherever this machine can.</summary>
        public void Open(string path)
        {
            if (!EmbeddedAvailable)
            {
                _host.OpenErpExternally(path);
                return;
            }

            try
            {
                if (_window == null)
                {
                    _window = new ErpWindow(_host);
                    _window.Closed += (s, e) => _window = null;
                }
                _window.ShowPath(path);
            }
            catch (Exception error)
            {
                // A window that will not construct must not swallow the click. Fall back for
                // this call and for every later one, rather than failing the same way each time.
                _log("Embedded ERP window failed (" + error.Message + "); using the default browser.");
                _embeddedAvailable = false;
                _window = null;
                _host.OpenErpExternally(path);
            }
        }

        /// <summary>Close the embedded window, for sign-out.</summary>
        public void Close()
        {
            if (_window == null) return;
            try
            {
                _window.Close();
            }
            catch (Exception)
            {
                // Already closing.
            }
            _window = null;
        }

        public void Dispose()
        {
            if (_disposed) return;
            _disposed = true;
            Close();
        }
    }
}
