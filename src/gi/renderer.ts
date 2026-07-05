import type { GPUContext } from "./device";
import { useShapeTexture, shapeAccessWGSL } from "./shapeSource";
import type { Scene } from "./scene";
import { MAX_SHAPES, FLOATS_PER_SHAPE, type GIParams } from "./types";
import sceneWgsl from "./shaders/scene.wgsl?raw";
import cascadeWgsl from "./shaders/cascade.wgsl?raw";
import compositeWgsl from "./shaders/composite.wgsl?raw";
import presentWgsl from "./shaders/present.wgsl?raw";

// GPU pipelines are compiled once when the canvas mounts, so edits to the WGSL
// don't take effect under React Fast Refresh (the renderer instance survives).
// Force a full reload when this module or any shader it imports changes.
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    location.reload();
  });
}

const LIT_FORMAT: GPUTextureFormat = "rgba16float";

// Fixed dimensions for the screen light-source texture (a canvas/video frame
// uploaded per render). Fixed so the bind group never needs rebuilding.
export const SCREEN_TEX_W = 256;
export const SCREEN_TEX_H = 64;

// A rect (content css px) showing + emitting a picture. `source` must be
// SCREEN_TEX_W×SCREEN_TEX_H.
export type ScreenSource = {
  x: number;
  y: number;
  w: number;
  h: number;
  source: HTMLCanvasElement;
  emit: number; // radiance poured into the cascades
  display: number; // picture brightness on the screen surface
  topFade?: number; // 0..1 — how much `emit` is cut at the rect's top edge
  topFadeH?: number; // ramp height as a fraction of the rect (default 0.4)
};

type CascadeDesc = {
  probesX: number;
  probesY: number;
  tileDim: number;
  dirCount: number;
  spacing: number;
  intervalStart: number;
  intervalEnd: number;
  texW: number;
  texH: number;
  raySteps: number;
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export class Renderer {
  private ctx: GPUContext;
  private device: GPUDevice;

  private screenTex!: GPUTexture;
  private scenePipeline!: GPUComputePipeline;
  private cascadePipeline!: GPUComputePipeline;
  private compositePipeline!: GPURenderPipeline;
  private presentPipeline!: GPURenderPipeline;
  private sampler: GPUSampler;

  // Persistent buffers.
  // Shape data lives in an rgba32float TEXTURE (5 texels/shape), not a storage
  // buffer: at least one mobile driver (PowerVR img-tec, Android Chrome) reads
  // compute storage buffers as zeros — shapes silently vanish. textureLoad is
  // the battle-tested path everywhere. Height = bucketed shape count, so the
  // shader derives the loop bound from textureDimensions (immune to a broken
  // scalar uniform too).
  private shapeDataTex: GPUTexture | null = null;
  private shapeBuffer: GPUBuffer | null = null;
  readonly shapesViaTexture: boolean;
  private globalsUBO: GPUBuffer;
  private lightingUBO: GPUBuffer;
  private presentUBO: GPUBuffer;

  // Size-dependent resources, rebuilt when the layout signature changes.
  private signature = "";
  private rw = 0;
  private rh = 0;
  private lastScale = -1;
  private fullRendered = false; // has litTex been fully composited at least once?
  private descs: CascadeDesc[] = [];
  private gScene!: GPUTexture;
  private gAlbedo!: GPUTexture;
  private gNormal!: GPUTexture;
  private gDisplay!: GPUTexture;
  private cascades: GPUTexture[] = [];
  private dummyTex!: GPUTexture;
  private litTex!: GPUTexture;
  private cascadeUBOs: GPUBuffer[] = [];
  private sceneBindGroup!: GPUBindGroup;
  private cascadeBindGroups: GPUBindGroup[] = [];
  private compositeBindGroup!: GPUBindGroup;
  private presentBindGroup!: GPUBindGroup;

  // Use Renderer.create() — pipeline compilation is async so the (potentially
  // seconds-long, uncached) WGSL -> Metal/D3D compile doesn't freeze the page.
  private constructor(ctx: GPUContext) {
    this.ctx = ctx;
    this.device = ctx.device;
    this.shapesViaTexture = useShapeTexture(ctx.gpuName);
    if (!this.shapesViaTexture) {
      this.shapeBuffer = this.device.createBuffer({
        size: MAX_SHAPES * FLOATS_PER_SHAPE * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
    }

    this.sampler = this.device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    });


    this.globalsUBO = this.device.createBuffer({
      size: 96, // see scene.wgsl Globals: 12 floats + scrollY/pad + screen vec4s
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // The "screen" light-source texture (fixed size — see SCREEN_TEX_W/H). A
    // canvas or video frame is copied in each render; sampled bilinearly, so a
    // low-res source reads as a soft, blurred picture.
    this.screenTex = this.device.createTexture({
      size: [SCREEN_TEX_W, SCREEN_TEX_H],
      format: "rgba8unorm",
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.lightingUBO = this.device.createBuffer({
      size: 192,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.presentUBO = this.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  // Async factory: compiles all pipelines off the main thread in parallel.
  // Startup used to block for seconds on the synchronous variants whenever the
  // shader cache was cold (first visit / any shader edit) — the page froze,
  // then the lit scene "kicked in" once compilation finished.
  // How long pipeline compilation took (ms) — diagnosing cold-cache stalls.
  pipelineMs = 0;

  static async create(ctx: GPUContext): Promise<Renderer> {
    const t0 = performance.now();
    const r = new Renderer(ctx);
    const device = ctx.device;
    const sceneModule = device.createShaderModule({
      code: shapeAccessWGSL(sceneWgsl, r.shapesViaTexture, "G.shapeCount"),
    });
    const cascadeModule = device.createShaderModule({ code: cascadeWgsl });
    const compositeModule = device.createShaderModule({ code: compositeWgsl });
    const presentModule = device.createShaderModule({ code: presentWgsl });

    [r.scenePipeline, r.cascadePipeline, r.compositePipeline, r.presentPipeline] =
      await Promise.all([
        device.createComputePipelineAsync({
          layout: "auto",
          compute: { module: sceneModule, entryPoint: "main" },
        }),
        device.createComputePipelineAsync({
          layout: "auto",
          compute: { module: cascadeModule, entryPoint: "main" },
        }),
        device.createRenderPipelineAsync({
          layout: "auto",
          vertex: { module: compositeModule, entryPoint: "vs" },
          fragment: {
            module: compositeModule,
            entryPoint: "fs",
            targets: [{ format: LIT_FORMAT }],
          },
          primitive: { topology: "triangle-list" },
        }),
        device.createRenderPipelineAsync({
          layout: "auto",
          vertex: { module: presentModule, entryPoint: "vs" },
          fragment: {
            module: presentModule,
            entryPoint: "fs",
            targets: [{ format: ctx.format }],
          },
          primitive: { topology: "triangle-list" },
        }),
      ]);
    r.pipelineMs = performance.now() - t0;
    return r;
  }

  private computeCascades(params: GIParams): CascadeDesc[] {
    const out: CascadeDesc[] = [];
    for (let i = 0; i < params.cascadeCount; i++) {
      const f = 2 ** i;
      const spacing = params.d0 * f;
      const probesX = Math.max(1, Math.ceil(this.rw / spacing));
      const probesY = Math.max(1, Math.ceil(this.rh / spacing));
      const tileDim = params.baseTile * f;
      const dirCount = tileDim * tileDim;
      const q = 4 ** i;
      const len = params.intervalLen0 * q;
      const start = (params.intervalLen0 * (q - 1)) / 3;
      out.push({
        probesX,
        probesY,
        tileDim,
        dirCount,
        spacing,
        intervalStart: start,
        intervalEnd: start + len,
        texW: probesX * tileDim,
        texH: probesY * tileDim,
        raySteps: clamp(Math.ceil(len / params.stepLen), 4, 64),
      });
    }
    return out;
  }

  private gbuf(w: number, h: number): GPUTexture {
    return this.device.createTexture({
      size: [w, h],
      format: "rgba16float",
      // COPY_SRC: the giDebug probe reads small blocks back to pinpoint which
      // stage goes dark on a misbehaving device (negligible cost otherwise).
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
    });
  }

  private buildSceneBindGroup() {
    this.sceneBindGroup = this.device.createBindGroup({
      layout: this.scenePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.globalsUBO } },
        this.shapesViaTexture
          ? { binding: 1, resource: this.shapeDataTex!.createView() }
          : { binding: 1, resource: { buffer: this.shapeBuffer! } },
        { binding: 2, resource: this.gScene.createView() },
        { binding: 3, resource: this.gAlbedo.createView() },
        { binding: 4, resource: this.gNormal.createView() },
        { binding: 5, resource: this.gDisplay.createView() },
        { binding: 6, resource: this.sampler },
        { binding: 7, resource: this.screenTex.createView() },
      ],
    });
  }

  /** (Re)create the shape texture if the bucketed count changed. Returns true
   *  if recreated (bind group rebuild + full re-upload needed). Bucketing (16)
   *  keeps band-cull count jitter from reallocating every scroll frame; the
   *  padding rows are zero-filled and inert in the shaders. */
  private ensureShapeTex(count: number): boolean {
    if (!this.shapesViaTexture) return false;
    const bucket = Math.min(MAX_SHAPES, Math.max(16, Math.ceil(count / 16) * 16));
    if (this.shapeDataTex && this.shapeDataTex.height === bucket) return false;
    this.shapeDataTex?.destroy();
    this.shapeBuffer?.destroy();
    this.shapeDataTex = this.device.createTexture({
      size: [5, bucket], // 5 rgba32float texels = FLOATS_PER_SHAPE per row
      format: "rgba32float",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    return true;
  }

  private uploadShapes(scene: Scene) {
    const rows = this.shapeDataTex!.height;
    this.device.queue.writeTexture(
      { texture: this.shapeDataTex! },
      scene.data.buffer,
      { offset: scene.data.byteOffset, bytesPerRow: FLOATS_PER_SHAPE * 4, rowsPerImage: rows },
      [5, rows, 1]
    );
  }

  private rebuild(params: GIParams) {
    // Tear down previous size-dependent GPU resources.
    this.gScene?.destroy();
    this.gAlbedo?.destroy();
    this.gNormal?.destroy();
    this.gDisplay?.destroy();
    this.cascades.forEach((t) => t.destroy());
    this.dummyTex?.destroy();
    this.litTex?.destroy();
    this.cascadeUBOs.forEach((b) => b.destroy());

    this.descs = this.computeCascades(params);

    this.gScene = this.gbuf(this.rw, this.rh);
    this.gAlbedo = this.gbuf(this.rw, this.rh);
    this.gNormal = this.gbuf(this.rw, this.rh);
    this.gDisplay = this.gbuf(this.rw, this.rh);

    // Offscreen HDR lighting target at the capped GI resolution; the present
    // pass upscales it to the swapchain, so the heavy shading stays low-res.
    this.litTex = this.device.createTexture({
      size: [this.rw, this.rh],
      format: LIT_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
    });

    this.cascades = this.descs.map((d) => this.gbuf(d.texW, d.texH));
    this.dummyTex = this.gbuf(1, 1);

    this.cascadeUBOs = this.descs.map(() =>
      this.device.createBuffer({
        size: 112,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      })
    );

    // Scene pass bind group (also rebuilt when the shape texture is resized).
    this.ensureShapeTex(16);
    this.buildSceneBindGroup();

    // One cascade bind group per level (out = level i, upper = level i+1).
    this.cascadeBindGroups = this.descs.map((_, i) => {
      const upper = i + 1 < this.cascades.length ? this.cascades[i + 1] : this.dummyTex;
      return this.device.createBindGroup({
        layout: this.cascadePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.cascadeUBOs[i] } },
          { binding: 1, resource: this.sampler },
          { binding: 2, resource: this.gScene.createView() },
          { binding: 3, resource: upper.createView() },
          { binding: 4, resource: this.cascades[i].createView() },
        ],
      });
    });

    // Composite bind group reads cascade 0 + the g-buffers.
    this.compositeBindGroup = this.device.createBindGroup({
      layout: this.compositePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.lightingUBO } },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: this.cascades[0].createView() },
        { binding: 3, resource: this.gAlbedo.createView() },
        { binding: 4, resource: this.gNormal.createView() },
        { binding: 5, resource: this.gScene.createView() },
        { binding: 6, resource: this.gDisplay.createView() },
      ],
    });

    // Present bind group upsamples the HDR target to the swapchain.
    this.presentBindGroup = this.device.createBindGroup({
      layout: this.presentPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.presentUBO } },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: this.litTex.createView() },
      ],
    });
  }

  private writeGlobals(
    scene: Scene,
    params: GIParams,
    bandY0: number,
    bandY1: number,
    px: number,
    scrollY: number,
    screen?: ScreenSource
  ) {
    const g = new Float32Array(24);
    g[0] = this.rw;
    g[1] = this.rh;
    g[2] = 1 / this.rw;
    g[3] = 1 / this.rh;
    g[4] = scene.count;
    g[5] = params.edgeAA * px; // css-authored, like the lighting distances
    g[6] = params.heightScale;
    g[7] = 1.0; // normalEps (render px)
    g[8] = params.rolloff;
    g[9] = params.edgeBias;
    g[10] = bandY0;
    g[11] = bandY1;
    g[12] = scrollY;
    // screen rect (content render px) at std140 offset 64 = floats 16..19
    if (screen) {
      g[16] = screen.x * px;
      g[17] = screen.y * px;
      g[18] = (screen.x + screen.w) * px;
      g[19] = (screen.y + screen.h) * px;
      g[20] = screen.emit;
      g[21] = screen.display;
      g[22] = screen.topFade ?? 0;
      g[23] = screen.topFadeH ?? 0.4;
    } else {
      g[16] = 0;
      g[18] = -1; // x1 <= x0 disables
    }
    this.device.queue.writeBuffer(this.globalsUBO, 0, g);
  }

  private writeCascadeUBO(i: number, params: GIParams, bandY0: number, bandY1: number, scrollY: number) {
    const d = this.descs[i];
    const up = this.descs[i + 1];
    const isTop = i + 1 >= this.descs.length;
    const u = new Float32Array(28);
    u[0] = d.probesX;
    u[1] = d.probesY;
    u[2] = up ? up.probesX : 1;
    u[3] = up ? up.probesY : 1;
    u[4] = d.tileDim;
    u[5] = up ? up.tileDim : 1;
    u[6] = d.dirCount;
    u[7] = up ? up.dirCount : 1;
    u[8] = d.spacing;
    u[9] = up ? up.spacing : d.spacing * 2;
    u[10] = d.intervalStart;
    u[11] = d.intervalEnd;
    u[12] = d.texW;
    u[13] = d.texH;
    u[14] = up ? up.texW : 1;
    u[15] = up ? up.texH : 1;
    u[16] = this.rw;
    u[17] = this.rh;
    u[18] = d.raySteps;
    u[19] = isTop ? 1 : 0;
    u[20] = params.skyColor[0];
    u[21] = params.skyColor[1];
    u[22] = params.skyColor[2];
    u[23] = params.skyStrength;
    u[24] = params.occlusion;
    u[25] = scrollY; // was std140 pad — content offset for probe-grid anchoring
    u[26] = bandY0;
    u[27] = bandY1;
    this.device.queue.writeBuffer(this.cascadeUBOs[i], 0, u);
  }

  // `px` converts css px -> render px. Distance-valued lighting params (AO
  // radius, shadow reach, GI blur, texture grain size) are authored in css px
  // and scaled here, so the LOOK is identical at every render resolution —
  // before this, dropping the adaptive scale visibly loosened/lightened the
  // AO and shadows, and the restore back to full res read as a "darkening pass".
  private writeLighting(params: GIParams, px: number, scrollY: number) {
    const d0 = this.descs[0];
    const l = new Float32Array(48);
    l[0] = this.rw;
    l[1] = this.rh;
    l[2] = d0.probesX;
    l[3] = d0.probesY;
    l[4] = d0.tileDim;
    l[5] = d0.dirCount;
    l[6] = d0.spacing;
    l[7] = d0.texW;
    l[8] = d0.texH;
    l[9] = params.normalStrength;
    l[10] = params.giStrength;
    l[11] = params.ambient;
    l[12] = params.exposure;
    l[13] = params.keyIntensity;
    l[14] = this.ctx.encodeSrgb ? 1 : 0;
    l[15] = params.debugMode;
    l[16] = params.keyDir[0];
    l[17] = params.keyDir[1];
    l[18] = params.keyDir[2];
    l[19] = params.tintAmount;
    l[20] = params.keyColor[0];
    l[21] = params.keyColor[1];
    l[22] = params.keyColor[2];
    l[23] = params.giDirectional;
    l[24] = params.material[0];
    l[25] = params.material[1];
    l[26] = params.material[2];
    l[27] = params.emissiveDisplay;
    l[28] = params.giSmooth * px;
    l[29] = params.grain;
    l[30] = params.giBackground;
    l[31] = params.fillIntensity;
    l[32] = params.fillDir[0];
    l[33] = params.fillDir[1];
    l[34] = params.fillDir[2];
    l[35] = params.aoStrength;
    l[36] = params.fillColor[0];
    l[37] = params.fillColor[1];
    l[38] = params.fillColor[2];
    l[39] = params.aoRadius * px;
    l[40] = params.shadowStrength;
    l[41] = params.shadowLength * px;
    l[42] = params.shadowHeight * px;
    l[43] = params.shadowSoftness;
    l[44] = params.surfaceTexture;
    l[45] = params.textureScale * px;
    // Content offset (render px): anchors the composite's stochastic patterns
    // (micro-texture noise, gather/AO dither) to CONTENT rather than the
    // viewport-fixed canvas, so lighting doesn't crawl over components on scroll.
    l[46] = scrollY;
    this.device.queue.writeBuffer(this.lightingUBO, 0, l);

    const p = new Float32Array(4);
    p[0] = params.exposure;
    p[1] = params.grain;
    p[2] = this.ctx.encodeSrgb ? 1 : 0;
    this.device.queue.writeBuffer(this.presentUBO, 0, p);
  }

  private lastOffset = -1;

  render(
    scene: Scene,
    params: GIParams,
    dpr: number,
    qualityScale = 1,
    region?: { top: number; height: number },
    mode: "page" | "viewport" = "page",
    screen?: ScreenSource
  ) {
    const canvas = this.ctx.context.canvas as HTMLCanvasElement;
    const cw = Math.max(1, canvas.width);
    const ch = Math.max(1, canvas.height);
    let rw = Math.max(1, Math.round(cw * params.renderScale * qualityScale));
    let rh = Math.max(1, Math.round(ch * params.renderScale * qualityScale));

    // Cap the GI resolution: the radiance field is low-frequency, so we compute
    // it small and let the composite upscale it. This decouples cost from dpr.
    // Cap the horizontal render density to `cap` (and let height scale with it),
    // rather than capping the LONGEST side. The canvas spans the full page
    // height so it can scroll natively; a longest-side cap would squash a tall
    // page's resolution far below the display and make bright emitters bloom
    // into blown-out halos (badly so on hi-dpi). Capping width keeps the same
    // sharpness as a viewport-sized page regardless of page length or dpr; the
    // AABB cull keeps the extra (mostly empty) height cheap.
    const cap = Math.max(64, params.maxResolution);
    if (rw > cap) {
      const s = cap / rw;
      rw = Math.max(1, Math.round(rw * s));
      rh = Math.max(1, Math.round(rh * s));
    }
    // Safety bound for a pathologically long page so cost can't run away.
    const rhMax = cap * 4;
    if (rh > rhMax) {
      const s = rhMax / rh;
      rw = Math.max(1, Math.round(rw * s));
      rh = Math.max(1, Math.round(rh * s));
    }

    const sig = `${rw}x${rh}|d0=${params.d0}|tile=${params.baseTile}|n=${params.cascadeCount}`;
    let rebuilt = false;
    if (sig !== this.signature) {
      this.rw = rw;
      this.rh = rh;
      this.rebuild(params);
      this.signature = sig;
      rebuilt = true;
      this.fullRendered = false; // fresh litTex — must composite the whole thing
    }

    // Upload shapes (css px -> render px) only when the data or scale changed.
    const cssWidth = cw / dpr;
    const scale = rw / cssWidth;
    let scaleChanged = false;
    if (scale !== this.lastScale) {
      scene.markDirty();
      this.lastScale = scale;
      scaleChanged = true;
    }
    // A structural change (a shape added/removed — e.g. a menu/dialog opening, a
    // component mounting) can affect lighting anywhere, so the whole litTex must
    // be re-composited. A plain update (drag, hover, animation frame) only needs
    // the visible band re-shaded (see below).
    const structural = scene.consumeStructural();
    // Viewport mode: the (small, fixed) canvas shows the content slice at the
    // scroll offset; a changed offset means every pixel shows different content,
    // so the whole (viewport-sized, cheap) target re-renders.
    // FRACTIONAL, deliberately: rounding to integer render px made the light
    // field move in >1 css-px quanta whenever the GI renders below css
    // resolution (maxResolution cap on wide/hi-dpi windows) — DOM text scrolls
    // continuously while its lighting stepped, reading as text "slipping off"
    // its component. The SDF scene evaluates exactly at fractional offsets and
    // scroll always forces a full re-render, so nothing needs integer alignment.
    const scrollY = mode === "viewport" && region ? region.top * scale : 0;
    const offsetChanged = scrollY !== this.lastOffset;
    this.lastOffset = scrollY;
    const fullComposite =
      structural || rebuilt || scaleChanged || !this.fullRendered || !region || offsetChanged;

    // Visible band in render px (texture rows). On a full render it's the whole
    // target; otherwise only this slice is re-shaded (rest preserved), so
    // per-frame GI cost is bounded by the viewport, not the page height.
    let bandY0 = 0;
    let bandY1 = this.rh;
    if (!fullComposite && region && mode === "page") {
      bandY0 = Math.max(0, Math.floor(region.top * scale) - 1);
      bandY1 = Math.min(this.rh, Math.ceil((region.top + region.height) * scale) + 1);
    }
    // css-px cull window for the shape list: only shapes near the visible
    // content slice matter. Quantized to a 128px grid so the pack key stays
    // stable across small scrolls; the 256px pad covers the widened scene band
    // (+128 render px) + bevel margins.
    let cullTop = -Infinity;
    let cullBot = Infinity;
    if (region) {
      cullTop = Math.floor((region.top - 256) / 128) * 128;
      cullBot = Math.ceil((region.top + region.height + 256) / 128) * 128;
    }
    {
      const packChanged = scene.pack(scale, cullTop, cullBot);
      if (this.shapesViaTexture) {
        const recreated = this.ensureShapeTex(scene.count);
        if (recreated) this.buildSceneBindGroup();
        if (packChanged || recreated) this.uploadShapes(scene);
      } else if (packChanged) {
        this.device.queue.writeBuffer(this.shapeBuffer!, 0, scene.data);
      }
    }

    // Scene writes a slightly wider band than the composite reads, so shapes
    // just past the viewport edge (e.g. a light dragged off-screen) stay fresh
    // where the cascades' +64px sampling margin can see them.
    // Upload this frame's screen picture (fixed-size copy, ~64KB — trivial).
    if (screen) {
      this.device.queue.copyExternalImageToTexture(
        { source: screen.source },
        { texture: this.screenTex },
        [SCREEN_TEX_W, SCREEN_TEX_H]
      );
    }

    this.writeGlobals(
      scene,
      params,
      Math.max(0, bandY0 - 128),
      Math.min(this.rh, bandY1 + 128),
      scale,
      scrollY,
      screen
    );
    for (let i = 0; i < this.descs.length; i++) this.writeCascadeUBO(i, params, bandY0, bandY1, scrollY);
    this.writeLighting(params, scale, scrollY);

    const enc = this.device.createCommandEncoder();

    // 1) Scene / g-buffer.
    {
      const pass = enc.beginComputePass();
      pass.setPipeline(this.scenePipeline);
      pass.setBindGroup(0, this.sceneBindGroup);
      pass.dispatchWorkgroups(Math.ceil(this.rw / 8), Math.ceil(this.rh / 8));
      pass.end();
    }

    // 2) Radiance cascades, top-down so each level can merge the one above it.
    for (let i = this.descs.length - 1; i >= 0; i--) {
      const d = this.descs[i];
      const pass = enc.beginComputePass();
      pass.setPipeline(this.cascadePipeline);
      pass.setBindGroup(0, this.cascadeBindGroups[i]);
      pass.dispatchWorkgroups(Math.ceil(d.texW / 8), Math.ceil(d.texH / 8));
      pass.end();
    }

    // 3) Composite the lighting into the offscreen HDR target (capped res).
    // This is the dominant per-pixel pass (GI gather + shadows + AO). The canvas
    // spans the whole page, but only the visible band changes frame-to-frame
    // (off-screen content is static), so on a plain update we scissor to the
    // visible band and PRESERVE the rest of litTex (loadOp:"load"). A full
    // composite (clear) runs on structural change / resize / first frame.
    {
      const pass = enc.beginRenderPass({
        colorAttachments: [
          {
            view: this.litTex.createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: fullComposite ? "clear" : "load",
            storeOp: "store",
          },
        ],
      });
      pass.setPipeline(this.compositePipeline);
      pass.setBindGroup(0, this.compositeBindGroup);
      if (!fullComposite && bandY1 > bandY0) {
        pass.setScissorRect(0, bandY0, this.rw, bandY1 - bandY0);
      }
      pass.draw(3);
      pass.end();
      if (fullComposite) this.fullRendered = true;
    }

    // 4) Present: upscale + tonemap + grain to the swapchain (full res, cheap).
    {
      const view = this.ctx.context.getCurrentTexture().createView();
      const pass = enc.beginRenderPass({
        colorAttachments: [
          {
            view,
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: "clear",
            storeOp: "store",
          },
        ],
      });
      pass.setPipeline(this.presentPipeline);
      pass.setBindGroup(0, this.presentBindGroup);
      pass.draw(3);
      pass.end();
    }

    this.device.queue.submit([enc.finish()]);
  }

  /** giDebug deep probe: read back small center blocks of each stage and
   *  report their max magnitude — trisects "which pass goes dark" on devices
   *  where the page renders black despite a clean init. */
  async probe(): Promise<string> {
    const f16 = (h: number) => {
      const s = (h & 0x8000) >> 15;
      const e = (h & 0x7c00) >> 10;
      const f = h & 0x03ff;
      if (e === 0) return (s ? -1 : 1) * Math.pow(2, -14) * (f / 1024);
      if (e === 0x1f) return f ? NaN : (s ? -Infinity : Infinity);
      return (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + f / 1024);
    };
    const stages: [string, GPUTexture][] = [
      ["scene", this.gScene],
      ["nrm", this.gNormal],
      ["casc0", this.cascades[0]],
      ["lit", this.litTex],
    ];
    const out: string[] = [];
    for (const [name, tex] of stages) {
      try {
        const x = Math.max(0, (tex.width >> 1) - 4);
        const y = Math.max(0, (tex.height >> 1) - 4);
        const buf = this.device.createBuffer({
          size: 256 * 8,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
        const enc = this.device.createCommandEncoder();
        enc.copyTextureToBuffer(
          { texture: tex, origin: { x, y } },
          { buffer: buf, bytesPerRow: 256, rowsPerImage: 8 },
          { width: 8, height: 8 }
        );
        this.device.queue.submit([enc.finish()]);
        await buf.mapAsync(GPUMapMode.READ);
        const u16 = new Uint16Array(buf.getMappedRange());
        // Per-channel maxes — alpha is often a constant 1 (coverage/transmit)
        // and must not mask an all-zero rgb.
        const m = [0, 0, 0, 0];
        for (let r = 0; r < 8; r++) {
          for (let c = 0; c < 32; c++) {
            const v = f16(u16[r * 128 + c]);
            if (Number.isFinite(v)) m[c % 4] = Math.max(m[c % 4], Math.abs(v));
          }
        }
        buf.unmap();
        buf.destroy();
        const rgb = Math.max(m[0], m[1], m[2]);
        out.push(`${name}=${rgb.toFixed(2)}/${m[3].toFixed(2)}`);
      } catch (e) {
        out.push(`${name}=ERR(${String(e).slice(0, 40)})`);
      }
    }
    return out.join(" ");
  }

  destroy() {
    this.gScene?.destroy();
    this.gAlbedo?.destroy();
    this.gNormal?.destroy();
    this.gDisplay?.destroy();
    this.cascades.forEach((t) => t.destroy());
    this.dummyTex?.destroy();
    this.litTex?.destroy();
    this.cascadeUBOs.forEach((b) => b.destroy());
    this.shapeDataTex?.destroy();
    this.shapeBuffer?.destroy();
    this.globalsUBO.destroy();
    this.lightingUBO.destroy();
    this.presentUBO.destroy();
    this.screenTex?.destroy();
  }
}
