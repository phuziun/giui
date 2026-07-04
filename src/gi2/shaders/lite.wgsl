// ---------------------------------------------------------------------------
// GI-Lite: an experimental, resolution-independent take on the giui look.
//
// The cascade engine computes light transport at (capped) pixel resolution:
// G-buffer -> N cascade dispatches -> per-pixel gather. Cost scales with
// display pixels and it needs 4 full-res rgba16f targets. GI-Lite restructures
// where the cost lives, exploiting two observations about the *look*:
//   1. The neumorphic relief (bevels, AO, cast shadows) is ANALYTIC — the
//      shapes are SDFs, so normals/shadows have closed forms. No G-buffer.
//   2. The GI bounce is intentionally very smooth (giSmooth blur, soft
//      falloffs) — it's massively over-sampled at pixel resolution. A sparse
//      probe grid storing 2D CIRCULAR HARMONICS (L0 + L1: 3 coefficients,
//      the 2D analog of spherical harmonics) reconstructs it faithfully.
//
// Passes (cost model in parens):
//   emit   CS — tiny emission+occlusion raster, ~css/6 res     (css area / 36)
//   probes CS — CH probe grid, rays marched through emitLo     (css area / spacing²)
//   tiles  CS — per-32px-tile shape lists, painter order kept  (tiles × shapes)
//   present FS — ONE pass at device res: analytic SDF shading,
//                3 bilinear CH taps, tonemap+grain inline      (pixels × local density)
//
// Only `present` scales with device resolution, and its per-pixel work scales
// with LOCAL shape density (tile lists), not page complexity. The probe pass —
// the light transport — is resolution independent: a 3x-DPR phone pays the
// same as a 1x laptop for the same css viewport.
// ---------------------------------------------------------------------------

const TAU = 6.28318530718;

struct Shape {
  geom : vec4<f32>,     // center.xy, half.xy (circle: half.x = radius)
  params : vec4<f32>,   // cornerRadius, kind (0 rect / 1 circle), height, bevel
  albedo : vec4<f32>,   // rgb, opacity (light occlusion)
  emission : vec4<f32>, // rgb, rolloff (<0 = global)
  extra : vec4<f32>,    // displayScale, tint, bodyAlpha, heightScale (<0 = global)
};

struct P {
  cssSize : vec2<f32>,   // board size in css px (all shading math is css-space)
  loSize : vec2<f32>,    // emitLo texel dims
  probeGrid : vec2<f32>, // probe counts
  outSize : vec2<f32>,   // canvas device px
  dpr : f32, shapeCount : f32, probeSpacing : f32, rayCount : f32,
  raySteps : f32, rayMax : f32, occlusion : f32, edgeAA : f32,

  ambient : f32, keyIntensity : f32, normalStrength : f32, heightScale : f32,
  keyDir : vec3<f32>, rolloff : f32,
  keyColor : vec3<f32>, edgeBias : f32,
  fillDir : vec3<f32>, fillIntensity : f32,
  fillColor : vec3<f32>, tintAmount : f32,
  material : vec3<f32>, emissiveDisplay : f32,

  giStrength : f32, giDirectional : f32, giBackground : f32, giProbeLift : f32,
  aoStrength : f32, aoRadius : f32, shadowStrength : f32, shadowScale : f32,
  shadowSoftness : f32, exposure : f32, grain : f32, encodeSrgb : f32,
  surfaceTexture : f32, textureScale : f32, tilesX : f32, tileSize : f32,

  // Full-page mode: the canvas is a viewport window onto the content; all
  // shape math runs in CONTENT css coords (shapes never re-measure on scroll,
  // noise/probes stay glued to content).
  origin : vec2<f32>,      // content coords of the window's top-left
  probeOrigin : vec2<f32>, // content coords of probe (0,0) — spacing-quantized
  // SCREEN light source (a canvas/video projected as light), content coords.
  screen : vec4<f32>,       // x0, y0, x1, y1 (x1 <= x0 = none)
  screenParams : vec4<f32>, // emit, display, topFade, topFadeH
};

@group(0) @binding(0) var<uniform> U : P;
@group(0) @binding(1) var<storage, read> shapes : array<Shape>;
@group(0) @binding(2) var samp : sampler;
@group(0) @binding(3) var screenTex : texture_2d<f32>;

// Pass-specific bindings live in group(1) so one layout serves several passes.
@group(1) @binding(0) var emitLoW : texture_storage_2d<rgba16float, write>;

@group(2) @binding(0) var emitLo : texture_2d<f32>;
@group(2) @binding(1) var ch0W : texture_storage_2d<rgba16float, write>;
@group(2) @binding(2) var ch1W : texture_storage_2d<rgba16float, write>;
@group(2) @binding(3) var ch2W : texture_storage_2d<rgba16float, write>;

@group(3) @binding(0) var<storage, read_write> tiles : array<u32>;

// --------------------------------------------------------------------------
// Shared SDF helpers (css units everywhere).

fn sdRoundBox(p : vec2<f32>, b : vec2<f32>, r : f32) -> f32 {
  let rr = min(r, min(b.x, b.y));
  let q = abs(p) - b + vec2<f32>(rr);
  return min(max(q.x, q.y), 0.0) + length(max(q, vec2<f32>(0.0))) - rr;
}

fn shapeSD(s : Shape, p : vec2<f32>) -> f32 {
  let local = p - s.geom.xy;
  if (s.params.y > 0.5) { return length(local) - s.geom.z; }
  return sdRoundBox(local, s.geom.zw, s.params.x);
}

// Analytic SDF gradient — this is what replaces the G-buffer's finite-diff
// normals, and why bevels stay crisp at ANY device resolution.
fn shapeGrad(s : Shape, p : vec2<f32>) -> vec2<f32> {
  let local = p - s.geom.xy;
  if (s.params.y > 0.5) {
    let l = length(local);
    if (l < 1e-4) { return vec2<f32>(0.0, 1.0); }
    return local / l;
  }
  let rr = min(s.params.x, min(s.geom.z, s.geom.w));
  let q = abs(local) - s.geom.zw + vec2<f32>(rr);
  let sgn = sign(local + vec2<f32>(1e-6));
  let e = max(q, vec2<f32>(0.0));
  let le = length(e);
  if (le > 1e-5) { return sgn * e / le; }       // outside / corner region
  // Interior: blend between the two walls near the diagonal instead of a hard
  // switch — the analytic version of the finite-diff smoothing the raster
  // engine got for free (a hard select draws mitre lines across corners).
  let w = clamp((q.x - q.y) / 6.0 + 0.5, 0.0, 1.0);
  let g = mix(vec2<f32>(0.0, sgn.y), vec2<f32>(sgn.x, 0.0), w);
  let gl = length(g);
  return g / max(gl, 1e-4);
}

// Bevel height profile + derivative (quintic smootherstep -> rounded shoulder).
fn edgeProfile(t : f32, k : f32) -> f32 {
  let s = t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
  let u = 1.0 - t;
  return mix(s, 1.0 - u * u, clamp(k, 0.0, 1.0));
}
fn edgeProfileD(t : f32, k : f32) -> f32 {
  let sd = 30.0 * t * t * (t - 1.0) * (t - 1.0);
  return mix(sd, 2.0 * (1.0 - t), clamp(k, 0.0, 1.0));
}

fn outsideShape(s : Shape, p : vec2<f32>, pad : f32) -> bool {
  let half = select(s.geom.zw, vec2<f32>(s.geom.z), s.params.y > 0.5);
  let ext = half + vec2<f32>(s.params.w + pad);
  let dd = abs(p - s.geom.xy) - ext;
  return max(dd.x, dd.y) > 0.0;
}

fn hash12(p : vec2<f32>) -> f32 {
  var p3 = fract(vec3<f32>(p.x, p.y, p.x) * 0.1031);
  p3 += dot(p3, vec3<f32>(p3.y, p3.z, p3.x) + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
fn ign(p : vec2<f32>) -> f32 {
  return fract(52.9829189 * fract(dot(p, vec2<f32>(0.06711056, 0.00583715))));
}
fn vnoise(p : vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = hash12(i);
  let b = hash12(i + vec2<f32>(1.0, 0.0));
  let c = hash12(i + vec2<f32>(0.0, 1.0));
  let d = hash12(i + vec2<f32>(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// --------------------------------------------------------------------------
// Pass 1: emission + occlusion raster at ~css/6. The ONLY rasterized state —
// everything else is analytic or probe-space.

@compute @workgroup_size(8, 8)
fn emitCS(@builtin(global_invocation_id) gid : vec3<u32>) {
  if (f32(gid.x) >= U.loSize.x || f32(gid.y) >= U.loSize.y) { return; }
  let p = (vec2<f32>(gid.xy) + vec2<f32>(0.5)) * (U.cssSize / U.loSize) + U.origin;
  var emis = vec3<f32>(0.0);
  var op = 0.0; // raw opacity (max over covering shapes)
  let texel = U.cssSize.x / U.loSize.x;
  let n = u32(U.shapeCount);
  for (var i = 0u; i < n; i = i + 1u) {
    let s = shapes[i];
    if (outsideShape(s, p, texel)) { continue; }
    let d = shapeSD(s, p);
    let cov = 1.0 - smoothstep(0.0, texel, d);
    if (cov <= 0.0) { continue; }
    emis += s.emission.rgb * cov;
    op = max(op, s.albedo.a * cov);
  }
  // SCREEN light: inside its rect the (sRGB-encoded) picture pours into the
  // field as emission, thinned toward the top edge by topFade.
  if (U.screen.z > U.screen.x &&
      p.x >= U.screen.x && p.y >= U.screen.y && p.x < U.screen.z && p.y < U.screen.w) {
    let uv = (p - U.screen.xy) / (U.screen.zw - U.screen.xy);
    let enc = textureSampleLevel(screenTex, samp, uv, 0.0).rgb;
    let pic = enc * enc; // ~ sRGB -> linear (same trick as the cascade engine)
    let fade = mix(1.0 - U.screenParams.z, 1.0,
                   smoothstep(0.0, max(U.screenParams.w, 1e-3), uv.y));
    emis += pic * U.screenParams.x * fade;
  }
  // CRITICAL calibration parity with the cascade march (cascade.wgsl:60-63):
  // emission is PREMULTIPLIED by the local opacity, and emitter texels keep
  // full occlusion — so a ray inside an emitter accumulates the geometric
  // series op·(1-op)^k, which sums to ~1x emission REGARDLESS of emitter size.
  // Without this, a large emitter (the hero screen) floods the field ~9x.
  let isEmit = max(max(emis.r, emis.g), emis.b) > 0.0008;
  let occ = op * select(U.occlusion, 1.0, isEmit);
  textureStore(emitLoW, vec2<i32>(gid.xy), vec4<f32>(emis * op, occ));
}

// --------------------------------------------------------------------------
// Pass 2: circular-harmonics probes. Each probe marches `rayCount` rays
// through emitLo (front-to-back transmittance, like a cascade interval) and
// projects the ring of radiances onto L0+L1:
//   a0 = mean(L)        — isotropic irradiance
//   a1 = 2·mean(L·cosθ), b1 = 2·mean(L·sinθ) — the dominant direction
// Reconstruction at a surface normal matches the cascade gather's flat+dir
// split: flat = π·a0, dir = a0 + (π/4)(a1·nx + b1·ny).

@compute @workgroup_size(8, 8)
fn probeCS(@builtin(global_invocation_id) gid : vec3<u32>) {
  if (f32(gid.x) >= U.probeGrid.x || f32(gid.y) >= U.probeGrid.y) { return; }
  // Content-anchored: probe (0,0) sits at probeOrigin (spacing-quantized), so
  // the grid never swims against content while scrolling.
  let center = U.probeOrigin + (vec2<f32>(gid.xy) + vec2<f32>(0.5)) * U.probeSpacing;
  let rays = u32(U.rayCount);
  let steps = u32(U.raySteps);
  // Golden-ish per-probe rotation decorrelates neighbouring probes; the
  // bilinear reconstruction then reads as smooth noise, not banding.
  let rot = ign(vec2<f32>(gid.xy)) * TAU;
  var a0 = vec3<f32>(0.0);
  var a1 = vec3<f32>(0.0);
  var b1 = vec3<f32>(0.0);
  for (var r = 0u; r < rays; r = r + 1u) {
    let th = rot + (f32(r) + 0.5) / U.rayCount * TAU;
    let dir = vec2<f32>(cos(th), sin(th));
    let dt = U.rayMax / f32(steps);
    var rad = vec3<f32>(0.0);
    var T = 1.0;
    for (var i = 0u; i < steps; i = i + 1u) {
      let t = (f32(i) + 0.5) * dt;
      let q = center + dir * t;
      let qw = q - U.origin; // content -> window coords for the raster lookup
      if (qw.x < 0.0 || qw.y < 0.0 || qw.x >= U.cssSize.x || qw.y >= U.cssSize.y) { break; }
      let sm = textureSampleLevel(emitLo, samp, qw / U.cssSize, 0.0);
      rad += sm.rgb * T;
      T *= 1.0 - clamp(sm.a, 0.0, 1.0);
      if (T < 0.01) { break; }
    }
    a0 += rad;
    a1 += rad * (2.0 * cos(th));
    b1 += rad * (2.0 * sin(th));
  }
  let inv = 1.0 / U.rayCount;
  let c = vec2<i32>(gid.xy);
  textureStore(ch0W, c, vec4<f32>(a0 * inv, 1.0));
  textureStore(ch1W, c, vec4<f32>(a1 * inv, 1.0));
  textureStore(ch2W, c, vec4<f32>(b1 * inv, 1.0));
}

// --------------------------------------------------------------------------
// Pass 3: tile binning. One thread per TILE loops all shapes (deterministic —
// painter's order is preserved in the list, no atomics, no sort). Dense
// layouts stay cheap in `present` because each pixel only shades its tile's
// local shapes.

const TILE_CAP = 23u; // + 1 count slot = 24 u32 per tile

@compute @workgroup_size(8, 8)
fn tileCS(@builtin(global_invocation_id) gid : vec3<u32>) {
  let tilesX = u32(U.tilesX);
  let tilesY = u32(ceil(U.outSize.y / U.tileSize));
  if (gid.x >= tilesX || gid.y >= tilesY) { return; }
  let tcssMin = vec2<f32>(gid.xy) * U.tileSize / U.dpr + U.origin;
  let tcssMax = (vec2<f32>(gid.xy) + vec2<f32>(1.0)) * U.tileSize / U.dpr + U.origin;
  let base = (gid.y * tilesX + gid.x) * (TILE_CAP + 1u);
  var count = 0u;
  let n = u32(U.shapeCount);
  // Pad by bevel + AA + the longest shadow this shape can throw, so shading
  // terms that reach past the silhouette still find their shape in the list.
  for (var i = 0u; i < n; i = i + 1u) {
    if (count >= TILE_CAP) { break; }
    let s = shapes[i];
    let half = select(s.geom.zw, vec2<f32>(s.geom.z), s.params.y > 0.5);
    let reach = s.params.w + U.edgeAA + U.aoRadius + abs(s.params.z) * U.shadowScale + 4.0;
    let mn = s.geom.xy - half - vec2<f32>(reach);
    let mx = s.geom.xy + half + vec2<f32>(reach);
    if (mx.x < tcssMin.x || mx.y < tcssMin.y || mn.x > tcssMax.x || mn.y > tcssMax.y) { continue; }
    tiles[base + 1u + count] = i;
    count = count + 1u;
  }
  tiles[base] = count;
}

// --------------------------------------------------------------------------
// Pass 4: present — the ONE per-device-pixel pass. Analytic shading + CH
// gather + finish. No intermediate full-res textures anywhere.

@group(1) @binding(1) var ch0 : texture_2d<f32>;
@group(1) @binding(2) var ch1 : texture_2d<f32>;
@group(1) @binding(3) var ch2 : texture_2d<f32>;
@group(1) @binding(4) var<storage, read> tilesR : array<u32>;

struct VSOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) uv : vec2<f32>,
};

@vertex
fn vs(@builtin(vertex_index) vi : u32) -> VSOut {
  var p = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0));
  var out : VSOut;
  out.pos = vec4<f32>(p[vi], 0.0, 1.0);
  out.uv = vec2<f32>((p[vi].x + 1.0) * 0.5, (1.0 - p[vi].y) * 0.5);
  return out;
}

fn acesFilm(x : vec3<f32>) -> vec3<f32> {
  let a = 2.51; let b = 0.03; let c = 2.43; let d = 0.59; let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3<f32>(0.0), vec3<f32>(1.0));
}
fn toSrgb(c : vec3<f32>) -> vec3<f32> {
  let lo = c * 12.92;
  let hi = 1.055 * pow(c, vec3<f32>(1.0 / 2.4)) - 0.055;
  return select(hi, lo, c <= vec3<f32>(0.0031308));
}

fn sampleCH(tex : texture_2d<f32>, probe : vec2<f32>) -> vec3<f32> {
  let pc = clamp(probe, vec2<f32>(0.0), U.probeGrid - vec2<f32>(1.0));
  return textureSampleLevel(tex, samp, (pc + vec2<f32>(0.5)) / U.probeGrid, 0.0).rgb;
}

@fragment
fn fs(in : VSOut) -> @location(0) vec4<f32> {
  let devPx = in.pos.xy;
  let p = devPx / U.dpr + U.origin; // CONTENT css coords — scroll-stable noise/relief

  // Tile list for this pixel (painter-ordered shape indices).
  let tx = u32(devPx.x / U.tileSize);
  let ty = u32(devPx.y / U.tileSize);
  let base = (ty * u32(U.tilesX) + tx) * (TILE_CAP + 1u);
  let count = min(tilesR[base], TILE_CAP);

  var albedo = vec3<f32>(0.0);
  var cover = 0.0;
  var tint = 0.0;
  var disp = vec3<f32>(0.0);
  var matteHard = 0.0; // face + bevel lip of any matte shape (kills component GI)
  var matteSoft = 0.0; // feathered apron (reveals/curbs background GI smoothly)
  var gradH = vec2<f32>(0.0); // relief gradient (per-shape heightScale baked in)
  var hRaw = 0.0;             // physical height (AO / shadows)
  var ao = 0.0;
  var shOcc = 0.0;            // cast-shadow occlusion (max over casters)

  let keyLen = length(U.keyDir.xy);
  let keyPlanar = select(vec2<f32>(0.0), U.keyDir.xy / max(keyLen, 1e-4), keyLen > 1e-4);

  for (var k = 0u; k < count; k = k + 1u) {
    let s = shapes[tilesR[base + 1u + k]];
    let d = shapeSD(s, p);

    // Body coverage + painter albedo/tint (same semantics as the raster engine).
    // Matte packs (tint - 2); decode the real tint and build the smooth
    // suppression field straight from the SDF — the analytic engine needs no
    // texture-channel encoding for this.
    let isMatte = s.extra.y < -0.5;
    let realTintS = select(s.extra.y, s.extra.y + 2.0, isMatte);
    let cov = (1.0 - smoothstep(0.0, U.edgeAA, d)) * s.extra.z;
    if (cov > 0.0) {
      albedo = mix(albedo, s.albedo.rgb, cov);
      cover = max(cover, cov);
      tint = mix(tint, realTintS, cov);
      disp += s.emission.rgb * cov * s.extra.x;
    }
    if (isMatte) {
      let lipM = s.params.w * 0.5 * (1.0 - U.edgeBias) + U.edgeAA;
      matteHard = max(matteHard, 1.0 - smoothstep(lipM, lipM + 5.0, d));
      matteSoft = max(matteSoft, 1.0 - smoothstep(lipM, lipM + max(s.params.w * 0.45, 8.0), d));
    }

    // Relief: analytic bevel gradient (closed-form profile derivative × SDF
    // gradient) and the raw height for physical terms.
    let bevel = max(s.params.w, 0.5);
    let outer = bevel * 0.5 * (1.0 - U.edgeBias);
    let t = clamp((-d + outer) / bevel, 0.0, 1.0);
    let rk = select(U.rolloff, s.emission.w, s.emission.w >= 0.0);
    let hs = select(U.heightScale, s.extra.w, s.extra.w >= 0.0);
    let hBody = s.params.z * s.extra.z;
    if (t > 0.0) {
      hRaw += hBody * edgeProfile(t, rk);
      if (t < 1.0) {
        // dh/dp = h·hs·profile'(t)·dt/dd·dd/dp, dt/dd = -1/bevel
        gradH += shapeGrad(s, p) * (-hBody * hs * edgeProfileD(t, rk) / bevel);
      }
    }

    // Contact AO — the analytic version of the raster engine's 4-tap height
    // difference at aoRadius: how much HIGHER does this shape's own profile
    // get within aoRadius of here, in either direction along the SDF? Peaks
    // in crevices (the foot of a lip, a carved floor near its wall) and is
    // zero on plateaus and far outside — no picture-frame ring.
    if (hBody != 0.0) {
      let tIn = clamp((-(d - U.aoRadius) + outer) / bevel, 0.0, 1.0);
      let tOut = clamp((-(d + U.aoRadius) + outer) / bevel, 0.0, 1.0);
      let h0 = hBody * edgeProfile(t, rk);
      let hIn = hBody * edgeProfile(tIn, rk);
      let hOut = hBody * edgeProfile(tOut, rk);
      // 0.35 ~ the angular average the raster engine's 4 rotated taps take
      // (only ~a third of directions run up the gradient); the max alone
      // painted heavy rings around small chips.
      ao += max(max(hIn - h0, hOut - h0), 0.0) * 0.35;
    }

    // Cast shadow: ONE shifted SDF eval instead of a 10-step march. A raised
    // shape of height h darkens points whose light-ward offset lands inside
    // it; penumbra widens with the offset (far shadows read softer).
    if (hBody > 0.02 && keyLen > 1e-4 && U.shadowStrength > 0.0) {
      let off = hBody * U.shadowScale;
      let ds = shapeSD(s, p + keyPlanar * off);
      let pen = 6.0 + off * U.shadowSoftness;
      let sh = (1.0 - smoothstep(-pen * 0.4, pen, ds)) * clamp(hBody - hRaw + 0.35, 0.0, 1.0);
      shOcc = max(shOcc, sh);
    }
  }

  // SCREEN: the visible picture joins `disp` BEFORE the emitter mask, so the
  // screen suppresses its own re-lighting exactly like other emitters (and
  // display stays decoupled from the emitted light).
  if (U.screen.z > U.screen.x &&
      p.x >= U.screen.x && p.y >= U.screen.y && p.x < U.screen.z && p.y < U.screen.w) {
    let suv = (p - U.screen.xy) / (U.screen.zw - U.screen.xy);
    let enc = textureSampleLevel(screenTex, samp, suv, 0.0).rgb;
    disp += enc * enc * U.screenParams.y;
  }

  // One continuous material; tint lifts a component toward its own albedo.
  let effTint = mix(U.tintAmount, 1.0, clamp(tint, 0.0, 1.0));
  let matl = mix(U.material, albedo, cover * effTint);

  // Normal from the analytic relief gradient (+ value-noise micro-texture).
  // Height-field normal is (-dh/dx, -dh/dy, 1).
  var N = normalize(vec3<f32>(-gradH * U.normalStrength, 1.0));
  let ts = max(U.textureScale, 0.5);
  let nx = vnoise(p / ts) - 0.5;
  let ny = vnoise(p / ts + vec2<f32>(37.2, 11.7)) - 0.5;
  N = normalize(N + vec3<f32>(nx, ny, 0.0) * U.surfaceTexture);

  let ndl = dot(N, normalize(U.keyDir));
  let ndf = max(dot(N, normalize(U.fillDir)), 0.0);
  let ksh = 1.0 - clamp(shOcc * U.shadowStrength, 0.0, 1.0);
  let lit = max(
    vec3<f32>(U.ambient) + U.keyColor * (U.keyIntensity * ndl * ksh) + U.fillColor * (U.fillIntensity * ndf),
    vec3<f32>(0.0));
  let aoT = clamp(ao * U.aoStrength, 0.0, 1.0);

  // GI bounce from the CH probes. Two per-pixel-rotated taps (the cascade
  // engine's giSmooth trick): neighbouring probes disagree slightly about
  // occlusion, and averaging jittered taps turns that banding into noise the
  // eye reads as texture.
  let rot = ign(devPx) * TAU;
  let joff = vec2<f32>(cos(rot), sin(rot)) * (8.0 / U.probeSpacing);
  let probe = (p - U.probeOrigin) / U.probeSpacing - vec2<f32>(0.5);
  let a0 = (sampleCH(ch0, probe + joff) + sampleCH(ch0, probe - joff)) * 0.5;
  let a1 = (sampleCH(ch1, probe + joff) + sampleCH(ch1, probe - joff)) * 0.5;
  let b1 = (sampleCH(ch2, probe + joff) + sampleCH(ch2, probe - joff)) * 0.5;
  // In-plane normal for the directional GI — mirror the raster engine: the
  // stored normal is normalize(vec3(-grad, 1)), whose xy is SMALL for gentle
  // relief, then scaled by normalStrength. (Normalizing gradH alone made it
  // near-unit → the directional term blew out ~5x on every bevel.)
  let n2 = normalize(vec3<f32>(-gradH, 1.0)).xy * U.normalStrength;
  let flt = a0 * 3.14159265;
  // L1 reconstruction can go negative against the normal — clamp, or it
  // SUBTRACTS light and paints dark smudges at probe scale.
  let dir = max(a0 + (a1 * n2.x + b1 * n2.y) * 0.785398, vec3<f32>(0.0)); // π/4
  let hmask = smoothstep(0.0, 0.03, abs(hRaw));
  // Matte apron REVEALS background GI near the shape (up to 0.5 vs the global
  // cap) and the face/lip receive none — identical semantics to the raster
  // engine's motivated-backlight treatment.
  let bgGI = mix(U.giBackground, 0.5, matteSoft) * (1.0 - matteHard);
  let giMask = mix(bgGI, 1.0, max(cover, hmask) * (1.0 - matteHard));
  let dispLum = max(disp.r, max(disp.g, disp.b));
  let emisMask = smoothstep(0.0, 0.1, dispLum);
  let giTerm = (flt + dir * U.giDirectional) * (U.giStrength * U.giProbeLift * giMask * (1.0 - emisMask));

  var color = matl * (lit * (1.0 - aoT)) + giTerm * (1.0 - aoT) + disp * U.emissiveDisplay;

  color = acesFilm(color * U.exposure);
  if (U.encodeSrgb > 0.5) { color = toSrgb(color); }
  let g = (hash12(devPx) - 0.5) * U.grain;
  return vec4<f32>(clamp(color + vec3<f32>(g), vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
