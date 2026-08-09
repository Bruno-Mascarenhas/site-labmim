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

  // Onde o armazenamento do site está bloqueado (cookies desativados, storage
  // particionado em iframe) qualquer acesso a `localStorage` lança. Ler o tema
  // por aqui mantém a exceção contida: sem armazenamento não há preferência
  // salva, que é exatamente o que `null` significa.
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
      // Aplica primeiro, persiste depois: a escrita é a única parte que pode
      // lançar, e o botão precisa alternar mesmo quando ela falha.
      applyTheme(newDark);
      try {
        localStorage.setItem("labmim-theme", newDark ? "dark" : "light");
      } catch {
        // Armazenamento indisponível: o tema vale só nesta aba.
      }
    });
  });

  // Segue o SO apenas enquanto o usuário não definiu preferência manual.
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
    if (!readTheme()) applyTheme(e.matches);
  });

  // A preferência é uma só para o site inteiro, mas a navegação é multipágina e
  // costuma deixar várias abas abertas. O evento `storage` chega justamente nas
  // OUTRAS abas da mesma origem, então é por ele que elas acompanham a troca em
  // vez de esperar um recarregamento.
  window.addEventListener("storage", (e) => {
    if (e.key !== "labmim-theme") return;
    // Valor nulo é a preferência apagada: volta a valer o que o SO pede.
    const isDark = e.newValue ? e.newValue === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    applyTheme(isDark);
  });
});
