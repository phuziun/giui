// Present pass. Fullscreen triangle at swapchain (display) resolution.
//
// Samples the low-res HDR lighting target (smooth, so upscaling is free of
// artefacts), then does the cheap per-pixel finishing at full resolution:
// exposure, ACES tonemap, sRGB encode, and crisp monochromatic film grain.

struct Present {
  exposure : f32,
  grain : f32,
  encodeSrgb : f32,
  _pad : f32,
};

@group(0) @binding(0) var<uniform> P : Present;
@group(0) @binding(1) var samp : sampler;
@group(0) @binding(2) var litTex : texture_2d<f32>;

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

fn acesFilm(x : vec3<f32>) -> vec3<f32> {
  let a = 2.51; let b = 0.03; let c = 2.43; let d = 0.59; let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3<f32>(0.0), vec3<f32>(1.0));
}

fn toSrgb(c : vec3<f32>) -> vec3<f32> {
  let lo = c * 12.92;
  let hi = 1.055 * pow(c, vec3<f32>(1.0 / 2.4)) - 0.055;
  return select(hi, lo, c <= vec3<f32>(0.0031308));
}

fn hash12(p : vec2<f32>) -> f32 {
  var p3 = fract(vec3<f32>(p.x, p.y, p.x) * 0.1031);
  p3 += dot(p3, vec3<f32>(p3.y, p3.z, p3.x) + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

@fragment
fn fs(in : VSOut) -> @location(0) vec4<f32> {
  var color = textureSampleLevel(litTex, samp, in.uv, 0.0).rgb;
  color = acesFilm(color * P.exposure);
  if (P.encodeSrgb > 0.5) {
    color = toSrgb(color);
  }
  let g = (hash12(in.pos.xy) - 0.5) * P.grain;
  color = clamp(color + vec3<f32>(g), vec3<f32>(0.0), vec3<f32>(1.0));
  return vec4<f32>(color, 1.0);
}
