import { useState, type ReactNode } from "react";
import { useGITheme } from "../gi/GIProvider";
import {
  Surface,
  GIButton,
  GIToggle,
  GISlider,
  GIField,
  GICheckbox,
  GIRadioGroup,
  GIBadge,
  GITag,
  GIKbd,
  GIAvatar,
  GISelect,
  GITextarea,
  GIProgress,
  GIDots,
  GIRating,
  GIAlert,
  GISegmented,
  GIDivider,
  GITooltip,
  GISpinner,
  GISkeleton,
  GITabs,
  GIBreadcrumb,
  GIPagination,
  GIAccordion,
  GIStat,
  GIMenu,
  GIStepper,
  GIRange,
  GISearch,
  GIDialog,
  GIEmptyState,
  GIToast,
  GICombobox,
  GIDatePicker,
  GIList,
  GIListItem,
  GICommandPalette,
} from "./index";

type Vec3 = [number, number, number];
const GOOD: Vec3 = [0.1, 0.7, 0.35]; // emissive green (status / success)
const WARN: Vec3 = [0.95, 0.5, 0.1]; // emissive amber

// A labeled tile: a raised panel with a caption and a centered demo slot.
function Tile({ label, children, span = 1, id }: { label: string; children: ReactNode; span?: number; id?: string }) {
  return (
    <Surface id={id} style={{ padding: 16, gridColumn: `span ${span}` }} radius={9}>
      <div className="zoo-label">{label}</div>
      <div className="zoo-demo">{children}</div>
    </Surface>
  );
}

export function Zoo() {
  const [tags, setTags] = useState(["design", "webgpu", "lit"]);
  // Button/Slider treat `accent` presence as "accented vs neutral", so the
  // themed ones take it explicitly.
  const { accent } = useGITheme();

  return (
    <section className="zoo">
      <Tile label="Buttons">
        <GIButton accent={accent}>Primary</GIButton>
        <GIButton>Default</GIButton>
      </Tile>

      <Tile label="Segmented / Tabs" span={2}>
        <GISegmented options={["Preview", "Code", "Split"]} />
      </Tile>

      <Tile label="Toggle">
        <GIToggle />
      </Tile>

      <Tile label="Checkbox">
        <GICheckbox defaultChecked />
        <GICheckbox />
      </Tile>

      <Tile label="Radio">
        <GIRadioGroup
         
          options={[
            { label: "Metal", value: "metal" },
            { label: "Glass", value: "glass" },
          ]}
        />
      </Tile>

      <Tile label="Slider" span={2}>
        <GISlider accent={accent} width={220} />
      </Tile>

      <Tile label="Progress" span={2}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <GIProgress value={0.72} width={220} />
          <GIProgress indeterminate accent={GOOD} width={220} />
        </div>
      </Tile>

      <Tile label="Rating">
        <GIRating accent={WARN} defaultValue={4} />
      </Tile>

      <Tile label="Loading">
        <GIDots />
      </Tile>

      <Tile label="Badges">
        <GIBadge variant="solid">New</GIBadge>
        <GIBadge variant="accent">Beta</GIBadge>
        <GIBadge variant="neutral">v0.3</GIBadge>
      </Tile>

      <Tile label="Avatars">
        <GIAvatar initials="AD" status={GOOD} />
        <GIAvatar initials="GI" />
        <GIAvatar initials="UI" status={WARN} />
      </Tile>

      <Tile label="Keys">
        <GIKbd>⌘</GIKbd>
        <GIKbd>K</GIKbd>
      </Tile>

      <Tile label="Tags">
        {tags.map((t) => (
          <GITag key={t} onRemove={() => setTags((xs) => xs.filter((x) => x !== t))}>
            {t}
          </GITag>
        ))}
      </Tile>

      <Tile label="Input">
        <GIField placeholder="Type here…" style={{ width: 190 }} />
      </Tile>

      <Tile label="Select">
        <GISelect
          value="Radiance cascades"
          options={["Radiance cascades", "Path tracing", "Photon mapping", "Voxel cone tracing"]}
         
        />
      </Tile>

      <Tile label="Textarea" span={2}>
        <GITextarea placeholder="Notes…" rows={3} />
      </Tile>

      <Tile label="Alert" span={2}>
        <GIAlert title="Lights are live">
          Drag the glowing orbs — every component is lit by the same 2D GI.
        </GIAlert>
      </Tile>

      <Tile label="Search">
        <GISearch placeholder="Search…" width={200} />
      </Tile>

      <Tile label="Stepper">
        <GIStepper defaultValue={3} />
      </Tile>

      <Tile label="Range" span={2}>
        <GIRange width={230} />
      </Tile>

      <Tile label="Tabs" span={2}>
        <GITabs options={["Overview", "Activity", "Settings"]} width={300} />
      </Tile>

      <Tile label="Pagination" span={2}>
        <GIPagination pages={5} />
      </Tile>

      <Tile label="Breadcrumb" span={2}>
        <GIBreadcrumb items={["Home", "Components", "Zoo"]} />
      </Tile>

      <Tile label="Menu">
        <GIMenu label="Actions" items={["Duplicate", "Rename", "Delete"]} />
      </Tile>

      <Tile label="Dialog">
        <GIDialog trigger="Open dialog" title="Delete project?">
          This can’t be undone. The project and all its lit components will be removed.
        </GIDialog>
      </Tile>

      <Tile label="Tooltip">
        <GITooltip label="Radiance cascades ✨">
          <GIButton>Hover me</GIButton>
        </GITooltip>
      </Tile>

      <Tile label="Spinner">
        <GISpinner />
        <GISpinner accent={GOOD} size={20} />
      </Tile>

      <Tile label="Accordion" span={2}>
        <GIAccordion
          items={[
            { title: "What is giui?", body: "A React kit lit by real 2D global illumination on WebGPU." },
            { title: "How does it work?", body: "Components write a G-buffer; radiance cascades simulate the light." },
          ]}
        />
      </Tile>

      <Tile label="Stats" span={2}>
        <GIStat label="Frames" value="60" delta="+8%" accent={GOOD} width={150} />
        <GIStat label="Shapes" value="128" delta="live" width={150} />
      </Tile>

      <Tile label="Skeleton" span={2}>
        <GISkeleton lines={3} width={240} />
      </Tile>

      <Tile label="Toast" span={2}>
        <GIToast title="Saved" message="Your changes were written to localStorage." accent={GOOD} />
      </Tile>

      <Tile label="Empty state" span={2}>
        <GIEmptyState title="No components yet" hint="Add your first lit component to get started." action="Add component" />
      </Tile>

      <Tile label="Combobox">
        <GICombobox options={["Radiance cascades", "Ray tracing", "Rasterization", "Ray marching", "Photon mapping"]} width={200} />
      </Tile>

      <Tile label="Command palette">
        <GICommandPalette
          commands={[
            { label: "Toggle lights", hint: "L" },
            { label: "Copy preset JSON", hint: "⇧C" },
            { label: "Reset to defaults" },
            { label: "Open dashboard" },
            { label: "Switch theme accent" },
          ]}
        />
      </Tile>

      <Tile label="Date picker" span={2}>
        <GIDatePicker />
      </Tile>

      <Tile label="List" span={2}>
        <GIList>
          <GIListItem title="Radiance cascades" subtitle="Direction-first probe layout" leading={<GIAvatar initials="RC" size={32} />} trailing={<GIBadge variant="solid" accent={GOOD}>on</GIBadge>} onClick={() => {}} />
          <GIListItem title="Height-field shadows" subtitle="Marched toward the key light" leading={<GIAvatar initials="HS" size={32} />} trailing={<GIBadge variant="neutral">beta</GIBadge>} onClick={() => {}} />
          <GIListItem title="Film grain" subtitle="Static, present-pass" leading={<GIAvatar initials="FG" size={32} />} onClick={() => {}} />
        </GIList>
      </Tile>

      <Tile label="Divider" span={2} id="zoo-tail">
        <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 12 }}>
          <span style={{ fontSize: 12.5, color: "rgba(180,188,208,0.75)" }}>Section one</span>
          <GIDivider />
          <span style={{ fontSize: 12.5, color: "rgba(180,188,208,0.75)" }}>Section two</span>
        </div>
      </Tile>
    </section>
  );
}
