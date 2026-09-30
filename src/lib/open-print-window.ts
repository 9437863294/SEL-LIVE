import { buildPrintDocument, type PrintReport } from './print-table-report';

/**
 * Opens a report in its own window and sends it to the printer.
 *
 * Kept apart from `print-table-report.ts` so that module stays importless and node-testable — this
 * half is the part that can only run in a browser and cannot be tested without one.
 *
 * Returns false when the window could not be opened, which in practice means a popup blocker. The
 * caller is expected to say so rather than leave the button looking broken.
 */
export function openPrintWindow(report: PrintReport): boolean {
  if (typeof window === 'undefined') return false;

  const win = window.open('', '_blank', 'width=1100,height=800');
  if (!win) return false;

  win.document.open();
  win.document.write(buildPrintDocument(report));
  win.document.close();

  /*
   * Printing immediately can catch the document before its styles are applied, which prints an
   * unstyled table. Waiting for `load` is the reliable signal; the timeout is a fallback for the
   * case where the event has already fired by the time this runs.
   */
  const send = () => {
    try {
      win.focus();
      win.print();
    } catch {
      /* The user closed the window before it printed — nothing to recover. */
    }
  };
  if (win.document.readyState === 'complete') setTimeout(send, 120);
  else win.addEventListener('load', () => setTimeout(send, 120));

  return true;
}
