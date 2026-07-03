import { FLOATS_PER_SHAPE, MAX_SHAPES, type Shape } from "./types";

function shapeEq(a: Shape, b: Shape): boolean {
  return (
    a.kind === b.kind &&
    a.x === b.x &&
    a.y === b.y &&
    a.halfW === b.halfW &&
    a.halfH === b.halfH &&
    a.cornerRadius === b.cornerRadius &&
    a.height === b.height &&
    a.bevel === b.bevel &&
    a.rolloff === b.rolloff &&
    a.opacity === b.opacity &&
    a.displayScale === b.displayScale &&
    a.tint === b.tint &&
    a.bodyAlpha === b.bodyAlpha &&
    a.heightScale === b.heightScale &&
    a.albedo[0] === b.albedo[0] &&
    a.albedo[1] === b.albedo[1] &&
    a.albedo[2] === b.albedo[2] &&
    a.emission[0] === b.emission[0] &&
    a.emission[1] === b.emission[1] &&
    a.emission[2] === b.emission[2]
  );
}

// Holds the live set of shapes and packs them into the std430 storage layout
// the scene shader expects (4x vec4 per shape, see scene.wgsl `struct Shape`).
export class Scene {
  private shapes = new Map<string, Shape>();
  readonly data = new Float32Array(MAX_SHAPES * FLOATS_PER_SHAPE);
  private dirty = true;
  // Set when a shape is added or removed (not on a plain update). Lets the
  // renderer decide between a full re-composite and a visible-band-only one.
  private structural = true;
  // Vertical (css px) extent touched by updates since the last render — lets
  // the render loop skip frames whose only changes are far off-screen.
  private dirtyMinY = Infinity;
  private dirtyMaxY = -Infinity;
  private lastPackKey = "";
  private packedCount = 0;

  private touch(s: Shape) {
    const m = s.bevel + 60; // bevel band + edge AA + slack
    this.dirtyMinY = Math.min(this.dirtyMinY, s.y - s.halfH - m);
    this.dirtyMaxY = Math.max(this.dirtyMaxY, s.y + s.halfH + m);
  }

  // Returns true if the scene actually changed (so callers can request a render).
  set(id: string, shape: Shape): boolean {
    const prev = this.shapes.get(id);
    if (prev && shapeEq(prev, shape)) return false;
    if (!prev) this.structural = true;
    else this.touch(prev); // old box must be cleaned up too
    this.touch(shape);
    this.shapes.set(id, shape);
    this.dirty = true;
    return true;
  }

  remove(id: string): boolean {
    const prev = this.shapes.get(id);
    const had = this.shapes.delete(id);
    if (had) {
      if (prev) this.touch(prev);
      this.dirty = true;
      this.structural = true;
    }
    return had;
  }

  // Read and clear the structural-change flag (a shape was added/removed).
  consumeStructural(): boolean {
    const s = this.structural;
    this.structural = false;
    return s;
  }

  hasStructural(): boolean {
    return this.structural;
  }

  // Does any pending change touch the [top, bottom] css band?
  dirtyIntersects(top: number, bottom: number): boolean {
    return this.dirtyMaxY >= top && this.dirtyMinY <= bottom;
  }

  clearDirtyRange() {
    this.dirtyMinY = Infinity;
    this.dirtyMaxY = -Infinity;
  }

  // Number of shapes in the packed buffer (after culling) — what the shader
  // must loop over. Valid after pack().
  get count(): number {
    return this.packedCount;
  }

  // Repacks into `data` if the shapes or the cull window changed. `scale`
  // converts css px -> render px. `cullTop/cullBot` (css px) drop shapes that
  // cannot affect the band being re-rendered — the per-pixel shape loops are
  // the scene pass's dominant cost, and on a band render only nearby shapes
  // matter (off-band G-buffer rows are preserved, not recomputed). Callers
  // pass quantized bounds so the key stays stable across small scrolls.
  pack(scale: number, cullTop = -Infinity, cullBot = Infinity): boolean {
    const key = `${scale}|${cullTop}|${cullBot}`;
    if (!this.dirty && key === this.lastPackKey) return false;
    this.lastPackKey = key;
    this.data.fill(0);
    // Painter's order: layer ascending (overlays above page content), then
    // larger shapes first so nested children (smaller, e.g. an input field
    // inside a card) paint *over* their parent and keep their own albedo/tint
    // instead of being overwritten by it. (Effect order alone would register
    // children first, drawing them underneath the parent.)
    const sorted = [...this.shapes.values()].sort(
      (a, b) => a.layer - b.layer || b.halfW * b.halfH - a.halfW * a.halfH
    );
    let i = 0;
    for (const s of sorted) {
      if (i >= MAX_SHAPES) break;
      const m = s.bevel + 60;
      if (s.y + s.halfH + m < cullTop || s.y - s.halfH - m > cullBot) continue;
      const o = i * FLOATS_PER_SHAPE;
      // geom: center.xy, half.xy
      this.data[o + 0] = s.x * scale;
      this.data[o + 1] = s.y * scale;
      this.data[o + 2] = s.halfW * scale;
      this.data[o + 3] = s.halfH * scale;
      // params: cornerRadius, kind, height, bevel
      this.data[o + 4] = s.cornerRadius * scale;
      this.data[o + 5] = s.kind === "circle" ? 1 : 0;
      this.data[o + 6] = s.height;
      this.data[o + 7] = Math.max(s.bevel * scale, 0.5);
      // albedo: rgb, opacity
      this.data[o + 8] = s.albedo[0];
      this.data[o + 9] = s.albedo[1];
      this.data[o + 10] = s.albedo[2];
      this.data[o + 11] = s.opacity;
      // emission: rgb, rolloff (negative => global default)
      this.data[o + 12] = s.emission[0];
      this.data[o + 13] = s.emission[1];
      this.data[o + 14] = s.emission[2];
      this.data[o + 15] = s.rolloff;
      // extra: displayScale, tint, bodyAlpha, heightScale (<0 = global default)
      this.data[o + 16] = s.displayScale;
      this.data[o + 17] = s.tint;
      this.data[o + 18] = s.bodyAlpha;
      this.data[o + 19] = s.heightScale;
      i++;
    }
    this.packedCount = i;
    this.dirty = false;
    return true;
  }

  markDirty() {
    this.dirty = true;
  }
}
