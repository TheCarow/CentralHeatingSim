/*
 * The controls under the diagram (whole-house settings, then one row per
 * radiator), and the history legend / table.
 */
import { MAX_ROOMS } from "../house/plan";
import {
  INSULATION,
  TRV_SETTINGS,
  clamp,
  type InsulationKey,
  type Sim,
} from "../sim/model";
import { clockLabel, seriesFor } from "../chart/HistoryChart";
import { waterGradientCss } from "../scene/colors";
import { roomOf, type Hit } from "../scene/hit";

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

/** Show how far along a slider's value is (the blue part of its track). */
function paintFill(input: HTMLInputElement): void {
  const min = Number(input.min);
  const max = Number(input.max);
  const pct = ((Number(input.value) - min) / (max - min)) * 100;
  input.style.setProperty("--fill", `${pct}%`);
}

function markChecked(buttons: HTMLButtonElement[], index: number): void {
  buttons.forEach((b, i) => {
    b.setAttribute("aria-checked", String(i === index));
    b.tabIndex = i === index ? 0 : -1;
  });
}

const INS_KEYS = Object.keys(INSULATION) as InsulationKey[];

const TRV_ITEMS = TRV_SETTINGS.map((s) => ({
  label: s.label,
  title:
    s.target == null
      ? "0: shut"
      : `${s.label === "❄" ? "Frost" : s.label}: about ${s.target} °C`,
}));

/** The controls for one radiator. */
interface RadiatorRow {
  trvButtons: HTMLButtonElement[];
  trvOut: HTMLOutputElement;
  ls: HTMLInputElement;
  lsOut: HTMLOutputElement;
}

export class Controls {
  /** Called when the user picks a different number of rooms. */
  onRooms?: (rooms: number) => void;

  private sim: Sim;
  private readonly flow = $<HTMLInputElement>("i-flow");
  private readonly stat = $<HTMLInputElement>("i-stat");
  private readonly out = $<HTMLInputElement>("i-out");
  private readonly dayNight = $<HTMLInputElement>("i-daynight");
  private readonly power = $<HTMLButtonElement>("i-power");
  private roomButtons: HTMLButtonElement[] = [];
  private insButtons: HTMLButtonElement[] = [];
  private rows: RadiatorRow[] = [];

  constructor(sim: Sim) {
    this.sim = sim;
  }

  build(): void {
    // Handlers read this.sim at event time: the sim is replaced when the
    // number of rooms changes.
    const p = () => this.sim.params;
    this.flow.addEventListener("input", () => {
      p().flowSet = Number(this.flow.value);
      this.sync();
    });
    this.stat.addEventListener("input", () => {
      p().thermostatSet = Number(this.stat.value);
      this.sync();
    });
    this.dayNight.addEventListener("change", () => {
      p().dayNight = this.dayNight.checked;
      this.sync();
    });
    this.out.addEventListener("input", () => {
      p().outdoor = Number(this.out.value);
      this.sync();
    });
    this.power.addEventListener("click", () => {
      p().boilerOn = !p().boilerOn;
      this.sync();
    });
    this.roomButtons = segmented(
      $("rooms"),
      Array.from({ length: MAX_ROOMS }, (_, i) => ({
        label: String(i + 1),
        title: i === 0 ? "1 room" : `${i + 1} rooms in a row`,
      })),
      (i) => {
        if (i + 1 !== this.sim.rooms.length) this.onRooms?.(i + 1);
      },
    );
    this.insButtons = segmented(
      $("insulation"),
      INS_KEYS.map((k) => ({
        label: INSULATION[k].label,
        title: `${INSULATION[k].label}: ${INSULATION[k].summary}`,
      })),
      (i) => {
        p().insulation = INS_KEYS[i];
        this.sync();
      },
    );

    $("water-scale").style.background = waterGradientCss();
    $("table-details").addEventListener("toggle", () => this.updateTable());
    this.buildRadiators();
    this.buildLegend();
    this.sync();
  }

  /** Follow a new sim (another number of rooms). */
  setSim(sim: Sim): void {
    this.sim = sim;
    this.buildRadiators();
    this.buildLegend();
    this.sync();
    this.updateTable();
  }

  /** One row of TRV buttons and a lockshield slider per radiator. */
  private buildRadiators(): void {
    const box = $("radiators");
    const tpl = $<HTMLTemplateElement>("radiator-row");
    box.replaceChildren();
    const n = this.sim.rooms.length;
    this.rows = this.sim.plan.rooms.map((room, k) => {
      const row = tpl.content.firstElementChild!.cloneNode(true) as HTMLElement;
      const q = <T extends Element>(sel: string) => row.querySelector(sel) as T;
      const name = n === 1 ? "Radiator" : room.name;
      q<HTMLElement>(".rad-name").textContent = name;
      // Unique ids so each label points at its own control.
      const trvLabel = q<HTMLElement>(".trv-label");
      trvLabel.id = `trv-label-${k}`;
      const seg = q<HTMLElement>(".seg.trv");
      seg.setAttribute("aria-labelledby", trvLabel.id);
      if (n > 1) seg.setAttribute("aria-label", `${name} TRV`);
      const ls = q<HTMLInputElement>(".i-ls");
      ls.id = `i-ls-${k}`;
      q<HTMLLabelElement>(".ctl-ls label").htmlFor = ls.id;
      if (n > 1) ls.setAttribute("aria-label", `${name} lockshield`);
      ls.addEventListener("input", () => {
        this.sim.params.radiators[k].lockshield = Number(ls.value) / 100;
        this.sync();
      });
      const trvButtons = segmented(seg, TRV_ITEMS, (i) => {
        this.sim.params.radiators[k].trvIndex = i;
        this.sync();
      });
      box.append(row);
      return {
        trvButtons,
        trvOut: q<HTMLOutputElement>(".o-trv"),
        ls,
        lsOut: q<HTMLOutputElement>(".o-ls"),
      };
    });
  }

  private buildLegend(): void {
    const ul = $("chart-legend");
    ul.replaceChildren();
    for (const s of seriesFor(this.sim.rooms.length)) {
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
  adjust(hit: Hit, dir: 1 | -1, source: "click" | "wheel"): void {
    const p = this.sim.params;
    const kind = hit.kind;
    const rad = p.radiators[roomOf(hit)];
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
    for (const r of [this.flow, this.stat, this.out]) paintFill(r);
    $("o-flow").textContent = `${p.flowSet} °C`;
    $("o-stat").textContent = p.thermostatOn ? fmtT(p.thermostatSet) : "Off";
    // With the cycle on, the slider sets the daily average.
    $("o-out").textContent = p.dayNight
      ? `${p.outdoor} °C average`
      : `${p.outdoor} °C`;
    this.dayNight.checked = p.dayNight;
    $("o-power").textContent = p.boilerOn ? "On" : "Off";
    this.power.setAttribute("aria-checked", String(p.boilerOn));
    markChecked(this.roomButtons, this.sim.rooms.length - 1);
    markChecked(this.insButtons, INS_KEYS.indexOf(p.insulation));
    this.rows.forEach((row, k) => {
      const rad = p.radiators[k];
      const trv = TRV_SETTINGS[rad.trvIndex];
      row.trvOut.textContent =
        trv.target == null ? "shut" : `≈${trv.target} °C`;
      markChecked(row.trvButtons, rad.trvIndex);
      const pct = Math.round(rad.lockshield * 100);
      row.ls.value = String(pct);
      paintFill(row.ls);
      row.lsOut.textContent = `${pct}%`;
    });
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
    // Same series as the chart: one column per room; the TRV target only
    // with a single room.
    const n = this.sim.rooms.length;
    const roomHeads =
      n === 1 ? ["Room"] : this.sim.plan.rooms.map((r) => r.name);
    const head = [
      "Time",
      ...roomHeads,
      "Outside",
      "Thermostat",
      ...(n === 1 ? ["TRV"] : []),
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
      const trv = s.rooms[0]?.trv;
      const cells = [
        clockLabel(s.t),
        ...s.rooms.map((r) => r.T.toFixed(1)),
        s.outdoor.toFixed(0),
        s.thermostat.toFixed(1),
        ...(n === 1 ? [trv == null ? "shut" : String(trv)] : []),
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
