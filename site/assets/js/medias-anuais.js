(() => {
  "use strict";
  const bar = document.querySelector("#main > .controls-container");
  if (!bar) return;
  document.querySelectorAll("[data-move-to-controls]").forEach((el) => bar.appendChild(el));
})();