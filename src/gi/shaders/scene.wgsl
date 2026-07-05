// Scene / G-buffer pass.
//
// Evaluates every registered SDF shape per-pixel and writes three targets:
//   sceneTex  (rgba16f) : rgb = emitted radiance, a = light opacity (occlusion)
//   albedoTex (rgba16f) : rgb = surface albedo,   a = coverage (anti-aliased)
//   normalTex (rgba16f) : xyz = surface normal (2.5D bevel), a = height
//
// sceneTex is what the radiance-cascade raymarch reads. albedo + normal are
// consumed by the composite pass to shade surfaces with the resolved radiance.

struct Shape {
  geom : vec4<f32>,     // center.xy, half.xy
  params : vec4<f32>,   // cornerRadius, kind (0=roundRect, 1=circle), height, bevel
  albedo : vec4<f32>,   // rgb, lightOpacity
  emission : vec4<f32>, // rgb, rolloff
  extra : vec4<f32>,    // displayScale, tint, bodyAlpha, heightScale (<0 = global)
};

struct Globals {
  resolution : vec2<f32>,
  invResolution : vec2<f32>,
  shapeCount : f32,
  edgeAA : f32,         // edge anti-alias width in px
  heightScale : f32,    // larger => flatter bevels
  normalEps : f32,      // finite-difference step (px) for the normal
  rolloff : f32,        // bevel curve shape: 0 = soft S, 1 = rounded shoulder
  edgeBias : f32,       // 0 = bevel straddles edge, 1 = fully inside (hard termination)
  band : vec2<f32>,     // [y0,y1) render-px rows to (re)write; other rows are preserved
  scrollY : f32,        // content offset (render px): shapes live in content coords,
                        // the texture shows the viewport slice starting here
  _pad : f32,
  // "Screen": a rect that samples screenTex as a light source — a display panel
  // whose picture both shows AND pours real light into the scene. Rect is in
  // content render px (x0,y0,x1,y1); x1 <= x0 disables it.
  screen : vec4<f32>,
  screenParams : vec4<f32>, // emit, display, topFade, topFadeH
};

@group(0) @binding(0) var<uniform> G : Globals;
// Shape access: TEXTURE variant between the markers (the PowerVR workaround —
// that driver reads compute storage buffers as zeros); shapeSource.ts swaps in
// the fast storage-buffer variant on healthy adapters at pipeline build time.
// SHAPES_VIA_TEXTURE_BEGIN
@group(0) @binding(1) var shapeTex : texture_2d<f32>;

fn getShape(i : u32) -> Shape {
  let y = i32(i);
  var s : Shape;
  s.geom = textureLoad(shapeTex, vec2<i32>(0, y), 0);
  s.params = textureLoad(shapeTex, vec2<i32>(1, y), 0);
  s.albedo = textureLoad(shapeTex, vec2<i32>(2, y), 0);
  s.emission = textureLoad(shapeTex, vec2<i32>(3, y), 0);
  s.extra = textureLoad(shapeTex, vec2<i32>(4, y), 0);
  return s;
}
fn shapeTotal() -> u32 { return textureDimensions(shapeTex).y; }
// SHAPES_VIA_TEXTURE_END
@group(0) @binding(2) var sceneTex  : texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var albedoTex : texture_storage_2d<rgba16float, write>;
@group(0) @binding(4) var normalTex : texture_storage_2d<rgba16float, write>;
@group(0) @binding(5) var dispTex   : texture_storage_2d<rgba16float, write>;
@group(0) @binding(6) var screenSamp : sampler;
@group(0) @binding(7) var screenTex : texture_2d<f32>;

fn sdRoundBox(p : vec2<f32>, b : vec2<f32>, r : f32) -> f32 {
  let rr = min(r, min(b.x, b.y));
  let q = abs(p) - b + vec2<f32>(rr);
  return min(max(q.x, q.y), 0.0) + length(max(q, vec2<f32>(0.0))) - rr;
}

// Bevel height profile across the edge band, t in [0,1] from outer edge to the
// interior plateau. Blends a quintic smootherstep (a soft symmetric S) toward a
// rounded shoulder (ease-out: a quick rise that rolls over near the top, giving
// a bright rim at the base of the lip that falls off into the flat) so the edge
// reads as a curved, non-linear rolloff rather than a straight ramp.
fn edgeProfile(t : f32, k : f32) -> f32 {
  let s = t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
  let u = 1.0 - t;
  let shoulder = 1.0 - u * u; // quadratic ease-out: steep rim rolling to a flat top
  return mix(s, shoulder, clamp(k, 0.0, 1.0));
}

fn shapeSD(s : Shape, p : vec2<f32>) -> f32 {
  let local = p - s.geom.xy;
  if (s.params.y > 0.5) {
    // circle: half.x is the radius
    return length(local) - s.geom.z;
  }
  return sdRoundBox(local, s.geom.zw, s.params.x);
}

// A shape only affects a pixel within its silhouette plus a margin covering the
// bevel band and the edge anti-alias. Pixels outside this padded AABB can skip
// the shape entirely — a big win when many shapes are spread across the page
// (the per-pixel loops are the dominant cost). Superset test, so pixel-identical.
fn outsideShape(s : Shape, p : vec2<f32>) -> bool {
  let half = select(s.geom.zw, vec2<f32>(s.geom.z), s.params.y > 0.5);
  let ext = half + vec2<f32>(s.params.w + G.edgeAA + 1.5); // + bevel + AA
  let dd = abs(p - s.geom.xy) - ext;
  return max(dd.x, dd.y) > 0.0;
}

// Signed height field. Each shape adds its profile, ramped across its bevel
// band: positive height raises out of the surface, negative carves into it.
// Additive composition lets shapes nest -- a raised child sits on its parent's
// plateau, a carved well dips below it.
//
// `useRelief` scales each shape's contribution by its per-shape heightScale
// (extra.w, <0 = global default). This "relief" field drives the surface NORMAL
// (with a fixed normal-z), so a big panel can get a soft bevel (low heightScale)
// while a small control stays crisp (high heightScale) -- baking the scale into
// the field is equivalent to the old per-pixel `1/heightScale` normal-z, but now
// per-shape. The raw field (useRelief=false) still drives AO / cast shadows /
// stored height, so physical depth is unchanged by the relief scaling.
fn sceneHeightW(p : vec2<f32>, useRelief : bool) -> f32 {
  var h = 0.0;
  let n = shapeTotal();
  for (var i = 0u; i < n; i = i + 1u) {
    let s = getShape(i);
    if (outsideShape(s, p)) { continue; }
    let d = shapeSD(s, p);
    let bevel = max(s.params.w, 0.5);
    // Position the lip relative to the silhouette: edgeBias 0 straddles the edge
    // (soft feather both sides), edgeBias 1 keeps it just inside so height drops
    // to zero right at the outline -- a harder, more defined termination.
    let outer = bevel * 0.5 * (1.0 - G.edgeBias);
    let t = clamp((-d + outer) / bevel, 0.0, 1.0);
    // Per-shape rolloff (emission.w); negative means "use the global default".
    let rk = select(G.rolloff, s.emission.w, s.emission.w >= 0.0);
    let ramp = edgeProfile(t, rk);
    var contrib = s.params.z * ramp * s.extra.z; // bodyAlpha: hidden lights are flat
    if (useRelief) {
      let hs = select(G.heightScale, s.extra.w, s.extra.w >= 0.0);
      contrib = contrib * hs;
    }
    h = h + contrib;
  }
  return h;
}

fn sceneHeight(p : vec2<f32>) -> f32 {
  return sceneHeightW(p, false);
}

struct Material {
  albedo : vec3<f32>,
  coverage : f32,
  emission : vec3<f32>,    // radiance injected into the cascades (the bounce)
  opacity : f32,
  display : vec3<f32>,     // emissive shown on the shape's own surface
  tint : f32,              // per-shape tint boost (0 = global, 1 = full albedo)
};

fn sceneMaterial(p : vec2<f32>) -> Material {
  var m : Material;
  m.albedo = vec3<f32>(0.0);
  m.coverage = 0.0;
  m.emission = vec3<f32>(0.0);
  m.opacity = 0.0;
  m.display = vec3<f32>(0.0);
  m.tint = 0.0;

  let n = shapeTotal();
  for (var i = 0u; i < n; i = i + 1u) {
    let s = getShape(i);
    if (outsideShape(s, p)) { continue; }
    let d = shapeSD(s, p);
    let cov = 1.0 - smoothstep(0.0, G.edgeAA, d); // 1 inside, fades across edge
    // Matte shapes (tint packed < -0.5) keep contributing past their silhouette:
    // they write a feathered suppression field over their bevel-wide apron so
    // the composite's GI mask fades smoothly instead of cutting at the edge.
    let matte = s.extra.y < -0.5;
    if (cov <= 0.0 && !matte) { continue; }

    // bodyAlpha gates the *visible* body: a `bodyAlpha = 0` shape (a hidden
    // light) contributes no albedo/coverage/display but still emits & occludes,
    // so it lights the scene without drawing an orb.
    let bcov = cov * s.extra.z;

    // Albedo / coverage: painter's order, later shapes composite over earlier.
    m.albedo = mix(m.albedo, s.albedo.rgb, bcov);
    m.coverage = max(m.coverage, bcov);

    // Emission accumulates additively; opacity (occlusion) takes the max. The
    // surface display emissive is the same emission scaled per-shape, so an
    // emitter can pour light into the scene while staying visually subdued.
    m.emission = m.emission + s.emission.rgb * cov;
    m.display = m.display + s.emission.rgb * bcov * s.extra.x;
    if (matte) {
      // Matte GI suppression as a smooth FIELD, not a binary flag. Two zones,
      // both derived from the shape's own signed distance:
      //   hard — 1 over the face and the whole bevel lip (exact outer height
      //          extent, so no bright GI rim survives on the lip), with a 2px
      //          exit ramp. The composite kills component-level GI by it.
      //   soft — feathers from 1 at the lip to 0 across a bevel-wide apron.
      //          The composite ramps the *background* GI back in by it, which
      //          is what turns the old hard glow cutoff into a soft penumbra.
      // Packed into the tint channel as -(hard + soft) - 2*tint*bcov: one
      // float carries hard, soft, and the shape's real tint (decoded in
      // composite.wgsl; non-matte tint stays >= 0 and decodes to zeros).
      // The apron fits the AABB pad (bevel + edgeAA + 1.5) exactly.
      let lip = s.params.w * 0.5 * (1.0 - G.edgeBias) + G.edgeAA;
      // 5px exit: the hard→soft handoff is where the escaping-light rim
      // ignites (composite passes 50% background GI in the soft zone), so a
      // slightly wider ramp keeps that ignition gentle.
      let hard = 1.0 - smoothstep(lip, lip + 5.0, d);
      // Penumbra width ~0.45 bevel (min 8px): wide enough to read soft, narrow
      // enough that the halo still visibly hugs the bar. Fits the AABB pad.
      let soft = 1.0 - smoothstep(lip, lip + max(s.params.w * 0.45, 8.0), d);
      let v = -(hard + soft) - 2.0 * (s.extra.y + 2.0) * bcov;
      // min, not painter-mix: matte fields combine to the MOST suppressive,
      // order-independent — a small matte child's fading apron must never
      // erode its matte parent's full suppression underneath (that read as a
      // bright ring around the nav's segmented switcher). Non-matte children
      // still reset the field via their own bcov mix below.
      m.tint = min(m.tint, v);
    } else {
      m.tint = mix(m.tint, s.extra.y, bcov); // painter's order, like albedo
    }
    m.opacity = max(m.opacity, s.albedo.a * cov);
  }

  // The screen: inside its rect, the texture is added as display (the visible
  // picture) and as emission (the light it casts into the cascades).
  if (G.screen.z > G.screen.x &&
      p.x >= G.screen.x && p.y >= G.screen.y && p.x < G.screen.z && p.y < G.screen.w) {
    let uv = vec2<f32>(
      (p.x - G.screen.x) / (G.screen.z - G.screen.x),
      (p.y - G.screen.y) / (G.screen.w - G.screen.y)
    );
    let enc = textureSampleLevel(screenTex, screenSamp, uv, 0.0).rgb;
    let pic = enc * enc; // canvas/video pixels are sRGB-encoded; ≈linearize —
                         // treating them as linear lifts every dark tone into
                         // a uniform grey wash across the rect
    // Emission-only top fade (screenParams.z = cut at the top edge, .w = ramp
    // height in uv): the light the rect pours into the cascades thins toward
    // its top, so chrome above the hero isn't flooded. The visible picture
    // (display) is untouched.
    let fade = mix(1.0 - G.screenParams.z, 1.0,
                   smoothstep(0.0, max(G.screenParams.w, 1e-3), uv.y));
    m.emission = m.emission + pic * G.screenParams.x * fade;
    m.display = m.display + pic * G.screenParams.y;
  }
  return m;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let dim = vec2<u32>(textureDimensions(sceneTex));
  if (gid.x >= dim.x || gid.y >= dim.y) { return; }
  // Only (re)compute the visible band; other rows keep their previous G-buffer
  // (static off-screen content). The band is the whole texture on a full render.
  if (f32(gid.y) < G.band.x || f32(gid.y) >= G.band.y) { return; }

  // Texture row -> content coords (viewport-canvas mode scrolls via scrollY;
  // page-canvas mode has scrollY = 0 and texture rows == content rows).
  let p = vec2<f32>(f32(gid.x) + 0.5, f32(gid.y) + 0.5 + G.scrollY);
  let m = sceneMaterial(p);

  // Surface normal from the RELIEF height field (per-shape heightScale baked in)
  // via central differences; normal-z is fixed at 1 since the scale now lives in
  // the field. The stored height uses the RAW field (physical depth for AO/shadow).
  let e = G.normalEps;
  let hL = sceneHeightW(p - vec2<f32>(e, 0.0), true);
  let hR = sceneHeightW(p + vec2<f32>(e, 0.0), true);
  let hD = sceneHeightW(p - vec2<f32>(0.0, e), true);
  let hU = sceneHeightW(p + vec2<f32>(0.0, e), true);
  let dHdx = (hR - hL) / (2.0 * e);
  let dHdy = (hU - hD) / (2.0 * e);
  let normal = normalize(vec3<f32>(-dHdx, -dHdy, 1.0));
  let height = sceneHeight(p);

  let coord = vec2<i32>(i32(gid.x), i32(gid.y));
  textureStore(sceneTex,  coord, vec4<f32>(m.emission, m.opacity));
  textureStore(albedoTex, coord, vec4<f32>(m.albedo, m.coverage));
  textureStore(normalTex, coord, vec4<f32>(normal, height));
  textureStore(dispTex,   coord, vec4<f32>(m.display, m.tint));
}
