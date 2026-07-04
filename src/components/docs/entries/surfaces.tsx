import { Surface, GIDivider, GIField, GIButton } from "../../index";
import { useGITheme } from "../../../gi/GIProvider";
import type { DocEntry } from "./types";

export const SURFACES: DocEntry[] = [
  {
    slug: "surface",
    name: "Surface",
    group: "Surfaces",
    intro:
      "The base panel. Raised by default — it swells out of the page material and its beveled lip catches the key light; carved presses it in with a darker inset. Everything in the kit composes inside Surfaces, and nested shapes stack naturally because height is an additive field.",
    examples: [
      {
        title: "Raised and carved",
        code: `<Surface radius={12} style={{ padding: 20 }}>
  A raised panel
</Surface>

<Surface radius={12} carved style={{ padding: 20 }}>
  A carved panel
</Surface>`,
        Demo: () => (
          <>
            <Surface radius={12} style={{ padding: "18px 24px", fontSize: 13 }}>
              A raised panel
            </Surface>
            <Surface radius={12} carved style={{ padding: "18px 24px", fontSize: 13 }}>
              A carved panel
            </Surface>
          </>
        ),
      },
      {
        title: "Relief control",
        note: "height sets physical depth (shadows, AO); bevel is the lip width; heightScale steepens only the shading of the bevel — big panels want a soft low value, small controls a crisp high one. opacity is how much the panel occludes GI light (low = more light integration with the background).",
        code: `<Surface radius={12} height={2.2} bevel={40} heightScale={2} style={{ padding: 20 }}>
  Tall, wide bevel
</Surface>

<Surface radius={12} height={0.7} bevel={14} style={{ padding: 20 }}>
  Shallow, tight bevel
</Surface>`,
        Demo: () => (
          <>
            <Surface radius={12} height={2.2} bevel={40} heightScale={2} style={{ padding: "18px 24px", fontSize: 13 }}>
              Tall, wide bevel
            </Surface>
            <Surface radius={12} height={0.7} bevel={14} style={{ padding: "18px 24px", fontSize: 13 }}>
              Shallow, tight bevel
            </Surface>
          </>
        ),
      },
      {
        title: "Composition",
        note: "Nested shapes paint over their parents (larger area first), so wells and chips sit ON the panel without any z-index bookkeeping.",
        code: `const { accent } = useGITheme();

<Surface radius={12} style={{ padding: 18, display: "flex", gap: 14 }}>
  <GIField placeholder="Nested input…" />
  <GIButton accent={accent}>Nested button</GIButton>
</Surface>`,
        Demo: () => {
          const { accent } = useGITheme();
          return (
            <Surface radius={12} style={{ padding: 18, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
              <GIField placeholder="Nested input…" style={{ width: 160 }} />
              <GIButton accent={accent}>Nested button</GIButton>
            </Surface>
          );
        },
      },
    ],
  },
  {
    slug: "divider",
    name: "Divider",
    group: "Surfaces",
    intro: "A thin carved rule — a groove in the surface rather than a drawn line, so it shades with the lighting like everything else.",
    examples: [
      {
        title: "Horizontal and vertical",
        code: `<GIDivider />
<GIDivider vertical length={40} />`,
        Demo: () => (
          <div style={{ display: "flex", alignItems: "center", gap: 24, width: "100%" }}>
            <div style={{ flex: 1 }}>
              <GIDivider />
            </div>
            <GIDivider vertical length={40} />
            <div style={{ flex: 1 }}>
              <GIDivider />
            </div>
          </div>
        ),
      },
    ],
  },
];
