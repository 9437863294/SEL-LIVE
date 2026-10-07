import type { LoginDesignId } from '@/lib/appearance/model';

/**
 * The class sets a sign-in form is drawn with, one per surface it can sit on. Every design keeps
 * its own fixed palette whatever the light/dark mode — each design root carries `keep-light` so
 * dark-compat.css leaves these hardcoded colours alone.
 */
export interface LoginTone {
  title: string;
  subtitle: string;
  label: string;
  faint: string;
  strong: string;
  input: string;
  inputError: string;
  inputIcon: string;
  eyeButton: string;
  error: string;
  link: string;
  primaryButton: string;
  outlineButton: string;
  ghostButton: string;
  divider: string;
  checkbox: string;
  checkLabel: string;
  profileCard: string;
  profileName: string;
  avatarRing: string;
  avatarFallback: string;
  successBadge: string;
  infoBadge: string;
  recaptcha: 'dark' | 'light';
}

const midnight: LoginTone = {
  title: 'text-white',
  subtitle: 'text-slate-400',
  label: 'text-slate-300',
  faint: 'text-slate-500',
  strong: 'font-medium text-slate-200',
  input:
    'border-white/10 bg-slate-900/40 text-slate-100 placeholder:text-slate-500 focus-visible:border-primary/50 focus-visible:ring-primary/60 focus-visible:ring-offset-0',
  inputError: 'border-rose-500/60 focus-visible:ring-rose-500/30',
  inputIcon: 'text-slate-400',
  eyeButton: 'text-slate-400 hover:text-slate-200',
  error: 'text-rose-400',
  link: 'text-cyan-400/80 hover:text-cyan-300',
  primaryButton: 'bg-primary text-white shadow-lg shadow-primary/25 hover:bg-primary/90',
  outlineButton: 'border-white/10 bg-slate-900/40 text-slate-200 hover:border-white/20 hover:bg-slate-800/60 hover:text-slate-100',
  ghostButton: 'text-slate-400 hover:bg-white/5 hover:text-slate-100',
  divider: 'border-white/10',
  checkbox: 'border-slate-500',
  checkLabel: 'text-slate-300',
  profileCard: 'border-white/10 bg-slate-900/30 hover:border-cyan-400/30 hover:bg-slate-800/50',
  profileName: 'text-slate-100',
  avatarRing: 'ring-white/10 group-hover:ring-cyan-400/40',
  avatarFallback: 'bg-slate-800 text-cyan-300',
  successBadge: 'bg-emerald-500/15 text-emerald-400 ring-emerald-400/30',
  infoBadge: 'bg-cyan-500/15 text-cyan-400 ring-cyan-400/30',
  recaptcha: 'dark',
};

const light: LoginTone = {
  title: 'text-slate-900',
  subtitle: 'text-slate-500',
  label: 'text-slate-700',
  faint: 'text-slate-400',
  strong: 'font-medium text-slate-800',
  input:
    'border-slate-200 bg-white text-slate-900 shadow-sm placeholder:text-slate-400 focus-visible:border-primary focus-visible:ring-primary/20 focus-visible:ring-offset-0',
  inputError: 'border-rose-400 focus-visible:border-rose-500 focus-visible:ring-rose-500/20',
  inputIcon: 'text-slate-400',
  eyeButton: 'text-slate-400 hover:text-slate-700',
  error: 'text-rose-600',
  link: 'font-medium text-primary hover:text-primary/80',
  primaryButton: 'bg-primary text-primary-foreground shadow-md shadow-primary/20 hover:bg-primary/90',
  outlineButton: 'border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-50 hover:text-slate-900',
  ghostButton: 'text-slate-500 hover:bg-slate-100 hover:text-slate-900',
  divider: 'border-slate-200',
  checkbox: 'border-slate-300 data-[state=checked]:border-primary',
  checkLabel: 'text-slate-600',
  profileCard: 'border-slate-200 bg-white shadow-sm hover:border-primary/40 hover:bg-slate-50',
  profileName: 'text-slate-800',
  avatarRing: 'ring-slate-100 group-hover:ring-primary/30',
  avatarFallback: 'bg-slate-100 text-slate-700',
  successBadge: 'bg-emerald-50 text-emerald-600 ring-emerald-200',
  infoBadge: 'bg-primary/10 text-primary ring-primary/20',
  recaptcha: 'light',
};

const glass: LoginTone = {
  ...midnight,
  subtitle: 'text-white/60',
  label: 'text-white/75',
  faint: 'text-white/40',
  strong: 'font-medium text-white',
  input:
    'border-white/15 bg-white/[0.06] text-white placeholder:text-white/35 focus-visible:border-white/40 focus-visible:ring-white/20 focus-visible:ring-offset-0',
  inputIcon: 'text-white/45',
  eyeButton: 'text-white/45 hover:text-white',
  error: 'text-rose-300',
  link: 'text-white/70 hover:text-white',
  primaryButton:
    'bg-gradient-to-r from-violet-500 via-fuchsia-500 to-rose-500 text-white shadow-lg shadow-fuchsia-500/25 hover:brightness-110',
  outlineButton: 'border-white/15 bg-white/[0.06] text-white hover:border-white/25 hover:bg-white/10 hover:text-white',
  ghostButton: 'text-white/55 hover:bg-white/10 hover:text-white',
  divider: 'border-white/15',
  checkbox: 'border-white/40 data-[state=checked]:border-fuchsia-400 data-[state=checked]:bg-fuchsia-500',
  checkLabel: 'text-white/70',
  profileCard: 'border-white/15 bg-white/[0.06] hover:border-white/30 hover:bg-white/10',
  profileName: 'text-white',
  avatarRing: 'ring-white/15 group-hover:ring-fuchsia-300/50',
  avatarFallback: 'bg-white/10 text-white',
  infoBadge: 'bg-fuchsia-500/15 text-fuchsia-300 ring-fuchsia-300/30',
};

/** Frosted glass over the dusk sky: Glass's surfaces, warm dusk accents, the company's own button. */
const horizon: LoginTone = {
  ...glass,
  input:
    'border-white/15 bg-white/[0.06] text-white placeholder:text-white/35 focus-visible:border-amber-200/50 focus-visible:ring-amber-200/20 focus-visible:ring-offset-0',
  link: 'text-amber-200/90 hover:text-amber-100',
  primaryButton: midnight.primaryButton,
  checkbox: 'border-white/40 data-[state=checked]:border-primary',
  avatarRing: 'ring-white/15 group-hover:ring-amber-200/50',
  infoBadge: 'bg-amber-400/15 text-amber-200 ring-amber-200/30',
};

const blueprint: LoginTone = {
  ...midnight,
  title: 'text-white font-mono uppercase tracking-[0.12em]',
  subtitle: 'text-sky-100/65',
  label: 'font-mono text-[11px] uppercase tracking-[0.18em] text-sky-100/80',
  faint: 'font-mono text-sky-100/45',
  strong: 'font-medium text-white',
  input:
    'rounded-none border-white/35 bg-[#0a2c57]/60 font-mono text-white placeholder:text-sky-100/35 focus-visible:border-white focus-visible:ring-white/25 focus-visible:ring-offset-0',
  inputError: 'border-orange-300 focus-visible:ring-orange-300/30',
  inputIcon: 'text-sky-100/55',
  eyeButton: 'text-sky-100/55 hover:text-white',
  error: 'font-mono text-orange-300',
  link: 'font-mono text-[11px] uppercase tracking-[0.12em] text-orange-200 hover:text-orange-100',
  primaryButton: 'rounded-none bg-white font-mono uppercase tracking-[0.2em] text-[#0b3a75] hover:bg-sky-50',
  outlineButton: 'rounded-none border-white/35 bg-transparent text-white hover:border-white/60 hover:bg-white/10 hover:text-white',
  ghostButton: 'rounded-none font-mono text-sky-100/60 hover:bg-white/10 hover:text-white',
  divider: 'border-dashed border-white/30',
  checkbox: 'rounded-none border-white/50 data-[state=checked]:border-white data-[state=checked]:bg-white data-[state=checked]:text-[#0b3a75]',
  checkLabel: 'text-sky-100/80',
  profileCard: 'rounded-none border-white/30 bg-[#0a2c57]/50 hover:border-white/60 hover:bg-white/10',
  profileName: 'text-white',
  avatarRing: 'ring-white/30 group-hover:ring-white/60',
  avatarFallback: 'bg-[#0a2c57] font-mono text-white',
  successBadge: 'bg-white/10 text-emerald-200 ring-emerald-200/40',
  infoBadge: 'bg-white/10 text-white ring-white/40',
};

export const LOGIN_TONES: Record<LoginDesignId, LoginTone> = {
  horizon,
  midnight,
  glass,
  minimal: light,
  blueprint,
};
