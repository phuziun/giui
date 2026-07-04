import { GITabs, GIBreadcrumb, GIPagination, GIMenu, GICommandPalette, GIKbd } from "../../index";
import type { DocEntry } from "./types";

export const NAVIGATION: DocEntry[] = [
  {
    slug: "tabs",
    name: "Tabs",
    group: "Navigation",
    intro: "Underline tabs with a glowing accent bar that slides to the active option. Controlled via index + onChange, or uncontrolled with defaultIndex.",
    examples: [
      {
        title: "Tabs",
        code: `<GITabs options={["Overview", "Activity", "Settings"]} width={300} />`,
        Demo: () => <GITabs options={["Overview", "Activity", "Settings"]} width={300} />,
      },
    ],
  },
  {
    slug: "breadcrumb",
    name: "Breadcrumb",
    group: "Navigation",
    intro: "A path trail; the last item is the current location.",
    examples: [
      {
        title: "Breadcrumb",
        code: `<GIBreadcrumb items={["Home", "Components", "Breadcrumb"]} />`,
        Demo: () => <GIBreadcrumb items={["Home", "Components", "Breadcrumb"]} />,
      },
    ],
  },
  {
    slug: "pagination",
    name: "Pagination",
    group: "Navigation",
    intro: "Page chips with ‹ › steppers; the active page glows accent.",
    examples: [
      {
        title: "Pagination",
        code: `<GIPagination pages={5} defaultPage={2} />`,
        Demo: () => <GIPagination pages={5} defaultPage={2} />,
      },
    ],
  },
  {
    slug: "menu",
    name: "Menu",
    group: "Navigation",
    intro: "A button that opens a lit action menu. The panel paints over the content below and closes on outside click.",
    examples: [
      {
        title: "Menu",
        code: `<GIMenu
  label="Actions"
  items={["Duplicate", "Rename", "Delete"]}
  onPick={(v) => console.log(v)}
/>`,
        Demo: () => <GIMenu label="Actions" items={["Duplicate", "Rename", "Delete"]} />,
      },
    ],
  },
  {
    slug: "command-palette",
    name: "Command palette",
    group: "Navigation",
    intro:
      "A global launcher: ⌘K (or Ctrl+K) opens it anywhere, Esc closes, typing filters, and picking runs the command's action. Ships its own trigger button too.",
    examples: [
      {
        title: "Command palette",
        note: "Try the keyboard shortcut — it works on this page.",
        code: `<GICommandPalette
  commands={[
    { label: "Toggle lights", hint: "L", action: toggleLights },
    { label: "Copy preset JSON", hint: "⇧C" },
    { label: "Reset to defaults" },
    { label: "Open dashboard" },
  ]}
/>`,
        Demo: () => (
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <GICommandPalette
              commands={[
                { label: "Toggle lights", hint: "L" },
                { label: "Copy preset JSON", hint: "⇧C" },
                { label: "Reset to defaults" },
                { label: "Open dashboard" },
              ]}
            />
            <span style={{ fontSize: 12, color: "rgba(150,162,184,0.6)", display: "flex", gap: 4, alignItems: "center" }}>
              or press <GIKbd>⌘</GIKbd>
              <GIKbd>K</GIKbd>
            </span>
          </div>
        ),
      },
    ],
  },
];
