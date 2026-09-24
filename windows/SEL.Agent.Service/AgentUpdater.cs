using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Threading;
using Sel.Agent.Core;
using Sel.Agent.Core.Contracts;
using Sel.Agent.Core.Security;
using Sel.Agent.Core.Update;

namespace Sel.Agent.Service
{
    /// <summary>
    /// Brings a PC up to the build that has been published, without anybody visiting it.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>The service does this, not the desktop agent</b>, for three reasons that all point the
    /// same way. It runs as SYSTEM, so it can install without a UAC prompt. It runs whether or
    /// not anybody is signed in, which is when you actually want to update a machine. And it is
    /// the one component that survives the agent being replaced underneath it.
    /// </para>
    /// <para>
    /// <b>It asks the server itself.</b> The heartbeat already tells the desktop agent when a
    /// version is available, and it would have been less code to pass that along — but then the
    /// service would be taking a URL to execute from a process running as the signed-in user.
    /// Instead it calls <c>/api/windows-agent/version</c> with the device credential it reads
    /// itself, and the answer comes from SEL LIVE.
    /// </para>
    ///
    /// <para><b>Why the installer is run by the Task Scheduler and not by this process.</b></para>
    /// <para>
    /// The installer stops this service — that is what <c>ServiceControl Stop="both"</c> does on
    /// an upgrade. A child process started from here belongs to the service's job object, so
    /// stopping the service would kill the installer halfway through replacing its own files.
    /// Registering a one-shot task hands the work to the task engine, which is not going
    /// anywhere, and this service is then free to be stopped as part of the upgrade it asked
    /// for.
    /// </para>
    /// <para>
    /// The same lesson as <c>CREATE_BREAKAWAY_FROM_JOB</c> in SessionLauncher, learned once and
    /// applied before it could cost a second morning.
    /// </para>
    /// </remarks>
    internal sealed class AgentUpdater : IDisposable
    {
        /// <summary>
        /// A quarter of an hour after start, then every six hours.
        /// </summary>
        /// <remarks>
        /// The delay matters more than the interval. Four hundred machines that are switched on
        /// within ten minutes of each other would otherwise all ask at once and then all pull a
        /// 120 MB installer at once, which is a self-inflicted outage of the office link. The
        /// jitter below spreads them across an hour.
        /// </remarks>
        private static readonly TimeSpan FirstCheck = TimeSpan.FromMinutes(15);
        private static readonly TimeSpan Interval = TimeSpan.FromHours(6);
        private static readonly TimeSpan MaxJitter = TimeSpan.FromMinutes(60);

        /// <summary>A package larger than this is not one of ours.</summary>
        private const long MaxPackageBytes = 400L * 1024 * 1024;

        private readonly Action<string, EventLogEntryType> _log;
        private readonly Func<bool> _autoUpdateEnabled;
        private Timer _timer;
        private int _running;

        /// <param name="autoUpdateEnabled">
        /// Read at the moment of the check rather than captured, so switching the policy off in
        /// SEL LIVE takes effect on the next check instead of the next reboot.
        /// </param>
        internal AgentUpdater(Func<bool> autoUpdateEnabled, Action<string, EventLogEntryType> log)
        {
            _autoUpdateEnabled = autoUpdateEnabled ?? (() => true);
            _log = log ?? ((message, level) => { });
        }

        internal void Start()
        {
            if (_timer != null) return;

            var jitter = TimeSpan.FromMilliseconds(new Random().Next((int)MaxJitter.TotalMilliseconds));
            _timer = new Timer(OnTick, null, FirstCheck + jitter, Interval);
        }

        public void Dispose()
        {
            if (_timer != null) { _timer.Dispose(); _timer = null; }
        }

        private void OnTick(object state)
        {
            // A six-hour timer cannot overlap itself in practice; the guard is for the case where
            // a download takes longer than the interval on a genuinely terrible link.
            if (Interlocked.CompareExchange(ref _running, 1, 0) != 0) return;
            try
            {
                CheckOnce();
            }
            catch (Exception error)
            {
                _log("Update check failed: " + error.Message, EventLogEntryType.Warning);
            }
            finally
            {
                Interlocked.Exchange(ref _running, 0);
            }
        }

        internal void CheckOnce()
        {
            AgentConfigurationProbe config = AgentConfigurationProbe.Load();
            if (!config.Found || string.IsNullOrEmpty(config.ApiBaseUrl)) return;

            var store = new DeviceIdentityStore();
            DeviceIdentity device = store.Read();
            string secret = store.ReadSecret();
            if (device == null || string.IsNullOrEmpty(secret)) return;

            VersionCheckResponse answer;
            using (var client = new Core.Api.SelLiveApiClient(config.ApiBaseUrl, AgentVersion.Current))
            {
                client.DeviceId = device.DeviceId;
                client.DeviceSecret = secret;

                using (var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(60)))
                {
                    answer = client.CheckVersionAsync(timeout.Token).GetAwaiter().GetResult();
                }
            }

            if (answer == null) return;

            UpdateDecision decision = UpdateRules.Evaluate(
                AgentVersion.Current, answer.Update, answer.Mandatory, _autoUpdateEnabled());

            if (!decision.Install)
            {
                // Not logged at all when there is simply nothing new: an event every six hours
                // on every PC saying "no update" is how an event log becomes unreadable.
                if (answer.Update != null) _log("Not updating: " + decision.Reason, EventLogEntryType.Information);
                return;
            }

            _log("Installing " + answer.Update.Version + " — " + decision.Reason, EventLogEntryType.Information);
            Install(answer.Update);
        }

        private void Install(AvailableVersion offered)
        {
            string directory = Path.Combine(DeviceIdentityStore.DefaultDirectory, "updates");
            string path = Path.Combine(directory, "SEL.Agent-Setup-" + Safe(offered.Version) + ".exe");

            try
            {
                Directory.CreateDirectory(directory);
                DeviceIdentityStore.TryHardenAcl(directory);

                if (!Download(offered, path)) return;

                string actual = PackageVerifier.Sha256Of(path);
                if (!UpdateRules.HashMatches(offered.PackageSha256, actual))
                {
                    _log("Refusing " + offered.Version + ": the downloaded package hashes to " + actual
                        + " but SEL LIVE published " + offered.PackageSha256
                        + ". The file was altered in transit or the wrong file is hosted.",
                        EventLogEntryType.Error);
                    TryDelete(path);
                    return;
                }

                PackageVerifier.Result signature = PackageVerifier.VerifySignature(path, offered.SignatureSubject);
                if (!signature.Ok)
                {
                    _log("Refusing " + offered.Version + ": " + signature.Reason, EventLogEntryType.Error);
                    TryDelete(path);
                    return;
                }

                _log("Package " + offered.Version + " verified (" + signature.Reason + "). Scheduling the install.",
                    EventLogEntryType.Information);

                if (!UpdateInstallTask.ScheduleIn(path, TimeSpan.FromMinutes(2), message => _log(message, EventLogEntryType.Information)))
                {
                    _log("The install could not be scheduled; the verified package is kept at " + path
                        + " and can be run by hand.", EventLogEntryType.Warning);
                }
            }
            catch (Exception error)
            {
                _log("Update to " + offered.Version + " failed: " + error.Message, EventLogEntryType.Warning);
                TryDelete(path);
            }
        }

        private bool Download(AvailableVersion offered, string path)
        {
            // A part file, renamed only once the download completed, so an interrupted transfer
            // can never be mistaken for a package — the hash would catch it, but a half file
            // sitting where a verified one belongs is an accident waiting for a future edit.
            string part = path + ".part";
            TryDelete(part);

            TlsBootstrap.Configure();
            var request = (HttpWebRequest)WebRequest.Create(offered.PackageUrl);
            request.Method = "GET";
            request.UserAgent = "SEL-LIVE-Agent-Updater/" + AgentVersion.Current;
            request.Timeout = 60_000;
            request.ReadWriteTimeout = 300_000;
            // The same system proxy the rest of the agent uses; a head office behind one would
            // otherwise time out here and nowhere else.
            request.Proxy = WebRequest.GetSystemWebProxy();

            using (var response = (HttpWebResponse)request.GetResponse())
            {
                if (response.StatusCode != HttpStatusCode.OK)
                {
                    _log("The package host answered " + (int)response.StatusCode + " for " + offered.PackageUrl,
                        EventLogEntryType.Warning);
                    return false;
                }

                if (response.ContentLength > MaxPackageBytes)
                {
                    _log("Refusing a " + (response.ContentLength / (1024 * 1024)) + " MB package; the ceiling is "
                        + (MaxPackageBytes / (1024 * 1024)) + " MB.", EventLogEntryType.Error);
                    return false;
                }

                using (Stream source = response.GetResponseStream())
                using (var target = new FileStream(part, FileMode.Create, FileAccess.Write, FileShare.None, 1 << 16))
                {
                    var buffer = new byte[1 << 16];
                    long written = 0;
                    int read;
                    while (source != null && (read = source.Read(buffer, 0, buffer.Length)) > 0)
                    {
                        written += read;
                        if (written > MaxPackageBytes)
                        {
                            _log("The package exceeded the size ceiling while downloading; abandoning it.",
                                EventLogEntryType.Error);
                            return false;
                        }
                        target.Write(buffer, 0, read);
                    }
                }
            }

            TryDelete(path);
            File.Move(part, path);
            return true;
        }

        private static string Safe(string version)
        {
            if (string.IsNullOrEmpty(version)) return "unknown";
            var text = new System.Text.StringBuilder(version.Length);
            foreach (char character in version)
            {
                text.Append(char.IsLetterOrDigit(character) || character == '.' || character == '-' ? character : '_');
            }
            return text.ToString();
        }

        private static void TryDelete(string path)
        {
            try { if (File.Exists(path)) File.Delete(path); }
            catch (Exception) { /* A leftover file is not worth failing an update over. */ }
        }
    }
}
