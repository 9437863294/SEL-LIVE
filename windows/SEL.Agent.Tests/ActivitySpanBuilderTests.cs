using System;
using System.Collections.Generic;
using System.Linq;
using Sel.Agent.Core.Contracts;
using Sel.Agent.Core.Tracking;
using Xunit;

namespace Sel.Agent.Tests
{
    /// <summary>
    /// The measurement logic, tested without a desktop.
    /// </summary>
    /// <remarks>
    /// These are the numbers somebody's attendance record is built from, so they are worth being
    /// able to check by reading a test rather than by arguing about what Windows does. The
    /// builder takes its clock as a parameter and touches no Win32, which is what makes a
    /// three-hour working day expressible in three lines.
    /// </remarks>
    public class ActivitySpanBuilderTests
    {
        private static readonly DateTime Start = new DateTime(2026, 9, 20, 3, 30, 0, DateTimeKind.Utc);

        private static ForegroundSnapshot App(string process, string name = null)
        {
            return new ForegroundSnapshot
            {
                ProcessName = process,
                ApplicationName = name ?? process,
                ExecutablePath = @"C:\Program Files\" + process,
                WindowTitle = name + " - Document1"
            };
        }

        private static ActivitySpanBuilder NewBuilder()
        {
            int counter = 0;
            return new ActivitySpanBuilder(() => "span-" + (++counter));
        }

        private static int Seconds(ActivitySpan span)
        {
            return (int)(IsoTime.Parse(span.EndedAt) - IsoTime.Parse(span.StartedAt)).TotalSeconds;
        }

        /* ── Basics ──────────────────────────────────────────────────────────────────────── */

        [Fact]
        public void Switching_application_closes_the_previous_span()
        {
            ActivitySpanBuilder builder = NewBuilder();
            builder.Start(Start, App("excel.exe", "Microsoft Excel"));
            builder.OnForegroundChanged(Start.AddMinutes(5), App("chrome.exe", "Google Chrome"));

            List<ActivitySpan> spans = builder.DrainCompleted();
            Assert.Single(spans);
            Assert.Equal("excel.exe", spans[0].ProcessName);
            Assert.Equal(300, Seconds(spans[0]));
            Assert.Equal(ActivityEventTypes.AppActive, spans[0].EventType);
        }

        [Fact]
        public void Switching_between_windows_of_the_same_application_does_not_split_the_span()
        {
            // Two Excel workbooks are two windows and one application. Splitting here would
            // triple the focus count for anybody working across several files.
            ActivitySpanBuilder builder = NewBuilder();
            builder.Start(Start, App("excel.exe", "Microsoft Excel"));
            builder.OnForegroundChanged(Start.AddMinutes(2), App("EXCEL.EXE", "Microsoft Excel"));
            builder.OnForegroundChanged(Start.AddMinutes(4), App("excel.exe", "Microsoft Excel"));
            builder.OnForegroundChanged(Start.AddMinutes(6), App("winword.exe", "Microsoft Word"));

            List<ActivitySpan> spans = builder.DrainCompleted();
            Assert.Single(spans);
            Assert.Equal(360, Seconds(spans[0]));
        }

        [Fact]
        public void Spans_shorter_than_the_minimum_are_dropped()
        {
            // Alt-tabbing through six windows should not produce six records.
            ActivitySpanBuilder builder = NewBuilder();
            builder.Start(Start, App("a.exe"));
            builder.OnForegroundChanged(Start.AddMilliseconds(300), App("b.exe"));
            builder.OnForegroundChanged(Start.AddMilliseconds(600), App("c.exe"));
            builder.OnForegroundChanged(Start.AddMilliseconds(900), App("d.exe"));

            Assert.Empty(builder.DrainCompleted());
        }

        [Fact]
        public void Span_ids_are_assigned_once_and_are_unique()
        {
            // The id is the server's duplicate-suppression key. A regenerated id on retry would
            // double-count the span.
            ActivitySpanBuilder builder = NewBuilder();
            builder.Start(Start, App("excel.exe"));
            builder.OnForegroundChanged(Start.AddMinutes(3), App("chrome.exe"));
            builder.OnForegroundChanged(Start.AddMinutes(6), App("winword.exe"));

            List<ActivitySpan> spans = builder.DrainCompleted();
            Assert.Equal(2, spans.Count);
            Assert.Equal(spans.Count, spans.Select(s => s.SpanId).Distinct().Count());
            Assert.All(spans, s => Assert.False(string.IsNullOrEmpty(s.SpanId)));
        }

        /* ── Idle accounting ─────────────────────────────────────────────────────────────── */

        [Fact]
        public void Idle_is_accumulated_per_tick_so_repeated_pauses_add_up()
        {
            // The reason ticks take the minimum of the interval and the reported idle time:
            // input between ticks resets Windows' counter, and four separate pauses must total
            // four pauses rather than looking like continuous activity.
            ActivitySpanBuilder builder = NewBuilder();
            builder.Start(Start, App("excel.exe"));

            DateTime now = Start;
            for (int minute = 1; minute <= 20; minute++)
            {
                now = Start.AddMinutes(minute);
                // Idle for minutes 6–10 and 16–20; active otherwise.
                bool idle = (minute > 5 && minute <= 10) || minute > 15;
                builder.OnTick(now, idle ? 60 : 0);
            }
            builder.OnForegroundChanged(now, App("chrome.exe"));

            List<ActivitySpan> spans = builder.DrainCompleted();
            // The ten-minute cap splits this into two spans; the idle across both is what matters.
            int totalIdle = spans.Sum(s => s.IdleSeconds);
            Assert.InRange(totalIdle, 540, 660); // ~10 minutes, allowing for the split boundary
        }

        [Fact]
        public void Idle_never_exceeds_the_span_that_contains_it()
        {
            ActivitySpanBuilder builder = NewBuilder();
            builder.Start(Start, App("excel.exe"));
            // A wildly overstated idle reading, as a clock adjustment would produce.
            builder.OnTick(Start.AddMinutes(1), 99999);
            builder.OnForegroundChanged(Start.AddMinutes(2), App("chrome.exe"));

            ActivitySpan span = builder.DrainCompleted().Single();
            Assert.True(span.IdleSeconds <= Seconds(span),
                "Idle " + span.IdleSeconds + "s exceeded the span's " + Seconds(span) + "s.");
        }

        /* ── Lock, sleep and resume ──────────────────────────────────────────────────────── */

        [Fact]
        public void Locking_closes_the_application_span_and_opens_a_locked_one()
        {
            ActivitySpanBuilder builder = NewBuilder();
            builder.Start(Start, App("excel.exe"));
            builder.OnLocked(Start.AddMinutes(5));
            builder.OnUnlocked(Start.AddMinutes(50));

            List<ActivitySpan> spans = builder.DrainCompleted();
            Assert.Equal(2, spans.Count);
            Assert.Equal(ActivityEventTypes.AppActive, spans[0].EventType);
            Assert.Equal(300, Seconds(spans[0]));
            Assert.Equal(ActivityEventTypes.Lock, spans[1].EventType);
            Assert.Equal(2700, Seconds(spans[1]));
        }

        [Fact]
        public void A_foreground_change_behind_the_lock_screen_does_not_end_the_locked_span()
        {
            // Windows still reports a foreground window while locked. Treating that as a switch
            // would carve a lunch break into application usage.
            ActivitySpanBuilder builder = NewBuilder();
            builder.Start(Start, App("excel.exe"));
            builder.OnLocked(Start.AddMinutes(5));
            builder.OnForegroundChanged(Start.AddMinutes(20), App("lockapp.exe"));
            builder.OnUnlocked(Start.AddMinutes(50));

            List<ActivitySpan> spans = builder.DrainCompleted();
            Assert.Equal(2, spans.Count);
            Assert.Equal(ActivityEventTypes.Lock, spans[1].EventType);
            Assert.Equal(2700, Seconds(spans[1]));
        }

        [Fact]
        public void Locked_time_accrues_no_idle_seconds()
        {
            // The server counts a locked span's whole duration as locked. Adding idle on top
            // would count the same seconds twice.
            ActivitySpanBuilder builder = NewBuilder();
            builder.Start(Start, App("excel.exe"));
            builder.OnLocked(Start.AddMinutes(1));
            for (int minute = 2; minute <= 9; minute++) builder.OnTick(Start.AddMinutes(minute), 600);
            builder.OnUnlocked(Start.AddMinutes(9));

            ActivitySpan locked = builder.DrainCompleted().Single(s => s.EventType == ActivityEventTypes.Lock);
            Assert.Equal(0, locked.IdleSeconds);
        }

        [Fact]
        public void A_weekend_asleep_is_recorded_as_locked_and_does_not_poison_the_next_span()
        {
            // The bug this guards: without resetting the tick clock on resume, the first tick
            // after a resume credits the whole sleep as idle time in the new span.
            ActivitySpanBuilder builder = NewBuilder();
            builder.Start(Start, App("excel.exe"));
            builder.OnSleep(Start.AddMinutes(10));

            DateTime monday = Start.AddDays(3);
            builder.OnResume(monday);
            builder.OnTick(monday.AddMinutes(1), 0);
            builder.OnForegroundChanged(monday.AddMinutes(2), App("chrome.exe"));

            List<ActivitySpan> spans = builder.DrainCompleted();
            ActivitySpan sleep = spans.Single(s => s.EventType == ActivityEventTypes.Sleep);
            Assert.True(Seconds(sleep) > 2 * 86400);

            ActivitySpan afterResume = spans.Last();
            Assert.Equal(ActivityEventTypes.AppActive, afterResume.EventType);
            Assert.Equal(0, afterResume.IdleSeconds);
        }

        /* ── The ten-minute cap ──────────────────────────────────────────────────────────── */

        [Fact]
        public void A_long_stretch_in_one_application_is_cut_into_uploadable_segments()
        {
            // A three-hour morning in Excel must not be one span the agent cannot upload until
            // lunchtime — a crash at 11:55 would otherwise lose the morning.
            ActivitySpanBuilder builder = NewBuilder();
            builder.Start(Start, App("excel.exe"));

            for (int minute = 1; minute <= 35; minute++)
            {
                builder.OnTick(Start.AddMinutes(minute), 0);
            }

            List<ActivitySpan> spans = builder.DrainCompleted();
            Assert.True(spans.Count >= 3, "Expected the span to be cut; got " + spans.Count + ".");
            Assert.All(spans, s => Assert.True(
                Seconds(s) <= (int)ActivitySpanBuilder.DefaultMaxSpanDuration.TotalSeconds + 60,
                "A segment ran to " + Seconds(s) + "s."));
            // Every segment is still the same application, so the timeline re-merges them.
            Assert.All(spans, s => Assert.Equal("excel.exe", s.ProcessName));
        }

        [Fact]
        public void Segments_of_a_cut_span_are_contiguous_with_no_lost_time()
        {
            ActivitySpanBuilder builder = NewBuilder();
            builder.Start(Start, App("excel.exe"));
            for (int minute = 1; minute <= 25; minute++) builder.OnTick(Start.AddMinutes(minute), 0);
            builder.Stop(Start.AddMinutes(25));

            List<ActivitySpan> spans = builder.DrainCompleted()
                .OrderBy(s => IsoTime.Parse(s.StartedAt)).ToList();

            for (int index = 1; index < spans.Count; index++)
            {
                Assert.Equal(IsoTime.Parse(spans[index - 1].EndedAt), IsoTime.Parse(spans[index].StartedAt));
            }
            int total = spans.Sum(Seconds);
            Assert.Equal(25 * 60, total);
        }

        /* ── Offline marking and shutdown ────────────────────────────────────────────────── */

        [Fact]
        public void Spans_recorded_offline_are_marked_so_the_report_can_say_so()
        {
            ActivitySpanBuilder builder = NewBuilder();
            builder.Offline = true;
            builder.Start(Start, App("excel.exe"));
            builder.OnForegroundChanged(Start.AddMinutes(5), App("chrome.exe"));

            Assert.True(builder.DrainCompleted().Single().RecordedOffline);
        }

        [Fact]
        public void Stopping_closes_the_open_span()
        {
            ActivitySpanBuilder builder = NewBuilder();
            builder.Start(Start, App("excel.exe"));
            builder.Stop(Start.AddMinutes(7));

            ActivitySpan span = builder.DrainCompleted().Single();
            Assert.Equal(420, Seconds(span));
        }

        [Fact]
        public void Draining_twice_does_not_return_the_same_span_twice()
        {
            // The queue owns the spans once drained; a builder that kept a copy would re-queue
            // them and the server would see duplicates it had to discard.
            ActivitySpanBuilder builder = NewBuilder();
            builder.Start(Start, App("excel.exe"));
            builder.OnForegroundChanged(Start.AddMinutes(5), App("chrome.exe"));

            Assert.Single(builder.DrainCompleted());
            Assert.Empty(builder.DrainCompleted());
        }

        [Fact]
        public void Events_before_Start_do_not_throw()
        {
            // The service can push a lock event at a moment when no session is open.
            ActivitySpanBuilder builder = NewBuilder();
            builder.OnTick(Start, 30);
            builder.OnLocked(Start);
            builder.OnUnlocked(Start);
            builder.OnSleep(Start);
            builder.OnResume(Start);
            builder.Stop(Start);
            Assert.Empty(builder.DrainCompleted());
        }

        [Fact]
        public void A_foreground_change_before_Start_begins_tracking()
        {
            ActivitySpanBuilder builder = NewBuilder();
            builder.OnForegroundChanged(Start, App("excel.exe"));
            builder.OnForegroundChanged(Start.AddMinutes(4), App("chrome.exe"));
            Assert.Single(builder.DrainCompleted());
        }
    }
}
