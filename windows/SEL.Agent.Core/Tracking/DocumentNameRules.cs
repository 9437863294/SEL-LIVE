using System;

namespace Sel.Agent.Core.Tracking
{
    /// <summary>
    /// Which document somebody has open, taken from the window title and nothing else.
    /// </summary>
    /// <remarks>
    /// <para>
    /// §13 asks which file an employee is working on — "Q3 Budget.xlsx for forty minutes" rather
    /// than "Excel for forty minutes", because the second answers nothing when somebody is asked
    /// what they did on Tuesday. §H is equally explicit that spreadsheet <i>contents</i> are off
    /// limits: no cells, no formulas, no values. A name satisfies the first without approaching
    /// the second.
    /// </para>
    /// <para>
    /// <b>Why the window title and not an Office add-in.</b> An add-in gives the full path, the
    /// sheet and the selection — and has to be deployed and maintained per Office version, needs
    /// macro trust, and breaks when somebody opens a file in the viewer instead. Office puts the
    /// document name in the title of every version back to 2007, so this reads the one thing
    /// Windows already offers. The cost is stated rather than hidden: no path, no confidence about
    /// files whose names contain the separator, and nothing at all from an application that does
    /// not name its document in the title.
    /// </para>
    /// <para>
    /// <b>Known applications only.</b> The title of an arbitrary window is not a document name —
    /// it is a chat message in Teams, an email subject in Outlook, a patient name in a line-of-
    /// business app. Extracting from a fixed list of document applications is what keeps this from
    /// becoming the window-title capture that §12 keeps switched off by default.
    /// </para>
    /// <para>
    /// Outlook is deliberately absent. Its window title is the subject of the message being read,
    /// which is correspondence rather than a document, and §AZ rules out capturing email content.
    /// </para>
    /// </remarks>
    public static class DocumentNameRules
    {
        /// <summary>
        /// The applications whose title ends in a recognisable suffix, and that suffix.
        /// </summary>
        /// <remarks>
        /// Matched on the process name, because the suffix is localised — a Hindi or French
        /// Windows shows a translated application name — while <c>EXCEL.EXE</c> is not. The
        /// suffixes here are the English ones and are treated as optional for that reason: what
        /// the rule really does is take the part before the last separator.
        /// </remarks>
        private static readonly string[] DocumentProcesses =
        {
            "excel",        // Microsoft Excel
            "winword",      // Microsoft Word
            "powerpnt",     // Microsoft PowerPoint
            "msaccess",     // Microsoft Access
            "onenote",      // Microsoft OneNote
            "visio",        // Microsoft Visio
            "winproj",      // Microsoft Project
            "acrobat",      // Adobe Acrobat
            "acrord32",     // Adobe Acrobat Reader
            "notepad",      // Notepad
            "wordpad",      // WordPad
            "soffice",      // LibreOffice / OpenOffice
            "scalc",        // LibreOffice Calc
            "swriter",      // LibreOffice Writer
            "autocad",      // AutoCAD — the drawing name is the work, on a site engineer's PC
            "acad",         // AutoCAD, as it is actually named
        };

        /// <summary>Whether this process names its open document in its window title.</summary>
        public static bool IsDocumentApplication(string processName)
        {
            if (string.IsNullOrEmpty(processName)) return false;

            string name = processName.Trim();
            if (name.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
            {
                name = name.Substring(0, name.Length - 4);
            }

            foreach (string candidate in DocumentProcesses)
            {
                if (string.Equals(name, candidate, StringComparison.OrdinalIgnoreCase)) return true;
            }
            return false;
        }

        /// <summary>
        /// The document name from a window title, or null when the title does not carry one.
        /// </summary>
        /// <remarks>
        /// <para>
        /// Office titles look like <c>Q3 Budget.xlsx - Excel</c>, and carry a surprising amount of
        /// decoration around that: <c>AutoSave</c> prefixes, <c>[Read-Only]</c>,
        /// <c>[Compatibility Mode]</c>, <c>- Saved to OneDrive</c>. Each of those is stripped,
        /// because "Q3 Budget.xlsx" and "Q3 Budget.xlsx [Read-Only]" are the same file and a
        /// report that lists them separately is wrong.
        /// </para>
        /// <para>
        /// A file whose own name contains " - " keeps everything up to the *last* separator, so
        /// "Tender - Phase 2.xlsx - Excel" yields "Tender - Phase 2.xlsx". The opposite choice
        /// would truncate it to "Tender".
        /// </para>
        /// </remarks>
        public static string From(string processName, string windowTitle)
        {
            if (!IsDocumentApplication(processName)) return null;
            if (string.IsNullOrEmpty(windowTitle)) return null;

            string title = windowTitle.Trim();
            if (title.Length == 0 || title.Length > 400) return null;

            // "AutoSave  •  On" and similar live in front of the name on Microsoft 365 builds.
            int bullet = title.LastIndexOf('•');
            if (bullet >= 0 && bullet + 1 < title.Length) title = title.Substring(bullet + 1).Trim();

            // Everything before the last " - " is the document; what follows is the application,
            // or a status Office has appended.
            int separator = title.LastIndexOf(" - ", StringComparison.Ordinal);
            if (separator > 0)
            {
                string tail = title.Substring(separator + 3).Trim();
                string head = title.Substring(0, separator).Trim();

                // "Saved to OneDrive" and friends are a status, not the application, so the name
                // is one separator further left.
                if (LooksLikeStatus(tail))
                {
                    int previous = head.LastIndexOf(" - ", StringComparison.Ordinal);
                    if (previous > 0) head = head.Substring(0, previous).Trim();
                }

                title = head;
            }

            title = StripBracketedSuffixes(title);

            if (title.Length == 0 || title.Length > 200) return null;

            // A title that is only the application name means nothing is open — an empty Excel
            // with no workbook, a PDF reader on its start screen.
            if (IsDocumentApplication(title)) return null;

            return title;
        }

        private static bool LooksLikeStatus(string tail)
        {
            if (string.IsNullOrEmpty(tail)) return false;
            string value = tail.ToLowerInvariant();
            return value.StartsWith("saved to ", StringComparison.Ordinal)
                || value.StartsWith("saving", StringComparison.Ordinal)
                || value == "read-only"
                || value == "compatibility mode";
        }

        /// <summary>
        /// Remove the bracketed states Office appends: Read-Only, Compatibility Mode, Group.
        /// </summary>
        /// <remarks>
        /// Repeated, because two can appear at once: "Old Tender.xls [Read-Only] [Compatibility
        /// Mode] - Excel" is a real title on a site machine opening a 2003 workbook.
        /// </remarks>
        private static string StripBracketedSuffixes(string title)
        {
            string value = title;
            while (value.EndsWith("]", StringComparison.Ordinal))
            {
                int open = value.LastIndexOf('[');
                if (open <= 0) break;
                value = value.Substring(0, open).Trim();
            }
            return value;
        }
    }
}
