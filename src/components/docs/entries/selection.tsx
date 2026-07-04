import { useState } from "react";
import { GIToggle, GICheckbox, GIRadioGroup, GISegmented, GISlider, GIRange, GIRating } from "../../index";
import { useGITheme } from "../../../gi/GIProvider";
import type { DocEntry } from "./types";

export const SELECTION: DocEntry[] = [
  {
    slug: "toggle",
    name: "Toggle",
    group: "Selection",
    intro: "A carved track whose surface becomes a bright accent — and starts glowing — when on. The knob stays a dark chip.",
    examples: [
      {
        title: "Toggle",
        code: `<GIToggle />
<GIToggle defaultOn />`,
        Demo: () => (
          <>
            <GIToggle />
            <GIToggle defaultOn />
          </>
        ),
      },
    ],
  },
  {
    slug: "checkbox",
    name: "Checkbox",
    group: "Selection",
    intro: "A carved well that fills with glowing accent when checked.",
    examples: [
      {
        title: "Checkbox",
        code: `<GICheckbox defaultChecked />
<GICheckbox />
<GICheckbox size={18} onChange={(checked) => console.log(checked)} />`,
        Demo: () => (
          <>
            <GICheckbox defaultChecked />
            <GICheckbox />
            <GICheckbox size={18} />
          </>
        ),
      },
    ],
  },
  {
    slug: "radio",
    name: "Radio group",
    group: "Selection",
    intro: "Carved wells; the selected one holds a glowing accent dot.",
    examples: [
      {
        title: "Radio group",
        code: `<GIRadioGroup
  options={[
    { label: "Metal", value: "metal" },
    { label: "Glass", value: "glass" },
  ]}
/>`,
        Demo: () => (
          <GIRadioGroup
            options={[
              { label: "Metal", value: "metal" },
              { label: "Glass", value: "glass" },
            ]}
          />
        ),
      },
    ],
  },
  {
    slug: "segmented",
    name: "Segmented",
    group: "Selection",
    intro:
      "A carved track with a raised, glowing thumb that slides to the active option — tabs with real physicality. Pass index + onChange to control it (the demo site's route switcher is exactly this).",
    examples: [
      {
        title: "Uncontrolled",
        code: `<GISegmented options={["Preview", "Code", "Split"]} />`,
        Demo: () => <GISegmented options={["Preview", "Code", "Split"]} />,
      },
      {
        title: "Controlled",
        code: `const [view, setView] = useState(1);

<GISegmented
  options={["Day", "Week", "Month", "Year"]}
  index={view}
  onChange={setView}
  width={300}
/>`,
        Demo: () => {
          const [view, setView] = useState(1);
          return <GISegmented options={["Day", "Week", "Month", "Year"]} index={view} onChange={setView} width={300} />;
        },
      },
    ],
  },
  {
    slug: "slider",
    name: "Slider",
    group: "Selection",
    intro:
      "A carved groove with a dark knob; the filled side is a bright accent surface whose glow scales with the value. GIRange is the dual-handle version.",
    examples: [
      {
        title: "Slider",
        note: "Like GIButton, the accent prop is presence-based — omit it for a plain groove.",
        code: `const { accent } = useGITheme();

<GISlider accent={accent} width={220} />
<GISlider accent={accent} width={220} initial={0.8} />
<GISlider width={220} />`,
        Demo: () => {
          const { accent } = useGITheme();
          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              <GISlider accent={accent} width={220} />
              <GISlider accent={accent} width={220} initial={0.8} />
              <GISlider width={220} />
            </div>
          );
        },
      },
      {
        title: "Range",
        code: `<GIRange width={240} initial={[0.3, 0.7]} />`,
        Demo: () => <GIRange width={240} />,
      },
    ],
  },
  {
    slug: "rating",
    name: "Rating",
    group: "Selection",
    intro: "Clickable pips — filled ones are glowing accent discs, empty ones carved dark wells. (Stars aren't an SDF primitive; circles read cleaner under real light anyway.)",
    examples: [
      {
        title: "Rating",
        code: `const { warn } = useGITheme();

<GIRating defaultValue={3} />
<GIRating accent={warn} defaultValue={4} />`,
        Demo: () => {
          const { warn } = useGITheme();
          return (
            <>
              <GIRating defaultValue={3} />
              <GIRating accent={warn} defaultValue={4} />
            </>
          );
        },
      },
    ],
  },
];
