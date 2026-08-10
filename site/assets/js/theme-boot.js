(function () {
  "use strict";

  // Kept apart: merely touching `localStorage` throws where storage is blocked,
  // and one try block would take the OS query down with it — leaving an OS-dark
  // user in light, since the site CSS carries no `prefers-color-scheme` rule.
  let savedTheme = null;
  try {
    savedTheme = localStorage.getItem("labmim-theme");
  } catch {
    // No storage: the system preference is all that is left.
  }

  const systemPrefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  if (savedTheme === "dark" || (!savedTheme && systemPrefersDark)) {
    document.documentElement.classList.add("dark-theme");
  }
})();
