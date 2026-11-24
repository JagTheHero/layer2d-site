/**
 * ES module bridge to window.Layer2DI18n for Layer2D Studio modules.
 * Safe offline fallback: interpolates English fallback if i18n.js is absent.
 */

function fallbackInterpolate(str, vars) {
  if (!vars || typeof str !== "string") return str;
  return str.replace(/\{([a-zA-Z0-9_]+)\}/g, (m, k) => (k in vars && vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m));
}

export function t(key, vars = null, fallback = undefined) {
  const api = window.Layer2DI18n;
  if (api && typeof api.t === "function") {
    return api.t(key, vars, fallback);
  }
  return fallbackInterpolate(fallback !== undefined ? fallback : key, vars);
}

export function onLangChange(fn) {
  const api = window.Layer2DI18n;
  if (api && typeof api.onChange === "function") {
    return api.onChange(fn);
  }
  return () => {};
}

export function getLang() {
  return window.Layer2DI18n?.lang || "en";
}

export const i18nReady = window.Layer2DI18n?.ready || Promise.resolve("en");
