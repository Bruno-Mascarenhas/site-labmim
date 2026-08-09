/**
 * theme-toggle.js
 * Every theme button on the page (navbar and footer) is wired through the
 * [data-theme-toggle]/[data-theme-icon] attributes, so they all stay in sync.
 */

document.addEventListener("DOMContentLoaded", () => {
  const themeToggleBtns = document.querySelectorAll("[data-theme-toggle]");
  const themeIcons = document.querySelectorAll("[data-theme-icon]");

  if (!themeToggleBtns.length) return;

  function updateIcon(isDark) {
    const label = isDark ? "Alternar para tema claro" : "Alternar para tema escuro";

    themeIcons.forEach((themeIcon) => {
      themeIcon.classList.toggle("fa-sun", isDark);
      themeIcon.classList.toggle("fa-moon", !isDark);
    });

    themeToggleBtns.forEach((themeToggleBtn) => {
      themeToggleBtn.setAttribute("aria-label", label);
      themeToggleBtn.setAttribute("aria-pressed", String(isDark));
      themeToggleBtn.setAttribute("title", label);
    });
  }

  function applyTheme(isDark) {
    document.documentElement.classList.toggle("dark-theme", isDark);
    updateIcon(isDark);
    window.dispatchEvent(new CustomEvent("labmim-theme-change", { detail: { isDark } }));
  }

  // theme-boot.js in the <head> has already applied the initial state.
  updateIcon(document.documentElement.classList.contains("dark-theme"));

  // Where site storage is blocked (cookies off, storage partitioned inside an
  // iframe) any access to `localStorage` throws. Reading the theme through here
  // keeps the exception contained: no storage means no saved preference, which
  // is exactly what `null` stands for.
  function readTheme() {
    try {
      return localStorage.getItem("labmim-theme");
    } catch {
      return null;
    }
  }

  themeToggleBtns.forEach((themeToggleBtn) => {
    themeToggleBtn.addEventListener("click", (e) => {
      e.preventDefault();
      const newDark = !document.documentElement.classList.contains("dark-theme");
      // Apply first, persist after: the write is the only part that can throw,
      // and the button must still toggle when it does.
      applyTheme(newDark);
      try {
        localStorage.setItem("labmim-theme", newDark ? "dark" : "light");
      } catch {
        // Storage unavailable: the theme holds for this tab only.
      }
    });
  });

  // Follow the OS only while the user has set no manual preference.
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
    if (!readTheme()) applyTheme(e.matches);
  });

  // The preference is one for the whole site, but navigation is multi-page and
  // usually leaves several tabs open. The `storage` event fires precisely in
  // the OTHER tabs of the same origin, so it is what lets them follow the
  // switch instead of waiting for a reload.
  window.addEventListener("storage", (e) => {
    if (e.key !== "labmim-theme") return;
    // A null value is the erased preference: what the OS asks for rules again.
    const isDark = e.newValue ? e.newValue === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    applyTheme(isDark);
  });
});
