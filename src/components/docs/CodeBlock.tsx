import { useState, type ReactNode } from "react";
import { Surface } from "../index";

// ---------------------------------------------------------------------------
// A carved code panel with a tiny regex TSX highlighter (no dependencies —
// docs pages ship with the demo site, and a full grammar isn't worth 40kB).
// Tokens are rendered as React spans, so nothing is ever injected as HTML.
// ---------------------------------------------------------------------------

const COLORS = {
  comment: "rgba(120, 135, 160, 0.65)",
  string: "rgba(150, 210, 160, 0.95)",
  keyword: "rgba(140, 170, 255, 0.95)",
  number: "rgba(235, 180, 120, 0.95)",
  tag: "rgba(120, 200, 235, 0.95)",
  prop: "rgba(190, 175, 240, 0.9)",
  plain: "rgba(205, 214, 230, 0.88)",
};

// One alternation, first match wins. Order matters: comments before strings
// before keywords; JSX tags before generic identifiers; `prop=` lookahead last.
const TOKEN =
  /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|\b(import|from|export|default|function|return|const|let|var|type|new|if|else|true|false|null|undefined|async|await)\b|(-?\b\d+(?:\.\d+)?\b)|(<\/?[A-Za-z][\w.]*|\/>|>)|([A-Za-z_$][\w$]*)(?=={|=")/g;

function highlight(code: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of code.matchAll(TOKEN)) {
    const i = m.index!;
    if (i > last) out.push(code.slice(last, i));
    const kind = m[1] ? "comment" : m[2] ? "string" : m[3] ? "keyword" : m[4] ? "number" : m[5] ? "tag" : "prop";
    out.push(
      <span key={key++} style={{ color: COLORS[kind] }}>
        {m[0]}
      </span>
    );
    last = i + m[0].length;
  }
  if (last < code.length) out.push(code.slice(last));
  return out;
}

export function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    });
  };
  return (
    <Surface carved radius={9} style={{ position: "relative", padding: "14px 16px" }} opacity={0.25}>
      <button
        onClick={copy}
        style={{
          position: "absolute",
          top: 8,
          right: 8,
          pointerEvents: "auto",
          cursor: "pointer",
          border: "none",
          borderRadius: 6,
          padding: "4px 10px",
          fontSize: 11,
          fontFamily: "inherit",
          color: copied ? "rgba(160, 230, 180, 0.95)" : "rgba(170, 182, 205, 0.75)",
          background: "rgba(255, 255, 255, 0.05)",
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
      <pre
        style={{
          margin: 0,
          overflowX: "auto",
          fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
          fontSize: 12.5,
          lineHeight: 1.55,
          color: COLORS.plain,
          userSelect: "text",
          pointerEvents: "auto",
        }}
      >
        {highlight(code)}
      </pre>
    </Surface>
  );
}
