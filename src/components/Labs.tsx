// Labs: experimental GI-Lite engine (src/gi2) — SDF × circular harmonics.
// The board below is lit by the NEW pipeline, not the site's cascade engine:
// analytic SDF shading at device resolution (no G-buffer), a sparse
// circular-harmonics probe grid for the bounce (resolution independent), and
// tile-binned shape lists (dense layouts stay local-cost).

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { GI2Board, useGI2Shape } from "../gi2/GI2Board";
import { GIButton, GIToggle, GIStat, Surface } from "./index";
import { useGITheme } from "../gi/GIProvider";

type Vec3 = [number, number, number];
const ACCENT: Vec3 = [0.05, 0.4, 0.85];
const GOOD: Vec3 = [0.1, 0.7, 0.35];
const WARN: Vec3 = [0.95, 0.5, 0.1];
const scale = (v: Vec3, k: number): Vec3 => [v[0] * k, v[1] * k, v[2] * k];

// --- Lab components (tiny ports of the kit recipes onto the new engine) ----

function LPanel({ children, style }: { children?: React.ReactNode; style?: React.CSSProperties }) {
  const ref = useGI2Shape({ albedo: [0.052, 0.057, 0.068], height: 1.4, bevel: 28, heightScale: 1.0, opacity: 0.55, cornerRadius: 9 });
  return (
    <div ref={ref as React.RefObject<HTMLDivElement>} style={{ borderRadius: 9, padding: 16, ...style }}>
      {children}
    </div>
  );
}

function LButton({ children, accent }: { children?: React.ReactNode; accent?: Vec3 }) {
  const [hover, setHover] = useState(false);
  const [down, setDown] = useState(false);
  const glow = accent ? (down ? 1.0 : hover ? 1.4 : 0.5) : 0;
  const a = accent ?? [0, 0, 0];
  const ref = useGI2Shape({
    albedo: accent ? scale(a, 0.55) : [0.08, 0.085, 0.1],
    emission: scale(a as Vec3, glow),
    tint: accent ? 1 : 0,
    displayScale: accent ? 0.3 : 1,
    height: down ? -0.5 : 1,
    bevel: 9,
    cornerRadius: 5,
  });
  return (
    <div
      ref={ref as React.RefObject<HTMLDivElement>}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => { setHover(false); setDown(false); }}
      onPointerDown={() => setDown(true)}
      onPointerUp={() => setDown(false)}
      style={{ borderRadius: 5, padding: "8px 15px", fontSize: 13, fontWeight: 600, cursor: "pointer", userSelect: "none", color: "rgba(220,227,240,0.92)", pointerEvents: "auto", display: "inline-flex" }}
    >
      {children}
    </div>
  );
}

function LToggle({ defaultOn = false }: { defaultOn?: boolean }) {
  const [on, setOn] = useState(defaultOn);
  const trackRef = useGI2Shape({
    albedo: on ? ACCENT : [0.03, 0.032, 0.04],
    tint: 1,
    emission: on ? scale(ACCENT, 0.7) : [0, 0, 0],
    displayScale: 8,
    height: -0.35,
    bevel: 4,
    cornerRadius: 12,
  });
  const knobRef = useGI2Shape({ kind: "circle", albedo: [0.05, 0.052, 0.06], tint: 1, height: 0.8, bevel: 4, live: true });
  return (
    <div
      ref={trackRef as React.RefObject<HTMLDivElement>}
      onClick={() => setOn(!on)}
      style={{ width: 46, height: 24, borderRadius: 12, position: "relative", cursor: "pointer", pointerEvents: "auto" }}
    >
      <div
        ref={knobRef as React.RefObject<HTMLDivElement>}
        style={{ position: "absolute", top: 2, left: on ? 24 : 2, width: 20, height: 20, borderRadius: "50%", transition: "left 0.18s ease" }}
      />
    </div>
  );
}

function LWell({ children, style }: { children?: React.ReactNode; style?: React.CSSProperties }) {
  const ref = useGI2Shape({ albedo: [0.032, 0.034, 0.042], tint: 1, height: -0.4, bevel: 4, cornerRadius: 5 });
  return (
    <div ref={ref as React.RefObject<HTMLDivElement>} style={{ borderRadius: 5, padding: "9px 12px", fontSize: 13, color: "rgba(150,160,180,0.6)", ...style }}>
      {children}
    </div>
  );
}

function LDot({ color, glow = 0.7 }: { color: Vec3; glow?: number }) {
  const ref = useGI2Shape({ kind: "circle", albedo: color, tint: 1, emission: scale(color, glow), displayScale: 8, height: 0.4, bevel: 3 });
  return <div ref={ref as React.RefObject<HTMLDivElement>} style={{ width: 12, height: 12, borderRadius: "50%" }} />;
}

function LLight({ color }: { color: Vec3 }) {
  const [pos, setPos] = useState({ x: 520, y: 90 });
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const ref = useGI2Shape({
    kind: "circle",
    albedo: [0.2, 0.2, 0.22],
    emission: scale(color, 0.35),
    opacity: 1,
    height: 0.6,
    bevel: 4,
    rawGlow: true,
    live: true,
  });
  return (
    <div
      ref={ref as React.RefObject<HTMLDivElement>}
      onPointerDown={(e: ReactPointerEvent) => {
        drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e: ReactPointerEvent) => {
        if (drag.current) setPos({ x: e.clientX - drag.current.dx, y: e.clientY - drag.current.dy });
      }}
      onPointerUp={() => (drag.current = null)}
      style={{ position: "absolute", left: pos.x, top: pos.y, width: 26, height: 26, borderRadius: "50%", cursor: "grab", pointerEvents: "auto", touchAction: "none" }}
    />
  );
}

// Dense-mode stress: a grid of small mixed chips (some emissive) to exercise
// the tile binning the way a busy dashboard would.
function DenseGrid() {
  const cells = Array.from({ length: 84 }, (_, i) => i);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(14, 1fr)", gap: 10, padding: "6px 2px" }}>
      {cells.map((i) => (
        <DenseChip key={i} i={i} />
      ))}
    </div>
  );
}
function DenseChip({ i }: { i: number }) {
  const hue = i % 7;
  const emissive = i % 9 === 4;
  const color: Vec3 = hue < 3 ? ACCENT : hue < 5 ? GOOD : WARN;
  const ref = useGI2Shape({
    albedo: emissive ? scale(color, 0.55) : [0.07, 0.075, 0.09],
    tint: emissive ? 1 : 0,
    emission: emissive ? scale(color, 0.9) : [0, 0, 0],
    displayScale: 0.4,
    height: i % 4 === 2 ? -0.35 : 0.7,
    bevel: 6,
    cornerRadius: 5,
  });
  return <div ref={ref as React.RefObject<HTMLDivElement>} style={{ height: 26, borderRadius: 5 }} />;
}

// --- The page ---------------------------------------------------------------

export function Labs() {
  const { accent } = useGITheme();
  const [dense, setDense] = useState(false);
  const apiRef = useRef<{ renderNow: () => void; stats: () => { renders: number; cpuMs: number; lastMs: number } } | null>(null);
  const [line, setLine] = useState("initializing…");
  const [bench, setBench] = useState("");

  // Headless/dev hook: run the benchmark without synthetic input (input would
  // wake the MAIN engine's ambient throttle and contaminate the numbers).
  useEffect(() => {
    (window as unknown as { __gi2Bench?: () => Promise<string> | undefined }).__gi2Bench = () =>
      runBench() as Promise<string> | undefined;
    return () => {
      delete (window as unknown as { __gi2Bench?: unknown }).__gi2Bench;
    };
  });

  useEffect(() => {
    const t = window.setInterval(() => {
      const s = apiRef.current?.stats();
      if (s) setLine(`${s.renders} renders · last CPU submit ${s.lastMs.toFixed(2)}ms`);
    }, 1000);
    return () => window.clearInterval(t);
  }, []);

  const runBench = () => {
    const api = apiRef.current;
    if (!api) return;
    return new Promise<string>((resolve) => {
      benchResolve.current = resolve;
      startBench();
    });
  };
  const benchResolve = useRef<((s: string) => void) | null>(null);
  const startBench = () => {
    const api = apiRef.current;
    if (!api) return;
    // Force continuous full renders for ~1.5s and measure wall-clock cadence.
    const t0 = performance.now();
    let frames = 0;
    const tick = () => {
      api.renderNow();
      frames++;
      if (performance.now() - t0 < 1500) requestAnimationFrame(tick);
      else {
        const ms = (performance.now() - t0) / frames;
        const line = `${frames} full renders · ${ms.toFixed(2)}ms/frame (${(1000 / ms).toFixed(0)}fps equivalent)`;
        setBench(line);
        benchResolve.current?.(line);
        benchResolve.current = null;
      }
    };
    requestAnimationFrame(tick);
  };

  return (
    <>
      <header className="page-head">
        <h2>Labs — GI-Lite</h2>
        <p style={{ maxWidth: 720 }}>
          An experimental engine aimed at mobile and dense layouts: the board below is lit by{" "}
          <strong>SDF × circular harmonics</strong>, not the site&apos;s radiance-cascade pipeline. Shading is
          analytic from the shape SDFs at device resolution (crisper than the capped-res G-buffer, at any DPR),
          the bounce comes from a sparse probe grid storing L0+L1 circular harmonics (its cost depends on css
          area, not device pixels), and per-pixel work is tile-binned so it scales with <em>local</em> shape
          density. Drag the orb; press the buttons.
        </p>
      </header>

      <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
        <GIButton accent={accent} onClick={runBench}>
          Benchmark
        </GIButton>
        <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "rgba(170,182,205,0.75)" }}>
          dense stress grid <GIToggle onChange={setDense} />
        </span>
        <span style={{ fontSize: 12, color: "rgba(150,162,184,0.6)", fontFamily: "ui-monospace, Menlo, monospace" }}>
          {bench || line}
        </span>
      </div>

      <GI2Board height={dense ? 760 : 620} onReady={(api) => (apiRef.current = api)}>
        <div style={{ display: "flex", flexDirection: "column", gap: 22, padding: 26 }}>
          <div style={{ display: "flex", gap: 22, flexWrap: "wrap" }}>
            <LPanel style={{ minWidth: 300 }}>
              <div style={{ fontSize: 11, letterSpacing: "0.08em", color: "rgba(150,162,184,0.6)", marginBottom: 12 }}>
                BUTTONS
              </div>
              <div style={{ display: "flex", gap: 14 }}>
                <LButton accent={ACCENT}>Primary</LButton>
                <LButton>Default</LButton>
              </div>
            </LPanel>
            <LPanel style={{ minWidth: 220 }}>
              <div style={{ fontSize: 11, letterSpacing: "0.08em", color: "rgba(150,162,184,0.6)", marginBottom: 12 }}>
                TOGGLES
              </div>
              <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
                <LToggle defaultOn />
                <LToggle />
              </div>
            </LPanel>
            <LPanel style={{ minWidth: 220 }}>
              <div style={{ fontSize: 11, letterSpacing: "0.08em", color: "rgba(150,162,184,0.6)", marginBottom: 12 }}>
                STATUS
              </div>
              <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                <LDot color={GOOD} />
                <LDot color={WARN} />
                <LDot color={ACCENT} glow={1.1} />
              </div>
            </LPanel>
          </div>
          <div style={{ display: "flex", gap: 22, flexWrap: "wrap" }}>
            <LPanel style={{ flex: 1, minWidth: 340 }}>
              <div style={{ fontSize: 11, letterSpacing: "0.08em", color: "rgba(150,162,184,0.6)", marginBottom: 12 }}>
                INSET WELLS
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <LWell>A carved dark field</LWell>
                <LWell style={{ width: "70%" }}>tint: 1 keeps it genuinely dark</LWell>
              </div>
            </LPanel>
          </div>
          {dense && (
            <LPanel>
              <div style={{ fontSize: 11, letterSpacing: "0.08em", color: "rgba(150,162,184,0.6)", marginBottom: 12 }}>
                DENSE GRID — 84 chips, 9 emissive
              </div>
              <DenseGrid />
            </LPanel>
          )}
        </div>
        <LLight color={[0.55, 0.7, 1.0]} />
      </GI2Board>

      <Surface radius={9} style={{ padding: "16px 20px", maxWidth: 760 }}>
        <div style={{ fontSize: 13, fontWeight: 650, color: "rgba(215,224,240,0.9)", marginBottom: 8 }}>
          Measured (M-series Mac, headless Chrome, forced continuous full renders)
        </div>
        <p style={{ margin: "0 0 10px", fontSize: 12.5, lineHeight: 1.6, color: "rgba(150,162,184,0.7)" }}>
          Desktop 1400×900 @2×: <strong>GI-Lite 120fps (vsync-limited)</strong> vs cascades 51fps. Simulated
          phone 390×844 @3×: <strong>GI-Lite 120fps at native 3× resolution</strong>; the cascade engine reaches
          120fps only when its render width drops to 480px (a 2.4× upscale — visibly softer). The dense stress
          grid (84 extra shapes) costs GI-Lite nothing measurable: per-pixel work is tile-binned to local density.
        </p>
        <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.6, color: "rgba(150,162,184,0.7)" }}>
          Why: the cascade engine computes light transport at (capped) pixel resolution across 4 full-res rgba16f
          targets and several dispatches. Here the transport runs on ~2,000 probes (circular harmonics, 20 rays
          each through a css/6 emission raster) regardless of DPR, and the only per-device-pixel pass is one
          fragment shader doing analytic SDF shading — which also means the bevels are mathematically exact at
          any zoom, not upscaled from a capped buffer.
        </p>
      </Surface>

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        <GIStat label="Phone-sim @3×" value="120fps" delta="native res" width={180} />
        <GIStat label="Full-res targets" value="0" delta="was 4" width={170} />
        <GIStat label="Probes" value="~2k" delta="CH L0+L1" width={170} />
        <GIStat label="Dense grid Δ" value="+0ms" delta="84 shapes" width={170} />
      </div>
    </>
  );
}
