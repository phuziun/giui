# giui

A dark-neumorphic React UI kit lit by **real 2D global illumination**. Instead of
faking depth with hand-tuned gradients, every component writes a G-buffer
(albedo + 2.5D normal/height + emission/occlusion) and light is simulated with
**radiance cascades** on **WebGPU**. Glowing components actually cast and spread
light onto their neighbours, and beveled edges shade themselves from the
resolved radiance field.

```bash
npm install
npm run dev      # open the printed http://localhost:51xx in a WebGPU browser
npm run build    # typecheck + production build
```

> Requires a WebGPU browser (Chrome/Edge 113+, or Safari 18+). Drag the glowing
> orbs around the demo to move the lights.

## How it works

Three GPU passes per frame (`src/gi/renderer.ts`):

1. **Scene / G-buffer** (`shaders/scene.wgsl`, compute) — evaluates every
   registered SDF shape per pixel into four `rgba16f` targets:
   - `sceneTex`  — rgb = emitted radiance (drives the bounce), a = light opacity
   - `albedoTex` — rgb = albedo, a = anti-aliased coverage
   - `normalTex` — xyz = surface normal from the height field (the bevel), a = height
   - `dispTex`   — rgb = surface display emissive (emission × per-shape `displayScale`)

   Splitting the emission an emitter *injects into the scene* from what shows on
   *its own surface* lets a button pour blue light onto its neighbours while
   staying a deep-blue chip itself.
2. **Radiance cascades** (`shaders/cascade.wgsl`, compute) — run once per
   cascade, top-down. Each probe raymarches its angular interval against
   `sceneTex`, then merges the sparser cascade above it (4 child directions ×
   bilinear probe lookup). A "direction-first" texture layout makes the
   probe-space interpolation a single hardware-filtered sample.
3. **Composite** (`shaders/composite.wgsl`, fragment, **at the capped GI
   resolution** into an offscreen HDR target) — shades one continuous material
   with a soft directional **key light** (signed `N·L`) plus a dim additive
   **fill light**. Three kinds of shadow: a **cast shadow** marched across the
   height field toward the key light (raised elements throw soft drop shadows),
   a **contact-shadow AO**, and — because components **occlude light in the
   cascades** (step 2) — local lights cast real shadows in their bounce. The
   cascade radiance is gathered **directionally** (a jittered multi-tap weighted
   toward the surface's in-plane normal, so bevels facing an emitter brighten)
   and **added** to the surface (not modulated by the near-black albedo),
   **masked to the height field** — so a glowing component's light bounces onto
   its neighbours' faces and bevels, and is blocked into shadow by occluders.
4. **Present** (`shaders/present.wgsl`, fragment, **full swapchain resolution**)
   — upsamples the smooth HDR target, then does the cheap finishing: exposure,
   ACES tone-map, sRGB, and crisp monochromatic **film grain**. Keeping the heavy
   per-pixel work (GI gather + AO) at the capped resolution and only this cheap
   pass at full res is what keeps it fast on hi-dpi displays.

The look is **one material**: background and components share a single colour
(`material`), so a shape is revealed only by its soft beveled lip catching the
key light — it appears to swell out of (or press into) the same sheet. Height is
a *signed, additive* field (`scene.wgsl`): `height > 0` raises, `height < 0`
carves, and shapes nest (a carved field inside a raised card). The bevel uses a
quintic smootherstep so the edge is a rounded curve, not a facet. Set
`tintAmount > 0` if you want components to tint the material (it's what makes
inset fields read darker); emissive shapes (lights, a glowing button) deposit
coloured radiance into the cascades, and components partially **occlude** light
(`opacity`, default ~0.3) so those emitters cast real shadows.

## Component API

Wrap your UI in `<GICanvas>` and use the kit components (`src/components`), or
register any DOM element with the `useGIShape` hook:

```tsx
import { GICanvas } from "./gi/GIContext";
import { Surface, GIButton, GIToggle, GIField, GILight } from "./components";

<GICanvas params={params}>
  <Surface radius={16}>            {/* raised panel */}
    <GIField placeholder="Search…" />  {/* carved inset */}
    <GIButton>Save</GIButton>      {/* presses in when held */}
    <GIToggle />
  </Surface>
  <Surface radius={14} carved />   {/* same shape, pressed into the surface */}
  <GILight color={[0.55, 0.7, 1.0]} intensity={0.8} initial={{ x: 560, y: 250 }} />
</GICanvas>
```

`Surface` takes `carved` (or negative `height`) to press in instead of raise,
plus per-component `bevel` (lip width) and `rolloff` (edge curve: `0` soft S →
`1` rounded shoulder). `GIButton` carves in while held; `GIField` is a carved
well; `GIToggle` is a carved track with a raised knob; `GISlider` is a carved
track with a draggable raised knob; `GILight` is a draggable accent emitter.

`useGIShape({ albedo, emission, displayScale, opacity, height, bevel, rolloff, cornerRadius, kind, live })`
returns a ref; attach it to a DOM node and it measures that node's box (relative
to the canvas) and registers a matching SDF shape, re-measuring on layout/material
changes. Pass `live` for elements that move every frame (dragged lights, toggles).

## Tuning

The leva panel (top-right in the demo) drives every GI parameter live — see
`GIParams` / `DEFAULT_PARAMS` in `src/gi/types.ts`:

- **Render**: `renderScale`, `maxResolution` (GI resolution cap),
  `adaptiveQuality` (auto-lower res under load, restore when idle), `d0`
  (cascade-0 probe spacing), `baseTile` (4 vs 16 base directions),
  `cascadeCount`, `intervalLen0`, `stepLen` (raymarch step).
- **Form**: `ambient` (light floor), `keyIntensity` (relief strength), `keyColor`,
  `keyDir` (key-light direction), `heightScale` (bevel pronouncement), `rolloff`
  (global edge curve), `edgeBias` (0 = soft feather → 1 = hard termination at the
  silhouette), `normalStrength`, `surfaceTexture`/`textureScale` (micro-normal
  noise that gives the lighting matte texture).
- **Accent**: `giStrength` (bounce brightness), `giDirectional` (how strongly the
  bounce favours emitter-facing bevels), `occlusion` (0 = local light spreads
  across surfaces, 1 = full GI shadowing), `componentGlow` (master on UI
  components' emission — not the lights), `emissiveDisplay` (how bright an
  emitter's own surface glows, separate from its bounce), `giSmooth` (radiance
  blur radius), `giBackground` (GI on the backplate, 0 = none), `skyStrength`,
  `exposure`, `tintAmount`, `grain`, `skyColor`, `material`.
- **Lights**: `lightsVisible` (hide the orbs while they still light the scene)
  plus per-light `on` / `color` / `intensity` for three draggable accent emitters.
- **Depth**: `shadowStrength`/`shadowLength`/`shadowHeight`/`shadowSoftness`
  (cast shadows from the key light), `fillIntensity`/`fillColor`/`fillDir` (soft
  counter-light), `aoStrength`/`aoRadius` (contact shadows).
- **Debug**: view `Final` / `Albedo` / `Normal` / `Emissive` / `Irradiance`.

The panel state persists to `localStorage` (so it survives reloads), and the
**preset bar** (top-left) saves/loads/deletes named presets and resets to
defaults. `tintAmount` controls how much per-component albedo shows through the
one material — it's what lets inset elements (fields, tracks) read darker.

## Known limitations / next steps

- Contact shadows come from a screen-space height-field AO (the `Depth` folder),
  not from the cascades. Setting a shape's `opacity > 0` still makes it a true
  ray occluder for the GI, with some self-shadowing caveats for large filled
  shapes.
- Film grain is static (no time uniform) so on-demand rendering stays idle when
  nothing changes; it won't shimmer between frames.
- Cascade merge clamps probe sampling to avoid sub-image bleed; very small top
  cascades lose a half-probe at the edges.
- No temporal accumulation yet; everything is recomputed each frame.

## License & support

giui is source-available under the [PolyForm Small Business License 1.0.0](./LICENSE.md):
free to use, modify, and distribute for individuals and companies with fewer than
100 people and under $1M revenue. Larger companies need a commercial license —
contact the author.

Required Notice: Copyright Dave Hale (https://github.com/phuziun/giui)

If giui is useful to you, consider [donating](https://davehale.net/donate). ♥
