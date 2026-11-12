/*
 * The bubble beside an object in the scene: the boiler, the thermostat, a
 * TRV or lockshield, the outside, or the walls and loft (insulation).
 *
 * Hovering the object shows its details here, in a fixed place beside it
 * (a "peek"). Clicking it pins the bubble and adds its controls under the
 * details. One bubble at a time; it points at its object.
 */
import { INSULATION, type Sim } from "../sim/model";
import type { Hit } from "../scene/hit";
import type { TipContent } from "./describe";
import { placeCard, type Box } from "./placement";
import { INS_ITEMS, INS_KEYS, RANGE, TRV_ITEMS, trvText } from "./settings";
import { sameTarget, sidesFor, type CardTarget } from "./targets";
import { tipParts } from "./tooltip";
import { el, fade, markChecked, paintFill, segmented } from "./widgets";

/** One control in the bubble: its element, and how to show the current value. */
interface Row {
  el: HTMLElement;
  sync(): void;
}

type Range = { min: number; max: number; step: number };

export class DeviceCard {
  /** After the bubble changes a setting. */
  onChange?: () => void;
  /** After the bubble closes; whether it was pinned open. */
  onClose?: (wasPinned: boolean) => void;

  private readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly info: HTMLElement;
  private readonly body: HTMLElement;
  private readonly getSim: () => Sim;
  private current: CardTarget | null = null;
  private isPinned = false;
  /** What the details describe (the hovered or clicked part). */
  private about: Hit | null = null;
  private infoKey = "";
  private rows: Row[] = [];
  /** Where the object and the drawing are now, in page coordinates. */
  private anchor: () => Box = () => ({ x: 0, y: 0, w: 0, h: 0 });
  private bounds: () => Box = () => ({ x: 0, y: 0, w: 0, h: 0 });
  private ids = 0;

  constructor(root: HTMLElement, getSim: () => Sim) {
    this.root = root;
    this.getSim = getSim;
    this.title = root.querySelector(".card-title")!;
    this.info = root.querySelector(".card-info")!;
    this.body = root.querySelector(".card-body")!;
    root
      .querySelector(".card-close")!
      .addEventListener("click", () => this.close());
  }

  /** What the bubble is for (null when closed). */
  get target(): CardTarget | null {
    return this.current;
  }

  /** Clicked open, with its controls (rather than just peeking on hover). */
  get pinned(): boolean {
    return this.isPinned;
  }

  /** What the details describe. */
  get subject(): Hit | null {
    return this.about;
  }

  isOpen(t: CardTarget | null): boolean {
    return sameTarget(this.current, t);
  }

  contains(node: Node): boolean {
    return this.root.contains(node);
  }

  /**
   * Show the details of `about` (part of object `t`) beside the object,
   * without controls. `anchor` and `bounds` give the object and the
   * drawing in page coordinates, asked again whenever the bubble is placed.
   * Fill it with setInfo().
   */
  peek(t: CardTarget, about: Hit, anchor: () => Box, bounds: () => Box): void {
    this.open(t, about, anchor, bounds, false);
  }

  /** Show the details and the controls of object `t`, until closed. */
  pin(t: CardTarget, about: Hit, anchor: () => Box, bounds: () => Box): void {
    this.open(t, about, anchor, bounds, true);
    this.root.focus({ preventScroll: true });
  }

  /** Describe another part of the same object (e.g. its power button). */
  setSubject(about: Hit): void {
    this.about = about;
  }

  /** The details to show (rebuilt only when they change). */
  setInfo(c: TipContent): void {
    if (!this.current) return;
    const key = JSON.stringify(c);
    if (key === this.infoKey) return;
    this.infoKey = key;
    this.title.textContent = c.title;
    this.info.replaceChildren(...tipParts(c));
    this.place();
  }

  close(): void {
    if (!this.current) return;
    const wasPinned = this.isPinned;
    this.current = null;
    this.about = null;
    this.isPinned = false;
    this.infoKey = "";
    // Fades out as it is (the next open replaces the contents).
    fade(this.root, false);
    this.rows = [];
    this.onClose?.(wasPinned);
  }

  /** Show the sim's current settings in the controls. */
  sync(): void {
    for (const r of this.rows) r.sync();
  }

  /** Put the bubble beside its object (call when the page or drawing moves). */
  place(): void {
    if (!this.current) return;
    const size = this.root.getBoundingClientRect();
    const page = {
      x: 0,
      y: 0,
      w: document.documentElement.clientWidth,
      h: document.documentElement.clientHeight,
    };
    const p = placeCard(
      this.anchor(),
      size.width,
      size.height,
      this.bounds(),
      page,
      sidesFor(this.current),
    );
    this.root.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`;
    this.root.dataset.side = p.side;
    this.root.style.setProperty("--arrow", `${Math.round(p.arrow)}px`);
  }

  // ---------------------------------------------------------------------------

  private open(
    t: CardTarget,
    about: Hit,
    anchor: () => Box,
    bounds: () => Box,
    pinned: boolean,
  ): void {
    this.current = t;
    this.about = about;
    this.isPinned = pinned;
    this.infoKey = "";
    this.anchor = anchor;
    this.bounds = bounds;
    // A peek only shows; the pointer passes through it to the drawing.
    this.root.classList.toggle("is-peek", !pinned);
    this.root.setAttribute("role", pinned ? "dialog" : "tooltip");
    this.rows = pinned ? this.controls(t) : [];
    this.body.replaceChildren(...this.rows.map((r) => r.el));
    this.body.hidden = !pinned;
    fade(this.root, true);
    this.sync();
    this.place();
  }

  /** The controls for each kind of object. */
  private controls(t: CardTarget): Row[] {
    const p = () => this.getSim().params;
    switch (t.kind) {
      case "radiator":
        return []; // details only
      case "boiler":
        return [
          this.switchRow(
            "Power",
            () => p().boilerOn,
            (on) => (p().boilerOn = on),
          ),
          this.sliderRow(
            "Flow temperature",
            RANGE.flow,
            () => p().flowSet,
            (v) => (p().flowSet = v),
            (v) => `${v} °C`,
            () => !p().boilerOn,
          ),
        ];
      case "thermostat":
        return [
          this.switchRow(
            "Heating",
            () => p().thermostatOn,
            (on) => (p().thermostatOn = on),
          ),
          this.sliderRow(
            "Set to",
            RANGE.thermostat,
            () => p().thermostatSet,
            (v) => (p().thermostatSet = v),
            (v) => `${v.toFixed(1)} °C`,
            () => !p().thermostatOn,
          ),
        ];
      case "trv": {
        const rad = () => p().radiators[t.room];
        return [
          this.segRow(
            "Setting",
            TRV_ITEMS,
            () => rad().trvIndex,
            (i) => (rad().trvIndex = i),
            () => trvText(rad().trvIndex),
          ),
        ];
      }
      case "lockshield": {
        const rad = () => p().radiators[t.room];
        return [
          this.sliderRow(
            "Open",
            RANGE.lockshield,
            () => Math.round(rad().lockshield * 100),
            (v) => (rad().lockshield = v / 100),
            (v) => `${v}%`,
          ),
        ];
      }
      case "outside":
        return [
          // With the cycle on, the slider sets the daily average.
          this.sliderRow(
            "Temperature",
            RANGE.outdoor,
            () => p().outdoor,
            (v) => (p().outdoor = v),
            (v) => (p().dayNight ? `${v} °C average` : `${v} °C`),
          ),
          this.switchRow(
            "Day/night cycle",
            () => p().dayNight,
            (on) => (p().dayNight = on),
          ),
          this.noteRow(() =>
            p().dayNight
              ? "Swings ±4 °C: coldest around 3 am, warmest around 3 pm."
              : "",
          ),
        ];
      case "insulation":
        return [
          this.segRow(
            "Insulation",
            INS_ITEMS,
            () => INS_KEYS.indexOf(p().insulation),
            (i) => (p().insulation = INS_KEYS[i]),
          ),
          this.noteRow(() => INSULATION[p().insulation].summary),
        ];
    }
  }

  private uid(): string {
    return `card-ctl-${++this.ids}`;
  }

  private changed(): void {
    this.sync();
    this.onChange?.();
  }

  /** A label with an On/Off switch beside it. */
  private switchRow(
    label: string,
    get: () => boolean,
    set: (on: boolean) => void,
  ): Row {
    const row = el("div", "ctl ctl-switch");
    const name = el("span", "ctl-label");
    name.id = this.uid();
    name.textContent = label;
    const out = el("output");
    const btn = el("button", "switch");
    btn.type = "button";
    btn.setAttribute("role", "switch");
    btn.setAttribute("aria-labelledby", name.id);
    btn.append(el("span", "knob"));
    btn.addEventListener("click", () => {
      set(!get());
      this.changed();
    });
    row.append(name, out, btn);
    return {
      el: row,
      sync: () => {
        const on = get();
        btn.setAttribute("aria-checked", String(on));
        out.textContent = on ? "On" : "Off";
      },
    };
  }

  /** A label and value over a slider; `dimmed` fades it (e.g. while off). */
  private sliderRow(
    label: string,
    range: Range,
    get: () => number,
    set: (v: number) => void,
    show: (v: number) => string,
    dimmed?: () => boolean,
  ): Row {
    const row = el("div", "ctl");
    const input = el("input");
    input.type = "range";
    input.id = this.uid();
    input.min = String(range.min);
    input.max = String(range.max);
    input.step = String(range.step);
    const name = el("label", "ctl-label");
    name.htmlFor = input.id;
    const out = el("output");
    name.append(label, out);
    input.addEventListener("input", () => {
      set(Number(input.value));
      this.changed();
    });
    row.append(name, input);
    return {
      el: row,
      sync: () => {
        const v = get();
        input.value = String(v);
        paintFill(input);
        out.textContent = show(v);
        row.classList.toggle("is-off", dimmed?.() ?? false);
      },
    };
  }

  /** A segmented choice, with a label (and value) above it. */
  private segRow(
    label: string,
    items: { label: string; title: string }[],
    get: () => number,
    set: (i: number) => void,
    show?: () => string,
  ): Row {
    const row = el("div", "ctl");
    const name = el("span", "ctl-label");
    name.id = this.uid();
    const out = el("output");
    name.append(label, out);
    const box = el("div", "seg");
    box.setAttribute("role", "radiogroup");
    box.setAttribute("aria-labelledby", name.id);
    const buttons = segmented(box, items, (i) => {
      set(i);
      this.changed();
    });
    row.append(name, box);
    return {
      el: row,
      sync: () => {
        markChecked(buttons, get());
        if (show) out.textContent = show();
      },
    };
  }

  /** A line of explanation (hidden while empty). */
  private noteRow(text: () => string): Row {
    const p = el("p", "card-note");
    return {
      el: p,
      sync: () => {
        p.textContent = text();
        p.hidden = !p.textContent;
      },
    };
  }
}
