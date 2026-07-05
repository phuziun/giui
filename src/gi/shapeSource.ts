// Which GPU-side container carries the shape data.
//
// Storage buffer is the fast path (a plain cached array read) and the
// default everywhere. The texture path (shapes as rgba32float texels read
// with textureLoad) is kept as a `?shapetex=1` diagnostic/escape hatch for
// a future driver whose storage-buffer reads misbehave.
//
// History: this dual path was built when the PowerVR ("img-tec") Pixel 10
// black screen was misdiagnosed as storage-buffers-read-as-zeros. Direct
// binding-type repros on that phone later proved storage buffers work fine
// there — the real bug was the driver miscompiling vertex_index-indexed
// local arrays in VERTEX shaders (every fullscreen-triangle draw silently
// culled; fixed in the shaders themselves). So nothing auto-enables this
// anymore.
export function useShapeTexture(_gpuName: string): boolean {
  try {
    const o = new URLSearchParams(location.search).get("shapetex");
    if (o === "1") return true;
    if (o === "0") return false;
  } catch {
    /* non-browser */
  }
  return false;
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
