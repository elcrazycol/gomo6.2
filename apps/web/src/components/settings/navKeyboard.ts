import type { KeyboardEvent } from "react";

/**
 * Arrow-key navigation for the settings lists (sidebar and mobile hub).
 *
 * Moves focus between `[data-nav-item]` elements — Enter/Space are handled
 * natively by the buttons, so this only has to deal with focus movement.
 * Left/Right double as Up/Down so both hands work.
 */
export const handleNavArrowKeys = (event: KeyboardEvent<HTMLElement>) => {
  if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
    return;
  }

  const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("[data-nav-item]")).filter(
    (el) => !el.hasAttribute("disabled"),
  );
  if (items.length === 0) return;

  const index = items.indexOf(document.activeElement as HTMLElement);
  let next = index;

  switch (event.key) {
    case "ArrowDown":
    case "ArrowRight":
      next = index < 0 ? 0 : (index + 1) % items.length;
      break;
    case "ArrowUp":
    case "ArrowLeft":
      next = index <= 0 ? items.length - 1 : index - 1;
      break;
    case "Home":
      next = 0;
      break;
    case "End":
      next = items.length - 1;
      break;
    default:
      return;
  }

  event.preventDefault();
  items[next]?.focus();
};
