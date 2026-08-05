// Lightweight, dependency-free i18n for the studio front-end.
//
// Design: the ENGLISH string is the key. `t("Settings")` looks the string up in
// the active locale's dictionary and falls back to the English key when there's
// no translation — so the app is always readable even before a string is
// translated, and wiring a new string is just wrapping it in `t(...)`. No key
// invention, no key collisions, no drift between a key file and the JSX.
//
// - Preference lives in localStorage under "locale" (per browser, like theme),
//   defaults to the browser language when it's one we ship, else English.
// - `<html lang>` is kept in sync so the platform (spellcheck, screen readers)
//   knows the page language.
// - Interpolation: `t("Rendered {count} shots", { count: 3 })` replaces `{name}`
//   tokens. A missing var is left as the literal token.
//
// Two ways to translate:
//   • `const t = useT();` inside a component — re-renders when the locale flips.
//   • `import { t } from "@/lib/i18n"` in plain helpers / event handlers — reads
//     the live locale but does NOT subscribe (fine for strings built at call
//     time, e.g. a toast message).
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { es } from "./locales/es.js";

// The locales we ship, in menu order. English is the source language (no dict).
export const LOCALES = [
  { id: "en", label: "English", nativeLabel: "English" },
  { id: "es", label: "Spanish", nativeLabel: "Español" },
];

const DICTS = { es };
const STORAGE_KEY = "locale";
const DEFAULT_LOCALE = "en";

function isSupported(id) {
  return LOCALES.some((l) => l.id === id);
}

// First run: honour a stored choice, else the browser's language, else English.
export function detectLocale() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && isSupported(stored)) return stored;
  } catch {
    /* storage may be unavailable (private mode) — fall through */
  }
  try {
    const nav = (navigator.language || "").slice(0, 2).toLowerCase();
    if (isSupported(nav)) return nav;
  } catch {
    /* no navigator (SSR/tests) */
  }
  return DEFAULT_LOCALE;
}

// Interpolate `{token}` placeholders from `vars`.
function interpolate(str, vars) {
  if (!vars) return str;
  return str.replace(/\{(\w+)\}/g, (m, k) =>
    Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m
  );
}

// Core lookup — pure, locale passed in.
export function translate(locale, str, vars) {
  const dict = DICTS[locale];
  const hit = dict && Object.prototype.hasOwnProperty.call(dict, str) ? dict[str] : str;
  return interpolate(hit, vars);
}

// Module-scoped live locale, kept fresh by the provider so the standalone `t`
// (used outside React, in helpers/handlers) sees the current choice.
let currentLocale = DEFAULT_LOCALE;
export function getLocale() {
  return currentLocale;
}

// Standalone translator for non-component code. Does NOT trigger re-renders —
// use `useT()` inside components so they repaint when the locale changes.
export function t(str, vars) {
  return translate(currentLocale, str, vars);
}

const I18nContext = createContext({
  locale: DEFAULT_LOCALE,
  setLocale: () => {},
});

export function I18nProvider({ children }) {
  const [locale, setLocaleState] = useState(detectLocale);

  // Keep the module-level locale, <html lang> and the DOM in sync.
  useEffect(() => {
    currentLocale = locale;
    try {
      document.documentElement.lang = locale;
    } catch {
      /* no document (tests) */
    }
  }, [locale]);

  const setLocale = useMemo(
    () => (next) => {
      if (!isSupported(next)) return;
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        /* ignore storage failures — the switch still applies for this session */
      }
      currentLocale = next;
      setLocaleState(next);
    },
    []
  );

  const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

// The active locale + a setter, for the language picker.
export function useLocale() {
  const { locale, setLocale } = useContext(I18nContext);
  return { locale, setLocale, locales: LOCALES };
}

// The translator bound to the active locale. Subscribes to locale changes, so
// any component calling `useT()` repaints when the user switches language.
export function useT() {
  const { locale } = useContext(I18nContext);
  return useMemo(() => (str, vars) => translate(locale, str, vars), [locale]);
}
