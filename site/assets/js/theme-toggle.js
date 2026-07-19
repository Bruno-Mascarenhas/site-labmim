/**
 * theme-toggle.js
 * Gerencia o tema escuro/claro do sistema. Todos os botões de tema (navbar e
 * rodapé) usam os atributos [data-theme-toggle]/[data-theme-icon].
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

  // Estado inicial já aplicado pelo theme-boot.js no <head>.
  updateIcon(document.documentElement.classList.contains("dark-theme"));

  themeToggleBtns.forEach((themeToggleBtn) => {
    themeToggleBtn.addEventListener("click", (e) => {
      e.preventDefault();
      const newDark = !document.documentElement.classList.contains("dark-theme");
      localStorage.setItem("labmim-theme", newDark ? "dark" : "light");
      applyTheme(newDark);
    });
  });

  // Segue o SO apenas enquanto o usuário não definiu preferência manual.
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
    if (!localStorage.getItem("labmim-theme")) applyTheme(e.matches);
  });
});
