import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { useGIShape } from "../gi/useGIShape";
import { useGITheme } from "../gi/GIProvider";

type Vec3 = [number, number, number];

// Resolve a component's accent colour: an explicit prop wins, otherwise the
// nearest <GIProvider theme> — one provider prop recolors the whole kit.
function useAccent(a?: Vec3): Vec3 {
  const theme = useGITheme();
  return a ?? theme.accent;
}

// Components are nearly the colour of the background; their form reads from the
// bevel relief under the key light. `height > 0` raises out of the surface,
// `height < 0` carves into it.
// Most components share the material colour (so they read as one surface);
// only inset elements (fields, tracks) take a darker albedo via `tintAmount`.
const SURFACE_ALBEDO: Vec3 = [0.052, 0.057, 0.068];
// Inset elements (fields, tracks) show their full (dark) albedo via `tint: 1`,
// bypassing the global tintAmount cap. A mid-dark value (not near-black) keeps
// them clearly recessed while leaving headroom for the bevel relief to read.
const INSET_ALBEDO: Vec3 = [0.032, 0.034, 0.042];

// --- Surface: a panel that raises out of (or carves into) the background -----

export function Surface({
  children,
  style,
  radius = 8,
  albedo,
  height = 1.4,
  bevel = 28,
  rolloff,
  carved = false,
  opacity = 0.55,
  // Large features want a LOW relief scale (a soft, subtle bevel) while small
  // detailed controls keep the crisper global default — a big flat panel with a
  // harsh steep lip looks wrong. Physical depth (shadow/AO) is unaffected.
  heightScale = 1.0,
  layer,
  matte = false,
  className,
  id,
}: {
  children?: ReactNode;
  style?: CSSProperties;
  radius?: number;
  albedo?: Vec3;
  height?: number;
  bevel?: number;
  rolloff?: number;
  carved?: boolean;
  opacity?: number;
  heightScale?: number;
  /** Paint priority — overlay panels (dialog/menu) pass 1+ to paint over page content. */
  layer?: number;
  /** Receive no GI bounce — a light behind this panel lights around it, not its face. */
  matte?: boolean;
  className?: string;
  id?: string;
}) {
  // A carved panel reads like the inset fields: a darker albedo shown in full
  // (tint: 1, bypassing the global tintAmount cap) so the recess goes properly
  // dark instead of staying near the surface colour. A raised panel keeps the
  // shared surface colour and reads purely from its bevel relief.
  const ref = useGIShape({
    albedo: albedo ?? (carved ? INSET_ALBEDO : SURFACE_ALBEDO),
    tint: carved ? 1 : 0,
    matte,
    height: carved ? -Math.abs(height) : height,
    bevel,
    rolloff,
    heightScale,
    opacity,
    cornerRadius: radius,
    layer,
  });
  return (
    <div
      ref={ref as React.RefObject<HTMLDivElement>}
      className={className}
      id={id}
      style={{
        borderRadius: radius,
        background: "transparent",
        color: "rgba(214,221,234,0.9)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// --- Button: raised at rest, presses *into* the surface when held ------------

export function GIButton({
  children,
  onClick,
  accent,
  radius = 5,
  style,
}: {
  children?: ReactNode;
  onClick?: () => void;
  accent?: Vec3; // optional subtle emissive tint
  radius?: number;
  style?: CSSProperties;
}) {
  const [hover, setHover] = useState(false);
  const [down, setDown] = useState(false);

  // Accent buttons are a *dark* chip with a *strong* emissive glow -- a deep
  // colour that radiates light, the scene's local light sources. The emission
  // both blooms on the button and bounces (via the cascades) onto neighbours.
  // Subdued deep-blue chip at rest; the old resting brightness now lives on hover.
  const glow = accent ? (down ? 1.0 : hover ? 1.4 : 0.5) : 0;
  const a = accent ?? [0, 0, 0];
  const emission: Vec3 = [a[0] * glow, a[1] * glow, a[2] * glow];
  // The chip's albedo is a deep version of its glow colour (tint: 1 so it shows
  // in full) -- the surface clearly reads as the same colour it radiates.
  const albedo: Vec3 = accent
    ? [a[0] * 0.55, a[1] * 0.55, a[2] * 0.55]
    : [0.08, 0.085, 0.1];

  const ref = useGIShape({
    albedo,
    emission,
    tint: accent ? 1 : 0,
    // Pour the emission into the bounce, but only show a little of it on the
    // button itself -- a deep-blue chip with a hint of glow, not a light bulb.
    displayScale: accent ? 0.3 : 1,
    height: down ? -0.5 : 1, // press carves in
    bevel: 9,
    cornerRadius: radius,
  });

  return (
    <div
      ref={ref as React.RefObject<HTMLDivElement>}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => {
        setHover(false);
        setDown(false);
      }}
      onPointerDown={() => setDown(true)}
      onPointerUp={() => setDown(false)}
      onClick={onClick}
      style={{
        borderRadius: radius,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "8px 15px",
        fontSize: 13,
        cursor: "pointer",
        userSelect: "none",
        fontWeight: 600,
        letterSpacing: 0.2,
        color: "rgba(220,227,240,0.92)",
        pointerEvents: "auto", // interactive even inside click-through layouts
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// --- Field: a carved well, like an inset input ------------------------------

export function GIField({
  placeholder,
  style,
  accent: accentProp,
  value,
  onChange,
}: {
  placeholder?: string;
  style?: CSSProperties;
  accent?: Vec3;
  /** Controlled value (omit for an uncontrolled input). */
  value?: string;
  onChange?: (v: string) => void;
}) {
  const accent = useAccent(accentProp);
  const [focus, setFocus] = useState(false);
  const [hover, setHover] = useState(false);
  // Responsive on select: a clear accent glow + slight lift on focus, a hint on hover.
  const active = focus ? 1 : hover ? 0.35 : 0;
  const e = active * 0.16;
  const ref = useGIShape({
    albedo: INSET_ALBEDO,
    tint: 1, // full dark albedo, ignoring the global tint cap
    emission: [accent[0] * e, accent[1] * e, accent[2] * e],
    displayScale: 3.5,
    height: -0.4 + active * 0.12, // lifts a touch toward flush when focused
    bevel: 4,
    cornerRadius: 5,
  });
  return (
    <input
      ref={ref as React.RefObject<HTMLInputElement>}
      className="gi-field"
      placeholder={placeholder}
      {...(value !== undefined ? { value } : {})}
      {...(onChange ? { onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value) } : {})}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      style={{
        boxSizing: "border-box",
        width: "100%",
        borderRadius: 5,
        padding: "9px 12px",
        fontSize: 13,
        fontFamily: "inherit",
        color: "rgba(210,220,238,0.92)",
        background: "transparent",
        border: "none",
        outline: "none",
        appearance: "none",
        // Always interactive, regardless of the layout's pointer-events: none.
        pointerEvents: "auto",
        ...style,
      }}
    />
  );
}

// --- Toggle: carved track, raised knob that emits a soft accent when on ------

export function GIToggle({ accent: accentProp, defaultOn = false }: { accent?: Vec3; defaultOn?: boolean }) {
  const accent = useAccent(accentProp);
  const [on, setOn] = useState(defaultOn);
  // Dark raised handle -- a dark dot against the bright emissive track.
  const knobRef = useGIShape({
    kind: "circle",
    albedo: [0.05, 0.055, 0.07],
    tint: 1,
    height: 1.0,
    bevel: 5,
    live: true,
  });
  // When on, the carved track becomes a bright accent surface (albedo) with a
  // strong glow on top (emission). tint: 1 shows the full accent albedo.
  const tg = on ? 0.7 : 0;
  const trackRef = useGIShape({
    albedo: on ? accent : INSET_ALBEDO,
    tint: 1,
    emission: [accent[0] * tg, accent[1] * tg, accent[2] * tg],
    displayScale: 8,
    height: -0.35, // shallow carved track with a tight lip
    bevel: 4,
    cornerRadius: 10,
  });

  return (
    <div
      ref={trackRef as React.RefObject<HTMLDivElement>}
      onClick={() => setOn((v) => !v)}
      style={{
        position: "relative",
        width: 52,
        height: 28,
        borderRadius: 10,
        cursor: "pointer",
        flex: "none",
        pointerEvents: "auto",
      }}
    >
      <div
        ref={knobRef as React.RefObject<HTMLDivElement>}
        style={{
          position: "absolute",
          top: 4,
          left: on ? 27 : 4,
          width: 20,
          height: 20,
          borderRadius: 10,
          transition: "left 0.2s cubic-bezier(0.3,0.9,0.3,1)",
        }}
      />
    </div>
  );
}

// --- Slider: a carved track with a draggable raised knob --------------------

export function GISlider({
  accent,
  width = 190,
  initial = 0.5,
}: {
  accent?: Vec3;
  width?: number;
  initial?: number;
}) {
  const [val, setVal] = useState(initial);
  const dragging = useRef(false);

  const knob = 18;
  // Fill up to the knob's left edge (not its centre) so the fill never overlaps
  // the handle -- otherwise at low values the smaller fill paints over the knob.
  const fillW = val * (width - knob);

  // Dark carved groove (the unfilled track).
  const trackRef = useGIShape({
    height: -0.35,
    bevel: 4,
    cornerRadius: 4,
    albedo: INSET_ALBEDO,
    tint: 1,
    live: true,
  });
  // The *filled* portion (left edge -> knob) is the bright accent surface, with
  // a glow on top. Only this part lights up, so it reads as a fill to the knob.
  // The glow scales ±30% with the value: dim at minimum (0.7×), full at the
  // middle, bright at maximum (1.3×) — so dragging visibly brightens it.
  const fillEmit = (accent ? 0.8 : 0) * (0.7 + 0.6 * val);
  const fillRef = useGIShape({
    height: -0.3,
    bevel: 3,
    cornerRadius: 4,
    albedo: accent ?? INSET_ALBEDO,
    tint: 1,
    emission: accent ? [accent[0] * fillEmit, accent[1] * fillEmit, accent[2] * fillEmit] : [0, 0, 0],
    displayScale: 8,
    live: true,
  });
  // Dark raised handle -- a dark dot at the end of the bright fill.
  const knobRef = useGIShape({
    kind: "circle",
    albedo: [0.05, 0.055, 0.07],
    tint: 1,
    height: 1.1,
    bevel: 6,
    live: true,
  });

  const setFromEvent = (e: ReactPointerEvent) => {
    const el = trackRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setVal(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)));
  };
  const onDown = (e: ReactPointerEvent) => {
    dragging.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setFromEvent(e);
  };
  const onMove = (e: ReactPointerEvent) => {
    if (dragging.current) setFromEvent(e);
  };
  const onUp = () => {
    dragging.current = false;
  };

  return (
    <div
      ref={trackRef as React.RefObject<HTMLDivElement>}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      style={{
        position: "relative",
        width,
        height: 10,
        borderRadius: 4,
        cursor: "pointer",
        touchAction: "none",
        flex: "none",
        pointerEvents: "auto",
      }}
    >
      <div
        ref={fillRef as React.RefObject<HTMLDivElement>}
        style={{
          position: "absolute",
          left: 0,
          top: "50%",
          height: 8,
          marginTop: -4,
          width: fillW,
          borderRadius: 4,
        }}
      />
      <div
        ref={knobRef as React.RefObject<HTMLDivElement>}
        style={{
          position: "absolute",
          top: "50%",
          left: knob / 2 + val * (width - knob),
          width: knob,
          height: knob,
          marginTop: -knob / 2,
          marginLeft: -knob / 2,
          borderRadius: knob / 2,
        }}
      />
    </div>
  );
}

// ============================================================================
// Component zoo — a broader kit, all built from the same three GI primitives:
//   • carved well   (dark INSET albedo, tint:1, negative height)  → inputs, tracks
//   • raised chip   (SURFACE albedo, positive height)             → buttons, tiles
//   • emissive accent (accent albedo + glow, high displayScale)   → active states
// Conditional GI shapes are always mounted and toggled via emission/bodyAlpha
// (never conditionally rendered) so nothing lingers when a state turns off.
// ============================================================================

const ACCENT: Vec3 = [0.05, 0.4, 0.85];

const scale = (v: Vec3, k: number): Vec3 => [v[0] * k, v[1] * k, v[2] * k];

// --- Checkbox: carved box that fills with a glowing accent when checked ------

export function GICheckbox({
  accent: accentProp,
  defaultChecked = false,
  size = 22,
  onChange,
}: {
  accent?: Vec3;
  defaultChecked?: boolean;
  size?: number;
  onChange?: (checked: boolean) => void;
}) {
  const accent = useAccent(accentProp);
  const [on, setOn] = useState(defaultChecked);
  const ref = useGIShape({
    albedo: on ? accent : INSET_ALBEDO,
    tint: 1,
    // Modest display glow so the checkmark stays legible; it still pours full
    // emission into the bounce (displayScale decouples own-face brightness).
    emission: on ? scale(accent, 0.5) : [0, 0, 0],
    displayScale: 4,
    height: on ? 0.5 : -0.4, // carved when off, raised & bright when on
    bevel: 4,
    cornerRadius: 6,
  });
  return (
    <div
      ref={ref as React.RefObject<HTMLDivElement>}
      onClick={() => setOn((v) => { const n = !v; onChange?.(n); return n; })}
      style={{
        position: "relative",
        width: size,
        height: size,
        borderRadius: 6,
        cursor: "pointer",
        flex: "none",
        pointerEvents: "auto",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {on && (
        <span style={{ color: "rgba(6,12,26,0.9)", fontSize: size * 0.6, fontWeight: 800, lineHeight: 1 }}>
          ✓
        </span>
      )}
    </div>
  );
}

// --- Radio group: dark carved wells, the selected one holds a glowing dot ----

function GIRadio({
  label,
  checked,
  accent,
  size,
  onSelect,
}: {
  label: string;
  checked: boolean;
  accent: Vec3;
  size: number;
  onSelect: () => void;
}) {
  const ringRef = useGIShape({ kind: "circle", albedo: INSET_ALBEDO, tint: 1, height: -0.4, bevel: 4 });
  // Dot is always mounted; when unselected bodyAlpha:0 makes it fully invisible.
  const dotRef = useGIShape({
    kind: "circle",
    albedo: accent,
    tint: 1,
    emission: checked ? scale(accent, 0.75) : [0, 0, 0],
    displayScale: 8,
    height: 0.5,
    bevel: 3,
    bodyAlpha: checked ? 1 : 0,
  });
  return (
    <div onClick={onSelect} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", pointerEvents: "auto" }}>
      <div ref={ringRef as React.RefObject<HTMLDivElement>} style={{ position: "relative", width: size, height: size, borderRadius: "50%", flex: "none" }}>
        <div ref={dotRef as React.RefObject<HTMLDivElement>} style={{ position: "absolute", left: "28%", top: "28%", width: "44%", height: "44%", borderRadius: "50%" }} />
      </div>
      <span style={{ fontSize: 13, color: "rgba(200,208,226,0.82)" }}>{label}</span>
    </div>
  );
}

export function GIRadioGroup({
  options,
  defaultValue,
  accent: accentProp,
  size = 22,
}: {
  options: { label: string; value: string }[];
  defaultValue?: string;
  accent?: Vec3;
  size?: number;
}) {
  const accent = useAccent(accentProp);
  const [val, setVal] = useState(defaultValue ?? options[0]?.value);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {options.map((o) => (
        <GIRadio key={o.value} label={o.label} checked={val === o.value} accent={accent} size={size} onSelect={() => setVal(o.value)} />
      ))}
    </div>
  );
}

// --- Badge: a small chip. accent = deep glow, solid = bright, neutral = gray -

export function GIBadge({
  children,
  accent: accentProp,
  variant = "accent",
}: {
  children?: ReactNode;
  accent?: Vec3;
  variant?: "accent" | "solid" | "neutral";
}) {
  const accent = useAccent(accentProp);
  const isAccent = variant !== "neutral";
  const albedo: Vec3 =
    variant === "solid" ? accent : variant === "accent" ? scale(accent, 0.55) : [0.09, 0.095, 0.11];
  const emission: Vec3 =
    variant === "solid" ? scale(accent, 0.7) : variant === "accent" ? scale(accent, 0.5) : [0, 0, 0];
  const ref = useGIShape({
    albedo,
    tint: isAccent ? 1 : 0,
    emission,
    displayScale: variant === "solid" ? 8 : 0.35,
    height: 0.9,
    bevel: 5,
    cornerRadius: 999,
  });
  return (
    <span
      ref={ref as React.RefObject<HTMLSpanElement>}
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "3px 11px",
        borderRadius: 999,
        fontSize: 11.5,
        fontWeight: 650,
        letterSpacing: 0.2,
        color: variant === "solid" ? "rgba(8,14,28,0.92)" : "rgba(212,222,240,0.9)",
      }}
    >
      {children}
    </span>
  );
}

// --- Tag: a neutral pill with a removable × ---------------------------------

export function GITag({
  children,
  onClick,
  onRemove,
}: {
  children?: ReactNode;
  onClick?: () => void;
  onRemove?: () => void;
}) {
  const ref = useGIShape({ albedo: [0.075, 0.08, 0.095], height: 0.7, bevel: 5, cornerRadius: 999 });
  return (
    <span
      ref={ref as React.RefObject<HTMLSpanElement>}
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: onRemove ? "4px 6px 4px 11px" : "4px 11px",
        borderRadius: 999,
        fontSize: 12,
        color: "rgba(206,216,236,0.88)",
        pointerEvents: "auto",
        cursor: onClick ? "pointer" : "default",
      }}
    >
      {children}
      {onRemove && (
        <span
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          style={{ cursor: "pointer", opacity: 0.6, fontSize: 14, lineHeight: 1, padding: "0 2px" }}
        >
          ×
        </span>
      )}
    </span>
  );
}

// --- Kbd: a tiny raised key cap ---------------------------------------------

export function GIKbd({ children }: { children?: ReactNode }) {
  const ref = useGIShape({ albedo: [0.08, 0.085, 0.1], height: 1.1, bevel: 4, cornerRadius: 5 });
  return (
    <span
      ref={ref as React.RefObject<HTMLSpanElement>}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 20,
        padding: "3px 7px",
        borderRadius: 5,
        fontSize: 11,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        color: "rgba(210,218,236,0.9)",
      }}
    >
      {children}
    </span>
  );
}

// --- Avatar: a raised disc with initials + an optional emissive status dot ---

export function GIAvatar({
  initials,
  size = 44,
  accent,
  status,
}: {
  initials?: string;
  size?: number;
  accent?: Vec3;
  status?: Vec3; // status-dot colour; omit for none
}) {
  const ref = useGIShape({
    kind: "circle",
    albedo: accent ? scale(accent, 0.5) : [0.095, 0.1, 0.12],
    tint: accent ? 1 : 0,
    height: 1.2,
    bevel: 6,
  });
  const dot = status ?? ([0, 0, 0] as Vec3);
  const dotRef = useGIShape({
    kind: "circle",
    albedo: dot,
    tint: 1,
    emission: scale(dot, 0.8),
    displayScale: 8,
    height: 0.5,
    bevel: 2,
    bodyAlpha: status ? 1 : 0,
  });
  return (
    <div
      ref={ref as React.RefObject<HTMLDivElement>}
      style={{
        position: "relative",
        width: size,
        height: size,
        borderRadius: "50%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size * 0.34,
        fontWeight: 650,
        color: "rgba(214,222,240,0.9)",
        flex: "none",
      }}
    >
      {initials}
      <div
        ref={dotRef as React.RefObject<HTMLDivElement>}
        style={{ position: "absolute", right: "2%", bottom: "2%", width: size * 0.28, height: size * 0.28, borderRadius: "50%" }}
      />
    </div>
  );
}

// --- Select: a carved field showing a value + chevron (glows on hover) -------

// One row of the open menu: flat by default, a glowing accent highlight when
// hovered or selected (its own GI shape, smaller-area than the menu panel so it
// paints over it).
function GIMenuRow({
  label,
  selected,
  accent,
  onPick,
}: {
  label: string;
  selected: boolean;
  accent: Vec3;
  onPick: (v: string) => void;
}) {
  const [hover, setHover] = useState(false);
  const active = hover || selected;
  const ref = useGIShape({
    albedo: active ? accent : SURFACE_ALBEDO,
    tint: active ? 1 : 0,
    emission: active ? scale(accent, hover ? 0.5 : 0.32) : [0, 0, 0],
    displayScale: 6,
    height: 0.25,
    bevel: 4,
    cornerRadius: 5,
  });
  return (
    <div
      ref={ref as React.RefObject<HTMLDivElement>}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      onClick={() => onPick(label)}
      style={{
        padding: "8px 11px",
        borderRadius: 5,
        fontSize: 12.5,
        cursor: "pointer",
        pointerEvents: "auto",
        color: active ? "rgba(10,16,30,0.92)" : "rgba(200,210,230,0.85)",
      }}
    >
      {label}
    </div>
  );
}

export function GISelect({
  value,
  options = [],
  accent: accentProp,
  width = 190,
  onChange,
  defaultOpen = false,
}: {
  value?: string;
  options?: string[];
  accent?: Vec3;
  width?: number;
  onChange?: (v: string) => void;
  defaultOpen?: boolean;
}) {
  const accent = useAccent(accentProp);
  const [open, setOpen] = useState(defaultOpen);
  const [sel, setSel] = useState(value ?? options[0]);
  const [hover, setHover] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const active = open || hover;
  const ref = useGIShape({
    albedo: INSET_ALBEDO,
    tint: 1,
    emission: scale(accent, active ? 0.14 : 0),
    displayScale: 3.5,
    height: -0.4,
    bevel: 4,
    cornerRadius: 5,
  });

  // Close when clicking outside the control.
  useEffect(() => {
    if (!open) return;
    const onDoc = (ev: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(ev.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDoc);
    return () => document.removeEventListener("pointerdown", onDoc);
  }, [open]);

  const pick = (v: string) => {
    setSel(v);
    onChange?.(v);
    setOpen(false);
  };

  return (
    <div ref={wrapRef} style={{ position: "relative", width }}>
      <div
        ref={ref as React.RefObject<HTMLDivElement>}
        onClick={() => setOpen((o) => !o)}
        onPointerEnter={() => setHover(true)}
        onPointerLeave={() => setHover(false)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width,
          padding: "10px 12px",
          borderRadius: 5,
          fontSize: 13,
          color: "rgba(206,216,236,0.9)",
          cursor: "pointer",
          pointerEvents: "auto",
        }}
      >
        <span>{sel}</span>
        <span style={{ opacity: 0.6, fontSize: 10, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.18s" }}>▼</span>
      </div>
      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 8px)", left: 0, width, zIndex: 30, borderRadius: 9, backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)" }}>
          <Surface style={{ padding: 5 }} radius={9} heightScale={1.2} layer={1}>
            {options.map((o) => (
              <GIMenuRow key={o} label={o} selected={o === sel} accent={accent} onPick={pick} />
            ))}
          </Surface>
        </div>
      )}
    </div>
  );
}

// --- Textarea: a taller carved well (a real multiline input) -----------------

export function GITextarea({
  placeholder,
  rows = 3,
  accent: accentProp,
  style,
}: {
  placeholder?: string;
  rows?: number;
  accent?: Vec3;
  style?: CSSProperties;
}) {
  const accent = useAccent(accentProp);
  const [focus, setFocus] = useState(false);
  const [hover, setHover] = useState(false);
  const active = focus ? 1 : hover ? 0.35 : 0;
  const e = active * 0.16;
  const ref = useGIShape({
    albedo: INSET_ALBEDO,
    tint: 1,
    emission: scale(accent, e),
    displayScale: 3.5,
    height: -0.4 + active * 0.12,
    bevel: 4,
    cornerRadius: 6,
  });
  return (
    <textarea
      ref={ref as React.RefObject<HTMLTextAreaElement>}
      className="gi-field"
      placeholder={placeholder}
      rows={rows}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      style={{
        boxSizing: "border-box",
        width: "100%",
        borderRadius: 6,
        padding: "9px 12px",
        fontSize: 13,
        fontFamily: "inherit",
        lineHeight: 1.5,
        color: "rgba(210,220,238,0.92)",
        background: "transparent",
        border: "none",
        outline: "none",
        resize: "none",
        appearance: "none",
        pointerEvents: "auto",
        ...style,
      }}
    />
  );
}

// --- Progress: a carved groove with a glowing accent fill --------------------

export function GIProgress({
  value = 0.6,
  accent: accentProp,
  width = 200,
  indeterminate = false,
}: {
  value?: number;
  accent?: Vec3;
  width?: number;
  indeterminate?: boolean;
}) {
  const accent = useAccent(accentProp);
  const v = Math.min(1, Math.max(0, value));
  const trackRef = useGIShape({ height: -0.35, bevel: 3, cornerRadius: 5, albedo: INSET_ALBEDO, tint: 1 });
  // The fill is a real DOM element; when indeterminate it's CSS-animated (a glow
  // that sweeps the track) and `live` so the GI shape tracks it every frame.
  const fillRef = useGIShape({
    height: -0.28,
    bevel: 2,
    cornerRadius: 5,
    albedo: accent,
    tint: 1,
    emission: scale(accent, 0.8),
    displayScale: 8,
    live: indeterminate,
  });
  return (
    <div
      ref={trackRef as React.RefObject<HTMLDivElement>}
      style={{ position: "relative", width, height: 10, borderRadius: 5, flex: "none" }}
    >
      <div
        ref={fillRef as React.RefObject<HTMLDivElement>}
        className={indeterminate ? "gi-progress-sweep" : undefined}
        style={
          indeterminate
            ? { position: "absolute", top: 1, height: 8, width: "30%", borderRadius: 5 }
            : { position: "absolute", left: 0, top: 1, height: 8, width: Math.max(8, v * width), borderRadius: 5 }
        }
      />
    </div>
  );
}

// --- Loading dots: a row of emissive pips at staggered brightness ------------
// Static (keeps idle GPU-free); staggered emission reads as a frozen pulse.

export function GIDots({
  accent: accentProp,
  count = 3,
  size = 10,
  animated = true,
}: {
  accent?: Vec3;
  count?: number;
  size?: number;
  animated?: boolean;
}) {
  const accent = useAccent(accentProp);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      {Array.from({ length: count }).map((_, i) => (
        <GIDot
          key={i}
          accent={accent}
          size={size}
          g={animated ? 0.7 : [0.85, 0.5, 0.28][i % 3]}
          delay={i * 0.16}
          animated={animated}
        />
      ))}
    </div>
  );
}

// Each dot CSS-pulses in scale (staggered); `live` makes the GI circle track the
// scaled box, so the glow breathes in place.
function GIDot({ accent, size, g, delay, animated }: { accent: Vec3; size: number; g: number; delay: number; animated: boolean }) {
  const ref = useGIShape({ kind: "circle", albedo: accent, tint: 1, emission: scale(accent, g), displayScale: 8, height: 0.5, bevel: 3, live: animated });
  return (
    <div
      ref={ref as React.RefObject<HTMLDivElement>}
      className={animated ? "gi-dot-pulse" : undefined}
      style={{ width: size, height: size, borderRadius: "50%", flex: "none", animationDelay: animated ? `${delay}s` : undefined }}
    />
  );
}

// --- Rating: clickable pips; filled = glowing accent, empty = carved dark ----

function GIPip({ filled, accent, size, onClick }: { filled: boolean; accent: Vec3; size: number; onClick: () => void }) {
  const ref = useGIShape({
    kind: "circle",
    albedo: filled ? accent : INSET_ALBEDO,
    tint: 1,
    emission: filled ? scale(accent, 0.7) : [0, 0, 0],
    displayScale: 8,
    height: filled ? 0.5 : -0.35,
    bevel: 3,
  });
  return <div ref={ref as React.RefObject<HTMLDivElement>} onClick={onClick} style={{ width: size, height: size, borderRadius: "50%", cursor: "pointer", flex: "none" }} />;
}

export function GIRating({
  accent: accentProp,
  count = 5,
  defaultValue = 3,
  size = 18,
}: {
  accent?: Vec3;
  count?: number;
  defaultValue?: number;
  size?: number;
}) {
  const accent = useAccent(accentProp);
  const [val, setVal] = useState(defaultValue);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9, pointerEvents: "auto" }}>
      {Array.from({ length: count }).map((_, i) => (
        <GIPip key={i} filled={i < val} accent={accent} size={size} onClick={() => setVal(i + 1)} />
      ))}
    </div>
  );
}

// --- Alert / callout: a raised card with a glowing accent bar down its edge --

export function GIAlert({
  title,
  children,
  accent: accentProp,
}: {
  title?: string;
  children?: ReactNode;
  accent?: Vec3;
}) {
  const accent = useAccent(accentProp);
  const cardRef = useGIShape({ albedo: SURFACE_ALBEDO, height: 0.9, bevel: 16, heightScale: 1.0, opacity: 0.5, cornerRadius: 10 });
  const barRef = useGIShape({
    albedo: accent,
    tint: 1,
    emission: scale(accent, 0.7),
    displayScale: 8,
    height: 0.5,
    bevel: 2,
    cornerRadius: 3,
  });
  return (
    <div
      ref={cardRef as React.RefObject<HTMLDivElement>}
      style={{ position: "relative", padding: "11px 14px 11px 20px", borderRadius: 8, overflow: "hidden" }}
    >
      <div
        ref={barRef as React.RefObject<HTMLDivElement>}
        style={{ position: "absolute", left: 7, top: 12, bottom: 12, width: 4, borderRadius: 3 }}
      />
      {title && <div style={{ fontSize: 13, fontWeight: 650, color: "rgba(220,228,242,0.92)", marginBottom: 3 }}>{title}</div>}
      <div style={{ fontSize: 12, color: "rgba(178,188,208,0.75)", lineHeight: 1.5 }}>{children}</div>
    </div>
  );
}

// --- Segmented control / tabs: carved track, a glowing thumb slides to active-

export function GISegmented({
  options,
  defaultIndex = 0,
  index,
  onChange,
  accent: accentProp,
  width = 240,
  matte = false,
}: {
  options: string[];
  defaultIndex?: number;
  /** Controlled active index (e.g. for routing); omit for internal state. */
  index?: number;
  onChange?: (i: number) => void;
  accent?: Vec3;
  width?: number;
  /** Receive no GI bounce (e.g. sitting over a backlight it should ignore). */
  matte?: boolean;
}) {
  const accent = useAccent(accentProp);
  const [internal, setInternal] = useState(defaultIndex);
  const idx = index ?? internal;
  const setIdx = (i: number) => {
    setInternal(i);
    onChange?.(i);
  };
  const n = Math.max(1, options.length);
  const pad = 3;
  const segW = (width - pad * 2) / n;
  const trackRef = useGIShape({ height: -0.35, bevel: 4, cornerRadius: 9, albedo: INSET_ALBEDO, tint: 1, matte });
  // Raised accent thumb; smaller area than the track, so it paints over it.
  const thumbRef = useGIShape({
    albedo: accent,
    tint: 1,
    matte, // still emits its accent; just doesn't receive the backlight
    emission: scale(accent, 0.4),
    displayScale: 8,
    height: 0.6,
    bevel: 4,
    cornerRadius: 6,
    live: true, // tracks the CSS-animated slide
  });
  return (
    <div
      ref={trackRef as React.RefObject<HTMLDivElement>}
      style={{ position: "relative", width, height: 32, borderRadius: 8, display: "flex", padding: pad, flex: "none", pointerEvents: "auto" }}
    >
      <div
        ref={thumbRef as React.RefObject<HTMLDivElement>}
        style={{
          position: "absolute",
          top: pad,
          left: pad + idx * segW,
          width: segW,
          height: 32 - pad * 2,
          borderRadius: 6,
          transition: "left 0.22s cubic-bezier(0.3,0.9,0.3,1)",
        }}
      />
      {options.map((o, i) => (
        <div
          key={o}
          onClick={() => setIdx(i)}
          style={{
            position: "relative",
            width: segW,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 12.5,
            fontWeight: i === idx ? 650 : 500,
            color: i === idx ? "rgba(10,16,30,0.92)" : "rgba(188,198,218,0.72)",
            cursor: "pointer",
            pointerEvents: "auto",
            userSelect: "none",
          }}
        >
          {o}
        </div>
      ))}
    </div>
  );
}

// --- Light: a subtle, draggable accent glow ---------------------------------

export function GILight({
  color = [0.55, 0.7, 1.0],
  intensity = 0.7,
  size = 26,
  position,
  onChange,
  visible = true,
}: {
  color?: Vec3;
  intensity?: number;
  size?: number;
  position: { x: number; y: number }; // controlled, so the owner can persist it
  onChange: (p: { x: number; y: number }) => void;
  visible?: boolean;
}) {
  const dragging = useRef(false);
  const offset = useRef({ x: 0, y: 0 });

  const ref = useGIShape({
    kind: "circle",
    albedo: [0.2, 0.2, 0.22],
    emission: [color[0] * intensity, color[1] * intensity, color[2] * intensity],
    opacity: 1,
    height: 0.6,
    bevel: 4,
    rawGlow: true, // lights keep their own intensity, ignore the component master
    bodyAlpha: visible ? 1 : 0, // hide the orb entirely while it still lights the scene
  });

  const onDown = (e: ReactPointerEvent) => {
    dragging.current = true;
    offset.current = { x: e.clientX - position.x, y: e.clientY - position.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: ReactPointerEvent) => {
    if (!dragging.current) return;
    onChange({ x: e.clientX - offset.current.x, y: e.clientY - offset.current.y });
  };
  const onUp = () => {
    dragging.current = false;
  };

  return (
    <div
      ref={ref as React.RefObject<HTMLDivElement>}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      title="Drag me"
      style={{
        // Absolute in content space: the orb scrolls with the page and its GI
        // shape, so light and content stay locked together. Drag is delta-based
        // (offset captured on pointerdown), so it stays correct while scrolled.
        position: "absolute",
        left: position.x - size / 2,
        top: position.y - size / 2,
        width: size,
        height: size,
        borderRadius: "50%",
        cursor: "grab",
        touchAction: "none",
      }}
    />
  );
}

// ============================================================================
// Extended kit — broader scenario coverage. Same three GI recipes throughout.
// Active states read mainly via accent ALBEDO (tint:1); emission adds a subtle
// glow (componentGlow is low by default, so albedo carries the colour).
// ============================================================================

// --- Divider: a thin carved rule -------------------------------------------

export function GIDivider({ vertical = false, length = "100%" }: { vertical?: boolean; length?: number | string }) {
  const ref = useGIShape({ albedo: INSET_ALBEDO, tint: 1, height: -0.3, bevel: 2, cornerRadius: 2, heightScale: 0.7 });
  return (
    <div
      ref={ref as React.RefObject<HTMLDivElement>}
      // Horizontal: shrinkable (default flex shrink + minWidth:0) so two
      // dividers in a flex row (e.g. an "OR" separator) share the row instead of
      // each demanding 100% width and OVERFLOWING into the next component — GI
      // shapes render on the full-page canvas, so an overflow drew a carved line
      // straight across the neighbouring card. In block context this is a no-op.
      style={vertical ? { width: 2, height: length, borderRadius: 2, flex: "none" } : { width: length, height: 2, borderRadius: 2, minWidth: 0 }}
    />
  );
}

// --- Tooltip: hover reveals a small raised bubble ---------------------------

export function GITooltip({ label, children }: { label: string; children: ReactNode }) {
  const [show, setShow] = useState(false);
  const ref = useGIShape({ albedo: [0.11, 0.12, 0.15], height: 1.0, bevel: 6, heightScale: 1.2, opacity: 0.6, cornerRadius: 7, bodyAlpha: show ? 1 : 0, layer: 1 });
  return (
    <span style={{ position: "relative", display: "inline-flex", pointerEvents: "auto" }} onPointerEnter={() => setShow(true)} onPointerLeave={() => setShow(false)}>
      {children}
      <span
        ref={ref as React.RefObject<HTMLSpanElement>}
        style={{
          position: "absolute", bottom: "calc(100% + 9px)", left: "50%", transform: "translateX(-50%)",
          padding: "6px 11px", borderRadius: 7, fontSize: 12, whiteSpace: "nowrap",
          color: "rgba(214,222,240,0.92)", pointerEvents: "none",
          opacity: show ? 1 : 0, transition: "opacity 0.14s", zIndex: 40,
        }}
      >
        {label}
      </span>
    </span>
  );
}

// --- Spinner: a bright dot orbiting -----------------------------------------

export function GISpinner({ accent: accentProp, size = 26 }: { accent?: Vec3; size?: number }) {
  const accent = useAccent(accentProp);
  const dot = Math.max(6, Math.round(size * 0.26));
  const ref = useGIShape({ kind: "circle", albedo: accent, tint: 1, emission: scale(accent, 0.8), displayScale: 8, height: 0.5, bevel: 3, live: true });
  return (
    <div className="gi-spin" style={{ position: "relative", width: size, height: size, flex: "none" }}>
      <div ref={ref as React.RefObject<HTMLDivElement>} style={{ position: "absolute", top: 0, left: "50%", marginLeft: -dot / 2, width: dot, height: dot, borderRadius: "50%" }} />
    </div>
  );
}

// --- Skeleton: carved placeholder lines -------------------------------------

function GISkelLine({ w }: { w: number | string }) {
  const ref = useGIShape({ albedo: INSET_ALBEDO, tint: 1, height: -0.3, bevel: 3, cornerRadius: 6, heightScale: 0.8 });
  return <div ref={ref as React.RefObject<HTMLDivElement>} style={{ width: w, height: 11, borderRadius: 6 }} />;
}

export function GISkeleton({ lines = 3, width = 220 }: { lines?: number; width?: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, width }}>
      {Array.from({ length: lines }).map((_, i) => (
        <GISkelLine key={i} w={i === lines - 1 ? "62%" : "100%"} />
      ))}
    </div>
  );
}

// --- Tabs: underline style, a glowing accent bar slides to the active tab ----

export function GITabs({
  options,
  defaultIndex = 0,
  index,
  onChange,
  accent: accentProp,
  width = 300,
}: {
  options: string[];
  defaultIndex?: number;
  /** Controlled active index (e.g. for routing); omit for internal state. */
  index?: number;
  onChange?: (i: number) => void;
  accent?: Vec3;
  width?: number;
}) {
  const accent = useAccent(accentProp);
  const [internal, setInternal] = useState(defaultIndex);
  const idx = index ?? internal;
  const pick = (i: number) => {
    setInternal(i);
    onChange?.(i);
  };
  const n = Math.max(1, options.length);
  const segW = width / n;
  const underlineRef = useGIShape({ albedo: accent, tint: 1, emission: scale(accent, 0.7), displayScale: 8, height: 0.4, bevel: 3, cornerRadius: 2, live: true });
  return (
    <div style={{ position: "relative", width }}>
      <div style={{ display: "flex" }}>
        {options.map((o, i) => (
          <div key={o} onClick={() => pick(i)} style={{ width: segW, textAlign: "center", padding: "8px 0", fontSize: 13, fontWeight: i === idx ? 650 : 500, color: i === idx ? "rgba(220,228,244,0.95)" : "rgba(160,170,190,0.7)", cursor: "pointer", pointerEvents: "auto", userSelect: "none" }}>
            {o}
          </div>
        ))}
      </div>
      <div ref={underlineRef as React.RefObject<HTMLDivElement>} style={{ position: "absolute", bottom: 0, left: idx * segW + segW * 0.2, width: segW * 0.6, height: 3, borderRadius: 2, transition: "left 0.2s cubic-bezier(0.3,0.9,0.3,1)" }} />
    </div>
  );
}

// --- Breadcrumb -------------------------------------------------------------

export function GIBreadcrumb({ items }: { items: string[] }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 13 }}>
      {items.map((it, i) => {
        const last = i === items.length - 1;
        return (
          <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: last ? "rgba(220,228,244,0.95)" : "rgba(150,162,184,0.7)", fontWeight: last ? 600 : 400, cursor: last ? "default" : "pointer", pointerEvents: "auto" }}>{it}</span>
            {!last && <span style={{ color: "rgba(120,130,150,0.5)" }}>›</span>}
          </span>
        );
      })}
    </div>
  );
}

// --- Pagination -------------------------------------------------------------

function GIPageBtn({ label, active = false, accent = ACCENT, onClick }: { label: string; active?: boolean; accent?: Vec3; onClick: () => void }) {
  const [hover, setHover] = useState(false);
  const ref = useGIShape({
    albedo: active ? accent : hover ? [0.09, 0.095, 0.11] : SURFACE_ALBEDO,
    tint: active ? 1 : 0,
    emission: active ? scale(accent, 0.5) : [0, 0, 0],
    displayScale: 6,
    height: active ? 0.7 : 0.5,
    bevel: 4,
    cornerRadius: 6,
  });
  return (
    <div
      ref={ref as React.RefObject<HTMLDivElement>}
      onClick={onClick}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      style={{ minWidth: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 6, fontSize: 12.5, fontWeight: active ? 650 : 500, color: active ? "rgba(10,16,30,0.92)" : "rgba(200,210,228,0.82)", cursor: "pointer", pointerEvents: "auto" }}
    >
      {label}
    </div>
  );
}

export function GIPagination({ pages = 5, defaultPage = 1, accent: accentProp }: { pages?: number; defaultPage?: number; accent?: Vec3 }) {
  const accent = useAccent(accentProp);
  const [page, setPage] = useState(defaultPage);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7, pointerEvents: "auto" }}>
      <GIPageBtn label="‹" onClick={() => setPage((p) => Math.max(1, p - 1))} />
      {Array.from({ length: pages }).map((_, i) => (
        <GIPageBtn key={i} label={String(i + 1)} active={page === i + 1} accent={accent} onClick={() => setPage(i + 1)} />
      ))}
      <GIPageBtn label="›" onClick={() => setPage((p) => Math.min(pages, p + 1))} />
    </div>
  );
}

// --- Accordion --------------------------------------------------------------

function GIAccordionItem({ title, body, open, onToggle }: { title: string; body: string; open: boolean; onToggle: () => void }) {
  const headRef = useGIShape({ albedo: SURFACE_ALBEDO, height: 0.7, bevel: 8, heightScale: 1.0, opacity: 0.5, cornerRadius: 8 });
  return (
    <div>
      <div
        ref={headRef as React.RefObject<HTMLDivElement>}
        onClick={onToggle}
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "11px 14px", borderRadius: 8, cursor: "pointer", pointerEvents: "auto", fontSize: 13, fontWeight: 600, color: "rgba(214,222,240,0.9)" }}
      >
        {title}
        <span style={{ opacity: 0.55, fontSize: 11, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>▼</span>
      </div>
      <div style={{ maxHeight: open ? 140 : 0, overflow: "hidden", transition: "max-height 0.25s ease" }}>
        <div style={{ padding: "10px 14px 4px", fontSize: 12.5, lineHeight: 1.5, color: "rgba(170,180,200,0.72)" }}>{body}</div>
      </div>
    </div>
  );
}

export function GIAccordion({ items }: { items: { title: string; body: string }[] }) {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%" }}>
      {items.map((it, i) => (
        <GIAccordionItem key={i} title={it.title} body={it.body} open={open === i} onToggle={() => setOpen((o) => (o === i ? null : i))} />
      ))}
    </div>
  );
}

// --- Stat: a metric card (value + label + delta badge) ----------------------

export function GIStat({ label, value, delta, accent: accentProp, width = 180 }: { label: string; value: string; delta?: string; accent?: Vec3; width?: number }) {
  const accent = useAccent(accentProp);
  return (
    <Surface style={{ padding: "13px 15px", width }} radius={9}>
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.07em", color: "rgba(150,162,184,0.65)" }}>{label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 6 }}>
        <div style={{ fontSize: 26, fontWeight: 700, color: "rgba(226,232,246,0.96)" }}>{value}</div>
        {delta && <GIBadge variant="accent" accent={accent}>{delta}</GIBadge>}
      </div>
    </Surface>
  );
}

// --- Menu: a button that opens an action menu (reuses the select rows) -------

export function GIMenu({ label = "Actions", items, accent: accentProp, width = 170, onPick }: { label?: string; items: string[]; accent?: Vec3; width?: number; onPick?: (v: string) => void }) {
  const accent = useAccent(accentProp);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (ev: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(ev.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDoc);
    return () => document.removeEventListener("pointerdown", onDoc);
  }, [open]);
  return (
    <div ref={wrapRef} style={{ position: "relative", display: "inline-block" }}>
      <GIButton accent={accent} onClick={() => setOpen((o) => !o)}>{label} ▾</GIButton>
      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 8px)", left: 0, width, zIndex: 30, borderRadius: 9, backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)" }}>
          <Surface style={{ padding: 5 }} radius={9} heightScale={1.2} layer={1}>
            {items.map((it) => (
              <GIMenuRow key={it} label={it} selected={false} accent={accent} onPick={(v) => { onPick?.(v); setOpen(false); }} />
            ))}
          </Surface>
        </div>
      )}
    </div>
  );
}

// --- Stepper: a number input with - / + -------------------------------------

function GIStepBtn({ label, onClick }: { label: string; onClick: () => void }) {
  const [down, setDown] = useState(false);
  const ref = useGIShape({ albedo: [0.085, 0.09, 0.105], height: down ? -0.4 : 0.8, bevel: 4, cornerRadius: 6 });
  return (
    <div
      ref={ref as React.RefObject<HTMLDivElement>}
      onClick={onClick}
      onPointerDown={() => setDown(true)}
      onPointerUp={() => setDown(false)}
      onPointerLeave={() => setDown(false)}
      style={{ width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 6, fontSize: 18, color: "rgba(210,218,236,0.9)", cursor: "pointer", userSelect: "none", pointerEvents: "auto" }}
    >
      {label}
    </div>
  );
}

export function GIStepper({ defaultValue = 1, min = 0, max = 99 }: { defaultValue?: number; min?: number; max?: number }) {
  const [val, setVal] = useState(defaultValue);
  const valRef = useGIShape({ albedo: INSET_ALBEDO, tint: 1, height: -0.4, bevel: 4, cornerRadius: 6 });
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, pointerEvents: "auto" }}>
      <GIStepBtn label="−" onClick={() => setVal((v) => Math.max(min, v - 1))} />
      <div ref={valRef as React.RefObject<HTMLDivElement>} style={{ minWidth: 52, height: 34, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 6, fontSize: 14, fontWeight: 600, color: "rgba(214,222,240,0.92)" }}>{val}</div>
      <GIStepBtn label="+" onClick={() => setVal((v) => Math.min(max, v + 1))} />
    </div>
  );
}

// --- Range: a dual-handle slider --------------------------------------------

export function GIRange({ accent: accentProp, width = 200, initial = [0.3, 0.7] }: { accent?: Vec3; width?: number; initial?: [number, number] }) {
  const accent = useAccent(accentProp);
  const [lo, setLo] = useState(initial[0]);
  const [hi, setHi] = useState(initial[1]);
  const trackRef = useGIShape({ height: -0.35, bevel: 4, cornerRadius: 4, albedo: INSET_ALBEDO, tint: 1, live: true });
  const fillRef = useGIShape({ height: -0.3, bevel: 3, cornerRadius: 4, albedo: accent, tint: 1, emission: scale(accent, 0.7), displayScale: 8, live: true });
  const loRef = useGIShape({ kind: "circle", albedo: [0.05, 0.055, 0.07], tint: 1, height: 1.1, bevel: 6, live: true });
  const hiRef = useGIShape({ kind: "circle", albedo: [0.05, 0.055, 0.07], tint: 1, height: 1.1, bevel: 6, live: true });
  const knob = 18;
  const drag = useRef<null | "lo" | "hi">(null);
  const setFrom = (e: ReactPointerEvent) => {
    const el = trackRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const t = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    if (drag.current === "lo") setLo(Math.min(t, hi));
    else if (drag.current === "hi") setHi(Math.max(t, lo));
  };
  const loX = lo * (width - knob);
  const hiX = hi * (width - knob);
  return (
    <div
      ref={trackRef as React.RefObject<HTMLDivElement>}
      onPointerMove={(e) => drag.current && setFrom(e)}
      onPointerUp={() => (drag.current = null)}
      style={{ position: "relative", width, height: 10, borderRadius: 4, touchAction: "none", flex: "none", pointerEvents: "auto" }}
    >
      <div ref={fillRef as React.RefObject<HTMLDivElement>} style={{ position: "absolute", top: "50%", marginTop: -4, height: 8, left: loX + knob / 2, width: Math.max(2, hiX - loX), borderRadius: 4 }} />
      <div
        ref={loRef as React.RefObject<HTMLDivElement>}
        onPointerDown={(e) => { drag.current = "lo"; (e.target as HTMLElement).setPointerCapture(e.pointerId); }}
        style={{ position: "absolute", top: "50%", marginTop: -knob / 2, left: loX, width: knob, height: knob, borderRadius: "50%", cursor: "pointer", pointerEvents: "auto" }}
      />
      <div
        ref={hiRef as React.RefObject<HTMLDivElement>}
        onPointerDown={(e) => { drag.current = "hi"; (e.target as HTMLElement).setPointerCapture(e.pointerId); }}
        style={{ position: "absolute", top: "50%", marginTop: -knob / 2, left: hiX, width: knob, height: knob, borderRadius: "50%", cursor: "pointer", pointerEvents: "auto" }}
      />
    </div>
  );
}

// --- Search: a field with a leading glyph and a clear button ----------------

export function GISearch({ placeholder = "Search…", accent: accentProp, width = 220 }: { placeholder?: string; accent?: Vec3; width?: number }) {
  const accent = useAccent(accentProp);
  const [focus, setFocus] = useState(false);
  const [val, setVal] = useState("");
  const active = focus ? 1 : 0;
  const ref = useGIShape({ albedo: INSET_ALBEDO, tint: 1, emission: scale(accent, active * 0.16), displayScale: 3.5, height: -0.4 + active * 0.12, bevel: 4, cornerRadius: 8 });
  return (
    <div ref={ref as React.RefObject<HTMLDivElement>} style={{ position: "relative", width, display: "flex", alignItems: "center", pointerEvents: "auto" }}>
      <span style={{ position: "absolute", left: 12, fontSize: 15, opacity: 0.5, pointerEvents: "none" }}>⌕</span>
      <input
        value={val}
        onChange={(e) => setVal(e.target.value)}
        placeholder={placeholder}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        className="gi-field"
        style={{ width: "100%", boxSizing: "border-box", padding: "10px 30px 10px 32px", borderRadius: 8, fontSize: 13, fontFamily: "inherit", color: "rgba(210,220,238,0.92)", background: "transparent", border: "none", outline: "none", pointerEvents: "auto" }}
      />
      {val && <span onClick={() => setVal("")} style={{ position: "absolute", right: 11, fontSize: 14, opacity: 0.55, cursor: "pointer" }}>×</span>}
    </div>
  );
}

// --- Dialog: a centered, GI-lit modal panel. No dark DOM scrim — it would sit
// over the canvas and dim the panel's own lighting; a transparent click-catcher
// closes on outside click instead. -------------------------------------------

export function GIDialog({ trigger = "Open dialog", title, children, accent: accentProp, defaultOpen = false }: { trigger?: string; title?: string; children?: ReactNode; accent?: Vec3; defaultOpen?: boolean }) {
  const accent = useAccent(accentProp);
  const [open, setOpen] = useState(defaultOpen);
  return (
    <>
      <GIButton accent={accent} onClick={() => setOpen(true)}>{trigger}</GIButton>
      {open && (
        <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, pointerEvents: "auto" }}>
          {/* Scrim-with-a-hole: the huge box-shadow spread dims the page (DOM
              text AND its lighting) everywhere EXCEPT the panel rect, so the
              panel's own canvas lighting stays undimmed. The backdrop blur
              smudges any underlying DOM text inside the panel rect — the panel
              itself is painted by the canvas (layer 2), which a DOM background
              would hide. */}
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: 380, maxWidth: "90vw", borderRadius: 10, boxShadow: "0 0 0 200vmax rgba(4,6,10,0.45)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)" }}
          >
            <Surface style={{ padding: 20 }} radius={10} heightScale={1.0} layer={2}>
              {title && <div style={{ fontSize: 16, fontWeight: 650, color: "rgba(226,232,246,0.96)", marginBottom: 10 }}>{title}</div>}
              <div style={{ fontSize: 13, lineHeight: 1.55, color: "rgba(180,190,210,0.8)" }}>{children}</div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
                <GIButton onClick={() => setOpen(false)}>Cancel</GIButton>
                <GIButton accent={accent} onClick={() => setOpen(false)}>Confirm</GIButton>
              </div>
            </Surface>
          </div>
        </div>
      )}
    </>
  );
}

// --- Empty state: a carved icon well, title, hint, and an action ------------

export function GIEmptyState({ title, hint, action, accent: accentProp }: { title: string; hint?: string; action?: string; accent?: Vec3 }) {
  const accent = useAccent(accentProp);
  const iconRef = useGIShape({ kind: "circle", albedo: [0.08, 0.085, 0.1], tint: 1, height: -0.5, bevel: 8, heightScale: 1.2 });
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 10, padding: "10px 0" }}>
      <div ref={iconRef as React.RefObject<HTMLDivElement>} style={{ width: 46, height: 46, borderRadius: "50%" }} />
      <div style={{ fontSize: 14, fontWeight: 600, color: "rgba(216,224,240,0.9)" }}>{title}</div>
      {hint && <div style={{ fontSize: 12.5, color: "rgba(160,170,190,0.66)", maxWidth: 220, lineHeight: 1.5 }}>{hint}</div>}
      {action && <div style={{ marginTop: 4 }}><GIButton accent={accent}>{action}</GIButton></div>}
    </div>
  );
}

// --- Table: header + hoverable rows (row highlight is a GI accent wash) ------

function GITableRow({
  cells,
  widths,
  accent,
}: {
  cells: ReactNode[];
  widths: (number | string)[];
  accent: Vec3;
}) {
  const [hover, setHover] = useState(false);
  // Always-mounted hover wash; bodyAlpha keeps it out of the scene when idle.
  const ref = useGIShape({
    albedo: scale(accent, 0.28),
    tint: 1,
    height: 0.25,
    bevel: 4,
    cornerRadius: 6,
    bodyAlpha: hover ? 1 : 0,
  });
  return (
    <div
      ref={ref as React.RefObject<HTMLDivElement>}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      style={{ display: "flex", alignItems: "center", padding: "9px 12px", borderRadius: 6, cursor: "default", pointerEvents: "auto" }}
    >
      {cells.map((c, i) => (
        <div key={i} style={{ width: widths[i], fontSize: 12.5, color: "rgba(204,213,232,0.85)", display: "flex", alignItems: "center", gap: 8 }}>
          {c}
        </div>
      ))}
    </div>
  );
}

export function GITable({
  columns,
  rows,
  widths,
  accent: accentProp,
}: {
  columns: string[];
  rows: ReactNode[][];
  widths?: (number | string)[];
  accent?: Vec3;
}) {
  const accent = useAccent(accentProp);
  const w = widths ?? columns.map(() => `${100 / columns.length}%`);
  return (
    <div style={{ width: "100%" }}>
      <div style={{ display: "flex", padding: "4px 12px 10px" }}>
        {columns.map((c, i) => (
          <div key={c} style={{ width: w[i], fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, color: "rgba(150,162,184,0.6)" }}>
            {c}
          </div>
        ))}
      </div>
      <GIDivider />
      <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 6 }}>
        {rows.map((r, i) => (
          <GITableRow key={i} cells={r} widths={w} accent={accent} />
        ))}
      </div>
    </div>
  );
}

// --- Combobox: a searchable select — type to filter, pick from the menu ------

export function GICombobox({
  options,
  placeholder = "Type to search…",
  width = 220,
  accent: accentProp,
  onChange,
}: {
  options: string[];
  placeholder?: string;
  width?: number;
  accent?: Vec3;
  onChange?: (v: string) => void;
}) {
  const accent = useAccent(accentProp);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const fieldRef = useGIShape({
    albedo: INSET_ALBEDO,
    tint: 1,
    emission: scale(accent, open ? 0.14 : 0),
    displayScale: 3.5,
    height: -0.4,
    bevel: 4,
    cornerRadius: 5,
  });
  useEffect(() => {
    if (!open) return;
    const onDoc = (ev: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(ev.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDoc);
    return () => document.removeEventListener("pointerdown", onDoc);
  }, [open]);
  const q = query.trim().toLowerCase();
  const filtered = options.filter((o) => o.toLowerCase().includes(q)).slice(0, 6);
  const pick = (v: string) => {
    setQuery(v);
    onChange?.(v);
    setOpen(false);
  };
  return (
    <div ref={wrapRef} style={{ position: "relative", width }}>
      <div ref={fieldRef as React.RefObject<HTMLDivElement>} style={{ width, borderRadius: 5, pointerEvents: "auto" }}>
        <input
          value={query}
          placeholder={placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          className="gi-field"
          style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 5, fontSize: 13, fontFamily: "inherit", color: "rgba(210,220,238,0.92)", background: "transparent", border: "none", outline: "none", pointerEvents: "auto" }}
        />
      </div>
      {open && filtered.length > 0 && (
        <div style={{ position: "absolute", top: "calc(100% + 8px)", left: 0, width, zIndex: 30, borderRadius: 9, backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)" }}>
          <Surface style={{ padding: 5 }} radius={9} heightScale={1.2} layer={1}>
            {filtered.map((o) => (
              <GIMenuRow key={o} label={o} selected={o === query} accent={accent} onPick={pick} />
            ))}
          </Surface>
        </div>
      )}
    </div>
  );
}

// --- Date picker: month calendar; the selected day is a glowing accent disc --

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

export function GIDatePicker({
  accent: accentProp,
  initial,
  onChange,
}: {
  accent?: Vec3;
  initial?: Date;
  onChange?: (d: Date) => void;
}) {
  const accent = useAccent(accentProp);
  const [selected, setSelected] = useState<Date>(initial ?? new Date());
  const [view, setView] = useState({ y: selected.getFullYear(), m: selected.getMonth() });
  // One GI shape total: the glowing selected-day disc (day cells are plain DOM
  // so a month never costs 42 shapes). bodyAlpha hides it when the selected day
  // isn't in the viewed month.
  const inView = selected.getFullYear() === view.y && selected.getMonth() === view.m;
  const discRef = useGIShape({
    kind: "circle",
    albedo: accent,
    tint: 1,
    emission: scale(accent, 0.5),
    displayScale: 6,
    height: 0.5,
    bevel: 3,
    bodyAlpha: inView ? 1 : 0,
    live: true, // follows the disc when the selection moves between cells
  });
  const first = new Date(view.y, view.m, 1);
  const startPad = first.getDay();
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array.from({ length: startPad }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  const nav = (d: number) => {
    const m = view.m + d;
    setView({ y: view.y + Math.floor(m / 12), m: ((m % 12) + 12) % 12 });
  };
  const CELL = 32;
  const selIdx = inView ? startPad + selected.getDate() - 1 : -1;
  return (
    <div style={{ width: CELL * 7 + 16, pointerEvents: "auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 4px 10px" }}>
        <GIStepBtn label="‹" onClick={() => nav(-1)} />
        <span style={{ fontSize: 13, fontWeight: 650, color: "rgba(218,226,242,0.92)" }}>
          {MONTHS[view.m]} {view.y}
        </span>
        <GIStepBtn label="›" onClick={() => nav(1)} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(7, ${CELL}px)`, gap: 4, padding: "0 8px", position: "relative" }}>
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <div key={i} style={{ textAlign: "center", fontSize: 10, color: "rgba(150,160,182,0.55)", height: 18, lineHeight: "18px" }}>
            {d}
          </div>
        ))}
        {cells.map((day, i) => {
          const isSel = i === selIdx;
          return (
            <div
              key={i}
              onClick={
                day
                  ? () => {
                      const d = new Date(view.y, view.m, day);
                      setSelected(d);
                      onChange?.(d);
                    }
                  : undefined
              }
              style={{
                position: "relative",
                width: CELL,
                height: CELL,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: "50%",
                fontSize: 12,
                cursor: day ? "pointer" : "default",
                color: isSel ? "rgba(10,16,30,0.95)" : "rgba(200,210,230,0.8)",
                fontWeight: isSel ? 700 : 450,
              }}
            >
              {isSel && (
                <div ref={discRef as React.RefObject<HTMLDivElement>} style={{ position: "absolute", inset: 2, borderRadius: "50%" }} />
              )}
              <span style={{ position: "relative" }}>{day ?? ""}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// --- List: rows with title/subtitle/trailing, hover wash, click --------------

export function GIListItem({
  title,
  subtitle,
  leading,
  trailing,
  accent: accentProp,
  onClick,
}: {
  title: string;
  subtitle?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  accent?: Vec3;
  onClick?: () => void;
}) {
  const accent = useAccent(accentProp);
  const [hover, setHover] = useState(false);
  const ref = useGIShape({
    albedo: scale(accent, 0.28),
    tint: 1,
    height: 0.25,
    bevel: 4,
    cornerRadius: 8,
    bodyAlpha: hover ? 1 : 0,
  });
  return (
    <div
      ref={ref as React.RefObject<HTMLDivElement>}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      onClick={onClick}
      style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: 8, cursor: onClick ? "pointer" : "default", pointerEvents: "auto" }}
    >
      {leading}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "rgba(216,224,240,0.9)" }}>{title}</div>
        {subtitle && <div style={{ fontSize: 11.5, color: "rgba(160,170,190,0.65)", marginTop: 1 }}>{subtitle}</div>}
      </div>
      {trailing}
    </div>
  );
}

export function GIList({ children }: { children?: ReactNode }) {
  return <div style={{ display: "flex", flexDirection: "column", gap: 2, width: "100%" }}>{children}</div>;
}

// The palette's controlled search input (carved well + focus glow).
function PaletteInput({
  inputRef,
  value,
  onChange,
  accent,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  value: string;
  onChange: (v: string) => void;
  accent: Vec3;
}) {
  const ref = useGIShape({
    albedo: INSET_ALBEDO,
    tint: 1,
    emission: scale(accent, 0.14),
    displayScale: 3.5,
    height: -0.4,
    bevel: 4,
    cornerRadius: 8,
  });
  return (
    <div ref={ref as React.RefObject<HTMLDivElement>} style={{ borderRadius: 8, marginBottom: 6 }}>
      <input
        ref={inputRef as React.RefObject<HTMLInputElement>}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Type a command…"
        className="gi-field"
        style={{ width: "100%", boxSizing: "border-box", padding: "12px 14px", borderRadius: 8, fontSize: 13.5, fontFamily: "inherit", color: "rgba(214,224,240,0.94)", background: "transparent", border: "none", outline: "none", pointerEvents: "auto" }}
      />
    </div>
  );
}

// --- Command palette: ⌘K overlay with fuzzy-ish filtering ---------------------

export function GICommandPalette({
  commands,
  accent: accentProp,
  hotkey = "k",
}: {
  commands: { label: string; hint?: string; action?: () => void }[];
  accent?: Vec3;
  hotkey?: string;
}) {
  const accent = useAccent(accentProp);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === hotkey) {
        e.preventDefault();
        setOpen((o) => !o);
        setQuery("");
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hotkey]);
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 30);
  }, [open]);
  const q = query.trim().toLowerCase();
  const filtered = commands.filter((c) => c.label.toLowerCase().includes(q)).slice(0, 7);
  const run = (c: { label: string; action?: () => void }) => {
    c.action?.();
    setOpen(false);
  };
  return (
    <>
      <GIButton onClick={() => setOpen(true)}>
        Command palette <GIKbd>⌘</GIKbd>
        <GIKbd>K</GIKbd>
      </GIButton>
      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{ position: "fixed", inset: 0, display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "18vh", zIndex: 120, pointerEvents: "auto" }}
        >
          {/* Same overlay treatment as GIDialog: hole-punched scrim + backdrop
              blur so underlying DOM text can't bleed over the lit panel. */}
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: 440, maxWidth: "92vw", borderRadius: 10, boxShadow: "0 0 0 200vmax rgba(4,6,10,0.4)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)" }}
          >
            <Surface style={{ padding: 10 }} radius={10} heightScale={1.1} layer={2}>
              <PaletteInput inputRef={inputRef} value={query} onChange={setQuery} accent={accent} />
              {filtered.map((c) => (
                <GIListItem key={c.label} title={c.label} trailing={c.hint ? <GIKbd>{c.hint}</GIKbd> : undefined} onClick={() => run(c)} />
              ))}
              {filtered.length === 0 && (
                <div style={{ padding: "14px 12px", fontSize: 12.5, color: "rgba(160,170,190,0.6)" }}>No matching commands.</div>
              )}
            </Surface>
          </div>
        </div>
      )}
    </>
  );
}

// --- Toast: a raised notification card with an accent status dot ------------

export function GIToast({ title, message, accent: accentProp }: { title: string; message?: string; accent?: Vec3 }) {
  const accent = useAccent(accentProp);
  const cardRef = useGIShape({ albedo: SURFACE_ALBEDO, height: 1.0, bevel: 14, heightScale: 1.0, opacity: 0.55, cornerRadius: 11 });
  const dotRef = useGIShape({ kind: "circle", albedo: accent, tint: 1, emission: scale(accent, 0.7), displayScale: 8, height: 0.4, bevel: 3 });
  return (
    <div ref={cardRef as React.RefObject<HTMLDivElement>} style={{ display: "flex", alignItems: "flex-start", gap: 11, padding: "12px 15px", borderRadius: 11, width: 260 }}>
      <div ref={dotRef as React.RefObject<HTMLDivElement>} style={{ width: 10, height: 10, borderRadius: "50%", marginTop: 4, flex: "none" }} />
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: "rgba(220,228,242,0.92)" }}>{title}</div>
        {message && <div style={{ fontSize: 12, color: "rgba(170,180,200,0.72)", marginTop: 2, lineHeight: 1.45 }}>{message}</div>}
      </div>
    </div>
  );
}
