using System;
using System.Collections.Generic;
using System.Linq;
using Sel.Agent.Core.Contracts;
using Sel.Agent.Core.Tracking;
using Xunit;

namespace Sel.Agent.Tests
{
    /// <summary>
    /// Where one span ends and the next begins once websites and documents are being recorded.
    /// </summary>
    /// <remarks>
    /// <para>
    /// This is the difference between a report that says "Chrome, four hours" and one that says
    /// "seltech.store 40m, drive.google.com 25m". Switching browser tab or opening another
    /// workbook does not change the foreground window — Windows raises no event at all — so the
    /// span has to be ended by the detail changing, and these tests are the proof that it is.
    /// </para>
    /// <para>
    /// The opposite matters just as much: a null domain or document must *not* split a span, or
    /// every moment while a page is loading would produce a two-second row saying nothing.
    /// </para>
    /// </remarks>
    public class ActivityDetailSpanTests
    {
        private static readonly DateTime Start = new DateTime(2026, 9, 22, 4, 0, 0, DateTimeKind.Utc);

        private static ForegroundSnapshot Browser(string domain)
        {
            return new ForegroundSnapshot
            {
                ProcessName = "chrome.exe",
                ApplicationName = "Google Chrome",
                ExecutablePath = @"C:\Program Files\Google\Chrome\Application\chrome.exe",
                WindowTitle = domain + " - Google Chrome",
                BrowserDomain = domain,
            };
        }

        private static ForegroundSnapshot Workbook(string document)
        {
            return new ForegroundSnapshot
            {
                ProcessName = "EXCEL.EXE",
                ApplicationName = "Microsoft Excel",
                ExecutablePath = @"C:\Program Files\Microsoft Office\root\Office16\EXCEL.EXE",
                WindowTitle = document + " - Excel",
                DocumentName = document,
            };
        }

        private static ActivitySpanBuilder NewBuilder()
        {
            int counter = 0;
            return new ActivitySpanBuilder(() => "span-" + (++counter));
        }

        /* ── Websites ───────────────────────────────────────────────────────────────────────── */

        [Fact]
        public void Changing_tab_ends_the_span_and_starts_another()
        {
            ActivitySpanBuilder builder = NewBuilder();
            builder.Start(Start, Browser("seltech.store"));
            builder.OnForegroundChanged(Start.AddMinutes(40), Browser("drive.google.com"));
            builder.Stop(Start.AddMinutes(65));

            List<ActivitySpan> spans = builder.DrainCompleted();
            Assert.Equal(2, spans.Count);
            Assert.Equal("seltech.store", spans[0].BrowserDomain);
            Assert.Equal(2400, (int)(DateTime.Parse(spans[0].EndedAt).ToUniversalTime()
                - DateTime.Parse(spans[0].StartedAt).ToUniversalTime()).TotalSeconds);
            Assert.Equal("drive.google.com", spans[1].BrowserDomain);
        }

        [Fact]
        public void Staying_on_one_site_is_one_span()
        {
            ActivitySpanBuilder builder = NewBuilder();
            builder.Start(Start, Browser("seltech.store"));
            // The tick re-samples every few seconds; none of these should end the span.
            for (int minute = 1; minute <= 5; minute++)
            {
                builder.OnForegroundChanged(Start.AddMinutes(minute), Browser("seltech.store"));
            }
            builder.Stop(Start.AddMinutes(6));

            List<ActivitySpan> spans = builder.DrainCompleted();
            Assert.Single(spans);
            Assert.Equal("seltech.store", spans[0].BrowserDomain);
        }

        [Fact]
        public void A_page_that_has_not_resolved_a_domain_yet_does_not_split_the_span()
        {
            ActivitySpanBuilder builder = NewBuilder();
            builder.Start(Start, Browser("seltech.store"));

            ForegroundSnapshot loading = Browser("seltech.store");
            loading.BrowserDomain = null;                    // mid-navigation, address bar empty
            builder.OnForegroundChanged(Start.AddSeconds(30), loading);
            builder.Stop(Start.AddMinutes(10));

            List<ActivitySpan> spans = builder.DrainCompleted();
            Assert.Single(spans);
            Assert.Equal("seltech.store", spans[0].BrowserDomain);
        }

        [Fact]
        public void A_domain_learned_after_the_span_opened_is_filled_in()
        {
            // The foreground event arrives before the address bar has anything in it; the next
            // tick knows. Without this the whole span would be attributed to no site at all.
            ActivitySpanBuilder builder = NewBuilder();

            ForegroundSnapshot opening = Browser("seltech.store");
            opening.BrowserDomain = null;
            builder.Start(Start, opening);

            builder.OnForegroundChanged(Start.AddSeconds(4), Browser("seltech.store"));
            builder.Stop(Start.AddMinutes(20));

            List<ActivitySpan> spans = builder.DrainCompleted();
            Assert.Single(spans);
            Assert.Equal("seltech.store", spans[0].BrowserDomain);
        }

        /* ── Documents ──────────────────────────────────────────────────────────────────────── */

        [Fact]
        public void Opening_another_workbook_ends_the_span()
        {
            ActivitySpanBuilder builder = NewBuilder();
            builder.Start(Start, Workbook("Q3 Budget.xlsx"));
            builder.OnForegroundChanged(Start.AddMinutes(25), Workbook("Rate Analysis.xlsx"));
            builder.Stop(Start.AddMinutes(45));

            List<ActivitySpan> spans = builder.DrainCompleted();
            Assert.Equal(2, spans.Count);
            Assert.Equal("Q3 Budget.xlsx", spans[0].DocumentName);
            Assert.Equal("Rate Analysis.xlsx", spans[1].DocumentName);
        }

        [Fact]
        public void The_same_workbook_all_morning_is_one_span_per_max_duration()
        {
            ActivitySpanBuilder builder = NewBuilder();
            builder.MaxSpanDuration = TimeSpan.FromMinutes(10);
            builder.Start(Start, Workbook("Measurement Book.xlsx"));

            for (int minute = 1; minute <= 30; minute++)
            {
                builder.OnTick(Start.AddMinutes(minute), 0);
                builder.OnForegroundChanged(Start.AddMinutes(minute), Workbook("Measurement Book.xlsx"));
            }
            builder.Stop(Start.AddMinutes(31));

            List<ActivitySpan> spans = builder.DrainCompleted();
            // Split by the ten-minute ceiling, not by the document changing.
            Assert.True(spans.Count >= 3, "expected the max-duration split, got " + spans.Count);
            Assert.All(spans, span => Assert.Equal("Measurement Book.xlsx", span.DocumentName));
        }

        /* ── Both at once, and neither ──────────────────────────────────────────────────────── */

        [Fact]
        public void Switching_from_a_workbook_to_a_browser_still_splits_on_the_application()
        {
            ActivitySpanBuilder builder = NewBuilder();
            builder.Start(Start, Workbook("Q3 Budget.xlsx"));
            builder.OnForegroundChanged(Start.AddMinutes(10), Browser("seltech.store"));
            builder.Stop(Start.AddMinutes(20));

            List<ActivitySpan> spans = builder.DrainCompleted();
            Assert.Equal(2, spans.Count);
            Assert.Equal("Q3 Budget.xlsx", spans[0].DocumentName);
            Assert.Null(spans[0].BrowserDomain);
            Assert.Equal("seltech.store", spans[1].BrowserDomain);
            Assert.Null(spans[1].DocumentName);
        }

        [Fact]
        public void With_both_policies_off_the_behaviour_is_exactly_what_it_was()
        {
            // Nothing collected means nothing splits: one application, one span. This is the
            // default configuration, so it is the one that must not have changed.
            ActivitySpanBuilder builder = NewBuilder();
            var plain = new ForegroundSnapshot
            {
                ProcessName = "chrome.exe",
                ApplicationName = "Google Chrome",
                WindowTitle = "Anything - Google Chrome",
            };
            builder.Start(Start, plain);
            for (int minute = 1; minute <= 5; minute++)
            {
                builder.OnForegroundChanged(Start.AddMinutes(minute), plain);
            }
            builder.Stop(Start.AddMinutes(6));

            List<ActivitySpan> spans = builder.DrainCompleted();
            Assert.Single(spans);
            Assert.Null(spans[0].BrowserDomain);
            Assert.Null(spans[0].DocumentName);
        }
    }
}
