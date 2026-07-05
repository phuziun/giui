// Composite / shading pass. Fullscreen triangle, rendered at the (capped) GI
// resolution into an offscreen HDR target; a separate present pass tonemaps and
// upscales it. Outputs linear HDR radiance (no tonemap/grain here).
//
// Dark-neumorphic model: a soft, consistent directional key light reads the
// 2.5D normal (signed N.L => highlight + shadow), a dim fill lifts the shadow
// side, a height-field AO adds contact shadows, and the radiance cascades add a
// DIRECTIONAL coloured bounce -- bevels facing an emitter brighten, so light
// visibly travels from one glowing component onto its neighbours.

const TAU = 6.28318530718;

struct Lighting {
  resolution : vec2<f32>,
  probesX0 : f32, probesY0 : f32,
  tileDim0 : f32, dirCount0 : f32, probeSpacing0 : f32, tex0W : f32,
  tex0H : f32, normalStrength : f32, giStrength : f32, ambient : f32,
  exposure : f32, keyIntensity : f32, encodeSrgb : f32, debugMode : f32,
  keyDir : vec3<f32>, tintAmount : f32,
  keyColor : vec3<f32>, giDirectional : f32,
  material : vec3<f32>, emissiveDisplay : f32,
  extra : vec4<f32>,    // giSmooth (px), grain, giBackground, fillIntensity
  fillDir : vec3<f32>, aoStrength : f32,
  fillColor : vec3<f32>, aoRadius : f32,
  shadow : vec4<f32>,   // strength, length (px), heightScale (px/unit), softness
  texParams : vec4<f32>, // surfaceTexture, textureScale (px), scrollY (render px), _
};

@group(0) @binding(0) var<uniform> L : Lighting;
@group(0) @binding(1) var samp : sampler;
@group(0) @binding(2) var cascade0 : texture_2d<f32>;
@group(0) @binding(3) var albedoTex : texture_2d<f32>;
@group(0) @binding(4) var normalTex : texture_2d<f32>;
@group(0) @binding(5) var sceneTex : texture_2d<f32>;
@group(0) @binding(6) var dispTex : texture_2d<f32>;

struct VSOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) uv : vec2<f32>,
};

@vertex
fn vs(@builtin(vertex_index) vi : u32) -> VSOut {
  // Fullscreen triangle from bit math, NOT a local array indexed by vi:
  // PowerVR (Pixel 10 "img-tec d-series") miscompiles vertex_index-indexed
  // local arrays into degenerate positions — every draw silently culled.
  var out : VSOut;
  let xy = vec2<f32>(f32(i32(vi & 1u) * 4 - 1), f32(i32(vi >> 1u) * 4 - 1));
  out.pos = vec4<f32>(xy, 0.0, 1.0);
  out.uv = vec2<f32>((xy.x + 1.0) * 0.5, (1.0 - xy.y) * 0.5);
  return out;
}

fn sampleCascade0(dir : u32, probe : vec2<f32>) -> vec3<f32> {
  let sx = f32(dir % u32(L.tileDim0));
  let sy = f32(dir / u32(L.tileDim0));
  let origin = vec2<f32>(sx * L.probesX0, sy * L.probesY0);
  let pc = clamp(probe, vec2<f32>(0.0), vec2<f32>(L.probesX0 - 1.0, L.probesY0 - 1.0));
  let uv = (origin + pc + vec2<f32>(0.5)) / vec2<f32>(L.tex0W, L.tex0H);
  return textureSampleLevel(cascade0, samp, uv, 0.0).rgb;
}

fn ign(p : vec2<f32>) -> f32 {
  return fract(52.9829189 * fract(dot(p, vec2<f32>(0.06711056, 0.00583715))));
}

fn hash12(p : vec2<f32>) -> f32 {
  var p3 = fract(vec3<f32>(p.x, p.y, p.x) * 0.1031);
  p3 += dot(p3, vec3<f32>(p3.y, p3.z, p3.x) + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Smooth value noise (bilinear-interpolated hash) for organic surface texture.
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

struct GI { flat : vec3<f32>, dir : vec3<f32> };

// Gather cascade-0 radiance over 2 per-pixel-rotated taps (smooths the blocky
// bilinear into fine noise; was 4 taps — 2 halves the dominant sample cost and
// the per-pixel rotation + giSmooth hide the difference). Returns both the flat
// irradiance and a directional term weighted by how much each incoming
// direction faces the surface's in-plane normal -- the directional term is
// what makes a bounce read as a bounce.
fn gatherGI(px : vec2<f32>, dpx : vec2<f32>, n2 : vec2<f32>) -> GI {
  let rot = ign(dpx) * TAU;
  let radius = L.extra.x;
  let dcount = u32(L.dirCount0);
  // Cascade-0's probe grid is content-anchored (shifted by the scroll phase —
  // see cascade.wgsl); invert the same phase when mapping pixel -> probe.
  let phase0 = vec2<f32>(0.0, fract(L.texParams.z / L.probeSpacing0) * L.probeSpacing0);
  var fl = vec3<f32>(0.0);
  var dr = vec3<f32>(0.0);
  for (var t = 0u; t < 2u; t = t + 1u) {
    let a = rot + f32(t) * (TAU * 0.5);
    let off = vec2<f32>(cos(a), sin(a)) * radius;
    let probe = (px + off + phase0) / L.probeSpacing0 - vec2<f32>(0.5);
    for (var d = 0u; d < dcount; d = d + 1u) {
      let ang = (f32(d) + 0.5) / L.dirCount0 * TAU;
      let ldir = vec2<f32>(cos(ang), sin(ang));
      let rad = sampleCascade0(d, probe);
      fl += rad;
      dr += rad * max(dot(n2, ldir), 0.0);
    }
  }
  let s = (TAU / L.dirCount0) * 0.5;
  return GI(fl * s, dr * s);
}

// Contact shadows from the height field: if neighbours are taller than this
// texel, it sits in a crevice (the foot of a raised lip, the inside of a carved
// well) and gets darkened.
fn contactAO(uv : vec2<f32>, h0 : f32, rot : f32) -> f32 {
  let inv = 1.0 / L.resolution;
  var occ = 0.0;
  for (var k = 0u; k < 4u; k = k + 1u) {
    let a = rot + f32(k) * (TAU / 4.0);
    let o = vec2<f32>(cos(a), sin(a)) * L.aoRadius * inv;
    let hn = textureSampleLevel(normalTex, samp, uv + o, 0.0).w;
    occ += max(hn - h0, 0.0);
  }
  return clamp((occ / 4.0) * L.aoStrength, 0.0, 1.0);
}

// Directional soft shadow from the key light, marched across the height field:
// step toward the light and, if the terrain rises above the ray climbing at the
// light's elevation, this texel is occluded. Gives raised elements a cast drop
// shadow (and carved wells a shadowed inner wall) on the side away from the key.
fn keyShadow(uv : vec2<f32>, h0 : f32) -> f32 {
  let len2 = length(L.keyDir.xy);
  if (len2 < 1e-4 || L.shadow.x <= 0.0) { return 1.0; }
  let d = L.keyDir.xy / len2;
  let zslope = L.keyDir.z / len2; // height (px) gained per px stepped toward the light
  let inv = 1.0 / L.resolution;
  let steps = 10u;
  let stepPx = L.shadow.y / f32(steps);
  var occ = 0.0;
  for (var i = 1u; i <= steps; i = i + 1u) {
    let t = f32(i) * stepPx;
    let hs = textureSampleLevel(normalTex, samp, uv + d * (t * inv), 0.0).w;
    // ray height (in height-field units) climbing toward the light:
    let rayH = h0 + zslope * t / L.shadow.z;
    // closer occluders cast harder shadows (penumbra widens with distance).
    occ = max(occ, (hs - rayH) / (1.0 + t * L.shadow.w));
  }
  return 1.0 - clamp(occ * L.shadow.x, 0.0, 1.0);
}

@fragment
fn fs(in : VSOut) -> @location(0) vec4<f32> {
  let px = in.uv * L.resolution;
  let tc = in.uv;
  // Content-anchored coordinate for all stochastic patterns (noise, dither
  // rotations): the canvas is viewport-fixed in viewport mode, so seeding them
  // from raw canvas coords made the patterns stand still while content
  // scrolled underneath — lighting visibly crawled/stuttered on scroll.
  let cpx = px + vec2<f32>(0.0, L.texParams.z);

  let alb = textureSampleLevel(albedoTex, samp, tc, 0.0);
  let nrm = textureSampleLevel(normalTex, samp, tc, 0.0);
  let scn = textureSampleLevel(sceneTex, samp, tc, 0.0);
  let emis = scn.rgb;                                           // GI emission (a = occlusion)
  let dispS = textureSampleLevel(dispTex, samp, tc, 0.0);
  let disp = dispS.rgb;                                         // surface display emissive
  var N = normalize(vec3<f32>(nrm.xy * L.normalStrength, max(nrm.z, 1e-3)));
  // Surface micro-texture: nudge the normal with value noise so the key light
  // catches a subtle matte texture instead of a perfectly smooth surface.
  let ts = max(L.texParams.y, 0.5);
  let nx = vnoise(cpx / ts) - 0.5;
  let ny = vnoise(cpx / ts + vec2<f32>(37.2, 11.7)) - 0.5;
  N = normalize(N + vec3<f32>(nx, ny, 0.0) * L.texParams.x);

  // One continuous material everywhere; components may optionally tint it. The
  // per-shape tint (dispS.a) lifts the effective tint toward full albedo, so
  // inset elements can read truly dark regardless of the global tintAmount cap.
  let cover = clamp(alb.a, 0.0, 1.0);
  // Matte components pack a smooth suppression FIELD into the tint channel
  // (scene.wgsl): a = -(hard + soft) - 2*tint*cover. Decode all three:
  //   matteSoft — 1 over the face/lip, feathering to 0 across the bevel-wide
  //               apron. Ramps the background GI down near a matte shape, so
  //               the glow around it fades in as a soft penumbra instead of
  //               cutting hard at a dilated silhouette (the old binary flag +
  //               4-tap dilation read as a harsh bright rim hugging the bar).
  //   matteHard — 1 over the face + entire bevel lip only. Kills component-
  //               level GI there (no bright rim on the lip).
  //   realTint  — the shape's normal tint, preserved (matte + tint:1 insets
  //               like the segmented track still read dark).
  // Non-matte tint stays in [0,1] and decodes to matteSoft = matteHard = 0.
  let realTint = select(dispS.a, (-dispS.a - 2.0) * 0.5, dispS.a < -0.5);
  let effTint = mix(L.tintAmount, 1.0, clamp(realTint, 0.0, 1.0));
  let albedo = mix(L.material, alb.rgb, cover * effTint);

  // Confine the GI bounce to components, but mask by the *height field* (not just
  // the silhouette) so the raised/carved bevel slopes -- which extend past the
  // outline -- catch the bounce too, not only the flat interior.
  let hmask = smoothstep(0.0, 0.03, abs(nrm.w));
  let matteSoft = clamp(-dispS.a, 0.0, 1.0);
  let matteHard = clamp(-dispS.a - 1.0, 0.0, 1.0);
  // The matte apron REVEALS the GI on the background instead of suppressing
  // it: the backplate near a matte bar shows up to 50% of the gathered GI
  // (vs the global giBackground cap, typ. 0.14, elsewhere), fading back to
  // the cap across the soft zone. Physically read: the wall right behind a
  // backlit panel is the brightest part of the halo — the light source is
  // VISIBLE ("motivated"), while the far-field spill keeps the global cap.
  // The face + bevel lip stay dark via matteHard; the 5px hard-exit ramp in
  // the scene pass is where the escaping-light rim ignites, so every
  // transition stays smooth (no return of the old harsh edge).
  let bgGI = mix(L.extra.z, 0.5, matteSoft) * (1.0 - matteHard);
  let giMask = mix(bgGI, 1.0, max(cover, hmask) * (1.0 - matteHard));

  // An emitter's own *visible* body shows its colour + display glow and should
  // not be re-lit by the bounce of its own emission, so suppress the GI there.
  // Keyed on the display emission (not the GI emission), so a hidden light (no
  // display) lets the bounce flow smoothly through instead of leaving a dark hole.
  let emisLum = max(disp.r, max(disp.g, disp.b));
  let emisMask = smoothstep(0.0, 0.1, emisLum);

  // Skip the expensive gather where it contributes nothing (most of the bg).
  var giTerm = vec3<f32>(0.0);
  if (L.giStrength * giMask * (1.0 - emisMask) > 0.0008) {
    let gi = gatherGI(px, in.pos.xy + vec2<f32>(0.0, L.texParams.z), nrm.xy * L.normalStrength);
    giTerm = (gi.flat + gi.dir * L.giDirectional) * (L.giStrength * giMask * (1.0 - emisMask));
  }

  // Soft directional key light (signed) + dim additive fill light. The key term
  // is gated by a cast shadow marched across the height field.
  let ndl = dot(N, normalize(L.keyDir));
  let ndf = max(dot(N, normalize(L.fillDir)), 0.0);
  let ksh = keyShadow(tc, nrm.w);
  let lit = max(
    vec3<f32>(L.ambient) + L.keyColor * (L.keyIntensity * ndl * ksh) + L.fillColor * (L.extra.w * ndf),
    vec3<f32>(0.0)
  );

  let ao = contactAO(tc, nrm.w, ign(in.pos.xy + vec2<f32>(0.0, L.texParams.z)) * TAU);

  // The key/fill light modulates the (dark) material; the GI bounce is added as
  // light landing on the surface, so a glowing component's spill stays visible
  // even though the material albedo is near-black.
  // emis drives the indirect bounce (cascades) at full strength; the emitter's
  // own surface shows only `disp` (emission x per-shape displayScale) x the
  // global master -- so the button reads as deep blue with a hint of glow while
  // still pouring blue light onto its neighbours.
  var color = albedo * (lit * (1.0 - ao)) + giTerm * (1.0 - ao) + disp * L.emissiveDisplay;

  // Debug views. 1-4 are G-buffer/GI channels; 5-8 isolate the shading terms
  // that darken the scene (depth, cast shadow, AO, cascade occlusion) — hard
  // to judge when composited, obvious in isolation.
  if (L.debugMode > 7.5) {
    // Occlusion: how strongly this pixel blocks light in the cascades
    // (sceneTex.a — shapes' `opacity`). White = full occluder.
    color = vec3<f32>(scn.a);
  } else if (L.debugMode > 6.5) {
    // Contact AO term (shown as the darkening actually applied: 1 - ao).
    color = vec3<f32>(1.0 - ao);
  } else if (L.debugMode > 5.5) {
    // Cast-shadow gate on the key light (height-field march): white = fully
    // lit by the key, dark = in a cast shadow.
    color = vec3<f32>(ksh);
  } else if (L.debugMode > 4.5) {
    // Height/depth field: raised reads warm, carved reads blue, flat black.
    let h = nrm.w;
    color = select(vec3<f32>(0.15, 0.35, 1.0) * (-h * 0.6),
                   vec3<f32>(1.0, 0.85, 0.55) * (h * 0.6),
                   h >= 0.0);
  } else if (L.debugMode > 3.5) {
    color = giTerm / max(L.giStrength, 1e-3);
  } else if (L.debugMode > 2.5) {
    color = emis;
  } else if (L.debugMode > 1.5) {
    color = N * 0.5 + vec3<f32>(0.5);
  } else if (L.debugMode > 0.5) {
    color = alb.rgb;
  }

  return vec4<f32>(color, 1.0); // linear HDR; tonemap + grain happen in present
}
