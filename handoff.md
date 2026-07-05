# giui — Session Handoff

A dark-neumorphic React UI kit lit by **real 2D global illumination** on **WebGPU**
(radiance cascades). Components write a G-buffer (albedo + 2.5D normal/height +
emission + per-shape control flags); light is simulated and composited so glowing
controls actually cast/bounce light onto their neighbours and the background.

This doc is everything you need to continue. Read the **Gotchas** section before
touching shaders or uniforms — most of our time went into subtle issues there.

---

## Run & verify

```bash
npm install
npm run dev        # serves on http://localhost:5173 (or 5174 if taken)
npm run build      # tsc -b && vite build — ALWAYS run this to typecheck
```

Requires a WebGPU browser (Chrome/Edge 113+, Safari 18+). Drag the glowing orbs to
move the lights.

**Headless visual verification (this is how the previous session checked work).**
There is no browser-automation MCP; instead screenshot via headless Chrome with
WebGPU forced on (works on macOS):

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --enable-unsafe-webgpu --enable-features=Vulkan \
  --use-angle=metal --no-sandbox --disable-gpu-sandbox \
  --window-size=1100,820 --screenshot=shot.png --virtual-time-budget=9000 \
  http://localhost:5174/
```

- `--use-angle=metal` + `--enable-unsafe-webgpu` is what makes WebGPU actually run.
- `--virtual-time-budget` (ms) lets async device init + a couple rAF frames happen
  before the screenshot. Add `--enable-logging=stderr --v=0` to surface WGSL
  validation errors (grep the log for `error|wgsl|validation`).
- Headless uses a **fresh** profile each run → no localStorage → you see *code
  defaults*, not a persisted state. Use this to confirm "fresh load" behaviour.
- ⚠ Virtual-time screenshots **freeze CSS transitions** — the canvas fade-in appears
  stuck semi-transparent. For anything animated or timing-related use REAL-TIME mode:
  launch Chrome with `--remote-debugging-port=92XX --user-data-dir=<scratch>` (no
  `--screenshot`, background it), then drive over CDP from node (≥21: native fetch +
  WebSocket): GET `/json` → open the page's `webSocketDebuggerUrl` → `Runtime.evaluate`,
  `Page.captureScreenshot`, `Input.synthesizeScrollGesture`/`dispatchMouseEvent`. Kill
  the Chrome when done (children can outlive the shell).
- **In-app diagnostics**: FPS HUD bottom-left (leva Debug → `showPerf`; shows fps, p95,
  adaptive scale, render/skip counts, canvas size, GPU adapter, `GI_BUILD` stamp — a
  stale tab is instantly visible). `window.__giPerf`, `window.__giInit`,
  `window.__giForceRender()`. In dev, every viewing tab beacons snapshots to
  `.giui-diag.jsonl` (project root) via the vite `diagSink` — read it to see what the
  USER'S tab actually experiences.
- To inspect an interactive state, synthesize real input over CDP (preferred), or
  temporarily flip a `useState` default and revert.

---

## Architecture / render pipeline

`src/gi/renderer.ts` orchestrates **4 pass types per frame** (cascades = one dispatch
per level; on-demand: only runs when something changed — see the perf bullets):

1. **Scene / G-buffer** (`shaders/scene.wgsl`, compute) — evaluates every SDF shape
   per pixel into **four `rgba16float` targets**:
   - `sceneTex`  — rgb = **GI emission** (drives the bounce), a = light **opacity** (occlusion)
   - `albedoTex` — rgb = **albedo** (painter's-over), a = **coverage** (anti-aliased)
   - `normalTex` — xyz = **normal** (from the additive signed height field), w = **height**
   - `dispTex`   — rgb = **display emission** (`emission × displayScale × bodyAlpha`),
                   a = **per-shape tint boost**
2. **Radiance cascades** (`shaders/cascade.wgsl`, compute) — one dispatch per cascade,
   top-down. Probes raymarch their angular interval against `sceneTex`, then merge the
   sparser cascade above. "Direction-first" texture layout so probe-space bilinear is a
   single hardware sample. Emitters keep full occlusion; non-emissive components have
   their occlusion scaled by the `occlusion` param.
3. **Composite** (`shaders/composite.wgsl`, fragment, **at capped GI resolution** →
   offscreen HDR `litTex`) — shades one continuous material: soft directional **key
   light** (signed N·L) + dim additive **fill light**; **cast shadows** (height-field
   march toward key light) + **contact-shadow AO**; **directional GI bounce** gathered
   from cascade-0 (4 jittered taps, weighted toward the in-plane normal), **added** to
   the surface and masked to components (+ `giBackground` on the backplate); surface
   **micro-texture** (value-noise normal perturbation). Outputs **linear HDR**.
4. **Present** (`shaders/present.wgsl`, fragment, **full swapchain res**) — upsamples
   the smooth HDR `litTex` and does the cheap finishing: exposure, ACES tonemap, sRGB,
   crisp monochromatic **film grain**.

Keeping the heavy per-pixel work (GI gather, AO, shadows) at the capped resolution and
only this cheap pass at full res is what keeps it fast on hi-dpi displays.

### Performance levers
- `maxResolution` (default 1280) caps the GI render's longest side; `renderScale`
  scales relative to canvas. The composite/cascades run at this capped res; present is
  full res.
- `adaptiveQuality` (on by default): the render loop watches smoothed frame time during
  interaction and steps an internal resolution scale down under load, restoring a crisp
  frame when idle.
- On-demand rendering: a static UI does **zero** GPU work.
- **AABB shape cull** (`scene.wgsl:outsideShape`): both per-pixel loops skip any shape
  whose padded bounding box (silhouette + bevel + edgeAA) doesn't contain the pixel.
  Pixel-identical, but per-pixel cost now scales with *local* shape density, not total
  shape count — essential once a page (e.g. the component zoo) holds ~80 spread shapes.
- **VIEWPORT-CANVAS MODE (current default — `viewportCanvas: true`)**: the lit `<canvas>`
  is a small window (viewport + 200px `OVERSCAN` top/bottom) onto the content.
  **CONTENT-ANCHORED since 2026-07** (`GI_BUILD content-canvas-7`): `position:absolute`
  inside the in-flow root + a per-render `translate3d(0, top, 0)` set in the same task
  as the render (frame + position commit atomically). It was `position:fixed` before,
  which meant the compositor scrolled the DOM while the canvas stood still until the
  main thread re-rendered — the light field visibly DRIFTED off the content during
  scroll (worst on flings; became obvious once SCHEMA-15 relief sharpened the shading).
  Content-anchored, the compositor carries the last lit frame WITH the content between
  renders, so stale lighting stays glued to what it was rendered for; the trade-off
  shifts from "everything slips" to "edges beyond the 200px overscan are briefly unlit
  on very fast flings". This also fixes elastic-overscroll drift by construction (the
  canvas rubber-bands with the content). ⚠ **The root MUST have `overflow: clip`**
  (`GIContext` root div): the absolute canvas is `height:100vh+overscan` and its
  `translate3d(0, top, 0)` grows with scroll, so its transformed bottom keeps
  EXTENDING the document scrollHeight → a runaway "scroll past the content" (each
  scroll adds ~overscan of empty space; owner reported it). `overflow:clip` on the
  root pins scrollHeight to the content height without hiding the visible canvas
  (content spans the page, so the viewport slice is always inside the root box;
  only off-screen overscan is clipped). Fixed elements (dialog/palette/HUD) aren't
  clipped — root has no transform, so it isn't their containing block. Also
  `history.scrollRestoration = "manual"` (main.tsx) so reloads open at the top.
  Shapes stay in **content coords** (measured against the in-flow root — nothing
  re-measures on scroll); the scene pass shifts sampling by a `scrollY` uniform
  (`Globals[12]`, buffer grown 48→64B). On scroll: passive listener → `needsRender`; a
  changed offset forces a (viewport-sized, cheap ~1ms) full re-render of the target.
  When the offset is static, band/dirty logic still applies. Why: the legacy page-sized
  canvas meant giant textures (could exceed the 8192 GPU limit on long pages — page mode
  now clamps), page-height present cost, and a huge compositor layer; an inner-div
  scroller with a huge canvas child can also fall off Chrome's composited-scroll fast
  path (main-thread scrolling = "sluggish" feel that rAF stats don't show). Now ALL GPU
  cost is viewport-bounded. The **document** is the scroll container (`.stage` no longer
  scrolls) — always compositor-threaded. Trade-off: during a very fast fling the canvas
  content can lag the DOM by ≤1 frame (it re-renders in the same rAF; the old full-page
  mode had zero lag but all the costs above). Toggle: leva Render → `viewportCanvas`
  (legacy full-page mode kept for A/B). Verified: pixel-aligned mid-scroll at 2×, 120fps,
  scale 1.0, scroll-gesture p50 8.3 / p90 10.7 / **p99 14ms** (was 48), canvas 1216×977
  (was 1216×3327+). `OVERSCAN` exists so emitters just off-screen still light the edge;
  emitters farther off-screen than that do NOT contribute in this mode.
- **Legacy full-content canvas mode** (`viewportCanvas: false`) (`GIContext.tsx`): the lit
  `<canvas>` is `position:absolute; inset:0` inside a `root` that spans the **full content
  height** (root `min-height:100%`; children flow normally in a `z-index:1` layer above
  the canvas). The `.stage` is the scroll container (`overflow-y:auto`), so the compositor
  scrolls the canvas and the DOM **as one native layer** — light and content stay locked,
  with zero per-scroll GI work (shapes don't move relative to the canvas). Shapes are
  measured in **content coords** (relative to root), which are invariant under scroll, so
  `useGIShape` has **no scroll listener** (only ResizeObserver + window resize). `GILight`
  is `position:absolute` (content space) and scrolls with everything; its drag is
  delta-based so it stays correct while scrolled.
  - NB: an earlier attempt pinned the canvas to the viewport (`position:fixed`) and
    re-measured shapes on scroll — that desynced (DOM scrolls on the compositor instantly,
    the GI re-rendered a frame later → visible overshoot/lag). Don't reintroduce it.
  - Trade-off: a very long page renders at the capped `maxResolution` and upscales
    (slightly softer); the AABB cull above keeps the taller render cheap.
- **Render resolution cap = by WIDTH, not longest side** (`renderer.ts`): the GI render is
  capped so `rw ≤ maxResolution` and height scales with it (plus a `rh ≤ cap*4` safety
  bound). Capping the *longest* side squashed a tall full-page canvas's resolution far
  below the display, so bright emitters upscaled into blown-out halos (severe on hi-dpi —
  a 2× Retina full-page canvas was rendering at ~1/8 density). Width-capping keeps the
  same horizontal sharpness as a viewport-sized page regardless of page length or dpr; the
  AABB cull keeps the extra (mostly empty) height cheap. (An earlier `areaCap = cap*cap*0.6`
  was the blown-out mistake — do not reintroduce longest-side/area capping.)
- **Visible-band GI** (`renderer.ts` + `scene.ts` + `GIContext.tsx` + `scene.wgsl` + `cascade.wgsl`):
  the full-page canvas means every GI pass would otherwise scale with page HEIGHT every
  frame. Instead, on a plain update/animation frame, **all three expensive passes only
  process the visible band**, preserving the rest:
  - Scene + cascade compute: a `band : vec2<f32>` (`[y0,y1]` render px) uniform; the shader
    early-outs for rows/probes outside the band (+64px margin for the cascade so the
    composite's spatial gather stays valid), so their storage textures keep the previous
    (static) values off-band.
  - Composite: `loadOp:"load"` + `setScissorRect` to the band.
  A **full** pass (whole canvas, `loadOp:"clear"`) runs on: first frame, resize/rebuild,
  scale change (adaptive dynScale step), or a **structural** scene change (shape add/remove
  — `Scene.consumeStructural()`, set on add/remove, NOT on a plain update). So opening a
  menu/dialog or mounting a component re-renders everything (correct); dragging / hovering /
  animating only touches the viewport → per-frame cost is bounded by the viewport, not the
  page. `GIContext` passes the band from `canvas.getBoundingClientRect()`. Off-screen content
  stays correct because it's static and was fully rendered last. `band` occupies the free
  tail slots: Globals idx 10–11 (48-byte buffer), Cascade idx 26–27 (112-byte buffer, idx 25
  is std140 pad). Caveat: off-screen animations still trigger a (cheap, viewport-bounded)
  frame; a true dirty-rect that skips when the changed rect is fully off-screen is the next step.
- **Backing-store cap** (`GIContext.resize`): the canvas *backing* width is capped at
  `maxResolution` (`k = min(dpr, cap/cssW)`, passed to `render()` in place of dpr — that
  arg is really "backing px per css px"). Before this, the present pass + swapchain ran at
  full device res × full page height (~34M px/frame on a 2× display) even though the GI
  is computed ≤1664 wide — present was the single biggest cost on Retina and the band
  trick can't help it (swapchain textures are transient, always fully redrawn). DOM text
  is unaffected; only the light layer upscales (it already did above `maxResolution`).
- **Off-screen skip** (`GIContext` loop + `Scene.dirtyMinY/MaxY`): `Scene` tracks the css
  Y-range touched since the last render; if every pending change is >250px outside the
  viewport (e.g. an animated spinner scrolled away), the frame is skipped outright. Safe
  because skipped updates re-arm every animation tick, and any render at a new scroll
  band recomputes its rows from current data. `forceRender` (params/resize/init) and
  structural changes are never skipped.
- **Band shape-cull** (`Scene.pack(scale, cullTop, cullBot)`): on band renders the packed
  buffer only includes shapes intersecting the visible band ±256css (quantized to 128px so
  the pack key is scroll-stable) — the scene pass loops shapes per pixel ×5 for normals, so
  with ~150 zoo shapes this is a ~4-5× cut. `Scene.count` now returns the PACKED count.
  The scene pass also writes a band widened by ±128 render px (see `writeGlobals` call) so
  near-edge shapes stay fresh for the cascades' ±64px sampling margin.
- **Adaptive quality fixed for slow machines**: the old logic only adapted when `dt < 60ms`
  — a machine at 5fps *never* engaged it. Now consecutive-but-slow frames (60–500ms) step
  `dynScale` down 0.2 (floor 0.4); the in-burst step-UP was removed (it caused rebuild
  thrash) — quality restores to 1 in one crisp frame when rendering goes idle *or* all
  motion is off-screen.
  Perf levers if still heavy: lower `maxResolution` (1664 is high — also lowers the
  backing cap), fewer simultaneous continuous animations, or fewer total shapes.
- **Perf instrumentation**: `window.__giPerf` (rAF dt ring buffer, render/skip counts, CPU
  submit ms), `window.__giForceRender()` (simulates a leva-style full render), and an
  on-screen **FPS HUD** (bottom-left; leva Debug → `showPerf`, seeded on). Measured on this
  Mac (M-series, 2×, headless real-time via CDP — see `scratchpad/measure.mjs` pattern:
  launch Chrome with `--remote-debugging-port`, drive with node's native WebSocket):
  top-of-page with animations 112fps; mid-zoo 74fps; idle 120fps with **0 renders** (skip
  works); full-render-per-frame (leva drag) 74fps; scroll gesture 104fps. If a user still
  reports slowness at these numbers, suspect: stale tab code (reload), DevTools open,
  Low Power Mode, or another GPU-heavy app.
- **Perceptual smoothness (the final "still feels slow" resolution)** — the user's slowness
  survived every throughput fix because it wasn't throughput. Three real causes, found via
  the **diag beacon** (`vite.config.ts` `diagSink` middleware → app POSTs `__giPerf`/`__giInit`
  snapshots every 4s → `.giui-diag.jsonl`; includes `GI_BUILD` stamp so a stale tab is
  instantly visible):
  1. **Frame pacing on 120Hz ProMotion**: renders at ~11ms (>8.3ms budget) alternate 1-and-2
     vsyncs = judder against compositor-perfect DOM scroll; "80fps feels like 4fps". Fix:
     **pacing governor** — when sustained rendering misses the display budget, lock to every
     other vsync (stable half rate, full quality) before trading resolution; probe full rate
     every 4s. vsync period estimated by rolling MEDIAN of loop-tick dts (the loop ticks every
     vsync by construction; an earlier min-based estimate latched onto double-ticks and made
     the governor overreact — drop to 0.5 scale at a healthy 120fps).
  2. **Continuous ambient animations** (spinner/dots/progress) presented ~100 GI frames/s
     forever → Chrome + WindowServer never rest the window → even macOS Space transitions
     stuttered (WindowServer at 20% CPU). Fix: **ambient throttle** — no user input for 1.5s
     → GI renders at ~30Hz; any pointermove/wheel/key/scroll restores full rate next frame.
     Never delays forced/structural renders. Verified idle renders ~110/s → ~27/s.
  3. **Stale environment**: orphaned tabs on dead dev servers kept old GPU-churning builds
     alive; persisted leva state carried maxResolution 1664 past the 1216 default (schema
     bumped to 12 to force it). "Kill node + restart browser" was part of the cure.
- **Scroll-invariant lighting (the "discrete stepping / text slipping on scroll"
  fix, 2026-07)**: with the SCHEMA-15 stronger relief (heightScale 1.3), three
  long-standing viewport-anchored artifacts became visible when the GI renders
  below css resolution (maxResolution cap on wide/hi-dpi windows) — the light
  field stepped/crawled while DOM text scrolled smoothly. Fixed, all three:
  (1) **fractional scroll offset** — `renderer.ts` no longer `Math.round`s the
  render-px scroll offset (it quantized the light field to >1-css-px jumps);
  (2) **content-anchored stochastic patterns** — micro-texture `vnoise` and the
  gather/AO `ign` dither rotations are seeded with `px + scrollY`
  (Lighting UBO float 46 = texParams.z, written per render), so the noise
  travels with content instead of standing still in the viewport;
  (3) **content-anchored probe grids** — cascade probe grids shift by
  `fract(scrollY / spacing) * spacing` (cascade.wgsl `phase`; Cascade UBO idx 25,
  the old std140 pad; composite's gatherGI inverts cascade-0's phase), so probes
  stay fixed relative to CONTENT and scrolling no longer re-quantizes every
  shape against the grid. Far-field cascades (spacing > 64 render px) skip the
  shift — it could exceed the ±64 band-recompute margin, and they're too smooth
  to step. Phases only change with scrollY, which always forces a full render,
  so band renders keep valid off-band probes. VERIFIED (CDP, 1860px window,
  content-tracked patch over 120px of scroll): patch-luma max step 0.51 → 0.022
  (the 16-render-px periodic probe stepping is gone); per-pixel scroll variance
  1.46 → 1.08 (residual = film grain, which stays screen-space by design).
- **Elastic-overscroll drift**: macOS rubber-band translates the DOM on the compositor,
  invisible to the page — a FIXED light canvas can't follow, so text drifted off its
  lighting at scroll extremes. Historical fix: `overscroll-behavior-y: none` on
  **html ONLY** + a 250ms post-scroll render tail (both kept, harmless). Properly fixed
  by the content-anchored viewport canvas above (it rubber-bands with the content). ⚠ Do NOT also put `overflow-x: hidden` /
  `overscroll-behavior` on body: hidden-x computes body's overflow-y to `auto`, making
  body a second (non-scrolling) scroll container, and `overscroll-behavior: none` on it
  then blocks wheel scroll CHAINING to the viewport — wheel scrolling goes completely
  dead while `scrollTo` still works.
- **Async pipeline creation + fade-in** (`Renderer.create()`, `GIContext`): pipeline
  compilation uses `create*PipelineAsync` (all four in parallel). The old synchronous
  constructor **froze the page for seconds** whenever the WGSL→Metal shader cache was
  cold — i.e. first visit and after every shader edit (the WGSL HMR hook force-reloads
  the tab). Users experienced this as "slow for a long time, then the lighting kicked in
  and it sped up": the freeze, then the first full lit frame replacing the flat unlit
  background. The canvas now starts at `opacity: 0` and fades in (0.4s) after the first
  rendered frame, and the page background (`#1e222b`) approximates the lit scene so the
  pre-GI moment isn't jarring. `Renderer`'s constructor is private — use
  `await Renderer.create(ctx)`. NB measured compile is actually FAST here (cold 12ms,
  warm 3ms; `window.__giInit` reports `{deviceMs, pipelineMs}`) — the real "slow for a
  long time, then AO kicks in and it speeds up" was the adaptive-quality dynamics below.
- **Adaptive-quality dynamics (the "slow then AO kicks in" bug)**: symptoms = sustained
  slowness at a lighter, blurrier look (low-res AO/shadows read weaker), then a sudden
  darker/crisper + fast state. Causes fixed: (1) eager restore — restoring to scale 1 on
  any skipped frame made the restore frame slow → step down → restore → … an oscillation
  of texture-reallocating rebuilds + full-page renders; now restore requires 600ms quiet +
  8s cooldown. (2) fine 0.1 scale steps = a rebuild each → coarse LEVELS [1, 0.7, 0.5].
  (3) one-off hiccups (GC/tab switch) triggered downscale → now needs 2 consecutive slow
  frames. (4) boot frames poisoned the level → 2.5s warm-up grace. (5) no recovery while
  something animates continuously (vsync hides headroom) → periodic upward PROBE: after
  60+ sustained fast frames and ≥10s since last probe, step up one level; the 2-slow-frame
  rule brings it back down if unsustainable. Verified: settles, probes, and returns to
  scale 1.0 at 120fps with skips active. Probe AND restore are additionally **suppressed
  within 1s of any scroll** (passive capture listener) — each transition is a texture
  rebuild + full-page render, i.e. a visible mid-scroll hitch.
- **Scale-invariant lighting (fixed the "darkening pass")**: distance-valued lighting
  params — `aoRadius`, `shadowLength`, `shadowHeight`, `giSmooth`, `textureScale`,
  `edgeAA` — are authored in **css px** and multiplied by the render scale in
  `writeLighting`/`writeGlobals`. Before, they were raw render px, so at reduced adaptive
  scale the AO/shadows spread wider and read *lighter*, and the restore to full res looked
  like a sudden "AO kick-in / darkening pass". Now the look is identical at every quality
  level, which also makes `maxResolution` a pure sharpness/perf dial.
- **Fidelity/perf trades (user-approved)**: default `maxResolution` 1664→1216 (~2× cheaper
  everywhere incl. present/backing; SCHEMA 10), composite GI gather 4→2 taps (the dominant
  sampler cost, halved; per-pixel rotation + giSmooth hide it), contact AO 6→4 taps, key
  shadow march 16→10 steps. Verified at 2×: look holds (AO/shadow character unchanged due
  to css-authoring), scroll gestures p50 8.4ms / p90 14.7ms at scale 1.0.
- **Animations** are CSS-driven with `live` GI shapes tracking them (compositor moves the
  DOM box; the GI shape re-measures each frame): `GIProgress indeterminate` (a glow sweeps
  the track), `GIDots` (staggered scale pulse), plus the existing toggle/slider/segmented
  slides. `live` continuous animation means the GPU isn't idle while it's on screen —
  fine for transient loaders; keyframes respect `prefers-reduced-motion`.
- **`GISelect`** is now a real dropdown: click opens a GI-lit menu (`Surface` panel +
  `GIMenuRow`s that glow accent on hover/selected), click-outside closes. The menu paints
  over content below because it's smaller-area than the tiles it overlaps (painter's order).
- Keep `live:true` for shapes that move **without a React re-render** only (CSS-animated
  thumbs, textarea auto-grow). It runs a `getBoundingClientRect` every rAF forever — a
  forced reflow — so don't add it to shapes whose box only changes on state change.

---

## Key files

| File | Role |
|------|------|
| `src/gi/types.ts` | `Shape` type, `GIParams` type + `DEFAULT_PARAMS` (baked from user's preset1), `FLOATS_PER_SHAPE`, `MAX_SHAPES` (512) |
| `src/gi/scene.ts` | `Scene` class: shapes, storage-buffer pack (+Y-band cull), **area-sort** for paint order, dirty-range + structural tracking |
| `src/gi/device.ts` | WebGPU init; **GPU adapter identification** (`gpuName`/`softwareGPU` — first check when "slow") |
| `src/gi/renderer.ts` | Pipelines (async `Renderer.create`), textures, uniforms, the 4 passes, viewport/page canvas modes, **SCREEN light-source system**, `pipelineMs`. **WGSL-HMR full-reload hook lives here.** |
| `src/gi/GIContext.tsx` | `<GICanvas>`, render loop (on-demand + adaptive + **frame pacing** + **ambient throttle** + off-screen skip), `setShape`/`setScreen`, `useGIScreen`, FPS HUD, diag beacon, `GI_BUILD` stamp |
| `src/gi/GIProvider.tsx` | **Library API**: `<GIProvider theme quality params>`, `useGITheme`, `QUALITY_PRESETS` |
| `src/gi/useGIShape.ts` | Hook: measures a DOM element's box → registers a `Shape`; `live` per-frame re-measure |
| `src/gi/shaders/*.wgsl` | scene / cascade / composite / present (imported `?raw`) |
| `src/components/index.tsx` | The kit (~40 components — see Component API) + `useAccent` theme resolution |
| `src/components/Zoo.tsx` | Components-page demo grid |
| `src/components/Templates.tsx` | Template gallery (Dashboard, Inbox, Sign-in, Settings, Pricing) |
| `src/components/Landing.tsx` | Landing page: `FluidHero` (SCREEN + bloom + recess), features/stats. `HeroLight`/`LavaLamp` kept exported but unmounted |
| `src/App.tsx` | Hash router + lit nav bar, leva **Studio** (`useStudio`), persistence/versioning, quality select, light ownership |
| `src/index.css` | Layout, zoo grid, animations (`gi-*` keyframes), full-bleed `.fluid-hero`, doc-scroll rules |
| `vite.config.ts` | `diagSink` middleware → `.giui-diag.jsonl` (tabs beacon their live perf) |

---

## The Shape data model (`FLOATS_PER_SHAPE = 20`, 5× vec4)

Packed in `scene.ts:pack()`; struct in `scene.wgsl`. **Order matters** — see "adding a
field" below.

```
geom     : vec4  // center.xy, half.xy           (circle: half.x = radius)
params   : vec4  // cornerRadius, kind(0 rect/1 circle), height, bevel
albedo   : vec4  // rgb, opacity (light occlusion 0..1)
emission : vec4  // rgb (GI emission / glow), rolloff (<0 = use global)
extra    : vec4  // displayScale, tint, bodyAlpha, heightScale (<0 = global)
```

Per-shape control flags (the heart of the look — all settable via `useGIShape`):
- **`rolloff`** (`emission.w`, `<0`=global) — bevel curve: 0 soft S → 1 rounded shoulder.
- **`displayScale`** (`extra.x`) — how much of `emission` shows on the shape's *own*
  surface (`dispTex.rgb`), **decoupled** from how much it injects into the GI (`sceneTex`).
  e.g. a button pours full emission into the bounce but `displayScale 0.18` keeps its
  own face a deep chip; a glowing knob uses **low emission + high displayScale** so the
  glow stays on the knob instead of flooding the background.
- **`tint`** (`extra.y`, written to `dispTex.a`) — 0 = obey the global `tintAmount`
  cap; 1 = show **full albedo** ignoring the cap. This is the *only* way to get
  genuinely dark inset fields, because `tintAmount` caps how far a component's albedo
  can blend toward its own colour. Composite: `effTint = mix(tintAmount, 1, dispTex.a)`.
- **`bodyAlpha`** (`extra.z`) — 1 = normal; 0 = **emission-only** (a hidden light):
  contributes emission + opacity to the GI but **no** albedo/coverage/height/display.
  Used by `lightsVisible: false`.
- **`heightScale`** (`extra.w`, `<0`=global) — **per-shape bevel relief** steepness. The
  scene pass builds a *relief* height field (each shape's height × its heightScale) that
  drives the surface **normal** (normal-z fixed at 1); the **raw** height field still
  drives AO / cast shadows / stored height, so physical depth is unchanged. So a large
  panel can get a soft, subtle bevel (low heightScale, e.g. `Surface` defaults to `1.0`)
  while a small control stays crisp (global default `3.5`) — *without* changing how deep
  its shadow reads. Was the old `extra._unused` slot, so no buffer-size change. NB: the
  global `heightScale` (Globals uniform) is now the **default** for shapes that don't set
  their own (it no longer sets normal-z directly).

---

## Uniform layouts (and how to add a field — IMPORTANT)

Three uniform buffers, each a `Float32Array` written in `renderer.ts`. The WGSL struct,
the JS index, and the buffer **size** must all agree, respecting std140 alignment
(vec3 aligns to 16). Adding a field is the #1 source of silent breakage.

- **Globals** (scene pass) — 48 bytes / `Float32Array(12)`. `writeGlobals()`.
  resolution, invResolution, shapeCount, edgeAA, heightScale, normalEps, rolloff,
  edgeBias.
- **Cascade** (per cascade) — 112 bytes / `Float32Array(28)`. `writeCascadeUBO()`.
  probe/tile/dir counts, spacings, interval, tex dims, resolution, raySteps, isTop,
  skyColor+skyStrength, **occlusion** (idx 24).
- **Lighting** (composite) — 192 bytes / `Float32Array(48)`. `writeLighting()`.
  Holds key/fill light, material, `emissiveDisplay`, `giStrength`/`giDirectional`,
  `giSmooth`/`giBackground`, `keyDir`/`keyColor`, `shadow` vec4 (strength,length,height,
  softness), `texParams` vec4 (surfaceTexture, textureScale). Pad slots reused over
  time (`giDirectional` lives in the old keyColor pad, etc.).
- There's also a tiny **Present** UBO (16 B): exposure, grain, encodeSrgb.

**Recipe to add a Lighting/Globals/Cascade uniform field:**
1. Add to the WGSL `struct` (mind vec3→16 alignment; add an explicit pad if needed).
2. Add to the `Float32Array(N)` write in `renderer.ts` at the matching index, and
   **bump the buffer `size:`** in the `createBuffer` call if you grew past the current
   16-byte-multiple.
3. Add to `GIParams` + `DEFAULT_PARAMS` (`types.ts`) and the leva control + mapping
   (`App.tsx`) if it's user-tunable.
4. **Bump `SCHEMA_VERSION`** in `App.tsx` if the new default should take effect for
   existing users (see persistence).

---

## Lighting model summary

- One **material** colour everywhere (`material`); shapes read via their bevel under a
  soft directional **key light** (`ambient` floor + `keyIntensity`·N·L, signed so it
  highlights and shadows). A dim **fill light** lifts the shadow side.
- **Cast shadows**: `shadow*` params, marched across the height field toward the key.
- **Contact shadows**: `aoStrength`/`aoRadius`, height-field AO.
- **GI bounce**: `giStrength` (brightness), `giDirectional` (favour emitter-facing
  bevels), `giSmooth` (gather blur), `giBackground` (how much reaches the empty
  backplate — raise it for component↔background *integration*), `skyStrength` (uniform
  ambient in the cascades; keep low so local emitters dominate), `occlusion` (0 = local
  light spreads across surfaces, 1 = full GI shadowing).
- **Emitter handling**: a pixel's own *visible* glow is `dispTex.rgb × emissiveDisplay`;
  the GI gather is **suppressed where `dispTex` is bright** (so an emitter isn't re-lit
  by its own bounce, and a *hidden* light — zero display — doesn't leave a dark hole).
- **`componentGlow`**: React-side master multiplier on UI components' emission (lights
  opt out via `rawGlow`).
- Surface **micro-texture** (`surfaceTexture`/`textureScale`) and **film grain**
  (`grain`) add matte texture.

The leva panel groups: **Render / Form / Accent / Lights / Depth / Debug**. Debug modes:
Final / Albedo / Normal / Emissive / Irradiance.

---

## Framework layer (`src/gi/GIProvider.tsx`) — the library-consumer API

- **`<GIProvider theme quality params showPerf>`** is the single mount point:
  `theme` = `{ accent, good, warn }` (linear Vec3; partial OK) — components resolve their
  accent via `useAccent(prop)` (`components/index.tsx`): explicit prop wins, else the
  provider theme. **One `theme.accent` recolors the whole kit** (verified: orange swap,
  GI bounce follows). `GIButton`/`GISlider` are presence-based (accent prop = accented,
  none = neutral), so themed call-sites pass `useGITheme().accent` explicitly.
  `quality` = `"low" | "medium" | "high"` → `QUALITY_PRESETS` co-tunes
  maxResolution/cascadeCount/baseTile/stepLen/d0; `params` overrides on top.
- The demo exposes theme + quality in leva: **Accent → accent** (hex picker, seeded
  `#3faaed`) and **Render → quality** (picking a preset overwrites the underlying
  sliders once; hand-tweaks after = "custom").
- **GPU self-diagnosis** (`device.ts`): `GPUContext` carries `gpuName`/`softwareGPU`
  (from `adapter.info`); the HUD shows it, and a software rasterizer (SwiftShader /
  llvmpipe — hardware acceleration off, blocklisted driver) logs a loud console warning
  and shows `⚠ SOFTWARE GPU` in the HUD. **First thing to check when a user reports
  "slow despite good measurements".** `window.__giInit` = `{deviceMs, pipelineMs, gpu,
  software}`.

## Component API (`src/components/index.tsx`)

All take a shared `Vec3` accent; the demo unifies on `ACCENT = [0.05, 0.4, 0.85]`
(cerulean — defined in `App.tsx`).

- **`Surface`** — raised panel; `carved` (or negative `height`) presses in. `opacity`
  (default 0.12) = how much it occludes GI (low = more light integration with bg).
- **`GIButton`** — deep-blue chip (albedo = `accent×0.55`, `tint:1`), strong emissive
  **bounce** but small self-display. Glow: rest `0.5`, hover `1.4`, down `1.0`.
- **`GIToggle`** — carved track that becomes a bright accent surface + glow when on
  (`emission×0.7`, `displayScale 8`); **dark** knob (`[0.05,...]`, `tint:1`).
- **`GISlider`** — dark groove + a **fill** element (left edge → knob's *left edge*, so
  it never overlaps the handle) that's bright accent + glow scaling with value; dark
  knob. `emission×0.8`, `displayScale 8`.
- **`GIField`** — a **real `<input>`** (class `gi-field`) with `pointerEvents:"auto"`.
  Focus/hover give an accent glow + slight lift. The carved well + glow render on the
  canvas behind the transparent input.
- **`GILight`** — controlled, draggable accent emitter. `visible` → `bodyAlpha`. Uses
  `rawGlow:true` so `componentGlow` doesn't touch it. Positions are owned/persisted by
  `App`.

**Component zoo** (added to round the kit out toward shadcn/ui coverage — all built from
the same three recipes: carved well / raised chip / emissive accent):
- **`GICheckbox`**, **`GIRadioGroup`** — carved wells; the checked/selected state fills
  with a glowing accent (checkbox) or holds a glowing accent dot (radio).
- **`GISegmented`** — carved track with a raised, glowing accent **thumb** that slides to
  the active option (tabs/segmented control). `live:true` thumb.
- **`GIProgress`** — carved groove + emissive accent fill (like the slider, no knob).
- **`GIRating`** — clickable pips (filled = glowing accent circle, empty = carved dark).
- **`GIBadge`** (`accent`/`solid`/`neutral`), **`GITag`** (removable), **`GIKbd`** — small
  raised chips; `solid` badge is a bright emissive pill.
- **`GIAvatar`** — raised disc + optional emissive status dot (`status` colour).
- **`GISelect`** — carved field (value + chevron) that glows on hover (display only; no
  menu yet). **`GITextarea`** — the multiline `GIField` (real `<textarea>`, `live` height).
- **`GIAlert`** — raised callout card with a glowing accent bar down its left edge.
- Convention: a GI shape whose visibility toggles at runtime is **always mounted** and
  switched via `emission`/`bodyAlpha` (never conditionally rendered), so it doesn't linger
  in the scene when its state turns off (the unmount cleanup only fires on *component*
  unmount, not on a child div unmounting).
- Second wave (broad scenario coverage), all in `index.tsx`:
  - **Overlays:** `GIDialog` (centered GI-lit modal — **no dark DOM scrim**, since a scrim
    over the canvas would dim the panel's own lighting; uses a transparent click-catcher),
    `GITooltip` (hover bubble, `bodyAlpha` toggle), `GIMenu` (action menu reusing `GIMenuRow`).
  - **Navigation:** `GITabs` (underline with a sliding glow bar), `GIBreadcrumb`, `GIPagination`.
  - **Disclosure:** `GIAccordion` (CSS `max-height` expand).
  - **Data:** `GIStat` (metric + delta `GIBadge`).
  - **Inputs:** `GIStepper` (− value +), `GIRange` (dual-handle slider), `GISearch` (field + glyph).
  - **Feedback:** `GISpinner` (orbiting dot, `gi-spin`), `GISkeleton` (carved lines), `GIToast`,
    `GIEmptyState`. **Util:** `GIDivider`.
  - Active states read mainly via accent **albedo** (`tint:1`) with only a subtle emission glow,
    because the default `componentGlow` is 0.05 — don't inflate emission to compensate, it stays
    consistent with the toggle/slider.
- **`GITable`** — header row + hoverable rows; the row highlight is an accent GI wash
  (always-mounted shape, `bodyAlpha` on hover). Cells are arbitrary ReactNodes, so badges /
  progress bars compose in.
- **Templates** (`src/components/Templates.tsx`, `<Templates/>` below the zoo) — MUI-style
  full compositions built from the kit: **Dashboard** (search + avatar + segmented + stat
  cards + `GITable` with badge/progress cells + pagination), **Sign-in**, **Settings /
  notifications** (toggles + slider + actions), **Pricing** (3 cards, highlighted "Popular"
  tier with taller relief + accent CTA). `MAX_SHAPES` was bumped 256 → 512 for this —
  overflow silently drops the *smallest* shapes (pack sorts largest-first), so keep headroom.
- Third wave: **`GICombobox`** (searchable select: carved input + filtered `GIMenuRow`
  panel), **`GIDatePicker`** (month calendar — day cells are plain DOM; ONE `live` GI
  shape total, the glowing selected-day disc via `bodyAlpha`, so a month never costs 42
  shapes), **`GIList`/`GIListItem`** (hover-wash rows with leading/trailing slots),
  **`GICommandPalette`** (global ⌘K/ctrl-K overlay: `PaletteInput` + filtered
  `GIListItem`s, Esc closes, click-outside closes). Templates gained **Inbox** (list +
  avatars + badges + schedule sidebar with the date picker).
- **Owner's aesthetic rule (learned the hard way)**: "make it cooler" means MOTION and
  INTERACTIVITY, never added brightness — static light washes on the landing were
  explicitly rejected. Keep overall luminance at the preset1 mood; animate the light
  instead. The landing hero's set piece is the **`LavaLamp`** (Landing.tsx): a carved
  vessel + three HIDDEN (`bodyAlpha: 0`) hue-cycling emitters bobbing on CSS paths
  (`gi-lava-*`, `live` shapes; hue advanced ~1.2°/100ms via `hslToLinear`) — you never see
  a light source, only moving pools of radiance on the vessel ("show the light field, not
  the lights" — the owner's framing). Earlier iterations to avoid repeating: a drifting
  warm light (rejected — didn't love it), VISIBLE lava blobs (janky: raised small circles
  get stippled AO/shadow rings that read as dashed outlines, and overlapping bodies
  hard-edge via painter's order). Rule of thumb: for decorative light, hidden emitters
  over visible discs; if a small shape must be visible + raised, expect AO stipple.
  Also in the hero: the draggable `HeroLight` orb and the `gi-breathe` underline.
- **`FluidHero`** (Landing.tsx) — the current landing hero: an edge-to-edge
  (`.fluid-hero` full-bleed: `width:100vw; margin-left:calc(50% - 50vw)`) shallow carved
  band with **8 hidden emitters advected by a curl-style flow** (stream-function sines +
  soft centering; divs moved imperatively in one rAF — no React re-render per frame; the
  `live` shapes track the transforms; hue drifts via 120ms setState). KEY TUNING RULES
  (learned): (1) emitter count is nearly free (cascades don't scale with light count;
  shapes are AABB-culled) — the constraint is TASTE, not perf; (2) narrow palette — ≤~55°
  hue spread drifting as one family; full-spectrum reads as rainbow bokeh soup (rejected);
  (3) keep the text corridor dark — pools are repelled from the central ±330px column;
  (4) dim pools (emission ~0.2, hsl l≈0.42): dark first, light as an undercurrent.
  (The blob-swarm FluidHero was superseded by the SCREEN system below — the balls read as
  balls, escaped the band, and needed a beveled vessel.)
- **SCREEN light source** (the current hero): a rect that shows AND emits an arbitrary
  picture — `useGIScreen(canvas, {emit, display})` (GIContext) attaches an element; the
  renderer uploads the canvas each render (`copyExternalImageToTexture`, fixed
  `SCREEN_TEX_W×H = 256×64`, so the bind group never rebuilds) and the scene pass samples
  it over the rect (scene.wgsl `G.screen` vec4 rect + `G.screenParams`
  emit/display/topFade/topFadeH; Globals grew 64→96B, floats 16-23; bindings
  6=sampler 7=texture). One screen max. **`topFade`/`topFadeH`** (useGIScreen
  opts): EMISSION-ONLY vertical fade — the light poured into the cascades thins
  toward the rect's top edge (`topFade` = cut at y=0, `topFadeH` = ramp height in
  uv) while the visible picture is untouched. Added because the nav/segmented
  switcher above the hero was catching too much GI; the hero uses
  `topFade 0.7, topFadeH 0.45`, and the DOM bloom overlay gets a matching CSS
  `mask-image` top fade.
  ⚠ **sRGB gotcha**: canvas/video pixels are sRGB-encoded — the shader squares them
  (≈linearize); without that, every dark tone lifts into a uniform grey wash over the
  rect. `FluidHero` paints a 30Hz lava-fluid into the source canvas (70 big swirls —
  count is FREE, they're canvas gradients, verified 120fps at 10× count; **per-swirl
  alpha compensates r² area so size/count changes never change total luminance**; slow
  trail fade 0.09 for long smears — safe only after the sRGB fix) — swap the
  canvas for `<video>` frames (drawImage) to literally play video as light.
  **PALETTE (warm–cool, no magenta)**: hues live on the arc blue(220°)→teal→
  green→yellow→orange→red(5°), `h = 220 − pr·215`, which SKIPS the magenta/purple
  wedge. A window slides along the arc; **the per-swirl param REFLECTS (triangle
  fold, not wrap) at the endpoints** — critical: a wrapping window mixes the red
  and blue ends and averages to magenta (verified bug: mean hue hit 282° before
  the reflect fix). So the scene ping-pongs blue↔red through green/orange and
  shows a few related hues at once (owner wanted blue+green+orange+red, "not
  purely blue and red", no magenta; earlier "focus greens" and "blue→magenta"
  were both prior rejected states). Verified: 24-sample sweep, ZERO magenta-zone
  hues.
  **LIGHT-AMPLIFIER WORDMARK (owner: "letters interact with the light, emissive,
  vibrant, not black or dim-grey")**: TWO canvases — `src` (persistent fluid
  sim) and `out` (presented frame, rebuilt from `src` each tick so the letter
  boost can't feed back / run away). `out` = drawImage(src) → per-pixel letter
  amplify → in-canvas glow → RGB split, and `out` feeds BOTH `useGIScreen` and
  the DOM bloom (`src` purely offscreen). The wordmark is a static alpha mask
  (`fillText("giui")` → getImageData once). Per letter pixel the underlying
  fluid is AMPLIFIED above a tolerance knee (0.22) driven by `lit` =
  screen-combine of THREE sources: **local** pools crossing (`tt^1.5`),
  **global surge** (see below), and the **slow hum scanline** (below).
  ⚠ The amplify is **luminance-preserving** (`gain = softCeil(lum)/lum`, scale
  all channels equally) NOT per-channel desaturate-to-white — the earlier
  white-desat washed lit letters to a dim grey (owner rejected); lum-preserving
  keeps them saturated/vibrant/emissive. A single COLOUR floor (vivid current
  palette hue, `max(surgeLit, scanLit)·95`) injects over DARK fluid so both the
  surge AND the scan glow the palette colour — the scan used to inject a neutral
  floor + white pickup and read "too white"; owner wanted it to look like the
  colour glitch/flash. Only the very hottest LOCAL peaks pick up a tiny white glint.
  - **Whole-word SURGE + electric-staccato decay** (owner: "occasionally light
    the whole text, then decay with electric staccato"): `surge` triggers
    ~every 5–6s to 1 and decays (`×0.955`); a `zap` fires on a countdown that
    grows sparser as the surge dies; `envelope = max(steady=surge², flicker=
    surge·zap)` → held-lit early, stuttering flicker late (neon-tube die-out).
    `surgeLit = envelope·0.72` lights the whole mask.
  - **Slow HUM scanline** (owner: "match the slow scanline that darkens, have
    THAT activate the letters — the fast vertical line was too aggressive"): ONE
    line sweeps down at ~8px/s with a long off-screen gap so a full pass happens
    only **~every 45s** (owner: 2–3× less frequent than the first 18s try). It
    does BOTH via two profiles at the same position: a **WIDE dark halo**
    (`humDark`, σ22) darkens the fluid (`×(1−hd·0.5)` on non-letter pixels — the
    visible sweeping band the owner "missed") and a **NARROW bright core**
    (`humBand`, σ11) activates the letters (`scanLit = hb·0.7`, coloured via the
    shared floor). Replaced the earlier fast 55px/s sweep AND the two DOM hum
    bars (removed from CSS) so darkening + reveal are one synced line.
  Earlier attempts (giant black DOM h1; translucent-dark fillText) were rejected
  as too hard / not analog. NO in-flow hero content — band is a 430px spacer;
  tagline/CTA/badge blurb REMOVED. `HeroGlow` deleted. Feature dots + GIStat
  badges use the one blue theme accent. **`emit` history** (screen's GI spill onto
  the page): 0.95→0.48→0.35→0.21 (−40%)→**0.15** (a further −30%, owner);
  **`display` 3.2→3.7** (owner: screen a touch brighter as pools pass over it) —
  display is the visible-picture brightness, DECOUPLED from emit, so the screen
  brightens without adding page spill (that's the key lever: emit = spill,
  display = screen brightness). The band also has an
  **analog screenspace finish** (`.crt-overlay`, index.css + `makeCrtTiles()` in
  Landing.tsx): ORGANIC scanlines (a generated 128×88 canvas tile — jittered
  spacing 3–5.4px, thickness, per-line alpha, darker sub-segments; the uniform
  repeating-gradient read as too mechanical) + **animated film grain** (a 160×160
  noise tile on an oversized `.crt-grain` layer, jumped by a `steps(1)` transform
  keyframe loop ~11×/s — compositor-only, zero GPU/GI cost; **`mix-blend-mode:
  screen` at 0.08 = SHADOW grain**: the noise lifts dark areas and fades to
  nothing over bright pools, like film's noise floor (owner: grain should live
  in the darks, and overlay-at-0.15 was too strong). SOFT by design: tile
  upscaled to 210px + `blur(0.8px)`, and it paints UNDER the scanlines — grain
  lives in the projected signal, scanlines on the tube face) + corner vignette + TWO dark hum bars rolling down at
  different widths/periods/easings (27s + 15s, cubic-bezier — one metronomic
  line read as too uniform). Grain/bars freeze under prefers-reduced-motion.
  Clipped to the band; the DOM text paints above, so it stays crisp. Plus an **RGB split** painted into the source canvas each
  frame: the red channel is TRANSLATED +0.7 texels and blue −0.7 (isolate via
  multiply-with-primary into scratch canvases, strip with a green multiply,
  re-add shifted). ⚠ It must be a translation, NOT an additive copy — the canvas
  feeds back into itself through the trail fade, so any per-frame energy gain
  compounds to bloom-out. The shift also accumulates on old trail content
  (red leads / blue trails the flow), which reads as intentional analog drift. The band sits in a **recessed
  enclosure** (carved Surface — now a WIDE shallow well: `bevel 72, rolloff 0,
  heightScale 0.8, height 0.7`; the original `bevel 38, rolloff 1, heightScale
  2.2` rounded-shoulder wall shaded as a SOLID BAND along the top/bottom edges
  instead of a smooth transition — owner flagged it) with **screenspace bloom**: the SAME source
  canvas DOM-overlaid (`blur(30px) saturate(1.35)`, `mix-blend-mode: screen`, inset
  −14px) — always in sync, spills past the bezel. `emit 0.35` (user calibrated: 0.95 read
  2× too strong → 0.48 → 0.35, "GI contribution still a little high" at 0.48;
  `display` unchanged so the in-band picture keeps its punch). `giBackground` default 0 → 0.14 (SCHEMA 13, deviates from preset1) so
  strong emitters halo onto the backplate — re-zero in Studio if too bright. Screen
  visibility forces renders (GIContext `screenActive` → mustRender; ambient throttle
  still caps idle at ~30Hz).
- **Studio route** (`#/studio`): hosts the leva panel (`<Leva hidden={route!=="studio"}/>`
  — panel hidden on all other routes) and the preset manager rebuilt from the kit
  (`Studio` in App.tsx: controlled `GIField` + `GIButton`s + clickable `GITag` chips; the
  old fixed `PresetBar` + its CSS are gone). Includes a live **Preview** (crisp/raised vs
  soft/carved pair, emitters & controls board) so tuning has something to land on.
- **Nav is the kit**: a raised `Surface` app bar with a `LogoDot` and a
  **controlled `GISegmented`** as the route switcher (`index`/`onChange` added to both
  GISegmented and GITabs). `GIToggle` gained `defaultOn`; `GIField` gained controlled
  `value`/`onChange`; `GITag` gained `onClick`.
  - **NAV BACKLIGHT (owner: "Hue lights behind a TV")** on non-home routes:
    `NavGlow` (Landing.tsx) drifts ~8 HIDDEN emitters (`bodyAlpha:0`) DIRECTLY
    BEHIND the bar (centred, tight `inset:-8`, small size) — the escaping light
    forms a THIN glowing rim around the bar and washes the surroundings. The bar
    and the tab switcher are **`matte`** (see the `matte` feature below), so they
    receive NO GI bounce — the light lands on everything AROUND them but never
    their own faces ("light behind the component, none on it", owner's exact
    ask). `emission scale 0.28`; bar `opacity` 0.55→0.95. The logo lights up as
    **multi-colour alternating** letters (`LitWordmark` in App.tsx: each of
    "giui" gets its own cycling hue off the reflected warm-cool arc) + emissive
    `LogoDot lit`. ⚠ Dead ends (why matte was needed): a SCREEN projected the
    fluid ONTO the bar face; and emitters (behind OR in the margins) still lit
    the face because this GI's component occlusion is low (`occlusion` 0.2) AND
    `giMask` confines the bounce TO components (so a component receives MORE
    colour than the background) — you can't block light behind a component
    physically, hence the matte flag. On home the nav is unchanged (stamped
    `LogoDot` dimple, no glow) since FluidHero owns the one screen slot.
  - **`matte` FEATURE (useGIShape/`Surface`/`GISegmented`)**: a component that
    receives NO GI bounce (its face isn't lit by nearby emitters/bounce; only
    key/fill/ambient shade it). **REWORKED 2026-07-04 (owner: "harsh edge on the
    titlebar")**: the old binary flag (+ 4-tap 6px dilation in composite) made
    the backlight halo cut off as a hard bright rim hugging the bar. Now the
    SCENE pass writes a smooth suppression FIELD into the tint channel per
    matte shape, derived from its SDF distance: `hard` = 1 over face + entire
    bevel lip (kills component-level GI, no lip rim), `soft` = feathers 1→0
    over a `max(bevel*0.45, 8px)` penumbra beyond the lip. Packed as
    `-(hard + soft) - 2*tint*bcov` (face = -2-2tint keeps real tint for
    matte+tint:1 insets like the segmented track); fields combine via **min()**
    (order-independent — painter-mix let the segmented's fading apron ERODE the
    bar's suppression under it → bright ring, first-attempt bug). Composite:
    `matteSoft = clamp(-a,0,1)`, `matteHard = clamp(-a-1,0,1)`, realTint =
    `(-a-2)/2` when `a < -0.5`; `giMask = mix(giBackground*(1 - matteSoft*0.85),
    1, max(cover,hmask)*(1-matteHard))`. The **0.85 cap** lets a whisper of halo
    reach the lip → the value is identical on both sides of the lip (no step)
    and the glow visibly hugs the bar (uncapped full-bevel feather read as a
    dark MOAT that muted the backlight — tuned at a bright hue phase). The
    4 dilation taps are GONE from composite (cheaper); the apron fits the
    existing AABB pad. Non-matte shapes: tint ∈ [0,1] decodes to zeros,
    behavior identical. Perf verified: forced-full-render p50 8.4ms @119fps.
- **Site structure**: a tiny hash router in `App.tsx` (`#/`, `#/components`, `#/templates`;
  `parseRoute`/`ROUTES`) with a `.topnav` (wordmark + **controlled `GITabs`** — `index`/
  `onChange` props added for exactly this). Routes: **Landing** (`src/components/Landing.tsx`
  — hero with an emissive `HeroGlow` bar that actually lights the panels below, CTA
  buttons, badge chips, the Appearance showcase card, three `Feature` cards), **Components**
  (`page-head` + `<Zoo/>`), **Templates** (`<Templates/>`). The `GIProvider` + lights stay
  mounted across routes — route changes are structural scene changes (full re-render, ~1
  frame). The old always-on hero/feature-card block in App was replaced by this.
- The demo layout lives in `src/components/Zoo.tsx` (`<Zoo/>`), rendered by `App.tsx` in a
  4-column `.zoo` grid; the original settings card is the `.feature` (narrow) column.
- **Density pass (owner, 2026-07: "less chunky, more efficient pixel usage")**:
  card radii 12–14 → **9**, card paddings ~22–28 → ~14–20 (Zoo `Tile` 22→16,
  Templates surfaces, Landing `Feature` 20/22→16/18, `GIStat` 16/18→13/15,
  topnav radius 13→10 pad trimmed), control padding trimmed (GIButton 9/18→8/15,
  GIField+GITextarea 11/14→9/12, GIAlert), GISegmented 34→32 tall radius 9→8.
  Meanwhile BETWEEN-card gaps went UP for breathing room: `.zoo` grid 24→32,
  landing features/stats sections 18→30. Direction: dense components, airy layout.
- SDF limits: only rect + circle exist, so star ratings / arc spinners aren't primitives —
  ratings use circular pips and "loading" is a row of staggered-brightness emissive dots.

`useGIShape({ albedo, emission, displayScale, tint, bodyAlpha, opacity, height, bevel,
rolloff, cornerRadius, kind, live, rawGlow, layer })` measures the element and registers
the shape; `live:true` re-measures every frame (dragged/animated elements); `layer`
(default 0) is the paint priority for overlays (see gotcha #2).

---

## Persistence (`App.tsx`)

- Panel state + light positions saved to `localStorage["giui:last"]` as
  `{ version, values, lights }`. Named presets in `giui:presets`, managed on the
  **Studio route** (Save / Copy JSON / Reset / clickable preset chips).
- **`SCHEMA_VERSION`** gates the saved *param values* — bump it when a default change
  should override a stale saved state. **Light positions are kept across version bumps**
  (decoupled from the gate) so a defaults change doesn't scatter the lights. Forgetting
  the bump bit us badly once: a stale persisted `maxResolution 1664` survived the 1216
  default for several sessions and masqueraded as a perf bug.
- Currently **`SCHEMA_VERSION = 15`** (14: hand-placed lights `light1On/2On/3On`
  default **false** — the SCREEN hero + component emission carry the look; the
  orbs can be re-enabled per-light in Studio; `HeroLight` was also unmounted from
  the landing hero at the same time. 15: numeric look values re-baked from the
  owner's dialed-in Studio JSON — ambient 0.27→0.24, keyIntensity 0.36→0.41,
  occlusion 0.15→0.2, **heightScale 0.3→1.3**, rolloff 0.4→0.75, edgeBias
  0.5→0.65, surfaceTexture 0.25→0.32, grain 0.045→0.02, shadowHeight 34→32,
  shadowSoftness 0→0.025; colors/dirs/light positions unchanged). **`DEFAULT_PARAMS` (and the App.tsx colour/light
  seeds + default light positions) are baked from the user's dialed-in Studio state**
  (originally "preset1", numerics re-baked at SCHEMA 15) — a calm, moody look:
  `componentGlow 0.05`, `keyIntensity 0.41`, `skyStrength 0`, `emissiveDisplay 0.45`,
  `heightScale 1.3` + `normalStrength 3` for pronounced relief,
  long soft cast shadows (`shadowLength 122`), `lightsVisible false` (orbs hidden, still
  lit), `maxResolution 1216` (perf; sharpness is a pure dial now)
  and `giBackground 0.14` (so strong emitters halo the backplate — user asked for visible
  GI spill). Panel colours (keyColor/material/fillColor/skyColor) are stored as **hex** in
  the App.tsx leva seeds (the runtime source of truth) and as linear Vec3 in
  `DEFAULT_PARAMS` — keep both in sync when changing a default colour.

---

## Gotchas (read before editing)

1. **WGSL changes don't hot-reload.** Pipelines compile once at canvas mount and React
   Fast Refresh keeps the renderer alive. `renderer.ts` has an `import.meta.hot` hook
   that forces a **full page reload** on shader change — but you still need to hard-
   reload once after pulling new code. If a shader edit "does nothing", you're on stale
   pipelines.
2. **Painter's order = layer, then area.** Albedo and tint are painter's-over in the
   scene loop; `scene.ts:pack()` sorts by **`Shape.layer` ascending, then
   largest-area-first** so nested children (a field in a card, a knob on a track)
   paint *over* their parent. Height/emission are additive (order-independent). If a
   child's colour gets overwritten by its parent, this sort is why. Two same-layer
   shapes that must stack correctly should differ in area. **Overlays (dialog/menu/
   tooltip/palette panels) set `layer: 1-2`** — a big dialog panel otherwise painted
   UNDER the smaller tiles it covered ("transparent modal" bug, fixed 2026-07). The
   DOM half of that bug: page text sits above the canvas, so it bled over the lit
   panel — overlay panels now carry `backdrop-filter: blur` (smudges bleed-through
   text) and GIDialog/GICommandPalette punch a scrim via
   `box-shadow: 0 0 0 200vmax rgba(...)` on the panel wrapper (dims the page
   everywhere EXCEPT the panel rect, so the panel's own canvas lighting stays
   undimmed — a plain full-screen scrim would dim it, the reason scrims were
   originally rejected). `layer` is JS-sort-only — not packed, no buffer change.
3. **`tintAmount` caps inset darkness.** You cannot make a field dark just by lowering
   its albedo — set `tint:1` on the shape to bypass the global cap (uses `dispTex.a`).
4. **`pointer-events: none` on `.layout`.** The DOM overlay is click-through by default
   so the canvas shows; **every interactive component now sets `pointerEvents:"auto"`
   inline on its own root** (Button/Toggle/Slider/Segmented/Range gained it after the
   templates — which don't use the re-enabled `.row`/`.zoo-demo` wrappers — shipped
   completely dead to input). Rule for new components: self-enable, never rely on a
   wrapper class.
5. **Adding a uniform field** → struct + index + buffer size + (maybe) version bump. See
   recipe above. Mismatches read garbage silently.
6. **Persisted state overrides defaults.** Changing a `DEFAULT_PARAMS` value won't show
   for an existing user unless you bump `SCHEMA_VERSION` (or they Reset). Component-level
   constants (in `components/index.tsx`) are *not* persisted and always apply.
7. **macOS preferred swapchain format is non-sRGB** → the shader encodes sRGB itself
   (`encodeSrgb`). Don't double-encode.

---

## Adoption-readiness pass (2026-07-04, owner: "review as a customer")

An audit + fixes so an adopting engineer doesn't hit sharp edges:
- **Dev diag beacon** stops after the first non-ok response — a consumer
  vendoring the source into their own vite app (no `diagSink` middleware) no
  longer gets `POST /__giui-diag` every 4s in their network tab. The 1.5s kick
  `setTimeout` is stored + cleared on unmount.
- **StrictMode leak fixed**: the aborted first mount now `device.destroy()`s at
  the `disposed` checks (device was orphaned before — one leaked GPUDevice per
  dev mount); normal unmount also destroys the device deterministically.
- **GPU device-loss recovery** (`GIContext`): `device.lost` (reason ≠
  "destroyed") bumps a `gen` state that re-runs the whole init effect — scene
  survives in React state so lighting recovers in place. >3 losses within
  rolling 30s windows → gives up, corner notice + `onError`.
- **`onError` prop** on GIProvider/GICanvas (lighting-layer failures; UI keeps
  working unlit). The error overlay is now a compact NON-BLOCKING corner chip
  with inline styles — the old `.gi-error` was a full-page `inset:0` veil
  without pointer-events:none, i.e. it click-blocked the perfectly usable
  unlit UI on Firefox (removed from index.css).
- **Kit CSS is library-owned**: `src/components/components.css` (gi-field
  placeholders, gi-spin/gi-dot-pulse/gi-progress-sweep keyframes + reduced-
  motion) imported by `components/index.tsx` — vendored copies work without
  the demo stylesheet. index.css is demo-only now.
- **leva → devDependencies** (demo-only; library code imports only react).
- **README rewritten MUI-style** (correct GIProvider API — it documented the
  defunct GICanvas/GILight-`initial` API; browser table + fallback story;
  vendoring install path; quality presets; engine-automatic vs consumer-
  controlled perf; 41-component catalogue; useGIShape guide; troubleshooting).
- Known remaining blockers for "npm install giui" adoption (documented in
  README, roadmap below): no exports map / lib build (`private:true`), and the
  engine is Vite-only (`?raw` WGSL imports, `import.meta.env`) — Next.js needs
  raw-loader config. Audit rated everything else (cleanup, listeners, graceful
  no-WebGPU path) solid.

## Session 2026-07-04 (later): docs site, motivated backlight, nav rename

- **Docs route** (`#/docs/<slug>`, in the nav): MUI-style reference built from
  the kit itself — `src/components/docs/` (Docs.tsx sidebar+page shell,
  CodeBlock.tsx dependency-free regex TSX highlighter + copy button,
  `entries/` data split by group). ~30 pages cover all 41 components plus
  Getting started / Custom shapes / Studio guides; every example is a LIVE
  demo in the real light field with its copyable source string beside the JSX
  (keep code strings in sync when APIs change). Hash router now supports
  sub-paths (`parseRoute` keeps the full path; App splits page/sub). Sidebar
  is plain DOM links (shape-budget), demos get pointer-events via
  `.docs-demo > *`.
- **Nav is now Home / Examples / Components / Docs / Studio** — Templates
  renamed to Examples (`#/templates` redirects in parseRoute).
- **"Motivated" nav backlight (owner)**: sequence of owner asks — halve the
  bar's GI spill (blob emission 0.042→0.021), then "brighter VISIBLE light
  behind the bar". Resolution decouples the two:
  (1) matte apron now REVEALS background GI — composite
  `bgGI = mix(giBackground, 0.5, matteSoft) * (1 - matteHard)` — the
  backplate right behind the bar shows up to 0.5 GI vs the 0.14 global cap,
  fading back across the soft zone (the wall behind a backlit TV is the
  brightest spot); face+lip stay dark via matteHard; scene hard-exit ramp
  widened 2→5px so the escaping rim ignites gently.
  (2) NavGlow blobs smaller+hotter (96px@0.021 → 76px@0.031): near-field
  surface brightness ~2× while total flux (area×emission) stays at the halved
  level — far spill unchanged. The old "small bright blobs = hard rim"
  rejection no longer applies because the penumbra smooths it.
  (3) **LitWordmark letters are now real emitters** (`LitLetter` in App.tsx:
  hidden circle per letter, `hslToLinear(h,.85,.55)×0.5`, opacity 0.35,
  rawGlow; hslToLinear is exported from Landing.tsx) + stronger text-shadow —
  owner asked for "a touch more glow/GI from the giui text".
- **Hero screen is responsive (owner: "we squish the giui screen on mobile")**:
  the wordmark mask in FluidHero is ASPECT-COMPENSATED — pre-scaled
  horizontally by (texture aspect 4:1 / band aspect), uniformly shrunk if the
  widened word wouldn't fit, rebuilt on window resize (`buildMask`) — so the
  letters keep their true ratio at any viewport. Band height is now
  `clamp(200px, 33vw, 430px)` (spacer div; `.fluid-hero` min-height removed):
  phones get a ~200px strip, desktop ≥1300px unchanged at 430.
  ⚠ Known mobile gap (NOT fixed): the nav `GISegmented` is fixed 480px wide
  and clips on phones ("Studio" cut off at 390px) — really wants the app-shell
  drawer pattern from the roadmap, not a width hack.
- **Adoption fixes recap** (details in the section below): beacon stops on
  first non-ok POST, StrictMode device leak fixed, device-loss auto-recovery
  (`gen` state re-runs init), `onError` prop, non-blocking corner error chip,
  kit CSS moved to `src/components/components.css` (imported by the kit),
  leva → devDependencies, README rewritten MUI-style.

## Current state (where this session ended — updated 2026-07-04)

**The project goal** (user's words): a dark neumorphic component framework that "just
works" and is somewhat customizable, rendered performantly and physically instead of
tweaking a million gradients.

### ⚠ Repo / deploy / git status — READ FIRST
- **GitHub repo EXISTS**: `github.com/phuziun/giui` (public). Owner is GitHub user
  **`phuziun`** (id 11510188). `gh` CLI is authed. Local git identity is set per-repo
  to `Dave Hale <11510188+phuziun@users.noreply.github.com>` (privacy noreply — do NOT
  use the gmail).
- **⛔ ONLY `git push` WHEN THE USER EXPLICITLY ASKS.** Commit locally freely, never
  push unprompted (see memory `git-push-permission`). At session end there were
  **several local commits AHEAD of origin/main, unpushed** (check with
  `git log --oneline origin/main..HEAD`) — tell the user they can push when ready;
  do not push for them.
- **Live demo**: GitHub Pages at **https://phuziun.github.io/giui/** — auto-deploys on
  push to `main` via `.github/workflows/deploy.yml` (npm ci → build → deploy-pages).
  Pages source = GitHub Actions, HTTPS enforced (WebGPU needs it).
- **Vite `base`**: `/giui/` for `build`, `/` for dev (`vite.config.ts`, keyed on
  `command`) so the local server + headless tooling still hit `localhost:5174/`.
  Override with `VITE_BASE` (e.g. `/` for a future apex custom domain).
- **License**: `LICENSE.md` = PolyForm Small Business 1.0.0 (source-available; free
  under 100 people/$1M rev, larger orgs buy a commercial license). Favicon = glowing
  orb on a dark chip (`public/favicon.svg` + PNG fallbacks, base-aware links).

### Pending decisions (owner mulling — do NOT change unprompted)
- **Real name**: "Dave Hale" still appears in LICENSE/README copyright notice +
  package.json author. Owner was unsure about using it; hasn't decided. `davehale.net`
  domain also carries the name (see below).
- **Donate link**: still `https://davehale.net/donate` (placeholder) in README,
  `.github/FUNDING.yml`, package.json `funding`, and the footer was removed. Owner may
  move to GitHub Sponsors (needs them to enrol). Project/homepage links already point
  at the GitHub repo (moved off `davehale.net/giui`).

### What exists now
- **Framework**: `<GIProvider theme quality params showPerf>` — one `theme.accent`
  recolors the whole kit; `quality` presets co-tune perf knobs; GPU self-diagnosis +
  FPS HUD (Studio-only: `showPerf && route==="studio"`) + diag beacon.
- **Site** (hash routes): `#/` **landing**, `#/components` (zoo of ~40), `#/templates`
  (Dashboard/Inbox/Sign-in/Settings/Pricing), `#/studio` (leva panel + preset manager,
  hidden elsewhere).
- **Landing hero** = the **projected-wordmark screen** (see the FluidHero section
  above): the fluid SCREEN with the "giui" wordmark painted INTO the projection as a
  light-amplifier, warm-cool no-magenta palette, whole-word surge + electric-staccato
  decay, slow hum scanline, film grain, RGB split, analog CRT finish. Below it: 3
  Feature cards + 3 GIStat cards (all one blue accent). NO footer, no tagline/CTA block
  (removed). `emit 0.15`, `display 3.7`.
- **Nav (non-home routes) = matte bar with a "Hue-lights-behind-a-TV" backlight**:
  `NavGlow` hidden emitters behind the bar, the bar + tab switcher are `matte` (the
  new **matte feature** — receive no GI, so the light lands AROUND them not on their
  faces), composite dilates the matte to swallow the bevel lip (no bright rim). The
  logo lights up as **multi-colour alternating** letters (`LitWordmark`). Emitter
  `emission scale 0.042`. On home the nav is a plain stamped bar (no backlight).
  ⚠ This took ~15 iterations — read the NAV BACKLIGHT + `matte` bullets before touching.
- **Density**: dense components (radii ~9, tight padding), airy layout (zoo gap 32,
  landing section gaps 30). **Slider** fill glow scales ±30% with value.
- **Scroll**: `overflow:clip` on the GI root (runaway-scroll fix) + manual
  `scrollRestoration` — see the viewport-canvas bullet. Don't remove either.
- **Persistence**: `SCHEMA_VERSION = 15`; hand-placed orb lights default OFF.

Verification workflow (headless-Chrome screenshots + real-time CDP measurement + diag
beacon) is in *Run & verify* + the perf bullets; memory `webgpu-headless-verify` mirrors
it. Tip: to diagnose relief, set `seed("debugMode", 2)` in App.tsx (the seed literal, NOT
`DEFAULT_PARAMS`, drives a fresh profile).

## Roadmap (agreed next steps, in rough priority)
- **Public release** — mostly DONE (see "Repo / deploy / git status" above): repo live,
  GitHub Pages deploying, PolyForm license, favicon. Remaining/optional: owner decides
  on donate → GitHub Sponsors (and whether to keep the real name / `davehale.net`);
  eventual home-server host (Caddy + Cloudflare Tunnel) under `giui.davehale.net`
  (prefer a subdomain over a `/giui` subpath — avoids Vite base fuss). If outside PRs
  are accepted, add a CLA/DCO note so commercial relicensing rights are retained.
- **App-shell components**: AppBar, NavRail, Drawer/Sheet — the frame for real apps, and
  an app-shell template exercising them.
- **Snackbar queue** (imperative `toast()` API) building on `GIToast`.
- **Packaging**: npm entry point (`exports` map), Vite lib build, demo separated from
  library; `quality="auto"` picking a tier from adapter info + measured frame time.
- **Video-as-light**: a Studio toggle feeding `<video>` frames into the hero SCREEN
  (architecture already supports it — drawImage into the source canvas).
- Smaller: `GISelect`/`GICombobox` keyboard navigation; smooth tweens for focus glows;
  per-instance `displayScale`/`glow` props on more components; time-driven film grain
  (needs a `time` uniform + breaking pure idle).
- Perf (only if ever needed again): dirty-rect scene/cascade band narrowing in viewport
  mode; real grid fluid sim into the SCREEN texture.

## README
`README.md` has a user-facing version of the pipeline, component API, and the full leva
param list — keep it in sync when you add params.

## Roadmap sprint (2026-07-04, owner: "knock out everything else in the roadmap")

All agreed roadmap items are DONE (each verified headlessly + committed separately):
- **Snackbar queue**: `<GIToaster/>` (mount once) + imperative `toast()`
  (string shorthand; queue, auto-dismiss, click-dismiss, `live` cards so the
  light follows the slide). Studio Save/Copy fire real toasts.
- **Keyboard nav**: GISelect trigger is focusable role=combobox (Enter/Space/
  arrows open, arrows/Home/End move a glowing `highlighted` GIMenuRow, Enter
  picks, Esc/Tab closes); GICombobox highlights the first match (Enter picks
  from typing).
- **App shell**: `GIAppBar` (leading/title/trailing, optional matte),
  `GINavRail` (vertical accent-chip nav, `collapsed` icon mode), `GIDrawer`
  (controlled slide-in, Esc/outside close, layer-2 + hole-punch dim, live
  shape). Examples page gains a "Console" mock; docs gain an App shell group.
  NB: the mobile-nav gap (fixed-width GISegmented clipping at 390px) can now
  be fixed with GIDrawer — natural next step.
- **Glow tweens**: `useGIShape({ tween: ms })` eases EMISSION changes
  (exponential, rAF loop alive only during the transition; first mount snaps;
  re-entrancy-guarded). Applied: GIButton 150ms, field family 180ms. Per-
  instance `glow`/`displayScale` props on GIButton, `glow` on GIField.
- **Packaging**: `npm run build:lib` → dist-lib (ES, React external, WGSL
  inlined, d.ts via tsconfig.lib.json, style.css). package.json has exports/
  types/files/sideEffects/peerDeps; still `private:true` (publish + name =
  owner's call). VERIFIED with a real consumer app installing the packed
  tarball (typechecks, builds, renders lit). Root div now defaults
  minHeight:100vh + #1e222b background (consumer pages without a height
  chain/dark body rendered white-on-white before).
- **quality="auto"** (+`onGPUInfo` on provider/canvas): medium, drops to low
  on a software rasterizer once adapter info arrives.
- **Video-as-light**: Studio "Hero source" card — pick a local video (object
  URL, no canvas taint) → FluidHero draws frames into `src` (cover-fit, full
  overwrite so the RGB split can't compound) instead of the fluid sim;
  wordmark/hum/CRT/GI all read the same frames. "Fluid sim" switches back.
  `Landing`/`FluidHero` take a `heroVideo`/`video` prop; state lives in App.
- Also this sprint: **Debug views** Height/Shadow/AO/Occlusion (composite
  debugMode 5-8; leva options updated — Occlusion also reveals hidden
  emitters).

NOT done (deliberate): time-driven film grain (breaks zero-idle-GPU by
design), dirty-rect band narrowing (perf headroom not needed), owner-decision
items (npm publish/name, sponsors, custom domain, real-name question).

## EXPERIMENT: GI-Lite (2026-07-04, owner: "match the look, much more performant,
## resolution independent, mobile / dense layouts — feel free to invent")

**`src/gi2/` + the `#/labs` route (in the nav).** A second, experimental engine
answering "SDFs × Spherical Harmonics": same look recipe, restructured cost.

### Architecture (shaders/lite.wgsl — one file, 4 entry points)
1. `emitCS` — emission+occlusion raster at **css/6** (the only rasterized state).
2. `probeCS` — **2D circular-harmonics probe grid** (16css spacing): each probe
   marches 20 rays through emitLo (front-to-back transmittance, cascade-style),
   projects onto **L0+L1** (a0, a1, b1 × RGB in 3 rgba16f textures). Cost ∝ css
   area — **independent of DPR**. Reconstruction matches the cascade gather's
   flat+dir split: flat = π·a0, dir = max(a0 + (π/4)(a1·nx + b1·ny), 0).
3. `tileCS` — per-32devpx-tile shape lists, one thread per TILE looping shapes
   (deterministic → painter's order preserved; no atomics/sort). Cap 23/tile.
4. `fs` (present) — the ONE device-res pass: **analytic SDF shading** (exact
   rounded-rect gradients + closed-form bevel-profile derivative → crisp relief
   at ANY resolution, no G-buffer), analytic AO (looming-wall falloff), **offset
   -SDF cast shadows** (one shifted SDF eval per raised shape ~ the marched
   look), 2 jittered CH taps (giSmooth-equivalent), ACES+grain inline.
   Zero full-res intermediate textures.

`renderer2.ts` (reuses gi/device + gi/scene pack at scale=1 = css units),
`GI2Board.tsx` (mini provider + useGI2Shape), `components/Labs.tsx` (lab board:
LPanel/LButton/LToggle/LWell/LDot ports, draggable LLight, 84-chip dense grid,
Benchmark button + `window.__gi2Bench()` headless hook).

### Calibration traps (each cost a broken-looking first render)
- **n2 for directional GI must be `normalize(vec3(-gradH,1)).xy·normalStrength`**
  — normalizing gradH alone makes it near-unit and the dir term blows out ~5×.
- **Height-field normal is (-dh, 1)** — sign flip = lighting from the wrong side.
- **Clamp the L1 reconstruction ≥ 0** — negative lobes SUBTRACT light and paint
  dark smudges at probe scale.
- Interior SDF gradient needs a soft wall-blend near the diagonal (hard select
  draws mitre lines the raster engine's finite differences never showed).
- Offset-shadow penumbra: pen = 6 + off·softness (px); first guess ×12 gave
  177px smears.

### Measured (M-series Mac, headless, forced continuous full renders)
- Desktop 1400×900 @2×: **GI-Lite 120fps vsync-limited** vs cascades 51fps.
- Phone-sim 390×844 @3×: **GI-Lite 120fps at NATIVE 3× res**; cascades reach
  120fps only at maxResolution 480 (= 2.4× upscale, visibly soft).
- Dense +84 shapes: **no measurable cost** (tile binning works).
- CPU submit ~0.1-0.4ms; probes ~2k for the board.

### Main-engine fix that fell out of the experiment
`GIContext.resize`: backing scale is now `min(dpr, 2, capW/cssW)` — on narrow
high-dpr phones the width cap NEVER engaged (1216/390 > 3), so the whole
pipeline silently ran at a 1170×3700 backing. This alone is a big part of
"mobile felt heavy" with the current engine.

### Honest gaps / next steps if promoted beyond a lab
- Not ported: matte penumbra, SCREEN (video/canvas light), scroll-window mode
  (board is a fixed region), band rendering, adaptive quality (doesn't need it
  so far), per-shape rolloff variety tested only lightly.
- Probe grid is per-board; a full-page version wants the viewport-window +
  content-anchored probe phase treatment the main engine already solved.
- Possible upgrades: L2 band (2 more coefficients) for sharper directionality;
  temporal probe reuse (only re-march probes near changed shapes); probe rays
  against an SDF texture (JFA) instead of emitLo for harder shadows.
- Look match ≈ target aesthetic; deltas: shadows slightly simpler (single-eval
  penumbra), GI a touch smoother (L1 vs 16-dir cascade-0).

## GI-Lite PROMOTED to a switchable full-site engine (2026-07-04, owner:
## "full featured mode I can switch to after more testing")

**Studio → Render → `engine` (cascade | lite)** now switches THE WHOLE SITE
between renderers; library consumers: `<GIProvider params={{ engine: "lite" }}>`.
`GIParams.engine` (default "cascade"), `GIProvider` mounts `GICanvasLite`
(src/gi2/GICanvasLite.tsx) instead of GICanvas — SAME GIContext contract
(GIContext + ScreenSpec now exported from GIContext.tsx), so every component,
useGIShape, and useGIScreen work unchanged on either engine.

### What was added for parity (renderer2 + lite.wgsl)
- **Content-window/full-page mode**: `render(..., originY, screen)` — all math
  in CONTENT css coords (`p = devPx/dpr + origin`), probe grid quantized to an
  absolute content grid (`probeOrigin`) so nothing swims on scroll. Canvas =
  viewport + 2×OVERSCAN, translate3d'd like the main engine. Verified: deep-
  zoo scroll pixel-clean, 8.29ms/frame during continuous scrolling.
- **SCREEN support**: emitCS pours the picture in as emission (sRGB² linearize
  + topFade), present adds display INTO `disp` before the emitter mask.
  Hero video/canvas projection works on lite.
- **Analytic matte**: hard/soft fields computed per-pixel from each matte
  shape's SDF (max-combined) — no tint-channel encoding needed at all; same
  revelation giMask formula. Nav backlight reads correctly.
- **MAX_SHAPES 512**, dialog/menu layers work through the tile lists (order-
  preserving binning), device-loss recovery + StrictMode hygiene + ambient
  throttle (30Hz) in GICanvasLite. No adaptive/pacing machinery — not needed.

### THE calibration lesson of the port (cost a flooded-white hero)
`cascade.wgsl:62` accumulates `radiance += T · emission · op` — emission is
PREMULTIPLIED by local opacity and emitter texels keep full occlusion, so a ray
inside an emitter sums the geometric series op·(1-op)^k ≈ 1× emission TOTAL
regardless of emitter SIZE (surface-radiance-like, self-limiting). GI-Lite's
emitLo now stores `emis·op` premultiplied with the same occ rule
(lite.wgsl emitCS comment). Without it the hero screen (huge emitter)
flooded the probe field ~9×. giProbeLift stays 1.0 after this fix.
Also fixed in the port: analytic AO changed to the two-sided PROFILE
DIFFERENCE across aoRadius × 0.35 (angular average) — plateau-minus-height
painted picture-frame rings on cards, then the unscaled max ringed small chips.

### Verified on lite (A/B vs cascade at 1400×900)
home (hero screen + fluid + wordmark), components zoo (~150 shapes; look
matches cascade closely: glows, wash, matte nav), examples (app shell),
dialog overlay (layer-2 over tiles + punch dim), mid-scroll clean, scroll
bench 8.29ms/frame. Remaining look deltas (acceptable for testing): slightly
smoother GI than the 16-dir cascade gather, offset shadows a touch simpler,
minor probe blotch at hard viewport edges.

### Files: gi2/GICanvasLite.tsx (new), gi2/renderer2.ts + lite.wgsl (grown),
### gi/GIContext.tsx (exports GIContext/ScreenSpec/OVERSCAN), gi/types.ts
### (engine field), GIProvider (switch), App.tsx (leva engine select).

## Mobile diagnosis + lite near-field fix (2026-07-05)

**Phone report (owner's Android, PowerVR "img-tec d-series")**: giDebug chip
shows webgpu yes / init ok / error none — yet the page renders black except
the DOM bloom. NOT a WebGPU-availability problem. Diagnosis tooling added:
- `?giDebug` chip now shows renders/scale, a **stages probe** (reads back
  8×8 center blocks of gScene/gNormal/cascade0/litTex max values —
  trisects which pass goes dark; `window.__giProbe()`), and the FIRST
  `device.onuncapturederror` (was console-only = invisible on phones; both
  engines). G-buffer/lit textures gained COPY_SRC for this.
- `?engine=lite|cascade` URL override (phone A/B without Studio).
- Desktop Safari 26 verified running BOTH engines (cascade 120fps, lite ✓)
  → WebKit WGSL compiles fine; iPhones on iOS 26 should work.
AWAITING: owner re-opens ?giDebug on the phone → stages line + any GPU error
pinpoints the dark pass on PowerVR.

**Lite "weird artifacts on draggable lights" (owner) — FIXED, three parts:**
1. **Direct near-field emitter term** (the big one): L0+L1 probes cannot
   represent a nearby emitter's narrow cone — it smeared into a hard-edged
   grey blob. Present now computes near-field light analytically per pixel
   from tile-local emitters with the ANGULAR-SIZE kernel `asin(rEff/d)`
   (matches the probe integral's scale exactly), faded 70..130px; probe rays
   start at t0=40px (the cascade interval-split idea). Emissive shapes pad
   their tile reach by 130px; TILE_CAP 23→31 (TILE_SLOTS 32 in renderer2).
2. **Smooth probe rotation**: hashed per-probe ray rotation made distant
   small emitters hit/miss randomly probe-to-probe → large low-frequency
   RAINBOW BLOTCHES on the background. Rotation now varies continuously
   across the grid (error becomes smooth drift). rayCount 20→28.
3. **Contact ramp** on the direct kernel (smoothstep 0..6px past the
   silhouette): the 90°-peak at contact amplified gather dither into a
   speckled ring around emitters.
