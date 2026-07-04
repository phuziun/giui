import {
  GITable,
  GIList,
  GIListItem,
  GIStat,
  GIBadge,
  GITag,
  GIKbd,
  GIAvatar,
  GIAccordion,
  GIProgress,
} from "../../index";
import { useGITheme } from "../../../gi/GIProvider";
import type { DocEntry } from "./types";

export const DATA: DocEntry[] = [
  {
    slug: "table",
    name: "Table",
    group: "Data display",
    intro:
      "Header row + hoverable rows with an accent light wash. Cells are arbitrary ReactNodes, so badges and progress bars compose straight in.",
    examples: [
      {
        title: "Table",
        code: `const { good } = useGITheme();

<GITable
  columns={["Project", "Status", "Usage", "Owner"]}
  widths={["32%", "20%", "30%", "18%"]}
  rows={[
    ["giui-web", <GIBadge variant="solid" accent={good}>Live</GIBadge>,
      <GIProgress value={0.82} width={130} />, "ada"],
    ["cascade-lab", <GIBadge variant="accent">Beta</GIBadge>,
      <GIProgress value={0.44} width={130} />, "kim"],
  ]}
/>`,
        Demo: () => {
          const { good } = useGITheme();
          return (
            <div style={{ width: "100%" }}>
              <GITable
                columns={["Project", "Status", "Usage", "Owner"]}
                widths={["32%", "20%", "30%", "18%"]}
                rows={[
                  [
                    "giui-web",
                    <GIBadge variant="solid" accent={good} key="b">
                      Live
                    </GIBadge>,
                    <GIProgress value={0.82} width={130} key="p" />,
                    "ada",
                  ],
                  [
                    "cascade-lab",
                    <GIBadge variant="accent" key="b">
                      Beta
                    </GIBadge>,
                    <GIProgress value={0.44} width={130} key="p" />,
                    "kim",
                  ],
                ]}
              />
            </div>
          );
        },
      },
    ],
  },
  {
    slug: "list",
    name: "List",
    group: "Data display",
    intro: "Hover-wash rows with leading and trailing slots for avatars, badges, or anything else.",
    examples: [
      {
        title: "List",
        code: `const { good } = useGITheme();

<GIList>
  <GIListItem
    title="Radiance cascades"
    subtitle="Direction-first probe layout"
    leading={<GIAvatar initials="RC" size={32} />}
    trailing={<GIBadge variant="solid" accent={good}>on</GIBadge>}
    onClick={() => {}}
  />
  <GIListItem
    title="Height-field shadows"
    subtitle="Marched toward the key light"
    leading={<GIAvatar initials="HF" size={32} />}
    trailing={<GIKbd>S</GIKbd>}
    onClick={() => {}}
  />
</GIList>`,
        Demo: () => {
          const { good } = useGITheme();
          return (
            <div style={{ width: "100%", maxWidth: 460 }}>
              <GIList>
                <GIListItem
                  title="Radiance cascades"
                  subtitle="Direction-first probe layout"
                  leading={<GIAvatar initials="RC" size={32} />}
                  trailing={
                    <GIBadge variant="solid" accent={good}>
                      on
                    </GIBadge>
                  }
                  onClick={() => {}}
                />
                <GIListItem
                  title="Height-field shadows"
                  subtitle="Marched toward the key light"
                  leading={<GIAvatar initials="HF" size={32} />}
                  trailing={<GIKbd>S</GIKbd>}
                  onClick={() => {}}
                />
              </GIList>
            </div>
          );
        },
      },
    ],
  },
  {
    slug: "stat",
    name: "Stat",
    group: "Data display",
    intro: "A metric card: label, value, and an optional delta badge.",
    examples: [
      {
        title: "Stat",
        code: `const { good } = useGITheme();

<GIStat label="Frames" value="120" delta="+8%" accent={good} width={150} />
<GIStat label="Shapes" value="128" delta="live" width={150} />
<GIStat label="Latency" value="8.4ms" width={150} />`,
        Demo: () => {
          const { good } = useGITheme();
          return (
            <>
              <GIStat label="Frames" value="120" delta="+8%" accent={good} width={150} />
              <GIStat label="Shapes" value="128" delta="live" width={150} />
              <GIStat label="Latency" value="8.4ms" width={150} />
            </>
          );
        },
      },
    ],
  },
  {
    slug: "badge",
    name: "Badge, Tag & Kbd",
    group: "Data display",
    intro:
      "Small raised chips. Badges come in three variants (solid = bright emissive, accent = deep glow, neutral = quiet); tags are removable or clickable pills; Kbd renders key caps.",
    examples: [
      {
        title: "Badge variants",
        code: `const { good } = useGITheme();

<GIBadge variant="solid">New</GIBadge>
<GIBadge variant="accent">Beta</GIBadge>
<GIBadge variant="neutral">v0.3</GIBadge>
<GIBadge variant="solid" accent={good}>Live</GIBadge>`,
        Demo: () => {
          const { good } = useGITheme();
          return (
            <>
              <GIBadge variant="solid">New</GIBadge>
              <GIBadge variant="accent">Beta</GIBadge>
              <GIBadge variant="neutral">v0.3</GIBadge>
              <GIBadge variant="solid" accent={good}>
                Live
              </GIBadge>
            </>
          );
        },
      },
      {
        title: "Tags and key caps",
        code: `<GITag onRemove={() => remove("design")}>design</GITag>
<GITag onRemove={() => remove("webgpu")}>webgpu</GITag>
<GITag>perf</GITag>
<GIKbd>⌘</GIKbd><GIKbd>K</GIKbd>`,
        Demo: () => (
          <>
            <GITag onRemove={() => {}}>design</GITag>
            <GITag onRemove={() => {}}>webgpu</GITag>
            <GITag>perf</GITag>
            <GIKbd>⌘</GIKbd>
            <GIKbd>K</GIKbd>
          </>
        ),
      },
    ],
  },
  {
    slug: "avatar",
    name: "Avatar",
    group: "Data display",
    intro: "A raised initials disc with an optional emissive status dot.",
    examples: [
      {
        title: "Avatar",
        code: `const { good, warn } = useGITheme();

<GIAvatar initials="AD" status={good} />
<GIAvatar initials="GI" />
<GIAvatar initials="KM" size={34} status={warn} />`,
        Demo: () => {
          const { good, warn } = useGITheme();
          return (
            <>
              <GIAvatar initials="AD" status={good} />
              <GIAvatar initials="GI" />
              <GIAvatar initials="KM" size={34} status={warn} />
            </>
          );
        },
      },
    ],
  },
  {
    slug: "accordion",
    name: "Accordion",
    group: "Data display",
    intro: "Single-open disclosure rows; the open item's body slides out of the surface.",
    examples: [
      {
        title: "Accordion",
        code: `<GIAccordion
  items={[
    { title: "What is giui?", body: "A React kit lit by real 2D global illumination on WebGPU." },
    { title: "How does it work?", body: "Components write a G-buffer; radiance cascades simulate the light." },
  ]}
/>`,
        Demo: () => (
          <div style={{ width: "100%", maxWidth: 440 }}>
            <GIAccordion
              items={[
                { title: "What is giui?", body: "A React kit lit by real 2D global illumination on WebGPU." },
                { title: "How does it work?", body: "Components write a G-buffer; radiance cascades simulate the light." },
              ]}
            />
          </div>
        ),
      },
    ],
  },
];
