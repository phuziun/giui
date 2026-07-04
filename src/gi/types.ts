// A shape registered into the GI scene. Coordinates are in CSS pixels relative
// to the canvas top-left; the renderer scales them to device/render resolution.
export type Shape = {
  kind: "roundRect" | "circle";
  x: number; // center x (css px)
  y: number; // center y (css px)
  // roundRect: halfW/halfH are half-extents; circle: halfW is the radius.
  halfW: number;
  halfH: number;
  cornerRadius: number;
  height: number; // raised height for the bevel normal (0 = flat)
  bevel: number; // width (px) of the beveled edge band
  rolloff: number; // bevel curve shape; <0 = use the global default
  albedo: [number, number, number];
  emission: [number, number, number]; // emitted radiance (lights / glow) — drives the bounce
  opacity: number; // how strongly this shape occludes light, 0..1
  displayScale: number; // how much of `emission` shows on the shape's own surface
  tint: number; // 0 = use global tintAmount, 1 = show full albedo (ignore the cap)
  bodyAlpha: number; // 1 = normal body, 0 = emission-only (invisible body, still lights)
  heightScale: number; // per-shape bevel relief scale; <0 = use the global default
  // Paint priority for the albedo/tint painter's order: shapes sort by layer
  // first (ascending), THEN largest-area-first within a layer. Overlays
  // (dialogs, menus, tooltips) set layer >= 1 so they paint over page content
  // regardless of area — a big dialog panel otherwise paints UNDER the smaller
  // tiles it covers.
  layer: number;
};

export const FLOATS_PER_SHAPE = 20; // 5x vec4
// Sized for full template pages (zoo + templates ≈ 230 shapes). Overflow drops
// the smallest shapes (pack sorts largest-first), so keep generous headroom.
export const MAX_SHAPES = 512;

// Runtime-tunable GI parameters (driven by the leva debug panel).
export type GIParams = {
  renderScale: number; // 0.5..1, render resolution vs css * dpr
  maxResolution: number; // hard cap on the GI render's longest side (px)
  adaptiveQuality: boolean; // auto-lower resolution under load, restore when idle
  // true = small FIXED canvas showing the visible slice via a scroll offset
  // (all GPU cost viewport-bounded); false = one page-sized canvas that
  // scrolls natively with the content (legacy; giant textures on long pages).
  viewportCanvas: boolean;
  d0: number; // base probe spacing (px) at cascade 0
  baseTile: number; // sqrt of base direction count (2 => 4 dirs, 4 => 16 dirs)
  cascadeCount: number;
  intervalLen0: number; // base ray interval length (px)
  stepLen: number; // raymarch step length (px); fewer => faster, noisier
  skyColor: [number, number, number]; // GI ambient sky (top cascade escape)
  skyStrength: number;
  exposure: number;
  // Dark-neumorphic shading:
  ambient: number; // base light floor
  keyIntensity: number; // strength of the directional key light (relief)
  keyColor: [number, number, number];
  keyDir: [number, number, number]; // direction toward the key light (x,y up=-y,z toward viewer)
  giStrength: number; // how much the cascade radiance tints surfaces
  giDirectional: number; // how strongly the bounce favours emitter-facing bevels
  occlusion: number; // 0 = local light spreads across surfaces, 1 = full GI shadowing
  componentGlow: number; // master multiplier on UI components' emission (not the lights)
  normalStrength: number;
  heightScale: number; // global default bevel relief (per-shape override: Shape.heightScale)
  rolloff: number; // bevel curve shape: 0 = soft S, 1 = rounded shoulder
  edgeBias: number; // 0 = bevel straddles edge (soft feather), 1 = inside (hard termination)
  edgeAA: number;
  material: [number, number, number]; // the single surface material colour
  emissiveDisplay: number; // how bright an emitter's own surface glows (indirect is separate)
  tintAmount: number; // 0 = pure one-material; >0 lets components tint it
  giSmooth: number; // GI gather blur radius (px) — smooths blocky radiance
  giBackground: number; // how much GI shows on the empty background (0 = none)
  grain: number; // monochromatic film-grain amount (peak-to-peak)
  surfaceTexture: number; // micro-normal noise that gives the lighting some texture
  textureScale: number; // size (px) of the surface-texture grain
  lightsVisible: boolean; // draw the light orbs (they still emit either way)
  // Soft counter/fill light (additive — lifts the key light's shadow side):
  fillColor: [number, number, number];
  fillDir: [number, number, number];
  fillIntensity: number;
  // Contact shadows from the height field:
  aoStrength: number;
  aoRadius: number; // px
  // Cast shadows from the key light (marched across the height field):
  shadowStrength: number;
  shadowLength: number; // px
  shadowHeight: number; // px per unit of height (smaller => longer shadows)
  shadowSoftness: number; // penumbra growth with distance
  debugMode: number; // 0 final, 1 albedo, 2 normal, 3 emissive, 4 irradiance, 5 height, 6 shadow, 7 AO, 8 occlusion
};

// Defaults baked from the dialed-in "preset1": a calm, moody look — low
// componentGlow, subdued key light, no background GI spill / sky, soft relief
// carried by a strong normalStrength, long soft cast shadows.
export const DEFAULT_PARAMS: GIParams = {
  renderScale: 1,
  // Lighting distances are css-authored (scale-invariant), so resolution is a
  // pure sharpness/perf dial now — 1216 is ~2× cheaper than the old 1664
  // across every pass (including present/backing) for a mild softening.
  maxResolution: 1216,
  adaptiveQuality: true,
  viewportCanvas: true,
  d0: 16,
  baseTile: 4,
  cascadeCount: 7,
  intervalLen0: 10,
  stepLen: 4,
  // Numeric look values re-baked 2026-07 from the owner's dialed-in Studio
  // state (SCHEMA 15): warmer key, stronger relief (heightScale 0.3 → 1.3,
  // rolloff 0.75), finer grain.
  skyColor: [0.003, 0.004, 0.0075],
  skyStrength: 0,
  exposure: 0.9,
  ambient: 0.24,
  keyIntensity: 0.41,
  keyColor: [0.7379, 0.7913, 1.0],
  keyDir: [-0.45, -0.6, 0.66],
  giStrength: 1.05,
  giDirectional: 4,
  occlusion: 0.2,
  componentGlow: 0.05,
  normalStrength: 3,
  heightScale: 1.3,
  rolloff: 0.75,
  edgeBias: 0.65,
  edgeAA: 1.25,
  material: [0.0395, 0.0467, 0.0595],
  emissiveDisplay: 0.45,
  tintAmount: 0.65,
  giSmooth: 8,
  // Small but nonzero so strong emitters (the hero screen, dragged lights)
  // visibly halo onto the backplate; preset1 had 0 — re-zero in Studio if the
  // spill reads too bright.
  giBackground: 0.14,
  grain: 0.02,
  surfaceTexture: 0.32,
  textureScale: 2.5,
  lightsVisible: false,
  fillColor: [0.0123, 0.0467, 0.2384],
  fillDir: [0.5, 0.62, 0.6],
  fillIntensity: 1,
  aoStrength: 0.8,
  aoRadius: 7,
  shadowStrength: 1.1,
  shadowLength: 122,
  shadowHeight: 32,
  shadowSoftness: 0.025,
  debugMode: 0,
};
