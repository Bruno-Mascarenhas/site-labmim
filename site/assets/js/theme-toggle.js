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

  // Any access to `localStorage` throws where site storage is blocked (cookies
  // off, partitioned iframe); no storage means no saved preference, i.e. `null`.
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
      // Apply first, persist after: only the write can throw, and the button
      // must still toggle when it does.
      applyTheme(newDark);
      try {
        localStorage.setItem("labmim-theme", newDark ? "dark" : "light");
      } catch {
        // No storage: the theme holds for this tab only.
      }
    });
  });

  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
    if (!readTheme()) applyTheme(e.matches);
  });

  // The `storage` event fires only in the OTHER tabs of this origin, which is
  // what lets a multi-page site switch them all without a reload.
  window.addEventListener("storage", (e) => {
    if (e.key !== "labmim-theme") return;
    const isDark = e.newValue ? e.newValue === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    applyTheme(isDark);
  });
});
