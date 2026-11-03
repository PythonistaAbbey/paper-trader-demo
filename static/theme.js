"use strict";
// Applies the saved colour mode and accent before the page paints (loaded without defer).
// The server keeps the real preference; this copy only avoids a flash of the wrong theme.
(() => {
  const KEY = "pt-theme";
  const MODES = ["system", "light", "dark"];
  const ACCENTS = ["ocean", "emerald", "violet", "sunset", "rose", "mono"];
  const root = document.documentElement;
  const dark = window.matchMedia("(prefers-color-scheme: dark)");

  function paint() {
    const isDark = root.dataset.mode === "dark" || (root.dataset.mode === "system" && dark.matches);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = isDark ? "#0d1828" : "#eaf3ff";
  }
  function apply(p) {
    root.dataset.mode = MODES.includes(p && p.mode) ? p.mode : "system";
    root.dataset.accent = ACCENTS.includes(p && p.accent) ? p.accent : "ocean";
    paint();
    try { localStorage.setItem(KEY, JSON.stringify({mode: root.dataset.mode, accent: root.dataset.accent})); } catch (_) { /* private mode */ }
  }
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (_) { /* ignore */ }
  apply(saved);
  dark.addEventListener("change", paint);
  document.addEventListener("DOMContentLoaded", paint);
  window.ptTheme = {apply, MODES, ACCENTS};
})();
