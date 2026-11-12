/*
 * The control strip under the diagram, and the history legend / table.
 */
import {
  INSULATION,
  TRV_SETTINGS,
  clamp,
  type InsulationKey,
  type Sim,
} from "../sim/model";
import { SERIES, clockLabel } from "../chart/HistoryChart";
import { waterGradientCss } from "../scene/colors";
import type { HitKind } from "../scene/HeatingScene";

const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;

const fmtT = (t: number) => `${t.toFixed(1)} °C`;

const OUTDOOR_MIN = -15;
const OUTDOOR_MAX = 25;

/** Build a segmented radio group of buttons with arrow-key support. */
function segmented(
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

function markChecked(buttons: HTMLButtonElement[], index: number): void {
  buttons.forEach((b, i) => {
    b.setAttribute("aria-checked", String(i === index));
    b.tabIndex = i === index ? 0 : -1;
  });
}

const INS_KEYS = Object.keys(INSULATION) as InsulationKey[];

export class Controls {
  private readonly sim: Sim;
  private readonly flow = $<HTMLInputElement>("i-flow");
  private readonly stat = $<HTMLInputElement>("i-stat");
  private readonly out = $<HTMLInputElement>("i-out");
  private readonly ls = $<HTMLInputElement>("i-ls");
  private readonly power = $<HTMLButtonElement>("i-power");
  private trvButtons: HTMLButtonElement[] = [];
  private insButtons: HTMLButtonElement[] = [];

  constructor(sim: Sim) {
    this.sim = sim;
  }

  build(): void {
    const p = this.sim.params;
    this.flow.addEventListener("input", () => {
      p.flowSet = Number(this.flow.value);
      this.sync();
    });
    this.stat.addEventListener("input", () => {
      p.thermostatSet = Number(this.stat.value);
      this.sync();
    });
    this.out.addEventListener("input", () => {
      p.outdoor = Number(this.out.value);
      this.sync();
    });
    this.ls.addEventListener("input", () => {
      p.radiators[0].lockshield = Number(this.ls.value) / 100;
      this.sync();
    });
    this.power.addEventListener("click", () => {
      p.boilerOn = !p.boilerOn;
      this.sync();
    });

    this.trvButtons = segmented(
      $("trv"),
      TRV_SETTINGS.map((s) => ({
        label: s.label,
        title:
          s.target == null
            ? "0: shut"
            : `${s.label === "❄" ? "Frost" : s.label}: about ${s.target} °C`,
      })),
      (i) => {
        p.radiators[0].trvIndex = i;
        this.sync();
      },
    );
    this.insButtons = segmented(
      $("insulation"),
      INS_KEYS.map((k) => ({
        label: INSULATION[k].label,
        title: `${INSULATION[k].label}: ${INSULATION[k].summary}`,
      })),
      (i) => {
        p.insulation = INS_KEYS[i];
        this.sync();
      },
    );

    $("water-scale").style.background = waterGradientCss();
    this.buildLegend();
    $("table-details").addEventListener("toggle", () => this.updateTable());
    this.sync();
  }

  private buildLegend(): void {
    const ul = $("chart-legend");
    for (const s of SERIES) {
      const li = document.createElement("li");
      const k = document.createElement("span");
      k.className = s.dash ? "key-line dashed" : "key-line";
      k.style.setProperty("--key", `var(${s.colorVar})`);
      li.append(k, document.createTextNode(s.name));
      ul.append(li);
    }
    const li = document.createElement("li");
    const w = document.createElement("span");
    w.className = "key-wash";
    li.append(w, document.createTextNode("Thermostat calling"));
    ul.append(li);
  }

  /** Nudge a setting from the scene (click / scroll on a device). */
  adjust(kind: HitKind, dir: 1 | -1, source: "click" | "wheel"): void {
    const p = this.sim.params;
    const rad = p.radiators[0]; // the scene shows one radiator for now
    if (kind === "trv" || kind === "trv-inset")
      rad.trvIndex = clamp(rad.trvIndex + dir, 0, TRV_SETTINGS.length - 1);
    else if (kind === "thermostat") {
      // Click switches the thermostat on/off; scrolling changes the set-point.
      if (source === "click") p.thermostatOn = !p.thermostatOn;
      else p.thermostatSet = clamp(p.thermostatSet + dir * 0.5, 5, 30);
    } else if (kind === "display" || kind === "boiler")
      p.flowSet = clamp(p.flowSet + dir * (source === "click" ? 5 : 1), 30, 80);
    else if (kind === "lockshield")
      rad.lockshield =
        Math.round(clamp(rad.lockshield + dir * 0.1, 0.1, 1) * 10) / 10;
    else if (kind === "power") {
      if (source === "click") p.boilerOn = !p.boilerOn;
    } else if (kind === "outside")
      p.outdoor = clamp(p.outdoor + dir, OUTDOOR_MIN, OUTDOOR_MAX);
    this.sync();
  }

  /** Reflect sim.params in every control. */
  sync(): void {
    const p = this.sim.params;
    this.flow.value = String(p.flowSet);
    this.stat.value = String(p.thermostatSet);
    this.out.value = String(p.outdoor);
    $("o-flow").textContent = `${p.flowSet} °C`;
    $("o-stat").textContent = p.thermostatOn ? fmtT(p.thermostatSet) : "Off";
    $("o-out").textContent = `${p.outdoor} °C`;
    const rad = p.radiators[0];
    this.ls.value = String(Math.round(rad.lockshield * 100));
    $("o-ls").textContent = `${Math.round(rad.lockshield * 100)}%`;
    $("o-power").textContent = p.boilerOn ? "On" : "Off";
    this.power.setAttribute("aria-checked", String(p.boilerOn));
    const trv = TRV_SETTINGS[rad.trvIndex];
    $("o-trv").textContent = trv.target == null ? "shut" : `≈${trv.target} °C`;
    markChecked(this.trvButtons, rad.trvIndex);
    markChecked(this.insButtons, INS_KEYS.indexOf(p.insulation));
  }

  updateTable(): void {
    const details = $<HTMLDetailsElement>("table-details");
    if (!details.open) return;
    const hist = this.sim.history;
    const t0 = this.sim.time - 6 * 3600;
    const rows: typeof hist = [];
    let bucket = -1;
    for (const s of hist) {
      const b = Math.floor(s.t / 900);
      if (s.t >= t0 && b !== bucket) rows.push(s);
      bucket = b;
    }
    rows.reverse();
    const head = [
      "Time",
      "Room",
      "Outside",
      "Thermostat",
      "TRV",
      "Flow",
      "Return",
      "Boiler",
    ];
    const thead = document.createElement("thead");
    const hr = document.createElement("tr");
    for (const h of head) {
      const th = document.createElement("th");
      th.scope = "col";
      th.textContent = h;
      hr.append(th);
    }
    thead.append(hr);
    const tbody = document.createElement("tbody");
    for (const s of rows) {
      const tr = document.createElement("tr");
      const cells = [
        clockLabel(s.t),
        s.rooms[0].T.toFixed(1),
        s.outdoor.toFixed(0),
        s.thermostat.toFixed(1),
        s.rooms[0].trv == null ? "shut" : String(s.rooms[0].trv),
        s.flow.toFixed(1),
        s.ret.toFixed(1),
        s.demand ? `${(s.burner / 1000).toFixed(2)} kW` : "off",
      ];
      for (const c of cells) {
        const td = document.createElement("td");
        td.textContent = c;
        tr.append(td);
      }
      tbody.append(tr);
    }
    $<HTMLTableElement>("data-table").replaceChildren(thead, tbody);
  }
}
