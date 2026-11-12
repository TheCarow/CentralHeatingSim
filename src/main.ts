import "@fontsource-variable/nunito"; // friendly rounded type, bundled with the site
import { makePlan } from "./house/plan";
import { Sim } from "./sim/model";
import { HeatingScene } from "./scene/HeatingScene";
import type { Hit } from "./scene/hit";
import { HistoryChart, clockLabel } from "./chart/HistoryChart";
import { Tooltip } from "./ui/tooltip";
import { describe } from "./ui/describe";
import { Controls } from "./ui/controls";
import { playbackIcon } from "./ui/playbackIcon";

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

  // Dev-only handle for poking at the simulation from the console.
  const devHandle = () => {
    if (import.meta.env.DEV)
      Object.assign(window, {
        __heating: { sim, scene, chart, controls, tooltip },
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

  // ---- hover & direct manipulation in the scene ----
  let hover: Hit | null = null;
  let pointer = { x: 0, y: 0 };
  // Tooltip detail: off by default -> just the title and headline value.
  const detailToggle = document.getElementById("i-details") as HTMLInputElement;
  let detailed = false;
  detailToggle.checked = detailed;
  const tipFor = (hit: Hit) => {
    const c = describe(hit, sim);
    return detailed
      ? c
      : { title: c.title, value: c.value, swatch: c.swatch, rows: [] };
  };
  let hoverKey = "";
  scene.onHover = (hit, x, y) => {
    hover = hit;
    pointer = { x, y };
    if (!hit) {
      hoverKey = "";
      tooltip.hide();
      return;
    }
    const key = `${hit.kind}:${hit.cell ?? ""}:${hit.room ?? ""}`;
    if (key === hoverKey) {
      tooltip.move(x, y); // same element: no rebuild, just follow the pointer
      return;
    }
    hoverKey = key;
    tooltip.show(tipFor(hit), x, y);
  };
  scene.onAdjust = (hit, dir, source) => {
    controls.adjust(hit, dir, source);
    if (hover) tooltip.show(tipFor(hover), pointer.x, pointer.y);
  };

  detailToggle.addEventListener("change", () => {
    detailed = detailToggle.checked;
    if (hover) tooltip.show(tipFor(hover), pointer.x, pointer.y);
  });

  // Heat-loss arrows: off by default.
  const lossToggle = document.getElementById("i-losses") as HTMLInputElement;
  lossToggle.checked = scene.showLosses;
  lossToggle.addEventListener("change", () => {
    scene.showLosses = lossToggle.checked;
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
      if (!clock.hidden) clock.textContent = clockLabel(sim.time % 86400); // time of day only
    }
    if (chartTimer >= 0.5) {
      chartTimer = 0;
      if (chartVisible()) {
        chart.render();
        controls.updateTable();
      }
    }
    if (hover && tipTimer >= 0.15) {
      tipTimer = 0;
      tooltip.show(tipFor(hover), pointer.x, pointer.y);
    }
  });
})();
