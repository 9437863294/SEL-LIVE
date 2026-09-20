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

        public bool SameApplicationAs(ForegroundSnapshot other)
        {
            if (other == null) return false;
            return string.Equals(ProcessName, other.ProcessName, StringComparison.OrdinalIgnoreCase);
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
        /// The longest a single span may run before it is cut. See remark 3 above.
        /// </summary>
        public static readonly TimeSpan MaxSpanDuration = TimeSpan.FromMinutes(10);

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
        public ForegroundSnapshot Current { get { return _current; } }

        /// <summary>The state the machine is in, as the heartbeat reports it.</summary>
        public string CurrentEventType { get { return _currentEventType; } }

        /// <summary>Spans finished since the last <see cref="DrainCompleted"/>.</summary>
        public int PendingCount { get { return _completed.Count; } }

        /// <summary>Begin tracking. Called once, when a session opens.</summary>
        public void Start(DateTime nowUtc, ForegroundSnapshot initial)
        {
            _started = true;
            _spanStartedUtc = nowUtc;
            _lastTickUtc = nowUtc;
            _idleSecondsInSpan = 0;
            _current = initial;
            _currentEventType = ActivityEventTypes.AppActive;
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
            if (!_started) { Start(nowUtc, snapshot); return; }

            // While locked, whatever Windows reports as foreground is behind the lock screen and
            // is not being used. The change is remembered but does not end the locked span.
            if (_currentEventType == ActivityEventTypes.Lock || _currentEventType == ActivityEventTypes.Sleep)
            {
                _current = snapshot;
                return;
            }

            if (snapshot != null && snapshot.SameApplicationAs(_current))
            {
                // Same application, different window: keep the span, refresh the title so the
                // most recent one is what gets recorded if titles are enabled at all.
                _current.WindowTitle = snapshot.WindowTitle;
                return;
            }

            CloseSpan(nowUtc, ActivityEventTypes.AppActive);
            _current = snapshot;
            _currentEventType = ActivityEventTypes.AppActive;
            _spanStartedUtc = nowUtc;
            _idleSecondsInSpan = 0;
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

            if (nowUtc - _spanStartedUtc >= MaxSpanDuration)
            {
                string continuing = _currentEventType;
                CloseSpan(nowUtc, continuing);
                _spanStartedUtc = nowUtc;
                _idleSecondsInSpan = 0;
                _currentEventType = continuing;
            }
        }

        /// <summary>The workstation was locked, or the screensaver became secure.</summary>
        public void OnLocked(DateTime nowUtc)
        {
            if (!_started || _currentEventType == ActivityEventTypes.Lock) return;
            CloseSpan(nowUtc, _currentEventType);
            _currentEventType = ActivityEventTypes.Lock;
            _spanStartedUtc = nowUtc;
            _idleSecondsInSpan = 0;
        }

        /// <summary>The workstation was unlocked.</summary>
        public void OnUnlocked(DateTime nowUtc)
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
            if (!_started) return;
            CloseSpan(nowUtc, _currentEventType);
            _currentEventType = ActivityEventTypes.Sleep;
            _spanStartedUtc = nowUtc;
            _idleSecondsInSpan = 0;
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
            if (!_started) return;
            CloseSpan(nowUtc, _currentEventType);
            _started = false;
            _current = null;
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
            var drained = new List<ActivitySpan>(_completed);
            _completed.Clear();
            return drained;
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
                // Always attached; the server drops it unless the effective policy allows it.
                // Deciding here would mean the agent had to be trusted to honour the policy,
                // and §12's guarantee is stronger when it does not have to be.
                span.WindowTitle = _current.WindowTitle;
            }

            _completed.Add(span);
        }
    }
}
