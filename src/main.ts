import "@fontsource-variable/nunito"; // friendly rounded type, bundled with the site
import { makePlan } from "./house/plan";
import { Sim } from "./sim/model";
import { HeatingScene } from "./scene/HeatingScene";
import type { Rect } from "./scene/geometry";
import { CLICKABLE, type Hit } from "./scene/hit";
import { HistoryChart } from "./chart/HistoryChart";
import { Tooltip } from "./ui/tooltip";
import { describe, type TipContent } from "./ui/describe";
import { Controls } from "./ui/controls";
import { DeviceCard } from "./ui/deviceCard";
import { nudge, togglePower } from "./ui/settings";
import { anchorFor, bubbleFor, targetFor, type CardTarget } from "./ui/targets";
import { playbackIcon } from "./ui/playbackIcon";
import { formatTimeOfDay } from "./sim/weather";

const SPEEDS = [1, 20, 60, 600] as const;
const DEFAULT_SPEED = 20;

// Wrapped in an async IIFE: top-level await breaks `vite build` on Vite <= 6.
(async () => {
  let sim = new Sim();
  const tooltip = new Tooltip(document.getElementById("tooltip")!);
  const scene = new HeatingScene(sim);
  const chart = new HistoryChart(sim, tooltip);
  // The diagram's labels are drawn once with the font they find, so make
  // sure Nunito has loaded first (it falls back to system fonts if not).
  await document.fonts.load('600 16px "Nunito Variable"').catch(() => []);
  await scene.init(document.getElementById("scene")!);

  // The history chart lives in a collapsed <details>; create it on first open.
  const history = document.getElementById("history") as HTMLDetailsElement;
  let chartStarted = false;
  let chartReady = false;
  history.addEventListener("toggle", () => {
    if (!history.open) return;
    if (chartStarted) {
      if (chartReady) chart.render();
      return;
    }
    chartStarted = true;
    chart.init(document.getElementById("chart")!).then(() => {
      chartReady = true;
      chart.render();
    });
  });
  const chartVisible = () => history.open && chartReady;

  const controls = new Controls(sim);
  controls.build();
  // The card of controls for whatever was clicked in the scene.
  const card = new DeviceCard(
    document.getElementById("device-card")!,
    () => sim,
  );

  // Dev-only handle for poking at the simulation from the console.
  const devHandle = () => {
    if (import.meta.env.DEV)
      Object.assign(window, {
        __heating: { sim, scene, chart, controls, card, tooltip },
      });
  };
  devHandle();

  // ---- number of rooms ----
  // A different house means a different pipe network, so build a new sim
  // and cold-start it. Whole-house settings carry over, and so do the
  // settings of radiators that are still there.
  controls.onRooms = (rooms) => {
    const old = sim.params;
    const next = new Sim(makePlan(rooms));
    const p = next.params;
    p.flowSet = old.flowSet;
    p.thermostatSet = old.thermostatSet;
    p.thermostatOn = old.thermostatOn;
    p.boilerOn = old.boilerOn;
    p.insulation = old.insulation;
    p.outdoor = old.outdoor;
    p.dayNight = old.dayNight;
    old.radiators.forEach((r, k) => {
      if (k < rooms) p.radiators[k] = { ...r };
    });
    next.coldStart();
    card.close(); // its object may be gone
    sim = next;
    scene.setSim(sim);
    chart.setSim(sim);
    controls.setSim(sim);
    devHandle();
  };

  // ---- simulation speed / pause / reset ----
  // One selector: pause, then one to four arrows for the speeds. Picking a
  // speed also resumes; Space pauses and resumes at the last speed.
  let speed: number = DEFAULT_SPEED;
  let paused = false;
  const speedBox = document.getElementById("speed")!;
  const choice = (label: string, title: string, arrows: number) => {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("role", "radio");
    b.setAttribute("aria-label", label);
    b.title = title;
    b.append(playbackIcon(arrows));
    speedBox.append(b);
    return b;
  };
  const pauseBtn = choice("Pause", "Pause (Space)", 0);
  pauseBtn.addEventListener("click", () => {
    paused = true;
    syncSpeed();
  });
  const speedButtons = SPEEDS.map((s, i) => {
    const b = choice(
      `${s}× speed`,
      s === 1 ? "Real time" : `${s}× (${s} simulated seconds per second)`,
      i + 1,
    );
    b.addEventListener("click", () => {
      speed = s;
      paused = false;
      syncSpeed();
    });
    return b;
  });
  const syncSpeed = () => {
    pauseBtn.setAttribute("aria-checked", String(paused));
    speedButtons.forEach((b, i) =>
      b.setAttribute("aria-checked", String(!paused && SPEEDS[i] === speed)),
    );
  };
  const togglePause = () => {
    paused = !paused;
    syncSpeed();
  };
  document.getElementById("btn-reset")!.addEventListener("click", () => {
    // Cold start: rooms, water, pipes and TRV sensors all at the outdoor
    // temperature, as when the page opens.
    sim.coldStart();
    if (chartVisible()) chart.render();
  });
  document.addEventListener("keydown", (e) => {
    const tag = (e.target as HTMLElement).tagName;
    if (
      e.code === "Space" &&
      tag !== "INPUT" &&
      tag !== "BUTTON" &&
      tag !== "SUMMARY"
    ) {
      e.preventDefault();
      togglePause();
    }
  });
  syncSpeed();

  // ---- hover, clicks and scrolling in the scene ----
  // Objects you can change (boiler, thermostat, valves, outside, walls and
  // loft) show their details in a bubble fixed beside them; clicking pins
  // the bubble and adds their controls. Everything else (water, pipes,
  // rooms) gets a tooltip that follows the pointer.
  let hover: Hit | null = null;
  let pointer = { x: 0, y: 0 }; // client
  // Detail: off by default -> just the title and headline value.
  const detailToggle = document.getElementById("i-details")!;
  let detailed = false;
  const tipFor = (hit: Hit, hint?: string): TipContent => {
    const c = describe(hit, sim);
    return detailed
      ? { ...c, hint }
      : { title: c.title, value: c.value, swatch: c.swatch, rows: [], hint };
  };
  const hintFor = (hit: Hit) =>
    hit.kind === "power" || hit.kind === "thermostat-power"
      ? "Click to switch on or off"
      : targetFor(hit)?.kind === "insulation"
        ? "Click to change the insulation"
        : CLICKABLE.has(hit.kind)
          ? "Click to change"
          : undefined;
  /** Bring the bubble's details and the pointer tooltip up to date. */
  const refreshTips = () => {
    const about = card.subject;
    if (about)
      card.setInfo(tipFor(about, card.pinned ? undefined : hintFor(about)));
    if (hover && !bubbleFor(hover))
      tooltip.show(tipFor(hover), pointer.x, pointer.y);
    else tooltip.hide();
  };

  // Where the bubble points: always the same spot for the same thing.
  let bubbleAnchor: Rect = { x: 0, y: 0, w: 0, h: 0 };
  const anchorOf = (t: CardTarget, part: Hit) =>
    anchorFor(t, scene.houseLayout, part.kind);
  const anchorOnPage = () => scene.toPage(bubbleAnchor);
  const drawingOnPage = () => scene.drawingOnPage();

  // Hovering an object peeks at it (unless a bubble is pinned open).
  let peekKey = "";
  const showHover = () => {
    const t = bubbleFor(hover);
    if (!card.pinned) {
      if (!t || !hover) card.close();
      else {
        // Pointing at the same spot as now: the bubble stays put.
        const anchor = anchorOf(t, hover);
        const key = `${t.kind}:${JSON.stringify(anchor)}`;
        if (card.isOpen(t) && key === peekKey) card.setSubject(hover);
        else {
          peekKey = key;
          bubbleAnchor = anchor;
          card.peek(t, hover, anchorOnPage, drawingOnPage);
        }
      }
    }
    refreshTips();
  };
  let hoverKey = "";
  scene.onHover = (hit, x, y) => {
    hover = hit;
    pointer = { x, y };
    const key = hit ? `${hit.kind}:${hit.cell ?? ""}:${hit.room ?? ""}` : "";
    if (key === hoverKey) {
      // Same thing: the bubble stays put; the pointer tooltip follows.
      if (hit && !bubbleFor(hit)) tooltip.move(x, y);
      return;
    }
    hoverKey = key;
    showHover();
  };

  // Click an object to pin its bubble open with the controls; click it (or
  // anywhere else) again to close. The power buttons switch straight away.
  scene.onClick = (hit) => {
    if (hit && togglePower(sim.params, hit)) {
      card.sync();
      refreshTips();
      return;
    }
    const t = targetFor(hit);
    // Nothing to open: close a pinned bubble (a peek stays with the pointer).
    if (!t || !hit) {
      if (card.pinned) card.close();
      return;
    }
    if (card.pinned && card.isOpen(t)) {
      card.close();
      return;
    }
    // Pinned where it was peeking; otherwise beside the clicked object.
    if (!card.isOpen(t)) bubbleAnchor = anchorOf(t, hit);
    card.pin(t, hit, anchorOnPage, drawingOnPage);
    refreshTips();
  };
  card.onClose = (wasPinned) => {
    peekKey = "";
    // Back to peeking at whatever the pointer is over.
    if (wasPinned) showHover();
  };
  card.onChange = refreshTips;
  scene.onAdjust = (hit, dir) => {
    nudge(sim.params, hit, dir);
    card.sync();
    refreshTips();
  };

  // Close a pinned bubble with Escape, or by clicking away from it (the top
  // bar doesn't count, so the speed can change while it's open).
  const topbar = document.querySelector(".topbar")!;
  document.addEventListener("pointerdown", (e) => {
    const t = e.target as Node;
    if (
      card.pinned &&
      !card.contains(t) &&
      t !== scene.app.canvas &&
      !topbar.contains(t)
    )
      card.close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && card.pinned) card.close();
  });
  window.addEventListener("resize", () => card.place());

  // View options in the top bar: pressed / not pressed.
  const toggle = (
    btn: HTMLElement,
    on: boolean,
    apply: (on: boolean) => void,
  ) => {
    btn.setAttribute("aria-pressed", String(on));
    btn.addEventListener("click", () => {
      on = !on;
      btn.setAttribute("aria-pressed", String(on));
      apply(on);
    });
  };
  toggle(detailToggle, detailed, (on) => {
    detailed = on;
    refreshTips();
  });
  // Heat-loss arrows: off by default.
  toggle(document.getElementById("i-losses")!, scene.showLosses, (on) => {
    scene.showLosses = on;
  });

  // ---- main loop (driven by the scene's ticker) ----
  const clock = document.getElementById("clock")!;
  let uiTimer = 0;
  let chartTimer = 1;
  let tipTimer = 0;
  scene.app.ticker.add((ticker) => {
    // Real time since last frame. elapsedMS isn't capped by minFPS, so sim time
    // keeps pace on slow machines; clamp it so a tab returning from the
    // background doesn't leap ahead by hours.
    const dt = Math.min(ticker.elapsedMS / 1000, 0.5);
    const s = paused ? 0 : speed;
    if (s > 0) sim.advance(dt * s);
    scene.update(dt, s);

    uiTimer += dt;
    chartTimer += dt;
    tipTimer += dt;
    if (uiTimer >= 0.2) {
      uiTimer = 0;
      // The clock only matters while the outside follows the time of day.
      clock.hidden = !sim.params.dayNight;
      // At real time the minutes barely move, so show the seconds ticking.
      if (!clock.hidden)
        clock.textContent = formatTimeOfDay(sim.time, speed === 1);
      // Follow the drawing if the page around it moves (e.g. the clock
      // appearing re-wraps the top bar).
      card.place();
    }
    if (chartTimer >= 0.5) {
      chartTimer = 0;
      if (chartVisible()) {
        chart.render();
        controls.updateTable();
      }
    }
    if ((hover || card.subject) && tipTimer >= 0.15) {
      tipTimer = 0;
      refreshTips();
    }
  });
})();
