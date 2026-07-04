// ---------------------------------------------------------------------------
// giui — public library surface. This is the entry for the Vite lib build
// (`npm run build:lib` → dist-lib/); the demo site (App.tsx, Zoo, Templates,
// Landing, docs) is NOT part of the package.
// ---------------------------------------------------------------------------

// Provider + theming + quality
export { GIProvider, useGITheme, DEFAULT_THEME, QUALITY_PRESETS } from "./gi/GIProvider";
export type { GITheme, GIQuality } from "./gi/GIProvider";

// Engine-level access (custom setups; most apps only need GIProvider)
export { GICanvas, useGI, useGIScreen } from "./gi/GIContext";
export { useGIShape } from "./gi/useGIShape";
export type { GIShapeProps } from "./gi/useGIShape";
export { DEFAULT_PARAMS, MAX_SHAPES } from "./gi/types";
export type { GIParams, Shape } from "./gi/types";

// The component kit (also brings in components.css → dist-lib CSS)
export * from "./components/index";
