import { GIDialog, GIToast } from "../../index";
import { useGITheme } from "../../../gi/GIProvider";
import type { DocEntry } from "./types";

export const OVERLAYS: DocEntry[] = [
  {
    slug: "dialog",
    name: "Dialog",
    group: "Overlays",
    intro:
      "A centered lit modal. There's deliberately no dark DOM scrim over the canvas — that would dim the panel's own lighting — instead the page dims everywhere except the panel and text behind it blurs.",
    examples: [
      {
        title: "Dialog",
        note: "Self-contained: renders its own trigger button and manages open state. Click outside or use the built-in actions to close.",
        code: `<GIDialog trigger="Delete project…" title="Delete project?">
  This can't be undone. The project and all its lit components
  will be removed.
</GIDialog>`,
        Demo: () => (
          <GIDialog trigger="Delete project…" title="Delete project?">
            This can't be undone. The project and all its lit components will be removed.
          </GIDialog>
        ),
      },
    ],
  },
  {
    slug: "toast",
    name: "Toast",
    group: "Overlays",
    intro:
      "A raised notification card with a glowing status dot. Presentational — mount and position it yourself (a queued imperative toast() API is on the roadmap).",
    examples: [
      {
        title: "Toast",
        code: `const { good } = useGITheme();

<GIToast title="Saved" message="Your changes were written to localStorage." accent={good} />
<GIToast title="Heads up" message="Three lights are still disabled." />`,
        Demo: () => {
          const { good } = useGITheme();
          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <GIToast title="Saved" message="Your changes were written to localStorage." accent={good} />
              <GIToast title="Heads up" message="Three lights are still disabled." />
            </div>
          );
        },
      },
    ],
  },
];
