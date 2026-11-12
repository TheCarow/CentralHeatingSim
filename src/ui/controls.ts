/*
 * The rooms picker in the top bar, and the history legend / table.
 * (Everything else is changed in the scene: see deviceCard.ts.)
 */
import { MAX_ROOMS } from "../house/plan";
import type { Sim } from "../sim/model";
import { clockLabel, seriesFor } from "../chart/HistoryChart";
import { markChecked, segmented } from "./widgets";

const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;

export class Controls {
  /** Called when the user picks a different number of rooms. */
  onRooms?: (rooms: number) => void;

  private sim: Sim;
  private roomButtons: HTMLButtonElement[] = [];

  constructor(sim: Sim) {
    this.sim = sim;
  }

  build(): void {
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
    $("table-details").addEventListener("toggle", () => this.updateTable());
    this.buildLegend();
    this.sync();
  }

  /** Follow a new sim (another number of rooms). */
  setSim(sim: Sim): void {
    this.sim = sim;
    this.buildLegend();
    this.sync();
    this.updateTable();
  }

  sync(): void {
    markChecked(this.roomButtons, this.sim.rooms.length - 1);
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
