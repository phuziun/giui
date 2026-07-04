// Full-page GI-Lite canvas — a drop-in alternative to GICanvas providing the
// SAME GIContext, so every kit component, useGIShape, and useGIScreen work
// unchanged. Select it with <GIProvider params={{ engine: "lite" }}> or the
// Studio Render → engine control.
//
// Deliberately simpler than GICanvas: no adaptive quality, no frame pacing,
// no band/dirty-rect logic — the lite pipeline is cheap enough to re-render
// the whole viewport window on any change (scroll included). Kept: on-demand
// rendering (idle = zero GPU), the content-anchored viewport window, ambient
// throttle for continuous animations, StrictMode/device-loss hygiene.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { GIContext, OVERSCAN } from "../gi/GIContext";
import { initWebGPU } from "../gi/device";
import { Scene } from "../gi/scene";
import type { GIParams, Shape } from "../gi/types";
import type { ScreenSource } from "../gi/renderer";
import type { ScreenSpec } from "../gi/GIContext";
import { Renderer2, GI2_DEFAULTS, type Gi2Params } from "./renderer2";

// Map the shared GIParams (Studio-driven) onto the lite engine's params.
// Distance/look values transfer 1:1; the cascade-specific transport knobs
// (cascadeCount, d0, …) have lite equivalents with their own defaults.
function mapParams(p: GIParams): Gi2Params {
  return {
    ...GI2_DEFAULTS,
    occlusion: p.occlusion,
    ambient: p.ambient,
    keyIntensity: p.keyIntensity,
    keyDir: p.keyDir,
    keyColor: p.keyColor,
    fillDir: p.fillDir,
    fillColor: p.fillColor,
    fillIntensity: p.fillIntensity,
    material: p.material,
    tintAmount: p.tintAmount,
    emissiveDisplay: p.emissiveDisplay,
    normalStrength: p.normalStrength,
    heightScale: p.heightScale,
    rolloff: p.rolloff,
    edgeBias: p.edgeBias,
    edgeAA: p.edgeAA,
    giStrength: p.giStrength,
    giDirectional: p.giDirectional,
    giBackground: p.giBackground,
    aoStrength: p.aoStrength,
    aoRadius: p.aoRadius,
    shadowStrength: p.shadowStrength,
    // Offset-shadow reach ≈ the marched engine's feel: shadowHeight is px of
    // travel per height unit there; 0.8 calibrated visually.
    shadowScale: p.shadowHeight * 0.8,
    shadowSoftness: p.shadowSoftness * 20,
    exposure: p.exposure,
    grain: p.grain,
    surfaceTexture: p.surfaceTexture,
    textureScale: p.textureScale,
  };
}

export function GICanvasLite({
  params,
  onError,
  onGPUInfo,
  children,
}: {
  params: GIParams;
  onError?: (message: string) => void;
  onGPUInfo?: (info: { gpuName: string; softwareGPU: boolean }) => void;
  children: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef(new Scene());
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const needsRender = useRef(true);
  const [status, setStatus] = useState<"init" | "ok" | "error">("init");
  const [error, setError] = useState("");
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onGPUInfoRef = useRef(onGPUInfo);
  onGPUInfoRef.current = onGPUInfo;
  const [gen, setGen] = useState(0);
  const lostInfo = useRef({ count: 0, at: 0 });
  const renderCount = useRef(0);

  const setShape = useRef((id: string, shape: Shape | null) => {
    const changed = shape ? sceneRef.current.set(id, shape) : sceneRef.current.remove(id);
    if (changed) needsRender.current = true;
  }).current;

  const screenRef = useRef<ScreenSpec | null>(null);
  const setScreen = useRef((spec: ScreenSpec | null) => {
    screenRef.current = spec;
    needsRender.current = true;
  }).current;

  useEffect(() => {
    needsRender.current = true;
  }, [params]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const root = rootRef.current!;
    let disposed = false;
    let raf = 0;
    let renderer: Renderer2 | null = null;
    let gpuDevice: GPUDevice | null = null;
    let onScroll: (() => void) | null = null;
    let onInteract: (() => void) | null = null;
    let lastInteraction = performance.now();
    let lastRender = 0;
    let lastTop = -1;
    let beaconTimer = 0;

    const applySize = () => {
      const dpr = window.devicePixelRatio || 1;
      const cssW = Math.max(8, root.clientWidth);
      const cssH = window.innerHeight + 2 * OVERSCAN;
      const w = Math.max(8, Math.floor(cssW * dpr));
      const h = Math.max(8, Math.floor(cssH * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        needsRender.current = true;
      }
    };

    (async () => {
      try {
        const ctx = await initWebGPU(canvas);
        if (disposed) {
          ctx.device.destroy();
          return;
        }
        gpuDevice = ctx.device;
        ctx.device.lost.then((info) => {
          if (disposed || info.reason === "destroyed") return;
          const now = Date.now();
          if (now - lostInfo.current.at > 30000) lostInfo.current.count = 0;
          lostInfo.current.at = now;
          if (++lostInfo.current.count <= 3) {
            console.warn(`[giui] GPU device lost (${info.message || "unknown"}) — reinitializing (lite).`);
            setGen((g) => g + 1);
          } else {
            const msg = "GPU device repeatedly lost — lighting disabled (the UI still works unlit). Reload to retry.";
            setError(msg);
            setStatus("error");
            onErrorRef.current?.(msg);
          }
        });
        renderer = await Renderer2.create(ctx);
        if (disposed) {
          renderer.destroy();
          ctx.device.destroy();
          return;
        }
        onGPUInfoRef.current?.({ gpuName: ctx.gpuName, softwareGPU: ctx.softwareGPU });
        (window as unknown as {
          __giInit?: { deviceMs: number; pipelineMs: number; gpu: string; software: boolean; engine: string };
        }).__giInit = {
          deviceMs: 0,
          pipelineMs: Math.round(renderer.pipelineMs),
          gpu: ctx.gpuName,
          software: ctx.softwareGPU,
          engine: "lite",
        };
        applySize();
        setStatus("ok");
        needsRender.current = true;

        // Minimal dev beacon (same diagSink as the main engine, tagged lite) —
        // lets headless/Safari runs report without devtools. Stops on the
        // first non-ok response, like the main beacon.
        if (import.meta.env.DEV) {
          let renders0 = 0;
          const send = () => {
            fetch("/__giui-diag", {
              method: "POST",
              body: JSON.stringify({
                t: new Date().toISOString().slice(11, 19),
                engine: "lite",
                gpu: ctx.gpuName,
                renders: renderCount.current,
                dRenders: renderCount.current - renders0,
                win: `${window.innerWidth}x${window.innerHeight}@${window.devicePixelRatio}`,
              }),
            })
              .then((res) => {
                if (!res.ok) window.clearInterval(beaconTimer);
              })
              .catch(() => window.clearInterval(beaconTimer));
            renders0 = renderCount.current;
          };
          beaconTimer = window.setInterval(send, 4000);
        }

        onScroll = () => {
          needsRender.current = true;
        };
        window.addEventListener("scroll", onScroll, { capture: true, passive: true });
        window.addEventListener("resize", applySize);
        onInteract = () => {
          lastInteraction = performance.now();
        };
        for (const ev of ["pointermove", "pointerdown", "wheel", "keydown"]) {
          window.addEventListener(ev, onInteract, { passive: true });
        }

        const loop = () => {
          if (disposed) return;
          raf = requestAnimationFrame(loop);
          const now = performance.now();
          const rootRect = root.getBoundingClientRect();
          const scrollY = -rootRect.top;
          const top = Math.max(0, scrollY - OVERSCAN);
          const offsetMoved = top !== lastTop;

          // Screen (hero picture): re-render while visible (its frames animate).
          let screen: ScreenSource | undefined;
          let screenActive = false;
          const spec = screenRef.current;
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
            const vh = window.innerHeight;
            screenActive = screen.y + screen.h > scrollY - 250 && screen.y < scrollY + vh + 250;
          }

          if (!needsRender.current && !screenActive && !offsetMoved) return;
          // Ambient throttle: continuous animation with no input for 1.5s
          // renders at ~30Hz so an idle tab doesn't churn the compositor.
          const ambient = now - lastInteraction > 1500;
          if (ambient && now - lastRender < 33 && !offsetMoved) return;
          needsRender.current = false;
          lastTop = top;
          lastRender = now;

          const dpr = window.devicePixelRatio || 1;
          const cssW = Math.max(8, root.clientWidth);
          const cssH = window.innerHeight + 2 * OVERSCAN;
          // Commit the window position in the same task as the frame.
          canvas.style.transform = `translate3d(0, ${top}px, 0)`;
          renderer!.render(sceneRef.current, mapParams(paramsRef.current), cssW, cssH, dpr, top, screen);
          renderCount.current++;
          canvas.style.opacity = "1";
        };
        raf = requestAnimationFrame(loop);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        setStatus("error");
        onErrorRef.current?.(msg);
      }
    })();

    const ro = new ResizeObserver(() => {
      applySize();
      needsRender.current = true;
    });
    ro.observe(root);
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      if (beaconTimer) window.clearInterval(beaconTimer);
      ro.disconnect();
      renderer?.destroy();
      gpuDevice?.destroy();
      if (onScroll) window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", applySize);
      if (onInteract) {
        for (const ev of ["pointermove", "pointerdown", "wheel", "keydown"]) {
          window.removeEventListener(ev, onInteract);
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- gen re-runs init after device loss
  }, [gen]);

  return (
    <GIContext.Provider value={{ rootRef, setShape, setScreen, componentGlow: params.componentGlow }}>
      <div ref={rootRef} style={{ position: "relative", width: "100%", minHeight: "100vh", overflow: "clip", background: "#1e222b" }}>
        <canvas
          ref={canvasRef}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: `calc(100vh + ${OVERSCAN * 2}px)`,
            willChange: "transform",
            display: "block",
            zIndex: 0,
            opacity: 0,
            transition: "opacity 0.4s ease",
          }}
        />
        <div style={{ position: "relative", zIndex: 1 }}>{children}</div>
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
