import { GIDialog, GIToast, GIButton, toast } from "../../index";
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
      "A raised notification card with a glowing status dot, plus a snackbar queue: mount one GIToaster inside the provider and call toast() from anywhere. Toasts stack bottom-right, slide in, auto-dismiss (click to dismiss early) — and cast light while they're up.",
    examples: [
      {
        title: "The queue",
        note: "The demo site already mounts a GIToaster, so these fire for real. toast() also takes a plain string.",
        code: `// once, anywhere inside <GIProvider>:
<GIToaster />

// then from any code:
toast({ title: "Saved", message: "Your changes were written.", accent: good });
toast({ title: "Heads up", duration: 6000 });
toast("Done");`,
        Demo: () => {
          const { accent, good } = useGITheme();
          return (
            <>
              <GIButton accent={accent} onClick={() => toast({ title: "Saved", message: "Your changes were written.", accent: good })}>
                Fire a toast
              </GIButton>
              <GIButton onClick={() => toast("Done")}>Fire a plain one</GIButton>
            </>
          );
        },
      },
      {
        title: "The card itself",
        note: "GIToast is also usable as a plain presentational card.",
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
