/*
 * Colour helpers. Interpolation happens in OKLab, so blends between colours
 * change evenly as the eye sees them instead of going muddy mid-way.
 */

type Lab = [number, number, number];

const toLinear = (c: number) =>
  c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const toSrgb = (c: number) =>
  c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;

function hexToOklab(hex: number): Lab {
  const r = toLinear(((hex >> 16) & 255) / 255);
  const g = toLinear(((hex >> 8) & 255) / 255);
  const b = toLinear((hex & 255) / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToHex([L, a, b]: Lab): number {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const ch = (v: number) =>
    Math.round(Math.min(1, Math.max(0, toSrgb(v))) * 255);
  const r = ch(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
  const g = ch(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
  const bl = ch(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);
  return (r << 16) | (g << 8) | bl;
}

/** Blend two colours in OKLab: t = 0 gives a, t = 1 gives b. */
export function mixColor(a: number, b: number, t: number): number {
  const p = hexToOklab(a);
  const q = hexToOklab(b);
  return oklabToHex([
    p[0] + (q[0] - p[0]) * t,
    p[1] + (q[1] - p[1]) * t,
    p[2] + (q[2] - p[2]) * t,
  ]);
}

/** Piecewise OKLab ramp through [value, colour] stops. */
function makeRamp(stops: ReadonlyArray<readonly [number, number]>) {
  const labs = stops.map(([v, c]) => [v, hexToOklab(c)] as const);
  return (v: number): number => {
    if (v <= labs[0][0]) return stops[0][1];
    for (let i = 1; i < labs.length; i++) {
      const [v1, c1] = labs[i];
      if (v <= v1) {
        const [v0, c0] = labs[i - 1];
        const t = (v - v0) / (v1 - v0);
        return oklabToHex([
          c0[0] + (c1[0] - c0[0]) * t,
          c0[1] + (c1[1] - c0[1]) * t,
          c0[2] + (c1[2] - c0[2]) * t,
        ]);
      }
    }
    return stops[stops.length - 1][1];
  };
}

// ---- Water temperature: blue (cold) -> orange (hot) -------------------------
// Like a thermal camera: blue, violet, magenta, coral red, orange. Lightness
// rises steadily with temperature (OKLab L 0.45 -> 0.80), because the eye
// sees small lightness differences on thin pipes far better than hue alone.
// Most of the change is spent on 35-75 °C, where flow, return and radiator
// temperatures actually differ: about ΔE 6 (OKLab x100) per 5 °C there,
// and about 2 per 5 °C at the cold end.
export const WATER_MIN = 10;
export const WATER_MAX = 80;
const WATER_STOPS = [
  [WATER_MIN, 0x0553a6], // deep blue
  [25, 0x3856c8], // blue
  [35, 0x7350da], // blue-violet
  [45, 0xb444c5], // purple
  [55, 0xe93a8f], // magenta
  [65, 0xfd5a57], // coral red
  [75, 0xff8d44], // orange
  [WATER_MAX, 0xffa54b], // light orange
] as const;
const waterRamp = makeRamp(WATER_STOPS);

// Precomputed lookup table at 0.25 °C resolution — called ~200x per frame.
const LUT_STEP = 0.25;
const LUT = new Uint32Array(Math.round((WATER_MAX - WATER_MIN) / LUT_STEP) + 1);
for (let i = 0; i < LUT.length; i++)
  LUT[i] = waterRamp(WATER_MIN + i * LUT_STEP);

export function waterColor(t: number): number {
  const i = Math.round((t - WATER_MIN) / LUT_STEP);
  return LUT[i < 0 ? 0 : i >= LUT.length ? LUT.length - 1 : i];
}

// ---- Room air & sky tints -----------------------------------------------------
export const roomTint = makeRamp([
  [12, 0xd9e6f2],
  [17, 0xeef0ee],
  [20, 0xf6f1e7],
  [24, 0xf9e6d2],
  [28, 0xf7d3b6],
]);

export const skyTint = makeRamp([
  [-10, 0xc6cfd8],
  [0, 0xc4d6e6],
  [10, 0xb3d5ef],
  [20, 0x9dcdf3],
]);

export function toCss(hex: number): string {
  return "#" + hex.toString(16).padStart(6, "0");
}

export function cssToHex(css: string): number {
  const s = css.trim().replace("#", "");
  const full = s.length === 3 ? s.replace(/./g, (c) => c + c) : s.slice(0, 6);
  const n = parseInt(full, 16);
  return Number.isFinite(n) ? n : 0;
}
