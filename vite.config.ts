import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// Dev-only diagnostics sink: the app POSTs live perf snapshots (fps, GPU,
// build stamp, canvas size) here from WHATEVER tab is viewing it, and they are
// appended to .giui-diag.jsonl in the project root. This closes the gap
// between "measured fast in a test browser" and "feels slow in the real one" —
// the real tab reports its own numbers.
function diagSink(): Plugin {
  const file = join(process.cwd(), ".giui-diag.jsonl");
  return {
    name: "giui-diag-sink",
    configureServer(server) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dev-only sink
      server.middlewares.use("/__giui-diag", (req: any, res: any) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end();
          return;
        }
        let body = "";
        req.on("data", (c: string) => (body += c));
        req.on("end", () => {
          try {
            appendFileSync(file, body.trim() + "\n");
          } catch {
            /* ignore */
          }
          res.statusCode = 204;
          res.end();
        });
      });
    },
  };
}

// WGSL shaders are imported as raw strings.
export default defineConfig(({ command }) => ({
  // GitHub Pages serves a project site under /<repo>/, so the production build
  // needs base "/giui/". Dev (serve) stays at "/" so the local server and the
  // headless verification tooling keep hitting http://localhost:5174/ . Override
  // with VITE_BASE (e.g. "/" if you later point a custom domain at the apex).
  base: process.env.VITE_BASE ?? (command === "build" ? "/giui/" : "/"),
  plugins: [react(), diagSink()],
  assetsInclude: ["**/*.wgsl"],
}));
