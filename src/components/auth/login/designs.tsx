"use client";

import type { CSSProperties, ReactNode } from "react";
import { Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { CompanyBranding, LoginHighlight } from "@/lib/appearance/model";
import { cn } from "@/lib/utils";
import { ClockPill, Copyright, GlowClock, GoogleIcon, IconInput, LogoBlock, OrDivider, PasswordInput, clockParts, useEdgeToEdge, useNow } from "./parts";
import { HorizonScene, StarField, TowerElevation } from "./scenes";
import { LOGIN_TONES } from "./tones";

/**
 * The sign-in page's layouts. Each takes the company branding and the form to show — whichever
 * step the visitor is on — and owns everything around it: background, artwork, headline, clock,
 * highlights, logo and footer. What a design has room for is listed in `LOGIN_DESIGN_META`.
 */
interface DesignProps {
  branding: CompanyBranding;
  children: ReactNode;
}

const visibleHighlights = (branding: CompanyBranding): LoginHighlight[] =>
  branding.loginShowHighlights ? branding.loginHighlights : [];

/** Headline and highlight on one run of text, wrapping naturally. */
function InlineHeadline({ branding, className, highlightClassName }: { branding: CompanyBranding; className?: string; highlightClassName?: string }) {
  return (
    <h1 className={cn("text-balance", className)}>
      {branding.loginHeadline}
      {branding.loginHeadline && branding.loginHighlight ? " " : null}
      {branding.loginHighlight && <span className={highlightClassName}>{branding.loginHighlight}</span>}
    </h1>
  );
}

// ─── Horizon ─────────────────────────────────────────────────────────────────────────────────────

// The sunset glow sits low on the right, behind the card, where the tower line meets the horizon.
const HORIZON_SKY = [
  "radial-gradient(ellipse 48% 38% at 70% 94%, rgba(251,146,60,0.42), rgba(244,63,94,0.16) 50%, transparent 78%)",
  "linear-gradient(180deg, #050816 0%, #0b1132 34%, #1f1846 58%, #45193f 78%, #7a2337 100%)",
].join(", ");

/** One sky for the whole page: the form sits on frosted glass over the same dusk as the headline. */
function HorizonDesign({ branding, children }: DesignProps) {
  const highlights = visibleHighlights(branding);
  return (
    <div className="keep-light relative isolate flex min-h-screen w-full flex-col overflow-hidden text-white" style={{ background: HORIZON_SKY }}>
      <StarField className="absolute inset-x-0 top-0 -z-10 h-[60%] w-full" />
      {/* Natural shape on wide screens; never shorter than 15rem, cropping its sides instead. */}
      <HorizonScene className="absolute inset-x-0 bottom-0 -z-10 h-auto min-h-[15rem] w-full" />

      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-5 pt-5 sm:px-10 sm:pt-7 lg:px-14">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="h-2 w-2 shrink-0 rounded-full bg-amber-300 shadow-[0_0_12px_rgba(252,211,77,0.9)]" aria-hidden />
          <span className="truncate text-sm font-semibold tracking-[0.2em]">{branding.shortName.toUpperCase()}</span>
        </div>
        {branding.loginShowClock && <ClockPill className="shrink-0 border border-white/15 bg-white/10 text-white/85 backdrop-blur" dotClassName="bg-amber-300" />}
      </header>

      {/* Brand and headline share a left edge, clock and card a right edge; text and card share a centre line. */}
      <main className="mx-auto grid w-full max-w-6xl flex-1 content-center items-center gap-8 px-4 py-6 sm:px-10 md:gap-10 lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-16 lg:px-14">
        <div className="hidden text-center md:block lg:text-left">
          <InlineHeadline
            branding={branding}
            className="mx-auto max-w-xl text-4xl font-semibold leading-[1.08] tracking-tight lg:mx-0 lg:text-5xl"
            highlightClassName="bg-gradient-to-r from-amber-200 via-orange-300 to-rose-300 bg-clip-text text-transparent"
          />
          <p className="mx-auto mt-5 max-w-md text-[15px] leading-relaxed text-white/65 lg:mx-0">{branding.loginSubheadline}</p>
          {highlights.length > 0 && (
            <ul className="mt-8 hidden max-w-md lg:block">
              {highlights.map((h, i) => (
                <li key={i} className="flex gap-4 border-t border-white/10 py-3 first:border-t-0 first:pt-0">
                  <span className="pt-0.5 font-mono text-xs text-amber-300/80">{String(i + 1).padStart(2, "0")}</span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-white">{h.label}</span>
                    {h.description && <span className="block text-xs text-white/50">{h.description}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="relative mx-auto w-full max-w-[400px] rounded-[24px] border border-white/[0.12] bg-[#0a0c22]/80 p-6 shadow-[0_30px_90px_-20px_rgba(0,0,0,0.75)] backdrop-blur-xl sm:p-8">
          <div className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-amber-100/50 to-transparent" aria-hidden />
          <LogoBlock branding={branding} surface="dark" className="mb-5 h-12 w-[45%]" />
          {children}
        </div>
      </main>

      <Copyright companyName={branding.companyName} className="px-4 pb-4 text-white/50 [text-shadow:0_1px_6px_rgba(0,0,0,0.9)]" />
    </div>
  );
}

// ─── Midnight (the original design) ──────────────────────────────────────────────────────────────

/**
 * The headline's last word goes onto the second line with the highlight — how "Powering every
 * project / through live intelligence" was always set — so a custom one keeps the same shape.
 */
function SplitHeadline({ headline, highlight }: { headline: string; highlight: string }) {
  const words = headline.split(" ").filter(Boolean);
  const lead = words.slice(0, -1).join(" ");
  const joiner = words[words.length - 1] ?? "";
  return (
    <h1 className="mb-4 text-3xl font-bold leading-tight tracking-tight text-white lg:text-4xl">
      {lead && (
        <>
          {lead}
          <br />
        </>
      )}
      {joiner}
      {joiner && highlight ? " " : null}
      {highlight && <span className="text-cyan-300">{highlight}</span>}
    </h1>
  );
}

function MidnightDesign({ branding, children }: DesignProps) {
  const highlights = visibleHighlights(branding);
  return (
    <div className="keep-light min-h-screen w-full bg-[#020617] text-slate-100">
      <main className="flex min-h-screen items-center justify-center px-4 py-8">
        <div className="grid w-full max-w-5xl grid-cols-1 overflow-hidden rounded-2xl border border-cyan-300/15 bg-slate-950/50 shadow-[0_30px_120px_-40px_rgba(14,116,255,0.7)] backdrop-blur-xl md:grid-cols-2">
          <div className="relative hidden flex-col justify-between overflow-hidden border-r border-white/10 bg-gradient-to-br from-cyan-500/12 via-slate-900/80 to-blue-900/20 p-10 md:flex">
            <div
              className="absolute inset-0 opacity-15"
              style={{ backgroundImage: "radial-gradient(circle at 1px 1px, rgba(100,200,255,0.25) 1px, transparent 0)", backgroundSize: "28px 28px" }}
            />
            <div className="absolute left-[-8rem] top-[-5rem] h-64 w-64 rounded-full bg-cyan-300/12 blur-[80px]" />
            <div className="absolute bottom-[-8rem] right-[-7rem] h-72 w-72 rounded-full bg-blue-500/15 blur-[100px]" />

            <div className="relative z-10">
              <div className="mb-6 flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-cyan-300/40 bg-cyan-400/15 shadow-lg shadow-cyan-500/20">
                  <div className="h-2 w-2 rounded-full bg-cyan-200 animate-electric-flicker" />
                </div>
                <span className="text-lg font-semibold tracking-[0.18em] text-cyan-100">{branding.shortName.toUpperCase()}</span>
              </div>
              <SplitHeadline headline={branding.loginHeadline} highlight={branding.loginHighlight} />
              <p className="max-w-xs text-sm leading-relaxed text-cyan-100/65">{branding.loginSubheadline}</p>
            </div>

            {branding.loginShowClock && (
              <div className="relative z-10 flex items-center justify-center py-4">
                <GlowClock />
              </div>
            )}

            {highlights.length > 0 && (
              <div className="relative z-10 space-y-3">
                {highlights.map((f, i) => (
                  <div key={i} className="flex items-start gap-3 rounded-xl border border-cyan-300/15 bg-cyan-500/8 px-4 py-3">
                    <div className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-300 animate-electric-flicker" />
                    <div>
                      <p className="text-xs font-semibold text-cyan-100">{f.label}</p>
                      {f.description && <p className="text-xs text-cyan-200/55">{f.description}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex min-h-[600px] flex-col items-center justify-center bg-[#020617] px-8 py-10 md:px-12">
            <div className="w-full max-w-sm">
              <LogoBlock branding={branding} surface="dark" className="mb-6" />
              {children}
            </div>
            <Copyright companyName={branding.companyName} className="mt-8 text-slate-500/70" />
          </div>
        </div>
      </main>
    </div>
  );
}

// ─── Glass ───────────────────────────────────────────────────────────────────────────────────────

function GlassDesign({ branding, children }: DesignProps) {
  const highlights = visibleHighlights(branding);
  return (
    <div className="keep-light relative isolate flex min-h-screen w-full flex-col overflow-hidden bg-[#05060f] text-white">
      <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden>
        <div className="login-blob-a absolute -left-[12%] -top-[18%] h-[60vmax] w-[60vmax] rounded-full bg-violet-600/45 blur-[110px]" />
        <div className="login-blob-b absolute -right-[18%] top-[8%] h-[52vmax] w-[52vmax] rounded-full bg-cyan-500/30 blur-[120px]" />
        <div className="login-blob-c absolute -bottom-[30%] left-[18%] h-[55vmax] w-[55vmax] rounded-full bg-rose-500/30 blur-[120px]" />
        <div
          className="absolute inset-0 opacity-60"
          style={{
            backgroundImage: "linear-gradient(rgba(255,255,255,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.045) 1px, transparent 1px)",
            backgroundSize: "64px 64px",
            maskImage: "radial-gradient(ellipse at center, black 20%, transparent 75%)",
            WebkitMaskImage: "radial-gradient(ellipse at center, black 20%, transparent 75%)",
          }}
        />
      </div>

      <header className="flex items-center justify-between gap-3 px-5 py-5 sm:px-8">
        <span className="truncate text-sm font-semibold tracking-[0.22em] text-white/90">{branding.shortName.toUpperCase()}</span>
        {branding.loginShowClock && <ClockPill className="shrink-0 border border-white/15 bg-white/10 text-white/80 backdrop-blur-md" dotClassName="bg-fuchsia-300" />}
      </header>

      <main className="mx-auto grid w-full max-w-6xl flex-1 items-center gap-12 px-4 pb-6 sm:px-8 lg:grid-cols-[minmax(0,1fr)_440px]">
        <div className="hidden lg:block">
          <InlineHeadline
            branding={branding}
            className="max-w-xl text-5xl font-semibold leading-[1.05] tracking-tight"
            highlightClassName="bg-gradient-to-r from-fuchsia-300 via-rose-200 to-amber-200 bg-clip-text text-transparent"
          />
          <p className="mt-5 max-w-lg text-lg leading-relaxed text-white/60">{branding.loginSubheadline}</p>
          {highlights.length > 0 && (
            <div className="mt-10 grid max-w-xl grid-cols-3 gap-3">
              {highlights.map((h, i) => (
                <div key={i} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur-md">
                  <span className="font-mono text-[11px] text-fuchsia-200/70">{String(i + 1).padStart(2, "0")}</span>
                  <p className="mt-2 text-sm font-medium text-white">{h.label}</p>
                  {h.description && <p className="mt-1 text-xs leading-snug text-white/50">{h.description}</p>}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="relative mx-auto w-full max-w-[440px] rounded-[28px] border border-white/15 bg-white/[0.07] p-7 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.65)] backdrop-blur-2xl sm:p-10">
          <div className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-white/60 to-transparent" aria-hidden />
          <LogoBlock branding={branding} surface="dark" className="mb-7 h-16 w-[55%]" />
          {children}
        </div>
      </main>

      <Copyright companyName={branding.companyName} className="px-4 pb-5 text-white/40" />
    </div>
  );
}

// ─── Minimal ─────────────────────────────────────────────────────────────────────────────────────

function MinimalClock() {
  const { hh, mm, longDate } = clockParts(useNow());
  return (
    <p className="select-none text-xs text-slate-500">
      {longDate}
      <span className="mx-2 text-slate-300" aria-hidden>
        ·
      </span>
      <span className="font-mono tabular-nums text-slate-600">
        {hh}:{mm}
      </span>
    </p>
  );
}

function MinimalDesign({ branding, children }: DesignProps) {
  return (
    <div className="keep-light relative isolate flex min-h-screen w-full flex-col bg-slate-50 text-slate-900">
      <div className="h-1 w-full bg-primary" aria-hidden />
      <div
        className="pointer-events-none absolute inset-0 -z-10 opacity-70"
        aria-hidden
        style={{
          backgroundImage: "radial-gradient(#cbd5e1 1px, transparent 1px)",
          backgroundSize: "22px 22px",
          maskImage: "radial-gradient(ellipse at center, black 25%, transparent 72%)",
          WebkitMaskImage: "radial-gradient(ellipse at center, black 25%, transparent 72%)",
        }}
      />
      {branding.loginShowClock && (
        <div className="flex justify-center px-4 pt-6">
          <MinimalClock />
        </div>
      )}
      <main className="flex flex-1 flex-col items-center justify-center px-4 py-8">
        <div className="w-full max-w-[420px] rounded-2xl border border-slate-200/80 bg-white p-7 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_24px_60px_-24px_rgba(15,23,42,0.22)] sm:p-10">
          <LogoBlock branding={branding} surface="light" className="mb-7 h-16 w-[60%]" />
          {children}
        </div>
      </main>
      <Copyright companyName={branding.companyName} className="px-4 pb-6 text-slate-400" />
    </div>
  );
}

// ─── Blueprint ───────────────────────────────────────────────────────────────────────────────────

const BLUEPRINT_PAPER: CSSProperties = {
  backgroundColor: "#0b3a75",
  backgroundImage: [
    "radial-gradient(ellipse at 35% 35%, rgba(76,149,226,0.35), transparent 65%)",
    "linear-gradient(rgba(255,255,255,0.11) 1px, transparent 1px)",
    "linear-gradient(90deg, rgba(255,255,255,0.11) 1px, transparent 1px)",
    "linear-gradient(rgba(255,255,255,0.045) 1px, transparent 1px)",
    "linear-gradient(90deg, rgba(255,255,255,0.045) 1px, transparent 1px)",
  ].join(", "),
  backgroundSize: "100% 100%, 100px 100px, 100px 100px, 20px 20px, 20px 20px",
};

function TitleCell({ label, value, className }: { label: string; value: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0 px-3 py-2", className)}>
      <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-sky-100/55">{label}</p>
      <p className="truncate font-mono text-xs text-white">{value}</p>
    </div>
  );
}

function BlueprintTitleFooter({ branding }: { branding: CompanyBranding }) {
  const now = useNow();
  const { hh, mm, ss } = clockParts(now);
  const date = now ? now.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase() : " ";
  return (
    <div className={cn("grid border-t border-white/40", branding.loginShowClock ? "grid-cols-3" : "grid-cols-1")}>
      <TitleCell label="Project" value={branding.shortName} />
      {branding.loginShowClock && (
        <>
          <TitleCell label="Date" value={date} className="border-l border-white/40" />
          <TitleCell label="Time" value={`${hh}:${mm}:${ss}`} className="border-l border-white/40 tabular-nums" />
        </>
      )}
    </div>
  );
}

const ZONES_X = ["A", "B", "C", "D", "E", "F"];
const ZONES_Y = ["1", "2", "3", "4"];

function BlueprintDesign({ branding, children }: DesignProps) {
  const highlights = visibleHighlights(branding);
  return (
    <div className="keep-light relative isolate min-h-screen w-full overflow-hidden text-white" style={BLUEPRINT_PAPER}>
      {/* drawing-sheet border with zone references */}
      <div className="pointer-events-none absolute inset-3 -z-10 border border-white/45 sm:inset-5" aria-hidden>
        <div className="absolute inset-[10px] border border-white/25" />
        <div className="absolute inset-x-[10px] top-0 hidden h-[10px] justify-around sm:flex">
          {ZONES_X.map((z) => (
            <span key={z} className="font-mono text-[8px] leading-[10px] text-white/50">
              {z}
            </span>
          ))}
        </div>
        <div className="absolute inset-y-[10px] left-0 hidden w-[10px] flex-col items-center justify-around sm:flex">
          {ZONES_Y.map((z) => (
            <span key={z} className="font-mono text-[8px] text-white/50">
              {z}
            </span>
          ))}
        </div>
      </div>

      <div className="mx-auto grid min-h-screen w-full max-w-7xl items-center gap-10 px-6 pb-20 pt-12 sm:px-12 lg:grid-cols-[minmax(0,1fr)_400px] lg:px-16">
        <div className="hidden min-w-0 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)] lg:items-center lg:gap-6">
          <div className="min-w-0">
            <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-sky-100/60">Sheet 01 · General arrangement</p>
            <InlineHeadline
              branding={branding}
              className="mt-4 text-4xl font-semibold leading-[1.1] tracking-tight xl:text-[2.75rem]"
              highlightClassName="text-orange-300 underline decoration-orange-300/60 decoration-wavy decoration-1 underline-offset-[6px]"
            />
            <p className="mt-5 max-w-md text-[15px] leading-relaxed text-sky-50/70">{branding.loginSubheadline}</p>
            {highlights.length > 0 && (
              <div className="mt-10 max-w-md border border-white/30">
                <p className="border-b border-white/30 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.24em] text-sky-100/70">Notes</p>
                <ol className="divide-y divide-white/15">
                  {highlights.map((h, i) => (
                    <li key={i} className="flex gap-3 px-3 py-2.5">
                      <span className="font-mono text-xs text-orange-200">{i + 1}.</span>
                      <span className="min-w-0">
                        <span className="block font-mono text-xs uppercase tracking-[0.12em] text-white">{h.label}</span>
                        {h.description && <span className="block text-xs text-sky-100/60">{h.description}</span>}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
          <TowerElevation className="hidden max-h-[78vh] w-full xl:block" label={`ELEVATION — ${branding.shortName.toUpperCase()}`} />
        </div>

        <div className="mx-auto w-full max-w-[400px] border border-white/55 bg-[#0a2f5c]/85 shadow-[0_30px_80px_-30px_rgba(0,10,40,0.8)] backdrop-blur-sm">
          <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.6fr)] border-b border-white/40">
            <TitleCell label="Dwg no." value="SEL-AUTH-001" />
            <TitleCell label="Sheet" value="01 / 01" className="border-l border-white/40" />
            <TitleCell label="Rev" value="A" className="border-l border-white/40" />
          </div>
          <div className="px-6 py-8 sm:px-8">
            <LogoBlock branding={branding} surface="dark" className="mb-7 h-14 w-[55%]" />
            {children}
          </div>
          <BlueprintTitleFooter branding={branding} />
        </div>
      </div>

      <Copyright companyName={branding.companyName} className="absolute inset-x-0 bottom-6 font-mono text-sky-100/45 sm:bottom-8" />
    </div>
  );
}

// ─── Frame ───────────────────────────────────────────────────────────────────────────────────────

const DESIGNS = {
  horizon: HorizonDesign,
  midnight: MidnightDesign,
  glass: GlassDesign,
  minimal: MinimalDesign,
  blueprint: BlueprintDesign,
} satisfies Record<CompanyBranding["loginDesign"], (props: DesignProps) => ReactNode>;

/** The company's chosen sign-in design around `children`. */
export function LoginDesignFrame({ branding, children }: DesignProps) {
  useEdgeToEdge();
  const Design = DESIGNS[branding.loginDesign] ?? HorizonDesign;
  return <Design branding={branding}>{children}</Design>;
}

/**
 * The email-and-password step, drawn but inert — what Settings shows inside its preview of a
 * design. The real form, with its handlers, is in LoginPageContent.
 */
export function LoginFormSample({ branding }: { branding: CompanyBranding }) {
  const tone = LOGIN_TONES[branding.loginDesign] ?? LOGIN_TONES.horizon;
  return (
    <div className="w-full space-y-6">
      <div className="text-center">
        <h2 className={cn("text-xl font-semibold", tone.title)}>Welcome back</h2>
        <p className={cn("mt-1 text-sm", tone.subtitle)}>Sign in to your account</p>
      </div>
      <div className="w-full space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="sample-email" className={cn("text-sm font-medium", tone.label)}>
            Email
          </Label>
          <IconInput id="sample-email" tone={tone} icon={Mail} type="email" placeholder="you@example.com" readOnly tabIndex={-1} />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="sample-password" className={cn("text-sm font-medium", tone.label)}>
              Password
            </Label>
            <span className={cn("text-xs transition-colors", tone.link)}>Forgot password?</span>
          </div>
          <PasswordInput id="sample-password" tone={tone} value="" onChange={() => {}} />
        </div>
        <div className="flex items-center gap-2">
          <Checkbox id="sample-remember" className={tone.checkbox} tabIndex={-1} />
          <label htmlFor="sample-remember" className={cn("select-none text-sm", tone.checkLabel)}>
            Keep me signed in
          </label>
        </div>
        <Button type="button" tabIndex={-1} className={cn("w-full transition-all duration-200", tone.primaryButton)}>
          Sign In
        </Button>
        <OrDivider tone={tone} />
        <Button type="button" variant="outline" tabIndex={-1} className={cn("w-full gap-2 transition-all", tone.outlineButton)}>
          <GoogleIcon />
          Continue with Google
        </Button>
      </div>
    </div>
  );
}
