# giui

A dark-neumorphic React UI kit lit by **real 2D global illumination**. Instead of
faking depth with hand-tuned gradients, every component registers an SDF shape
into a G-buffer (albedo + 2.5D normal/height + emission/occlusion) and light is
simulated with **radiance cascades** on **WebGPU**. Glowing components actually
cast and spread light onto their neighbours, and beveled edges shade themselves
from the resolved radiance field.

**Live demo: <https://phuziun.github.io/giui/>** — drag the lights, flip the
toggles, and open the Studio route to tune the lighting live.

---

## Requirements & browser support

| Environment | Status |
|---|---|
| Chrome / Edge 113+ | ✅ WebGPU |
| Safari 18+ (macOS 15 / iOS 18) | ✅ WebGPU |
| Firefox stable | ⚠ no WebGPU yet — graceful fallback (below) |
| React | 18+ |
| Bundler | **Vite** (the engine imports WGSL shaders via Vite's `?raw` suffix; webpack/Next.js would need equivalent raw-import config) |

**Without WebGPU the UI still works.** The lighting layer fails soft: components
render as normal, fully interactive DOM (they are real `<button>`/`<input>`
elements) — just unlit, on the flat page background. A small non-blocking corner
notice reports why, and `<GIProvider onError={...}>` lets you log it or show
your own message. The same applies if the GPU device is lost at runtime (driver
reset, dual-GPU laptop switching): giui automatically re-initializes and
restores lighting in place; only repeated rapid losses make it give up and stay
unlit.

## Getting started

giui is not on npm yet. Adopt it by vendoring two folders into a Vite + React
app (they only depend on `react` — no other runtime dependencies):

```
src/gi/           # the engine: provider, renderer, shaders, useGIShape
src/components/   # the kit: ~40 lit components (+ components.css, imported automatically)
```

Then wrap your app in the provider and build with the kit:

```tsx
import { GIProvider } from "./gi/GIProvider";
import { Surface, GIButton, GIField, GIToggle, GISlider } from "./components";

export default function App() {
  return (
    <GIProvider theme={{ accent: [0.05, 0.4, 0.85] }} quality="medium">
      <Surface radius={12} style={{ padding: 20, maxWidth: 420 }}>
        <GIField placeholder="Search…" />
        <GIButton accent={[0.05, 0.4, 0.85]}>Save</GIButton>
        <GIToggle defaultOn />
        <GISlider />
      </Surface>
    </GIProvider>
  );
}
```

Two page-level conventions the demo uses (see `src/index.css`):

- Give `html, body, #root` a dark background close to the lit scene
  (`#1e222b`) so the moment before the first lit frame fades in isn't jarring.
- The **document** should be the scroll container (don't wrap the provider in
  an `overflow: auto` div) — document scrolling stays on the compositor thread,
  which is what keeps scrolling smooth with the light field glued to content.

### Mount point: `<GIProvider>`

```tsx
<GIProvider
  theme={{ accent: [0.05, 0.4, 0.85] }}  // partial ok: accent / good / warn (linear RGB)
  quality="medium"                        // "low" | "medium" | "high"
  params={{ giStrength: 1.2 }}            // advanced: override any GIParams on top
  showPerf={false}                        // FPS/GPU HUD (bottom-left)
  onError={(msg) => console.warn(msg)}    // lighting-layer failure (UI keeps working unlit)
>
  {children}
</GIProvider>
```

One `theme.accent` recolors the whole kit — components resolve their colour
from the provider unless given an explicit `accent` prop, and the light they
cast follows. `useGITheme()` exposes the resolved theme for your own components.

### Quality

`quality` co-tunes the perf-relevant knobs (`QUALITY_PRESETS` in
`src/gi/GIProvider.tsx`):

| Preset | GI width cap | Cascades | Base directions | Use for |
|---|---|---|---|---|
| `low` | 896 | 5 | 4 | integrated/weak GPUs |
| `medium` (default) | 1216 | 6 | 16 | most machines |
| `high` | 1664 | 7 | 16 | big desktop GPUs |

Lighting **distances are authored in CSS pixels** and scale-invariant, so
presets only trade sharpness — AO/shadow/glow character is identical at every
quality level.

## Performance: what the engine already does

You should not need to think about GPU cost for a normal app page. Built in:

- **On-demand rendering** — a static UI does *zero* GPU work. Renders happen
  when a shape, parameter, scroll offset, or animation changes.
- **Viewport-bounded canvas** — the lit canvas is a small window onto the
  content (viewport + 200px overscan), so cost is bounded by the viewport, not
  page length.
- **Adaptive quality** — under sustained load the render scale steps down
  (coarse levels, never mid-scroll), and restores in one crisp frame when idle.
- **Frame pacing** — if a render can't hit the display's refresh budget
  (e.g. 120Hz ProMotion), it locks to a stable half rate instead of juddering.
- **Ambient throttle** — continuous decorative animation (spinners, dots) drops
  to ~30Hz after 1.5s without input; any interaction restores full rate.
- **Software-GPU detection** — if the browser fell back to a CPU rasterizer
  (SwiftShader/llvmpipe), giui logs a loud warning and flags it in the HUD:
  no in-app setting can make that fast; fix hardware acceleration instead.

What *you* control:

- **`live` shapes cost a forced reflow per frame.** `useGIShape({ live: true })`
  re-measures its element every animation frame, forever. Use it only for
  elements that move without a React re-render (CSS-animated thumbs, dragged
  elements). The kit already follows this rule.
- **Shape budget**: `MAX_SHAPES = 512` per page. Overflow silently drops the
  smallest shapes (pack keeps largest first), so keep headroom — a full
  dashboard template uses ~230.
- **First visit**: pipeline compilation is async (no main-thread freeze) and
  the canvas fades in after the first lit frame — expect a beat of flat
  background on a cold shader cache.
- **Diagnostics**: `showPerf` HUD (fps, p95, adaptive scale, GPU name),
  `window.__giPerf` (frame stats), `window.__giInit` (device/pipeline timings,
  GPU adapter, software-GPU flag).

## The component kit

All components share three recipes — carved well, raised chip, emissive accent
— so they compose visually by construction. Interactive ones are real DOM
elements with keyboard/focus behavior.

| Group | Components |
|---|---|
| Surfaces | `Surface` (raised or `carved`), `GIDivider` |
| Buttons & inputs | `GIButton`, `GIField`, `GITextarea`, `GISearch`, `GIStepper`, `GISelect`, `GICombobox`, `GIDatePicker` |
| Selection | `GIToggle`, `GICheckbox`, `GIRadioGroup`, `GISegmented`, `GISlider`, `GIRange`, `GIRating` |
| Navigation | `GITabs`, `GIBreadcrumb`, `GIPagination`, `GIMenu`, `GICommandPalette` (⌘K) |
| Overlays | `GIDialog`, `GITooltip`, `GIToast` |
| Data display | `GITable`, `GIList`/`GIListItem`, `GIStat`, `GIBadge`, `GITag`, `GIKbd`, `GIAvatar`, `GIAccordion` |
| Feedback | `GIProgress` (+`indeterminate`), `GISpinner`, `GIDots`, `GISkeleton`, `GIAlert`, `GIEmptyState` |
| Light | `GILight` — a draggable emitter orb; controlled via `position`/`onChange`, `visible={false}` hides the orb while it keeps lighting the scene |

The Templates route of the demo shows full compositions (dashboard, inbox,
sign-in, settings, pricing) built purely from the kit.

## Building your own lit component: `useGIShape`

Any DOM element can join the light simulation:

```tsx
import { useGIShape } from "./gi/useGIShape";

function GlowCard({ children }: { children: React.ReactNode }) {
  const ref = useGIShape({
    height: 1.2,          // raised out of the surface (negative = carved in)
    bevel: 24,            // lip width (px)
    cornerRadius: 12,
    emission: [0.1, 0.3, 0.8],  // pours light into the scene
    displayScale: 0.2,    // …but shows only 20% of it on its own face
    opacity: 0.5,         // occludes light passing through (casts GI shadows)
  });
  return <div ref={ref} style={{ borderRadius: 12, padding: 16 }}>{children}</div>;
}
```

The hook measures the element's box (ResizeObserver + window resize; pass
`live: true` for per-frame tracking) and registers a matching SDF shape.
Full option list:

- `kind` — `"roundRect"` (default) or `"circle"`.
- `height` / `bevel` / `rolloff` / `cornerRadius` — the relief: signed height
  (raise/carve), lip width, edge curve (0 soft S → 1 rounded shoulder).
- `heightScale` — per-shape bevel steepness for the *normal* only (big panels
  want low ~1; small controls default to the global 1.3+). Physical depth
  (AO/shadows) is unaffected.
- `albedo` + `tint` — surface colour; `tint: 1` bypasses the global
  `tintAmount` cap (the only way to get genuinely dark insets).
- `emission` + `displayScale` — light injected into the scene vs. shown on the
  shape's own face (decoupled on purpose: a button can bounce strongly while
  staying a deep chip).
- `opacity` — how strongly the shape occludes light (0..1).
- `bodyAlpha` — 0 makes it an **invisible emitter**: no body, still lights the
  scene (decorative light sources).
- `matte` — receives **no** GI bounce: a light behind a matte panel washes the
  area around it but never its face (the demo's nav backlight).
- `layer` — paint priority for overlays (dialogs/menus set 1–2 so they paint
  over larger shapes below them).
- `live` — re-measure every frame (see the perf note above).
- `rawGlow` — opt out of the global `componentGlow` multiplier (lights use it).

Conventions that matter:

- A shape whose visibility toggles at runtime should stay **mounted** and
  switch via `emission`/`bodyAlpha`, not conditional rendering.
- If your component must be clickable and lives under a
  `pointer-events: none` wrapper (like the demo's layout), set
  `pointerEvents: "auto"` on its own root — every kit component does.

## How the rendering works

Four GPU passes per frame (`src/gi/renderer.ts`), and only when needed:

1. **Scene / G-buffer** (`shaders/scene.wgsl`, compute) — evaluates every SDF
   shape per pixel into four `rgba16f` targets: emission+occlusion, albedo+
   coverage, normal+height, display-emission+tint. Per-pixel cost scales with
   *local* shape density (padded-AABB cull), not total shape count.
2. **Radiance cascades** (`shaders/cascade.wgsl`, compute) — one dispatch per
   cascade, top-down. Probes raymarch their angular interval against the scene,
   then merge the sparser cascade above. A direction-first texture layout makes
   probe-space interpolation a single hardware-filtered sample.
3. **Composite** (`shaders/composite.wgsl`, fragment, at the capped GI
   resolution into an offscreen HDR target) — one continuous material shaded by
   a soft directional key light + dim fill; cast shadows marched across the
   height field; contact AO; and the cascade radiance gathered directionally
   and added to surfaces (masked to components + `giBackground` on the
   backplate). Emitters occlude in the cascades, so local lights cast real
   shadows in their bounce.
4. **Present** (`shaders/present.wgsl`, fragment, full swapchain resolution) —
   upsample, exposure, ACES tonemap, sRGB, film grain. Keeping the heavy passes
   at capped resolution and only this one at device resolution is what keeps
   hi-dpi fast.

The look is **one material**: background and components share a single colour,
so a shape is revealed by its beveled lip catching the key light — it swells
out of (or presses into) the same sheet. Height is a signed additive field, so
shapes nest (a carved field inside a raised card).

## Tuning (Studio)

The demo's **Studio** route hosts a leva panel driving every parameter of
`GIParams` (see `src/gi/types.ts` for the full annotated list), plus a preset
manager (save/load/copy JSON/reset). The groups:

- **Render**: `renderScale`, `maxResolution`, `adaptiveQuality`,
  `viewportCanvas`, cascade counts/spacings, `quality` preset select.
- **Form**: `ambient`, `keyIntensity`/`keyColor`/`keyDir`, `heightScale`,
  `rolloff`, `edgeBias`, `normalStrength`, `surfaceTexture`/`textureScale`.
- **Accent**: `accent` (theme colour), `giStrength`, `giDirectional`,
  `occlusion`, `componentGlow`, `emissiveDisplay`, `giSmooth`, `giBackground`,
  `skyStrength`, `exposure`, `tintAmount`, `grain`, `material`.
- **Lights**: `lightsVisible` + three optional draggable orb emitters.
- **Depth**: cast shadows (`shadow*`), fill light (`fill*`), contact AO (`ao*`).
- **Debug**: Final / Albedo / Normal / Height / Emissive / Irradiance / Shadow / AO / Occlusion views, `showPerf`.

Panel state persists to `localStorage`; library consumers get the same defaults
via `DEFAULT_PARAMS` and override through `GIProvider`'s `quality`/`params`.

## Troubleshooting

- **Everything works but nothing is lit** → no WebGPU (see browser table); the
  corner notice and `onError` carry the reason.
- **"It's slow" on a machine that should be fast** → open `showPerf` or the
  console: a `⚠ SOFTWARE GPU` flag means the browser is CPU-rasterizing
  (hardware acceleration off / blocklisted driver) — no app setting fixes that.
  Also check for Low Power Mode, DevTools being open, or a stale tab on old code.
- **Lighting froze after a driver hiccup / GPU switch** → it should recover by
  itself within a frame or two (device-loss re-init); repeated losses stop with
  the corner notice.
- **A child's colour disappears under its parent** → painter's order sorts by
  `layer`, then area. Give overlays `layer: 1+`; same-layer stacked shapes must
  differ in area.
- **An inset won't go dark** → global `tintAmount` caps albedo influence; set
  `tint: 1` on that shape.

## Known limitations / roadmap

- **Not packaged for npm yet** — adoption is vendor-the-source; an `exports`
  map + library build (and `quality="auto"`) are the next planned steps.
- **Vite-only** as shipped (WGSL `?raw` imports, `import.meta` env checks).
- SDF primitives are rect + circle only (ratings use round pips; arcs/stars
  aren't primitives).
- One `useGIScreen` slot (the landing hero's projected-video light) at a time.
- Film grain is static by design (keeps idle frames at zero GPU work).
- No temporal accumulation; every rendered frame is recomputed.

## License & support

giui is source-available under the
[PolyForm Small Business License 1.0.0](./LICENSE.md): free to use, modify, and
distribute for individuals and companies with fewer than 100 people and under
$1M revenue. Larger companies need a commercial license — contact the author.

Required Notice: Copyright Dave Hale (https://github.com/phuziun/giui)

If giui is useful to you, consider [donating](https://davehale.net/donate). ♥
