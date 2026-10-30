import type { HomeDesign } from '@/lib/appearance/model';

/** A thumbnail sketch of each home design, for the choice in Settings › Appearance. Decorative. */
export function HomeDesignPreview({ design }: { design: HomeDesign }) {
  if (design === 'command') {
    return (
      <span className="block h-20 overflow-hidden rounded-md border bg-background">
        <span className="block h-8 bg-[#0f1f3d] px-2 pt-1.5 dark:bg-[#18315c]">
          <span className="block h-1.5 w-12 rounded-full bg-white/80" />
          <span className="mt-1 block h-1 w-16 rounded-full bg-white/40" />
        </span>
        <span className="-mt-2.5 grid grid-cols-4 gap-1 px-2">
          {[0, 1, 2, 3].map((key) => (
            <span key={key} className="block h-5 rounded-sm border bg-card shadow-sm" />
          ))}
        </span>
        <span className="mt-1.5 grid grid-cols-4 gap-1 px-2">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((key) => (
            <span key={key} className="flex h-2.5 items-center gap-0.5 rounded-sm border bg-card px-0.5">
              <span className={['h-1.5 w-1.5 rounded-[2px]', key < 4 ? 'bg-blue-600' : 'bg-orange-500'].join(' ')} />
            </span>
          ))}
        </span>
      </span>
    );
  }

  if (design === 'aurora') {
    return (
      <span className="relative block h-20 overflow-hidden rounded-md border bg-background p-1.5">
        <span className="absolute -left-4 -top-4 h-12 w-12 rounded-full bg-teal-200/70 blur-md dark:bg-teal-500/20" />
        <span className="absolute -right-3 -top-3 h-12 w-16 rounded-full bg-indigo-200/70 blur-md dark:bg-indigo-500/20" />
        <span className="relative flex h-7 items-center justify-between rounded border border-white/60 bg-card/80 px-1.5 dark:border-white/10">
          <span>
            <span className="block h-1.5 w-10 rounded-full bg-gradient-to-r from-teal-500 to-blue-500" />
            <span className="mt-1 block h-1.5 w-14 rounded-sm border bg-background" />
          </span>
          <span className="flex gap-0.5">
            {['from-blue-500 to-indigo-500', 'from-orange-400 to-amber-500', 'from-pink-500 to-rose-500'].map((edge) => (
              <span key={edge} className="block h-4 w-4 overflow-hidden rounded-sm border bg-card">
                <span className={['block h-0.5 bg-gradient-to-r', edge].join(' ')} />
              </span>
            ))}
          </span>
        </span>
        <span className="relative mt-1.5 grid grid-cols-6 gap-1">
          {Array.from({ length: 12 }).map((_, key) => (
            <span key={key} className="flex h-4 items-center justify-center rounded-sm border border-white/60 bg-card/80 dark:border-white/10">
              <span className="block h-1.5 w-1.5 rounded-[2px] bg-gradient-to-br from-teal-500 to-blue-500" />
            </span>
          ))}
        </span>
      </span>
    );
  }

  if (design === 'launchpad') {
    return (
      <span className="block h-20 overflow-hidden rounded-md border bg-background p-1.5">
        <span className="flex h-7 items-center justify-between rounded bg-gradient-to-br from-teal-800 to-emerald-600 px-1.5">
          <span>
            <span className="block h-1.5 w-10 rounded-full bg-white/80" />
            <span className="mt-1 block h-1.5 w-14 rounded-sm bg-white" />
          </span>
          <span className="flex gap-0.5">
            {[0, 1, 2].map((key) => (
              <span key={key} className="block h-4 w-4 rounded-sm bg-white/25" />
            ))}
          </span>
        </span>
        <span className="mt-1.5 grid grid-cols-6 gap-1">
          {Array.from({ length: 12 }).map((_, key) => (
            <span key={key} className="flex h-4 items-center justify-center rounded-sm border bg-card">
              <span className="block h-1.5 w-1.5 rounded-[2px] bg-gradient-to-br from-violet-500 to-blue-500" />
            </span>
          ))}
        </span>
      </span>
    );
  }

  return (
    <span className="block h-20 overflow-hidden rounded-md border bg-background p-1.5">
      <span className="flex gap-1">
        <span className="block h-2 w-8 rounded-full bg-primary/70" />
        <span className="block h-2 w-8 rounded-full bg-muted" />
      </span>
      <span className="mt-1.5 grid grid-cols-4 gap-1">
        {Array.from({ length: 8 }).map((_, key) => (
          <span key={key} className="block h-5 rounded-sm border bg-card" />
        ))}
      </span>
    </span>
  );
}
