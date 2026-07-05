// Which GPU-side container carries the shape data.
//
// Storage buffer is the fast path (a plain cached array read). But at least
// one mobile driver — PowerVR/Imagination ("img-tec ...") under Android
// Chrome — silently reads compute storage buffers as ZEROS: init succeeds,
// no validation errors, and every shape simply vanishes (diagnosed on the
// owner's phone via the giDebug stage probe: shapes: 20, scene=0.00/0.00).
// For those adapters the shapes travel as an rgba32float texture read with
// textureLoad instead — universally exercised, ~4x slower per fetch, which
// is why it is NOT the default everywhere.
//
// `?shapetex=1|0` overrides for testing either path on any device.
export function useShapeTexture(gpuName: string): boolean {
  try {
    const o = new URLSearchParams(location.search).get("shapetex");
    if (o === "1") return true;
    if (o === "0") return false;
  } catch {
    /* non-browser */
  }
  return /img-tec|imagination|powervr/i.test(gpuName);
}

/** Swap the WGSL shape-access block (texture variant, between markers) for
 *  the storage-buffer variant. `countExpr` supplies the loop bound. */
export function shapeAccessWGSL(src: string, viaTexture: boolean, countExpr: string): string {
  if (viaTexture) return src;
  return src.replace(
    /\/\/ SHAPES_VIA_TEXTURE_BEGIN[\s\S]*?\/\/ SHAPES_VIA_TEXTURE_END/,
    `@group(0) @binding(1) var<storage, read> shapesArr : array<Shape>;
fn getShape(i : u32) -> Shape { return shapesArr[i]; }
fn shapeTotal() -> u32 { return u32(${countExpr}); }`
  );
}
