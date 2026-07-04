import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { GICanvas } from "./GIContext";
import { GICanvasLite } from "../gi2/GICanvasLite";
import { DEFAULT_PARAMS, type GIParams } from "./types";

type Vec3 = [number, number, number];

// ---------------------------------------------------------------------------
// Theme: the "customizable" surface of the framework. Components read the
// accent from context (overridable per-instance via their `accent` prop), so
// one provider prop recolors the whole kit.
// ---------------------------------------------------------------------------

export type GITheme = {
  accent: Vec3; // primary interactive colour (linear RGB)
  good: Vec3; // success / positive
  warn: Vec3; // warning / attention
};

export const DEFAULT_THEME: GITheme = {
  accent: [0.05, 0.4, 0.85],
  good: [0.1, 0.7, 0.35],
  warn: [0.95, 0.5, 0.1],
};

const ThemeContext = createContext<GITheme>(DEFAULT_THEME);

export function useGITheme(): GITheme {
  return useContext(ThemeContext);
}

// ---------------------------------------------------------------------------
// Quality: one dial instead of five knobs. Presets co-tune the params that
// trade fidelity for speed; "auto" starts at medium and lets the adaptive
// scaler handle the rest.
// ---------------------------------------------------------------------------

export type GIQuality = "low" | "medium" | "high";

export const QUALITY_PRESETS: Record<GIQuality, Partial<GIParams>> = {
  // 4 GI directions, shorter cascade stack, coarse rays: for weak/integrated
  // GPUs. Lighting gets noticeably softer/flatter but stays coherent (the
  // lighting distances are css-authored, so only sharpness changes).
  low: { maxResolution: 896, cascadeCount: 5, baseTile: 2, stepLen: 6, d0: 16 },
  medium: { maxResolution: 1216, cascadeCount: 6, baseTile: 4, stepLen: 4, d0: 16 },
  high: { maxResolution: 1664, cascadeCount: 7, baseTile: 4, stepLen: 3, d0: 12 },
};

// ---------------------------------------------------------------------------
// Provider: the single mount point for library consumers.
//   <GIProvider theme={{ accent: [0.8, 0.3, 0.1] }} quality="medium">
//     <App />
//   </GIProvider>
// `params` overrides individual GIParams on top of the quality preset for
// advanced tuning; most apps should never need it.
// ---------------------------------------------------------------------------

export function GIProvider({
  theme,
  quality,
  params,
  showPerf = false,
  onError,
  onGPUInfo,
  children,
}: {
  theme?: Partial<GITheme>;
  /** "auto" starts at medium and drops to low if the browser is on a software
   *  rasterizer (adaptive resolution handles everything finer-grained). */
  quality?: GIQuality | "auto";
  params?: Partial<GIParams>;
  showPerf?: boolean;
  /** Lighting-layer failure callback (no WebGPU, repeated GPU device loss).
   *  The UI keeps working unlit; use this to log or show your own notice. */
  onError?: (message: string) => void;
  /** GPU adapter identity, once after init (name + software-rasterizer flag). */
  onGPUInfo?: (info: { gpuName: string; softwareGPU: boolean }) => void;
  children: ReactNode;
}) {
  const mergedTheme = useMemo<GITheme>(() => ({ ...DEFAULT_THEME, ...theme }), [theme]);
  // quality="auto": conservative and observable — medium unless the adapter
  // turns out to be a CPU rasterizer (SwiftShader/llvmpipe), then low. The
  // built-in adaptive scaler + frame pacing already handle per-machine load,
  // so the preset only needs to pick the right resolution ceiling.
  const [autoQuality, setAutoQuality] = useState<GIQuality>("medium");
  const resolvedQuality: GIQuality | undefined = quality === "auto" ? autoQuality : quality;
  const handleGPUInfo = useCallback(
    (info: { gpuName: string; softwareGPU: boolean }) => {
      if (info.softwareGPU) setAutoQuality("low");
      onGPUInfo?.(info);
    },
    [onGPUInfo]
  );
  const mergedParams = useMemo<GIParams>(
    () => ({
      ...DEFAULT_PARAMS,
      ...(resolvedQuality ? QUALITY_PRESETS[resolvedQuality] : {}),
      ...params,
    }),
    [resolvedQuality, params]
  );
  return (
    <ThemeContext.Provider value={mergedTheme}>
      {mergedParams.engine === "lite" ? (
        <GICanvasLite params={mergedParams} onError={onError} onGPUInfo={handleGPUInfo}>
          {children}
        </GICanvasLite>
      ) : (
        <GICanvas params={mergedParams} showPerf={showPerf} onError={onError} onGPUInfo={handleGPUInfo}>
          {children}
        </GICanvas>
      )}
    </ThemeContext.Provider>
  );
}
