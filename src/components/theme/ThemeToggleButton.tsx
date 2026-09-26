'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useTheme } from './ThemeProvider';
import { THEME_MODES, isThemeMode, themeModeMeta, type ThemeMode } from './theme-preferences';

const icons: Record<ThemeMode, typeof Sun> = { light: Sun, dark: Moon, system: Monitor };

/**
 * The header's theme switch: sun or moon for what is on screen (a small monitor badge when it is
 * following the device), opening Light / Dark / System default. The choice is the signed-in
 * user's own — ThemeProvider saves it to their profile.
 *
 * Needs a TooltipProvider above it; the header supplies one.
 */
export function ThemeToggleButton({ className }: { className?: string }) {
  const { mode, resolvedMode, setMode } = useTheme();
  const dark = resolvedMode === 'dark';
  const current = themeModeMeta[mode].label;

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Theme: ${current}. Change theme`}
              className={cn('relative h-9 w-9 overflow-hidden rounded-full md:h-10 md:w-10', className)}
            >
              <Sun
                aria-hidden="true"
                className={cn(
                  'h-5 w-5 transition-all duration-500 ease-out motion-reduce:transition-none',
                  dark ? 'rotate-90 scale-0 opacity-0' : 'rotate-0 scale-100 opacity-100',
                )}
              />
              <Moon
                aria-hidden="true"
                className={cn(
                  'absolute h-5 w-5 transition-all duration-500 ease-out motion-reduce:transition-none',
                  dark ? 'rotate-0 scale-100 opacity-100' : '-rotate-90 scale-0 opacity-0',
                )}
              />
              {mode === 'system' && (
                <span
                  aria-hidden="true"
                  className="absolute bottom-1 right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-primary text-primary-foreground ring-2 ring-background"
                >
                  <Monitor className="h-2 w-2" />
                </span>
              )}
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Theme: {current}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={mode} onValueChange={(value) => isThemeMode(value) && setMode(value)}>
          {THEME_MODES.map((option) => {
            const Icon = icons[option];
            return (
              <DropdownMenuRadioItem key={option} value={option}>
                <Icon className="mr-2 h-4 w-4" aria-hidden="true" />
                {themeModeMeta[option].label}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
