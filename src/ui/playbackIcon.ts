/*
 * Playback symbols for the speed selector: two bars for pause, and one to
 * four arrows (▶, ▶▶, …) for faster speeds. Drawn as inline SVG in the
 * button's text colour, so they follow the selected / hover states.
 */

const SVG_NS = "http://www.w3.org/2000/svg";
const H = 12; // icon height, px
const ARROW_W = 7; // each arrow's width
const ARROW_STEP = 6; // arrows overlap slightly, like a fast-forward symbol

/** A pause symbol (arrows = 0) or that many play arrows. */
export function playbackIcon(arrows: number): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  const shapes: string[] = [];
  let w: number;
  if (arrows === 0) {
    w = 10;
    shapes.push(`M0 0h3.5v${H}H0z`, `M6.5 0H10v${H}H6.5z`);
  } else {
    w = ARROW_W + (arrows - 1) * ARROW_STEP;
    for (let i = 0; i < arrows; i++) {
      const x = i * ARROW_STEP;
      shapes.push(`M${x} 0L${x + ARROW_W} ${H / 2}L${x} ${H}z`);
    }
  }
  svg.setAttribute("viewBox", `0 0 ${w} ${H}`);
  svg.setAttribute("width", String(w));
  svg.setAttribute("height", String(H));
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "playback-icon");
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", shapes.join(""));
  path.setAttribute("fill", "currentColor");
  svg.append(path);
  return svg;
}
