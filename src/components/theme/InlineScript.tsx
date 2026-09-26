/**
 * An inline `<script>` that runs during HTML parsing on a full page load and is inert afterwards.
 *
 * From the bundled Next docs (guides/preventing-flash-before-hydration): React warns in development
 * when rendering produces a `<script>`, so the element is `text/javascript` on the server and
 * `text/plain` on the client, with `suppressHydrationWarning` absorbing the difference.
 */
export function InlineScript({ html }: { html: string }) {
  return (
    <script
      type={typeof window === 'undefined' ? 'text/javascript' : 'text/plain'}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
