/*
 * Two stacked time-series panels (room temps / water temps) drawn with PixiJS.
 * One y-axis per panel. Redrawn a few times per second (not every frame),
 * rendered manually since the chart only changes when data does.
 */
import {
  Application,
  Container,
  Graphics,
  Text,
  type FederatedPointerEvent,
  type TextStyleOptions,
} from "pixi.js";
import type { HistorySample, Sim } from "../sim/model";
import { cssToHex } from "../scene/colors";
import type { Tooltip } from "../ui/tooltip";
import type { TipRow } from "../ui/describe";

type SeriesKey = "room" | "outdoor" | "thermostat" | "trv" | "flow" | "ret";

interface SeriesDef {
  key: SeriesKey;
  panel: 0 | 1;
  name: string;
  short: string;
  colorVar: string;
  width: number;
  dash?: [number, number];
}

export const SERIES: readonly SeriesDef[] = [
  {
    key: "room",
    panel: 0,
    name: "Room air",
    short: "Room",
    colorVar: "--series-room",
    width: 2,
  },
  {
    key: "outdoor",
    panel: 0,
    name: "Outside",
    short: "Outside",
    colorVar: "--series-outdoor",
    width: 2,
  },
  {
    key: "thermostat",
    panel: 0,
    name: "Thermostat set",
    short: "Stat",
    colorVar: "--ref-strong",
    width: 1.5,
    dash: [6, 4],
  },
  {
    key: "trv",
    panel: 0,
    name: "TRV target",
    short: "TRV",
    colorVar: "--ref-muted",
    width: 1.5,
    dash: [2, 3],
  },
  {
    key: "flow",
    panel: 1,
    name: "Flow",
    short: "Flow",
    colorVar: "--series-flow",
    width: 2,
  },
  {
    key: "ret",
    panel: 1,
    name: "Return",
    short: "Return",
    colorVar: "--series-return",
    width: 2,
  },
];

const WINDOW_S = 6 * 3600;
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const M = { l: 38, r: 96, t: 22, b: 22, gap: 34 };

type StyleKey = "axis" | "label" | "title";

interface Panel {
  y: number;
  h: number;
  lo: number;
  hi: number;
}

export function clockLabel(t: number): string {
  const day = Math.floor(t / 86400) + 1;
  const s = t % 86400;
  const hh = String(Math.floor(s / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  return day > 1 ? `D${day} ${hh}:${mm}` : `${hh}:${mm}`;
}

function value(s: HistorySample, key: SeriesKey): number | null {
  switch (key) {
    case "room":
      return s.rooms[0].T;
    case "outdoor":
      return s.outdoor;
    case "thermostat":
      return s.thermostat;
    case "trv":
      return s.rooms[0].trv;
    case "flow":
      return s.flow;
    case "ret":
      return s.ret;
  }
}

export class HistoryChart {
  readonly app = new Application();
  private readonly sim: Sim;
  private readonly tooltip: Tooltip;
  private readonly g = new Graphics();
  private readonly cross = new Graphics();
  private readonly textLayer = new Container();
  private readonly pools: Record<
    StyleKey,
    { list: Text[]; used: number; style: TextStyleOptions }
  >;
  private colors: Record<string, number> = {};
  private data: HistorySample[] = [];
  private t0 = 0;
  private panels: Panel[] = [];
  private hoverX: number | null = null;
  private hoverClient = { x: 0, y: 0 };

  constructor(sim: Sim, tooltip: Tooltip) {
    this.sim = sim;
    this.tooltip = tooltip;
    this.pools = {
      axis: {
        list: [],
        used: 0,
        style: { fontFamily: FONT, fontSize: 11, fill: 0x898781 },
      },
      label: {
        list: [],
        used: 0,
        style: {
          fontFamily: FONT,
          fontSize: 11,
          fill: 0x52514e,
          fontWeight: "500",
        },
      },
      title: {
        list: [],
        used: 0,
        style: {
          fontFamily: FONT,
          fontSize: 12,
          fill: 0x52514e,
          fontWeight: "600",
        },
      },
    };
  }

  async init(el: HTMLElement): Promise<void> {
    await this.app.init({
      resizeTo: el,
      backgroundAlpha: 0,
      antialias: true,
      autoDensity: true,
      autoStart: false,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
    });
    el.appendChild(this.app.canvas);
    this.app.canvas.setAttribute("role", "img");
    this.app.canvas.setAttribute(
      "aria-label",
      "Chart of room, outdoor, flow and return temperatures over the last six hours. A data table is available below.",
    );
    this.app.stage.addChild(this.g, this.cross, this.textLayer);

    new ResizeObserver(() => this.app.queueResize()).observe(el);
    this.app.renderer.on("resize", () => this.render());

    const stage = this.app.stage;
    stage.eventMode = "static";
    stage.hitArea = this.app.screen;
    stage.interactiveChildren = false; // crosshair is computed from x only
    stage.on("pointermove", (e: FederatedPointerEvent) => {
      this.hoverX = e.global.x;
      this.hoverClient = { x: e.client.x, y: e.client.y };
      this.drawCrosshair();
      this.app.render();
    });
    this.app.canvas.addEventListener("pointerleave", () => {
      this.hoverX = null;
      this.tooltip.hide();
      this.drawCrosshair();
      this.app.render();
    });

    this.readTheme();
    matchMedia("(prefers-color-scheme: dark)").addEventListener(
      "change",
      () => {
        this.readTheme();
        this.render();
      },
    );
  }

  private readTheme(): void {
    const cs = getComputedStyle(document.documentElement);
    const get = (v: string) => cssToHex(cs.getPropertyValue(v));
    for (const s of SERIES) this.colors[s.colorVar] = get(s.colorVar);
    for (const v of [
      "--grid",
      "--baseline",
      "--text-secondary",
      "--text-muted",
      "--wash",
      "--surface-1",
    ])
      this.colors[v] = get(v);
    const fills: Record<StyleKey, number> = {
      axis: this.colors["--text-muted"],
      label: this.colors["--text-secondary"],
      title: this.colors["--text-secondary"],
    };
    for (const k of Object.keys(fills) as StyleKey[]) {
      const pool = this.pools[k];
      pool.style.fill = fills[k];
      for (const t of pool.list) t.style.fill = fills[k];
    }
  }

  private text(
    kind: StyleKey,
    s: string,
    x: number,
    y: number,
    ax = 0,
    ay = 0,
  ): Text {
    const pool = this.pools[kind];
    let t = pool.list[pool.used];
    if (!t) {
      t = new Text({ text: s, style: { ...pool.style } });
      pool.list.push(t);
      this.textLayer.addChild(t);
    }
    pool.used++;
    t.visible = true;
    t.text = s;
    t.anchor.set(ax, ay);
    t.position.set(Math.round(x), Math.round(y));
    return t;
  }

  private xOf(t: number): number {
    const w = this.app.screen.width - M.l - M.r;
    return M.l + ((t - this.t0) / WINDOW_S) * w;
  }

  private yOf(panel: Panel, v: number): number {
    return (
      panel.y + panel.h - ((v - panel.lo) / (panel.hi - panel.lo)) * panel.h
    );
  }

  /** Full redraw from sim.history. */
  render(): void {
    const { width: W, height: H } = this.app.screen;
    const hist = this.sim.history;
    if (!hist.length || W < 50) return;
    for (const p of Object.values(this.pools)) p.used = 0;

    const t1 = Math.max(this.sim.time, hist[0].t + WINDOW_S);
    this.t0 = t1 - WINDOW_S;
    let lo = 0;
    while (lo < hist.length && hist[lo].t < this.t0) lo++;
    this.data = hist.slice(Math.max(0, lo - 1));
    const data = this.data;

    // panels and their y-domains
    const ph = (H - M.t - M.b - M.gap) / 2;
    const domain = (panel: 0 | 1, step: number, minSpan: number) => {
      let mn = Infinity;
      let mx = -Infinity;
      for (const s of data)
        for (const def of SERIES) {
          if (def.panel !== panel) continue;
          const v = value(s, def.key);
          if (v == null) continue;
          mn = Math.min(mn, v);
          mx = Math.max(mx, v);
        }
      let a = Math.floor((mn - 0.5) / step) * step;
      let b = Math.ceil((mx + 0.5) / step) * step;
      while (b - a < minSpan) {
        a -= step / 2;
        b += step / 2;
      }
      return [a, b] as const;
    };
    const [r0, r1] = domain(0, 5, 10);
    const [w0, w1] = domain(1, 10, 20);
    this.panels = [
      { y: M.t, h: ph, lo: r0, hi: r1 },
      { y: M.t + ph + M.gap, h: ph, lo: w0, hi: w1 },
    ];

    const g = this.g.clear();
    const c = this.colors;
    const xL = M.l;
    const xR = W - M.r;

    // heating-on bands
    let runStart: number | null = null;
    const band = (a: number, b: number) => {
      for (const p of this.panels)
        g.rect(this.xOf(a), p.y, Math.max(1, this.xOf(b) - this.xOf(a)), p.h);
    };
    for (let i = 0; i < data.length; i++) {
      if (data[i].demand && runStart == null) runStart = data[i].t;
      if ((!data[i].demand || i === data.length - 1) && runStart != null) {
        band(Math.max(runStart, this.t0), data[i].t);
        runStart = null;
      }
    }
    g.fill({ color: c["--wash"], alpha: 0.1 });

    // grid + y labels
    const titles = ["Room & outside °C", "Boiler water °C"];
    this.panels.forEach((p, pi) => {
      const span = p.hi - p.lo;
      const step = pi === 0 ? (span > 25 ? 10 : 5) : span > 40 ? 20 : 10;
      for (let v = Math.ceil(p.lo / step) * step; v <= p.hi + 1e-6; v += step) {
        const y = this.yOf(p, v);
        g.moveTo(xL, y).lineTo(xR, y);
        this.text("axis", String(v), xL - 6, y, 1, 0.5);
      }
      this.text("title", titles[pi], xL, p.y - 6, 0, 1);
    });
    g.stroke({ width: 1, color: c["--grid"] });
    for (const p of this.panels) g.moveTo(xL, p.y + p.h).lineTo(xR, p.y + p.h);
    g.stroke({ width: 1, color: c["--baseline"] });

    // x ticks (hours)
    const hourStep = xR - xL < 420 ? 2 : 1;
    for (
      let t = Math.ceil(this.t0 / 3600) * 3600;
      t <= t1;
      t += 3600 * hourStep
    ) {
      const x = this.xOf(t);
      this.text("axis", clockLabel(t), x, H - M.b + 6, 0.5, 0);
    }

    // series
    for (const def of SERIES) {
      const panel = this.panels[def.panel];
      const color = c[def.colorVar];
      let seg: { x: number; y: number }[] = [];
      const flush = () => {
        if (seg.length > 1) {
          if (def.dash) this.dashed(g, seg, def.dash);
          else {
            g.moveTo(seg[0].x, seg[0].y);
            for (let i = 1; i < seg.length; i++) g.lineTo(seg[i].x, seg[i].y);
          }
        }
        seg = [];
      };
      for (const s of data) {
        const v = value(s, def.key);
        if (v == null) {
          flush();
          continue;
        }
        seg.push({ x: Math.max(xL, this.xOf(s.t)), y: this.yOf(panel, v) });
      }
      flush();
      g.stroke({ width: def.width, color, cap: "round", join: "round" });
    }

    // direct labels at the line ends, nudged apart
    const last = data[data.length - 1];
    const xEnd = this.xOf(last.t);
    for (const pi of [0, 1] as const) {
      const panel = this.panels[pi];
      const items = SERIES.filter((d) => d.panel === pi)
        .map((d) => ({ d, v: value(last, d.key) }))
        .filter((i): i is { d: SeriesDef; v: number } => i.v != null)
        .map((i) => ({ ...i, y: this.yOf(panel, i.v) }))
        .sort((a, b) => a.y - b.y);
      for (let k = 1; k < items.length; k++)
        items[k].y = Math.max(items[k].y, items[k - 1].y + 14);
      const overflow = items.length
        ? items[items.length - 1].y - (panel.y + panel.h + 6)
        : 0;
      if (overflow > 0) for (const it of items) it.y -= overflow;
      for (const it of items) {
        const lx = xR + 8;
        g.moveTo(lx, it.y).lineTo(lx + 10, it.y);
        g.stroke({ width: it.d.width, color: c[it.d.colorVar] });
        this.text(
          "label",
          `${it.d.short} ${it.v.toFixed(it.d.panel === 0 ? 1 : 0)}°`,
          lx + 14,
          it.y,
          0,
          0.5,
        );
      }
    }
    // "now" marker
    g.moveTo(xEnd, M.t).lineTo(xEnd, H - M.b);
    g.stroke({ width: 1, color: c["--baseline"] });

    for (const p of Object.values(this.pools))
      for (let i = p.used; i < p.list.length; i++) p.list[i].visible = false;

    this.drawCrosshair();
    this.app.render();
  }

  private dashed(
    g: Graphics,
    pts: { x: number; y: number }[],
    [on, off]: [number, number],
  ): void {
    let draw = true;
    let left = on;
    for (let i = 1; i < pts.length; i++) {
      let ax = pts[i - 1].x;
      let ay = pts[i - 1].y;
      const bx = pts[i].x;
      const by = pts[i].y;
      let len = Math.hypot(bx - ax, by - ay);
      while (len > 0) {
        const step = Math.min(left, len);
        const t = step / len;
        const nx = ax + (bx - ax) * t;
        const ny = ay + (by - ay) * t;
        if (draw) g.moveTo(ax, ay).lineTo(nx, ny);
        ax = nx;
        ay = ny;
        len -= step;
        left -= step;
        if (left <= 1e-6) {
          draw = !draw;
          left = draw ? on : off;
        }
      }
    }
  }

  private drawCrosshair(): void {
    const g = this.cross.clear();
    const data = this.data;
    if (this.hoverX == null || !data.length) return;
    const W = this.app.screen.width;
    if (this.hoverX < M.l - 4 || this.hoverX > W - M.r + 4) {
      this.tooltip.hide();
      return;
    }
    // nearest sample by x
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < data.length; i++) {
      const d = Math.abs(this.xOf(data[i].t) - this.hoverX);
      if (d < bestD) [best, bestD] = [i, d];
    }
    const s = data[best];
    const x = this.xOf(s.t);
    if (x < M.l) return;
    const c = this.colors;
    for (const p of this.panels) g.moveTo(x, p.y).lineTo(x, p.y + p.h);
    g.stroke({ width: 1, color: c["--text-secondary"], alpha: 0.6 });

    const rows: TipRow[] = [];
    for (const def of SERIES) {
      const v = value(s, def.key);
      const css = "#" + c[def.colorVar].toString(16).padStart(6, "0");
      rows.push({
        label: def.name,
        value: v == null ? "shut" : `${v.toFixed(1)} °C`,
        key: css,
        dashed: !!def.dash,
      });
      if (v == null || def.dash) continue;
      const y = this.yOf(this.panels[def.panel], v);
      g.circle(x, y, 4)
        .fill(c[def.colorVar])
        .stroke({ width: 2, color: c["--surface-1"] });
    }
    rows.push({
      label: "Boiler",
      value: s.demand ? `on · ${(s.burner / 1000).toFixed(2)} kW` : "off",
    });
    this.tooltip.show(
      { title: clockLabel(s.t), rows },
      this.hoverClient.x,
      this.hoverClient.y,
    );
  }
}
