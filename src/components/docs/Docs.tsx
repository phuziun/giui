import { useEffect } from "react";
import { Surface } from "../index";
import { CodeBlock } from "./CodeBlock";
import { ENTRIES, type DocEntry } from "./entries";

// ---------------------------------------------------------------------------
// MUI-style reference: a sticky sidebar of components + one page per entry
// with live demos and the code to reproduce each one. Routed by hash:
// #/docs/<slug>. Every demo runs in the real light field.
// ---------------------------------------------------------------------------

const GROUP_ORDER = [
  "Getting started",
  "Surfaces",
  "Inputs",
  "Selection",
  "Navigation",
  "App shell",
  "Overlays",
  "Data display",
  "Feedback",
  "Light",
];

function groupOf(g: string): number {
  const i = GROUP_ORDER.indexOf(g);
  return i < 0 ? GROUP_ORDER.length : i;
}

const SORTED = [...ENTRIES].sort((a, b) => groupOf(a.group) - groupOf(b.group));

export function Docs({ slug }: { slug: string }) {
  const entry: DocEntry = SORTED.find((e) => e.slug === slug) ?? SORTED[0];

  // Route changes land at the top of the new page (the app-level nav() only
  // covers top-level route switches, not sidebar navigation).
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [entry.slug]);

  return (
    <div style={{ display: "flex", gap: 26, alignItems: "flex-start" }}>
      {/* Sidebar: plain DOM links (no GI shapes — 40 entries would waste the
          shape budget); the active item reads as an accent chip via CSS. */}
      <nav className="docs-side" aria-label="Components">
        {SORTED.map((e, i) => {
          const newGroup = i === 0 || SORTED[i - 1].group !== e.group;
          return (
            <div key={e.slug}>
              {newGroup && <div className="docs-side-group">{e.group}</div>}
              <a href={`#/docs/${e.slug}`} className={e.slug === entry.slug ? "docs-link active" : "docs-link"}>
                {e.name}
              </a>
            </div>
          );
        })}
      </nav>

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 26 }}>
        <header className="page-head" style={{ margin: 0 }}>
          <h2>{entry.name}</h2>
          <p style={{ maxWidth: 640 }}>{entry.intro}</p>
        </header>

        {entry.examples.map((ex) => (
          <section key={ex.title} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <h3 className="docs-h3">{ex.title}</h3>
            {ex.note && <p className="docs-note">{ex.note}</p>}
            <Surface radius={9} style={{ padding: "26px 24px" }}>
              <div className="docs-demo">
                <ex.Demo />
              </div>
            </Surface>
            <CodeBlock code={ex.code} />
          </section>
        ))}
      </div>
    </div>
  );
}
