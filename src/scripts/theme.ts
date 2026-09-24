/**
 * Theme helpers — pure (no DOM dependency on import), so they're
 * unit-testable. Pass in the `storage` and `document` you want to
 * exercise; defaults are the browser globals.
 *
 * Theme state lives in two places:
 *   1. localStorage key "random-tools:theme" — explicit user override
 *      ('dark' | 'light'). Absence means "follow system".
 *   2. <html data-theme="dark|light">       — drives tokens.css.
 *
 * The inline boot script in Base.astro applies the resolved theme
 * *before* paint to avoid a flash of wrong theme. This module is the
 * testable surface for that logic; it also backs the Svelte toggle.
 */

export type Theme = "dark" | "light";

export const THEME_STORAGE_KEY = "random-tools:theme";

/* ------------------------------------------------------------------ */
/* storage adapter — defaults to localStorage, swappable for tests.   */
/* ------------------------------------------------------------------ */

export interface ThemeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const defaultStorage: ThemeStorage = {
  getItem: (key) =>
    typeof localStorage !== "undefined" ? localStorage.getItem(key) : null,
  setItem: (key, value) => {
    if (typeof localStorage !== "undefined") localStorage.setItem(key, value);
  },
};

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

/** Read the stored user override, or null if none. */
export function getStoredTheme(storage: ThemeStorage = defaultStorage): Theme | null {
  const raw = storage.getItem(THEME_STORAGE_KEY);
  return raw === "dark" || raw === "light" ? raw : null;
}

/** SSR-safe system preference. */
export function getSystemTheme(): Theme {
  if (typeof window === "undefined" || !window.matchMedia) return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

/** Resolve the active theme (stored override, falling back to system). */
export function resolveTheme(storage: ThemeStorage = defaultStorage): Theme {
  return getStoredTheme(storage) ?? getSystemTheme();
}

/** Write the explicit override. Pass null to clear it. */
export function setStoredTheme(
  theme: Theme | null,
  storage: ThemeStorage = defaultStorage,
): void {
  if (theme === null) {
    if (typeof localStorage !== "undefined") localStorage.removeItem(THEME_STORAGE_KEY);
    return;
  }
  storage.setItem(THEME_STORAGE_KEY, theme);
}

/** Set <html data-theme="..."> so tokens.css picks the right palette. */
export function applyTheme(
  theme: Theme,
  doc: Document = typeof document !== "undefined" ? document : (undefined as unknown as Document),
): void {
  if (!doc || !doc.documentElement) return;
  doc.documentElement.setAttribute("data-theme", theme);
}