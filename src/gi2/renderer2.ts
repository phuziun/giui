// GI-Lite renderer — see shaders/lite.wgsl for the architecture rationale.
// Reuses the engine's device init and Scene (shape store/pack); everything
// else is new: 3 tiny compute passes + one analytic present pass.

import type { GPUContext } from "../gi/device";
import type { Scene } from "../gi/scene";
import liteSrc from "./shaders/lite.wgsl?raw";

export type Gi2Params = {
  // transport
  probeSpacing: number; // css px between probes
  rayCount: number;
  raySteps: number;
  rayMax: number; // css px
  loDown: number; // emission raster downscale (css px per texel)
  occlusion: number;
  giProbeLift: number; // calibration vs the cascade engine's gather
  // look (defaults mirror DEFAULT_PARAMS)
  ambient: number;
  keyIntensity: number;
  keyDir: [number, number, number];
  keyColor: [number, number, number];
  fillDir: [number, number, number];
  fillColor: [number, number, number];
  fillIntensity: number;
  material: [number, number, number];
  tintAmount: number;
  emissiveDisplay: number;
  normalStrength: number;
  heightScale: number;
  rolloff: number;
  edgeBias: number;
  edgeAA: number;
  giStrength: number;
  giDirectional: number;
  giBackground: number;
  aoStrength: number;
  aoRadius: number;
  shadowStrength: number;
  shadowScale: number; // shadow offset px per height unit
  shadowSoftness: number;
  exposure: number;
  grain: number;
  surfaceTexture: number;
  textureScale: number;
};

export const GI2_DEFAULTS: Gi2Params = {
  probeSpacing: 16,
  rayCount: 20,
  raySteps: 28,
  rayMax: 380,
  loDown: 6,
  occlusion: 0.2,
  giProbeLift: 0.8,
  ambient: 0.24,
  keyIntensity: 0.41,
  keyDir: [-0.45, -0.6, 0.66],
  keyColor: [0.7379, 0.7913, 1.0],
  fillDir: [0.5, 0.62, 0.6],
  fillColor: [0.0123, 0.0467, 0.2384],
  fillIntensity: 1,
  material: [0.0395, 0.0467, 0.0595],
  tintAmount: 0.65,
  emissiveDisplay: 0.45,
  normalStrength: 3,
  heightScale: 1.3,
  rolloff: 0.75,
  edgeBias: 0.65,
  edgeAA: 1.25,
  giStrength: 1.05,
  giDirectional: 4,
  giBackground: 0.14,
  aoStrength: 0.8,
  aoRadius: 7,
  shadowStrength: 1.1,
  shadowScale: 26, // ≈ shadowLength/height feel of the cascade engine
  shadowSoftness: 0.5,
  exposure: 0.9,
  grain: 0.02,
  surfaceTexture: 0.32,
  textureScale: 2.5,
};

const TILE = 32; // device px
const TILE_SLOTS = 24; // 1 count + 23 indices (matches TILE_CAP in WGSL)
const MAX_SHAPES = 256;
const FLOATS_PER_SHAPE = 20;

export class Renderer2 {
  private ctx: GPUContext;
  private emitPipe!: GPUComputePipeline;
  private probePipe!: GPUComputePipeline;
  private tilePipe!: GPUComputePipeline;
  private presentPipe!: GPURenderPipeline;
  private ubo!: GPUBuffer;
  private shapeBuf!: GPUBuffer;
  private tileBuf!: GPUBuffer;
  private emitTex!: GPUTexture;
  private chTex: GPUTexture[] = [];
  private sampler!: GPUSampler;
  private groups: Record<string, GPUBindGroup> = {};
  private sized = { cssW: 0, cssH: 0, outW: 0, outH: 0 };
  private uarr = new Float32Array(64);
  pipelineMs = 0;

  private constructor(ctx: GPUContext) {
    this.ctx = ctx;
  }

  static async create(ctx: GPUContext): Promise<Renderer2> {
    const r = new Renderer2(ctx);
    const t0 = performance.now();
    const mod = ctx.device.createShaderModule({ code: liteSrc });
    const [emitPipe, probePipe, tilePipe, presentPipe] = await Promise.all([
      ctx.device.createComputePipelineAsync({ layout: "auto", compute: { module: mod, entryPoint: "emitCS" } }),
      ctx.device.createComputePipelineAsync({ layout: "auto", compute: { module: mod, entryPoint: "probeCS" } }),
      ctx.device.createComputePipelineAsync({ layout: "auto", compute: { module: mod, entryPoint: "tileCS" } }),
      ctx.device.createRenderPipelineAsync({
        layout: "auto",
        vertex: { module: mod, entryPoint: "vs" },
        fragment: { module: mod, entryPoint: "fs", targets: [{ format: ctx.format }] },
        primitive: { topology: "triangle-list" },
      }),
    ]);
    r.emitPipe = emitPipe;
    r.probePipe = probePipe;
    r.tilePipe = tilePipe;
    r.presentPipe = presentPipe;
    r.pipelineMs = performance.now() - t0;
    r.ubo = ctx.device.createBuffer({ size: 64 * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    r.shapeBuf = ctx.device.createBuffer({
      size: MAX_SHAPES * FLOATS_PER_SHAPE * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    r.sampler = ctx.device.createSampler({ magFilter: "linear", minFilter: "linear" });
    return r;
  }

  private resize(cssW: number, cssH: number, outW: number, outH: number, p: Gi2Params) {
    const s = this.sized;
    if (s.cssW === cssW && s.cssH === cssH && s.outW === outW && s.outH === outH) return;
    Object.assign(s, { cssW, cssH, outW, outH });
    const dev = this.ctx.device;
    this.emitTex?.destroy();
    this.chTex.forEach((t) => t.destroy());
    const loW = Math.max(8, Math.ceil(cssW / p.loDown));
    const loH = Math.max(8, Math.ceil(cssH / p.loDown));
    this.emitTex = dev.createTexture({
      size: [loW, loH],
      format: "rgba16float",
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    });
    const px = Math.max(2, Math.ceil(cssW / p.probeSpacing));
    const py = Math.max(2, Math.ceil(cssH / p.probeSpacing));
    this.chTex = [0, 1, 2].map(() =>
      dev.createTexture({
        size: [px, py],
        format: "rgba16float",
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
      })
    );
    const tilesX = Math.ceil(outW / TILE);
    const tilesY = Math.ceil(outH / TILE);
    this.tileBuf?.destroy();
    this.tileBuf = dev.createBuffer({
      size: tilesX * tilesY * TILE_SLOTS * 4,
      usage: GPUBufferUsage.STORAGE,
    });

    // Bind groups (auto layouts include only the bindings each stage uses).
    this.groups = {
      emit0: dev.createBindGroup({
        layout: this.emitPipe.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.ubo } },
          { binding: 1, resource: { buffer: this.shapeBuf } },
        ],
      }),
      emit1: dev.createBindGroup({
        layout: this.emitPipe.getBindGroupLayout(1),
        entries: [{ binding: 0, resource: this.emitTex.createView() }],
      }),
      probe0: dev.createBindGroup({
        layout: this.probePipe.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.ubo } },
          { binding: 2, resource: this.sampler },
        ],
      }),
      probe2: dev.createBindGroup({
        layout: this.probePipe.getBindGroupLayout(2),
        entries: [
          { binding: 0, resource: this.emitTex.createView() },
          { binding: 1, resource: this.chTex[0].createView() },
          { binding: 2, resource: this.chTex[1].createView() },
          { binding: 3, resource: this.chTex[2].createView() },
        ],
      }),
      tile0: dev.createBindGroup({
        layout: this.tilePipe.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.ubo } },
          { binding: 1, resource: { buffer: this.shapeBuf } },
        ],
      }),
      tile3: dev.createBindGroup({
        layout: this.tilePipe.getBindGroupLayout(3),
        entries: [{ binding: 0, resource: { buffer: this.tileBuf } }],
      }),
      pres0: dev.createBindGroup({
        layout: this.presentPipe.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.ubo } },
          { binding: 1, resource: { buffer: this.shapeBuf } },
          { binding: 2, resource: this.sampler },
        ],
      }),
      pres1: dev.createBindGroup({
        layout: this.presentPipe.getBindGroupLayout(1),
        entries: [
          { binding: 1, resource: this.chTex[0].createView() },
          { binding: 2, resource: this.chTex[1].createView() },
          { binding: 3, resource: this.chTex[2].createView() },
          { binding: 4, resource: { buffer: this.tileBuf } },
        ],
      }),
    };
  }

  /** cssW/cssH = board css size; the canvas backing store is outW×outH. */
  render(scene: Scene, p: Gi2Params, cssW: number, cssH: number, dpr: number) {
    const dev = this.ctx.device;
    const canvasTex = this.ctx.context.getCurrentTexture();
    const outW = canvasTex.width;
    const outH = canvasTex.height;
    this.resize(cssW, cssH, outW, outH, p);

    // Shapes in css units (scale = 1).
    scene.pack(1);
    const count = Math.min(scene.count, MAX_SHAPES);
    dev.queue.writeBuffer(this.shapeBuf, 0, scene.data.buffer, scene.data.byteOffset, count * FLOATS_PER_SHAPE * 4);

    const loW = this.emitTex.width;
    const loH = this.emitTex.height;
    const px = this.chTex[0].width;
    const py = this.chTex[0].height;
    const tilesX = Math.ceil(outW / TILE);
    const tilesY = Math.ceil(outH / TILE);

    const u = this.uarr;
    u.set([cssW, cssH, loW, loH, px, py, outW, outH], 0);
    u.set([dpr, count, p.probeSpacing, p.rayCount, p.raySteps, p.rayMax, p.occlusion, p.edgeAA], 8);
    u.set([p.ambient, p.keyIntensity, p.normalStrength, p.heightScale], 16);
    u.set([...p.keyDir, p.rolloff], 20);
    u.set([...p.keyColor, p.edgeBias], 24);
    u.set([...p.fillDir, p.fillIntensity], 28);
    u.set([...p.fillColor, p.tintAmount], 32);
    u.set([...p.material, p.emissiveDisplay], 36);
    u.set([p.giStrength, p.giDirectional, p.giBackground, p.giProbeLift], 40);
    u.set([p.aoStrength, p.aoRadius, p.shadowStrength, p.shadowScale], 44);
    u.set([p.shadowSoftness, p.exposure, p.grain, this.ctx.encodeSrgb ? 1 : 0], 48);
    u.set([p.surfaceTexture, p.textureScale, tilesX, TILE], 52);
    dev.queue.writeBuffer(this.ubo, 0, u.buffer, 0, 64 * 4);

    const enc = dev.createCommandEncoder();
    {
      const c = enc.beginComputePass();
      c.setPipeline(this.emitPipe);
      c.setBindGroup(0, this.groups.emit0);
      c.setBindGroup(1, this.groups.emit1);
      c.dispatchWorkgroups(Math.ceil(loW / 8), Math.ceil(loH / 8));
      c.setPipeline(this.probePipe);
      c.setBindGroup(0, this.groups.probe0);
      c.setBindGroup(2, this.groups.probe2);
      c.dispatchWorkgroups(Math.ceil(px / 8), Math.ceil(py / 8));
      c.setPipeline(this.tilePipe);
      c.setBindGroup(0, this.groups.tile0);
      c.setBindGroup(3, this.groups.tile3);
      c.dispatchWorkgroups(Math.ceil(tilesX / 8), Math.ceil(tilesY / 8));
      c.end();
    }
    {
      const r = enc.beginRenderPass({
        colorAttachments: [
          { view: canvasTex.createView(), loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 } },
        ],
      });
      r.setPipeline(this.presentPipe);
      r.setBindGroup(0, this.groups.pres0);
      r.setBindGroup(1, this.groups.pres1);
      r.draw(3);
      r.end();
    }
    dev.queue.submit([enc.finish()]);
  }

  destroy() {
    this.emitTex?.destroy();
    this.chTex.forEach((t) => t.destroy());
    this.tileBuf?.destroy();
    this.shapeBuf?.destroy();
    this.ubo?.destroy();
  }
}
