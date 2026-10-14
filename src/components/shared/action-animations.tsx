'use client';

/**
 * Animated action buttons — the engine.
 *
 * `ActionAnimationProvider` is mounted once in the signed-in app shell. It:
 *   1. listens (capture phase, passively — it never prevents or delays anything) for clicks on
 *      buttons, `[role="button"]` and links styled as buttons, works out the action kind (the
 *      `action` prop / `data-action`, else the label, else the variant) and plays that kind's
 *      press effect on it;
 *   2. remembers the last pressed action for 8 seconds; when a toast appears in that window
 *      (`onToastAdded` in use-toast) it plays the completion effect — or, for a destructive toast or
 *      one whose title reads as a failure, the failure effect — on that button;
 *   3. does nothing at all under reduced motion (the device's, or Appearance › Motion "Reduced"),
 *      when the company turned animations off, or when the user chose Off.
 *
 * Effects only animate transform, opacity and box-shadow of the button itself, or draw into a fixed
 * `pointer-events: none` layer appended to <body> over it, which is removed when it ends — so no
 * layout ever moves and no click is ever caught. Overlay styles: src/styles/action-animations.css.
 *
 * Opting out: `<Button action={false}>`, `data-action="false"` on any element, or
 * `data-action-animations="off"` on a container. Naming the kind: `<Button action="approve">`.
 */

import { useCallback, useEffect, useRef } from 'react';
import { useCompanyProfile } from '@/hooks/use-company-profile';
import { onToastAdded, type AddedToast } from '@/hooks/use-toast';
import { useAppearance } from '@/components/theme/ThemeProvider';
import {
  DEFAULT_ACTION_ANIMATIONS,
  INTENSITY_SCALE,
  inferActionKind,
  looksLikeFailure,
  resolveActionAnimations,
  type ActionAnimationSettings,
  type ActionKind,
  type ActionKindConfig,
} from '@/lib/action-animations';

export type ActionAnimationPhase = 'press' | 'complete' | 'failure';

export interface PlayOptions {
  /** Play this configuration instead of the effective one (Settings' "Try it"). */
  config?: ActionKindConfig;
  /** Play even when animations are switched off or the kind is disabled (still never under reduced motion). */
  force?: boolean;
  /** Where the press happened, in viewport pixels, for the ripple. */
  point?: { x: number; y: number };
}

// ── Module state: what applies, set by the provider, read by every play ─────────────────────────

let effective: ActionAnimationSettings = DEFAULT_ACTION_ANIMATIONS;
let companyLabels: Partial<Record<string, string>> | null = null;

const PENDING_MS = 8000;
const MAX_LAYERS = 10;
let pending: { element: HTMLElement; kind: ActionKind; rect: DOMRect; at: number } | null = null;
let liveLayers = 0;

const SELECTOR = 'button, [role="button"], a[data-size], a[data-action]';
const SKIP_ROLES = new Set(['tab', 'switch', 'checkbox', 'radio', 'combobox', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'slider', 'treeitem']);
const CONFETTI = ['#f59e0b', '#10b981', '#3b82f6', '#ec4899', '#8b5cf6', '#ef4444'];
const CHECK_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

/** The device or the user asked for less motion. */
export function isMotionReduced(): boolean {
  if (typeof window === 'undefined') return true;
  if (document.documentElement.dataset.motion === 'reduced') return true;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** The settings in force for this user (company defaults with their override applied). */
export function getActionAnimationSettings(): ActionAnimationSettings {
  return effective;
}

/** The kind an element performs: its `data-action`, else its label, else its variant. */
export function actionKindOf(element: Element): ActionKind {
  const html = element as HTMLElement;
  const label = html.getAttribute('aria-label') || (html.textContent ?? '').trim().slice(0, 80) || html.getAttribute('title') || '';
  return inferActionKind({ label, variant: html.dataset?.buttonVariant, explicit: html.dataset?.action, labels: companyLabels });
}

/** The action element a click landed on, or null when it is not one (or opted out, or disabled). */
function actionTarget(start: EventTarget | null): HTMLElement | null {
  if (!(start instanceof Element)) return null;
  const element = start.closest(SELECTOR) as HTMLElement | null;
  if (!element) return null;
  const role = element.getAttribute('role');
  if (role && SKIP_ROLES.has(role)) return null;
  if (element.dataset.action === 'false') return null;
  if ((element as HTMLButtonElement).disabled || element.getAttribute('aria-disabled') === 'true') return null;
  if (element.closest('[data-action-animations="off"]')) return null;
  return element;
}

// ── Colours ──────────────────────────────────────────────────────────────────────────────────────

/** [r, g, b, a] from a computed `rgb()` / `rgba()` string. */
function parseRgb(color: string): [number, number, number, number] | null {
  const match = /rgba?\(([^)]+)\)/.exec(color);
  if (!match) return null;
  const parts = match[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  if (parts.length < 3 || parts.slice(0, 3).some((n) => !Number.isFinite(n))) return null;
  return [parts[0], parts[1], parts[2], Number.isFinite(parts[3]) ? parts[3] : 1];
}

const rgba = (rgb: [number, number, number, number], alpha: number) => `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;

/** A theme token (`--primary`, stored as "h s% l%") at an alpha. */
function token(name: string, alpha = 1): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
  if (!value) return alpha >= 1 ? '#7c3aed' : `rgba(124, 58, 237, ${alpha})`;
  if (value.startsWith('#') || value.startsWith('rgb') || value.startsWith('hsl')) return value;
  return `hsl(${value} / ${alpha})`;
}

/** The element's own fill when it has a solid one (a filled button), else null (outline / ghost / link). */
function solidFill(element: HTMLElement): [number, number, number, number] | null {
  const rgb = parseRgb(getComputedStyle(element).backgroundColor);
  return rgb && rgb[3] >= 0.6 ? rgb : null;
}

function accent(element: HTMLElement | null, alpha: number): string {
  const fill = element ? solidFill(element) : null;
  return fill ? rgba(fill, alpha) : token('primary', alpha);
}

// ── Overlays ─────────────────────────────────────────────────────────────────────────────────────

function layer(rect: DOMRect, radius: string, clip: boolean, lifetime: number): HTMLDivElement | null {
  if (liveLayers >= MAX_LAYERS || !document.body) return null;
  const div = document.createElement('div');
  div.className = clip ? 'aa-layer aa-clip' : 'aa-layer';
  div.setAttribute('aria-hidden', 'true');
  div.style.left = `${rect.left}px`;
  div.style.top = `${rect.top}px`;
  div.style.width = `${rect.width}px`;
  div.style.height = `${rect.height}px`;
  div.style.borderRadius = radius;
  document.body.appendChild(div);
  liveLayers += 1;
  window.setTimeout(() => {
    div.remove();
    liveLayers -= 1;
  }, lifetime + 120);
  return div;
}

function ripple(element: HTMLElement, rect: DOMRect, radius: string, duration: number, scale: number, point?: { x: number; y: number }) {
  const host = layer(rect, radius, true, duration);
  if (!host) return;
  const size = Math.max(rect.width, rect.height) * 2.2;
  const x = point && point.x >= rect.left && point.x <= rect.right ? point.x - rect.left : rect.width / 2;
  const y = point && point.y >= rect.top && point.y <= rect.bottom ? point.y - rect.top : rect.height / 2;
  const dot = document.createElement('span');
  dot.className = 'aa-ripple';
  dot.style.width = dot.style.height = `${size}px`;
  dot.style.left = `${x - size / 2}px`;
  dot.style.top = `${y - size / 2}px`;
  const text = parseRgb(getComputedStyle(element).color);
  dot.style.setProperty('--aa-color', text ? rgba(text, 1) : 'currentColor');
  dot.style.setProperty('--aa-alpha', String(Math.min(0.5, 0.22 * scale + 0.08)));
  dot.style.setProperty('--aa-dur', `${duration}ms`);
  host.appendChild(dot);
}

function cover(rect: DOMRect, radius: string, duration: number, className: string, html = ''): HTMLSpanElement | null {
  const host = layer(rect, radius, true, duration);
  if (!host) return null;
  const span = document.createElement('span');
  span.className = `aa-cover ${className}`;
  span.style.setProperty('--aa-dur', `${duration}ms`);
  if (html) span.innerHTML = html;
  host.appendChild(span);
  return span;
}

function check(element: HTMLElement | null, rect: DOMRect, radius: string, duration: number) {
  const span = cover(rect, radius, duration, 'aa-check', CHECK_SVG);
  if (!span) return;
  const fill = element ? solidFill(element) : null;
  span.style.setProperty('--aa-bg', fill ? rgba(fill, 1) : token('success'));
  const text = element && fill ? parseRgb(getComputedStyle(element).color) : null;
  span.style.setProperty('--aa-fg', text ? rgba(text, 1) : '#ffffff');
  // The tick's size follows the button's text size.
  if (element) span.style.fontSize = getComputedStyle(element).fontSize;
}

function particles(element: HTMLElement | null, rect: DOMRect, duration: number, scale: number, confetti: boolean) {
  const host = layer(rect, '0', false, duration);
  if (!host) return;
  const count = Math.min(12, Math.round((confetti ? 8 : 6) + 4 * (scale - 0.6)));
  const reach = Math.max(18, Math.min(60, Math.max(rect.width, rect.height) * 0.45)) * (0.7 + 0.3 * scale);
  for (let i = 0; i < count; i += 1) {
    const angle = (Math.PI * 2 * i) / count + (confetti ? Math.random() * 0.5 : 0);
    const distance = reach * (confetti ? 0.8 + Math.random() * 0.6 : 1);
    const dot = document.createElement('span');
    dot.className = confetti ? 'aa-particle aa-confetti' : 'aa-particle';
    dot.style.setProperty('--aa-dx', `${Math.round(Math.cos(angle) * distance + rect.width * 0.5 * Math.cos(angle))}px`);
    // Confetti drifts down a little as it spreads.
    dot.style.setProperty('--aa-dy', `${Math.round(Math.sin(angle) * distance * 0.75 + (confetti ? distance * 0.35 : 0))}px`);
    dot.style.setProperty('--aa-size', `${Math.round((confetti ? 8 : 5) * (0.8 + 0.25 * scale))}px`);
    dot.style.setProperty('--aa-color', confetti ? CONFETTI[i % CONFETTI.length] : accent(element, 0.9));
    dot.style.setProperty('--aa-rot', `${Math.round(180 + Math.random() * 360)}deg`);
    dot.style.setProperty('--aa-dur', `${duration}ms`);
    host.appendChild(dot);
  }
}

// ── Element effects (transform / opacity / box-shadow only) ─────────────────────────────────────

function animate(target: Element, keyframes: Keyframe[], duration: number, easing = 'ease-out') {
  if (typeof (target as HTMLElement).animate !== 'function') return;
  try {
    (target as HTMLElement).animate(keyframes, { duration, easing });
  } catch {
    // An unsupported keyframe is simply not played.
  }
}

function baseShadow(element: HTMLElement): string {
  const shadow = getComputedStyle(element).boxShadow;
  return shadow && shadow !== 'none' ? shadow : '0 0 0 0 rgba(0, 0, 0, 0)';
}

function slideVector(kind: ActionKind, scale: number): [number, number] {
  const d = Math.round(10 + 6 * scale);
  if (kind === 'upload') return [0, -d];
  if (kind === 'download' || kind === 'export') return [0, d];
  return [d, 0];
}

function play(
  element: HTMLElement | null,
  rect: DOMRect,
  kind: ActionKind,
  effect: string,
  duration: number,
  scale: number,
  point?: { x: number; y: number },
): boolean {
  const live = element && element.isConnected ? element : null;
  const radius = live ? getComputedStyle(live).borderRadius : '0.375rem';
  switch (effect) {
    case 'press':
      if (!live) return false;
      animate(live, [{ transform: 'scale(1)' }, { transform: `scale(${1 - 0.05 * scale})`, offset: 0.35 }, { transform: 'scale(1)' }], duration);
      return true;
    case 'bounce':
      if (!live) return false;
      animate(live, [
        { transform: 'scale(1)' },
        { transform: `scale(${1 - 0.07 * scale})`, offset: 0.3 },
        { transform: `scale(${1 + 0.04 * scale})`, offset: 0.65 },
        { transform: 'scale(1)' },
      ], duration, 'ease-in-out');
      return true;
    case 'pop':
      if (!live) return false;
      animate(live, [{ transform: 'scale(1)' }, { transform: `scale(${1 + 0.07 * scale})`, offset: 0.4 }, { transform: 'scale(1)' }], duration);
      return true;
    case 'shake': {
      if (!live) return false;
      const a = Math.round(3 + 4 * scale);
      animate(live, [0, -a, a, -a * 0.7, a * 0.7, -a * 0.35, 0].map((x) => ({ transform: `translateX(${x}px)` })), duration, 'ease-in-out');
      return true;
    }
    case 'fade':
      if (!live) return false;
      animate(live, [{ opacity: 1 }, { opacity: Math.max(0.2, 1 - 0.45 * scale), offset: 0.4 }, { opacity: 1 }], duration, 'ease-in-out');
      return true;
    case 'glow': {
      if (!live) return false;
      const base = baseShadow(live);
      const glow = `0 0 0 ${Math.round(3 * scale + 1)}px ${accent(live, 0.3)}, 0 0 ${Math.round(14 * scale + 4)}px ${accent(live, 0.4)}`;
      animate(live, [{ boxShadow: base }, { boxShadow: `${glow}, ${base}`, offset: 0.35 }, { boxShadow: base }], duration);
      return true;
    }
    case 'pulse': {
      if (!live) return false;
      const base = baseShadow(live);
      animate(live, [
        { boxShadow: `0 0 0 0 ${accent(live, 0.45)}, ${base}` },
        { boxShadow: `0 0 0 ${Math.round(6 + 6 * scale)}px ${accent(live, 0)}, ${base}` },
      ], duration);
      return true;
    }
    case 'ripple':
      if (!live) return false;
      ripple(live, rect, radius, duration, scale, point);
      return true;
    case 'slide': {
      const [dx, dy] = slideVector(kind, scale);
      const icon = live?.querySelector('svg');
      if (icon) {
        animate(icon, [
          { transform: 'translate(0, 0)', opacity: 1 },
          { transform: `translate(${dx}px, ${dy}px)`, opacity: 0, offset: 0.45 },
          { transform: `translate(${-dx}px, ${-dy}px)`, opacity: 0, offset: 0.55 },
          { transform: 'translate(0, 0)', opacity: 1 },
        ], duration, 'ease-in-out');
        return true;
      }
      if (!live) return false;
      animate(live, [{ transform: 'translate(0, 0)' }, { transform: `translate(${dx * 0.3}px, ${dy * 0.3}px)`, offset: 0.4 }, { transform: 'translate(0, 0)' }], duration);
      return true;
    }
    case 'check':
      check(live, rect, radius, duration);
      return true;
    case 'check-burst':
      check(live, rect, radius, duration);
      particles(live, rect, duration, scale, false);
      return true;
    case 'burst':
      particles(live, rect, duration, scale, false);
      return true;
    case 'confetti-lite':
      particles(live, rect, duration, scale, true);
      return true;
    case 'flash': {
      const span = cover(rect, radius, duration, 'aa-flash');
      span?.style.setProperty('--aa-alpha', String(Math.min(0.7, 0.25 + 0.2 * scale)));
      return Boolean(span);
    }
    default:
      return false;
  }
}

/**
 * Play one phase of an action's animation on `element`. Returns whether anything played (false
 * under reduced motion, when switched off, or for the effect "none"). Safe to call anywhere; it
 * never throws and never changes layout.
 */
export function playActionAnimation(element: HTMLElement | null, kind: ActionKind, phase: ActionAnimationPhase, options: PlayOptions = {}): boolean {
  if (!element || typeof window === 'undefined' || isMotionReduced()) return false;
  const settings = effective;
  if (!options.force && !settings.enabled) return false;
  const config = options.config ?? settings.kinds[kind];
  if (!config || (!options.force && !config.enabled)) return false;
  const effect = phase === 'press' ? config.press : phase === 'complete' ? config.complete : config.failure;
  if (effect === 'none') return false;
  const duration = phase === 'press' ? Math.max(150, Math.round(config.durationMs * 0.5)) : config.durationMs;
  try {
    const rect = element.isConnected ? element.getBoundingClientRect() : pending?.element === element ? pending.rect : null;
    // An explicit completion means the toast that follows must not play it again.
    if (phase !== 'press' && pending?.element === element) pending = null;
    if (!rect || (!rect.width && !rect.height)) return false;
    return play(element, rect, kind, effect, duration, INTENSITY_SCALE[config.intensity] ?? 1, options.point);
  } catch {
    return false;
  }
}

function settle(toast: AddedToast) {
  const last = pending;
  if (!last || Date.now() - last.at > PENDING_MS) return;
  pending = null;
  const title = typeof toast.title === 'string' ? toast.title : '';
  const failed = toast.variant === 'destructive' || looksLikeFailure(title);
  const phase: ActionAnimationPhase = failed ? 'failure' : 'complete';
  window.requestAnimationFrame(() => {
    if (isMotionReduced() || !effective.enabled) return;
    const config = effective.kinds[last.kind];
    if (!config?.enabled) return;
    const effect = phase === 'complete' ? config.complete : config.failure;
    if (effect === 'none') return;
    // The button may have gone with its dialog: overlay effects still play where it was.
    const rect = last.element.isConnected ? last.element.getBoundingClientRect() : last.rect;
    try {
      play(last.element, rect, last.kind, effect, config.durationMs, INTENSITY_SCALE[config.intensity] ?? 1);
    } catch {
      // Never let an animation break a toast.
    }
  });
}

function onActivate(element: HTMLElement, point?: { x: number; y: number }) {
  const kind = actionKindOf(element);
  pending = { element, kind, rect: element.getBoundingClientRect(), at: Date.now() };
  playActionAnimation(element, kind, 'press', { point });
}

/** Mount once, in the signed-in app shell. Renders nothing. */
export function ActionAnimationProvider() {
  const { profile } = useCompanyProfile();
  const { preferences } = useAppearance();
  const company = profile.design.animations;
  const own = preferences.animations;
  const labels = profile.labels;

  useEffect(() => {
    effective = resolveActionAnimations(company, own);
    companyLabels = labels;
  }, [company, own, labels]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const element = actionTarget(event.target);
      if (!element) return;
      // detail 0: a keyboard (or programmatic) click — the ripple starts from the middle.
      onActivate(element, event.detail > 0 ? { x: event.clientX, y: event.clientY } : undefined);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const element = actionTarget(event.target);
      // Native buttons and links fire a click for the key; only role="button" elements may not.
      if (!element || element.tagName === 'BUTTON' || element.tagName === 'A' || event.repeat) return;
      onActivate(element);
    };
    document.addEventListener('click', onClick, { capture: true, passive: true });
    document.addEventListener('keydown', onKey, { capture: true, passive: true });
    const unsubscribe = onToastAdded(settle);
    return () => {
      document.removeEventListener('click', onClick, { capture: true });
      document.removeEventListener('keydown', onKey, { capture: true });
      unsubscribe();
      pending = null;
    };
  }, []);

  return null;
}

/**
 * Explicit control, for actions that finish without a toast:
 *
 *   const save = useActionAnimation<HTMLButtonElement>('save');
 *   <Button ref={save.ref} action="save" …>
 *   … await work; save.play('complete');   // or save.play('failure')
 */
export function useActionAnimation<T extends HTMLElement = HTMLElement>(kind?: ActionKind) {
  const ref = useRef<T | null>(null);
  const playPhase = useCallback(
    (phase: ActionAnimationPhase, options?: PlayOptions & { kind?: ActionKind }) => {
      const element = ref.current;
      if (!element) return false;
      return playActionAnimation(element, options?.kind ?? kind ?? actionKindOf(element), phase, options);
    },
    [kind],
  );
  return { ref, play: playPhase, playOn: playActionAnimation };
}
