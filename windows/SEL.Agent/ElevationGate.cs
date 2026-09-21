using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Security.Principal;
using System.Threading;

namespace Sel.Agent
{
    /// <summary>
    /// Asks Windows for administrator approval before the agent will stop.
    /// </summary>
    /// <remarks>
    /// <para>
    /// §26 says an employee must not be able to stop tracking during a mandatory session. A tray
    /// application cannot enforce that on its own — Task Manager exists — but it can refuse to
    /// make it a single click, and it can make the refusal honest rather than cosmetic: a greyed
    /// out or hidden menu item is a suggestion, whereas a UAC prompt is Windows itself saying no.
    /// </para>
    ///
    /// <para><b>How a non-elevated process asks to be stopped by an elevated one.</b></para>
    /// <para>
    /// A process cannot elevate itself; only a new process can start elevated. So Exit launches a
    /// second copy of the agent with <c>--request-exit</c> and <c>Verb = "runas"</c>. Windows
    /// shows the consent or credential prompt. If it is approved, that second copy does not start
    /// an agent at all: it opens a named event, sets it, and exits within milliseconds. The
    /// running agent is waiting on that event and shuts down cleanly — closing its work session
    /// properly rather than being killed.
    /// </para>
    /// <para>
    /// The event is in the <c>Local\</c> namespace, which is per-session. That is correct here
    /// and not an oversight: UAC elevation keeps the same session, so the elevated helper and the
    /// running agent see the same object — while two users switched on one PC each get their own
    /// agent and their own event, and neither can stop the other's.
    /// </para>
    ///
    /// <para><b>What this does not claim.</b></para>
    /// <para>
    /// Somebody with administrator rights can still end the process from Task Manager, and so can
    /// anybody at all — the elevation gate is on the agent's own Exit command, not on the process.
    /// The Windows service restarts it within a minute either way. This raises the cost of
    /// stopping tracking from one click to a deliberate act; it does not make it impossible, and
    /// the documentation says so.
    /// </para>
    /// </remarks>
    internal static class ElevationGate
    {
        /// <summary>The argument the elevated helper is started with.</summary>
        internal const string RequestExitArgument = "--request-exit";

        /// <summary>
        /// Per-session, so one user's agent cannot be stopped from another's session.
        /// </summary>
        internal const string ExitEventName = "Local\\SEL.LIVE.Agent.ExitRequest";

        /// <summary>Windows' code for "the user clicked No on the UAC prompt".</summary>
        private const int ErrorCancelled = 1223;

        internal static bool IsElevated()
        {
            try
            {
                using (WindowsIdentity identity = WindowsIdentity.GetCurrent())
                {
                    return new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator);
                }
            }
            catch (Exception)
            {
                // Unknown means "assume not", so the prompt is shown rather than skipped.
                return false;
            }
        }

        /// <summary>The outcome of asking for approval to stop the agent.</summary>
        internal enum ExitApproval
        {
            /// <summary>Already running elevated; stop directly.</summary>
            AlreadyElevated,

            /// <summary>An administrator approved. The helper will signal the running agent.</summary>
            Approved,

            /// <summary>The prompt was dismissed, or non-admin credentials were given.</summary>
            Declined,

            /// <summary>The prompt could not be shown at all.</summary>
            Failed,
        }

        /// <summary>
        /// Ask Windows for approval, returning what happened.
        /// </summary>
        /// <remarks>
        /// Returns rather than acting: the caller decides whether to stop, and on
        /// <see cref="ExitApproval.Declined"/> it tells the user why nothing happened. A silent
        /// no-op after clicking Exit is the kind of thing that gets reported as the agent being
        /// broken.
        /// </remarks>
        internal static ExitApproval RequestExitApproval(Action<string> log)
        {
            if (IsElevated()) return ExitApproval.AlreadyElevated;

            string executable = Process.GetCurrentProcess().MainModule?.FileName;
            if (string.IsNullOrEmpty(executable)) return ExitApproval.Failed;

            try
            {
                var startInfo = new ProcessStartInfo(executable, RequestExitArgument)
                {
                    UseShellExecute = true,
                    // The whole mechanism. Without UseShellExecute this verb is ignored and the
                    // helper starts unelevated, which would defeat the gate silently.
                    Verb = "runas",
                    WindowStyle = ProcessWindowStyle.Hidden,
                };
                Process.Start(startInfo);
                log("Exit approved by an administrator.");
                return ExitApproval.Approved;
            }
            catch (Win32Exception error) when (error.NativeErrorCode == ErrorCancelled)
            {
                log("Exit was declined at the administrator prompt; the agent keeps running.");
                return ExitApproval.Declined;
            }
            catch (Exception error)
            {
                log("Could not show the administrator prompt: " + error.Message);
                return ExitApproval.Failed;
            }
        }

        /// <summary>
        /// The <c>--request-exit</c> path: signal the running agent and return immediately.
        /// </summary>
        /// <remarks>
        /// Deliberately does nothing else. This process is elevated, and an elevated agent would
        /// be a worse thing to leave running than the one it just stopped — it would track under
        /// administrator rights for no reason.
        /// </remarks>
        internal static void SignalExitAndQuit()
        {
            try
            {
                EventWaitHandle handle;
                if (EventWaitHandle.TryOpenExisting(ExitEventName, out handle))
                {
                    using (handle) handle.Set();
                }
            }
            catch (Exception)
            {
                // Nothing to report to: this process has no UI and is about to end. If the event
                // could not be opened the agent was not running, which is the desired state.
            }
        }

        /// <summary>
        /// Create the event and call <paramref name="onExitRequested"/> when it is set.
        /// </summary>
        /// <remarks>
        /// <c>RegisterWaitForSingleObject</c> rather than a dedicated thread: this waits for
        /// hours at a time and a thread parked on it all day is a megabyte of stack doing
        /// nothing. <c>executeOnlyOnce</c> is true because the agent is shutting down after it.
        /// </remarks>
        internal static IDisposable ListenForExitRequest(Action onExitRequested)
        {
            var handle = new EventWaitHandle(false, EventResetMode.ManualReset, ExitEventName);
            RegisteredWaitHandle registration = ThreadPool.RegisterWaitForSingleObject(
                handle,
                (state, timedOut) => { if (!timedOut) onExitRequested(); },
                null,
                Timeout.Infinite,
                true);

            return new ExitListener(handle, registration);
        }

        private sealed class ExitListener : IDisposable
        {
            private readonly EventWaitHandle _handle;
            private readonly RegisteredWaitHandle _registration;
            private bool _disposed;

            internal ExitListener(EventWaitHandle handle, RegisteredWaitHandle registration)
            {
                _handle = handle;
                _registration = registration;
            }

            public void Dispose()
            {
                if (_disposed) return;
                _disposed = true;
                // Unregister before closing the handle, or the pool can touch a closed object.
                _registration.Unregister(null);
                _handle.Close();
            }
        }
    }
}
