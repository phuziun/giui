(async () => {
  const out = {};
  try {
    const adapter = await navigator.gpu.requestAdapter();
    const device = await adapter.requestDevice();
    device.onuncapturederror = (e) => { out.gpuError = (out.gpuError || "") + "|" + e.error.message.slice(0, 150); };

    const readTex = async (tex) => {
      const mod = device.createShaderModule({ code: `
        @group(0) @binding(0) var img: texture_2d<f32>;
        @group(0) @binding(1) var<storage, read_write> o: array<f32>;
        @compute @workgroup_size(1) fn main() {
          let v = textureLoad(img, vec2<i32>(2, 2), 0);
          o[0] = v.x; o[1] = v.y; o[2] = v.z; o[3] = v.w;
        }` });
      const pipe = device.createComputePipeline({ layout: "auto", compute: { module: mod } });
      const ob = device.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
      const bg = device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [
        { binding: 0, resource: tex.createView() }, { binding: 1, resource: { buffer: ob } }] });
      const rb = device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const enc = device.createCommandEncoder();
      const p = enc.beginComputePass(); p.setPipeline(pipe); p.setBindGroup(0, bg); p.dispatchWorkgroups(1); p.end();
      enc.copyBufferToBuffer(ob, 0, rb, 0, 16);
      device.queue.submit([enc.finish()]);
      await rb.mapAsync(GPUMapMode.READ);
      return Array.from(new Float32Array(rb.getMappedRange())).map((x) => Math.round(x * 1000) / 1000);
    };

    const runDraw = async (vsCode, useVB, drawCount) => {
      const code = `${vsCode}
        @fragment fn fs() -> @location(0) vec4<f32> { return vec4(0.9, 0.8, 0.7, 0.6); }`;
      const mod = device.createShaderModule({ code });
      const pipe = device.createRenderPipeline({
        layout: "auto",
        vertex: useVB
          ? { module: mod, buffers: [{ arrayStride: 8, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }] }] }
          : { module: mod },
        fragment: { module: mod, targets: [{ format: "rgba16float" }] },
        primitive: { topology: "triangle-list" },
      });
      const tex = device.createTexture({ size: [4, 4], format: "rgba16float",
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
      const enc = device.createCommandEncoder();
      const p = enc.beginRenderPass({ colorAttachments: [{ view: tex.createView(),
        loadOp: "clear", storeOp: "store", clearValue: { r: 0.1, g: 0.1, b: 0.1, a: 0.1 } }] });
      p.setPipeline(pipe);
      if (useVB) {
        const vb = device.createBuffer({ size: 8 * drawCount, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
        device.queue.writeBuffer(vb, 0, drawCount === 3
          ? new Float32Array([-1, -3, 3, 1, -1, 1])
          : new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]));
        p.setVertexBuffer(0, vb);
      }
      p.draw(drawCount); p.end();
      device.queue.submit([enc.finish()]);
      return readTex(tex);
    };

    // A: vertex_index array, exact quad (6 verts, no buffer)
    out.viQuad = await runDraw(`
      @vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
        var p = array<vec2<f32>, 6>(vec2(-1.0,-1.0), vec2(1.0,-1.0), vec2(1.0,1.0), vec2(-1.0,-1.0), vec2(1.0,1.0), vec2(-1.0,1.0));
        return vec4(p[i], 0.0, 1.0);
      }`, false, 6);

    // B: vertex buffer, oversized triangle (3 verts)
    out.vbBigTri = await runDraw(`
      @vertex fn vs(@location(0) pos: vec2<f32>) -> @builtin(position) vec4<f32> {
        return vec4(pos, 0.0, 1.0);
      }`, true, 3);

    // C: vertex_index but positions from if/else chain (no array indexing)
    out.viBranch = await runDraw(`
      @vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
        var p: vec2<f32>;
        if (i == 0u) { p = vec2(-1.0, -3.0); } else if (i == 1u) { p = vec2(3.0, 1.0); } else { p = vec2(-1.0, 1.0); }
        return vec4(p, 0.0, 1.0);
      }`, false, 3);

    // D: vertex_index bit-trick fullscreen triangle (no array, no branch)
    out.viBitTrick = await runDraw(`
      @vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
        let x = f32(i32(i & 1u) * 4 - 1);
        let y = f32(i32(i >> 1u) * 4 - 1);
        return vec4(x, y, 0.0, 1.0);
      }`, false, 3);

    device.destroy();
  } catch (e) {
    out.exception = String(e).slice(0, 300);
  }
  return JSON.stringify(out);
})()
