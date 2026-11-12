/*
 * The round power button on the boiler and the room thermostat: a disc
 * tinted green (on) or grey (off) under a white power glyph.
 */
import { Graphics, type Container } from "pixi.js";
import type { Circle } from "../layout";

/** Disc tint for a power button that is on or off. */
export const powerTint = (on: boolean): number => (on ? 0x16a34a : 0x9ca3af);

/** Draw a power button into `parent`; returns the disc, to be tinted. */
export function powerButton(parent: Container, c: Circle): Graphics {
  const { x, y, r } = c;
  const s = r / 9; // the glyph is drawn for a 9 px button
  const disc = new Graphics().circle(x, y, r).fill(0xffffff);
  const glyph = new Graphics()
    .arc(x, y + 0.5 * s, 4.3 * s, -Math.PI / 2 + 0.75, (3 * Math.PI) / 2 - 0.75)
    .stroke({ width: 1.6, color: 0xffffff, cap: "round" })
    .moveTo(x, y - 5 * s)
    .lineTo(x, y - 0.5 * s)
    .stroke({ width: 1.6, color: 0xffffff, cap: "round" });
  parent.addChild(disc, glyph);
  return disc;
}

/** Whether point p is on the button (with a little slack for fingers). */
export const onPowerButton = (p: { x: number; y: number }, c: Circle) =>
  Math.hypot(p.x - c.x, p.y - c.y) <= c.r + 3;
