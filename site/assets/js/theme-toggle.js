/**
 * theme-toggle.js
 * Gerencia o tema escuro/claro do sistema.
 */

document.addEventListener("DOMContentLoaded", () => {
  const themeToggleBtn = document.getElementById("themeToggleBtn");
  const themeIcon = document.getElementById("themeIcon");

  if (!themeToggleBtn) return;

  function updateIcon(isDark) {
    if (isDark) {
      themeIcon.classList.remove("fa-moon");
      themeIcon.classList.add("fa-sun");
    } else {
      themeIcon.classList.remove("fa-sun");
      themeIcon.classList.add("fa-moon");
    }
  }

  // Verifica o estado inicial (aplicado pelo script no <head>)
  let isDark = document.documentElement.classList.contains("dark-theme");
  updateIcon(isDark);

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
    }
  });
});
