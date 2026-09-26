'use client';

import * as RadioGroupPrimitive from '@radix-ui/react-radio-group';
import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme } from './ThemeProvider';
import { THEME_MODES, isThemeMode, themeModeMeta, type ThemeMode } from './theme-preferences';

const icons: Record<ThemeMode, typeof Sun> = { light: Sun, dark: Moon, system: Monitor };

/** A miniature window in the given mode; `system` shows both halves. */
function ModePreview({ mode }: { mode: ThemeMode }) {
  const pane = (dark: boolean) => (
    // `keep-light` opts the light pane out of the dark-mode compatibility layer, which would
    // otherwise repaint its white surfaces dark and make both previews look the same.
    <div className={cn('flex h-full flex-col gap-1.5 p-2', dark ? 'bg-zinc-900' : 'keep-light bg-slate-50')}>
      <div className={cn('h-1.5 w-10 rounded-full', dark ? 'bg-zinc-700' : 'bg-slate-200')} />
      <div className={cn('flex-1 rounded-md p-1.5', dark ? 'bg-zinc-800' : 'bg-white shadow-sm')}>
        <div className="h-1.5 w-8 rounded-full bg-[image:var(--sel-tab-gradient)]" />
        <div className={cn('mt-1.5 h-1 w-12 rounded-full', dark ? 'bg-zinc-600' : 'bg-slate-200')} />
        <div className={cn('mt-1 h-1 w-9 rounded-full', dark ? 'bg-zinc-600' : 'bg-slate-200')} />
      </div>
    </div>
  );
  return (
    <div className="relative h-20 w-full overflow-hidden rounded-lg ring-1 ring-black/10" aria-hidden="true">
      {mode === 'system' ? (
        <>
          <div className="absolute inset-0">{pane(false)}</div>
          <div className="absolute inset-0 [clip-path:polygon(100%_0,100%_100%,0_100%)]">{pane(true)}</div>
        </>
      ) : (
        pane(mode === 'dark')
      )}
    </div>
  );
}

/**
 * Light / Dark / System default, applied the moment it is picked and saved to the profile.
 * Used on Settings → Appearance; the header's account menu offers the same three choices.
 */
export function ThemeModeControl({ className }: { className?: string }) {
  const { mode, setMode } = useTheme();
  return (
    <RadioGroupPrimitive.Root
      value={mode}
      onValueChange={(value) => isThemeMode(value) && setMode(value)}
      aria-label="Colour mode"
      className={cn('grid grid-cols-1 gap-3 sm:grid-cols-3', className)}
    >
      {THEME_MODES.map((option) => {
        const Icon = icons[option];
        const selected = option === mode;
        return (
          <RadioGroupPrimitive.Item
            key={option}
            value={option}
            className={cn(
              'group relative flex flex-col gap-2.5 rounded-2xl border-2 p-2.5 text-left transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              selected ? 'border-primary bg-primary/5 shadow-sm' : 'border-border/60 hover:border-primary/40 hover:bg-muted/30',
            )}
          >
            <ModePreview mode={option} />
            <span className="flex items-start gap-2 px-0.5">
              <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', selected ? 'text-primary' : 'text-muted-foreground')} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">{themeModeMeta[option].label}</span>
                <span className="block text-xs text-muted-foreground">{themeModeMeta[option].description}</span>
              </span>
              <span
                className={cn(
                  'flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary transition-opacity',
                  selected ? 'opacity-100' : 'opacity-0',
                )}
              >
                <Check className="h-3 w-3 text-primary-foreground" />
              </span>
            </span>
          </RadioGroupPrimitive.Item>
        );
      })}
    </RadioGroupPrimitive.Root>
  );
}
