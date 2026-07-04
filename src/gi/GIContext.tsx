import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { initWebGPU } from "./device";
import { Renderer, type ScreenSource } from "./renderer";
import { Scene } from "./scene";
import { DEFAULT_PARAMS, type GIParams, type Shape } from "./types";

type ScreenSpec = {
  el: HTMLElement;
  source: HTMLCanvasElement;
  emit: number;
  display: number;
  topFade: number;
  topFadeH: number;
};

type GIContextValue = {
  rootRef: React.RefObject<HTMLDivElement | null>;
  setShape: (id: string, shape: Shape | null) => void;
  setScreen: (spec: ScreenSpec | null) => void;
  componentGlow: number;
};

const GIContext = createContext<GIContextValue | null>(null);

// Extra rows rendered above/below the viewport (css px) in viewport-canvas
// mode, so emitters just off-screen still light the visible edge.
const OVERSCAN = 200;

// Bumped manually with meaningful renderer changes: shows up in the HUD and
// the diag beacon, so a stale tab (dead HMR socket, old bundle) is instantly
// recognizable in the diagnostics instead of masquerading as a perf problem.
export const GI_BUILD = "content-canvas-7";

export function useGI(): GIContextValue {
  const ctx = useContext(GIContext);
  if (!ctx) throw new Error("GI components must be rendered inside <GICanvas>");
  return ctx;
}

// Attach an element as the "screen": the given canvas (must be SCREEN_TEX_W×H
// from renderer.ts) is shown on — and emitted from — the element's rect.
export function useGIScreen(
  source: HTMLCanvasElement | null,
  opts: { emit?: number; display?: number; topFade?: number; topFadeH?: number } = {}
) {
  const { setScreen } = useGI();
  const elRef = useRef<HTMLDivElement | null>(null);
  const emit = opts.emit ?? 0.3;
  const display = opts.display ?? 2;
  const topFade = opts.topFade ?? 0;
  const topFadeH = opts.topFadeH ?? 0.4;
  useEffect(() => {
    const el = elRef.current;
    if (!source || !el) return;
    setScreen({ el, source, emit, display, topFade, topFadeH });
    return () => setScreen(null);
  }, [source, emit, display, topFade, topFadeH, setScreen]);
  return elRef;
}

export function GICanvas({
  params = DEFAULT_PARAMS,
  showPerf = false,
  onError,
  onGPUInfo,
  children,
}: {
  params?: GIParams;
  showPerf?: boolean;
  /** Called when the lighting layer fails (no WebGPU, repeated device loss).
   *  The DOM UI keeps working unlit either way; this is for consumers who want
   *  to log it or show their own notice instead of the built-in corner chip. */
  onError?: (message: string) => void;
  /** Called once after device init with the adapter identity — drives
   *  quality="auto" and lets consumers log/report the GPU tier. */
  onGPUInfo?: (info: { gpuName: string; softwareGPU: boolean }) => void;
  children: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const perfRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef(new Scene());
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onGPUInfoRef = useRef(onGPUInfo);
  onGPUInfoRef.current = onGPUInfo;
  // Bumped to re-run the whole init effect after an unexpected GPU device loss
  // (driver reset, GPU switch on a dual-GPU laptop, TDR): the scene survives in
  // React state, so re-init restores lighting without losing any UI state.
  const [gen, setGen] = useState(0);
  const lostInfo = useRef({ count: 0, at: 0 });

  // Drives on-demand rendering: passes only run on a frame where this is set.
  // needsRender = a shape changed (may be skippable if off-screen);
  // forceRender = params/resize/init (never skippable, forces a full render).
  const needsRender = useRef(true);
  const forceRender = useRef(true);
  // Canvas backing px per css px (≤ dpr — the backing store is capped, see resize).
  const backingScale = useRef(1);
  const resizeRef = useRef<() => void>(() => {});

  const [status, setStatus] = useState<"init" | "ok" | "error">("init");
  const [error, setError] = useState<string>("");

  // Stable scene mutation API; only flags a render when something truly changed.
  const setShape = useRef((id: string, shape: Shape | null) => {
    const changed = shape
      ? sceneRef.current.set(id, shape)
      : sceneRef.current.remove(id);
    if (changed) needsRender.current = true;
  }).current;

  // At most one active screen (a rect that displays + emits a canvas picture).
  const screenRef = useRef<ScreenSpec | null>(null);
  const setScreen = useRef((spec: ScreenSpec | null) => {
    screenRef.current = spec;
    forceRender.current = true; // appearing/disappearing changes lighting broadly
  }).current;

  // Any parameter change needs a full redraw (and may change the backing cap).
  useEffect(() => {
    forceRender.current = true;
    resizeRef.current();
  }, [params]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const root = rootRef.current!;
    let renderer: Renderer | null = null;
    let gpuDevice: GPUDevice | null = null;
    let raf = 0;
    let disposed = false;
    let onScrollHandler: (() => void) | null = null;
    let onInteractHandler: (() => void) | null = null;
    let gpuLabel = "";
    let beaconTimer = 0;
    let beaconKick = 0;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const viewport = paramsRef.current.viewportCanvas;
      const cssW = Math.max(1, root.clientWidth);
      // Viewport mode: the canvas is a fixed, viewport-sized window onto the
      // content (+ overscan so lights just off-screen still contribute).
      // Page mode: it spans the whole content (clamped to GPU texture limits).
      const cssH = viewport
        ? window.innerHeight + 2 * OVERSCAN
        : Math.max(1, Math.min(root.clientHeight, 8100 / Math.max(0.1, backingScale.current)));
      // Cap the canvas BACKING store width at the GI render cap. The GI is
      // computed at ≤ maxResolution wide anyway, so a hi-dpi backing above
      // that only makes the present pass shade (and the swapchain allocate)
      // dpr²× more pixels over the whole page height for no added lighting
      // detail — on a 2× display with a long page that alone is tens of
      // millions of pixels per animated frame. DOM text is unaffected.
      const capW = Math.max(640, paramsRef.current.maxResolution);
      const k = Math.min(dpr, capW / cssW);
      backingScale.current = k;
      const w = Math.max(1, Math.floor(cssW * k));
      const h = Math.max(1, Math.floor(cssH * k));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        forceRender.current = true;
      }
    };
    resizeRef.current = resize;

    (async () => {
      try {
        resize();
        const tInit = performance.now();
        const ctx = await initWebGPU(canvas);
        // StrictMode aborts the first mount mid-init: the cleanup below already
        // ran (renderer/gpuDevice were still null), so the freshly acquired
        // device must be destroyed HERE or it leaks one device per dev mount.
        if (disposed) { ctx.device.destroy(); return; }
        gpuDevice = ctx.device;
        // Unexpected device loss (driver reset, dual-GPU switch, TDR — NOT our
        // own destroy()): re-run this effect for a fresh device + pipelines.
        // The scene lives in React state, so lighting comes back where it was.
        // A device that keeps dying (>3 losses within 30s of each other) stops
        // retrying and surfaces the error; the DOM UI stays usable unlit.
        ctx.device.lost.then((info) => {
          if (disposed || info.reason === "destroyed") return;
          const now = Date.now();
          if (now - lostInfo.current.at > 30000) lostInfo.current.count = 0;
          lostInfo.current.at = now;
          if (++lostInfo.current.count <= 3) {
            console.warn(`[giui] GPU device lost (${info.message || "unknown"}) — reinitializing.`);
            setGen((g) => g + 1);
          } else {
            const msg = "GPU device repeatedly lost — lighting disabled (the UI still works unlit). Reload to retry.";
            console.error(`[giui] ${msg}`);
            setError(msg);
            setStatus("error");
            onErrorRef.current?.(msg);
          }
        });
        const tDevice = performance.now();
        renderer = await Renderer.create(ctx); // async pipeline compile — no main-thread freeze
        if (disposed) { renderer.destroy(); ctx.device.destroy(); return; }
        (window as unknown as {
          __giInit?: { deviceMs: number; pipelineMs: number; gpu: string; software: boolean };
        }).__giInit = {
          deviceMs: Math.round(tDevice - tInit),
          pipelineMs: Math.round(renderer.pipelineMs),
          gpu: ctx.gpuName,
          software: ctx.softwareGPU,
        };
        gpuLabel = ctx.softwareGPU ? `⚠ SOFTWARE GPU (${ctx.gpuName})` : ctx.gpuName;
        onGPUInfoRef.current?.({ gpuName: ctx.gpuName, softwareGPU: ctx.softwareGPU });
        forceRender.current = true;
        setStatus("ok");

        // On-demand rendering with an adaptive resolution scale: during a burst
        // of consecutive frames (interaction) we watch the inter-frame time and
        // step the GI resolution down if we're missing budget, then restore full
        // quality with one crisp frame once things go idle.
        let dynScale = 1;
        let emaDt = 16;
        let lastRender = 0;
        let lastRestore = 0;
        let activeStreak = 0;
        let slowStreak = 0; // consecutive slow frames — one-off hiccups don't downscale
        // Few, coarse quality levels: every distinct scale is a full texture
        // reallocation (rebuild), so fine 0.1 steps churned hundreds of MB.
        const LEVELS = [1, 0.7, 0.5];
        const stepDown = (s: number) => LEVELS.find((l) => l < s) ?? LEVELS[LEVELS.length - 1];
        const stepUp = (s: number) => [...LEVELS].reverse().find((l) => l > s) ?? 1;
        // Boot frames (texture allocs, first full render, driver warm-up) are
        // unrepresentative — don't let them poison the quality level.
        const bootAt = performance.now();
        let lastProbe = 0;
        // Quality transitions (probe up / restore) rebuild textures + force a
        // full-page render — a visible hitch. Never do that mid-scroll.
        let lastScroll = 0;
        onScrollHandler = () => {
          lastScroll = performance.now();
          // Viewport mode: the fixed canvas must re-render at the new offset.
          if (paramsRef.current.viewportCanvas) needsRender.current = true;
        };
        window.addEventListener("scroll", onScrollHandler, { capture: true, passive: true });
        window.addEventListener("resize", resize);

        const restoreQuality = (now: number) => {
          // Rendering has been quiet for a while while downscaled: restore full
          // quality with one crisp frame. The quiet period + cooldown matter:
          // restoring eagerly (e.g. on any skipped frame) made the restore
          // frame itself register as "slow", stepping quality back down, then
          // restoring again — an oscillation of full-page renders + texture
          // reallocations that felt like sustained slowness.
          if (
            adaptiveOn() &&
            dynScale < 1 &&
            now - lastRender > 600 &&
            now - lastRestore > 8000 &&
            now - lastScroll > 1000
          ) {
            dynScale = 1;
            activeStreak = 0;
            lastRestore = now;
            forceRender.current = true;
          }
        };
        const adaptiveOn = () => paramsRef.current.adaptiveQuality;

        // Lightweight perf probe (readable as window.__giPerf) — rAF cadence,
        // render/skip counts, CPU submit time. Negligible cost; used to
        // diagnose real frame rate on real hardware.
        type GIPerf = { dts: number[]; renders: number; skips: number; renderMs: number; scale: number };
        const perfStat: GIPerf = ((window as unknown as { __giPerf?: GIPerf }).__giPerf ??= {
          dts: [], renders: 0, skips: 0, renderMs: 0, scale: 1,
        });
        // Dev probe: simulate a leva-style param change (forces a full render).
        (window as unknown as { __giForceRender?: () => void }).__giForceRender = () => {
          forceRender.current = true;
        };

        // Dev-only diagnostics beacon: every 4s, report this tab's real numbers
        // to the dev server (vite `diagSink` middleware → .giui-diag.jsonl).
        if (import.meta.env.DEV) {
          const send = () => {
            const d = [...perfStat.dts].sort((a, b) => a - b);
            const q = (f: number) => +(d[Math.min(d.length - 1, Math.floor(d.length * f))] ?? 0).toFixed(1);
            const init = (window as unknown as { __giInit?: object }).__giInit ?? {};
            fetch("/__giui-diag", {
              method: "POST",
              body: JSON.stringify({
                t: new Date().toISOString().slice(11, 19),
                build: GI_BUILD,
                ...init,
                p50: q(0.5),
                p95: q(0.95),
                fps: q(0.5) ? +(1000 / q(0.5)).toFixed(0) : 0,
                scale: perfStat.scale,
                renders: perfStat.renders,
                skips: perfStat.skips,
                canvas: `${canvas.width}x${canvas.height}`,
                win: `${window.innerWidth}x${window.innerHeight}@${window.devicePixelRatio}`,
                visible: document.visibilityState,
                port: location.port,
                pace: halfRate ? "half" : "full",
                hz: Math.round(1000 / vsyncEst),
                ambient: performance.now() - lastInteraction > 1500,
              }),
            })
              .then((res) => {
                // Only THIS repo's dev server has the diagSink middleware. A
                // consumer who vendors the source and runs their own `vite dev`
                // answers 404 — stop after the first miss so their network tab
                // isn't spammed with a POST every 4s (which reads as the
                // library phoning home).
                if (!res.ok) window.clearInterval(beaconTimer);
              })
              .catch(() => window.clearInterval(beaconTimer));
          };
          beaconTimer = window.setInterval(send, 4000);
          beaconKick = window.setTimeout(send, 1500);
        }
        let lastLoop = 0;
        let lastHud = 0;
        let lastLoopOffset = -1;
        // --- Frame pacing -------------------------------------------------
        // On a high-refresh display (120Hz ProMotion), a render that takes
        // slightly over one vsync (e.g. 11ms > 8.3ms) produces frames that
        // alternate between 1 and 2 vsyncs — judder that *feels* far worse
        // than a stable lower rate ("80fps feels like 4fps"), especially
        // against compositor-perfect DOM scrolling. When sustained rendering
        // can't hit the display rate, lock to every OTHER vsync: a perfectly
        // stable half rate. Re-probe full rate every few seconds.
        let vsyncEst = 16.7; // rolling-median estimate of the display's vsync period
        let vsyncTick = 0;
        let halfRate = false;
        let halfTick = false;
        let lastPaceSwitch = 0;
        // Ambient throttle: with no user input, continuous animations (loaders,
        // pulsing dots) only re-render the GI at ~30Hz. The system compositor
        // otherwise never rests this window — enough sustained present traffic
        // to make even macOS Space transitions stutter. Interaction restores
        // full rate on the very next frame.
        let lastInteraction = performance.now();
        let ambientTick = 0;
        onInteractHandler = () => {
          lastInteraction = performance.now();
        };
        for (const ev of ["pointermove", "pointerdown", "wheel", "keydown"]) {
          window.addEventListener(ev, onInteractHandler, { passive: true });
        }

        const loop = () => {
          if (disposed) return;
          const now = performance.now();
          if (lastLoop) {
            const dtLoop = now - lastLoop;
            perfStat.dts.push(dtLoop);
            if (perfStat.dts.length > 600) perfStat.dts.shift();
            // The loop ticks every vsync (all skip paths still rAF), so the
            // MEDIAN of recent tick intervals IS the display's vsync period
            // (8.3ms @120Hz, 16.7 @60Hz). A min-based estimate latched onto
            // spuriously fast double-ticks and made the governor overreact.
            if (++vsyncTick % 30 === 0 && perfStat.dts.length >= 30) {
              const recent = [...perfStat.dts.slice(-48)].sort((a, b) => a - b);
              vsyncEst = Math.max(3, recent[Math.floor(recent.length / 2)]);
            }
          }
          lastLoop = now;
          const scene = sceneRef.current;

          // An active screen's picture animates every frame; the ambient
          // throttle below still caps its idle cost.
          if (screenRef.current) needsRender.current = true;

          // Scroll tail: keep tracking the offset for a moment after the last
          // scroll event so momentum settling / snap-back can't leave the
          // light field a hair off the content.
          if (paramsRef.current.viewportCanvas && now - lastScroll < 250) {
            needsRender.current = true;
          }

          // Half-rate pacing: render only every other vsync while engaged,
          // and periodically probe whether full rate has become sustainable.
          halfTick = !halfTick;
          if (halfRate && now - lastPaceSwitch > 4000) {
            halfRate = false; // probe full rate; re-trips quickly if still slow
            lastPaceSwitch = now;
            emaDt = vsyncEst;
          }
          if (halfRate && halfTick) {
            raf = requestAnimationFrame(loop);
            return; // pending needsRender/forceRender stay armed for next tick
          }
          // Ambient throttle (~30Hz) for input-less continuous animation.
          // Never delays forced renders (params/resize) or structural changes
          // (menus/dialogs mounting), and scroll counts as interaction.
          if (
            needsRender.current &&
            !forceRender.current &&
            now - lastInteraction > 1500 &&
            now - lastScroll > 1500 &&
            !scene.hasStructural()
          ) {
            ambientTick++;
            const every = Math.max(1, Math.round(33.3 / vsyncEst));
            if (ambientTick % every !== 0) {
              raf = requestAnimationFrame(loop);
              return;
            }
          }

          if (forceRender.current || needsRender.current) {
            // Visible content slice in css px, from the IN-FLOW root (the
            // canvas itself may be fixed in viewport mode).
            const mode = paramsRef.current.viewportCanvas ? "viewport" : "page";
            const rootRect = root.getBoundingClientRect();
            let top: number;
            let height: number;
            if (mode === "viewport") {
              top = -rootRect.top - OVERSCAN; // content coord of texture row 0
              height = window.innerHeight + 2 * OVERSCAN;
            } else {
              top = Math.max(0, -rootRect.top);
              const vBot = Math.min(rootRect.height, -rootRect.top + window.innerHeight);
              height = Math.max(0, vBot - top);
            }
            const offsetMoved = mode === "viewport" && top !== lastLoopOffset;

            // Screen: measure its rect (content coords) and whether it's near
            // the visible slice — an on-screen animated picture must render.
            let screen: ScreenSource | undefined;
            const spec = screenRef.current;
            let screenActive = false;
            if (spec && spec.el.isConnected) {
              const r = spec.el.getBoundingClientRect();
              screen = {
                x: r.left - rootRect.left,
                y: r.top - rootRect.top,
                w: r.width,
                h: r.height,
                source: spec.source,
                emit: spec.emit,
                display: spec.display,
                topFade: spec.topFade,
                topFadeH: spec.topFadeH,
              };
              screenActive = screen.y + screen.h > top - 250 && screen.y < top + height + 250;
            }

            // If every pending change is far off-screen (an animation scrolled
            // out of view), skip the frame entirely — it re-arms itself if it
            // keeps animating, and scrolling brings it back into this check.
            const mustRender =
              forceRender.current || scene.hasStructural() || offsetMoved || screenActive;
            if (!mustRender && !scene.dirtyIntersects(top - 250, top + height + 250)) {
              needsRender.current = false;
              perfStat.skips++;
              restoreQuality(now);
            } else {
              forceRender.current = false;
              needsRender.current = false;
              lastLoopOffset = top;
              const t0 = performance.now();
              renderer!.render(
                scene,
                paramsRef.current,
                backingScale.current,
                adaptiveOn() ? dynScale : 1,
                { top, height },
                mode,
                screen
              );
              // Position the viewport canvas at the content offset it was just
              // rendered for — same task as the render, so the new frame and
              // its position commit to the compositor atomically. In content
              // space the canvas then scrolls WITH the page until the next
              // render, keeping stale lighting glued to its content instead of
              // drifting. (Page mode: the canvas is inset:0, no transform.)
              canvas.style.transform =
                mode === "viewport" ? `translate3d(0px, ${top}px, 0px)` : "";
              perfStat.renderMs = perfStat.renderMs * 0.9 + (performance.now() - t0) * 0.1;
              perfStat.renders++;
              perfStat.scale = dynScale;
              scene.clearDirtyRange();
              // First lit frame: fade the canvas in instead of popping from the
              // flat (unlit) page background.
              if (canvas.style.opacity !== "1") canvas.style.opacity = "1";

              const dt = now - lastRender;
              lastRender = now;
              // Ambient-throttled frames have deliberately long dt — they must
              // not read as "slow" to the pacing/quality governors.
              const ambientNow = now - lastInteraction > 1500 && now - lastScroll > 1500;
              if (adaptiveOn() && now - bootAt > 2500 && !ambientNow) {
                if (dt < 60) {
                  // Consecutive frames => actively rendering; adapt on smoothed dt.
                  activeStreak++;
                  slowStreak = 0;
                  emaDt = emaDt * 0.8 + dt * 0.2;
                  // Overload = missing the *expected* cadence (2 vsyncs when
                  // half-rate paced). First response: stable half-rate pacing
                  // (keeps full visual quality); only then trade resolution.
                  const expected = vsyncEst * (halfRate ? 2 : 1);
                  if (emaDt > expected * 1.35 && activeStreak > 20) {
                    if (!halfRate) {
                      halfRate = true;
                      lastPaceSwitch = now;
                      emaDt = vsyncEst * 2;
                    } else {
                      dynScale = stepDown(dynScale);
                      emaDt = expected; // fresh sample window at the new level
                    }
                  } else if (dynScale < 1 && activeStreak > 60 && now - lastProbe > 10000 && now - lastScroll > 1000) {
                    // Sustained fast frames at reduced quality: probe one level
                    // up. Vsync hides headroom, so this is the only recovery
                    // path while something animates continuously — if the
                    // higher level is too slow, the slow branch (2 consecutive
                    // slow frames) brings it right back down.
                    dynScale = stepUp(dynScale);
                    lastProbe = now;
                    emaDt = 16;
                  }
                } else if (activeStreak > 0 && dt < 500) {
                  // Rendering back-to-back but at a crawl — the old dt<60 gate
                  // ignored exactly this case, so a truly slow machine never
                  // adapted. Require two in a row so a one-off hiccup (GC, tab
                  // switch, the restore frame itself) doesn't trigger a
                  // rebuild-thrashing downscale.
                  activeStreak++;
                  slowStreak++;
                  if (slowStreak >= 2) {
                    dynScale = stepDown(dynScale);
                    slowStreak = 0;
                  }
                  emaDt = 16;
                } else {
                  activeStreak = 0;
                  slowStreak = 0;
                  emaDt = 16;
                }
              }
            }
          } else {
            restoreQuality(now);
          }

          // On-screen perf HUD (updated ~2×/s): rAF cadence over the last
          // second, GPU-submit CPU ms, adaptive scale, render/skip counters.
          const hud = perfRef.current;
          if (hud && now - lastHud > 500) {
            lastHud = now;
            const recent = perfStat.dts.slice(-60).sort((a, b) => a - b);
            const p50 = recent[Math.floor(recent.length / 2)] ?? 0;
            const p95 = recent[Math.floor(recent.length * 0.95)] ?? 0;
            hud.textContent =
              `${p50 ? (1000 / p50).toFixed(0) : "–"} fps  ` +
              `p95 ${p95.toFixed(1)}ms  scale ${dynScale.toFixed(1)}  ` +
              `r ${perfStat.renders} s ${perfStat.skips}  ` +
              `${canvas.width}×${canvas.height}  ${gpuLabel}  [${GI_BUILD}]`;
          }
          raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        setStatus("error");
        onErrorRef.current?.(msg);
      }
    })();

    const ro = new ResizeObserver(resize);
    ro.observe(root);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer?.destroy();
      // Deterministic teardown (and the device.lost handler sees "destroyed"
      // and stays quiet). In-flight init paths destroy their own device via
      // the `disposed` checks — this handle is still null there.
      gpuDevice?.destroy();
      if (onScrollHandler) window.removeEventListener("scroll", onScrollHandler, true);
      window.removeEventListener("resize", resize);
      if (beaconTimer) window.clearInterval(beaconTimer);
      if (beaconKick) window.clearTimeout(beaconKick);
      if (onInteractHandler) {
        for (const ev of ["pointermove", "pointerdown", "wheel", "keydown"]) {
          window.removeEventListener(ev, onInteractHandler);
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- gen re-runs init after device loss
  }, [gen]);

  return (
    <GIContext.Provider value={{ rootRef, setShape, setScreen, componentGlow: params.componentGlow }}>
      {/* The canvas spans the FULL content height and lives inside the same
          scroll flow as the content, so the compositor scrolls the lit pixels
          and the DOM together as one layer — no per-scroll re-measure, no lag.
          Shapes are measured in content coords (stable across scroll). The
          scroll container is `.stage` (overflow-y:auto). */}
      {/* overflow:clip is load-bearing in viewport-canvas mode: the canvas is
          absolute at 100vh+overscan and translated down by the scroll offset
          each render, which would otherwise EXTEND the document's scrollable
          height as you scroll (runaway "scroll past the content" — the canvas's
          transformed bottom kept pushing scrollHeight down). Clipping the root
          pins scrollHeight to the content height. It doesn't hide the visible
          canvas (content spans the page, so the viewport slice is always inside
          the root box) — only the off-screen overscan overhang is clipped. */}
      {/* minHeight 100vh (not 100%): a consumer page rarely has a full height
          chain on html/body/#root, and a collapsed root clips the canvas to a
          sliver. The background approximates the lit scene so the pre-GI
          moment (and the no-WebGPU fallback) reads dark instead of a white
          page with light text — the demo sets the same colour on <body>. */}
      <div ref={rootRef} style={{ position: "relative", width: "100%", minHeight: "100vh", overflow: "clip", background: "#1e222b" }}>
        <canvas
          ref={canvasRef}
          style={{
            ...(params.viewportCanvas
              ? {
                  // A small window onto the content (+overscan): all GPU cost is
                  // viewport-bounded regardless of page length. CONTENT-anchored
                  // (absolute + per-render translate3d — see the render loop),
                  // NOT position:fixed: a fixed canvas stands still while the
                  // compositor scrolls the DOM, so the light field visibly
                  // drifted off the content between main-thread renders (worst
                  // on fast flings / elastic overscroll). Anchored in content
                  // space, the compositor carries the last lit frame WITH the
                  // content, and each render re-positions the window atomically
                  // with its new frame.
                  position: "absolute" as const,
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: `calc(100vh + ${OVERSCAN * 2}px)`,
                  willChange: "transform",
                }
              : {
                  // Legacy: page-sized canvas scrolling natively with content.
                  position: "absolute" as const,
                  inset: 0,
                  width: "100%",
                  height: "100%",
                }),
            display: "block",
            zIndex: 0,
            opacity: 0, // faded in after the first lit frame
            transition: "opacity 0.4s ease",
          }}
        />
        <div style={{ position: "relative", zIndex: 1 }}>{children}</div>
        {showPerf && (
          <div
            ref={perfRef}
            style={{
              position: "fixed",
              left: 12,
              bottom: 12,
              zIndex: 200,
              padding: "5px 9px",
              borderRadius: 6,
              fontFamily: "ui-monospace, Menlo, monospace",
              fontSize: 11,
              color: "rgba(190,230,190,0.9)",
              background: "rgba(10,14,20,0.72)",
              pointerEvents: "none",
              whiteSpace: "pre",
            }}
          />
        )}
        {/* Compact, non-blocking notice: the DOM UI stays fully usable (just
            unlit), so a full-page veil here would break exactly the graceful
            degradation it reports. Inline-styled so it needs no app CSS. */}
        {status === "error" && (
          <div
            role="status"
            style={{
              position: "fixed",
              left: 12,
              bottom: 12,
              zIndex: 200,
              maxWidth: 340,
              padding: "10px 14px",
              borderRadius: 8,
              fontSize: 12.5,
              lineHeight: 1.45,
              color: "rgba(255, 226, 226, 0.92)",
              background: "rgba(24, 10, 12, 0.88)",
              border: "1px solid rgba(255, 120, 120, 0.25)",
              pointerEvents: "none",
            }}
          >
            <strong style={{ display: "block", fontSize: 13 }}>Lighting disabled</strong>
            {error}
          </div>
        )}
      </div>
    </GIContext.Provider>
  );
}
