"use client";

import { forwardRef, useLayoutEffect, useState, useSyncExternalStore, type ComponentType, type InputHTMLAttributes } from "react";
import Image from "next/image";
import { Eye, EyeOff, Lock } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { CompanyBranding } from "@/lib/appearance/model";
import { cn } from "@/lib/utils";
import type { LoginTone } from "./tones";

/** The SEL logo, shown until the company publishes one of its own. Red on clear: reads on any surface. */
export const LOGO_URL =
  "https://firebasestorage.googleapis.com/v0/b/module-hub-uc7tw.firebasestorage.app/o/Logo%2FSEL%20%20logo2%20.png?alt=media&token=39b0f804-0610-4f3a-b26e-8ce334f94788";

/** The company logo drawn for the surface it sits on, falling back to the other variant, then SEL's. */
export function LogoBlock({
  branding,
  surface,
  className,
}: {
  branding: CompanyBranding;
  surface: "dark" | "light";
  className?: string;
}) {
  const logo = surface === "dark" ? branding.logoDark ?? branding.logoLight : branding.logoLight ?? branding.logoDark;
  return (
    <div className={cn("relative mx-auto h-20 w-[65%]", className)}>
      <Image
        src={logo?.url ?? LOGO_URL}
        alt={`${branding.companyName} logo`}
        fill
        sizes="260px"
        style={{ objectFit: "contain" }}
        preload
      />
    </div>
  );
}

const subscribeToSeconds = (onTick: () => void) => {
  const id = setInterval(onTick, 1000);
  return () => clearInterval(id);
};
const subscribeToNothing = () => () => {};
// Whole seconds, so the snapshot is the same value however often React reads it within a second.
const currentSecond = () => Math.floor(Date.now() / 1000);
const currentYear = () => new Date().getFullYear();
const onServer = () => null;

/**
 * The current time, ticking each second. Server rendering and the browser's first hydration pass
 * must produce the same text, so it is `null` until hydration is done.
 */
export function useNow() {
  const second = useSyncExternalStore(subscribeToSeconds, currentSecond, onServer);
  return second === null ? null : new Date(second * 1000);
}

const pad = (n: number) => String(n).padStart(2, "0");

export function clockParts(now: Date | null) {
  return {
    hh: now ? pad(now.getHours()) : "--",
    mm: now ? pad(now.getMinutes()) : "--",
    ss: now ? pad(now.getSeconds()) : "--",
    ampm: now ? (now.getHours() >= 12 ? "PM" : "AM") : " ",
    longDate: now
      ? now.toLocaleDateString("en-IN", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })
      : " ",
    shortDate: now ? now.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" }) : " ",
  };
}

/** Midnight's glowing cyan clock. */
export function GlowClock() {
  const { hh, mm, ss, ampm, longDate } = clockParts(useNow());
  const glow = "0 0 12px rgba(34,211,238,0.9), 0 0 32px rgba(34,211,238,0.45), 0 0 64px rgba(34,211,238,0.2)";
  const dimGlow = "0 0 8px rgba(34,211,238,0.5)";

  return (
    <div className="flex select-none flex-col items-center gap-4">
      <div className="h-px w-40 bg-gradient-to-r from-transparent via-cyan-400/50 to-transparent" />
      <div className="flex items-end gap-1 font-mono leading-none">
        <span className="text-6xl font-thin tracking-widest text-cyan-300" style={{ textShadow: glow }}>
          {hh}
        </span>
        <span className="mb-1 animate-pulse text-5xl font-thin text-cyan-400" style={{ textShadow: dimGlow }}>
          :
        </span>
        <span className="text-6xl font-thin tracking-widest text-cyan-300" style={{ textShadow: glow }}>
          {mm}
        </span>
        <div className="mb-1 ml-1 flex flex-col items-start gap-0.5">
          <span className="font-mono text-xs leading-none tracking-widest text-cyan-400/70" style={{ textShadow: dimGlow }}>
            {ampm}
          </span>
          <span className="text-2xl font-thin leading-none tracking-wider text-cyan-400/80" style={{ textShadow: dimGlow }}>
            {ss}
          </span>
        </div>
      </div>
      <p
        className="text-center font-mono text-[11px] uppercase tracking-[0.18em] text-cyan-200/55"
        style={{ textShadow: "0 0 8px rgba(34,211,238,0.3)" }}
      >
        {longDate}
      </p>
      <div className="h-px w-40 bg-gradient-to-r from-transparent via-cyan-400/50 to-transparent" />
    </div>
  );
}

/** A compact live time and date, for designs that keep the clock out of the way. */
export function ClockPill({ className, dotClassName }: { className?: string; dotClassName?: string }) {
  const { hh, mm, ss, shortDate } = clockParts(useNow());
  return (
    <div className={cn("inline-flex select-none items-center gap-2 rounded-full px-3 py-1.5 text-xs", className)}>
      <span className={cn("h-1.5 w-1.5 rounded-full bg-emerald-400", dotClassName)} aria-hidden />
      <span className="font-mono tabular-nums tracking-wide">
        {hh}:{mm}
        <span className="opacity-60">:{ss}</span>
      </span>
      <span className="opacity-40" aria-hidden>
        ·
      </span>
      <span>{shortDate}</span>
    </div>
  );
}

export function CurrentYear() {
  const year = useSyncExternalStore(subscribeToNothing, currentYear, onServer);
  return <>{year ?? "    "}</>;
}

export function Copyright({ companyName, className }: { companyName: string; className?: string }) {
  return (
    <p className={cn("text-center text-[11px]", className)}>
      &copy; <CurrentYear /> {companyName} · All rights reserved
    </p>
  );
}

export function GoogleIcon() {
  return (
    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" aria-hidden>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}

/**
 * Let the sign-in page run edge to edge. globals.css reserves a scrollbar gutter on both sides of
 * every page (`:root { scrollbar-gutter: stable both-edges }`), painted in the page background —
 * two pale strips beside a full-bleed design. Released while this is mounted, restored after.
 */
export function useEdgeToEdge() {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const previous = root.style.scrollbarGutter;
    root.style.scrollbarGutter = "auto";
    return () => {
      root.style.scrollbarGutter = previous;
    };
  }, []);
}

/**
 * What shows before the company's chosen design is known — on the server, and on a device that
 * has never loaded it. Neutral on purpose: showing one design and swapping to another is worse.
 */
export function LoginSplash() {
  useEdgeToEdge();
  return (
    <div className="keep-light flex min-h-screen w-full items-center justify-center bg-[#070b18]" aria-busy="true" aria-label="Loading sign-in">
      <div className="h-9 w-9 animate-spin rounded-full border-2 border-white/10 border-t-white/60" />
    </div>
  );
}

// ─── Form fields ─────────────────────────────────────────────────────────────────────────────────

type IconInputProps = InputHTMLAttributes<HTMLInputElement> & {
  tone: LoginTone;
  icon: ComponentType<{ className?: string }>;
  invalid?: boolean;
};

/** A text input with a leading icon, drawn in the design's tone. */
export const IconInput = forwardRef<HTMLInputElement, IconInputProps>(function IconInput(
  { tone, icon: Icon, invalid, className, ...props },
  ref,
) {
  return (
    <div className="relative">
      <Icon className={cn("pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2", tone.inputIcon)} />
      <Input
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn("pl-9 transition-colors", tone.input, invalid && tone.inputError, className)}
        {...props}
      />
    </div>
  );
});

export function PasswordInput({
  tone,
  id,
  value,
  onChange,
  placeholder = "Enter your password",
  autoFocus,
  error,
}: {
  tone: LoginTone;
  id?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  error?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="space-y-1.5">
      <div className="relative">
        <Lock className={cn("pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2", tone.inputIcon)} />
        <Input
          id={id}
          type={show ? "text" : "password"}
          required
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoFocus={autoFocus}
          autoComplete="current-password"
          aria-invalid={!!error}
          className={cn("pl-9 pr-10 transition-colors", tone.input, error && tone.inputError)}
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setShow((s) => !s)}
          className={cn("absolute right-3 top-1/2 -translate-y-1/2 transition-colors", tone.eyeButton)}
          aria-label={show ? "Hide password" : "Show password"}
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      {error && <p className={cn("text-xs", tone.error)}>{error}</p>}
    </div>
  );
}

export function OrDivider({ tone }: { tone: LoginTone }) {
  return (
    <div className="relative flex w-full items-center gap-3 py-1">
      <div className={cn("flex-1 border-t", tone.divider)} />
      <span className={cn("text-xs", tone.faint)}>or</span>
      <div className={cn("flex-1 border-t", tone.divider)} />
    </div>
  );
}
