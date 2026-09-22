using Sel.Agent.Core.Tracking;
using Xunit;

namespace Sel.Agent.Tests
{
    /// <summary>
    /// Turning the titles Office actually puts on its windows into one file name per file.
    /// </summary>
    /// <remarks>
    /// Every title here is one a real machine produces. The decoration is the point: Office adds
    /// AutoSave prefixes, read-only and compatibility markers and OneDrive status, and a report
    /// that listed "Q3 Budget.xlsx" and "Q3 Budget.xlsx [Read-Only]" as two files would be wrong
    /// about the one thing it exists to say.
    /// </remarks>
    public class DocumentNameRulesTests
    {
        [Fact]
        public void Takes_the_workbook_from_an_excel_title()
        {
            Assert.Equal("Q3 Budget.xlsx", DocumentNameRules.From("excel", "Q3 Budget.xlsx - Excel"));
        }

        [Fact]
        public void Takes_a_word_document()
        {
            Assert.Equal("Tender Covering Letter.docx",
                DocumentNameRules.From("winword", "Tender Covering Letter.docx - Word"));
        }

        [Fact]
        public void Takes_a_new_unsaved_workbook_which_has_no_extension_yet()
        {
            // "Book1" is what the person sees and is worth reporting: it says a spreadsheet was
            // being built, even though it has never been saved.
            Assert.Equal("Book1", DocumentNameRules.From("excel", "Book1 - Excel"));
        }

        [Fact]
        public void Strips_read_only()
        {
            Assert.Equal("Rate Analysis.xlsx",
                DocumentNameRules.From("excel", "Rate Analysis.xlsx [Read-Only] - Excel"));
        }

        [Fact]
        public void Strips_two_bracketed_states_at_once()
        {
            // A 2003 workbook opened on a site machine produces exactly this.
            Assert.Equal("Old Tender.xls",
                DocumentNameRules.From("excel", "Old Tender.xls [Read-Only] [Compatibility Mode] - Excel"));
        }

        [Fact]
        public void Strips_the_autosave_prefix()
        {
            Assert.Equal("Measurement Book.xlsx",
                DocumentNameRules.From("excel", "AutoSave • Measurement Book.xlsx - Excel"));
        }

        [Fact]
        public void Strips_the_onedrive_status_and_keeps_the_name()
        {
            Assert.Equal("Cash Flow.xlsx",
                DocumentNameRules.From("excel", "Cash Flow.xlsx - Excel - Saved to OneDrive"));
        }

        [Fact]
        public void A_file_name_containing_the_separator_survives_intact()
        {
            // Splitting on the first " - " would truncate this to "Tender".
            Assert.Equal("Tender - Phase 2.xlsx",
                DocumentNameRules.From("excel", "Tender - Phase 2.xlsx - Excel"));
        }

        [Fact]
        public void Takes_a_pdf_from_the_reader()
        {
            Assert.Equal("Drawing GA-104.pdf",
                DocumentNameRules.From("acrord32", "Drawing GA-104.pdf - Adobe Acrobat Reader DC"));
        }

        [Fact]
        public void Takes_an_autocad_drawing()
        {
            Assert.Equal("Tower T-14.dwg", DocumentNameRules.From("acad", "Tower T-14.dwg - AutoCAD 2022"));
        }

        /* ── What must not produce a name ───────────────────────────────────────────────────── */

        [Fact]
        public void An_empty_excel_with_nothing_open_reports_nothing()
        {
            Assert.Null(DocumentNameRules.From("excel", "Excel"));
        }

        [Fact]
        public void A_browser_title_is_not_a_document()
        {
            Assert.Null(DocumentNameRules.From("chrome", "SEL LIVE - Devices - Google Chrome"));
        }

        [Fact]
        public void A_teams_message_is_not_a_document()
        {
            // The title of a chat window is the conversation. §AZ rules that out, and the way it
            // is ruled out is by Teams not being on the list at all.
            Assert.Null(DocumentNameRules.From("ms-teams", "Chat | Debaprasad Bhoi | Microsoft Teams"));
        }

        [Fact]
        public void An_email_subject_is_not_a_document()
        {
            Assert.Null(DocumentNameRules.From("outlook", "Payment overdue - Message (HTML)"));
        }

        [Theory]
        [InlineData("excel", "")]
        [InlineData("excel", null)]
        [InlineData(null, "Q3 Budget.xlsx - Excel")]
        [InlineData("", "Q3 Budget.xlsx - Excel")]
        public void Missing_input_reports_nothing(string processName, string title)
        {
            Assert.Null(DocumentNameRules.From(processName, title));
        }
    }
}
