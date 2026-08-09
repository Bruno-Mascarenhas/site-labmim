(function () {
  "use strict";

  // The two reads stay apart on purpose. Where site storage is blocked, merely
  // touching `localStorage` throws, and inside a single try that exception
  // would take the OS query down with it — and the OS query needs no storage at
  // all. A user asking for dark at the OS level would be stuck in light, since
  // the site CSS carries no `prefers-color-scheme` rule.
  let savedTheme = null;
  try {
    savedTheme = localStorage.getItem("labmim-theme");
  } catch {
    // Storage unavailable: the system preference is all that is left.
  }

  const systemPrefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  if (savedTheme === "dark" || (!savedTheme && systemPrefersDark)) {
    document.documentElement.classList.add("dark-theme");
  }
})();
