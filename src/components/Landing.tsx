import { useEffect, useRef, useState } from "react";
import { useGITheme } from "../gi/GIProvider";
import { useGIShape } from "../gi/useGIShape";
import { useGIScreen } from "../gi/GIContext";
import { SCREEN_TEX_W, SCREEN_TEX_H } from "../gi/renderer";
import { Surface, GIStat } from "./index";

type Vec3 = [number, number, number];

const scale = (v: Vec3, k: number): Vec3 => [v[0] * k, v[1] * k, v[2] * k];

// HSL -> (approx) linear RGB, for the lava lamp's slow hue cycling.
function hslToLinear(h: number, s: number, l: number): Vec3 {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return c * c; // squaring ≈ sRGB→linear
  };
  return [f(0), f(8), f(4)];
}

// HSL -> sRGB 0..255 (for the hero's canvas surge colour).
function hslToRgb255(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round((l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255);
  };
  return [f(0), f(8), f(4)];
}

// One glowing lava-lamp blob: rises and falls on a CSS path (live shape) while
// its colour is driven from the lamp's shared hue cycle.
// An INVISIBLE emitter (bodyAlpha 0): no disc, no outline, no surface — the
// only thing rendered is the coloured radiance it pours into the vessel.
function LavaBlob({ color, size, cls, left }: { color: Vec3; size: number; cls: string; left: number }) {
  const ref = useGIShape({
    kind: "circle",
    albedo: color,
    emission: scale(color, 0.55),
    opacity: 0.5, // occludes a little, so the pools keep some directionality
    height: 0,
    bevel: 6,
    bodyAlpha: 0,
    rawGlow: true,
    live: true,
  });
  return (
    <div className={cls} style={{ position: "absolute", left, bottom: 16, width: size, height: size }}>
      <div ref={ref as React.RefObject<HTMLDivElement>} style={{ width: "100%", height: "100%", borderRadius: "50%" }} />
    </div>
  );
}

// The lava lamp, light-field edition: a carved vessel whose rim catches the
// light, and three HIDDEN hue-cycling emitters bobbing inside. You never see a
// light source — only the moving pools of radiance on the vessel's surface.
// (Superseded on the landing by FluidHero, kept exported for reuse.)
export function LavaLamp() {
  const [hue, setHue] = useState(215);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = window.setInterval(() => setHue((h) => (h + 1.2) % 360), 100);
    return () => window.clearInterval(t);
  }, []);
  const blob = (offset: number) => hslToLinear((hue + offset) % 360, 0.85, 0.5);
  return (
    <div style={{ position: "absolute", left: "5%", top: 20, pointerEvents: "none" }}>
      <Surface carved radius={46} heightScale={1.6} style={{ position: "relative", width: 92, height: 240, borderRadius: 46 }}>
        <LavaBlob color={blob(0)} size={44} cls="gi-lava-a" left={24} />
        <LavaBlob color={blob(50)} size={30} cls="gi-lava-b" left={10} />
        <LavaBlob color={blob(100)} size={24} cls="gi-lava-c" left={52} />
      </Surface>
    </div>
  );
}

// A VISIBLE draggable light in the hero — grab it and pull the lighting around.
// (No longer mounted — hand-placed lights are off by default; kept for reuse.)
export function HeroLight({ color }: { color: Vec3 }) {
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [dragged, setDragged] = useState(false);
  const dragging = useRef(false);
  const off = useRef({ x: 0, y: 0 });
  const ref = useGIShape({
    kind: "circle",
    albedo: [0.22, 0.22, 0.25],
    emission: scale(color, 0.8),
    opacity: 1,
    height: 0.6,
    bevel: 4,
    rawGlow: true,
    live: true,
  });
  return (
    <div style={{ position: "absolute", left: `calc(82% + ${pos.x}px)`, top: 60 + pos.y, textAlign: "center", pointerEvents: "auto" }}>
      <div
        ref={ref as React.RefObject<HTMLDivElement>}
        onPointerDown={(e) => {
          dragging.current = true;
          setDragged(true);
          off.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (dragging.current) setPos({ x: e.clientX - off.current.x, y: e.clientY - off.current.y });
        }}
        onPointerUp={() => (dragging.current = false)}
        style={{ width: 24, height: 24, borderRadius: "50%", cursor: "grab", touchAction: "none", margin: "0 auto" }}
      />
      {!dragged && (
        <div style={{ marginTop: 8, fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", color: "rgba(160,172,196,0.55)", whiteSpace: "nowrap" }}>
          drag the light
        </div>
      )}
    </div>
  );
}

// Feature card: a carved circular well holding a glowing dot — the icon is lit
// geometry, not an icon font.
function Feature({ title, body, dot }: { title: string; body: string; dot: Vec3 }) {
  const wellRef = useGIShape({
    kind: "circle",
    albedo: [0.035, 0.038, 0.046],
    tint: 1,
    height: -0.5,
    bevel: 7,
    heightScale: 1.4,
  });
  const dotRef = useGIShape({
    kind: "circle",
    albedo: dot,
    tint: 1,
    emission: scale(dot, 0.65),
    displayScale: 6,
    height: 0.5,
    bevel: 3,
  });
  return (
    <Surface style={{ padding: "14px 18px 16px", flex: 1, minWidth: 220 }} radius={9}>
      {/* Icon well rides the title row (top right) instead of its own block —
          the body text then gets the full card width. */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 7 }}>
        <div style={{ fontSize: 14, fontWeight: 650, color: "rgba(222,228,242,0.92)", paddingTop: 7 }}>{title}</div>
        <div ref={wellRef as React.RefObject<HTMLDivElement>} style={{ position: "relative", width: 30, height: 30, borderRadius: "50%", flex: "none" }}>
          <div ref={dotRef as React.RefObject<HTMLDivElement>} style={{ position: "absolute", left: "32%", top: "32%", width: "36%", height: "36%", borderRadius: "50%" }} />
        </div>
      </div>
      <div style={{ fontSize: 12.5, lineHeight: 1.55, color: "rgba(170,180,200,0.72)" }}>{body}</div>
    </Surface>
  );
}

// ---------------------------------------------------------------------------
// FluidHero: an edge-to-edge light-field band behind the hero content. ~16
// HIDDEN emitters are advected by a divergence-free-ish flow (curl of a
// sum-of-sines stream function) with hue drifting across the band — a fluid of
// pure radiance. Emitter count is nearly free here: the cascades' cost doesn't
// scale with light count, and each blob is one AABB-culled shape.
// ---------------------------------------------------------------------------

// FluidHero v2 — a SCREEN, not a component: the band is a flat rect that shows
// (and emits) a low-res fluid picture painted into an offscreen 2D canvas —
// blurred, trailing gradients advected by a curl-style flow, hue drifting as
// one family. The picture is continuous ("filled in"), hard-clipped to the
// rect (nothing escapes), and the whole band glows onto the page like a TV in
// a dark room. Swap the canvas for a <video> frame and it plays video light.

type Swirl = { x: number; y: number; seed: number; r: number };
// Swirl count is FREE: they're gradients painted into a small 2D canvas — the
// GI samples the resulting picture and never sees individual "lights".
// (Per-swirl alpha scales down as the count scales up to keep the total
// luminance at the same moody level.)
const N_SWIRLS = 70;

// One-time CRT texture tiles for the hero screen's analog finish, both drawn
// into small canvases and used as repeating background images:
// - scan: irregular scanlines (jittered spacing/thickness/alpha + darker
//   sub-segments) — a uniform repeating-gradient read as too mechanical.
// - noise: grayscale film grain, animated by jumping the layer via CSS steps().
function makeCrtTiles() {
  const scan = document.createElement("canvas");
  scan.width = 128;
  scan.height = 88;
  const sg = scan.getContext("2d")!;
  let y = 1;
  while (y < scan.height - 1) {
    const a = 0.1 + Math.random() * 0.13;
    const th = Math.random() < 0.18 ? 2 : 1;
    sg.fillStyle = `rgba(0,0,0,${a.toFixed(3)})`;
    sg.fillRect(0, y, scan.width, th);
    if (Math.random() < 0.5) {
      const x0 = Math.random() * scan.width;
      sg.fillStyle = `rgba(0,0,0,${(a * 0.55).toFixed(3)})`;
      sg.fillRect(x0, y, 24 + Math.random() * 60, th);
    }
    y += 3 + Math.random() * 2.4;
  }
  const noise = document.createElement("canvas");
  noise.width = noise.height = 160;
  const ng = noise.getContext("2d")!;
  const img = ng.createImageData(noise.width, noise.height);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = (Math.random() * 255) | 0;
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ng.putImageData(img, 0, 0);
  return { scan: scan.toDataURL(), noise: noise.toDataURL() };
}

function FluidHero({ children }: { children?: React.ReactNode }) {
  const mkCanvas = () => {
    const c = document.createElement("canvas");
    c.width = SCREEN_TEX_W;
    c.height = SCREEN_TEX_H;
    return c;
  };
  // `src` = the persistent fluid sim (feedback buffer). `out` = the presented
  // frame rebuilt from `src` each tick (fluid + light-amplifying wordmark + RGB
  // split); kept separate so the letter boost never feeds back and runs away.
  const [src] = useState(mkCanvas);
  const [out] = useState(mkCanvas);
  const [crt] = useState(makeCrtTiles);
  // emit history: 0.95 read 2× too strong → 0.48 → 0.35 (owner: GI spill from
  // the screen still read a little high at 0.48). topFade thins the emitted
  // light toward the band's top edge so the nav above isn't flooded — the
  // visible picture is unaffected.
  // emit 0.35 → 0.21 (owner: reduce the screen's GI contribution by 40%).
  const screenRef = useGIScreen(out, { emit: 0.21, display: 3.2, topFade: 0.7, topFadeH: 0.45 });

  // Paint the fluid source (~30Hz): faded trails + blurred additive gradients.
  useEffect(() => {
    const ctx = src.getContext("2d");
    if (!ctx) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const W = SCREEN_TEX_W;
    const H = SCREEN_TEX_H;
    // Offscreen scratches for the RGB split (one per shifted channel).
    const mkScratch = () => {
      const c2 = document.createElement("canvas");
      c2.width = W;
      c2.height = H;
      return c2.getContext("2d")!;
    };
    const chromaR = mkScratch();
    const chromaB = mkScratch();
    const octx = out.getContext("2d", { willReadFrequently: true })!;

    // Static letter coverage mask (alpha per pixel). The wordmark is a LIGHT
    // AMPLIFIER: within these letters the underlying fluid is boosted; over
    // darkness the letters simply don't exist. Rendered once.
    const maskC = mkScratch();
    maskC.font = "800 54px system-ui, -apple-system, 'Segoe UI', sans-serif";
    maskC.textAlign = "center";
    maskC.textBaseline = "middle";
    maskC.fillStyle = "#fff";
    maskC.fillText("giui", W / 2, H / 2 + 3);
    const mask = maskC.getImageData(0, 0, W, H).data;

    let scanPhase = 0;
    const rowGlow = new Array(H).fill(0);
    let humSweep = 0; // position of the slow hum scanline (darkens fluid, activates letters)
    const humBand = new Array(H).fill(0); // narrow bright core — lights the text
    const humDark = new Array(H).fill(0); // wider halo — darkens the fluid (the visible band)
    // Whole-word illumination surge + its electric-staccato decay.
    let surge = 0; // 0..1 global swell that occasionally lights the whole word
    let zap = 0; // a single sharp electric flash, decays within a few frames
    let zapT = 0; // countdown to the next zap

    const swirls: Swirl[] = Array.from({ length: N_SWIRLS }, (_, i) => ({
      x: ((i * 373) % 89) / 89 * W,
      y: ((i * 211) % 47) / 47 * H,
      seed: i * 1.7,
      r: 11 + ((i * 131) % 17),
    }));
    ctx.fillStyle = "#05060a";
    ctx.fillRect(0, 0, W, H);
    let last = performance.now();
    let timer = 0;
    const frame = () => {
      const now = performance.now();
      const dt = Math.min(0.08, (now - last) / 1000);
      last = now;
      const t = now / 1000;
      // Warm–cool palette (owner: blue + green + orange + a little red, but NOT
      // magenta, and not "purely blue and red"). Hues live on the arc
      // blue→teal→green→yellow→orange→red (235°→ −25°≡335°) which SKIPS the
      // magenta/purple wedge (236°–334°) entirely. A window into that arc slides
      // slowly, so the scene shows a few related hues at once and cycles through
      // the whole warm–cool range over ~time.
      const hueWin = (t * 0.018) % 1; // window centre slides along the arc
      // Slow fade = long luminous trails (safe post-sRGB-fix: the linearized
      // floor stays black instead of washing grey).
      ctx.filter = "none";
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "rgba(5,6,10,0.09)";
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = "lighter";
      ctx.filter = "blur(4px)";
      swirls.forEach((s, i) => {
        // The light flows everywhere; the wordmark (painted into `out` below)
        // makes its own figure by amplifying whatever light rolls over it.
        const vx = 14 * Math.sin(s.y * 0.11 + t * 0.23 + s.seed) + 6 * Math.cos(s.y * 0.23 - t * 0.16);
        const vy = 9 * Math.cos(s.x * 0.07 + t * 0.19 + s.seed * 1.4) + 4 * Math.sin(s.x * 0.04 + t * 0.11);
        s.x = (s.x + vx * dt + W) % W;
        s.y = Math.max(6, Math.min(H - 6, s.y + vy * dt + (H / 2 - s.y) * 0.1 * dt));
        // Position within the sliding window → a hue on the arc. REFLECT (not
        // wrap) at the endpoints so the window ping-pongs blue↔red and never
        // mixes the red end with the blue end (which would average to magenta).
        const raw = hueWin + (s.x / W - 0.5) * 0.34 + Math.sin(i * 1.3 + t * 0.06) * 0.07;
        let pr = ((raw % 2) + 2) % 2;
        if (pr > 1) pr = 2 - pr; // triangle reflect → [0,1]
        const h = 220 - pr * 215; // blue(220°)→teal→green→orange→red(5°); no magenta
        const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r);
        // Alpha compensates the r² area growth — total flux stays constant
        // when sizes change, so "bigger" never becomes "brighter".
        g.addColorStop(0, `hsla(${h}, 74%, 36%, 0.055)`);
        g.addColorStop(1, "hsla(0, 0%, 0%, 0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.filter = "none";
      ctx.globalCompositeOperation = "source-over";

      // ---- Presented frame: composite `src` (pure fluid) into `out`, then add
      // the light-amplifying wordmark + RGB split. `out` is rebuilt from scratch
      // every tick, so the letter boost can never self-amplify / run away.
      octx.globalCompositeOperation = "source-over";
      octx.filter = "none";
      octx.globalAlpha = 1;
      octx.drawImage(src, 0, 0);

      // The wordmark is a LIGHT AMPLIFIER, not a stencil. Within the letter mask
      // we boost the underlying fluid past a "tolerance" knee: below it the
      // letters don't exist (dark = invisible); above it brightness rises with
      // the square of the light (so a pool rolling over the letters makes them
      // flare up brighter than the brightest light in the scene) — capped by a
      // soft exp ceiling so it never blows to flat white. A per-row scanline
      // term (scrolling + random jumps/flares) glitchily brightens the letters,
      // on top of the DOM darkening scanlines.
      scanPhase += dt * 24;
      if (Math.random() < 0.05) scanPhase += 40 + Math.random() * 90; // glitch jump
      const flare = Math.random() < 0.08 ? 1.7 : 1.0; // occasional bright flare
      for (let y = 0; y < H; y++) rowGlow[y] = 0.5 + 0.5 * Math.sin((y * 0.85 + scanPhase) * 0.5);
      // A single SLOW hum scanline sweeps down the band and does BOTH: a WIDE
      // dark halo darkens the fluid (the visible sweeping band) with a NARROW
      // bright core that lights up the text as it crosses. Slow sweep speed
      // (~8px/s) kept, but a long off-screen gap makes a full pass happen only
      // ~every 45s (owner: 2–3× less frequent than the old 18s). Replaces the
      // old fast vertical sweep + the separate DOM hum bars (both removed).
      humSweep += dt * 8; // px/s (unchanged slow feel)
      const humY = (humSweep % 360) - 40; // 360px cycle ≈ 45s; on-screen only part of it
      for (let y = 0; y < H; y++) {
        const dc = (y - humY) / 11;
        humBand[y] = Math.exp(-dc * dc); // narrow bright core → text activation
        const dh = (y - humY) / 22;
        humDark[y] = Math.exp(-dh * dh); // wider halo → fluid darkening (visible band)
      }

      // Whole-word illumination envelope: every few seconds the entire word
      // swells (surge → 1), then dies out in an ELECTRIC STACCATO — sharp zaps
      // that grow sparser and dimmer as the surge fades. Early on the steady
      // floor dominates (word held lit); as it decays the zaps take over
      // (stuttering flicker), like a neon tube shorting out.
      if (Math.random() < 0.006) surge = 1; // new surge (~every 5–6s)
      surge *= 0.955; // underlying decay (~1.5s tail)
      if (surge < 0.004) surge = 0;
      zapT -= dt;
      if (zapT <= 0) {
        zap = 0.5 + Math.random() * 0.5; // strike
        zapT = 0.02 + Math.random() * 0.1 + (1 - surge) * 0.13; // sparser as it dies
      }
      zap *= 0.62; // each strike flashes then fades within a few frames
      const steady = surge * surge; // steady floor, fades fast (surge²)
      const flicker = surge * Math.min(1, zap * 1.4); // staccato component
      const envelope = Math.max(steady * 0.9, flicker); // steady early → flicker late
      // Surge injection colour = current palette centre, vivid — so a surge
      // over DARK fluid glows a saturated hue (not grey) and casts coloured
      // light. Reflected (like the swirls) so it never lands on magenta.
      let pw = ((hueWin % 2) + 2) % 2;
      if (pw > 1) pw = 2 - pw;
      const shue = 220 - pw * 215;
      const [sc0, sc1, sc2] = hslToRgb255(shue, 0.9, 0.5);
      const od = octx.getImageData(0, 0, W, H);
      const p = od.data;
      const knee = 0.22;
      const surgeLit = envelope * 0.72; // whole-word floor (kept "somewhat")
      for (let i = 0; i < p.length; i += 4) {
        const yrow = ((i >> 2) / W) | 0;
        const hb = humBand[yrow]; // slow hum scanline intensity at this row
        const am = mask[i + 3] / 255;
        const r = p[i], g = p[i + 1], b = p[i + 2];
        if (am < 0.02) {
          // Fluid (non-letter): the slow hum scanline DARKENS it as it passes
          // (wide halo → a clearly visible dark band sweeping the picture).
          const hd = humDark[yrow];
          if (hd > 0.003) {
            const dk = 1 - hd * 0.5;
            p[i] = r * dk; p[i + 1] = g * dk; p[i + 2] = b * dk;
          }
          continue;
        }
        let tt = (Math.max(r, g, b) / 255 - knee) / (1 - knee);
        if (tt > 1) tt = 1;
        const localLit = tt > 0 ? Math.pow(tt, 1.5) : 0; // pools crossing the letters
        const scanLit = hb * 0.7; // the SAME slow scanline ACTIVATES the letters
        // Screen-combine LOCAL pools + GLOBAL surge + the slow SCAN, so any of
        // them lights the letters (surge = whole word; scan = the hum line).
        const lit = 1 - (1 - localLit) * (1 - surgeLit) * (1 - scanLit);
        if (lit < 0.004) continue; // nothing here → letter invisible
        const sl = 1 + rowGlow[yrow] * 0.4 * flare;
        const boost = am * lit * sl;
        const bl = boost < 1 ? boost : 1; // blend so onset is smooth / invisible below knee
        // Colour floor so letters light over DARK fluid — a VIVID palette hue for
        // BOTH the surge flash and the scan (owner: the scan should look like the
        // colour glitch/flash, NOT wash white).
        const fl = Math.max(surgeLit, scanLit) * 95;
        const br = Math.max(r, (sc0 * fl) / 255);
        const bg = Math.max(g, (sc1 * fl) / 255);
        const bb = Math.max(b, (sc2 * fl) / 255);
        // Luminance-preserving amplify: lift luminance through a soft ceiling but
        // scale ALL channels by the same gain, so bright letters stay saturated
        // and emissive (vibrant colour) instead of washing out to grey.
        const lum = Math.max(br, bg, bb, 1);
        const mult = 1 + boost * 6.5;
        const gain = (255 * (1 - Math.exp(-(lum / 255) * mult))) / lum;
        let nr = br * gain, ng = bg * gain, nb = bb * gain;
        // Only the very hottest LOCAL peaks get a tiny white glint; the surge
        // and the scan both stay coloured/vibrant (no white wash).
        const wc = boost > 0.82 ? (boost - 0.82) * 0.5 : 0;
        nr += (255 - nr) * wc;
        ng += (255 - ng) * wc;
        nb += (255 - nb) * wc;
        p[i] = r + (nr - r) * bl;
        p[i + 1] = g + (ng - g) * bl;
        p[i + 2] = b + (nb - b) * bl;
      }
      octx.putImageData(od, 0, 0);

      // In-source glow: a blurred additive copy blooms the brightest areas (the
      // lit letters most), giving a coloured halo with falloff AND more EMITTED
      // light — surge-weighted so a swell visibly glows and casts colour, while
      // the calm baseline is barely changed (keeps GI spill in check).
      octx.save();
      octx.globalCompositeOperation = "lighter";
      octx.filter = "blur(3.5px)";
      octx.globalAlpha = 0.12 + envelope * 0.5;
      octx.drawImage(out, 0, 0);
      octx.filter = "none";
      octx.globalAlpha = 1;
      octx.globalCompositeOperation = "source-over";
      octx.restore();

      // RGB split on the presented frame: red nudged right, blue left — analog
      // chromatic fringing on the pools AND the glowing letters. Fresh each
      // frame (no accumulation, since `out` is not a feedback buffer).
      const isolate = (dst: CanvasRenderingContext2D, color: string) => {
        dst.globalCompositeOperation = "copy";
        dst.drawImage(out, 0, 0);
        dst.globalCompositeOperation = "multiply";
        dst.fillStyle = color;
        dst.fillRect(0, 0, W, H);
      };
      isolate(chromaR, "#ff0000");
      isolate(chromaB, "#0000ff");
      octx.globalCompositeOperation = "multiply";
      octx.fillStyle = "#00ff00"; // keep only green in place
      octx.fillRect(0, 0, W, H);
      octx.globalCompositeOperation = "lighter";
      octx.drawImage(chromaR.canvas, 0.7, 0);
      octx.drawImage(chromaB.canvas, -0.7, 0);
      octx.globalCompositeOperation = "source-over";
      if (!reduced) timer = window.setTimeout(frame, 33);
    };
    frame();
    return () => window.clearTimeout(timer);
  }, [src, out]);

  return (
    <section className="fluid-hero">
      {/* Recessed enclosure: a wide, shallow carved well. Wide bevel + soft
          S-curve rolloff + low heightScale so the wall reads as a gradual
          blend into the backplate — the old narrow rounded-shoulder wall
          (bevel 38, rolloff 1, heightScale 2.2) shaded as a solid band along
          the top/bottom edges. */}
      <Surface
        carved
        radius={0}
        height={0.7}
        bevel={72}
        rolloff={0}
        heightScale={0.8}
        style={{ position: "absolute", inset: 0 }}
      />
      <div ref={screenRef} style={{ position: "absolute", inset: 0 }}>
        {/* Screenspace glow: the presented `out` canvas, DOM-overlaid with a
            wide blur + screen blending — bloom that is always in sync with the
            picture (glowing letters included), spilling softly past the bezel. */}
        <div
          ref={(el) => {
            if (el && out.parentElement !== el) {
              Object.assign(out.style, {
                position: "absolute",
                inset: "-14px",
                width: "calc(100% + 28px)",
                height: "calc(100% + 28px)",
                filter: "blur(30px) saturate(1.35)",
                opacity: "0.4",
                mixBlendMode: "screen",
                pointerEvents: "none",
                // Fade the bloom's top so the DOM glow doesn't wash the nav
                // (mirrors the GI topFade on the emitted light).
                maskImage: "linear-gradient(to bottom, transparent 0%, black 30%)",
                webkitMaskImage: "linear-gradient(to bottom, transparent 0%, black 30%)",
              } as CSSStyleDeclaration);
              el.appendChild(out);
            }
          }}
          style={{ position: "absolute", inset: 0 }}
        />
      </div>
      {/* Spacer only: the wordmark is painted into the source canvas (part of
          the projection), so the band has no in-flow content of its own. */}
      <div style={{ position: "relative", minHeight: 430 }}>{children}</div>
      {/* Analog finish, pure screenspace DOM: organic scanlines + animated
          film grain (generated tiles) + corner vignette, plus the two dark
          hum bars rolling down (::before/::after). */}
      <div className="crt-overlay" aria-hidden>
        {/* Grain first: it's part of the projected PICTURE, so the scanlines
            (a property of the tube face) must paint over it. */}
        <div className="crt-grain" style={{ backgroundImage: `url(${crt.noise})` }} />
        <div className="crt-scan" style={{ backgroundImage: `url(${crt.scan})` }} />
      </div>
    </section>
  );
}

export function Landing() {
  const { accent } = useGITheme();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 40 }}>
      {/* Hero — an edge-to-edge fluid light field with the content floating on
          it, plus the draggable light swimming in the same fluid. */}
      {/* The band IS the hero: the wordmark is painted into the projection
          itself (see FluidHero's frame loop). */}
      <FluidHero />

      {/* Why */}
      <section style={{ display: "flex", gap: 30, flexWrap: "wrap" }}>
        <Feature
          dot={accent}
          title="Physically lit"
          body="One light simulation shades every component: key light, soft shadows, contact AO, and a real radiance bounce between neighbours."
        />
        <Feature
          dot={accent}
          title="One-line theming"
          body="Change theme.accent on the provider and every control — and the light it casts — follows. No gradient archaeology."
        />
        <Feature
          dot={accent}
          title="Fast by architecture"
          body="Viewport-bounded rendering, ambient throttling, and frame pacing: idle costs zero GPU and animation never fights your display."
        />
      </section>

      {/* By the numbers */}
      <section style={{ display: "flex", gap: 30, justifyContent: "center", flexWrap: "wrap" }}>
        <GIStat label="Components" value="40+" delta="lit" width={170} />
        <GIStat label="Render passes" value="4" delta="GPU" width={170} />
        <GIStat label="Idle GPU cost" value="0" delta="by design" width={170} />
      </section>

      {/* Footer: license + donate. Anchors self-enable pointer events because
          .layout is click-through (gotcha #4). */}
      <footer style={{ textAlign: "center", fontSize: 12, lineHeight: 1.7, color: "rgba(150,160,182,0.5)", margin: "8px 0 4px" }}>
        Free for individuals and small teams under the{" "}
        <a
          href="https://polyformproject.org/licenses/small-business/1.0.0"
          target="_blank"
          rel="noreferrer"
          style={{ color: "rgba(150,160,182,0.75)", pointerEvents: "auto" }}
        >
          PolyForm Small Business license
        </a>
        {" "}— larger companies, get in touch.
        <br />
        If giui lights up your project,{" "}
        <a
          href="https://davehale.net/donate"
          target="_blank"
          rel="noreferrer"
          style={{ color: "rgba(150,160,182,0.75)", pointerEvents: "auto" }}
        >
          consider donating
        </a>
        . © Dave Hale
      </footer>
    </div>
  );
}
