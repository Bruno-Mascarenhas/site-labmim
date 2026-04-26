(function () {
  "use strict";

  try {
    const savedTheme = localStorage.getItem("labmim-theme");
    const systemPrefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    if (savedTheme === "dark" || (!savedTheme && systemPrefersDark)) {
      document.documentElement.classList.add("dark-theme");
    }
  } catch {
    // If storage is unavailable, keep the default light theme.
  }
})();
