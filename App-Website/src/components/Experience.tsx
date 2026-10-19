import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { native } from '../data/api';
import { money } from '../utils';

export function reducedMotion() {
  return (
    localStorage.getItem('greenbiz-motion') === 'reduced' ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export type HapticKind = 'light' | 'selection' | 'success' | 'warning';
let lastHaptic = 0;
/** Gentle native feedback; silent on the web, when switched off, or if the device refuses. */
export function haptic(kind: HapticKind = 'light') {
  if (!native || localStorage.getItem('greenbiz-haptics') === 'off') return;
  const now = Date.now();
  if (kind !== 'success' && kind !== 'warning' && now - lastHaptic < 90) return;
  lastHaptic = now;
  const run =
    kind === 'success'
      ? Haptics.notification({ type: NotificationType.Success })
      : kind === 'warning'
        ? Haptics.notification({ type: NotificationType.Warning })
        : kind === 'selection'
          ? Haptics.selectionChanged()
          : Haptics.impact({ style: ImpactStyle.Light });
  void run.catch(() => {});
}

export type NavDirection = 'forward' | 'back' | 'tab';
type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => { finished: Promise<void> };
};
/**
 * Runs a navigation inside a native view transition when the WebView supports it.
 * The direction drives the CSS: sub-pages slide in, going back slides out, tabs cross-fade.
 */
export function transition(update: () => void, direction: NavDirection) {
  const doc = document as ViewTransitionDocument;
  if (!doc.startViewTransition || reducedMotion() || document.visibilityState !== 'visible') {
    update();
    return;
  }
  const root = document.documentElement;
  root.dataset.nav = direction;
  try {
    const running = doc.startViewTransition(() => flushSync(update));
    void running.finished.finally(() => {
      delete root.dataset.nav;
    });
  } catch {
    delete root.dataset.nav;
    update();
  }
}

export function AppExperience() {
  useEffect(() => {
    const root = document.documentElement;
    const update = () => {
      root.dataset.motion = reducedMotion() ? 'reduced' : 'full';
    };
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    update();
    media.addEventListener('change', update);
    window.addEventListener('greenbizExperience', update);
    const press = (event: PointerEvent) => {
      const target =
        event.target instanceof Element
          ? event.target.closest<HTMLButtonElement>(
              '.btn, .bottom-nav button, .chip, .sale-pick, .segments button, .toggle, .candidate',
            )
          : null;
      if (!target || target.disabled) return;
      haptic(target.matches('.chip, .segments button, .toggle') ? 'selection' : 'light');
    };
    // The top bar picks up a frosted background once the page scrolls under it.
    let frame = 0;
    const scrolled = (event: Event) => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const source = event.target instanceof Element ? event.target : document.scrollingElement;
        root.dataset.scrolled = (source?.scrollTop ?? 0) > 8 ? 'true' : 'false';
      });
    };
    const alert = () => haptic('warning');
    document.addEventListener('pointerdown', press, { passive: true });
    document.addEventListener('scroll', scrolled, { passive: true, capture: true });
    window.addEventListener('greenbizAlert', alert);
    return () => {
      media.removeEventListener('change', update);
      window.removeEventListener('greenbizExperience', update);
      document.removeEventListener('pointerdown', press);
      document.removeEventListener('scroll', scrolled, { capture: true });
      window.removeEventListener('greenbizAlert', alert);
      cancelAnimationFrame(frame);
    };
  }, []);
  return null;
}

/** Eased count from the previous value. Presentation only: saved values never depend on it. */
export function useCountUp(value: number, duration = 520) {
  const [shown, setShown] = useState(value),
    previous = useRef<number | null>(null);
  useEffect(() => {
    // First render counts up from zero; later changes count from the last value.
    const start = previous.current ?? 0;
    previous.current = value;
    if (reducedMotion() || start === value) {
      setShown(value);
      return;
    }
    let frame = 0,
      began = 0;
    const tick = (time: number) => {
      began ||= time;
      const progress = Math.min(1, (time - began) / duration);
      // Exponential ease-out: quick start, long gentle settle.
      const eased = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
      setShown(start + (value - start) * eased);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, duration]);
  return shown;
}

export function AnimatedMoney({ value }: { value: number }) {
  const shown = useCountUp(value, 620);
  return (
    <span className="tabular" aria-label={money(value)}>
      {money(shown)}
    </span>
  );
}

export function AnimatedNumber({ value, duration = 700 }: { value: number; duration?: number }) {
  const shown = useCountUp(value, duration);
  return (
    <span className="tabular" aria-label={String(value)}>
      {Math.round(shown)}
    </span>
  );
}
