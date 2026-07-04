// GI-Lite board: a self-contained lit region driven by the experimental
// renderer (src/gi2/renderer2.ts). Deliberately minimal compared to GICanvas —
// no scroll windows, no adaptive machinery, no pacing governor: the point of
// the experiment is that the pipeline is cheap enough not to need them.

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { initWebGPU } from "../gi/device";
import { Scene } from "../gi/scene";
import type { Shape } from "../gi/types";
import { Renderer2, GI2_DEFAULTS, type Gi2Params } from "./renderer2";

const COMPONENT_GLOW = 0.05; // same master as the main engine's default

type Ctx = {
  rootRef: React.RefObject<HTMLDivElement | null>;
  setShape: (id: string, s: Shape | null) => void;
  /** Perf counters for the lab readout. */
  stats: React.RefObject<{ renders: number; cpuMs: number; lastMs: number }>;
};
const GI2Context = createContext<Ctx | null>(null);

export type GI2ShapeProps = {
  kind?: "roundRect" | "circle";
  albedo?: [number, number, number];
  emission?: [number, number, number];
  opacity?: number;
  displayScale?: number;
  tint?: number;
  bodyAlpha?: number;
  heightScale?: number;
  height?: number;
  bevel?: number;
  rolloff?: number;
  cornerRadius?: number;
  live?: boolean;
  rawGlow?: boolean;
  layer?: number;
};

export function useGI2Shape(props: GI2ShapeProps) {
  const ctx = useContext(GI2Context);
  if (!ctx) throw new Error("useGI2Shape must be used inside <GI2Board>");
  const { rootRef, setShape } = ctx;
  const id = useId();
  const elRef = useRef<HTMLElement | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  const measure = () => {
    const el = elRef.current;
    const root = rootRef.current;
    if (!el || !root) return;
    const r = el.getBoundingClientRect();
    const rr = root.getBoundingClientRect();
    const p = propsRef.current;
    const glow = p.rawGlow ? 1 : COMPONENT_GLOW;
    const e = p.emission ?? [0, 0, 0];
    setShape(id, {
      kind: p.kind ?? "roundRect",
      x: r.left - rr.left + r.width / 2,
      y: r.top - rr.top + r.height / 2,
      halfW: r.width / 2,
      halfH: r.height / 2,
      cornerRadius: p.cornerRadius ?? (parseFloat(getComputedStyle(el).borderRadius) || 0),
      height: p.height ?? 1,
      bevel: p.bevel ?? 10,
      rolloff: p.rolloff ?? -1,
      albedo: p.albedo ?? [0.12, 0.13, 0.16],
      emission: [e[0] * glow, e[1] * glow, e[2] * glow],
      opacity: p.opacity ?? 0.3,
      displayScale: p.displayScale ?? 1,
      tint: p.tint ?? 0,
      bodyAlpha: p.bodyAlpha ?? 1,
      heightScale: p.heightScale ?? -1,
      layer: p.layer ?? 0,
    });
  };
  const measureRef = useRef(measure);
  measureRef.current = measure;

  useEffect(() => {
    measureRef.current();
    const el = elRef.current;
    const ro = new ResizeObserver(() => measureRef.current());
    if (el) ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    measureRef.current();
  });
  useEffect(() => {
    if (!props.live) return;
    let raf = 0;
    const tick = () => {
      measureRef.current();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [props.live]);
  useEffect(() => () => setShape(id, null), [id, setShape]);
  return elRef;
}

export function GI2Board({
  height = 620,
  params,
  children,
  onReady,
  style,
}: {
  height?: number;
  params?: Partial<Gi2Params>;
  children?: ReactNode;
  /** Exposes imperative helpers for the lab (benchmark). */
  onReady?: (api: { renderNow: () => void; stats: () => { renders: number; cpuMs: number; lastMs: number } }) => void;
  style?: CSSProperties;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef(new Scene());
  const needs = useRef(true);
  const stats = useRef({ renders: 0, cpuMs: 0, lastMs: 0 });
  const paramsRef = useRef({ ...GI2_DEFAULTS, ...params });
  paramsRef.current = { ...GI2_DEFAULTS, ...params };
  const [err, setErr] = useState("");
  const apiRef = useRef<{ renderNow: () => void } | null>(null);

  const setShape = useRef((id: string, s: Shape | null) => {
    const changed = s ? sceneRef.current.set(id, s) : sceneRef.current.remove(id);
    if (changed) needs.current = true;
  }).current;

  useEffect(() => {
    const canvas = canvasRef.current!;
    const root = rootRef.current!;
    let disposed = false;
    let raf = 0;
    let renderer: Renderer2 | null = null;
    let gpuDevice: GPUDevice | null = null;

    const dims = () => {
      const dpr = window.devicePixelRatio || 1;
      const cssW = Math.max(8, root.clientWidth);
      const cssH = Math.max(8, root.clientHeight);
      return { dpr, cssW, cssH };
    };
    const applySize = () => {
      const { dpr, cssW, cssH } = dims();
      const w = Math.max(8, Math.floor(cssW * dpr));
      const h = Math.max(8, Math.floor(cssH * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        needs.current = true;
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
        renderer = await Renderer2.create(ctx);
        if (disposed) {
          renderer.destroy();
          ctx.device.destroy();
          return;
        }
        applySize();
        const renderNow = () => {
          const { dpr, cssW, cssH } = dims();
          const t0 = performance.now();
          renderer!.render(sceneRef.current, paramsRef.current, cssW, cssH, dpr);
          const ms = performance.now() - t0;
          stats.current.renders++;
          stats.current.cpuMs += ms;
          stats.current.lastMs = ms;
          canvas.style.opacity = "1";
        };
        apiRef.current = { renderNow };
        onReady?.({ renderNow, stats: () => ({ ...stats.current }) });
        const loop = () => {
          if (disposed) return;
          if (needs.current) {
            needs.current = false;
            renderNow();
          }
          raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    })();

    const ro = new ResizeObserver(applySize);
    ro.observe(root);
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer?.destroy();
      gpuDevice?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <GI2Context.Provider value={{ rootRef, setShape, stats }}>
      <div ref={rootRef} style={{ position: "relative", width: "100%", height, overflow: "clip", borderRadius: 12, ...style }}>
        <canvas
          ref={canvasRef}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block", opacity: 0, transition: "opacity 0.4s ease" }}
        />
        <div style={{ position: "relative", zIndex: 1, height: "100%" }}>{children}</div>
        {err && (
          <div style={{ position: "absolute", left: 10, bottom: 10, fontSize: 12, color: "rgba(255,200,200,0.8)" }}>{err}</div>
        )}
      </div>
    </GI2Context.Provider>
  );
}
