import { useState, useEffect } from "react";
import { GIProgress, GIDots, GISpinner, GISkeleton, GIAlert, GIEmptyState, GILight, GIButton } from "../../index";
import { useGITheme } from "../../../gi/GIProvider";
import type { DocEntry } from "./types";

export const FEEDBACK: DocEntry[] = [
  {
    slug: "progress",
    name: "Progress",
    group: "Feedback",
    intro:
      "A carved groove with an emissive accent fill. Indeterminate mode sweeps a glow along the track; the light on the surrounding surface moves with it.",
    examples: [
      {
        title: "Determinate",
        code: `<GIProgress value={0.72} width={240} />`,
        Demo: () => {
          // A little life: the bar breathes so the emissive fill's light
          // visibly tracks the value.
          const [v, setV] = useState(0.72);
          useEffect(() => {
            const t = window.setInterval(() => setV((x) => (x >= 0.9 ? 0.25 : x + 0.01)), 120);
            return () => window.clearInterval(t);
          }, []);
          return <GIProgress value={v} width={240} />;
        },
      },
      {
        title: "Indeterminate",
        code: `const { good } = useGITheme();

<GIProgress indeterminate width={240} />
<GIProgress indeterminate accent={good} width={240} />`,
        Demo: () => {
          const { good } = useGITheme();
          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <GIProgress indeterminate width={240} />
              <GIProgress indeterminate accent={good} width={240} />
            </div>
          );
        },
      },
    ],
  },
  {
    slug: "loaders",
    name: "Spinner, Dots & Skeleton",
    group: "Feedback",
    intro:
      "Loading states: an orbiting emissive dot, a staggered pulse row, and carved skeleton lines. The animated ones are `live` lit shapes — fine for transient loaders, but don't leave dozens running forever.",
    examples: [
      {
        title: "Spinner and dots",
        code: `const { good } = useGITheme();

<GISpinner />
<GISpinner accent={good} size={20} />
<GIDots />`,
        Demo: () => {
          const { good } = useGITheme();
          return (
            <>
              <GISpinner />
              <GISpinner accent={good} size={20} />
              <GIDots />
            </>
          );
        },
      },
      {
        title: "Skeleton",
        code: `<GISkeleton lines={3} width={240} />`,
        Demo: () => <GISkeleton lines={3} width={240} />,
      },
    ],
  },
  {
    slug: "alert",
    name: "Alert & Empty state",
    group: "Feedback",
    intro: "A raised callout with a glowing accent bar down its edge, and a friendly empty-state card with an optional action.",
    examples: [
      {
        title: "Alert",
        code: `const { warn } = useGITheme();

<GIAlert title="Lights are live">
  Drag the glowing orbs — every component is lit by the same 2D GI.
</GIAlert>
<GIAlert title="Careful" accent={warn}>
  Deleting a preset can't be undone.
</GIAlert>`,
        Demo: () => {
          const { warn } = useGITheme();
          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 14, width: "100%", maxWidth: 460 }}>
              <GIAlert title="Lights are live">Drag the glowing orbs — every component is lit by the same 2D GI.</GIAlert>
              <GIAlert title="Careful" accent={warn}>
                Deleting a preset can't be undone.
              </GIAlert>
            </div>
          );
        },
      },
      {
        title: "Empty state",
        code: `<GIEmptyState
  title="No components yet"
  hint="Add your first lit component to get started."
  action="Add component"
/>`,
        Demo: () => (
          <GIEmptyState title="No components yet" hint="Add your first lit component to get started." action="Add component" />
        ),
      },
    ],
  },
  {
    slug: "light",
    name: "Light",
    group: "Light",
    intro:
      "A draggable emitter orb — the rawest way to put light into the scene. It's a controlled component so you own (and can persist) its position. visible={false} hides the orb while it keeps lighting the scene.",
    examples: [
      {
        title: "Draggable light",
        note: "Drag the orb around the panel — everything nearby is genuinely lit by it.",
        code: `const [pos, setPos] = useState({ x: 160, y: 90 });

<div style={{ position: "relative", height: 180 }}>
  <GILight color={[0.55, 0.7, 1.0]} intensity={0.5} position={pos} onChange={setPos} />
</div>`,
        Demo: () => {
          const [pos, setPos] = useState({ x: 160, y: 90 });
          const [visible, setVisible] = useState(true);
          return (
            <div style={{ position: "relative", height: 180, width: "100%" }}>
              <GILight color={[0.55, 0.7, 1.0]} intensity={0.5} position={pos} onChange={setPos} visible={visible} />
              <div style={{ position: "absolute", right: 0, bottom: 0 }}>
                <GIButton onClick={() => setVisible((v) => !v)}>{visible ? "Hide orb" : "Show orb"}</GIButton>
              </div>
            </div>
          );
        },
      },
    ],
  },
];
