using System;
using System.Collections.Generic;
using Sel.Agent.Core.Contracts;

namespace Sel.Agent.Core.Tracking
{
    /// <summary>What the foreground window currently is.</summary>
    public sealed class ForegroundSnapshot
    {
        public string ProcessName { get; set; }
        public string ApplicationName { get; set; }
        public string ExecutablePath { get; set; }
        public string WindowTitle { get; set; }

        /// <summary>
        /// The host of the page in front, for a browser, under the browser-domain policy.
        /// </summary>
        /// <remarks>
        /// Host only — never a path or a query. <see cref="BrowserDomainRules"/> is the only thing
        /// that produces one and explains why.
        /// </remarks>
        public string BrowserDomain { get; set; }

        /// <summary>
        /// The document open in front, for a document application, under its own policy.
        /// </summary>
        /// <remarks>
        /// A name, never contents. <see cref="DocumentNameRules"/> explains what is stripped.
        /// </remarks>
        public string DocumentName { get; set; }

        public bool SameApplicationAs(ForegroundSnapshot other)
        {
            if (other == null) return false;
            return string.Equals(ProcessName, other.ProcessName, StringComparison.OrdinalIgnoreCase);
        }

        /// <summary>
        /// Whether this is the same *piece of work* as <paramref name="other"/>, not merely the
        /// same application.
        /// </summary>
        /// <remarks>
        /// <para>
        /// This is what decides where one span ends and the next begins, and it is the difference
        /// between "Chrome, four hours" and "seltech.store 40m, drive.google.com 25m,
        /// youtube.com 15m". Switching tab or opening another workbook does not change the
        /// foreground window, so without this the whole afternoon would be one span carrying
        /// whichever domain happened to be sampled last.
        /// </para>
        /// <para>
        /// A null domain or document does not split a span. Otherwise every glance at a browser
        /// internal page, and every moment while a workbook is still opening, would end the span
        /// and start another — thousands of two-second rows that say nothing.
        /// </para>
        /// </remarks>
        public bool SameActivityAs(ForegroundSnapshot other)
        {
            if (!SameApplicationAs(other)) return false;

            if (!string.IsNullOrEmpty(BrowserDomain) && !string.IsNullOrEmpty(other.BrowserDomain)
                && !string.Equals(BrowserDomain, other.BrowserDomain, StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }

            if (!string.IsNullOrEmpty(DocumentName) && !string.IsNullOrEmpty(other.DocumentName)
                && !string.Equals(DocumentName, other.DocumentName, StringComparison.Ordinal))
            {
                return false;
            }

            return true;
        }
    }

    /// <summary>
    /// Turns a stream of Windows events into the spans the server stores.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Deliberately pure: no P/Invoke, no timers, no I/O, and the clock is a parameter. The Win32
    /// adapters in <c>Platform.Win32</c> push events at it and it hands back finished spans, which
    /// is what makes the whole of the agent's measurement logic testable on a build server with no
    /// desktop session — and what makes a disagreement about somebody's hours resolvable by
    /// reading a test rather than by arguing about what Windows does.
    /// </para>
    ///
    /// <para><b>Three decisions worth knowing.</b></para>
    ///
    /// <para>
    /// <b>1. Idle is accumulated per tick, not derived at the end.</b> Each tick asks how long the
    /// user has been idle and credits <c>min(tickInterval, idleSeconds)</c> to the open span. The
    /// obvious alternative — record when idleness started and subtract at the end — gets the
    /// common case wrong: input arriving between two ticks resets Windows' idle counter, so a
    /// span containing four separate two-minute pauses would look continuously active. Taking the
    /// minimum each tick is what makes those four pauses add up to eight minutes.
    /// </para>
    ///
    /// <para>
    /// <b>2. A span is force-closed after ten minutes.</b> Somebody who spends a morning in Excel
    /// would otherwise produce one three-hour span that the agent cannot upload until it ends —
    /// so a crash at 11:55 would lose the entire morning, and the live board would have nothing to
    /// show. Ten-minute segments bound the loss, keep the batch cadence honest, and stay far below
    /// the server's twelve-hour rejection threshold. Consecutive segments in the same application
    /// are merged back together by the timeline, so nothing is fragmented for the reader.
    /// </para>
    ///
    /// <para>
    /// <b>3. Locking closes the span and opens a <c>LOCK</c> one.</b> Not "pause and resume":
    /// while the screen is locked the application still technically holds focus, and an agent that
    /// merely stopped counting would have to decide later what those minutes were. Recording them
    /// explicitly as locked time means the day's buckets always sum to the session, and a lunch
    /// break is visible as a lunch break rather than as a hole.
    /// </para>
    /// </remarks>
    public sealed class ActivitySpanBuilder
    {
        /// <summary>
        /// The longest a span may run when no policy has said otherwise. See remark 2 above.
        /// </summary>
        public static readonly TimeSpan DefaultMaxSpanDuration = TimeSpan.FromMinutes(10);

        /// <summary>
        /// How long one span may run before it is closed and a new one opened.
        /// </summary>
        /// <remarks>
        /// Settable, because this is the granularity of the record rather than an implementation
        /// detail: it decides whether two hours in one application is twelve rows or one, and
        /// therefore both how readable the timeline is and how many documents a fleet writes.
        /// The policy resolver supplies it; the default applies until the first policy arrives.
        /// Clamped by the server to 1–60 minutes.
        /// </remarks>
        public TimeSpan MaxSpanDuration
        {
            get { lock (_gate) return _maxSpanDuration; }
            set
            {
                lock (_gate)
                {
                    // A zero or negative maximum would close a span on every tick and fill the
                    // queue with two-second records; a policy that malformed should be ignored
                    // rather than obeyed.
                    _maxSpanDuration = value > TimeSpan.Zero ? value : DefaultMaxSpanDuration;
                }
            }
        }

        /// <summary>
        /// Spans shorter than this are dropped rather than recorded.
        /// </summary>
        /// <remarks>
        /// Alt-tabbing through six windows to reach the seventh produces six spans of a few
        /// hundred milliseconds each. They are not usage, they would dominate the focus counts,
        /// and the server rejects them anyway — so they are discarded at source rather than
        /// queued, uploaded and refused.
        /// </remarks>
        public static readonly TimeSpan MinSpanDuration = TimeSpan.FromSeconds(2);

        private readonly List<ActivitySpan> _completed = new List<ActivitySpan>();
        private readonly Func<string> _idFactory;

        private ForegroundSnapshot _current;
        private string _currentEventType = ActivityEventTypes.AppActive;
        private DateTime _spanStartedUtc;
        private DateTime _lastTickUtc;
        private double _idleSecondsInSpan;
        private bool _started;
        private TimeSpan _maxSpanDuration = DefaultMaxSpanDuration;

        /// <summary>
        /// Serialises every public member.
        /// </summary>
        /// <remarks>
        /// Callers arrive on three different threads: the heartbeat timer, the session-state
        /// monitor, and the foreground watcher's pump thread. Before this, two of them could
        /// close a span at once and produce overlapping records, or tear the completed list
        /// mid-drain. Held only across field arithmetic and list operations — nothing in this
        /// class calls out, so it cannot deadlock against the coordinator's own gate.
        /// </remarks>
        private readonly object _gate = new object();

        public ActivitySpanBuilder()
            : this(null)
        {
        }

        /// <param name="idFactory">
        /// Supplies span ids. Injected so tests can make them deterministic; in production it is
        /// <c>Guid.NewGuid</c>, and the id must be stable once assigned because the server uses it
        /// as the document key and therefore as the duplicate-suppression key.
        /// </param>
        public ActivitySpanBuilder(Func<string> idFactory)
        {
            _idFactory = idFactory ?? (() => Guid.NewGuid().ToString("N"));
        }

        /// <summary>True when the agent believes it cannot currently reach the server.</summary>
        public bool Offline { get; set; }

        /// <summary>The application currently being counted, for the heartbeat and the tray.</summary>
        public ForegroundSnapshot Current { get { lock (_gate) return _current; } }

        /// <summary>The state the machine is in, as the heartbeat reports it.</summary>
        public string CurrentEventType { get { lock (_gate) return _currentEventType; } }

        /// <summary>Spans finished since the last <see cref="DrainCompleted"/>.</summary>
        public int PendingCount { get { lock (_gate) return _completed.Count; } }

        /// <summary>Begin tracking. Called once, when a session opens.</summary>
        public void Start(DateTime nowUtc, ForegroundSnapshot initial)
        {
            lock (_gate)
            {
                _started = true;
                _spanStartedUtc = nowUtc;
                _lastTickUtc = nowUtc;
                _idleSecondsInSpan = 0;
                _current = initial;
                _currentEventType = ActivityEventTypes.AppActive;
            }
        }

        /// <summary>
        /// The foreground window changed.
        /// </summary>
        /// <remarks>
        /// A change to the same application is ignored — switching between two Excel workbooks is
        /// two windows and one application, and treating it as a span boundary would triple the
        /// focus count for anybody working across several files.
        /// </remarks>
        public void OnForegroundChanged(DateTime nowUtc, ForegroundSnapshot snapshot)
        {
            lock (_gate)
            {
                if (!_started) { Start(nowUtc, snapshot); return; }

                // While locked, whatever Windows reports as foreground is behind the lock screen and
                // is not being used. The change is remembered but does not end the locked span.
                if (_currentEventType == ActivityEventTypes.Lock || _currentEventType == ActivityEventTypes.Sleep)
                {
                    _current = snapshot;
                    return;
                }

                if (snapshot != null && snapshot.SameActivityAs(_current))
                {
                    // Same application and same piece of work: keep the span, and refresh the
                    // detail so the most recent is what gets recorded. Filling in a domain or a
                    // document that was not known when the span opened matters — a browser that
                    // had not finished loading, or a workbook still opening, would otherwise have
                    // its whole span attributed to nothing.
                    _current.WindowTitle = snapshot.WindowTitle;
                    if (!string.IsNullOrEmpty(snapshot.BrowserDomain)) _current.BrowserDomain = snapshot.BrowserDomain;
                    if (!string.IsNullOrEmpty(snapshot.DocumentName)) _current.DocumentName = snapshot.DocumentName;
                    return;
                }

                CloseSpan(nowUtc, ActivityEventTypes.AppActive);
                _current = snapshot;
                _currentEventType = ActivityEventTypes.AppActive;
                _spanStartedUtc = nowUtc;
                _idleSecondsInSpan = 0;
            }
        }

        /// <summary>
        /// A periodic sample of how long the user has been away from the keyboard.
        /// </summary>
        /// <param name="idleSeconds">
        /// Seconds since the last input, as <c>GetLastInputInfo</c> reports it — which counts
        /// across the whole session, not since the last tick.
        /// </param>
        public void OnTick(DateTime nowUtc, double idleSeconds)
        {
            lock (_gate)
            {
                if (!_started) return;

                double elapsed = (nowUtc - _lastTickUtc).TotalSeconds;
                _lastTickUtc = nowUtc;
                if (elapsed <= 0) return;

                // Locked time is counted whole by the server from the span's own duration; adding
                // idle on top would be counting the same seconds twice.
                if (_currentEventType != ActivityEventTypes.Lock && _currentEventType != ActivityEventTypes.Sleep)
                {
                    _idleSecondsInSpan += Math.Min(elapsed, Math.Max(0, idleSeconds));
                }

                if (nowUtc - _spanStartedUtc >= _maxSpanDuration)
                {
                    string continuing = _currentEventType;
                    CloseSpan(nowUtc, continuing);
                    _spanStartedUtc = nowUtc;
                    _idleSecondsInSpan = 0;
                    _currentEventType = continuing;
                }
            }
        }

        /// <summary>The workstation was locked, or the screensaver became secure.</summary>
        public void OnLocked(DateTime nowUtc)
        {
            lock (_gate)
            {
                if (!_started || _currentEventType == ActivityEventTypes.Lock) return;
                CloseSpan(nowUtc, _currentEventType);
                _currentEventType = ActivityEventTypes.Lock;
                _spanStartedUtc = nowUtc;
                _idleSecondsInSpan = 0;
            }
        }

        /// <summary>The workstation was unlocked.</summary>
        public void OnUnlocked(DateTime nowUtc)
        {
            lock (_gate)
            {
                if (!_started) return;
                if (_currentEventType == ActivityEventTypes.Lock || _currentEventType == ActivityEventTypes.Sleep)
                {
                    CloseSpan(nowUtc, _currentEventType);
                }
                _currentEventType = ActivityEventTypes.AppActive;
                _spanStartedUtc = nowUtc;
                _idleSecondsInSpan = 0;
                // The clock is reset so the sleep gap is not credited as idle time in the new span.
                _lastTickUtc = nowUtc;
            }
        }

        /// <summary>
        /// The machine suspended.
        /// </summary>
        /// <remarks>
        /// Treated as locked rather than as a gap. A suspended PC is unambiguously not being
        /// worked on, and leaving the time unaccounted would make the session's buckets fail to
        /// add up to its duration — which is the first thing anybody checks when they dispute a
        /// figure.
        /// </remarks>
        public void OnSleep(DateTime nowUtc)
        {
            lock (_gate)
            {
                if (!_started) return;
                CloseSpan(nowUtc, _currentEventType);
                _currentEventType = ActivityEventTypes.Sleep;
                _spanStartedUtc = nowUtc;
                _idleSecondsInSpan = 0;
            }
        }

        /// <summary>
        /// The machine resumed.
        /// </summary>
        /// <remarks>
        /// The sleep span is closed at <paramref name="nowUtc"/>, so the suspended hours are
        /// recorded as locked time. <c>_lastTickUtc</c> is reset for the same reason as in
        /// <see cref="OnUnlocked"/>: without it, the first tick after a weekend would credit the
        /// new span with two days of idleness.
        /// </remarks>
        public void OnResume(DateTime nowUtc)
        {
            lock (_gate)
            {
                if (!_started) return;
                if (_currentEventType == ActivityEventTypes.Sleep)
                {
                    CloseSpan(nowUtc, ActivityEventTypes.Sleep);
                }
                _currentEventType = ActivityEventTypes.AppActive;
                _spanStartedUtc = nowUtc;
                _idleSecondsInSpan = 0;
                _lastTickUtc = nowUtc;
            }
        }

        /// <summary>
        /// Stop tracking and close the open span.
        /// </summary>
        /// <remarks>
        /// Called on sign-out, on service stop, and on the <c>WM_QUERYENDSESSION</c> that precedes
        /// a shutdown. Windows gives very little time at that point, which is why the final spans
        /// travel on the logout request itself rather than waiting for the next batch.
        /// </remarks>
        public void Stop(DateTime nowUtc)
        {
            lock (_gate)
            {
                if (!_started) return;
                CloseSpan(nowUtc, _currentEventType);
                _started = false;
                _current = null;
            }
        }

        /// <summary>
        /// Take the finished spans, leaving the builder empty.
        /// </summary>
        /// <remarks>
        /// Hands ownership to the caller, which immediately persists them to the offline queue.
        /// The builder deliberately keeps no copy: holding one would mean deciding when to forget
        /// it, and the queue is already the thing that answers "what has not been uploaded".
        /// </remarks>
        public List<ActivitySpan> DrainCompleted()
        {
            lock (_gate)
            {
                var drained = new List<ActivitySpan>(_completed);
                _completed.Clear();
                return drained;
            }
        }

        private void CloseSpan(DateTime endedUtc, string eventType)
        {
            TimeSpan duration = endedUtc - _spanStartedUtc;
            if (duration < MinSpanDuration) return;

            // Bounded by the duration: a clock adjustment mid-span could otherwise produce an
            // idle figure larger than the span containing it, which the server would clamp but
            // which is better not to send.
            int idle = (int)Math.Round(Math.Max(0, Math.Min(_idleSecondsInSpan, duration.TotalSeconds)));

            var span = new ActivitySpan
            {
                SpanId = _idFactory(),
                EventType = eventType,
                StartedAt = IsoTime.Format(_spanStartedUtc),
                EndedAt = IsoTime.Format(endedUtc),
                IdleSeconds = idle,
                RecordedOffline = Offline
            };

            if (_current != null)
            {
                span.ProcessName = _current.ProcessName;
                span.ApplicationName = _current.ApplicationName;
                span.ExecutablePath = _current.ExecutablePath;
                // Always attached; the server drops these unless the effective policy allows
                // them. Deciding here would mean the agent had to be trusted to honour the
                // policy, and §12's guarantee is stronger when it does not have to be.
                //
                // The watcher does not collect a domain or a document name at all unless its
                // policy switch is on, so in practice these are null twice over — belt and
                // braces, in the direction where the braces are the server's.
                span.WindowTitle = _current.WindowTitle;
                span.BrowserDomain = _current.BrowserDomain;
                span.DocumentName = _current.DocumentName;
            }

            _completed.Add(span);
        }
    }
}
