import { useState } from "react";
import { GIAppBar, GINavRail, GIDrawer, GIButton, GISearch, GIAvatar, GIList, GIListItem, GIBadge } from "../../index";
import { useGITheme } from "../../../gi/GIProvider";
import type { DocEntry } from "./types";

export const APPSHELL: DocEntry[] = [
  {
    slug: "app-bar",
    name: "App bar",
    group: "App shell",
    intro:
      "The top bar of an application: leading / title / trailing slots on a raised lit surface. Pass matte to pair it with a backlight (light behind the bar, none on its face — like the demo's own nav).",
    examples: [
      {
        title: "App bar",
        code: `<GIAppBar
  leading={<GIButton onClick={openDrawer}>≡</GIButton>}
  title="Console"
  trailing={
    <>
      <GISearch placeholder="Search…" width={170} />
      <GIAvatar initials="AD" size={34} status={good} />
    </>
  }
/>`,
        Demo: () => {
          const { good } = useGITheme();
          return (
            <div style={{ width: "100%" }}>
              <GIAppBar
                leading={<GIButton>≡</GIButton>}
                title="Console"
                trailing={
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <GISearch placeholder="Search…" width={170} />
                    <GIAvatar initials="AD" size={34} status={good} />
                  </div>
                }
              />
            </div>
          );
        },
      },
    ],
  },
  {
    slug: "nav-rail",
    name: "Nav rail",
    group: "App shell",
    intro:
      "Vertical navigation: the active item is a raised, glowing accent chip (the vertical sibling of the segmented control). collapsed gives an icon-only rail with label tooltips.",
    examples: [
      {
        title: "Nav rail",
        note: "Controlled via index + onChange, or uncontrolled with defaultIndex.",
        code: `const [page, setPage] = useState(0);

<GINavRail
  items={[
    { icon: "▦", label: "Dashboard" },
    { icon: "◔", label: "Reports" },
    { icon: "⚙", label: "Settings" },
  ]}
  index={page}
  onChange={setPage}
/>

<GINavRail collapsed items={...} />`,
        Demo: () => {
          const [page, setPage] = useState(0);
          const items = [
            { icon: "▦", label: "Dashboard" },
            { icon: "◔", label: "Reports" },
            { icon: "⚙", label: "Settings" },
          ];
          return (
            <>
              <GINavRail items={items} index={page} onChange={setPage} />
              <GINavRail collapsed items={items} defaultIndex={1} />
            </>
          );
        },
      },
    ],
  },
  {
    slug: "drawer",
    name: "Drawer",
    group: "App shell",
    intro:
      "A slide-in sheet for secondary navigation or detail panels. Controlled (open + onClose); closes on Esc or outside click. Like the dialog, it dims everything except itself so its own lighting stays undimmed, and its light follows the slide.",
    examples: [
      {
        title: "Drawer",
        code: `const [open, setOpen] = useState(false);

<GIButton onClick={() => setOpen(true)}>Open drawer</GIButton>
<GIDrawer open={open} onClose={() => setOpen(false)} title="Workspaces">
  <GIList>
    <GIListItem title="giui-web" subtitle="production" onClick={() => setOpen(false)} />
    <GIListItem title="cascade-lab" subtitle="staging" onClick={() => setOpen(false)} />
  </GIList>
</GIDrawer>`,
        Demo: () => {
          const { accent, good } = useGITheme();
          const [open, setOpen] = useState(false);
          return (
            <>
              <GIButton accent={accent} onClick={() => setOpen(true)}>
                Open drawer
              </GIButton>
              <GIDrawer open={open} onClose={() => setOpen(false)} title="Workspaces">
                <GIList>
                  <GIListItem
                    title="giui-web"
                    subtitle="production"
                    trailing={
                      <GIBadge variant="solid" accent={good}>
                        live
                      </GIBadge>
                    }
                    onClick={() => setOpen(false)}
                  />
                  <GIListItem title="cascade-lab" subtitle="staging" onClick={() => setOpen(false)} />
                  <GIListItem title="photon-cli" subtitle="paused" onClick={() => setOpen(false)} />
                </GIList>
              </GIDrawer>
            </>
          );
        },
      },
    ],
  },
];
