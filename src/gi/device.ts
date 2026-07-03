// WebGPU device acquisition with a friendly failure path.

export type GPUContext = {
  device: GPUDevice;
  context: GPUCanvasContext;
  format: GPUTextureFormat;
  encodeSrgb: boolean;
  gpuName: string; // adapter vendor/architecture, for diagnostics
  softwareGPU: boolean; // true = CPU rasterizer fallback (SwiftShader etc.) — expect slowness
};

export async function initWebGPU(canvas: HTMLCanvasElement): Promise<GPUContext> {
  if (!("gpu" in navigator)) {
    throw new Error(
      "WebGPU is not available in this browser. Try the latest Chrome, Edge, or Safari Technology Preview."
    );
  }
  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: "high-performance",
  });
  if (!adapter) {
    throw new Error("No suitable GPU adapter found for WebGPU.");
  }
  const device = await adapter.requestDevice();

  const context = canvas.getContext("webgpu");
  if (!context) {
    throw new Error("Failed to acquire a WebGPU canvas context.");
  }

  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({
    device,
    format,
    alphaMode: "opaque",
  });

  // If the swapchain format already encodes sRGB, the GPU handles the transfer
  // function and the shader must output linear; otherwise we encode in-shader.
  const encodeSrgb = !format.endsWith("srgb");

  // Identify the adapter: if the browser fell back to a software rasterizer
  // (hardware acceleration disabled, driver blocklist, virtualized GPU), no
  // amount of in-app optimization will feel fast — surface it loudly instead.
  const info = adapter.info;
  const gpuName = [info?.vendor, info?.architecture, info?.description]
    .filter(Boolean)
    .join(" ")
    .trim() || "unknown";
  const softwareGPU = /swiftshader|llvmpipe|software|basic render/i.test(gpuName);
  if (softwareGPU) {
    console.warn(
      `[giui] WebGPU is running on a SOFTWARE rasterizer (${gpuName}). ` +
        `Check chrome://settings/system → "Use graphics acceleration" and chrome://gpu.`
    );
  }

  return { device, context, format, encodeSrgb, gpuName, softwareGPU };
}
