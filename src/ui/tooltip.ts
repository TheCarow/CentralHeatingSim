import type { TipContent } from "./describe";

/** A single floating tooltip shared by the scene and the chart. Content is built with textContent only. */
export class Tooltip {
  private readonly el: HTMLElement;
  private key = ""; // content currently in the DOM
  private w = 0; // measured size, reused while the pointer moves
  private h = 0;

  constructor(el: HTMLElement) {
    this.el = el;
  }

  /** Show content; the DOM is only rebuilt (and measured) when it changes. */
  show(c: TipContent, clientX: number, clientY: number): void {
    const key = JSON.stringify(c);
    if (key !== this.key) {
      this.key = key;
      this.build(c);
      this.measure();
    } else if (this.el.hidden) {
      this.measure();
    }
    this.move(clientX, clientY);
  }

  private measure(): void {
    this.el.hidden = false;
    const r = this.el.getBoundingClientRect();
    this.w = r.width;
    this.h = r.height;
  }

  private build(c: TipContent): void {
    const el = this.el;
    el.replaceChildren();

    const title = document.createElement("div");
    title.className = "tip-title";
    title.textContent = c.title;
    el.append(title);

    if (c.value) {
      const v = document.createElement("div");
      v.className = "tip-value";
      if (c.swatch) {
        const sw = document.createElement("span");
        sw.className = "tip-swatch";
        sw.style.background = c.swatch;
        v.append(sw);
      }
      v.append(document.createTextNode(c.value));
      el.append(v);
    }

    if (c.rows.length) {
      const dl = document.createElement("dl");
      dl.className = "tip-rows";
      for (const r of c.rows) {
        const dt = document.createElement("dt");
        if (r.key) {
          const k = document.createElement("span");
          k.className = r.dashed ? "tip-key dashed" : "tip-key";
          k.style.setProperty("--key", r.key);
          dt.append(k);
        }
        dt.append(document.createTextNode(r.label));
        const dd = document.createElement("dd");
        dd.textContent = r.value;
        dl.append(dt, dd);
      }
      el.append(dl);
    }

    if (c.note) {
      const n = document.createElement("p");
      n.className = "tip-note";
      n.textContent = c.note;
      el.append(n);
    }
  }

  /** Reposition using the cached size (no layout reads). */
  move(clientX: number, clientY: number): void {
    const pad = 14;
    let x = clientX + pad;
    let y = clientY + pad;
    if (x + this.w > window.innerWidth - 8) x = clientX - this.w - pad;
    if (y + this.h > window.innerHeight - 8) y = clientY - this.h - pad;
    this.el.style.transform = `translate(${Math.max(8, x)}px, ${Math.max(8, y)}px)`;
  }

  hide(): void {
    this.el.hidden = true;
  }
}
