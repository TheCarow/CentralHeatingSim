/*
 * Small DOM helpers shared by the top bar and the cards of controls.
 */
import { clamp } from "../sim/model";

/** Build a segmented radio group of buttons with arrow-key support. */
export function segmented(
  box: HTMLElement,
  items: { label: string; title: string }[],
  onPick: (i: number) => void,
): HTMLButtonElement[] {
  const buttons = items.map((it, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("role", "radio");
    b.textContent = it.label;
    b.title = it.title;
    b.setAttribute("aria-label", it.title);
    b.addEventListener("click", () => onPick(i));
    box.append(b);
    return b;
  });
  box.addEventListener("keydown", (e) => {
    const d =
      e.key === "ArrowRight" || e.key === "ArrowUp"
        ? 1
        : e.key === "ArrowLeft" || e.key === "ArrowDown"
          ? -1
          : 0;
    if (!d) return;
    e.preventDefault();
    const cur = buttons.findIndex(
      (b) => b.getAttribute("aria-checked") === "true",
    );
    const next = clamp(cur + d, 0, buttons.length - 1);
    onPick(next);
    buttons[next].focus();
  });
  return buttons;
}

/** Show how far along a slider's value is (the blue part of its track). */
export function paintFill(input: HTMLInputElement): void {
  const min = Number(input.min);
  const max = Number(input.max);
  const pct = ((Number(input.value) - min) / (max - min)) * 100;
  input.style.setProperty("--fill", `${pct}%`);
}

/** Light up the chosen button of a segmented group. */
export function markChecked(buttons: HTMLButtonElement[], index: number): void {
  buttons.forEach((b, i) => {
    b.setAttribute("aria-checked", String(i === index));
    b.tabIndex = i === index ? 0 : -1;
  });
}

const FADE_MS = 120; // matches the opacity transition in style.css
const fadeTimers = new WeakMap<HTMLElement, number>();

/**
 * Show or hide a floating element (tooltip, bubble) with a quick fade:
 * CSS fades it in while it has the class "is-shown" and out without it.
 * Once faded out it gets the `hidden` attribute.
 */
export function fade(el: HTMLElement, show: boolean): void {
  if (show) {
    clearTimeout(fadeTimers.get(el));
    if (el.hidden) {
      el.hidden = false;
      void el.offsetWidth; // start the fade from transparent
    }
    el.classList.add("is-shown");
  } else if (!el.hidden && el.classList.contains("is-shown")) {
    el.classList.remove("is-shown");
    fadeTimers.set(
      el,
      window.setTimeout(() => (el.hidden = true), FADE_MS),
    );
  }
}

/** An element with a class name. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}
