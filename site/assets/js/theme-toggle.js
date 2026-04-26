/**
 * theme-toggle.js
 * Gerencia o tema escuro/claro do sistema.
 */

document.addEventListener("DOMContentLoaded", () => {
  const themeToggleBtns = document.querySelectorAll("#themeToggleBtn, [data-theme-toggle]");
  const themeIcons = document.querySelectorAll("#themeIcon, [data-theme-icon]");

  if (!themeToggleBtns.length) return;

  function updateIcon(isDark) {
    themeIcons.forEach((themeIcon) => {
      if (isDark) {
        themeIcon.classList.remove("fa-moon");
        themeIcon.classList.add("fa-sun");
      } else {
        themeIcon.classList.remove("fa-sun");
        themeIcon.classList.add("fa-moon");
      }
    });

    themeToggleBtns.forEach((themeToggleBtn) => {
      themeToggleBtn.setAttribute("aria-label", isDark ? "Alternar para tema claro" : "Alternar para tema escuro");
      themeToggleBtn.setAttribute("aria-pressed", String(isDark));
      themeToggleBtn.setAttribute("title", isDark ? "Alternar para tema claro" : "Alternar para tema escuro");
    });
  }

  function announceThemeChange(isDark) {
    window.dispatchEvent(new CustomEvent("labmim-theme-change", { detail: { isDark } }));
  }

  // Verifica o estado inicial (aplicado pelo script no <head>)
  let isDark = document.documentElement.classList.contains("dark-theme");
  updateIcon(isDark);

  themeToggleBtns.forEach((themeToggleBtn) => {
    themeToggleBtn.addEventListener("click", (e) => {
      e.preventDefault();
      isDark = document.documentElement.classList.contains("dark-theme");
      const newDark = !isDark;

      if (newDark) {
        document.documentElement.classList.add("dark-theme");
        localStorage.setItem("labmim-theme", "dark");
      } else {
        document.documentElement.classList.remove("dark-theme");
        localStorage.setItem("labmim-theme", "light");
      }
      updateIcon(newDark);
      announceThemeChange(newDark);
    });
  });

  // Ouve mudanças na preferência do sistema se o usuário não definiu manualmente
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
    if (!localStorage.getItem("labmim-theme")) {
      isDark = e.matches;
      if (isDark) {
        document.documentElement.classList.add("dark-theme");
      } else {
        document.documentElement.classList.remove("dark-theme");
      }
      updateIcon(isDark);
      announceThemeChange(isDark);
    }
  });
});
