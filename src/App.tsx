import { useEffect, useMemo, useRef, useState } from "react";
import { useControls, folder, Leva } from "leva";
import { GIProvider, QUALITY_PRESETS, type GIQuality } from "./gi/GIProvider";
import { DEFAULT_PARAMS, type GIParams } from "./gi/types";
import {
  GIBadge,
  GIButton,
  GICheckbox,
  GIDots,
  GIField,
  GILight,
  GIProgress,
  GIRating,
  GISegmented,
  GISlider,
  GIStat,
  GITag,
  GIToast,
  GIToggle,
  Surface,
} from "./components";
import { useGIShape } from "./gi/useGIShape";
import { useGITheme } from "./gi/GIProvider";
import { Zoo } from "./components/Zoo";
import { Templates } from "./components/Templates";
import { Landing, NavGlow, hslToLinear } from "./components/Landing";
import { Docs } from "./components/docs/Docs";

type Vec3 = [number, number, number];

// Shared accent hue for all interactive controls (the "Save" cerulean).

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function hexToLinear(hex: string): Vec3 {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)];
}

// --- preset persistence ----------------------------------------------------

const LAST_KEY = "giui:last";
const PRESETS_KEY = "giui:presets";

type Dict = Record<string, unknown>;
function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function saveJSON(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore quota / privacy-mode errors */
  }
}

// Bump when default params change in a way that could make an old saved state
// look broken; stale states are then discarded instead of overriding new defaults.
const SCHEMA_VERSION = 15;

// Saved control values from the previous session, used to seed the panel so it
// doesn't reset on reload -- but only if they match the current schema version.
// Light positions are kept across version bumps (they don't conflict with new
// default tuning), so a defaults change doesn't scatter the lights.
type Pos = { x: number; y: number };
const STORED = loadJSON<{ version?: number; values?: Dict; lights?: Pos[] } | null>(LAST_KEY, null);
const VALID = STORED && STORED.version === SCHEMA_VERSION;
const SAVED = VALID ? STORED!.values ?? null : null;
const SAVED_LIGHTS = STORED ? STORED.lights ?? null : null;
const seed = <T,>(key: string, def: T): T =>
  SAVED && key in SAVED ? (SAVED[key] as T) : def;

const D = DEFAULT_PARAMS;

function useStudio() {
  const [v, set] = useControls(() => ({
    Render: folder(
      {
        // One quality dial that co-tunes maxResolution/cascades/rays. Picking a
        // preset overwrites those sliders; tweaking them after is "custom".
        quality: { value: seed("quality", "custom"), options: ["custom", "low", "medium", "high"] },
        renderScale: { value: seed("renderScale", D.renderScale), min: 0.4, max: 1, step: 0.05 },
        maxResolution: { value: seed("maxResolution", D.maxResolution), min: 480, max: 2560, step: 64 },
        adaptiveQuality: { value: seed("adaptiveQuality", D.adaptiveQuality) },
        viewportCanvas: { value: seed("viewportCanvas", D.viewportCanvas) },
        d0: { value: seed("d0", D.d0), min: 2, max: 16, step: 1 },
        baseTile: { value: seed("baseTile", D.baseTile), options: { "4 dirs": 2, "16 dirs": 4 } },
        cascadeCount: { value: seed("cascadeCount", D.cascadeCount), min: 3, max: 7, step: 1 },
        intervalLen0: { value: seed("intervalLen0", D.intervalLen0), min: 2, max: 24, step: 1 },
        stepLen: { value: seed("stepLen", D.stepLen), min: 1, max: 8, step: 0.5 },
      },
      { collapsed: true }
    ),
    Form: folder({
      ambient: { value: seed("ambient", D.ambient), min: 0, max: 1.5, step: 0.01 },
      keyIntensity: { value: seed("keyIntensity", D.keyIntensity), min: 0, max: 1.5, step: 0.01 },
      keyColor: seed("keyColor", "#dfe6ff"),
      keyDir: { value: seed("keyDir", { x: -0.45, y: -0.6, z: 0.66 }), step: 0.05 },
      heightScale: { value: seed("heightScale", D.heightScale), min: 0.3, max: 6, step: 0.1 },
      rolloff: { value: seed("rolloff", D.rolloff), min: 0, max: 1, step: 0.05 },
      edgeBias: { value: seed("edgeBias", D.edgeBias), min: 0, max: 1, step: 0.05 },
      normalStrength: { value: seed("normalStrength", D.normalStrength), min: 0, max: 3, step: 0.05 },
      surfaceTexture: { value: seed("surfaceTexture", D.surfaceTexture), min: 0, max: 1, step: 0.01 },
      textureScale: { value: seed("textureScale", D.textureScale), min: 0.5, max: 12, step: 0.5 },
    }),
    Accent: folder({
      accent: seed("accent", "#3faaed"), // theme accent — recolors the whole kit
      giStrength: { value: seed("giStrength", D.giStrength), min: 0, max: 4, step: 0.05 },
      giDirectional: { value: seed("giDirectional", D.giDirectional), min: 0, max: 4, step: 0.1 },
      occlusion: { value: seed("occlusion", D.occlusion), min: 0, max: 1, step: 0.05 },
      componentGlow: { value: seed("componentGlow", D.componentGlow), min: 0, max: 3, step: 0.05 },
      emissiveDisplay: { value: seed("emissiveDisplay", D.emissiveDisplay), min: 0, max: 1.5, step: 0.05 },
      giSmooth: { value: seed("giSmooth", D.giSmooth), min: 0, max: 40, step: 1 },
      giBackground: { value: seed("giBackground", D.giBackground), min: 0, max: 1, step: 0.05 },
      skyStrength: { value: seed("skyStrength", D.skyStrength), min: 0, max: 2, step: 0.05 },
      exposure: { value: seed("exposure", D.exposure), min: 0.2, max: 3, step: 0.05 },
      tintAmount: { value: seed("tintAmount", D.tintAmount), min: 0, max: 1, step: 0.05 },
      grain: { value: seed("grain", D.grain), min: 0, max: 0.2, step: 0.005 },
      skyColor: seed("skyColor", "#0a0d15"),
      material: seed("material", "#383d45"),
    }),
    Lights: folder({
      lightsVisible: seed("lightsVisible", D.lightsVisible),
      light1On: seed("light1On", false),
      light1Color: seed("light1Color", "#ffd2a7"),
      light1Intensity: { value: seed("light1Intensity", 0.25), min: 0, max: 3, step: 0.05 },
      light2On: seed("light2On", false),
      light2Color: seed("light2Color", "#46a6ff"),
      light2Intensity: { value: seed("light2Intensity", 0.35), min: 0, max: 3, step: 0.05 },
      light3On: seed("light3On", false),
      light3Color: seed("light3Color", "#b466ff"),
      // ^ hand-placed orbs default OFF (SCHEMA 14) — the SCREEN hero + component
      //   emission carry the look; re-enable per-light in Studio.
      light3Intensity: { value: seed("light3Intensity", 0.35), min: 0, max: 3, step: 0.05 },
    }),
    Depth: folder(
      {
        shadowStrength: { value: seed("shadowStrength", D.shadowStrength), min: 0, max: 2, step: 0.05 },
        shadowLength: { value: seed("shadowLength", D.shadowLength), min: 0, max: 160, step: 2 },
        shadowHeight: { value: seed("shadowHeight", D.shadowHeight), min: 4, max: 80, step: 1 },
        shadowSoftness: { value: seed("shadowSoftness", D.shadowSoftness), min: 0, max: 0.3, step: 0.005 },
        fillIntensity: { value: seed("fillIntensity", D.fillIntensity), min: 0, max: 1, step: 0.01 },
        fillColor: seed("fillColor", "#4d5c80"),
        fillDir: { value: seed("fillDir", { x: 0.5, y: 0.62, z: 0.6 }), step: 0.05 },
        aoStrength: { value: seed("aoStrength", D.aoStrength), min: 0, max: 2, step: 0.05 },
        aoRadius: { value: seed("aoRadius", D.aoRadius), min: 1, max: 30, step: 1 },
      },
      { collapsed: true }
    ),
    Debug: folder(
      {
        debugMode: {
          value: seed("debugMode", 0),
          options: {
            Final: 0,
            Albedo: 1,
            Normal: 2,
            Height: 5,
            Emissive: 3,
            Irradiance: 4,
            Shadow: 6,
            AO: 7,
            Occlusion: 8,
          },
        },
        showPerf: seed("showPerf", true),
      },
      { collapsed: true }
    ),
  }));

  const params: GIParams = useMemo(
    () => ({
      renderScale: v.renderScale,
      maxResolution: v.maxResolution,
      adaptiveQuality: v.adaptiveQuality,
      viewportCanvas: v.viewportCanvas,
      d0: v.d0,
      baseTile: v.baseTile,
      cascadeCount: v.cascadeCount,
      intervalLen0: v.intervalLen0,
      stepLen: v.stepLen,
      skyColor: hexToLinear(v.skyColor),
      skyStrength: v.skyStrength,
      exposure: v.exposure,
      ambient: v.ambient,
      keyIntensity: v.keyIntensity,
      keyColor: hexToLinear(v.keyColor),
      keyDir: [v.keyDir.x, v.keyDir.y, v.keyDir.z],
      giStrength: v.giStrength,
      giDirectional: v.giDirectional,
      occlusion: v.occlusion,
      componentGlow: v.componentGlow,
      normalStrength: v.normalStrength,
      heightScale: v.heightScale,
      rolloff: v.rolloff,
      edgeBias: v.edgeBias,
      edgeAA: D.edgeAA,
      material: hexToLinear(v.material),
      emissiveDisplay: v.emissiveDisplay,
      tintAmount: v.tintAmount,
      giSmooth: v.giSmooth,
      giBackground: v.giBackground,
      grain: v.grain,
      surfaceTexture: v.surfaceTexture,
      textureScale: v.textureScale,
      lightsVisible: v.lightsVisible,
      fillColor: hexToLinear(v.fillColor),
      fillDir: [v.fillDir.x, v.fillDir.y, v.fillDir.z],
      fillIntensity: v.fillIntensity,
      aoStrength: v.aoStrength,
      aoRadius: v.aoRadius,
      shadowStrength: v.shadowStrength,
      shadowLength: v.shadowLength,
      shadowHeight: v.shadowHeight,
      shadowSoftness: v.shadowSoftness,
      debugMode: v.debugMode,
    }),
    [v]
  );

  const lights = useMemo(
    () => [
      { on: v.light1On, color: hexToLinear(v.light1Color), intensity: v.light1Intensity },
      { on: v.light2On, color: hexToLinear(v.light2Color), intensity: v.light2Intensity },
      { on: v.light3On, color: hexToLinear(v.light3Color), intensity: v.light3Intensity },
    ],
    [v]
  );

  // Applying a quality preset overwrites its underlying sliders (once per pick).
  const prevQuality = useRef<string>("custom");
  useEffect(() => {
    const q = v.quality as string;
    if (q !== "custom" && q !== prevQuality.current) {
      set(QUALITY_PRESETS[q as GIQuality] as Parameters<typeof set>[0]);
    }
    prevQuality.current = q;
  }, [v.quality, set]);

  return { params, lights, v, set };
}

// --- studio (presets + tuning panel) -----------------------------------------

function Studio({
  current,
  lights,
  set,
}: {
  current: Dict;
  lights: Pos[];
  set: (v: Dict) => void;
}) {
  const { accent } = useGITheme();
  const [presets, setPresets] = useState<Record<string, Dict>>(() =>
    loadJSON(PRESETS_KEY, {})
  );
  const [name, setName] = useState("");
  const [copied, setCopied] = useState(false);

  const persist = (next: Record<string, Dict>) => {
    setPresets(next);
    saveJSON(PRESETS_KEY, next);
  };
  const save = () => {
    const n = name.trim() || `preset ${Object.keys(presets).length + 1}`;
    persist({ ...presets, [n]: current });
    setName("");
  };
  const remove = (n: string) => {
    const next = { ...presets };
    delete next[n];
    persist(next);
  };
  const reset = () => {
    try {
      localStorage.removeItem(LAST_KEY);
    } catch {
      /* ignore */
    }
    location.reload();
  };
  // Export the whole current state (settings + light positions) so it can be
  // pasted back and baked in as the code defaults.
  const copy = () => {
    const json = JSON.stringify({ values: current, lights }, null, 2);
    navigator.clipboard?.writeText(json).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      },
      () => {}
    );
  };

  return (
    <>
      <header className="page-head">
        <h2>Studio</h2>
        <p>
          Every parameter of the light simulation, live — tune it in the panel on the right,
          then save the whole look as a preset.
        </p>
      </header>
      <Surface style={{ padding: 24, maxWidth: 620 }} radius={12}>
        <div className="card-title">Presets</div>
        <div className="row">
          <GIField placeholder="preset name" value={name} onChange={setName} style={{ width: 180 }} />
          <GIButton accent={accent} onClick={save}>
            Save
          </GIButton>
          <GIButton onClick={copy}>{copied ? "Copied ✓" : "Copy JSON"}</GIButton>
          <GIButton onClick={reset}>Reset</GIButton>
        </div>
        {Object.keys(presets).length > 0 && (
          <div className="row" style={{ marginTop: 16 }}>
            {Object.keys(presets).map((n) => (
              <GITag key={n} onClick={() => set(presets[n])} onRemove={() => remove(n)}>
                {n}
              </GITag>
            ))}
          </div>
        )}
        <p className="muted" style={{ marginTop: 16 }}>
          Click a preset to load it. “Copy JSON” exports the full state — settings and light
          positions — so a dialed-in look can be baked into the code defaults.
        </p>
      </Surface>
      {/* Live preview: representative material + emitter cases, so every
          panel tweak has something meaningful to land on. */}
      <div>
        <div className="card-title" style={{ marginBottom: 4 }}>Preview</div>
        <p className="muted">Everything below reacts live — raised vs carved relief, active emitters, glow spill.</p>
      </div>
      <div className="grid">
        <Surface style={{ padding: 22 }} radius={10} rolloff={0.05}>
          <div className="card-title small">Crisp — raised</div>
          <p className="muted">A low rolloff gives a tighter, more defined lip. Watch this edge while tuning Form.</p>
          <div className="row" style={{ marginTop: 16 }}>
            <GIButton accent={accent}>Primary</GIButton>
            <GIButton>Neutral</GIButton>
          </div>
        </Surface>
        <Surface style={{ padding: 22 }} radius={10} carved rolloff={1}>
          <div className="card-title small">Soft — carved</div>
          <p className="muted">High rolloff + negative height: a pressed well, dark like the input fields.</p>
          <GIField placeholder="Inset input…" style={{ marginTop: 12 }} />
        </Surface>
      </div>
      <Surface style={{ padding: 24 }} radius={12}>
        <div className="card-title">Emitters &amp; controls</div>
        <div className="row" style={{ gap: 22 }}>
          <GIToggle defaultOn />
          <GIToggle />
          <GICheckbox defaultChecked />
          <GISlider accent={accent} width={170} initial={0.7} />
          <GIProgress value={0.6} width={150} />
          <GIDots />
          <GIRating defaultValue={4} />
          <GIBadge variant="solid">glow</GIBadge>
        </div>
        <div className="row" style={{ gap: 22, marginTop: 20 }}>
          <GIStat label="Bounce" value="1.05×" delta="GI" width={150} />
          <GIToast title="Emissive card" message="This dot pours light onto its row." />
        </div>
      </Surface>
      <Surface style={{ padding: 24, maxWidth: 620 }} radius={12}>
        <div className="card-title">Panel guide</div>
        <p className="muted">
          <strong>Render</strong> — resolution, quality preset, cascade counts (perf).{" "}
          <strong>Form</strong> — key light, bevel relief, surface texture.{" "}
          <strong>Accent</strong> — theme colour, GI bounce strength, exposure, grain.{" "}
          <strong>Lights</strong> — the three draggable orbs.{" "}
          <strong>Depth</strong> — cast shadows, contact AO, fill light.{" "}
          <strong>Debug</strong> — G-buffer views and the perf HUD.
        </p>
      </Surface>
    </>
  );
}

// --- demo ------------------------------------------------------------------

const ROUTES = ["home", "examples", "components", "docs", "studio"];

// The wordmark's dot. Off the home route (`lit`) it becomes a glowing accent
// emitter — the logo lights up over the nav backlight. On home it's a real
// carved dimple stamped into the bar, holding a faint accent tint in its recess.
function LogoDot({ lit = false }: { lit?: boolean }) {
  const { accent } = useGITheme();
  const ref = useGIShape(
    lit
      ? {
          kind: "circle",
          albedo: accent,
          tint: 1,
          emission: [accent[0] * 0.85, accent[1] * 0.85, accent[2] * 0.85],
          displayScale: 6,
          height: 0.4,
          bevel: 3,
        }
      : {
          kind: "circle",
          albedo: [accent[0] * 0.14, accent[1] * 0.14, accent[2] * 0.14],
          tint: 1,
          height: -0.6,
          bevel: 2.5,
          heightScale: 2.5,
        }
  );
  return (
    <span
      ref={ref as React.RefObject<HTMLSpanElement>}
      style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", marginLeft: 5, verticalAlign: "baseline" }}
    />
  );
}
// One wordmark letter: coloured DOM text + a hidden emitter in the same hue,
// so the letters genuinely pour a little of their light into the scene (the
// matte bar doesn't receive it, but it spills past the bar's edge and onto
// the page around the logo — the letters read as real light sources).
function LitLetter({ c, h }: { c: string; h: number }) {
  const ref = useGIShape({
    kind: "circle",
    emission: (() => {
      const lin = hslToLinear(h, 0.85, 0.55);
      return [lin[0] * 0.5, lin[1] * 0.5, lin[2] * 0.5] as Vec3;
    })(),
    opacity: 0.35, // emitters need opacity to cast into the GI
    bodyAlpha: 0, // hidden — the DOM glyph is the visible body
    rawGlow: true,
  });
  return (
    <span
      ref={ref as React.RefObject<HTMLSpanElement>}
      style={{ display: "inline-block", color: `hsl(${h}, 85%, 66%)`, textShadow: `0 0 16px hsla(${h}, 90%, 60%, 0.7)` }}
    >
      {c}
    </span>
  );
}

// The lit wordmark (off the home route): each letter of "giui" gets its own
// colour from the warm-cool arc (no magenta), the colours slowly cycling — so
// the logo reads as multi-coloured alternating light, matching the nav backlight.
function LitWordmark({ onClick }: { onClick: () => void }) {
  const [hue, setHue] = useState(150);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = window.setInterval(() => setHue((h) => (h + 0.7) % 360), 130);
    return () => window.clearInterval(t);
  }, []);
  // hue param → arc 220°(blue)…5°(red), reflected so it never lands on magenta.
  const arc = (deg: number) => {
    let p = (((deg % 360) + 360) % 360) / 180; // 0..2
    if (p > 1) p = 2 - p;
    return Math.round(220 - p * 215);
  };
  return (
    <span className="wordmark lit" onClick={onClick}>
      {"giui".split("").map((c, i) => (
        <LitLetter key={i} c={c} h={arc(hue + i * 52)} />
      ))}
      <LogoDot lit />
    </span>
  );
}

// Routes may carry a sub-path (#/docs/button): `route` keeps the full path,
// the first segment picks the page, the rest is handed to that page.
function parseRoute(hash: string): string {
  const r = hash.replace(/^#\/?/, "").replace(/^templates/, "examples"); // old links
  return ROUTES.includes(r.split("/")[0]) ? r : "home";
}

export default function App() {
  const { params, lights, v, set } = useStudio();
  const accentVec = hexToLinear(v.accent as string);

  // Light positions are owned here so they can be persisted (and exported) with
  // the rest of the state. Defaults sit beside the centred layout on any width.
  const [lightPos, setLightPos] = useState<Pos[]>(() => {
    if (SAVED_LIGHTS && SAVED_LIGHTS.length === 3) return SAVED_LIGHTS;
    // Baked from preset1.
    return [
      { x: 250, y: 162 },
      { x: 1107, y: 339 },
      { x: 180, y: 919 },
    ];
  });
  const moveLight = (i: number, p: Pos) =>
    setLightPos((prev) => prev.map((q, j) => (j === i ? p : q)));

  // Persist settings + light positions together so a reload restores everything.
  useEffect(() => {
    saveJSON(LAST_KEY, { version: SCHEMA_VERSION, values: v, lights: lightPos });
  }, [v, lightPos]);

  // Tiny hash router: #/ (home), #/components, #/templates. The GI canvas and
  // lights persist across routes — only the content in the light field changes.
  const [route, setRoute] = useState<string>(() => parseRoute(location.hash));
  useEffect(() => {
    const onHash = () => setRoute(parseRoute(location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const nav = (r: string) => {
    location.hash = r === "home" ? "/" : `/${r}`;
    window.scrollTo(0, 0);
  };
  const page = route.split("/")[0];
  const sub = route.split("/").slice(1).join("/");

  return (
    <div className="stage">
      {/* The tuning panel lives on the Studio route only. */}
      <Leva hidden={page !== "studio"} />
      <GIProvider
        params={params}
        theme={{ accent: accentVec }}
        showPerf={(v.showPerf as boolean) && page === "studio"}
      >
        <div className="layout">
          {/* The nav is built from the kit itself: a raised lit bar and the
              segmented control's glowing thumb as the route indicator. Off the
              home route, a lava-lamp SCREEN backlights the bar (light spilling
              around it) and the logo lights up. */}
          <div style={{ position: "relative" }}>
            {page !== "home" && <NavGlow />}
            {/* Off home the bar is more opaque so it occludes the backlight like
                a solid TV — the hue light spills AROUND it, not through it. */}
            {/* matte off home: the bar receives NO GI bounce, so the emitters
                behind it (NavGlow) light AROUND it, never its own face. */}
            <Surface className="topnav" style={{ padding: "8px 10px 8px 16px" }} radius={10} heightScale={1.2} opacity={page === "home" ? undefined : 0.95} matte={page !== "home"}>
              {page === "home" ? (
                <span className="wordmark" onClick={() => nav("home")}>
                  giui
                  <LogoDot />
                </span>
              ) : (
                <LitWordmark onClick={() => nav("home")} />
              )}
              <GISegmented
                options={["Home", "Examples", "Components", "Docs", "Studio"]}
                index={ROUTES.indexOf(page)}
                onChange={(i) => nav(ROUTES[i])}
                width={480}
                matte={page !== "home"}
              />
            </Surface>
          </div>

          {page === "home" && <Landing />}

          {page === "components" && (
            <>
              <header className="page-head">
                <h2>Components</h2>
                <p>Every control below is shaded by the same light simulation — hover, click, and drag them.</p>
              </header>
              <Zoo />
            </>
          )}

          {page === "docs" && <Docs slug={sub} />}

          {page === "examples" && <Templates />}

          {page === "studio" && (
            <Studio current={v as Dict} lights={lightPos} set={set as (v: Dict) => void} />
          )}
        </div>

        {lights.map((l, i) =>
          l.on ? (
            <GILight
              key={i}
              color={l.color}
              intensity={l.intensity}
              position={lightPos[i]}
              onChange={(p) => moveLight(i, p)}
              visible={params.lightsVisible}
            />
          ) : null
        )}
      </GIProvider>
    </div>
  );
}
