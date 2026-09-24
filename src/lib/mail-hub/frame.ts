/**
 * The document a message body is displayed in — see `sanitize.ts` for the layers around it.
 *
 * Its own file so the browser can build it without bundling the server-side sanitiser. The CSP is
 * the frame's own: no script source at all, no connections, no frames, no forms; images only from
 * `data:` (and `https:` when the reader allowed remote content); `base-uri 'none'` so a surviving
 * `<base>` cannot retarget links.
 */

export function mailFrameDocument(html: string, allowRemoteContent: boolean): string {
  const img = allowRemoteContent ? 'data: https:' : 'data:';
  const csp = [
    "default-src 'none'",
    `img-src ${img}`,
    "style-src 'unsafe-inline'",
    'font-src data:',
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="${csp}">` +
    '<meta name="referrer" content="no-referrer">' +
    '<style>html,body{margin:0;padding:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;line-height:1.5;color:#0f172a;word-wrap:break-word;overflow-wrap:anywhere}' +
    'img{max-width:100%;height:auto}img[data-blocked]{display:inline-block;min-width:16px;min-height:16px;background:#f1f5f9;outline:1px dashed #cbd5e1}' +
    'blockquote{margin:0 0 0 .8ex;border-left:2px solid #cbd5e1;padding-left:1ex;color:#475569}pre{white-space:pre-wrap}table{max-width:100%}</style>' +
    `</head><body>${html}</body></html>`
  );
}
