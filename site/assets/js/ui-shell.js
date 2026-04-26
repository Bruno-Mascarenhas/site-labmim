(function () {
  "use strict";

  function setToggleState(button, target, isOpen) {
    target.hidden = !isOpen;
    button.setAttribute("aria-expanded", String(isOpen));

    const icon = button.querySelector("i");
    if (icon) {
      icon.classList.toggle("fa-chevron-up", isOpen);
      icon.classList.toggle("fa-chevron-down", !isOpen);
    }

    const openLabel = button.dataset.labelOpen;
    const closedLabel = button.dataset.labelClosed;
    const label = button.querySelector("[data-toggle-label]");
    if (label && openLabel && closedLabel) {
      label.textContent = isOpen ? openLabel : closedLabel;
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("[data-ui-toggle]").forEach((button) => {
      const target = document.getElementById(button.dataset.uiToggle);
      if (!target) return;

      setToggleState(button, target, !target.hidden);
      button.addEventListener("click", () => {
        setToggleState(button, target, target.hidden);
      });
    });
  });
})();
