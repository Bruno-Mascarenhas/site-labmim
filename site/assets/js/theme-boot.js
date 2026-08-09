(function () {
  "use strict";

  // As duas leituras ficam separadas de propósito. Onde o armazenamento do site
  // está bloqueado o simples acesso a `localStorage` lança, e num try único essa
  // exceção levaria junto a consulta ao sistema operacional — que não depende de
  // armazenamento nenhum. O usuário que pede tema escuro no SO ficaria preso no
  // claro, porque não há nenhuma regra `prefers-color-scheme` no CSS do site.
  let savedTheme = null;
  try {
    savedTheme = localStorage.getItem("labmim-theme");
  } catch {
    // Armazenamento indisponível: resta a preferência do sistema.
  }

  const systemPrefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  if (savedTheme === "dark" || (!savedTheme && systemPrefersDark)) {
    document.documentElement.classList.add("dark-theme");
  }
})();
