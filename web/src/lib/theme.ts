// Light / Dark / System appearance, per device. The resolved theme is applied before first paint by
// public/theme-boot.js; this module keeps it in sync afterwards. Changing theme never reloads media,
// submits, cancels or touches drafts — it only flips attributes on <html>.
export type ThemePref = "light" | "dark" | "system";
export type MotionPref = "system" | "reduced";

const KEY = "ll.theme";
const MOTION_KEY = "ll.motion";
const SCALE_KEY = "ll.textScale";
const SCALES = [100, 112.5, 125, 150, 200] as const;

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Returns false when the preference could not be persisted (private mode / storage blocked). */
function write(key: string, value: string): boolean {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function systemPrefersDark(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function resolveTheme(pref: ThemePref): "light" | "dark" {
  return pref === "system" ? (systemPrefersDark() ? "dark" : "light") : pref;
}

export function getThemePref(): ThemePref {
  const fromDom = document.documentElement.dataset.themePref;
  const value = fromDom ?? read(KEY);
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

export function applyTheme(pref: ThemePref): { persisted: boolean } {
  const root = document.documentElement;
  root.dataset.themePref = pref;
  root.dataset.theme = resolveTheme(pref);
  return { persisted: write(KEY, pref) };
}

/** Follow OS changes while the preference is System. Returns an unsubscribe function. */
export function watchSystemTheme(onChange: () => void): () => void {
  if (typeof window.matchMedia !== "function") return () => undefined;
  const query = window.matchMedia("(prefers-color-scheme: dark)");
  const handler = () => {
    if (getThemePref() === "system") {
      document.documentElement.dataset.theme = resolveTheme("system");
      onChange();
    }
  };
  query.addEventListener("change", handler);
  return () => query.removeEventListener("change", handler);
}

export function getMotionPref(): MotionPref {
  return read(MOTION_KEY) === "reduced" ? "reduced" : "system";
}

export function applyMotion(pref: MotionPref): { persisted: boolean } {
  if (pref === "reduced") document.documentElement.dataset.motion = "reduced";
  else delete document.documentElement.dataset.motion;
  return { persisted: write(MOTION_KEY, pref) };
}

export function getTextScale(): number {
  const value = Number(read(SCALE_KEY));
  return (SCALES as readonly number[]).includes(value) ? value : 100;
}

export function applyTextScale(percent: number): { persisted: boolean } {
  const value = (SCALES as readonly number[]).includes(percent) ? percent : 100;
  document.documentElement.style.fontSize = value === 100 ? "" : `${value}%`;
  if (value >= 150) document.documentElement.dataset.textScale = "large";
  else delete document.documentElement.dataset.textScale;
  return { persisted: write(SCALE_KEY, String(value)) };
}

export const TEXT_SCALES = SCALES;
