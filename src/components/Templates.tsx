import { useGITheme } from "../gi/GIProvider";
import {
  Surface,
  GIButton,
  GIField,
  GICheckbox,
  GIDivider,
  GISearch,
  GIAvatar,
  GISegmented,
  GIStat,
  GITable,
  GIBadge,
  GIProgress,
  GIPagination,
  GIToggle,
  GISlider,
  GIList,
  GIListItem,
  GITag,
  GIDatePicker,
} from "./index";

type Vec3 = [number, number, number];
const GOOD: Vec3 = [0.1, 0.7, 0.35];
const WARN: Vec3 = [0.95, 0.5, 0.1];

function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div style={{ margin: "18px 0 2px" }}>
      <div style={{ fontSize: 17, fontWeight: 700, color: "rgba(224,230,244,0.94)" }}>{title}</div>
      {hint && <div style={{ fontSize: 12.5, color: "rgba(150,162,184,0.6)", marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

// --- Sign-in ----------------------------------------------------------------

function SignIn() {
  const { accent } = useGITheme();
  return (
    <Surface style={{ padding: 20, width: 340 }} radius={9}>
      <div style={{ fontSize: 18, fontWeight: 700, color: "rgba(226,232,246,0.95)", marginBottom: 4 }}>
        Welcome back
      </div>
      <div style={{ fontSize: 12.5, color: "rgba(160,170,190,0.65)", marginBottom: 18 }}>
        Sign in to your lit workspace.
      </div>
      <GIField placeholder="email@company.dev" style={{ marginBottom: 12 }} />
      <GIField placeholder="password" style={{ marginBottom: 14 }} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <GICheckbox size={18} defaultChecked />
          <span style={{ fontSize: 12.5, color: "rgba(190,200,220,0.75)" }}>Remember me</span>
        </div>
        <span style={{ fontSize: 12.5, color: "rgba(120,160,230,0.8)", cursor: "pointer", pointerEvents: "auto" }}>
          Forgot?
        </span>
      </div>
      <GIButton accent={accent} style={{ width: "100%", boxSizing: "border-box" }}>Sign in</GIButton>
      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "16px 0" }}>
        <GIDivider />
        <span style={{ fontSize: 11, color: "rgba(150,160,180,0.55)", flex: "none" }}>OR</span>
        <GIDivider />
      </div>
      <GIButton style={{ width: "100%", boxSizing: "border-box" }}>Continue with SSO</GIButton>
    </Surface>
  );
}

// --- Dashboard ----------------------------------------------------------------

function Dashboard() {
  return (
    <Surface style={{ padding: 20 }} radius={9}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 18 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: "rgba(226,232,246,0.95)" }}>Overview</div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <GISearch placeholder="Search projects…" width={200} />
          <GIAvatar initials="AD" size={36} status={GOOD} />
        </div>
      </div>
      <GISegmented options={["Day", "Week", "Month", "Year"]} defaultIndex={1} width={280} />
      <div style={{ display: "flex", gap: 16, margin: "18px 0", flexWrap: "wrap" }}>
        <GIStat label="Requests" value="48.2k" delta="+12%" accent={GOOD} width={170} />
        <GIStat label="Latency" value="41ms" delta="−8%" width={170} />
        <GIStat label="Errors" value="0.02%" delta="flat" accent={WARN} width={170} />
      </div>
      <GITable
        columns={["Project", "Status", "Usage", "Owner"]}
        widths={["32%", "20%", "30%", "18%"]}
       
        rows={[
          ["giui-web", <GIBadge variant="solid" accent={GOOD}>Live</GIBadge>, <GIProgress value={0.82} width={130} />, "ada"],
          ["cascade-lab", <GIBadge variant="accent">Beta</GIBadge>, <GIProgress value={0.44} width={130} />, "kim"],
          ["photon-cli", <GIBadge variant="neutral">Paused</GIBadge>, <GIProgress value={0.12} width={130} />, "lee"],
          ["gbuffer-docs", <GIBadge variant="solid" accent={GOOD}>Live</GIBadge>, <GIProgress value={0.67} width={130} />, "ada"],
        ]}
      />
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
        <GIPagination pages={3} />
      </div>
    </Surface>
  );
}

// --- Pricing ------------------------------------------------------------------

function PricingCard({
  name,
  price,
  features,
  cta,
  highlighted = false,
}: {
  name: string;
  price: string;
  features: string[];
  cta: string;
  highlighted?: boolean;
}) {
  const { accent } = useGITheme();
  return (
    <Surface style={{ padding: 16, flex: 1, minWidth: 190 }} radius={9} height={highlighted ? 1.8 : 1.1}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 650, color: "rgba(222,228,242,0.92)" }}>{name}</span>
        {highlighted && <GIBadge variant="solid">Popular</GIBadge>}
      </div>
      <div style={{ marginBottom: 14 }}>
        <span style={{ fontSize: 26, fontWeight: 750, color: "rgba(228,234,248,0.96)" }}>{price}</span>
        <span style={{ fontSize: 12, color: "rgba(150,162,184,0.6)" }}> /mo</span>
      </div>
      <GIDivider />
      <div style={{ display: "flex", flexDirection: "column", gap: 8, margin: "14px 0 18px" }}>
        {features.map((f) => (
          <div key={f} style={{ fontSize: 12.5, color: "rgba(186,196,216,0.78)", display: "flex", gap: 8 }}>
            <span style={{ color: "rgba(90,190,120,0.85)" }}>✓</span>
            {f}
          </div>
        ))}
      </div>
      <GIButton accent={highlighted ? accent : undefined} style={{ width: "100%", boxSizing: "border-box" }}>
        {cta}
      </GIButton>
    </Surface>
  );
}

function Pricing() {
  return (
    <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
      <PricingCard name="Starter" price="$0" cta="Start free" features={["1 canvas", "2 lights", "Community help"]} />
      <PricingCard name="Pro" price="$19" cta="Go Pro" highlighted features={["Unlimited canvases", "8 lights", "Radiance cascades", "Priority help"]} />
      <PricingCard name="Scale" price="$79" cta="Contact us" features={["Everything in Pro", "SSO + audit log", "Dedicated GPU lane"]} />
    </div>
  );
}

// --- Settings panel -----------------------------------------------------------

function Settings() {
  const { accent } = useGITheme();
  return (
    <Surface style={{ padding: 18, width: 340 }} radius={9}>
      <div style={{ fontSize: 15, fontWeight: 700, color: "rgba(224,230,244,0.93)", marginBottom: 14 }}>
        Notifications
      </div>
      {["Mentions", "New follows", "Weekly digest"].map((label) => (
        <div key={label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0" }}>
          <span style={{ fontSize: 13, color: "rgba(196,206,226,0.8)" }}>{label}</span>
          <GIToggle />
        </div>
      ))}
      <div style={{ margin: "10px 0 14px" }}>
        <GIDivider />
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 13, color: "rgba(196,206,226,0.8)" }}>Alert volume</span>
        <GISlider accent={accent} width={150} initial={0.6} />
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
        <GIButton>Reset</GIButton>
        <GIButton accent={accent}>Save changes</GIButton>
      </div>
    </Surface>
  );
}

// --- Inbox: list-centric app panel + a scheduling sidebar -----------------------

function Inbox() {
  return (
    <div style={{ display: "flex", gap: 22, flexWrap: "wrap", alignItems: "flex-start" }}>
      <Surface style={{ padding: 14, flex: 2, minWidth: 340 }} radius={9}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, gap: 12 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "rgba(224,230,244,0.93)" }}>Inbox</div>
          <GISearch placeholder="Filter…" width={170} />
        </div>
        <GIList>
          <GIListItem
            title="Cascade merge artifact at c3"
            subtitle="kim · 2h ago"
            leading={<GIAvatar initials="KM" size={34} status={WARN} />}
            trailing={<GIBadge variant="accent">bug</GIBadge>}
            onClick={() => {}}
          />
          <GIListItem
            title="Theme provider shipped 🎉"
            subtitle="ada · 5h ago"
            leading={<GIAvatar initials="AD" size={34} status={GOOD} />}
            trailing={<GIBadge variant="solid" accent={GOOD}>done</GIBadge>}
            onClick={() => {}}
          />
          <GIListItem
            title="Ambient throttle review"
            subtitle="lee · yesterday"
            leading={<GIAvatar initials="LE" size={34} />}
            trailing={<GITag>perf</GITag>}
            onClick={() => {}}
          />
          <GIListItem
            title="Pricing page copy pass"
            subtitle="mia · 2d ago"
            leading={<GIAvatar initials="MI" size={34} />}
            onClick={() => {}}
          />
        </GIList>
      </Surface>
      <Surface style={{ padding: 14, flex: 1, minWidth: 280 }} radius={9}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "rgba(224,230,244,0.93)", marginBottom: 12 }}>Schedule</div>
        <GIDatePicker />
      </Surface>
    </div>
  );
}

// --- The template gallery -----------------------------------------------------

export function Templates() {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <SectionTitle title="Examples" hint="Full compositions built from the kit — every panel, control and glow is in the same light field." />
      <Dashboard />
      <Inbox />
      <div style={{ display: "flex", gap: 22, flexWrap: "wrap", alignItems: "flex-start" }}>
        <SignIn />
        <Settings />
      </div>
      <Pricing />
    </section>
  );
}
