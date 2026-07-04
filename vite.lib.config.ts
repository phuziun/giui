import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Library build (`npm run build:lib`): bundles src/lib.ts (engine + kit,
// WGSL inlined via ?raw) into dist-lib/, React externalized. The demo site
// uses vite.config.ts; this config exists so the package can ship without
// the demo. Types come from `tsc -p tsconfig.lib.json` (same script).
export default defineConfig({
  plugins: [react()],
  publicDir: false, // demo favicons don't belong in the package
  build: {
    outDir: "dist-lib",
    sourcemap: true,
    lib: {
      entry: "src/lib.ts",
      formats: ["es"],
      fileName: "giui",
      cssFileName: "style",
    },
    rollupOptions: {
      external: ["react", "react-dom", "react/jsx-runtime", "react-dom/client"],
    },
  },
});
