import { useGITheme } from "../../../gi/GIProvider";
import { useGIShape } from "../../../gi/useGIShape";
import { Surface, GIButton, GIField, GIToggle, GISlider, GIBadge, GIKbd } from "../../index";
import type { DocEntry } from "./types";

export const GUIDES: DocEntry[] = [
  {
    slug: "getting-started",
    name: "Getting started",
    group: "Getting started",
    intro:
      "giui is a dark-neumorphic React kit lit by a real 2D global-illumination simulation on WebGPU. Wrap your app in one provider; every component below it registers itself into the light field — glowing controls genuinely cast light onto their neighbours. Without WebGPU the components still render and work, just unlit.",
    examples: [
      {
        title: "Mount the provider",
        note: "One GIProvider at the root. `quality` picks a perf preset; `theme.accent` recolors the whole kit (linear RGB). Vendored install: copy src/gi and src/components into a Vite + React app.",
        code: `import { GIProvider } from "./gi/GIProvider";
import { Surface, GIButton, GIField, GIToggle } from "./components";

export default function App() {
  return (
    <GIProvider theme={{ accent: [0.05, 0.4, 0.85] }} quality="medium">
      <Surface radius={12} style={{ padding: 20, display: "flex", gap: 16, alignItems: "center" }}>
        <GIField placeholder="Search…" />
        <GIButton accent={[0.05, 0.4, 0.85]}>Save</GIButton>
        <GIToggle defaultOn />
      </Surface>
    </GIProvider>
  );
}`,
        Demo: () => {
          const { accent } = useGITheme();
          return (
            <Surface radius={12} style={{ padding: 20, display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
              <GIField placeholder="Search…" style={{ width: 170 }} />
              <GIButton accent={accent}>Save</GIButton>
              <GIToggle defaultOn />
            </Surface>
          );
        },
      },
      {
        title: "Theming",
        note: "Components resolve their colour from the provider theme unless given an explicit accent prop. GIButton, GISlider and GIAvatar treat the prop's presence as the accented/neutral switch; everything else falls back to theme.accent automatically. useGITheme() exposes the resolved theme (accent / good / warn).",
        code: `const { accent, good, warn } = useGITheme();

<GIButton accent={accent}>Accented</GIButton>
<GIButton>Neutral</GIButton>
<GIBadge variant="solid" accent={good}>Live</GIBadge>
<GIBadge variant="solid" accent={warn}>Hot</GIBadge>
<GISlider accent={accent} width={170} />`,
        Demo: () => {
          const { accent, good, warn } = useGITheme();
          return (
            <>
              <GIButton accent={accent}>Accented</GIButton>
              <GIButton>Neutral</GIButton>
              <GIBadge variant="solid" accent={good}>
                Live
              </GIBadge>
              <GIBadge variant="solid" accent={warn}>
                Hot
              </GIBadge>
              <GISlider accent={accent} width={170} />
            </>
          );
        },
      },
    ],
  },
  {
    slug: "custom-shapes",
    name: "Custom shapes",
    group: "Getting started",
    intro:
      "Any DOM element can join the light simulation. useGIShape measures the element's box and registers a matching SDF shape: signed height raises or carves it, bevel sets the lip width, emission pours light into the scene while displayScale controls how much shows on its own face, and opacity makes it occlude light (cast GI shadows).",
    examples: [
      {
        title: "A custom emissive card",
        note: "emission and displayScale are decoupled on purpose — this card bounces cyan onto its surroundings while its own face stays a quiet chip. Pass live: true only for elements that move without a React re-render.",
        code: `import { useGIShape } from "./gi/useGIShape";

function GlowCard({ children }: { children: React.ReactNode }) {
  const ref = useGIShape({
    height: 1.2,               // raised (negative = carved)
    bevel: 22,
    cornerRadius: 12,
    emission: [0.05, 0.35, 0.5], // light injected into the scene
    displayScale: 0.6,           // …only 60% shows on its own face
    opacity: 0.5,                // occludes light passing through
  });
  return (
    <div ref={ref} style={{ borderRadius: 12, padding: "18px 24px" }}>
      {children}
    </div>
  );
}`,
        Demo: () => {
          const ref = useGIShape({
            height: 1.2,
            bevel: 22,
            cornerRadius: 12,
            emission: [0.05, 0.35, 0.5],
            displayScale: 0.6,
            opacity: 0.5,
          });
          return (
            <div
              ref={ref as React.RefObject<HTMLDivElement>}
              style={{ borderRadius: 12, padding: "18px 24px", color: "rgba(215, 235, 245, 0.92)", fontSize: 13.5 }}
            >
              I light my neighbours.
            </div>
          );
        },
      },
      {
        title: "Carved wells and dark insets",
        note: "Negative height presses into the surface. The global tintAmount caps how dark a component's own albedo can read — set tint: 1 to bypass it (this is how every input field in the kit gets its dark well).",
        code: `const ref = useGIShape({
  height: -0.5,          // carved into the surface
  bevel: 10,
  cornerRadius: 9,
  albedo: [0.012, 0.016, 0.024],
  tint: 1,               // show full albedo — a genuinely dark inset
});`,
        Demo: () => {
          const ref = useGIShape({
            height: -0.5,
            bevel: 10,
            cornerRadius: 9,
            albedo: [0.012, 0.016, 0.024],
            tint: 1,
          });
          return (
            <div
              ref={ref as React.RefObject<HTMLDivElement>}
              style={{ borderRadius: 9, padding: "14px 22px", color: "rgba(160, 175, 195, 0.7)", fontSize: 13 }}
            >
              A carved dark well
            </div>
          );
        },
      },
    ],
  },
  {
    slug: "studio",
    name: "Studio",
    group: "Getting started",
    intro:
      "The Studio route (in the nav above) is the live tuning workbench: a panel driving every lighting parameter — key light, shadows, AO, GI bounce, material, film grain — with the changes applied to the whole site in real time, plus a preset manager to save, compare, and copy configurations. Render → engine switches the whole site between the radiance-cascade renderer and the experimental GI-Lite engine (see the Labs tab).",
    examples: [
      {
        title: "From Studio to your app",
        note: "Dial in a look in Studio, hit Copy JSON, and pass the values through GIProvider's params. The quality presets and your overrides merge in order: defaults → quality → params. Studio state persists to localStorage, so your tuning survives reloads while you explore.",
        code: `// 1. Open Studio, tune the look, press "Copy JSON".
// 2. Feed the values you changed into the provider:
<GIProvider
  quality="medium"
  params={{
    keyIntensity: 0.41,
    heightScale: 1.3,
    shadowLength: 122,
    giBackground: 0.14,
    // …anything from GIParams (src/gi/types.ts)
  }}
>
  <App />
</GIProvider>`,
        Demo: () => {
          const { accent } = useGITheme();
          return (
            <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
              <GIButton accent={accent} onClick={() => (location.hash = "/studio")}>
                Open Studio
              </GIButton>
              <span style={{ fontSize: 12.5, color: "rgba(150,162,184,0.65)", display: "flex", gap: 4, alignItems: "center" }}>
                every slider there relights this page — including the <GIKbd>Docs</GIKbd> you're reading
              </span>
            </div>
          );
        },
      },
    ],
  },
];
