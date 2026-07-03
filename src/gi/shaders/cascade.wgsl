// Radiance Cascades build pass (run once per cascade, top-down).
//
// Layout: "direction-first". Each cascade texture is divided into
// tileDim x tileDim sub-images; sub-image d is a probesX x probesY grid holding
// the radiance for direction d at every probe. This makes probe-space bilinear
// interpolation (needed when merging with the sparser cascade above) a single
// hardware-filtered sample, as long as we keep the footprint inside a sub-image.
//
// Each invocation:
//   1. raymarches its angular interval [intervalStart, intervalEnd] against the
//      scene, accumulating radiance + remaining transmittance, then
//   2. merges the upper cascade (4 child directions x bilinear probe lookup),
//      attenuated by the transmittance that survived the near interval.

const TAU = 6.28318530718;

struct Cascade {
  probesX : f32,  probesY : f32,
  upProbesX : f32, upProbesY : f32,
  tileDim : f32,  upTileDim : f32,
  dirCount : f32, upDirCount : f32,
  probeSpacing : f32, upProbeSpacing : f32,
  intervalStart : f32, intervalEnd : f32,
  texW : f32, texH : f32,
  upTexW : f32, upTexH : f32,
  resolution : vec2<f32>,
  raySteps : f32,
  isTop : f32,
  skyColor : vec3<f32>,
  skyStrength : f32,
  occlusion : f32,   // 0 = light passes through components, 1 = full shadowing
  scrollY : f32,     // content offset (render px) — anchors probe grids to content
  band : vec2<f32>,  // [y0,y1] render-px screen band (+margin) to recompute probes for
};

@group(0) @binding(0) var<uniform> C : Cascade;
@group(0) @binding(1) var samp : sampler;
@group(0) @binding(2) var sceneTex : texture_2d<f32>;
@group(0) @binding(3) var upperTex : texture_2d<f32>;   // cascade i+1 (or a 1x1 dummy at top)
@group(0) @binding(4) var outTex : texture_storage_2d<rgba16float, write>;

// March a ray segment through the scene, front-to-back.
// Returns rgb = accumulated radiance, a = remaining transmittance.
fn raymarch(origin : vec2<f32>, dir : vec2<f32>, t0 : f32, t1 : f32) -> vec4<f32> {
  let steps = max(u32(C.raySteps), 1u);
  let dt = (t1 - t0) / f32(steps);
  var radiance = vec3<f32>(0.0);
  var transmit = 1.0;
  for (var i = 0u; i < steps; i = i + 1u) {
    let t = t0 + (f32(i) + 0.5) * dt;
    let p = origin + dir * t;
    if (p.x < 0.0 || p.y < 0.0 || p.x >= C.resolution.x || p.y >= C.resolution.y) {
      break;
    }
    let s = textureSampleLevel(sceneTex, samp, p / C.resolution, 0.0);
    let op = s.a;
    // Emitters keep full occlusion (they are solid light sources); non-emissive
    // components have their occlusion scaled by `occlusion`, so the local-light
    // ratio of "shadow" vs "light spreading across the surface" is tunable.
    let isEmitter = step(0.0008, max(s.r, max(s.g, s.b)));
    let occ = min(op * mix(C.occlusion, 1.0, isEmitter), 1.0);
    radiance += transmit * s.rgb * op;
    transmit *= (1.0 - occ);
    if (transmit < 0.0015) { transmit = 0.0; break; }
  }
  return vec4<f32>(radiance, transmit);
}

// Sample a single direction sub-image of the upper cascade at a (float) probe
// coordinate, with hardware bilinear filtering kept inside the sub-image.
fn sampleUpper(dir : u32, probe : vec2<f32>) -> vec3<f32> {
  let sx = f32(dir % u32(C.upTileDim));
  let sy = f32(dir / u32(C.upTileDim));
  let origin = vec2<f32>(sx * C.upProbesX, sy * C.upProbesY);
  // Clamp so the bilinear footprint never crosses into a neighbouring sub-image.
  let pc = clamp(probe, vec2<f32>(0.0), vec2<f32>(C.upProbesX - 1.0, C.upProbesY - 1.0));
  let uv = (origin + pc + vec2<f32>(0.5)) / vec2<f32>(C.upTexW, C.upTexH);
  return textureSampleLevel(upperTex, samp, uv, 0.0).rgb;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  if (gid.x >= u32(C.texW) || gid.y >= u32(C.texH)) { return; }

  let px = u32(C.probesX);
  let py = u32(C.probesY);
  let sdx = gid.x / px;            // sub-image (direction) coords
  let sdy = gid.y / py;
  let dirIndex = sdy * u32(C.tileDim) + sdx;
  let probe = vec2<u32>(gid.x - sdx * px, gid.y - sdy * py);

  // Content-anchor the probe grid: shift it by the scroll phase so probes stay
  // fixed relative to CONTENT. Without this, scrolling re-quantizes every shape
  // against a viewport-fixed grid — visible discrete lighting steps every
  // `spacing` render px of scroll. Far-field cascades (spacing > 64) skip it:
  // their shift could exceed the band-recompute margin, and their contribution
  // is too smooth to step visibly. Phases only change with scrollY, which
  // always forces a full render, so band renders keep valid off-band probes.
  let phase = select(0.0, fract(C.scrollY / C.probeSpacing) * C.probeSpacing,
                     C.probeSpacing <= 64.0);
  let probePos = (vec2<f32>(probe) + vec2<f32>(0.5)) * C.probeSpacing - vec2<f32>(0.0, phase);
  // Only recompute probes whose screen row is in the visible band (+margin for the
  // composite's spatial gather); others keep their previous radiance. Same screen
  // band across all cascades, so a lower cascade's upward merge stays in-band.
  if (probePos.y < C.band.x - 64.0 || probePos.y > C.band.y + 64.0) { return; }
  let ang = (f32(dirIndex) + 0.5) / C.dirCount * TAU;
  let dir = vec2<f32>(cos(ang), sin(ang));

  let near = raymarch(probePos, dir, C.intervalStart, C.intervalEnd);
  var radiance = near.rgb;
  let transmit = near.a;

  if (C.isTop > 0.5) {
    // Rays that escape the top cascade see the ambient sky.
    radiance += transmit * C.skyColor * C.skyStrength;
  } else if (transmit > 0.0) {
    // Merge the upper cascade: 4 child directions subdivide this angular bin.
    // The upper grid may be phase-shifted too (content anchoring) — invert it.
    let upPhase = select(0.0, fract(C.scrollY / C.upProbeSpacing) * C.upProbeSpacing,
                         C.upProbeSpacing <= 64.0);
    let upProbe = (probePos + vec2<f32>(0.0, upPhase)) / C.upProbeSpacing - vec2<f32>(0.5);
    var up = vec3<f32>(0.0);
    for (var k = 0u; k < 4u; k = k + 1u) {
      up += sampleUpper(dirIndex * 4u + k, upProbe);
    }
    radiance += transmit * up * 0.25;
  }

  textureStore(outTex, vec2<i32>(i32(gid.x), i32(gid.y)), vec4<f32>(radiance, transmit));
}
