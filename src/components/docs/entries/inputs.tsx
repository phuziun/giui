import { useState } from "react";
import {
  GIButton,
  GIField,
  GITextarea,
  GISearch,
  GIStepper,
  GISelect,
  GICombobox,
  GIDatePicker,
  GITooltip,
} from "../../index";
import { useGITheme } from "../../../gi/GIProvider";
import type { DocEntry } from "./types";

export const INPUTS: DocEntry[] = [
  {
    slug: "button",
    name: "Button",
    group: "Inputs",
    intro:
      "A raised chip that physically presses into the surface while held. With an accent it becomes a deep-colour chip that pours accent light into the scene — dim at rest, brighter on hover; without one it stays a neutral control.",
    examples: [
      {
        title: "Accented and neutral",
        note: "accent is presence-based: pass it for the primary action, omit it for secondary ones.",
        code: `const { accent } = useGITheme();

<GIButton accent={accent} onClick={save}>Primary</GIButton>
<GIButton onClick={cancel}>Default</GIButton>`,
        Demo: () => {
          const { accent } = useGITheme();
          return (
            <>
              <GIButton accent={accent}>Primary</GIButton>
              <GIButton>Default</GIButton>
            </>
          );
        },
      },
      {
        title: "As a state trigger",
        code: `const [n, setN] = useState(0);

<GIButton accent={accent} onClick={() => setN(n + 1)}>
  Clicked {n} times
</GIButton>`,
        Demo: () => {
          const { accent } = useGITheme();
          const [n, setN] = useState(0);
          return (
            <GIButton accent={accent} onClick={() => setN(n + 1)}>
              Clicked {n} times
            </GIButton>
          );
        },
      },
    ],
  },
  {
    slug: "field",
    name: "Text field",
    group: "Inputs",
    intro:
      "A real <input> over a carved dark well — focus lifts it slightly and rims it with accent glow. GITextarea is the multiline version; its well grows with the content.",
    examples: [
      {
        title: "Field",
        note: "Uncontrolled by default; pass value + onChange for controlled use (onChange receives the string).",
        code: `<GIField placeholder="Type here…" />

// controlled
const [name, setName] = useState("");
<GIField placeholder="Project name" value={name} onChange={setName} />`,
        Demo: () => {
          const [name, setName] = useState("");
          return (
            <>
              <GIField placeholder="Type here…" style={{ width: 180 }} />
              <GIField placeholder="Project name" value={name} onChange={setName} style={{ width: 180 }} />
            </>
          );
        },
      },
      {
        title: "Textarea",
        code: `<GITextarea placeholder="Notes…" rows={3} />`,
        Demo: () => <GITextarea placeholder="Notes…" rows={3} style={{ width: 300 }} />,
      },
    ],
  },
  {
    slug: "search",
    name: "Search",
    group: "Inputs",
    intro: "The text field with a leading ⌕ glyph and a clear button that appears once there's something to clear.",
    examples: [
      {
        title: "Search",
        code: `<GISearch placeholder="Search projects…" width={220} />`,
        Demo: () => <GISearch placeholder="Search projects…" width={220} />,
      },
    ],
  },
  {
    slug: "stepper",
    name: "Stepper",
    group: "Inputs",
    intro: "A − / value / + control for small numeric adjustments, clamped to min/max.",
    examples: [
      {
        title: "Stepper",
        code: `<GIStepper defaultValue={3} min={0} max={99} />`,
        Demo: () => <GIStepper defaultValue={3} />,
      },
    ],
  },
  {
    slug: "select",
    name: "Select",
    group: "Inputs",
    intro:
      "A carved field that opens a lit dropdown of options. The menu panel paints over the content below it and closes on outside click. Fully keyboard-driven: Tab to focus, Enter/Space or arrows to open, arrows/Home/End to move the glowing highlight, Enter to pick, Esc to close.",
    examples: [
      {
        title: "Select",
        code: `<GISelect
  value="Radiance cascades"
  options={["Radiance cascades", "Path tracing", "Photon mapping", "Voxel cone tracing"]}
  onChange={(v) => console.log(v)}
/>`,
        Demo: () => (
          <GISelect
            value="Radiance cascades"
            options={["Radiance cascades", "Path tracing", "Photon mapping", "Voxel cone tracing"]}
          />
        ),
      },
    ],
  },
  {
    slug: "combobox",
    name: "Combobox",
    group: "Inputs",
    intro:
      "A searchable select: type to filter, pick to fill. Case-insensitive, shows the top matches. The first match is highlighted so Enter picks it immediately; arrows move the highlight, Esc closes.",
    examples: [
      {
        title: "Combobox",
        code: `<GICombobox
  options={["Radiance cascades", "Ray tracing", "Rasterization", "Ray marching", "Photon mapping"]}
  placeholder="Type to search…"
  onChange={(v) => console.log(v)}
/>`,
        Demo: () => (
          <GICombobox
            options={["Radiance cascades", "Ray tracing", "Rasterization", "Ray marching", "Photon mapping"]}
            width={230}
          />
        ),
      },
    ],
  },
  {
    slug: "date-picker",
    name: "Date picker",
    group: "Inputs",
    intro:
      "A month calendar. Day cells are plain DOM — only the glowing selected-day disc is a lit shape, so a whole month costs one shape, not 42.",
    examples: [
      {
        title: "Date picker",
        code: `<GIDatePicker onChange={(d) => console.log(d.toDateString())} />`,
        Demo: () => <GIDatePicker />,
      },
    ],
  },
  {
    slug: "tooltip",
    name: "Tooltip",
    group: "Overlays",
    intro: "Wrap any element; hovering reveals a small raised bubble above it.",
    examples: [
      {
        title: "Tooltip",
        code: `<GITooltip label="Lights the scene">
  <GIButton>Hover me</GIButton>
</GITooltip>`,
        Demo: () => (
          <GITooltip label="Lights the scene">
            <GIButton>Hover me</GIButton>
          </GITooltip>
        ),
      },
    ],
  },
];
