import { useCallback, useEffect, useId, useRef } from "react";
import { useGI } from "./GIContext";
import type { Shape } from "./types";

export type GIShapeProps = {
  kind?: "roundRect" | "circle";
  albedo?: [number, number, number];
  emission?: [number, number, number];
  opacity?: number; // light occlusion, 0..1
  displayScale?: number; // how much emission shows on the shape itself (1 = full)
  tint?: number; // 0 = use the global tintAmount, 1 = show full albedo (dark insets)
  bodyAlpha?: number; // 1 = visible body, 0 = emission-only (a hidden light)
  heightScale?: number; // per-shape bevel relief; omit = global default (low for big features, high for small)
  height?: number; // raised height (bevel intensity)
  bevel?: number; // bevel band width in css px
  rolloff?: number; // 0 = soft S, 1 = rounded shoulder; omit = global default
  cornerRadius?: number; // overrides the element's computed border-radius
  /** Re-measure every frame (for dragged / animated elements). */
  live?: boolean;
  /** Opt out of the global `componentGlow` master (e.g. a standalone light). */
  rawGlow?: boolean;
  /** Paint priority: higher paints over lower regardless of area. Overlays
   *  (dialog/menu/tooltip panels) use 1+; page content stays 0. */
  layer?: number;
};

const DEFAULTS = {
  albedo: [0.12, 0.13, 0.16] as [number, number, number],
  emission: [0, 0, 0] as [number, number, number],
  // Components partially occlude light, so local lights cast real shadows onto
  // neighbours and the radiance bounce reads as a bounce (not a flat glow).
  opacity: 0.3,
  height: 1,
  bevel: 10,
};

// Attaches an element to the GI scene: measures its box relative to the GICanvas
// root and (re)registers a matching SDF shape whenever layout or material change.
export function useGIShape(props: GIShapeProps) {
  const { rootRef, setShape, componentGlow } = useGI();
  const id = useId();
  const elRef = useRef<HTMLElement | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  const measure = useCallback(() => {
    const el = elRef.current;
    const root = rootRef.current;
    if (!el || !root) return;
    const r = el.getBoundingClientRect();
    const rootR = root.getBoundingClientRect();
    const p = propsRef.current;

    // Reading computed style forces a style flush; skip it when we don't need it
    // (explicit radius, or a circle which ignores cornerRadius entirely).
    const cornerRadius =
      p.cornerRadius ??
      (p.kind === "circle" ? 0 : parseFloat(getComputedStyle(el).borderRadius) || 0);

    // UI components' emission is scaled by the global componentGlow master; a
    // standalone light opts out via rawGlow so it keeps its own intensity.
    const glow = p.rawGlow ? 1 : componentGlow;
    const e = p.emission ?? DEFAULTS.emission;
    const emission: [number, number, number] = [e[0] * glow, e[1] * glow, e[2] * glow];

    const shape: Shape = {
      kind: p.kind ?? "roundRect",
      x: r.left - rootR.left + r.width / 2,
      y: r.top - rootR.top + r.height / 2,
      halfW: r.width / 2,
      halfH: r.height / 2,
      cornerRadius,
      height: p.height ?? DEFAULTS.height,
      bevel: p.bevel ?? DEFAULTS.bevel,
      rolloff: p.rolloff ?? -1,
      albedo: p.albedo ?? DEFAULTS.albedo,
      emission,
      opacity: p.opacity ?? DEFAULTS.opacity,
      displayScale: p.displayScale ?? 1,
      tint: p.tint ?? 0,
      bodyAlpha: p.bodyAlpha ?? 1,
      heightScale: p.heightScale ?? -1,
      layer: p.layer ?? 0,
    };
    setShape(id, shape);
  }, [id, rootRef, setShape, componentGlow]);

  // Re-measure on layout changes and whenever material props change. No scroll
  // listener needed: the canvas spans the full content and scrolls in the same
  // flow as the elements, so a shape's box (measured relative to the root) is
  // invariant under scroll — the compositor moves light and content together.
  useEffect(() => {
    measure();
    const el = elRef.current;
    const ro = new ResizeObserver(measure);
    if (el) ro.observe(el);
    const root = rootRef.current;
    if (root) ro.observe(root);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure, rootRef]);

  // Material changes (color / emission / etc.) need a re-pack too.
  useEffect(() => {
    measure();
  });

  // Continuous measurement for moving elements.
  useEffect(() => {
    if (!props.live) return;
    let raf = 0;
    const tick = () => {
      measure();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [props.live, measure]);

  // Remove from the scene on unmount.
  useEffect(() => () => setShape(id, null), [id, setShape]);

  return elRef;
}
